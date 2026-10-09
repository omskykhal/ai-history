// Stop hook: extract the STATUS block from the last reply → STATUS.md; log the turn end; block once if the block is missing.
import fs from 'node:fs';
import path from 'node:path';
import {
  runHook, readInput, emit, resolveAnchor, isInteractive, statePaths, writeState, removeFile, appendLog,
  maybeDump, mask, oneLine, confFileExists, historyDir, writeAtomic, statusFormatFor, statusHeader, missingHeadings,
  agentConfName, t,
} from './common.mjs';

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
  const env = process.env;
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
  if (st) {
    if (st.tailAllowed) appendLog(anchor, data, L.logTailAllowed, env);
    if (st.missing.length) appendLog(anchor, data, L.logIncomplete(st.missing.join(', ')), env);
    try {
      fs.mkdirSync(historyDir(anchor, env), { recursive: true });
      writeAtomic(path.join(historyDir(anchor, env), 'STATUS.md'), `${statusHeader(sid8, anchor, env)}\n${st.body}\n`);
    } catch { /* fail-open */ }
    appendLog(anchor, data, L.logTurnEndStatus(oneLine(mask(oneLine(st.rest)), 300)), env);
  } else if (!msg.trim()) {
    appendLog(anchor, data, L.logTurnEndNoMsg, env);
  } else {
    appendLog(anchor, data, `[Turn-end] ${oneLine(mask(oneLine(msg)), 300)}`, env);
  }
  maybeDump('Stop', data, env);

  const sp = statePaths(data.session_id, env);
  const hasTool = fs.existsSync(sp.tool);
  const shouldBlock = !st
    && state && !data.agent_id
    && hasTool
    && state.blockedAt == null
    && data.stop_hook_active !== true
    && !confFileExists(agentConfName('NO_BLOCK'), env)
    && env.AUTO_HISTORY_NO_BLOCK !== '1'
    && isInteractive(data, env)
    && !isSafetyException(data);

  if (shouldBlock) {
    writeState(data.session_id, { ...state, blockedAt: new Date().toISOString() }, env);
    emit({ decision: 'block', reason: L.blockReason(statusFormatFor(env)) });
    return;
  }
  // end of marker lifetime
  if (state && !data.agent_id) {
    removeFile(sp.tool);
    if (state.blockedAt != null) writeState(data.session_id, { ...state, blockedAt: null }, env);
  }
});
