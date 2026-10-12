// ai-history — shared module for all hooks. No external dependencies.
// Origin: auto-history (plan v4.1 §4.2, change 2 §14, §15 multi-agent), generalized for distribution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getLang, T, statusFormat, ALL_HEADINGS, AUTHOR_KEYS, UPDATED_KEYS, SESSION_KEYS, KW_PROJECT, KW_FOLDER } from './i18n.mjs';

export const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
export const IS_WIN = process.platform === 'win32';
export const VALID_SOURCES = ['startup', 'resume', 'clear', 'fork'];
export const DEFAULT_DIRNAME = '.ai-history';
// Fallback project root when neither AUTO_HISTORY_ROOT nor the ROOT conf file is set.
export const DEFAULT_ROOT = path.join(os.homedir(), 'Projects');

// §15.2 agent tag: CLI argument `--agent <name>` (default claude). 1-32 chars of [A-Za-z0-9_-]; anything else → claude.
export function parseAgent(argv = process.argv) {
  try {
    const i = argv.indexOf('--agent');
    const v = i >= 0 ? String(argv[i + 1] || '') : '';
    return /^[A-Za-z0-9_-]{1,32}$/.test(v) ? v.toLowerCase() : 'claude';
  } catch {
    return 'claude';
  }
}
export const AGENT = parseAgent();

// Overrides (tests / plugin mode): AUTO_HISTORY_STATE_DIR (state), AUTO_HISTORY_CONF_DIR (conf files, dumps).
// In Claude Code plugin mode CLAUDE_PLUGIN_DATA survives plugin updates, so it is preferred over the plugin dir.
export function getConfDir(env = process.env) {
  return env.AUTO_HISTORY_CONF_DIR || env.CLAUDE_PLUGIN_DATA || HOOK_DIR;
}
export function getStateDir(env = process.env) {
  return env.AUTO_HISTORY_STATE_DIR || path.join(getConfDir(env), 'state');
}

function readListFile(file) {
  try {
    return fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return null;
  }
}

// Project root (the boundary): AUTO_HISTORY_ROOT env > first line of <ConfDir>/ROOT > ~/Projects.
export function getRoot(env = process.env) {
  if (env.AUTO_HISTORY_ROOT) return env.AUTO_HISTORY_ROOT;
  const lines = readListFile(path.join(getConfDir(env), 'ROOT'));
  if (lines && lines[0]) return lines[0];
  return DEFAULT_ROOT;
}

// Language of injected instructions / STATUS headings: AUTO_HISTORY_LANG > <ConfDir>/LANG > en
export function lang(env = process.env) { return getLang(env, getConfDir(env)); }
export function t(env = process.env) { return T(lang(env)); }
export function statusFormatFor(env = process.env) { return statusFormat(lang(env)); }
export const STATUS_FORMAT = statusFormatFor();

export function warn(msg) {
  try { process.stderr.write(`[auto-history] ${String(msg).split(/\r?\n/)[0]}\n`); } catch { /* ignore */ }
}

// stdin with timeout
export function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      try { process.stdin.removeAllListeners(); process.stdin.destroy(); } catch { /* ignore */ }
      done(Buffer.concat(chunks).toString('utf-8'));
    }, timeoutMs);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => done(''));
    if (process.stdin.readableEnded) done(Buffer.concat(chunks).toString('utf-8'));
  });
}

