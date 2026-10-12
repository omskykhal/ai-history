// SessionStart hook: pick the anchor folder, inject STATUS + recent log, ask for a [Status] report.
import fs from 'node:fs';
import path from 'node:path';
import {
  runHook, readInput, emit, inScope, normalizeWinPath, isInteractive, statePaths, writeState, removeFile, maybeDump, historyDir,
  resolveAnchor, readerBody, READER_TOTAL_MAX, VALID_SOURCES, AGENT, lastWorkerLine, t, appendLog, runRetention, retentionLogLine,
} from './common.mjs';

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function cleanupStale(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  const now = Date.now();
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      const st = fs.statSync(f);
      if (st.isFile() && now - st.mtimeMs > STALE_MS) fs.unlinkSync(f);
    } catch { /* ignore */ }
  }
}

runHook(async () => {
  const env = process.env;
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const source = data.source;
  if (!VALID_SOURCES.includes(source)) return; // compact etc. excluded

  // Initial candidate: startup → cwd. clear/resume/fork → CLAUDE_PROJECT_DIR if in scope, else cwd.
  let candidate = data.cwd;
  if (source !== 'startup' && env.CLAUDE_PROJECT_DIR && inScope(env.CLAUDE_PROJECT_DIR, env)) candidate = env.CLAUDE_PROJECT_DIR;
  const sp = statePaths(data.session_id, env);
  if (!candidate || !inScope(candidate, env)) {
    // started/resumed outside the root: drop state, inject nothing
    removeFile(sp.json);
    removeFile(sp.tool);
    return;
  }

  const r = resolveAnchor(data, env, { allowSwitch: true, candidate });
  if (!r) return;
  const { anchor } = r;
  writeState(data.session_id, {
    anchor,
    promptAt: null,
    blockedAt: null,
    createdAt: (r.state && r.state.createdAt) || new Date().toISOString(),
    agent: AGENT,
    lastCwd: (r.state && r.state.lastCwd) || normalizeWinPath(candidate),
  }, env);
  cleanupStale(sp.dir);
  // log retention for this anchor (once per 24h, interactive or not)
  const rl = retentionLogLine(runRetention(anchor, env), env);
  if (rl) appendLog(anchor, data, rl, env);
  maybeDump('SessionStart', data, env);

  if (!isInteractive(data, env)) return;

  const L = t(env);
  let ctx;
  if (!fs.existsSync(historyDir(anchor, env))) {
    ctx = L.sessionNoHistory;
  } else {
    const lw = lastWorkerLine(anchor, env);
    ctx = `${lw ? `[auto-history] ${lw}\n` : ''}${L.sessionIntro(anchor)}${L.sessionInstruction}${readerBody(anchor, env, { sid8: String(data.session_id).slice(0, 8) })}`;
    if (ctx.length > READER_TOTAL_MAX) ctx = ctx.slice(0, READER_TOTAL_MAX);
  }
  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } });
});
