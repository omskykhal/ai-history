// ai-history installer
//   node install.mjs --install [--root <dir>] [--lang en|ko] [--settings <path>] [--dry-run]   register the 6 hooks in ~/.claude/settings.json
//   node install.mjs --uninstall [--settings <path>] [--dry-run]                               remove only our entries
//   node install.mjs --codex-hooks [--codex-file <path>] [--dry-run]                           merge our 6 hooks into ~/.codex/hooks.json (--agent codex)
//   node install.mjs --codex-hooks-remove [--codex-file <path>] [--dry-run]                    remove only our entries
//   node install.mjs --git-ignore [--dry-run]                                                   add ".ai-history/" to git's global excludes file
//   node install.mjs --migrate-dirname [--root <dir>] [--dry-run]                              rename legacy .claude-history → .ai-history (depth ≤ 2)
//   node install.mjs --config [--root <dir>] [--lang en|ko] [--keep-days N] [--archive-days N] [--sessions-days N]
//                                                                                               write ROOT / LANG / RETENTION conf files only
//   node install.mjs --status                                                                   show the resolved configuration
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getRoot, getConfDir, lang as resolveLang, historyDirName, DEFAULT_ROOT, retentionPolicy } from './common.mjs';
import { LANGS } from './i18n.mjs';

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOOK_DIR_FWD = HOOK_DIR.replace(/\\/g, '/');
const SCRIPTS = ['session-start.mjs', 'prompt-submit.mjs', 'pre-tool.mjs', 'post-tool.mjs', 'stop.mjs', 'session-end.mjs'];
const cmd = (script) => `node "${HOOK_DIR_FWD}/${script}"`;
const OUR_HOOKS = {
  SessionStart: { matcher: 'startup|resume|clear|fork', script: 'session-start.mjs', timeout: 5 },
  UserPromptSubmit: { matcher: '*', script: 'prompt-submit.mjs', timeout: 3 },
  PreToolUse: { matcher: '*', script: 'pre-tool.mjs', timeout: 3 },
  PostToolUse: { matcher: '*', script: 'post-tool.mjs', timeout: 3 },
  Stop: { matcher: '*', script: 'stop.mjs', timeout: 5 },
  SessionEnd: { matcher: '*', script: 'session-end.mjs', timeout: 5 }, // records the resume command (non-blocking event)
};
const OURS_RE = new RegExp(`/ai-history/[^"]*(${SCRIPTS.map((s) => s.replace('.', '\\.')).join('|')})"`, 'i');

// Our entry = command points into THIS folder, or into any folder named ai-history (moved/old copies).
function isOurs(h) {
  if (!h || typeof h.command !== 'string') return false;
  const c = h.command.replace(/\\/g, '/');
  return c.includes(HOOK_DIR_FWD + '/') || OURS_RE.test(c);
}

// Remove only our entries (drop empty groups / events / hooks key)
function stripOurs(obj) {
  if (!obj.hooks || typeof obj.hooks !== 'object') return;
  for (const ev of Object.keys(obj.hooks)) {
    const groups = Array.isArray(obj.hooks[ev]) ? obj.hooks[ev] : null;
    if (!groups) continue;
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const hs = g.hooks.filter((h) => !isOurs(h));
      if (hs.length === g.hooks.length) kept.push(g);
      else if (hs.length) kept.push({ ...g, hooks: hs });
    }
    if (kept.length) obj.hooks[ev] = kept; else delete obj.hooks[ev];
  }
  if (!Object.keys(obj.hooks).length) delete obj.hooks;
}

function addOurs(obj) {
  stripOurs(obj);
  if (!obj.hooks) obj.hooks = {};
  for (const [ev, d] of Object.entries(OUR_HOOKS)) {
    if (!Array.isArray(obj.hooks[ev])) obj.hooks[ev] = [];
    obj.hooks[ev].push({ matcher: d.matcher, hooks: [{ type: 'command', command: cmd(d.script), timeout: d.timeout }] });
  }
}

function tsNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function compareNonHooks(a, b) {
  const ka = Object.keys(a).filter((k) => k !== 'hooks').sort();
  const kb = Object.keys(b).filter((k) => k !== 'hooks').sort();
  const keysEqual = JSON.stringify(ka) === JSON.stringify(kb);
  const diff = ka.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return { keysEqual, valuesEqual: keysEqual && diff.length === 0, diff };
}