export async function readInput() {
  const raw = await readStdin(2000);
  if (!raw || !raw.trim()) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// Top-level runner: exit 0 on any error (fail-open)
export function runHook(main) {
  process.on('uncaughtException', (e) => { warn(e && e.message); process.exitCode = 0; });
  process.on('unhandledRejection', (e) => { warn(e && e.message); process.exitCode = 0; });
  Promise.resolve()
    .then(main)
    .catch((e) => warn(e && e.message))
    .finally(() => { process.exitCode = 0; });
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// Path normalization.
// Windows: //c/… · /c/… · C:/… → c:\…, strip \\?\, lower-case, strip trailing \. UNC stays \\ (out of scope).
// POSIX (macOS/Linux, untested): posix-normalize, strip trailing /, case preserved.
export function normalizeWinPath(p) {
  if (typeof p !== 'string') return '';
  let s = p.trim();
  if (!s) return '';
  if (!IS_WIN) {
    s = path.posix.normalize(s);
    while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  }
  s = s.replace(/\//g, '\\');
  if (s.startsWith('\\\\?\\')) {
    s = s.slice(4);
    if (/^unc\\/i.test(s)) s = '\\\\' + s.slice(4);
  }
  let m = s.match(/^\\\\([a-zA-Z])(\\.*)?$/); // //c/... (msys)
  if (m) s = `${m[1]}:${m[2] || '\\'}`;
  else {
    m = s.match(/^\\([a-zA-Z])(\\.*)?$/); // /c/... (msys)
    if (m) s = `${m[1]}:${m[2] || '\\'}`;
  }
  if (/^[a-zA-Z]:/.test(s)) {
    s = path.win32.normalize(s);
  } else if (s.startsWith('\\\\')) {
    s = '\\\\' + s.slice(2).replace(/\\+/g, '\\');
  }
  s = s.toLowerCase();
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}
export const normalizePath = normalizeWinPath;
const SEP = IS_WIN ? '\\' : '/';
const isAbsNorm = (n) => (IS_WIN ? /^[a-z]:\\/.test(n) : n.startsWith('/'));

export function inScope(p, env = process.env) {
  const n = normalizeWinPath(p);
  const root = normalizeWinPath(getRoot(env));
  if (!n || !root || !isAbsNorm(n)) return false;
  return n.startsWith(root + SEP) && n.length > root.length + 1;
}

const MASKS = [
  /AIza[0-9A-Za-z_\-]{30,}/g,
  /sk-[A-Za-z0-9_\-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /Bearer\s+\S+/g,
  /(password|passwd|secret|token)\s*[=:]\s*\S+/gi,
];
export function mask(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const re of MASKS) out = out.replace(re, '***');
  return out;
}
export function maskDeep(v) {
  if (typeof v === 'string') return mask(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = maskDeep(val);
    return o;
  }
  return v;
}

function nestedMarkerHit(file, env) {
  const markers = readListFile(path.join(getConfDir(env), file));
  if (!markers) return false;
  for (const line of markers) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (env[name] !== undefined && env[name] === val) return true;
  }
  return false;
}

// Interactive-session test (all conditions must hold). §15.4: agent=codex has its own rule.
export function isInteractive(data, env = process.env, agent = AGENT) {
  if (env.AUTO_HISTORY_DISABLE === '1') return false;
  if (agent === 'codex') {
    // codex spawned inside a Claude Code session → non-interactive (log only)
    if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT !== undefined) return false;
    return !nestedMarkerHit('NESTED_MARKERS_CODEX', env);
  }
  const ep = env.CLAUDE_CODE_ENTRYPOINT || '';
  if (!ep) return false;
  if (ep === 'session-summary' || /sdk/i.test(ep)) return false;
  const list = readListFile(path.join(getConfDir(env), 'INTERACTIVE_ENTRYPOINTS')) || ['cli'];
  if (!list.includes(ep)) return false;
  const envSid = env.CLAUDE_CODE_SESSION_ID;
  if (envSid && envSid !== String((data && data.session_id) || '')) return false;
  return !nestedMarkerHit('NESTED_MARKERS', env);
}

// §15.4: per-agent conf file names (codex → <NAME>_CODEX, separate from the Claude flags)
export function agentConfName(name, agent = AGENT) {
  return agent === 'codex' ? `${name}_CODEX` : name;
}

export function confFileExists(name, env = process.env) {
  try { return fs.existsSync(path.join(getConfDir(env), name)); } catch { return false; }
}

function safeSid(sid) {
  return String(sid || '').replace(/[^A-Za-z0-9_\-]/g, '_');
}
export function statePaths(sid, env = process.env) {
  const dir = getStateDir(env);
  const s = safeSid(sid);
  return { dir, json: path.join(dir, `${s}.json`), tool: path.join(dir, `${s}.tool`) };
}
export function readState(sid, env = process.env) {
  if (!sid) return null;
  try {
    const st = JSON.parse(fs.readFileSync(statePaths(sid, env).json, 'utf-8'));
    return st && typeof st === 'object' ? st : null;
  } catch {
    return null;
  }
}
export function writeState(sid, st, env = process.env) {
  const p = statePaths(sid, env);
  fs.mkdirSync(p.dir, { recursive: true });
  writeAtomic(p.json, JSON.stringify(st));
}
export function removeFile(f) {
  try { fs.unlinkSync(f); } catch { /* ignore */ }
}
export function touchFile(f) {
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '');
  } catch (e) { warn(e.message); }
}

