// Tracker HTML builder: tracker-template.html (next to the hooks) + TRACKER.json → <anchor>/<history>/tracker/index.html. No dependencies.
// MD checklist: the same TRACKER.json → <anchor>/<history>/tracker/CHECKLIST.md; the HTML gets it as D.md (folder name instead of the anchor path).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOOK_DIR, warn, writeAtomic, normalizeWinPath, trackerHtmlPath, trackerMdPath, trackerProjectName, lang } from './common.mjs';
import { T } from './i18n.mjs';
import { buildChecklistMd } from './tracker-md.mjs';

export const TEMPLATE_FILE = 'tracker-template.html';
const DATA_MARK = '/*__TRACKER_DATA__*/null';
const TITLE_MARK = '__TRACKER_TITLE__';
const LANG_MARK = '__TRACKER_LANG__';
// Publish / md state fields change on every build, so they stay out of the HTML (same content → same sha1)
export const VOLATILE_KEYS = ['pending', 'publishedAt', 'htmlHash', 'publishedHash', 'mdHash', 'mdSeenHash'];

// Load the template. Missing → '' plus a warning (never throws).
export function loadTemplate(dir = HOOK_DIR) {
  try {
    return fs.readFileSync(path.join(dir, TEMPLATE_FILE), 'utf-8');
  } catch (e) {
    warn(`tracker template missing: ${e.message}`);
    return '';
  }
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const sha12 = (s) => crypto.createHash('sha1').update(String(s), 'utf-8').digest('hex').slice(0, 12);

// JSON placed inside <script>: escape </script and <!-- so they cannot end the script element, and U+2028/2029 so pre-ES2019 engines do not fail
// (the regexes are built from char codes so no line separator sits in a regex literal)
const LS_RE = new RegExp(String.fromCharCode(0x2028), 'g');
const PS_RE = new RegExp(String.fromCharCode(0x2029), 'g');
export function scriptSafeJson(obj) {
  return JSON.stringify(obj).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\u0021--')
    .replace(LS_RE, '\\u2028').replace(PS_RE, '\\u2029');
}

// Write tracker/.gitignore (`*`) atomically when it is missing (before index.html and CHECKLIST.md)
function ensureTrackerGitignore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) writeAtomic(gi, '*\n');
}

// Anchor label for the tab: folder name instead of the absolute path (keeps the path out of the published page)
const folderName = (anchor) => (anchor ? path.win32.basename(String(anchor).replace(/[\\/]+$/, '')) : '');

// opts: { now, anchor, name, template, dir, lang, env }. '' when there is no template.
export function buildTrackerHtml(json, opts = {}) {
  const tpl = typeof opts.template === 'string' ? opts.template : loadTemplate(opts.dir || HOOK_DIR);
  if (!tpl) return '';
  const env = opts.env || process.env;
  const lg = opts.lang || lang(env);
  const L = T(lg);
  const src = json && typeof json === 'object' ? json : {};
  const data = {};
  for (const [k, v] of Object.entries(src)) if (!VOLATILE_KEYS.includes(k)) data[k] = v;
  const name = opts.name || trackerProjectName(src, opts.anchor, env);
  data.title = L.trackerTitle(name);
  data.builtAt = opts.now ? new Date(opts.now).toISOString() : (src.updatedAt || null);
  data.storeKey = `ah-tracker:${opts.anchor ? sha12(normalizeWinPath(String(opts.anchor))).slice(0, 10) : (String(src.project || name).slice(0, 40))}`;
  data.lang = lg;
  data.L = L.trackerPage;
  data.md = buildChecklistMd(src, { anchor: opts.anchor, name, env, lang: lg, anchorLabel: folderName(opts.anchor) });
  const payload = scriptSafeJson(data);
  // split/join instead of String.replace (avoids the $ replacement patterns)
  return tpl.split(TITLE_MARK).join(escHtml(data.title)).split(LANG_MARK).join(escHtml(lg)).split(DATA_MARK).join(payload);
}

// Atomic write of tracker/index.html → first 12 hex chars of its sha1 ('' when no template or on failure)
export function writeTrackerHtml(anchor, json, env = process.env, opts = {}) {
  try {
    const file = trackerHtmlPath(anchor, env);
    ensureTrackerGitignore(path.dirname(file));
    const html = buildTrackerHtml(json, { env, ...opts, anchor });
    if (!html) return '';
    writeAtomic(file, html);
    return sha12(html);
  } catch (e) {
    warn(`tracker html failed: ${e.message}`);
    return '';
  }
}

// Atomic write of tracker/CHECKLIST.md → first 12 hex chars of its sha1 ('' on failure). Writes tracker/.gitignore (`*`) first when missing.
export function writeTrackerMd(anchor, json, env = process.env, opts = {}) {
  try {
    const file = trackerMdPath(anchor, env);
    ensureTrackerGitignore(path.dirname(file));
    const md = buildChecklistMd(json, { anchor, name: opts.name, env, lang: opts.lang, anchorLabel: String(anchor || '') });
    writeAtomic(file, md);
    return fs.existsSync(file) ? sha12(md) : '';
  } catch (e) {
    warn(`tracker md failed: ${e.message}`);
    return '';
  }
}