function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return { raw: null, obj: fallback };
  const raw = fs.readFileSync(file, 'utf-8');
  if (raw.charCodeAt(0) === 0xfeff) throw new Error(`${file} has a BOM; aborting`);
  return { raw, obj: JSON.parse(raw) };
}

function writeJsonVerified(file, obj, trailingNewline, backupTag) {
  const out = JSON.stringify(obj, null, 2) + (trailingNewline ? '\n' : '');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out, 'utf-8');
  try {
    JSON.parse(fs.readFileSync(tmp, 'utf-8'));
  } catch (e) {
    fs.unlinkSync(tmp);
    throw new Error(`re-parse of temp file failed: ${e.message}`);
  }
  let backup = null;
  if (fs.existsSync(file)) {
    backup = `${file}.bak.${backupTag}.${tsNow()}`;
    fs.copyFileSync(file, backup);
  }
  fs.renameSync(tmp, file);
  return backup;
}

// ---- conf files (ROOT / LANG) ----
function writeConf(name, value) {
  const file = path.join(getConfDir(), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${value}\n`, 'utf-8');
  return file;
}
function applyConfig(args, dry) {
  const out = {};
  const root = argVal(args, '--root');
  const lg = argVal(args, '--lang');
  if (root) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`--root is not an existing directory: ${abs}`);
    out.root = abs;
    if (!dry) out.rootFile = writeConf('ROOT', abs);
  }
  if (lg) {
    const v = lg.toLowerCase();
    if (!LANGS.includes(v)) throw new Error(`--lang must be one of: ${LANGS.join(', ')}`);
    out.lang = v;
    if (!dry) out.langFile = writeConf('LANG', v);
  }
  // RETENTION (keep / archive / sessions, days; 0 = off). Unspecified keys keep their current (file or default) value.
  const retArgs = [['--keep-days', 'keep'], ['--archive-days', 'archive'], ['--sessions-days', 'sessions']];
  if (retArgs.some(([k]) => args.includes(k))) {
    const pol = retentionPolicy({ ...process.env, AUTO_HISTORY_KEEP_DAYS: undefined, AUTO_HISTORY_ARCHIVE_DAYS: undefined, AUTO_HISTORY_SESSIONS_DAYS: undefined });
    for (const [k, key] of retArgs) {
      const v = argVal(args, k);
      if (v === null) { if (args.includes(k)) throw new Error(`${k} needs a value (whole number of days, 0 = off)`); continue; }
      if (!/^\d{1,5}$/.test(v)) throw new Error(`${k} must be a whole number of days (0 = off): ${v}`);
      pol[key] = parseInt(v, 10);
    }
    // archive counts days since the log's date, so it must be greater than keep (or 0 = keep .gz forever)
    if (pol.keep > 0 && pol.archive > 0 && pol.archive <= pol.keep) throw new Error(`--archive-days (${pol.archive}) must be greater than keep (${pol.keep}) or 0; it counts days since the log's date, not since archiving`);
    out.retention = pol;
    if (!dry) out.retentionFile = writeConf('RETENTION', `keep=${pol.keep}\narchive=${pol.archive}\nsessions=${pol.sessions}`);
  }
  return out;
}

// ---- Claude Code: ~/.claude/settings.json ----
function claudeSettings(mode, file, dry) {
  const { raw, obj: before } = readJsonFile(file, {});
  const next = JSON.parse(JSON.stringify(before));
  if (mode === 'install') addOurs(next); else stripOurs(next);
  if (dry) return { mode, dryRun: true, file, hooks: next.hooks || null, nonHooks: compareNonHooks(before, next) };
  const backup = writeJsonVerified(file, next, raw === null || raw.endsWith('\n'), 'ai-history');
  let after;
  let cmp;
  try {
    after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    cmp = compareNonHooks(before, after);
    if (!cmp.valuesEqual) throw new Error(`non-hooks keys differ: ${cmp.diff.join(',')}`);
  } catch (e) {
    if (backup) fs.copyFileSync(backup, file);
    throw new Error(`verification failed, backup restored: ${e.message}`);
  }
  return {
    mode, file, backup,
    keysBefore: Object.keys(before), keysAfter: Object.keys(after),
    nonHooksKeysEqual: cmp.keysEqual, nonHooksValuesEqual: cmp.valuesEqual,
    hooksEvents: after.hooks ? Object.keys(after.hooks) : [],
  };
}

