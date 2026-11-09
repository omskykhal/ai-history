// UserPromptSubmit hook: log the prompt, detect a project mention, inject the STATUS-block instruction (+ Reader when a new project was named).
import {
  runHook, readInput, hookEnv, resolveAnchor, isInteractive, statePaths, writeState, removeFile, appendLog,
  maybeDump, mask, oneLine, statusFormatFor, listHistoryProjects, listCandidateFolders, loadAliases, matchProjectMention, readerBody, readerTotalMax,
  AGENT, historyDirName, lastWorkerLine, t, runRetention, retentionLogLine,
  trackerEligibility, trackerInstruction, trackerDbReadInstruction,
  hasArtifactTools, hasToolContext, emitPromptContext, readPending, writePending, kimiLateCapture,
  matchProjectPath, hasAnchorSource,
} from './common.mjs';

runHook(async () => {
  const env = hookEnv();
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const L = t(env);
  const INSTRUCTION = L.promptInstruction(historyDirName(env), statusFormatFor(env));
  const raw = [data.prompt, data.user_prompt, data.message].find((v) => typeof v === 'string');
  // Cursor submits a Stop follow-up as a user message. It is not a user request: no log line, no state reset.
  if (AGENT === 'cursor' && raw !== undefined && raw.startsWith('[auto-history]')) return;
  if (AGENT === 'kimi') kimiLateCapture(data, env); // handle the previous turn's corrected reply before the anchor can change
  const interactive = !data.agent_id && isInteractive(data, env);

  // Project named in the prompt: interactive main session with a real prompt only
  const folders = interactive && raw !== undefined ? listCandidateFolders(env) : null;
  let hit = folders ? matchProjectMention(raw, listHistoryProjects(env), folders, loadAliases(env)) : null;
  // No name in the prompt → look for a project path. The folder itself counts like a name; a path inside it only while the session has no anchor.
  if (!hit && folders) {
    const ph = matchProjectPath(raw, folders, env);
    if (ph && (ph.exact || !hasAnchorSource(data, env))) hit = ph;
  }
  const r = resolveAnchor(data, env, { allowSwitch: !data.agent_id, mentioned: hit ? hit.dir : null, unrecorded: !!(hit && hit.recorded === false) });
  if (!r) return;

  if (r.state && !data.agent_id) {
    writeState(data.session_id, { ...r.state, agent: AGENT, promptAt: new Date().toISOString(), blockedAt: null, trackerBlockedAt: null, publishAskedAt: null }, env);
    removeFile(statePaths(data.session_id, env).tool);
    removeFile(statePaths(data.session_id, env).tracker); // tracker marker has the same lifetime as .tool
  }

  const text = raw === undefined ? L.userUnknownField : oneLine(mask(oneLine(raw)), 120);
  appendLog(r.anchor, data, `[User] ${text}`, env);
  // the anchor changed with this prompt → retention for the new anchor (24h throttle)
  if (r.changed) { const rl = retentionLogLine(runRetention(r.anchor, env), env); if (rl) appendLog(r.anchor, data, rl, env); }
  maybeDump('UserPromptSubmit', data, env);

  // non-interactive / sub-agent / no state → log only
  if (!r.state || !interactive) return;
  // tracker instruction after the STATUS instruction (omitted when empty)
  const elig = trackerEligibility(r.anchor, env);
  const tIns = trackerInstruction(elig, elig.json, AGENT, r.anchor, env);
  const instruction = tIns ? `${INSTRUCTION}\n\n${tIns}` : INSTRUCTION;
  let mentionReader = '';
  // Inject the Reader only when the named project became the anchor with this prompt (if it already was, instruction only)
  if (hit && r.anchor === hit.anchor && r.previous !== hit.anchor) {
    const dbRead = hit.recorded === false || !hasArtifactTools() ? '' : trackerDbReadInstruction(hit.anchor, env);
    let reader = hit.recorded === false
      ? L.mentionUnrecorded(hit.name, hit.dir)
      : L.mentionRecorded(hit.name, hit.dir)
        + (dbRead ? `\n${dbRead}` : '') // read the tracker page db once (only when it has a url)
        + readerBody(hit.anchor, env, { sid8: String(data.session_id).slice(0, 8) });
    const lw = hit.recorded === false ? '' : lastWorkerLine(hit.anchor, env);
    if (lw) reader = `[auto-history] ${lw}\n${reader}`;
    if (reader.length > readerTotalMax(env)) reader = reader.slice(0, readerTotalMax(env));
    mentionReader = reader;
  }
  // History held from session start (Grok, Kimi) and the named project's history share one slot
  const held = readPending(data.session_id, env);
  const reader = mentionReader || (held && held.reader) || ''; // the anchor moved with this prompt → the old folder's record is dropped
  if (hasToolContext()) { // Grok, Cursor: prompt-time output does not reach the model → delivered after the first tool, or at Stop
    writePending(data.session_id, { reader, instruction }, env);
    return;
  }
  if (held) removeFile(statePaths(data.session_id, env).ctx);
  emitPromptContext(reader ? `${reader}\n\n${instruction}` : instruction);
});
