// Tracker HTML builder: tracker-template.html (next to the hooks) + TRACKER.json → <anchor>/<history>/tracker/index.html. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOOK_DIR, warn, writeAtomic, normalizeWinPath, trackerHtmlPath, trackerProjectName, lang } from './common.mjs';
import { T } from './i18n.mjs';

export const TEMPLATE_FILE = 'tracker-template.html';
const DATA_MARK = '/*__TRACKER_DATA__*/null';
const TITLE_MARK = '__TRACKER_TITLE__';
const LANG_MARK = '__TRACKER_LANG__';
// Publish-state fields change on every build, so they stay out of the HTML (same content → same sha1)
const VOLATILE_KEYS = ['pending', 'publishedAt', 'htmlHash', 'publishedHash'];

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

// JSON placed inside <script>: escape </script and <!-- so they cannot end the script element
export function scriptSafeJson(obj) {
  return JSON.stringify(obj).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\u0021--');
}

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
  const payload = scriptSafeJson(data);
  // split/join instead of String.replace (avoids the $ replacement patterns)
  return tpl.split(TITLE_MARK).join(escHtml(data.title)).split(LANG_MARK).join(escHtml(lg)).split(DATA_MARK).join(payload);
}

// Atomic write of tracker/index.html → first 12 hex chars of its sha1 ('' when no template or on failure)
export function writeTrackerHtml(anchor, json, env = process.env, opts = {}) {
  try {
    const html = buildTrackerHtml(json, { env, ...opts, anchor });
    if (!html) return '';
    const file = trackerHtmlPath(anchor, env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, html);
    return sha12(html);
  } catch (e) {
    warn(`tracker html failed: ${e.message}`);
    return '';
  }
}