// ---- Codex: ~/.codex/hooks.json (merge; other handlers preserved) ----
const CODEX_TIMEOUTS = { SessionStart: 5, UserPromptSubmit: 3, PreToolUse: 3, PostToolUse: 3, Stop: 5, SessionEnd: 5 };
function addOursCodex(obj) {
  stripOurs(obj);
  if (!obj.hooks || typeof obj.hooks !== 'object') obj.hooks = {};
  for (const [ev, d] of Object.entries(OUR_HOOKS)) {
    const c = `${cmd(d.script)} --agent codex`;
    if (!Array.isArray(obj.hooks[ev])) obj.hooks[ev] = [];
    obj.hooks[ev].push({ hooks: [{ type: 'command', command: c, commandWindows: c, timeout: CODEX_TIMEOUTS[ev] }] });
  }
}
function codexHooks(file, dry) {
  const { raw, obj: before } = readJsonFile(file, {});
  const next = JSON.parse(JSON.stringify(before));
  addOursCodex(next);
  const out = JSON.stringify(next, null, 2) + '\n';
  const changed = raw === null || JSON.parse(raw) === null || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(next);
  if (dry) return { mode: 'codex-hooks', dryRun: true, file, existed: raw !== null, changed, content: next };
  if (!changed) return { mode: 'codex-hooks', file, existed: true, changed: false, events: Object.keys(next.hooks) };
  const backup = writeJsonVerified(file, next, true, 'ai-history');
  void out;
  return { mode: 'codex-hooks', file, existed: raw !== null, changed: true, backup, events: Object.keys(JSON.parse(fs.readFileSync(file, 'utf-8')).hooks) };
}
function codexHooksRemove(file, dry) {
  if (!fs.existsSync(file)) return { mode: 'codex-hooks-remove', file, removed: false, reason: 'absent' };
  const { obj } = readJsonFile(file, {});
  stripOurs(obj);
  const empty = !Object.keys(obj).length;
  if (dry) return { mode: 'codex-hooks-remove', dryRun: true, file, deleteFile: empty, after: empty ? null : obj };
  const backup = `${file}.bak.ai-history.${tsNow()}`;
  fs.copyFileSync(file, backup);
  if (empty) fs.unlinkSync(file);
  else fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  return { mode: 'codex-hooks-remove', file, backup, removed: true, fileDeleted: empty };
}

// ---- git global excludes ----
function gitGlobalIgnoreFile() {
  try {
    const v = execFileSync('git', ['config', '--global', '--get', 'core.excludesfile'], { encoding: 'utf-8' }).trim();
    if (v) return v.replace(/^~(?=[\\/]|$)/, os.homedir());
  } catch { /* unset */ }
  const xdg = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim();
  return path.join(xdg || path.join(os.homedir(), '.config'), 'git', 'ignore');
}
function gitIgnore(dry) {
  const file = gitGlobalIgnoreFile();
  const line = `${historyDirName()}/`;
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { /* none */ }
  const present = raw.split(/\r?\n/).map((l) => l.trim()).includes(line);
  if (present) return { mode: 'git-ignore', file, line, added: false, reason: 'present' };
  if (dry) return { mode: 'git-ignore', dryRun: true, file, line, wouldAdd: true };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (raw) { backup = `${file}.bak.ai-history.${tsNow()}`; fs.copyFileSync(file, backup); }
  fs.appendFileSync(file, `${raw && !raw.endsWith('\n') ? '\n' : ''}${line}\n`, 'utf-8');
  return { mode: 'git-ignore', file, line, added: true, backup };
}

// ---- legacy folder-name migration (.claude-history → .ai-history, depth ≤ 2 under root) ----
const OLD_DIRNAME = '.claude-history';
function migrateDirname(root, dry) {
  const to = historyDirName();
  const out = { mode: 'migrate-dirname', dryRun: dry, root, from: OLD_DIRNAME, to, renamed: [], wouldRename: [], skippedBoth: [], errors: [] };
  if (to === OLD_DIRNAME) return out;
  const skip = (n) => n.startsWith('.') || n.toLowerCase() === 'node_modules';
  const dirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip(d.name)).map((d) => path.join(dir, d.name));
    } catch {
      return [];
    }
  };
  const targets = [];
  for (const d1 of dirs(root)) {
    targets.push(d1);
    for (const d2 of dirs(d1)) targets.push(d2);
  }
  for (const dir of targets) {
    const src = path.join(dir, OLD_DIRNAME);
    const dst = path.join(dir, to);
    try {
      if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
      if (fs.existsSync(dst)) { out.skippedBoth.push(dir); continue; }
      if (dry) { out.wouldRename.push(dir); continue; }
      try {
        fs.renameSync(src, dst);
      } catch {
        fs.renameSync(src, dst); // one retry
      }
      out.renamed.push(dir);
    } catch (e) {
      out.errors.push(`${dir}: ${e.message}`);
    }
  }
  return out;
}

