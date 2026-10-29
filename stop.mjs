// Stop hook: extract the STATUS block from the last reply → STATUS.md; log the turn end; block once if the block is missing.
import fs from 'node:fs';
import path from 'node:path';
import {
  runHook, readInput, hookEnv, emit, resolveAnchor, isInteractive, statePaths, writeState, removeFile, appendLog,
  maybeDump, mask, oneLine, confFileExists, historyDir, writeAtomic, statusFormatFor, statusHeader, missingHeadings,
  agentConfName, t, sessionStatusPath, AGENT, ymd, hms,
  extractTracker, trackerEligibility, mergeTracker, writeTracker, emptyTracker, TRACKER_URL_RE, trackerFormatFor, trackerRulesFor, PUBLISH_INSTRUCTION,
  trackerMdPath,
} from './common.mjs';
import { writeTrackerHtml, writeTrackerMd, sha12 } from './tracker-build.mjs';
import { parseChecklistResults } from './tracker-md.mjs';

const BEGIN_RE = /^<!-- STATUS:BEGIN -->\r?$/;
const END_RE = /^<!-- STATUS:END -->\r?$/;
const FENCE_RE = /^\s*(```|~~~)/;
const BODY_MAX = 4000;

function readTail(file, bytes) {
  let fd = -1;
  try {
    if (!file || !fs.existsSync(file)) return '';
    const size = fs.statSync(file).size;
    if (!size) return '';
    const n = Math.min(bytes, size);
    const buf = Buffer.alloc(n);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, n, size - n);
    fs.closeSync(fd);
    fd = -1;
    return buf.toString('utf-8');
  } catch {
    if (fd !== -1) try { fs.closeSync(fd); } catch { /* ignore */ }
    return '';
  }
}

// last assistant text from the transcript tail (64 KB, best-effort)
function tailFromTranscript(file) {
  const lines = readTail(file, 64 * 1024).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const m = o && (o.message || o);
    const role = (m && m.role) || (o && o.type);
    if (role !== 'assistant') continue;
    const c = m.content;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) text = c.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n');
    if (text.trim()) return text;
  }
  return '';
}

function extractStatus(msg, env) {
  const lines = msg.replace(/\r\n/g, '\n').split('\n');
  let b = -1;
  for (let i = 0; i < lines.length; i++) if (BEGIN_RE.test(lines[i])) b = i;
  if (b < 0) return null;
  let e = -1;
  for (let i = b + 1; i < lines.length; i++) if (END_RE.test(lines[i])) { e = i; break; }
  if (e < 0) return null;
  const tail = lines.slice(e + 1).filter((l) => l.trim() && !FENCE_RE.test(l));
  const tailChars = tail.reduce((a, l) => a + l.length, 0);
  if (tail.length > 3 || tailChars > 200) return null;
  let body = lines.slice(b + 1, e).filter((l) => !FENCE_RE.test(l)).join('\n').trim();
  if (body.length > BODY_MAX) body = body.slice(0, BODY_MAX);
  body = mask(body);
  const missing = missingHeadings(body, env);
  const rest = lines.slice(0, b).concat(lines.slice(e + 1)).join('\n');
  return { body, missing, tailAllowed: tail.length > 0, rest };
}

// Safety exceptions (same set as OMC persistent-mode): never block on these
function normReasons(data, keys) {
  return keys.map((k) => data[k]).filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.toLowerCase().replace(/[\s-]+/g, '_'));
}
function isContextLimitStop(data) {
  const pats = ['context_limit', 'context_window', 'context_exceeded', 'context_full', 'max_context', 'token_limit',
    'max_tokens', 'conversation_too_long', 'input_too_long'];
  return normReasons(data, ['stop_reason', 'stopReason', 'end_turn_reason', 'endTurnReason', 'reason'])
    .some((r) => pats.some((p) => r.includes(p)));
}
function estimateContextPercent(file) {
  const content = readTail(file, 4096);
  if (!content) return 0;
  const w = content.match(/"context_window"\s{0,5}:\s{0,5}(\d+)/g);
  const inp = content.match(/"input_tokens"\s{0,5}:\s{0,5}(\d+)/g);
  if (!w || !inp) return 0;
  const lw = parseInt(w[w.length - 1].match(/(\d+)/)[1], 10);
  const li = parseInt(inp[inp.length - 1].match(/(\d+)/)[1], 10);
  if (!Number.isFinite(lw) || lw <= 0 || !Number.isFinite(li)) return 0;
  return Math.round((li / lw) * 100);
}
function isUserAbort(data) {
  if (data.user_requested || data.userRequested) return true;
  const r = String(data.stop_reason || data.stopReason || '').toLowerCase();
  return ['aborted', 'abort', 'cancel', 'interrupt'].some((p) => r === p)
    || ['user_cancel', 'user_interrupt', 'ctrl_c', 'manual_stop'].some((p) => r.includes(p));
}
function isAuthenticationError(data) {
  const pats = ['authentication_error', 'authentication_failed', 'auth_error', 'unauthorized', 'unauthorised', '401', '403',
    'forbidden', 'invalid_token', 'token_invalid', 'token_expired', 'expired_token', 'oauth_expired',
    'oauth_token_expired', 'invalid_grant', 'insufficient_scope'];
  const r = String(data.stop_reason || data.stopReason || '').toLowerCase();
  const x = String(data.end_turn_reason || data.endTurnReason || '').toLowerCase();
  return pats.some((p) => r.includes(p) || x.includes(p));
}
function isScheduledWakeupStop(data) {
  const pats = ['schedulewakeup', 'schedule_wakeup', 'scheduled_wakeup', 'scheduled_task', 'scheduled_resume',
    'loop_resume', 'loop_wakeup'];
  const tool = String(data.tool_name || data.toolName || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (pats.some((p) => tool.includes(p))) return true;
  return normReasons(data, ['stop_reason', 'stopReason', 'end_turn_reason', 'endTurnReason', 'reason'])
    .some((r) => pats.some((p) => r.includes(p)));
}
function isSafetyException(data) {
  return isContextLimitStop(data)
    || estimateContextPercent(data.transcript_path || data.transcriptPath || '') >= 95
    || isUserAbort(data) || isAuthenticationError(data) || isScheduledWakeupStop(data);
}

runHook(async () => {
  const env = hookEnv();
  if (env.AUTO_HISTORY_DISABLE === '1') return;
  const data = await readInput();
  if (!data || !data.session_id) return;
  const r = resolveAnchor(data, env);
  if (!r) return;
  const { anchor, state } = r;
  const sid8 = String(data.session_id).slice(0, 8);
  const L = t(env);

  let msg = typeof data.last_assistant_message === 'string' ? data.last_assistant_message : '';
  if (!msg) msg = tailFromTranscript(data.transcript_path);

  const st = msg ? extractStatus(msg, env) : null;
  // TRACKER block (last BEGIN~END). The [Turn-end] summary leaves it out.
  const tr = msg ? extractTracker(msg) : { json: null, error: null, rest: '', found: false };
  const noTracker = (s) => (tr.found ? extractTracker(s).rest : s);
  if (st) {
    if (st.tailAllowed) appendLog(anchor, data, L.logTailAllowed, env);
    if (st.missing.length) appendLog(anchor, data, L.logIncomplete(st.missing.join(', ')), env);
    try {
      fs.mkdirSync(historyDir(anchor, env), { recursive: true });
      const content = `${statusHeader(data.session_id, anchor, env)}\n${st.body}\n`;
      writeAtomic(path.join(historyDir(anchor, env), 'STATUS.md'), content);
      // per-session copy (several sessions in one folder): sessions/<agent>-<id8>.md
      const sp17 = sessionStatusPath(anchor, sid8, env);
      fs.mkdirSync(path.dirname(sp17), { recursive: true });
      writeAtomic(sp17, content);
    } catch { /* fail-open */ }
    appendLog(anchor, data, L.logTurnEndStatus(oneLine(mask(oneLine(noTracker(st.rest))), 300)), env);
  } else if (!msg.trim()) {
    appendLog(anchor, data, L.logTurnEndNoMsg, env);
  } else {
    appendLog(anchor, data, `[Turn-end] ${oneLine(mask(oneLine(noTracker(msg))), 300)}`, env);
  }
  maybeDump('Stop', data, env);

  // Tracker merge (main session only). Log lines are masked, TRACKER.json content is not.
  let urlSaved = false;
  if (!data.agent_id) {
    try {
      urlSaved = processTracker(anchor, data, tr, env, sid8);
    } catch (e) { appendLog(anchor, data, L.logTrackerError(oneLine(mask(String(e && e.message)), 120)), env); }
  }

  const sp = statePaths(data.session_id, env);
  const hasTool = fs.existsSync(sp.tool);
  // A TRACKER block (even a broken one) satisfies this turn's request → drop the marker (PostToolUse re-arms it on later changes)
  if (tr.found && !data.agent_id) removeFile(sp.tracker);
  const hasTrackerMarker = fs.existsSync(sp.tracker);
  // Block decision: the STATUS nudge, the TRACKER block request and the publish request share one block per turn
  const canBlock = () => state && !data.agent_id
    && data.stop_hook_active !== true
    && !confFileExists(agentConfName('NO_BLOCK'), env)
    && env.AUTO_HISTORY_NO_BLOCK !== '1'
    && isInteractive(data, env)
    && !isSafetyException(data);
  const needStatus = !!(!st && state && hasTool && state.blockedAt == null);
  if (state && !data.agent_id) {
    const elig = trackerEligibility(anchor, env);
    const on = elig.mode === 'on' || elig.mode === 'new';
    const needTrackerBlock = on && hasTrackerMarker && !tr.found && state.trackerBlockedAt == null;
    const needPublish = elig.mode === 'on' && !!(elig.json && elig.json.pending) && AGENT === 'claude'
      && state.publishAskedAt == null && !urlSaved;
    if ((needStatus || needTrackerBlock || needPublish) && canBlock()) {
      const now = new Date().toISOString();
      const parts = [];
      if (needStatus) parts.push(L.blockReason(statusFormatFor(env)));
      if (needTrackerBlock) parts.push(L.trackerBlockReason(needStatus, trackerFormatFor(env), trackerRulesFor(env)));
      if (needPublish) parts.push(PUBLISH_INSTRUCTION(anchor, elig.json, env));
      writeState(data.session_id, {
        ...state,
        blockedAt: needStatus ? now : (state.blockedAt ?? null),
        trackerBlockedAt: needTrackerBlock ? now : (state.trackerBlockedAt ?? null),
        publishAskedAt: needPublish ? now : (state.publishAskedAt ?? null),
      }, env);
      if (needTrackerBlock) appendLog(anchor, data, L.logTrackerBlockAsk, env);
      if (needPublish) appendLog(anchor, data, L.logTrackerPublishAsk, env);
      emit({ decision: 'block', reason: parts.join('\n\n') });
      return;
    }
  }
  // end of marker lifetime (trackerBlockedAt / publishAskedAt are reset on the next prompt)
  if (state && !data.agent_id) {
    removeFile(sp.tool);
    removeFile(sp.tracker);
    if (state.blockedAt != null) writeState(data.session_id, { ...state, blockedAt: null }, env);
  }
});

// md step: when CHECKLIST.md differs from what the hook wrote (edited) and this content was not handled yet,
// parse its results section → merge ai (by codex). Returns null = nothing to do / { json, changed } (json carries mdSeenHash).
function mdStage(anchor, data, json, env, now) {
  const L = t(env);
  const file = trackerMdPath(anchor, env);
  let text;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return null; }
  const h = sha12(text);
  if (h === json.mdHash || h === json.mdSeenHash) return null;
  let j = JSON.parse(JSON.stringify(json));
  j.mdSeenHash = h;
  const p = parseChecklistResults(text, j);
  if (p.error) {
    appendLog(anchor, data, L.logMdParseError, env);
    try { // keep the edited copy (never overwrite or delete)
      const d = new Date();
      const base = path.join(path.dirname(file), `CHECKLIST.edited-${ymd(d).replace(/-/g, '')}-${hms(d).replace(/:/g, '')}`);
      let out = `${base}.md`;
      for (let i = 2; fs.existsSync(out); i++) out = `${base}-${i}.md`;
      fs.copyFileSync(file, out, fs.constants.COPYFILE_EXCL);
    } catch { /* fail-open */ }
    return { json: j, changed: false };
  }
  if (!p.count) return { json: j, changed: false };
  const m = mergeTracker(j, p.block, { by: 'codex-md', now });
  j = m.json;
  appendLog(anchor, data, L.logMdMerged(p.count, p.ignored), env);
  return { json: j, changed: m.changed };
}

// md results → turn block, merged one after the other, then TRACKER.json written once and HTML / md built once.
// Returns true when this block saved a published url. The md step runs first, whether or not there is a block or a JSON error
// (not for off / legacy / global TRACKER_OFF).
function processTracker(anchor, data, tr, env, sid8) {
  const L = t(env);
  const elig = trackerEligibility(anchor, env);
  const now = new Date().toISOString();
  let j = null; // working copy for this Stop (null = nothing to write)
  let changed = false;
  let userOnly = false;
  if (elig.mode === 'on' && elig.json) {
    const md = mdStage(anchor, data, elig.json, env, now);
    if (md) { j = md.json; changed = md.changed; }
  }
  let urlSaved = false;
  if (tr && tr.found) {
    if (tr.error) appendLog(anchor, data, L.logTrackerJsonError, env);
    else {
      const block = tr.json;
      if (elig.reason === 'TRACKER_OFF') { appendLog(anchor, data, L.logTrackerIgnored, env); return false; }
      if (block.mode === 'off') {
        const o = j || elig.json || emptyTracker(now);
        o.mode = 'off';
        o.updatedAt = now;
        writeTracker(anchor, o, env);
        appendLog(anchor, data, L.logTrackerOff, env);
        return false;
      }
      if ((elig.mode === 'off' || elig.mode === 'legacy') && block.mode !== 'on') {
        appendLog(anchor, data, L.logTrackerIgnored, env);
        return false;
      }
      const m = mergeTracker(j || elig.json, block, { by: `${AGENT}-${sid8}`, now });
      j = m.json;
      j.mode = 'on';
      changed = changed || m.changed;
      userOnly = m.userOnly;
      const url = typeof block.url === 'string' ? block.url.trim() : '';
      if (url && TRACKER_URL_RE.test(url)) urlSaved = true;
      if (m.changed || m.userOnly) appendLog(anchor, data, L.logTrackerItems(m.added, m.updated, m.removed, m.userOnly), env);
    }
  }
  if (!j) return false;
  // Build policy: content changed → HTML + md + pending / user verdicts only → md only (HTML unchanged, no pending) / no template → md still written
  if (changed) {
    const hash = writeTrackerHtml(anchor, j, env);
    if (hash) { j.htmlHash = hash; j.pending = true; }
  }
  if (changed || userOnly) {
    const mh = writeTrackerMd(anchor, j, env);
    if (mh) j.mdHash = mh;
  }
  if (urlSaved) {
    // What was published is the HTML from before this Stop's rebuild. If md results rebuilt it in this Stop, pending stays (next publish request)
    const pubHash = (elig.json && elig.json.htmlHash) || j.htmlHash || null;
    j.url = tr.json.url.trim();
    j.publishedAt = now;
    j.publishedHash = pubHash;
    j.pending = !!j.htmlHash && j.htmlHash !== pubHash;
  }
  writeTracker(anchor, j, env);
  if (urlSaved) appendLog(anchor, data, L.logTrackerUrl, env);
  return urlSaved;
}
