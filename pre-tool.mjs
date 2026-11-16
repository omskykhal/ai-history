// PreToolUse hook: log the tool call start.
import { runHook, readInput, hookEnv, resolveAnchor, anchorFromTool, appendLog, maybeDump, summarizeTool } from './common.mjs';

runHook(async () => {
  const env = hookEnv();
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const r = resolveAnchor(data, env) || anchorFromTool(data, env); // a session without a project gets the first project path it touches
  if (!r) return;
  appendLog(r.anchor, data, `▶ ${summarizeTool(data)}`, env);
  maybeDump('PreToolUse', data, env);
});