export function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.renameSync(tmp, file); // one retry
    }
  } catch (e) {
    removeFile(tmp);
    warn(`write failed: ${e.message}`);
  }
}

// Anchor (the folder that receives the history). First rule that holds wins:
//  1) opts.mentioned (project named in the prompt; only when allowSwitch)
//  2) candidate (opts.candidate, default data.cwd) is in scope AND cwd really changed AND not under the old anchor (only when allowSwitch)
//  3) keep the anchor from the state file  4) no state && candidate in scope → adopt + create state  5) else null.
// With agent_id (sub-agent) only the state-file anchor is used (no change, no creation).
export function isUnder(child, parent) {
  const c = normalizeWinPath(child);
  const p = normalizeWinPath(parent);
  return !!c && !!p && (c === p || c.startsWith(p + SEP));
}

export function resolveAnchor(data, env = process.env, opts = {}) {
  const allowSwitch = opts.allowSwitch === true;
  const state = readState(data.session_id, env);
  const old = state && state.anchor && inScope(state.anchor, env) ? normalizeWinPath(state.anchor) : null;
  if (data.agent_id) return old ? { anchor: old, state, previous: old, changed: false } : null;

  const candRaw = opts.candidate !== undefined ? opts.candidate : data.cwd;
  const cand = candRaw && inScope(candRaw, env) ? normalizeWinPath(candRaw) : null;
  const ment = allowSwitch && opts.mentioned && inScope(opts.mentioned, env) ? normalizeWinPath(opts.mentioned) : null;

  // lastCwd: the cwd rule applies only when the normalized cwd differs from the stored lastCwd (a real change).
  const nowCwd = candRaw ? normalizeWinPath(candRaw) : null;
  const cwdChanged = !state || state.lastCwd !== nowCwd;

  let next = old;
  let reason = 'keep';
  if (ment) { next = ment; reason = 'mention'; }
  else if (allowSwitch && cwdChanged && cand && !(old && isUnder(cand, old))) { next = cand; reason = 'cwd'; }
  else if (!old && cand) { next = cand; reason = 'cwd'; }
  if (!next) return null;
  const track = allowSwitch && nowCwd ? { lastCwd: nowCwd } : (state && state.lastCwd ? { lastCwd: state.lastCwd } : {});
  if (next === old) {
    if (state && allowSwitch && nowCwd && state.lastCwd !== nowCwd) {
      const st0 = { ...state, ...track };
      try { writeState(data.session_id, st0, env); } catch (e) { warn(e.message); }
      return { anchor: old, state: st0, previous: old, changed: false };
    }
    return { anchor: old, state, previous: old, changed: false };
  }

  const st = {
    anchor: next,
    promptAt: (state && state.promptAt) || null,
    blockedAt: (state && state.blockedAt) || null,
    createdAt: (state && state.createdAt) || new Date().toISOString(),
    agent: AGENT,
    ...track,
  };
  try { writeState(data.session_id, st, env); } catch (e) { warn(e.message); }
  const L = t(env);
  if (old && !(reason === 'mention' && opts.unrecorded)) appendLog(next, data, L.logAnchorChange(old, next), env);
  else if (reason === 'mention') appendLog(next, data, L.logAnchorSet(next), env);
  return { anchor: next, state: st, previous: old, changed: true };
}

// Projects with history: depth-1 and depth-2 folders under the root that contain <history dir>/STATUS.md.
// Dot-folders and node_modules are skipped. [] on any error.
export function listHistoryProjects(env = process.env) {
  const out = [];
  try {
    const root = getRoot(env);
    const skip = (n) => n.startsWith('.') || n.toLowerCase() === 'node_modules';
    const dirs = (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip(d.name)).map((d) => d.name);
      } catch {
        return [];
      }
    };
    const check = (name, dir, depth) => {
      try {
        if (fs.existsSync(path.join(historyDir(dir, env), 'STATUS.md'))) out.push({ name, dir, anchor: normalizeWinPath(dir), depth });
      } catch { /* ignore */ }
    };
    for (const n1 of dirs(root)) {
      const d1 = path.join(root, n1);
      check(n1, d1, 1);
      for (const n2 of dirs(d1)) check(n2, path.join(d1, n2), 2);
    }
  } catch {
    return [];
  }
  return out;
}

