// Local search over the history files: daily logs, STATUS.md, sessions/*.md and cursor-import-*.md of every project under the root.
// No index, no database, no network — the files are read and matched line by line. Works the same in the plugin copy and the local hook set.
// Usage: node search.mjs <text> [--regex] [--project <name>] [--all] [--since <YYYY-MM-DD|<n>d>] [--archived] [--limit <n>] [--root <dir>] [--json]
//   <text>        substring, case-insensitive (default) — or a JavaScript regular expression with --regex
//   --project     only this project (folder name, case-insensitive). Default: the project that holds the working directory, else every project
//   --all         every project even when the working directory is inside one
//   --since       dated logs from this day on: 2026-11-01, or 7d (= the last 7 days). STATUS.md and sessions/ are always searched
//   --archived    also read archive/*.md.gz (gzip) — slower
//   --limit       most hits to print (default 200); older lines are dropped first
//   --root        root folder (default AUTO_HISTORY_ROOT / ROOT file / ~/Projects)
//   --json        machine-readable output
// Exit code: 0 = hits, 1 = no hits, 2 = usage error.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as C from './common.mjs';

export const SEARCH_LIMIT_DEFAULT = 200;
export const SEARCH_LINE_MAX = 300;

const STR = {
  ko: {
    header: (q, hits, files, projects) => `[ai-history] "${q}" — ${hits}건 / 파일 ${files}개 / 프로젝트 ${projects}개`,
    none: (q) => `[ai-history] "${q}" — 일치하는 줄 없음`,
    truncated: (limit) => `… ${limit}건까지만 표시(--limit 로 조정)`,
    usage: '사용법: node search.mjs <검색어> [--regex] [--project <이름>] [--all] [--since <YYYY-MM-DD|N d>] [--archived] [--limit <n>] [--root <폴더>] [--json]',
    badRegex: (m) => `정규식 오류: ${m}`,
    noProject: (name) => `프로젝트 "${name}" 을(를) 루트에서 찾지 못함`,
  },
  en: {
    header: (q, hits, files, projects) => `[ai-history] "${q}" — ${hits} hits in ${files} files, ${projects} projects`,
    none: (q) => `[ai-history] "${q}" — no matching lines`,
    truncated: (limit) => `… showing the first ${limit} hits (--limit changes this)`,
    usage: 'Usage: node search.mjs <text> [--regex] [--project <name>] [--all] [--since <YYYY-MM-DD|<n>d>] [--archived] [--limit <n>] [--root <dir>] [--json]',
    badRegex: (m) => `Bad regular expression: ${m}`,
    noProject: (name) => `Project "${name}" not found under the root`,
  },
};
function strings(env) {
  const l = typeof C.lang === 'function' ? C.lang(env) : (String(env.AUTO_HISTORY_LANG || 'ko').toLowerCase() === 'en' ? 'en' : 'ko');
  return STR[l] || STR.ko;
}

const DATED_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const DATED_GZ_RE = /^(\d{4}-\d{2}-\d{2})\.md(?:\.dup-\d+)?\.gz$/;

export function parseArgs(argv) {
  const o = { query: null, regex: false, project: null, all: false, since: null, archived: false, limit: SEARCH_LIMIT_DEFAULT, root: null, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { i++; return argv[i]; };
    if (a === '--regex') o.regex = true;
    else if (a === '--all') o.all = true;
    else if (a === '--archived') o.archived = true;
    else if (a === '--json') o.json = true;
    else if (a === '--project') o.project = next() || null;
    else if (a === '--since') o.since = next() || null;
    else if (a === '--root') o.root = next() || null;
    else if (a === '--limit') { const n = parseInt(next(), 10); if (Number.isFinite(n) && n > 0) o.limit = n; }
    else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else rest.push(a);
  }
  o.query = rest.join(' ').trim() || null;
  return o;
}

// "7d" → the date 7 days ago (YYYY-MM-DD); "2026-11-01" → itself; anything else → null
export function sinceDate(spec, now = new Date()) {
  if (!spec) return null;
  const m = /^(\d+)\s*d$/i.exec(String(spec).trim());
  if (m) return C.ymd(new Date(now.getTime() - parseInt(m[1], 10) * 24 * 60 * 60 * 1000));
  return /^\d{4}-\d{2}-\d{2}$/.test(String(spec).trim()) ? String(spec).trim() : null;
}

