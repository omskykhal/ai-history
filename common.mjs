// ai-history — shared module for all hooks. No external dependencies.
// Origin: auto-history (plan v4.1 §4.2, change 2 §14, §15 multi-agent), generalized for distribution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getLang, T, statusFormat, ALL_HEADINGS, AUTHOR_KEYS, UPDATED_KEYS, SESSION_KEYS, RESUME_KEYS, ANCHOR_KEYS, KW_PROJECT, KW_FOLDER } from './i18n.mjs';

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
  return { dir, json: path.join(dir, `${s}.json`), tool: path.join(dir, `${s}.tool`), tracker: path.join(dir, `${s}.tracker`) };
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
    + trackerReaderSection(anchor, env) // tracker section (only when TRACKER.json exists)
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
export const RETENTION_TIME_BUDGET_MS = 800;
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
      try { const age = now - fs.statSync(marker).mtimeMs; if (age >= 0 && age < RETENTION_INTERVAL_MS) return res; } catch { /* no marker → run */ }
    }
    res.ran = true;
    const pol = retentionPolicy(env);
    // archive counts days since the log's own date, so it must exceed keep (otherwise a log would be deleted right after being archived)
    const archiveDays = pol.archive > 0 ? Math.max(pol.archive, pol.keep + 1) : 0;
    const t0 = Date.now();
    const timeBudget = typeof opts.timeBudgetMs === 'number' ? opts.timeBudgetMs : RETENTION_TIME_BUDGET_MS;
    let interrupted = false;
    const protectedNames = new Set([`${ymd(new Date(now))}.md`, `${ymd(new Date(now - 86400000))}.md`]);
    const adir = path.join(hdir, ARCHIVE_DIRNAME);
    if (pol.keep > 0) {
      let budget = RETENTION_BATCH_MAX;
      for (const n of fs.readdirSync(hdir).sort()) {
        if (budget <= 0) break;
        if (Date.now() - t0 > timeBudget) { interrupted = true; break; }
        const m = LOG_NAME_RE.exec(n);
        if (!m || protectedNames.has(n)) continue;
        if (ageDays(m[1], m[2], m[3], now) <= pol.keep) continue;
        const src = path.join(hdir, n);
        const dst = path.join(adir, `${n}.gz`);
        try {
          const raw = fs.readFileSync(src);
          fs.mkdirSync(adir, { recursive: true });
          let target = dst;
          if (fs.existsSync(dst) && !zlib.gunzipSync(fs.readFileSync(dst)).equals(raw)) {
            // a different .gz already carries this name → archive under a distinct name instead of retrying forever
            target = path.join(adir, `${n}.dup-${Date.now()}.gz`);
            warn(`retention: archive name clash, writing ${path.basename(target)}`);
          }
          if (!fs.existsSync(target)) writeAtomic(target, zlib.gzipSync(raw));
          const back = zlib.gunzipSync(fs.readFileSync(target));
          if (back.equals(raw)) { fs.unlinkSync(src); res.archived += 1; budget -= 1; }
          else { budget -= 1; warn(`retention: archive mismatch, kept ${n}`); }
        } catch (e) { budget -= 1; warn(`retention: ${n} ${e.message}`); }
      }
      if (archiveDays > 0 && fs.existsSync(adir)) {
        for (const n of fs.readdirSync(adir)) {
          const m = GZ_NAME_RE.exec(n);
          if (!m || ageDays(m[1], m[2], m[3], now) <= archiveDays) continue;
          // a .gz also has to have existed for (archive - keep) days (its mtime), so nothing is deleted right after being archived
          try {
            if (now - fs.statSync(path.join(adir, n)).mtimeMs < (archiveDays - pol.keep) * 86400000) continue;
            fs.unlinkSync(path.join(adir, n)); res.deleted += 1;
          } catch { /* ignore */ }
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
    // interrupted by the time budget → no marker, so the next run continues where this one stopped
    if (!interrupted) { try { fs.writeFileSync(marker, new Date(now).toISOString()); } catch { /* ignore */ } }
    res.interrupted = interrupted;
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

// Resume command shown after /exit ("claude --resume <id>"), per agent. '' for an unknown agent or an id with spaces/quotes.
export function resumeCommand(sid, agent = AGENT) {
  const id = String(sid || '').trim();
  if (!id || /[\s"'`]/.test(id)) return '';
  if (agent === 'claude') return `claude --resume ${id}`;
  if (agent === 'codex') return `codex resume ${id}`;
  return '';
}

// STATUS.md header (written in the active language; parsed in every language). Takes the full session id; the Resume line is omitted when there is no command.
export function statusHeader(sid, anchor, env = process.env, agent = AGENT) {
  const h = t(env).statusHead;
  const sid8 = String(sid).slice(0, 8);
  const cmd = resumeCommand(sid, agent);
  return `# STATUS\n${h.session}: ${sid8}\n${h.author}: ${agent} (${sid8})\n${h.updated}: ${stamp()}\n${h.anchor}: ${anchor}\n${cmd ? `${h.resume}: ${cmd}\n` : ''}`;
}

// Insert or update the Resume line in the header block (before the first blank line). Untouched unless the file's Session equals sid8
// (another session owns it). Keys of every language are recognized; the line is written with the active language's key. Returns whether it changed.
const RESUME_LINE_RE = new RegExp(`^(?:${RESUME_KEYS.map(escRe).join('|')}): `);
const ANCHOR_LINE_RE = new RegExp(`^(?:${ANCHOR_KEYS.map(escRe).join('|')}): `);
export function upsertStatusResume(file, sid8, cmd, env = process.env) {
  try {
    if (!cmd || !fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
    const nl = text.indexOf('\n\n');
    const head = nl >= 0 ? text.slice(0, nl) : text;
    const rest = nl >= 0 ? text.slice(nl) : '';
    const sm = HEAD_SID_RE.exec(head);
    if (!sm || sm[1] !== String(sid8).slice(0, 8)) return false;
    const line = `${t(env).statusHead.resume}: ${cmd}`;
    const lines = head.split('\n');
    const i = lines.findIndex((l) => RESUME_LINE_RE.test(l));
    if (i >= 0) {
      if (lines[i] === line) return false;
      lines[i] = line;
    } else {
      const j = lines.findIndex((l) => ANCHOR_LINE_RE.test(l));
      lines.splice(j >= 0 ? j + 1 : lines.length, 0, line);
    }
    writeAtomic(file, lines.join('\n') + rest);
    return true;
  } catch {
    return false;
  }
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

// ===================== Tracker page (user check page): auto-create / update =====================
// Per project: <anchor>/<history>/TRACKER.json (source of truth) + tracker/index.html (built from tracker-template.html).
export const TRACKER_FILE = 'TRACKER.json';
export const TRACKER_HTML_REL = 'tracker/index.html';
// Projects whose history starts before this date are "legacy" (tracker off until asked). Override with the TRACKER_SINCE conf file.
export const TRACKER_SINCE_DEFAULT = '2026-10-27';
// Shell commands that count as a change (build / deploy / create / write), case-insensitive.
export const TRACKER_CHANGE_RE = new RegExp([
  '\\b(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:build|deploy|export)\\b',
  '\\bnext\\s+build\\b', '\\bvite\\s+build\\b', '\\bflutter\\s+build\\b', '\\bfirebase\\s+deploy\\b', '\\bvercel\\b',
  '\\bwrangler\\s+(?:deploy|publish)\\b', '\\bgcloud\\s+(?:run|app|functions)\\s+deploy\\b', '\\bdocker\\s+(?:build|compose\\s+up)\\b',
  '\\bsed\\s+-i', '\\btee\\s', '\\bcat\\s*>', '>>', '\\bcp\\s', '\\bmv\\s', '\\bmkdir\\s', '\\bgit\\s+init\\b', '\\bgit\\s+commit\\b',
  '\\bnpx\\s+create-', '\\bnpm\\s+(?:init|create)\\b', '\\bflutter\\s+create\\b', '\\bSet-Content\\b', '\\bOut-File\\b', '\\bNew-Item\\b',
].join('|'), 'i');
export const TRACKER_URL_RE = /^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9_-]{6,}$/;
export const TRACKER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,15}$/;
export const TRACKER_STR_MAX = 600;
export const TRACKER_ITEMS_MAX = 300;
export const TRACKER_NOTES_MAX = 50;
export const TRACKER_READER_MAX = 1200;
const TRACKER_BEGIN_RE = /^\s*<!-- TRACKER:BEGIN -->\s*$/;
const TRACKER_END_RE = /^\s*<!-- TRACKER:END -->\s*$/;
const TRACKER_FENCE_RE = /^\s*(```|~~~)/;
const TRACKER_EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const TRACKER_SKIP_DIRS = ['.ai-history', '.omc', '.claude', 'node_modules', '.git'];

// Block format / wording rules in the active language (default-env constants kept for direct use).
export function trackerFormatFor(env = process.env) { return t(env).trackerFormat; }
export function trackerRulesFor(env = process.env) { return t(env).trackerRules; }
export const TRACKER_FORMAT = trackerFormatFor();
export const TRACKER_RULES = trackerRulesFor();

export function trackerPath(anchor, env = process.env) { return path.join(historyDir(anchor, env), TRACKER_FILE); }
export function trackerHtmlPath(anchor, env = process.env) { return path.join(historyDir(anchor, env), ...TRACKER_HTML_REL.split('/')); }

export function readTracker(anchor, env = process.env) {
  try {
    const j = JSON.parse(fs.readFileSync(trackerPath(anchor, env), 'utf-8').replace(/^﻿/, ''));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}
export function writeTracker(anchor, json, env = process.env) {
  try {
    fs.mkdirSync(historyDir(anchor, env), { recursive: true });
    writeAtomic(trackerPath(anchor, env), JSON.stringify(json, null, 2) + '\n');
  } catch (e) { warn(`tracker write failed: ${e.message}`); }
}

// TRACKER_SINCE conf file (first YYYY-MM-DD line) || default
export function trackerSince(env = process.env) {
  const lines = readListFile(path.join(getConfDir(env), 'TRACKER_SINCE')) || [];
  const hit = lines.find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
  return hit || TRACKER_SINCE_DEFAULT;
}

// Earliest date among <history>/YYYY-MM-DD.md and archive/YYYY-MM-DD.md.gz (null when none)
function earliestHistoryDate(anchor, env) {
  let min = null;
  const scan = (dir, re) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const m = re.exec(n);
      if (!m) continue;
      const d = `${m[1]}-${m[2]}-${m[3]}`;
      if (min === null || d < min) min = d;
    }
  };
  const hdir = historyDir(anchor, env);
  scan(hdir, LOG_NAME_RE);
  scan(path.join(hdir, ARCHIVE_DIRNAME), GZ_NAME_RE);
  return min;
}

// Eligibility → { mode: on|off|new|legacy, reason, json, anchor }. Global TRACKER_OFF wins, then TRACKER.json, then history age.
export function trackerEligibility(anchor, env = process.env) {
  const json = readTracker(anchor, env);
  if (confFileExists('TRACKER_OFF', env)) return { mode: 'off', reason: 'TRACKER_OFF', json, anchor };
  if (json) return { mode: json.mode === 'off' ? 'off' : 'on', reason: 'json', json, anchor };
  const since = trackerSince(env);
  const first = earliestHistoryDate(anchor, env);
  if (first && first < since) return { mode: 'legacy', reason: `history ${first} < ${since}`, json: null, anchor };
  return { mode: 'new', reason: first ? `history ${first} >= ${since}` : 'no-history', json: null, anchor };
}

// PostToolUse change detection (main session only): edit tools under the anchor (outside skipped folders), shell commands via TRACKER_CHANGE_RE.
export function isTrackerChangeTool(data, anchor, env = process.env) {
  try {
    if (!data || data.agent_id || !anchor) return false;
    const name = String(data.tool_name || '');
    const ti = data.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {};
    if (TRACKER_EDIT_TOOLS.includes(name)) {
      const p = normalizeWinPath(String(ti.file_path || ti.notebook_path || ''));
      const a = normalizeWinPath(anchor);
      if (!p || !a || !p.startsWith(a + SEP)) return false;
      const segs = p.slice(a.length + 1).split(SEP);
      const skip = new Set(TRACKER_SKIP_DIRS.concat([historyDirName(env).toLowerCase()]));
      return !segs.slice(0, -1).some((s) => skip.has(s.toLowerCase()));
    }
    if (name === 'Bash' || name === 'PowerShell') return TRACKER_CHANGE_RE.test(String(ti.command || ''));
    return false;
  } catch {
    return false;
  }
}

// Last TRACKER:BEGIN~END block of a reply (fence lines dropped). found = a block exists (true even on a JSON error).
export function extractTracker(msg) {
  const text = String(msg == null ? '' : msg);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let b = -1;
  for (let i = 0; i < lines.length; i++) if (TRACKER_BEGIN_RE.test(lines[i])) b = i;
  if (b < 0) return { json: null, error: null, rest: text, found: false };
  let e = -1;
  for (let i = b + 1; i < lines.length; i++) if (TRACKER_END_RE.test(lines[i])) { e = i; break; }
  if (e < 0) return { json: null, error: null, rest: text, found: false };
  const body = lines.slice(b + 1, e).filter((l) => !TRACKER_FENCE_RE.test(l)).join('\n').trim();
  const rest = lines.slice(0, b).concat(lines.slice(e + 1)).join('\n');
  try {
    const j = JSON.parse(body);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { json: null, error: 'not-object', rest, found: true };
    return { json: j, error: null, rest, found: true };
  } catch (err) {
    return { json: null, error: String((err && err.message) || 'parse-error').slice(0, 120), rest, found: true };
  }
}

const tStr = (v) => (typeof v === 'string' ? v.slice(0, TRACKER_STR_MAX) : null);
const AI_STATUS = ['ok', 'fail', '-'];
const USER_STATUS = ['ok', 'fail', ''];
export function emptyTracker(now = new Date().toISOString()) {
  return {
    version: 1, mode: 'on', project: '', url: null, createdAt: now, updatedAt: now, pending: false, publishedAt: null,
    htmlHash: null, areas: [], items: [], notes: [], userSyncAt: null,
  };
}
// A "no change" note (the allowed form for a turn without changes) is not stored and does not count as a change
const NO_CHANGE_NOTE_RE = /^\s*(?:변경\s*없음|no\s+changes?)\s*\.?\s*$/i;

// Merge: upsert items by id, remove, auto-create areas, enforce limits. No masking (account ID/password are meant to be inline).
// changed = project / areas / items (title, account, path, todo, expect, area, ai) / remove / note changed. userOnly = only user verdicts changed.
export function mergeTracker(json, block, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const by = String(opts.by || 'unknown').slice(0, 64);
  const j = json && typeof json === 'object' ? JSON.parse(JSON.stringify(json)) : emptyTracker(now);
  if (!Array.isArray(j.areas)) j.areas = [];
  if (!Array.isArray(j.items)) j.items = [];
  if (!Array.isArray(j.notes)) j.notes = [];
  const b = block && typeof block === 'object' && !Array.isArray(block) ? block : {};
  let changed = false;
  let userChanged = false;
  let added = 0;
  let updated = 0;
  let removed = 0;

  if (b.mode === 'on' || b.mode === 'off') j.mode = b.mode;
  const proj = tStr(b.project);
  if (proj !== null && proj.trim() && proj !== j.project) { j.project = proj; changed = true; }

  const ensureArea = (id, title) => {
    const a = j.areas.find((x) => x && x.id === id);
    if (!a) { j.areas.push({ id, title: title || id }); changed = true; return; }
    if (title && a.title !== title) { a.title = title; changed = true; }
  };
  if (Array.isArray(b.areas)) {
    for (const a of b.areas) {
      if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !TRACKER_ID_RE.test(a.id)) continue;
      const tt = tStr(a.title);
      ensureArea(a.id, tt && tt.trim() ? tt : null);
    }
  }

  if (Array.isArray(b.items)) {
    for (const it of b.items) {
      if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !TRACKER_ID_RE.test(it.id)) continue;
      let cur = j.items.find((x) => x && x.id === it.id);
      let isNew = false;
      if (!cur) {
        if (j.items.length >= TRACKER_ITEMS_MAX) continue; // total item cap
        cur = {
          id: it.id, area: '', title: '', account: '', path: '', todo: '', expect: '',
          ai: { status: '-', note: '', at: null }, user: { status: '', note: '', at: null },
          addedAt: now, updatedAt: now, by,
        };
        j.items.push(cur);
        isNew = true;
        added += 1;
        changed = true;
      }
      let itemChanged = false;
      const areaId = typeof it.area === 'string' && TRACKER_ID_RE.test(it.area) ? it.area : (cur.area || it.id.split('-')[0]);
      if (cur.area !== areaId) { cur.area = areaId; itemChanged = true; }
      ensureArea(areaId, null);
      for (const k of ['title', 'account', 'path', 'todo', 'expect']) {
        const v = tStr(it[k]);
        if (v !== null && v !== cur[k]) { cur[k] = v; itemChanged = true; }
      }
      if (it.ai && typeof it.ai === 'object') {
        const old = cur.ai && typeof cur.ai === 'object' ? cur.ai : { status: '-', note: '', at: null };
        const st = AI_STATUS.includes(it.ai.status) ? it.ai.status : '-';
        const note = tStr(it.ai.note);
        const nx = { status: st, note: note !== null ? note : (old.note || ''), at: tStr(it.ai.at) || now };
        if (nx.status !== old.status || nx.note !== (old.note || '')) { cur.ai = nx; itemChanged = true; }
      }
      if (it.user && typeof it.user === 'object') {
        const old = cur.user && typeof cur.user === 'object' ? cur.user : { status: '', note: '', at: null };
        const st = USER_STATUS.includes(it.user.status) ? it.user.status : '';
        const note = tStr(it.user.note);
        const nx = { status: st, note: note !== null ? note : (old.note || ''), at: tStr(it.user.at) || now };
        if (nx.status !== (old.status || '') || nx.note !== (old.note || '')) { cur.user = nx; userChanged = true; }
        j.userSyncAt = now;
      }
      if (itemChanged) {
        cur.updatedAt = now;
        cur.by = by;
        changed = true;
        if (!isNew) updated += 1;
      }
    }
  }

  if (Array.isArray(b.remove)) {
    for (const id of b.remove) {
      if (typeof id !== 'string') continue;
      const i = j.items.findIndex((x) => x && x.id === id);
      if (i >= 0) { j.items.splice(i, 1); removed += 1; changed = true; }
    }
  }

  const note = tStr(b.note);
  if (note !== null && note.trim() && !NO_CHANGE_NOTE_RE.test(note)) {
    j.notes.push({ at: now, by, text: note });
    if (j.notes.length > TRACKER_NOTES_MAX) j.notes = j.notes.slice(-TRACKER_NOTES_MAX);
    changed = true;
  }

  if (changed) j.updatedAt = now;
  return { json: j, changed, userOnly: !changed && userChanged, added, updated, removed };
}

// Project name for the page title: first 20 chars of json.project || anchor folder name || localized fallback
export function trackerProjectName(json, anchor, env = process.env) {
  const p = json && typeof json.project === 'string' ? json.project.replace(/\s+/g, ' ').trim() : '';
  if (p) return p.slice(0, 20);
  const base = anchor ? path.basename(String(anchor).replace(/[\\/]+$/, '').replace(/\\/g, '/')) : '';
  return base || t(env).trackerNameFallback;
}

function trackerCounts(json) {
  const items = Array.isArray(json && json.items) ? json.items : [];
  const c = { n: items.length, aiOk: 0, aiFail: 0, aiNone: 0, uOk: 0, uFail: 0, uNone: 0 };
  for (const it of items) {
    const a = it && it.ai && it.ai.status;
    if (a === 'ok') c.aiOk += 1; else if (a === 'fail') c.aiFail += 1; else c.aiNone += 1;
    const u = it && it.user && it.user.status;
    if (u === 'ok') c.uOk += 1; else if (u === 'fail') c.uFail += 1; else c.uNone += 1;
  }
  return c;
}

// Reader tracker section (≤1,200 chars). '' when there is no TRACKER.json.
export function trackerReaderSection(anchor, env = process.env) {
  try {
    const j = readTracker(anchor, env);
    if (!j) return '';
    const L = t(env);
    const c = trackerCounts(j);
    const notes = (Array.isArray(j.notes) ? j.notes : []).slice(-3)
      .map((x) => `- ${String((x && x.at) || '').slice(0, 16)} ${oneLine((x && x.text) || '', 120)}`);
    const lines = [
      L.readerTrackerUrl(j.url, j.mode === 'off'),
      L.readerTrackerCounts(c, j.userSyncAt),
      L.readerTrackerPending(!!j.pending),
      L.readerTrackerNotes(notes.join('\n')),
    ];
    let body = `\n\n${L.readerTracker}\n${lines.join('\n')}`;
    if (body.length > TRACKER_READER_MAX) body = body.slice(0, TRACKER_READER_MAX - L.truncated.length - 1) + '\n' + L.truncated;
    return body;
  } catch {
    return '';
  }
}

// Publish procedure (same wording in the Stop block reason and the prompt instruction)
export function PUBLISH_INSTRUCTION(anchor, json, env = process.env) {
  const L = t(env);
  const file = trackerHtmlPath(anchor, env);
  const title = L.trackerTitle(trackerProjectName(json, anchor, env));
  const url = json && json.url ? json.url : '';
  return [
    L.publishHead,
    L.publishFirst(file, title),
    L.publishExisting(url),
    L.publishAfter,
    '<!-- TRACKER:BEGIN -->',
    '{"url":"https://claude.ai/artifact/<id>"}',
    '<!-- TRACKER:END -->',
  ].join('\n');
}

// Session start / project mention: read the page db once (only when a url exists and the tracker is not off, else '')
export function trackerDbReadInstruction(anchor, env = process.env) {
  try {
    if (confFileExists('TRACKER_OFF', env)) return '';
    const j = readTracker(anchor, env);
    if (!j || j.mode === 'off' || typeof j.url !== 'string' || !TRACKER_URL_RE.test(j.url)) return '';
    return t(env).trackerDbRead(j.url);
  } catch {
    return '';
  }
}

// Prompt instruction (every turn, after the STATUS instruction). on/new → block format + rules, pending ∧ claude → publish procedure,
// legacy/off → one "how to turn it on" line, global TRACKER_OFF → ''.
export function trackerInstruction(elig, json, agent = AGENT, anchor = elig && elig.anchor, env = process.env) {
  try {
    if (!elig || elig.reason === 'TRACKER_OFF') return '';
    const L = t(env);
    if (elig.mode === 'legacy' || elig.mode === 'off') return L.trackerOffHint;
    const parts = [L.trackerOn(historyDirName(env), TRACKER_FILE, trackerFormatFor(env), trackerRulesFor(env))];
    const j = json || (elig && elig.json);
    if (elig.mode === 'on' && j && j.pending && agent === 'claude' && anchor) parts.push(PUBLISH_INSTRUCTION(anchor, j, env));
    return parts.join('\n\n');
  } catch {
    return '';
  }
}