// Candidate folders: every depth-1 folder + depth-2 folders (dot-folders, node_modules, __t skipped).
// recorded = whether <history dir>/STATUS.md exists (affects only the injected wording). [] on any error.
const hasStatus = (dir, env = process.env) => { try { return fs.existsSync(path.join(historyDir(dir, env), 'STATUS.md')); } catch { return false; } };
export function listCandidateFolders(env = process.env) {
  const out = [];
  try {
    const root = getRoot(env);
    const skip = (n) => n.startsWith('.') || n.toLowerCase() === 'node_modules' || n === '__t';
    const dirs = (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip(d.name)).map((d) => d.name);
      } catch {
        return [];
      }
    };
    for (const n1 of dirs(root)) {
      const d1 = path.join(root, n1);
      out.push({ name: n1, dir: d1, anchor: normalizeWinPath(d1), depth: 1, recorded: hasStatus(d1, env) });
      for (const n2 of dirs(d1)) {
        const d2 = path.join(d1, n2);
        out.push({ name: n2, dir: d2, anchor: normalizeWinPath(d2), depth: 2, recorded: hasStatus(d2, env) });
      }
    }
  } catch {
    return [];
  }
  return out;
}

const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOISE_RE = /^\s*<(agent-message|task-notification|system)/i;

// Alias table: <ConfDir>/ALIASES, one line per target: `phrase1|phrase2 => relative\path\under\root`, # comments allowed.
// Bad lines and missing folders are silently ignored (fail-open). Returns [{phrase, dir, name, depth, recorded}]
export function loadAliases(env = process.env) {
  const out = [];
  try {
    const root = getRoot(env);
    const lines = fs.readFileSync(path.join(getConfDir(env), 'ALIASES'), 'utf-8').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (const raw of lines) {
      try {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('=>');
        if (i <= 0) continue;
        const rel = line.slice(i + 2).trim();
        if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) continue;
        const dir = path.join(root, rel);
        if (!fs.statSync(dir).isDirectory()) continue;
        const depth = rel.split(/[\\/]/).filter(Boolean).length;
        const target = { dir, name: path.basename(dir), depth, recorded: hasStatus(dir, env) };
        for (const ph of line.slice(0, i).split('|').map((x) => x.trim()).filter(Boolean)) out.push({ phrase: ph, ...target });
      } catch { /* skip line */ }
    }
  } catch {
    return [];
  }
  return out;
}

// Alias matching: separators [\s.\-]+ (one or more of space/dot/hyphen; underscore or nothing is NOT accepted) or the phrase verbatim.
// Case-insensitive. Word boundary before and after ([A-Za-z0-9_가-힣]); phrases containing Hangul may be followed by Hangul (particles).
// Longest phrase first. Returns { hit, len } | null
const ALIAS_WORD = 'A-Za-z0-9_가-힣';
function matchAlias(prompt, aliases) {
  const sorted = aliases.slice().sort((a, b) => b.phrase.length - a.phrase.length);
  for (const al of sorted) {
    try {
      const toks = al.phrase.split(/[\s._-]+/).filter(Boolean);
      if (!toks.length) continue;
      const body = `(?:${escRe(al.phrase)}|${toks.map(escRe).join('[\\s.\\-]+')})`;
      const hangul = HANGUL_RE.test(al.phrase);
      const re = new RegExp(`(?<![${ALIAS_WORD}])${body}${hangul ? '' : `(?![${ALIAS_WORD}])`}`, 'i');
      const m = re.exec(prompt);
      if (m) return { hit: { name: al.name, dir: al.dir, anchor: normalizeWinPath(al.dir), depth: al.depth, recorded: al.recorded }, len: m[0].length };
    } catch { /* ignore */ }
  }
  return null;
}

// Folder matching (recorded or not): "<name> project|folder" or "project|folder <name>" in any supported language.
// Depth-2 folders match with "project" only. Latin keywords require letter boundaries.
const kwAlt = (words) => words.map((w) => (HANGUL_RE.test(w) ? escRe(w) : `(?<![A-Za-z])${escRe(w)}(?![A-Za-z])`)).join('|');
const KW_P = `(?:${kwAlt(KW_PROJECT)})`;
const KW_PF = `(?:${kwAlt([...KW_PROJECT, ...KW_FOLDER])})`;
function matchFolder(prompt, folders) {
  const sorted = folders.filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .slice().sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    const kw = p.depth === 2 ? KW_P : KW_PF;
    const hangul = HANGUL_RE.test(p.name);
    const n = escRe(p.name);
    const pre = hangul ? '' : '(?<![A-Za-z0-9])';
    const post = hangul ? '' : '(?![A-Za-z0-9])';
    if (new RegExp(`${pre}${n}${post}\\s*${kw}`, 'i').test(prompt)
      || new RegExp(`${kw}\\s*${pre}${n}${post}`, 'i').test(prompt)) return p;
  }
  return null;
}