function readText(file, gz) {
  try {
    const buf = fs.readFileSync(file);
    return (gz ? zlib.gunzipSync(buf) : buf).toString('utf-8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

// Files to scan for one project, newest first: STATUS.md, sessions/*.md, cursor-import-*.md, dated logs (desc), then archives (desc) when asked.
export function listSearchFiles(anchor, env, opts = {}) {
  const hdir = C.historyDir(anchor, env);
  const out = [];
  const push = (file, rel, date = null, gz = false) => out.push({ file, rel, date, gz });
  const entries = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  if (fs.existsSync(path.join(hdir, 'STATUS.md'))) push(path.join(hdir, 'STATUS.md'), 'STATUS.md');
  for (const n of entries(path.join(hdir, 'sessions')).filter((x) => x.endsWith('.md')).sort()) push(path.join(hdir, 'sessions', n), `sessions/${n}`);
  const top = entries(hdir);
  for (const n of top.filter((x) => /^cursor-import-.*\.md$/.test(x)).sort()) push(path.join(hdir, n), n);
  const since = opts.since || null;
  const dated = top.map((n) => ({ n, m: DATED_RE.exec(n) })).filter((x) => x.m && (!since || x.m[1] >= since)).sort((a, b) => (a.m[1] < b.m[1] ? 1 : -1));
  for (const x of dated) push(path.join(hdir, x.n), x.n, x.m[1]);
  if (opts.archived) {
    const arch = entries(path.join(hdir, 'archive')).map((n) => ({ n, m: DATED_GZ_RE.exec(n) })).filter((x) => x.m && (!since || x.m[1] >= since)).sort((a, b) => (a.m[1] < b.m[1] ? 1 : -1));
    for (const x of arch) push(path.join(hdir, 'archive', x.n), `archive/${x.n}`, x.m[1], true);
  }
  return out;
}

// Which projects: --project <name> → that one; cwd inside a project (and not --all) → that one; else every project with history.
export function selectProjects(opts, env, cwd = process.cwd()) {
  const projects = C.listHistoryProjects(env);
  if (opts.project) {
    const want = String(opts.project).toLowerCase();
    return projects.filter((p) => p.name.toLowerCase() === want || path.basename(p.dir).toLowerCase() === want);
  }
  if (!opts.all) {
    const here = C.normalizeWinPath(cwd);
    const holders = projects.filter((p) => here === p.anchor || here.startsWith(p.anchor + path.sep) || here.startsWith(p.anchor + '/'));
    if (holders.length) return [holders.sort((a, b) => b.anchor.length - a.anchor.length)[0]];
  }
  return projects;
}

export function searchHistory(opts, env = process.env, cwd = process.cwd()) {
  const e = opts.root ? { ...env, AUTO_HISTORY_ROOT: opts.root } : env;
  const q = String(opts.query || '');
  let test;
  if (opts.regex) {
    const re = new RegExp(q, 'i'); // throws on a bad pattern — the caller reports it
    test = (line) => re.test(line);
  } else {
    const lq = q.toLowerCase();
    test = (line) => line.toLowerCase().includes(lq);
  }
  const since = sinceDate(opts.since);
  const projects = selectProjects(opts, e, cwd);
  const limit = opts.limit || SEARCH_LIMIT_DEFAULT;
  const hits = [];
  let files = 0;
  let total = 0;
  const projectsHit = new Set();
  for (const p of projects) {
    for (const f of listSearchFiles(p.anchor, e, { since, archived: opts.archived })) {
      const text = readText(f.file, f.gz);
      if (text === null) continue;
      files++;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i] || !test(lines[i])) continue;
        total++;
        projectsHit.add(p.name);
        if (hits.length < limit) hits.push({ project: p.name, anchor: p.anchor, file: f.rel, date: f.date, line: i + 1, text: C.mask(lines[i].trim()).slice(0, SEARCH_LINE_MAX) });
      }
    }
  }
  return { query: q, hits, total, files, projects: projectsHit.size, scannedProjects: projects.length, truncated: total > hits.length, limit, since };
}

export function formatText(result, env = process.env) {
  const S = strings(env);
  if (!result.total) return S.none(result.query);
  const out = [S.header(result.query, result.total, result.files, result.projects)];
  let cur = null;
  for (const h of result.hits) {
    if (h.project !== cur) { cur = h.project; out.push('', `## ${h.project} (${h.anchor})`); }
    out.push(`  ${h.file}:${h.line}  ${h.text}`);
  }
  if (result.truncated) out.push('', S.truncated(result.limit));
  return out.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const env = process.env;
  const S = strings(env);
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error || !opts.query) { console.error(S.usage); process.exit(2); }
  if (opts.since && !sinceDate(opts.since)) { console.error(S.usage); process.exit(2); }
  let result;
  try {
    result = searchHistory(opts, env);
  } catch (err) {
    console.error(S.badRegex(err && err.message ? err.message : String(err)));
    process.exit(2);
  }
  if (opts.project && result.scannedProjects === 0) { console.error(S.noProject(opts.project)); process.exit(1); }
  process.stdout.write((opts.json ? JSON.stringify(result, null, 2) : formatText(result, env)) + '\n');
  process.exit(result.total ? 0 : 1);
}