function status(settingsFile, codexFile) {
  const confDir = getConfDir();
  const has = (f) => { try { return fs.existsSync(f); } catch { return false; } };
  const countOurs = (file) => {
    try {
      const o = JSON.parse(fs.readFileSync(file, 'utf-8'));
      let n = 0;
      for (const groups of Object.values(o.hooks || {})) for (const g of groups || []) for (const h of (g && g.hooks) || []) if (isOurs(h)) n += 1;
      return n;
    } catch { return 0; }
  };
  return {
    hookDir: HOOK_DIR, confDir,
    root: getRoot(), rootSource: process.env.AUTO_HISTORY_ROOT ? 'env' : has(path.join(confDir, 'ROOT')) ? 'ROOT file' : `default (${DEFAULT_ROOT})`,
    lang: resolveLang(), historyDirName: historyDirName(),
    retention: retentionPolicy(), retentionSource: has(path.join(confDir, 'RETENTION')) ? 'RETENTION file (+env)' : 'default (+env)',
    aliasesFile: has(path.join(confDir, 'ALIASES')), noBlock: has(path.join(confDir, 'NO_BLOCK')), noBlockCodex: has(path.join(confDir, 'NO_BLOCK_CODEX')),
    claudeSettings: settingsFile, claudeHooksRegistered: countOurs(settingsFile),
    codexHooksFile: codexFile, codexHooksRegistered: countOurs(codexFile),
    gitGlobalIgnore: gitGlobalIgnoreFile(),
  };
}

function argVal(args, k) { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; }

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const settingsFile = path.resolve(argVal(args, '--settings') || path.join(os.homedir(), '.claude', 'settings.json'));
  const codexFile = path.resolve(argVal(args, '--codex-file') || path.join(os.homedir(), '.codex', 'hooks.json'));
  const print = (o) => console.log(JSON.stringify(o, null, 2));

  if (args.includes('--status')) return print(status(settingsFile, codexFile));
  if (args.includes('--config')) return print({ mode: 'config', dryRun: dry, ...applyConfig(args, dry) });
  if (args.includes('--migrate-dirname')) {
    const root = path.resolve(argVal(args, '--root') || getRoot());
    return print(migrateDirname(root, dry));
  }
  if (args.includes('--codex-hooks')) return print(codexHooks(codexFile, dry));
  if (args.includes('--codex-hooks-remove')) return print(codexHooksRemove(codexFile, dry));
  if (args.includes('--git-ignore')) return print(gitIgnore(dry));
  if (args.includes('--install')) {
    const conf = applyConfig(args, dry);
    const r = claudeSettings('install', settingsFile, dry);
    const rootFile = path.join(getConfDir(), 'ROOT');
    const notes = [];
    if (!process.env.AUTO_HISTORY_ROOT && !fs.existsSync(rootFile)) notes.push(`No ROOT configured: history is only written under ${DEFAULT_ROOT}. Run: node install.mjs --config --root <your projects folder>`);
    notes.push('Hooks apply to new Claude Code sessions (settings.json changes are picked up by running sessions too).');
    return print({ ...r, config: conf, notes });
  }
  if (args.includes('--uninstall')) return print(claudeSettings('uninstall', settingsFile, dry));
  console.log([
    'usage: node install.mjs <mode> [options]',
    '  --install [--root <dir>] [--lang en|ko] [--settings <path>] [--dry-run]',
    '  --uninstall [--settings <path>] [--dry-run]',
    '  --codex-hooks [--codex-file <path>] [--dry-run]',
    '  --codex-hooks-remove [--codex-file <path>] [--dry-run]',
    '  --git-ignore [--dry-run]',
    '  --migrate-dirname [--root <dir>] [--dry-run]',
    '  --config [--root <dir>] [--lang en|ko] [--keep-days N] [--archive-days N] [--sessions-days N]',
    '  --status',
  ].join('\n'));
  return undefined;
}

try {
  main();
} catch (e) {
  process.stderr.write(`[ai-history] install: ${e && e.message}\n`);
  process.exitCode = 1;
}