// Prompt → project mention: alias (longest first) vs folder (needs the project/folder keyword); the longer match wins (tie → alias).
// Prompts starting with <agent-message / <task-notification / <system are ignored.
// Matching uses a sanitized copy: pasted blocks, system lines and everything after them, code fences/spans, URLs and file paths removed; first 400 chars only.
export const MENTION_SCAN_MAX = 400;
export function sanitizeForMention(prompt) {
  let s = String(prompt);
  s = s.replace(/<pasted_content[\s\S]*?(?:<\/pasted_content>|$)/gi, ' ');
  const noise = /^[ \t]*<(?:agent-message|task-notification|system)/im.exec(s);
  if (noise) s = s.slice(0, noise.index);
  s = s.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  s = s.replace(/https?:\/\/\S+/gi, ' ').replace(/www\.\S+/gi, ' ');
  s = s.replace(/[A-Za-z]:[\\/][^\s"'<>|]*/g, ' ').replace(/\\\\\S+/g, ' ');
  s = s.replace(/\S*\/\S*\/\S*/g, ' ');
  return s.slice(0, MENTION_SCAN_MAX);
}

export function matchProjectMention(prompt0, projects, folders, aliases) {
  if (typeof prompt0 !== 'string' || !prompt0.trim() || NOISE_RE.test(prompt0)) return null;
  const prompt = sanitizeForMention(prompt0);
  if (!prompt.trim()) return null;
  const al = Array.isArray(aliases) && aliases.length ? matchAlias(prompt, aliases) : null;
  const list = Array.isArray(folders) ? folders : (Array.isArray(projects) ? projects.map((p) => ({ ...p, recorded: true })) : []);
  const fo = matchFolder(prompt, list);
  if (al && fo) return fo.name.length > al.len ? fo : al.hit;
  return al ? al.hit : fo;
}

// Reader body: STATUS.md (≤4,000 chars) + other sessions' STATUS (last 48h, newest 2, ≤1,000 chars each) + today's tail 40 lines + yesterday's tail 20 lines
export const READER_TOTAL_MAX = 10000;
const READER_STATUS_MAX = 4000;
export function readerBody(anchor, env = process.env, opts = {}) {
  const L = t(env);
  const hdir = historyDir(anchor, env);
  let status = '';
  try { status = fs.readFileSync(path.join(hdir, 'STATUS.md'), 'utf-8').replace(/\r\n/g, '\n'); } catch { /* none */ }
  if (status.length > READER_STATUS_MAX) status = status.slice(0, READER_STATUS_MAX) + '\n' + L.truncated;
  const today = new Date();
  const yday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const tToday = tailLines(path.join(hdir, `${ymd(today)}.md`), 40);
  const tYday = tailLines(path.join(hdir, `${ymd(yday)}.md`), 20);
  return `\n\n${L.readerStatus}\n${status || L.readerNoStatus}`
    + otherSessionsBody(anchor, env, opts.sid8)
    + `\n\n${L.readerToday(ymd(today))}\n${tToday || L.readerNone}`
    + `\n\n${L.readerYday(ymd(yday))}\n${tYday || L.readerNone}`;
}

// Multiple sessions in one folder: Stop writes STATUS.md (last writer) AND a per-session copy <history>/sessions/<agent>-<id8>.md.
export const SESSIONS_DIRNAME = 'sessions';
export const OTHER_SESSIONS_MAX = 2;
export const OTHER_SESSION_CHARS = 1000;
export const OTHER_SESSIONS_WINDOW_MS = 48 * 60 * 60 * 1000;
export function sessionStatusPath(anchor, sid8, env = process.env, agent = AGENT) {
  return path.join(historyDir(anchor, env), SESSIONS_DIRNAME, `${agent}-${String(sid8).replace(/[^A-Za-z0-9_-]/g, '_')}.md`);
}
const HEAD_SID_RE = new RegExp(`^(?:${SESSION_KEYS.map(escRe).join('|')}): ([0-9a-zA-Z_-]{1,8})\\s*$`, 'm');
function headOf(text) { return text.replace(/\r\n/g, '\n').split('\n\n')[0]; }

// Other sessions' STATUS copies updated within 48h, excluding the session already shown in STATUS.md, newest first, up to 2.
// A copy whose session equals currentSid8 is tagged "(this session)". '' when there is nothing to show.
export function otherSessionsBody(anchor, env = process.env, currentSid8 = null, now = Date.now()) {
  try {
    const L = t(env);
    const hdir = historyDir(anchor, env);
    const sdir = path.join(hdir, SESSIONS_DIRNAME);
    let names = [];
    try { names = fs.readdirSync(sdir).filter((n) => n.endsWith('.md')); } catch { return ''; }
    let statusSid = null;
    try { const m = HEAD_SID_RE.exec(headOf(fs.readFileSync(path.join(hdir, 'STATUS.md'), 'utf-8'))); statusSid = m ? m[1] : null; } catch { /* none */ }
    const items = [];
    for (const n of names) {
      try {
        const f = path.join(sdir, n);
        const st = fs.statSync(f);
        if (!st.isFile() || now - st.mtimeMs > OTHER_SESSIONS_WINDOW_MS) continue;
        const text = fs.readFileSync(f, 'utf-8').replace(/\r\n/g, '\n');
        const head = headOf(text);
        const sm = HEAD_SID_RE.exec(head);
        const sid = sm ? sm[1] : null;
        if (!sid || sid === statusSid) continue;
        const am = head.match(AUTHOR_RE);
        items.push({ sid, agent: am ? am[1] : '?', mtime: st.mtimeMs, text });
      } catch { /* skip file */ }
    }
    if (!items.length) return '';
    items.sort((a, b) => b.mtime - a.mtime);
    const parts = items.slice(0, OTHER_SESSIONS_MAX).map((it) => {
      let body = it.text.trim();
      if (body.length > OTHER_SESSION_CHARS) body = body.slice(0, OTHER_SESSION_CHARS) + '\n' + L.truncated;
      const mine = !!currentSid8 && it.sid === String(currentSid8).slice(0, 8);
      return `${L.otherSessionHead(it.sid, it.agent, mine)}\n${body}`;
    });
    return `\n\n${L.readerOthers(OTHER_SESSIONS_MAX)}\n${parts.join('\n')}`;
  } catch {
    return '';
  }
}

// Log retention: <ConfDir>/RETENTION lines `keep=30` · `archive=365` · `sessions=7` (days); env AUTO_HISTORY_KEEP_DAYS / AUTO_HISTORY_ARCHIVE_DAYS / AUTO_HISTORY_SESSIONS_DAYS win.
// keep=0 → no log archiving or deletion at all. archive=0 → keep .gz forever. sessions=0 → never delete session copies.
export const RETENTION_DEFAULT = { keep: 30, archive: 365, sessions: 7 };
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RETENTION_BATCH_MAX = 20;
export const RETENTION_MARKER = '.retention';
export const ARCHIVE_DIRNAME = 'archive';
export function retentionPolicy(env = process.env) {
  const out = { ...RETENTION_DEFAULT };
  const num = (v) => (/^\d{1,5}$/.test(String(v ?? '').trim()) ? parseInt(String(v).trim(), 10) : null);
  for (const l of readListFile(path.join(getConfDir(env), 'RETENTION')) || []) {
    const m = /^(keep|archive|sessions)\s*=\s*(\d{1,5})$/i.exec(l);
    if (m) out[m[1].toLowerCase()] = parseInt(m[2], 10);
  }
  const k = num(env.AUTO_HISTORY_KEEP_DAYS); if (k !== null) out.keep = k;
  const a = num(env.AUTO_HISTORY_ARCHIVE_DAYS); if (a !== null) out.archive = a;
  const s = num(env.AUTO_HISTORY_SESSIONS_DAYS); if (s !== null) out.sessions = s;
  return out;
}
const LOG_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
const GZ_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})\.md\.gz$/;
function ageDays(y, m, d, now) {
  const t0 = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  return Number.isFinite(t0) ? Math.floor((now - t0) / 86400000) : -1;
}

