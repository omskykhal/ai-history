// UserPromptSubmit hook: log the prompt, detect a project mention, inject the STATUS-block instruction (+ Reader when a new project was named).
import {
  runHook, readInput, emit, resolveAnchor, isInteractive, statePaths, writeState, removeFile, appendLog,
  maybeDump, mask, oneLine, statusFormatFor, listHistoryProjects, listCandidateFolders, loadAliases, matchProjectMention, readerBody, READER_TOTAL_MAX,
  AGENT, historyDirName, lastWorkerLine, t,
} from './common.mjs';

runHook(async () => {
  const env = process.env;
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const L = t(env);
  const INSTRUCTION = L.promptInstruction(historyDirName(env), statusFormatFor(env));
  const raw = [data.prompt, data.user_prompt, data.message].find((v) => typeof v === 'string');
  const interactive = !data.agent_id && isInteractive(data, env);

  // Project named in the prompt: interactive main session with a real prompt only
  const hit = interactive && raw !== undefined ? matchProjectMention(raw, listHistoryProjects(env), listCandidateFolders(env), loadAliases(env)) : null;
  const r = resolveAnchor(data, env, { allowSwitch: !data.agent_id, mentioned: hit ? hit.dir : null, unrecorded: !!(hit && hit.recorded === false) });
  if (!r) return;

  if (r.state && !data.agent_id) {
    writeState(data.session_id, { ...r.state, agent: AGENT, promptAt: new Date().toISOString(), blockedAt: null }, env);
    removeFile(statePaths(data.session_id, env).tool);
  }

  const text = raw === undefined ? L.userUnknownField : oneLine(mask(oneLine(raw)), 120);
  appendLog(r.anchor, data, `[User] ${text}`, env);
  maybeDump('UserPromptSubmit', data, env);

  // non-interactive / sub-agent / no state → log only
  if (!r.state || !interactive) return;
  let ctx = INSTRUCTION;
  // Inject the Reader only when the named project became the anchor with this prompt (if it already was, instruction only)
  if (hit && r.anchor === hit.anchor && r.previous !== hit.anchor) {
    let reader = hit.recorded === false
      ? L.mentionUnrecorded(hit.name, hit.dir)
      : L.mentionRecorded(hit.name, hit.dir) + readerBody(hit.anchor, env);
    const lw = hit.recorded === false ? '' : lastWorkerLine(hit.anchor, env);
    if (lw) reader = `[auto-history] ${lw}\n${reader}`;
    if (reader.length > READER_TOTAL_MAX) reader = reader.slice(0, READER_TOTAL_MAX);
    ctx = `${reader}\n\n${INSTRUCTION}`;
  }
  emit({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } });
});
