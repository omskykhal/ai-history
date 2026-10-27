// PostToolUse hook: log the tool call end (+duration) and arm the "tools were used" marker for the Stop hook.
import {
  runHook, readInput, resolveAnchor, appendLog, maybeDump, summarizeTool, statePaths, touchFile, isTrackerChangeTool,
} from './common.mjs';

runHook(async () => {
  const env = process.env;
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const r = resolveAnchor(data, env);
  if (!r) return;
  const ms = Number(data.duration_ms);
  const dur = Number.isFinite(ms) && ms >= 0 ? ` (${(ms / 1000).toFixed(1)}s)` : '';
  appendLog(r.anchor, data, `✓ ${summarizeTool(data)}${dur}`, env);
  if (r.state && !data.agent_id) touchFile(statePaths(data.session_id, env).tool);
  // tracker change marker (main session; edit under the anchor, or a build / create command)
  if (r.state && !data.agent_id && isTrackerChangeTool(data, r.anchor, env)) touchFile(statePaths(data.session_id, env).tracker);
  maybeDump('PostToolUse', data, env);
});