// Clean one anchor (called on SessionStart and when the anchor changes). Throttled to once per 24h by a marker file (opts.force ignores it).
// Today's and yesterday's logs and STATUS.md are never touched.
// 1) logs whose file-name date is older than `keep` days → archive/<name>.gz (the original is deleted only after a gunzip round-trip matches; at most 20 per run)
// 2) .gz older than `archive` days are deleted  3) session copies older than `sessions` days are deleted. Returns { ran, archived, deleted, sessionsDeleted }.
export function runRetention(anchor, env = process.env, opts = {}) {
  const res = { ran: false, archived: 0, deleted: 0, sessionsDeleted: 0 };
  try {
    const hdir = historyDir(anchor, env);
    if (!fs.existsSync(hdir)) return res;
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const marker = path.join(hdir, RETENTION_MARKER);
    if (!opts.force) {
      try { if (now - fs.statSync(marker).mtimeMs < RETENTION_INTERVAL_MS) return res; } catch { /* no marker → run */ }
    }
    res.ran = true;
    const pol = retentionPolicy(env);
    const protectedNames = new Set([`${ymd(new Date(now))}.md`, `${ymd(new Date(now - 86400000))}.md`]);
    const adir = path.join(hdir, ARCHIVE_DIRNAME);
    if (pol.keep > 0) {
      let budget = RETENTION_BATCH_MAX;
      for (const n of fs.readdirSync(hdir).sort()) {
        if (budget <= 0) break;
        const m = LOG_NAME_RE.exec(n);
        if (!m || protectedNames.has(n)) continue;
        if (ageDays(m[1], m[2], m[3], now) <= pol.keep) continue;
        const src = path.join(hdir, n);
        const dst = path.join(adir, `${n}.gz`);
        try {
          const raw = fs.readFileSync(src);
          fs.mkdirSync(adir, { recursive: true });
          if (!fs.existsSync(dst)) writeAtomic(dst, zlib.gzipSync(raw));
          const back = zlib.gunzipSync(fs.readFileSync(dst));
          if (back.equals(raw)) { fs.unlinkSync(src); res.archived += 1; budget -= 1; }
          else warn(`retention: archive mismatch, kept ${n}`);
        } catch (e) { warn(`retention: ${n} ${e.message}`); }
      }
      if (pol.archive > 0 && fs.existsSync(adir)) {
        for (const n of fs.readdirSync(adir)) {
          const m = GZ_NAME_RE.exec(n);
          if (!m || ageDays(m[1], m[2], m[3], now) <= pol.archive) continue;
          try { fs.unlinkSync(path.join(adir, n)); res.deleted += 1; } catch { /* ignore */ }
        }
      }
    }
    if (pol.sessions > 0) {
      const sdir = path.join(hdir, SESSIONS_DIRNAME);
      if (fs.existsSync(sdir)) {
        for (const n of fs.readdirSync(sdir)) {
          const f = path.join(sdir, n);
          try {
            const st = fs.statSync(f);
            if (st.isFile() && now - st.mtimeMs > pol.sessions * 86400000) { fs.unlinkSync(f); res.sessionsDeleted += 1; }
          } catch { /* ignore */ }
        }
      }
    }
    try { fs.writeFileSync(marker, new Date(now).toISOString()); } catch { /* ignore */ }
  } catch (e) {
    warn(`retention failed: ${e.message}`);
  }
  return res;
}
export function retentionLogLine(res, env = process.env) {
  if (!res || !res.ran || (!res.archived && !res.deleted && !res.sessionsDeleted)) return '';
  return t(env).logRetention(res.archived, res.deleted, res.sessionsDeleted);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function ymd(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function hms(d = new Date()) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
export function stamp(d = new Date()) { return `${ymd(d)} ${hms(d)}`; }

// History folder name: AUTO_HISTORY_DIRNAME (single path segment only) || '.ai-history'
export function historyDirName(env = process.env) {
  const v = typeof env.AUTO_HISTORY_DIRNAME === 'string' ? env.AUTO_HISTORY_DIRNAME.trim() : '';
  return v && v !== '.' && v !== '..' && !/[\\/:*?"<>|]/.test(v) ? v : DEFAULT_DIRNAME;
}
export function historyDir(anchor, env = process.env) { return path.join(anchor, historyDirName(env)); }

// STATUS.md header (written in the active language; parsed in every language)
export function statusHeader(sid8, anchor, env = process.env, agent = AGENT) {
  const h = t(env).statusHead;
  return `# STATUS\n${h.session}: ${sid8}\n${h.author}: ${agent} (${sid8})\n${h.updated}: ${stamp()}\n${h.anchor}: ${anchor}\n`;
}

// Reader first line: from the STATUS header `Author: <agent> (<id8>)` / `Updated: <time>` → 'Last worker: <agent> · updated <time>'. '' if no author line.
const AUTHOR_RE = new RegExp(`^(?:${AUTHOR_KEYS.map(escRe).join('|')}): ([A-Za-z0-9_-]{1,32})(?![A-Za-z0-9_-])`, 'm');
const UPDATED_RE = new RegExp(`^(?:${UPDATED_KEYS.map(escRe).join('|')}): (.+)$`, 'm');
export function lastWorkerLine(anchor, env = process.env) {
  try {
    const head = fs.readFileSync(path.join(historyDir(anchor, env), 'STATUS.md'), 'utf-8').replace(/\r\n/g, '\n').split('\n\n')[0];
    const w = head.match(AUTHOR_RE);
    if (!w) return '';
    const u = head.match(UPDATED_RE);
    return t(env).lastWorker(w[1], u ? u[1].trim() : '');
  } catch {
    return '';
  }
}

// Headings missing from a STATUS block body: [] if all 4 headings of any one language are present; otherwise the active language's missing ones.
export function missingHeadings(body, env = process.env) {
  const has = (h) => new RegExp(`^##\\s*${escRe(h)}\\s*$`, 'm').test(body);
  if (ALL_HEADINGS.some((set) => set.every(has))) return [];
  return t(env).headings.filter((h) => !has(h));
}

export function linePrefix(data, d = new Date(), agent = AGENT) {
  let p = `- ${hms(d)} [${String(data.session_id || '').slice(0, 8)}][${agent}]`;
  if (data.agent_id || data.agent_type) {
    const tag = data.agent_type || String(data.agent_id || '').slice(0, 8);
    p += ` [sub:${tag}]`;
  }
  return p;
}

export function appendLog(anchor, data, text, env = process.env) {
  try {
    const d = new Date();
    const dir = historyDir(anchor, env);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${ymd(d)}.md`), `${linePrefix(data, d)} ${text}\n`, 'utf-8');
  } catch (e) {
    warn(`log failed: ${e.message}`);
  }
}

export function oneLine(s, max) {
  const x = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return max && x.length > max ? x.slice(0, max) : x;
}

// Debug dump: only when DUMP_INPUTS (codex: DUMP_INPUTS_CODEX) exists in the conf dir and the call passed the scope check
export function maybeDump(event, data, env = process.env, agent = AGENT) {
  try {
    if (!confFileExists(agentConfName('DUMP_INPUTS', agent), env)) return;
    const dir = path.join(getConfDir(env), 'dumps');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const ts = `${ymd(d).replace(/-/g, '')}-${hms(d).replace(/:/g, '')}-${pad(d.getMilliseconds(), 3)}-${process.pid}`;
    const keys = ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_CHILD_SESSION', 'AI_AGENT'];
    const e = {};
    for (const k of keys) e[k] = env[k] === undefined ? null : mask(env[k]);
    if (agent === 'codex') for (const k of Object.keys(env).filter((x) => /^CODEX/i.test(x))) e[k] = mask(String(env[k]));
    e.CLAUDE_CODE_MESSAGING_TOKEN = env.CLAUDE_CODE_MESSAGING_TOKEN !== undefined ? '(present)' : '(absent)';
    fs.writeFileSync(path.join(dir, `${agent === 'claude' ? '' : `${agent}-`}${event}-${ts}.json`),
      JSON.stringify({ agent, argv: process.argv.slice(2), stdin: maskDeep(data), env: e, processCwd: process.cwd() }, null, 2), 'utf-8');
  } catch (e) {
    warn(`dump failed: ${e.message}`);
  }
}

export function tailLines(file, n) {
  try {
    const lines = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-n).join('\n');
  } catch {
    return '';
  }
}

// Tool summary for the log. tool_response is never used.
export function summarizeTool(data) {
  const name = String(data.tool_name || '(unknown)');
  const ti = data.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {};
  let target = '';
  if (name === 'Bash' || name === 'PowerShell') {
    target = oneLine(mask(oneLine(ti.command || '')), 200);
  } else if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(name)) {
    target = normalizeWinPath(ti.file_path || ti.notebook_path || '');
  } else if (name === 'Glob' || name === 'Grep') {
    target = oneLine(mask(String(ti.pattern || '')), 200);
    if (ti.path) target += ` (${normalizeWinPath(String(ti.path))})`;
  } else if (name === 'Agent' || name === 'Task') {
    target = oneLine(mask(String(ti.description || '')), 200);
  } else if (name === 'Skill') {
    target = oneLine(String(ti.skill || ''), 200);
  }
  return target ? `[${name}] ${target}` : `[${name}]`;
}
