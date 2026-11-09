// SessionStart hook: pick the anchor folder, inject STATUS + recent log, ask for a [Status] report.
import fs from 'node:fs';
import path from 'node:path';
import {
  runHook, readInput, hookEnv, emit, inScope, normalizeWinPath, isInteractive, statePaths, writeState, removeFile, maybeDump, historyDir,
  resolveAnchor, readerBody, readerTotalMax, VALID_SOURCES, AGENT, lastWorkerLine, t, appendLog, runRetention, retentionLogLine,
  trackerDbReadInstruction, statusFormatFor, hasArtifactTools, hasSessionContext, writePending,
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
  const env = hookEnv();
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const source = data.source;
  if (!VALID_SOURCES.includes(source)) return; // compact etc. excluded

  // Initial candidate: startup → cwd. clear/resume/fork → CLAUDE_PROJECT_DIR if in scope, else cwd.
  let candidate = data.cwd;
  // Grok's CLAUDE_PROJECT_DIR is the repository root and can differ from the launch folder → Grok always uses cwd.
  if (source !== 'startup' && AGENT !== 'grok' && env.CLAUDE_PROJECT_DIR && inScope(env.CLAUDE_PROJECT_DIR, env)) candidate = env.CLAUDE_PROJECT_DIR;
  const sp = statePaths(data.session_id, env);
  if (!candidate || !inScope(candidate, env)) {
    // started/resumed outside the root: drop state, inject nothing
    removeFile(sp.json);
    removeFile(sp.tool);
    removeFile(sp.tracker);
    removeFile(sp.ctx);
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
    ...(data.is_background_agent === true ? { background: true } : {}), // Cursor sends this field on session events only
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
    const dbRead = hasArtifactTools() ? trackerDbReadInstruction(anchor, env) : ''; // read the tracker page db once (only when it has a url). Cursor, Grok and Kimi have no ArtifactData
    ctx = `${lw ? `[auto-history] ${lw}\n` : ''}${L.sessionIntro(anchor)}${L.sessionInstruction}${dbRead ? `\n${dbRead}` : ''}${readerBody(anchor, env, { sid8: String(data.session_id).slice(0, 8) })}`;
    if (ctx.length > readerTotalMax(env)) ctx = ctx.slice(0, readerTotalMax(env));
  }
  if (!hasSessionContext()) {
    // Grok and Kimi do not pass session-start output to the model → hold it for the next delivery point. A folder without history has nothing to pass on.
    if (fs.existsSync(historyDir(anchor, env))) writePending(data.session_id, { reader: ctx }, env);
    return;
  }
  if (AGENT === 'cursor') {
    // Cursor cannot take text per prompt, so the STATUS instruction goes in here too. Its docs do not say which form it reads from Claude settings: both are sent.
    const text = `${ctx}\n\n${L.sessionStatusReminder(statusFormatFor(env))}`;
    emit({ additional_context: text, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
    return;
  }
  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } });
});
