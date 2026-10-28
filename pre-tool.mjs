// PreToolUse hook: log the tool call start.
import { runHook, readInput, hookEnv, resolveAnchor, appendLog, maybeDump, summarizeTool } from './common.mjs';

runHook(async () => {
  const env = hookEnv();
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const r = resolveAnchor(data, env);
  if (!r) return;
  appendLog(r.anchor, data, `▶ ${summarizeTool(data)}`, env);
  maybeDump('PreToolUse', data, env);
});
