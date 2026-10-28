// SessionEnd hook: when a session ends (/exit, /clear, logout, ...) record how to resume it.
// (1) one log line `[exit] session end(reason=…) resume: claude --resume <id>`, (2) add a Resume line to the header of the STATUS.md and
// sessions/ copy this session wrote. The anchor is read from the existing state file only (no new anchor at session end).
// Non-blocking event: no output, exit 0 on any error.
import path from 'node:path';
import {
  runHook, readInput, hookEnv, readState, inScope, normalizeWinPath, historyDir, appendLog, maybeDump,
  resumeCommand, upsertStatusResume, sessionStatusPath, oneLine, mask, t, AGENT,
} from './common.mjs';

runHook(async () => {
  const env = hookEnv();
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const state = readState(data.session_id, env);
  if (!state || !state.anchor || !inScope(state.anchor, env)) return;
  const anchor = normalizeWinPath(state.anchor);
  const sid8 = String(data.session_id).slice(0, 8);
  const cmd = resumeCommand(data.session_id, AGENT);
  const reason = typeof data.reason === 'string' && data.reason.trim() ? oneLine(mask(data.reason), 40) : '';
  const L = t(env);

  appendLog(anchor, data, L.logExit(reason, cmd), env);
  if (cmd) {
    const changed = [
      upsertStatusResume(path.join(historyDir(anchor, env), 'STATUS.md'), sid8, cmd, env),
      upsertStatusResume(sessionStatusPath(anchor, sid8, env), sid8, cmd, env),
    ];
    if (changed.some(Boolean)) appendLog(anchor, data, L.logExitFixed, env);
  }
  maybeDump('SessionEnd', data, env);
});
