// CHECKLIST.md builder, results parser, inbox parser and /tracker-test target list. No dependencies.
// CLI: node tracker-md.mjs targets <TRACKER.json>
//      node tracker-md.mjs parse <text file> --tracker <TRACKER.json>   (without --tracker: exit code 2, no output)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TRACKER_ID_RE, TRACKER_STR_MAX, TRACKER_ITEMS_MAX, trackerProjectName, extractTracker, lang } from './common.mjs';
import { T } from './i18n.mjs';

export const RESULTS_BEGIN = '<!-- RESULTS:BEGIN -->';
export const RESULTS_END = '<!-- RESULTS:END -->';
// Result line contract (case-insensitive): - [x] <id> | ok|fail|- | evidence. The evidence is taken by (.*)$ and trimmed in code
// (a lazy .*? followed by \s*$ backtracks quadratically)
export const RESULT_LINE_RE = /^\s*-\s\[(x|X)\]\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,15})\s*\|\s*(ok|fail|-)\s*\|(.*)$/i;
export const RESULT_LINE_MAX = 2000; // longer [x] lines are not matched and count as ignored
const CHECKED_RE = /^\s*-\s\[[xX]\]/;
// Item check contract: node "<…>tracker-cred.mjs" login|run|list … (any other command is not classified as cmd)
export const CHECK_CMD_RE = /^node\s+"?[^"\r\n]*tracker-cred\.mjs"?\s+(login|run|list)(\s|$)/;
export const CRED_TOOL = fileURLToPath(new URL('./tracker-cred.mjs', import.meta.url));
const AI_STATUS = ['ok', 'fail', '-'];

const str = (v) => (typeof v === 'string' ? v.slice(0, TRACKER_STR_MAX) : '');
const cell = (v) => {
  const s = str(v).replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|').trim();
  return s || '-';
};
const norm = (text) => String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const itemsOf = (json) => (json && Array.isArray(json.items) ? json.items : []).filter((it) => it && typeof it.id === 'string' && TRACKER_ID_RE.test(it.id));

// Same order as the template's areaOrder(): areas order → areas that only appear on items (first seen), original order inside an area
function orderedItems(json) {
  const items = itemsOf(json).slice(0, TRACKER_ITEMS_MAX);
  const ids = [];
  for (const a of Array.isArray(json && json.areas) ? json.areas : []) if (a && a.id && !ids.includes(a.id)) ids.push(a.id);
  for (const it of items) if (!ids.includes(it.area)) ids.push(it.area);
  const out = [];
  for (const aid of ids) for (const it of items) if (it.area === aid) out.push(it);
  return out;
}
function areaTitle(json, id, other) {
  const a = (Array.isArray(json && json.areas) ? json.areas : []).find((x) => x && x.id === id);
  return a && a.title && a.title !== id ? `${id} ${a.title}` : (id || other);
}

// opts: { anchor, name, env, lang, anchorLabel }. anchorLabel defaults to the absolute anchor path (file); the tab uses the folder name.
export function buildChecklistMd(json, opts = {}) {
  const j = json && typeof json === 'object' ? json : {};
  const env = opts.env || process.env;
  const L = T(opts.lang || lang(env));
  const name = opts.name || trackerProjectName(j, opts.anchor, env);
  const label = typeof opts.anchorLabel === 'string' ? opts.anchorLabel : String(opts.anchor || '');
  const items = orderedItems(j);
  // The page-tab copy (anchor shown as a folder name) carries no absolute paths → the account tool is shown by name only
  const absOk = path.isAbsolute(label);
  const credShown = absOk ? CRED_TOOL : L.mdCredToolHidden;
  const showCheck = (c) => (absOk ? c : c.replace(/"[^"\r\n]*tracker-cred\.mjs"/g, `"${L.mdCheckToolPlaceholder}"`));
  const means = L.mdRuleMeans.map((s, i) => (i === L.mdRuleMeans.length - 1 ? s + L.mdRuleDataExcept : s));
  const out = [
    L.mdTitle(name),
    '',
    `- ${L.mdHeadProject}: ${cell(j.project || name)}`,
    `- ${L.mdHeadAnchor}: ${label || '-'}`,
    `- ${L.mdHeadCredTool}: ${credShown}`,
    `- ${L.mdHeadGenerated}: ${j.updatedAt || '-'}`,
    `- ${L.mdHeadSource}`,
    '',
    L.mdRuleHead,
    ...means.map((s) => `- ${s}`),
    ...L.mdRuleCred.map((s) => `- ${s}`),
    '',
    L.mdHowToHead,
    ...L.mdHowToFill.map((s) => `- ${s}`),
    '',
    L.mdBlockHint,
    '```',
    '<!-- TRACKER:BEGIN -->',
    '{"items":[{"id":"<id>","ai":{"status":"ok|fail|-","note":"…","by":"codex"}}]}',
    '<!-- TRACKER:END -->',
    '```',
    '',
    L.mdItemsHead(items.length),
  ];
  if (!items.length) out.push('', L.mdNone);
  else {
    out.push('', `| ${L.mdColumns.join(' | ')} |`, `|${L.mdColumns.map(() => '---').join('|')}|`);
    for (const it of items) {
      const a = it.ai && typeof it.ai === 'object' ? it.ai : {};
      const u = it.user && typeof it.user === 'object' ? it.user : {};
      const ast = AI_STATUS.includes(a.status) ? a.status : '-';
      const ust = u.status === 'ok' || u.status === 'fail' ? u.status : '';
      const by = a.by === 'codex' || a.by === 'claude' ? ` (${a.by})` : '';
      const aiTxt = `${ast} ${L.mdAst[ast]}${by}${a.note ? ` ${a.note}` : ''}`;
      const uTxt = `${L.mdUst[ust]}${u.note ? ` ${u.note}` : ''}`;
      out.push(`| ${it.id} | ${cell(areaTitle(j, it.area, L.mdOtherArea))} | ${cell(it.title)} | ${cell(it.account)} | ${cell(it.path)} | ${cell(it.todo)} | ${cell(it.expect)} | ${cell(aiTxt)} | ${cell(uTxt)} | ${L.mdResultCell} |`);
    }
  }
  const cmds = items.filter((it) => CHECK_CMD_RE.test(str(it.check).trim()));
  if (cmds.length) {
    out.push('', L.mdCheckHead(cmds.length), `- ${L.mdCheckIntro}`);
    for (const it of cmds) out.push(`- ${it.id}: \`${showCheck(str(it.check).trim()).replace(/`/g, "'")}\``);
  }
  out.push('', L.mdResultsHead, RESULTS_BEGIN);
  for (const it of items) out.push(`- [ ] ${it.id} | - | `);
  out.push(RESULTS_END, '');
  return out.join('\n');
}

// Result lines → { map(id→{status,note}), ignored }
function scanResultLines(lines, ids) {
  const map = new Map();
  let ignored = 0;
  for (const line of lines) {
    if (!CHECKED_RE.test(line)) continue;
    const m = line.length > RESULT_LINE_MAX ? null : RESULT_LINE_RE.exec(line);
    if (!m || !ids.has(m[2])) { ignored += 1; continue; }
    map.set(m[2], { status: m[3].toLowerCase(), note: m[4].trim().slice(0, TRACKER_STR_MAX) });
  }
  return { map, ignored };
}
const toBlock = (map) => ({ items: [...map].map(([id, v]) => ({ id, ai: { status: v.status, note: v.note, by: 'codex' } })) });
// Lines inside the results section (boundaries on their own lines). null when missing
function sectionLines(lines) {
  const b = lines.findIndex((l) => l.trim() === RESULTS_BEGIN);
  if (b < 0) return null;
  let e = -1;
  for (let i = b + 1; i < lines.length; i++) if (lines[i].trim() === RESULTS_END) { e = i; break; }
  return e < 0 ? null : lines.slice(b + 1, e);
}

// CHECKLIST.md results section → { block:{items:[{id,ai:{status,note,by:'codex'}}]}, count, ignored, error }
export function parseChecklistResults(text, json) {
  const sec = sectionLines(norm(text).split('\n'));
  if (!sec) return { block: { items: [] }, count: 0, ignored: 0, error: 'results-section-missing' };
  const { map, ignored } = scanResultLines(sec, new Set(itemsOf(json).map((x) => x.id)));
  return { block: toBlock(map), count: map.size, ignored, error: null };
}

// inbox text: result lines (inside the section if there is one, else everywhere) + TRACKER blocks in the text → only ai (status·note) of existing ids
export function parseInboxText(text, json) {
  const lines = norm(text).split('\n');
  const ids = new Set(itemsOf(json).map((x) => x.id));
  const { map, ignored: ign0 } = scanResultLines(sectionLines(lines) || lines, ids);
  let ignored = ign0;
  const tr = extractTracker(norm(text));
  if (tr.found && tr.json && Array.isArray(tr.json.items)) {
    for (const it of tr.json.items) {
      if (!it || typeof it !== 'object' || !it.ai || typeof it.ai !== 'object') continue;
      const st = typeof it.ai.status === 'string' ? it.ai.status.toLowerCase() : '';
      if (typeof it.id !== 'string' || !ids.has(it.id) || !AI_STATUS.includes(st)) { ignored += 1; continue; }
      map.set(it.id, { status: st, note: str(it.ai.note) });
    }
  }
  return { block: toBlock(map), count: map.size, ignored, error: null };
}

const URL_RE = /https?:\/\/\S+/g;
const URL_TAIL_RE = /[)\]}>」』"'`,.;:]+$/;
// 0.5.1 unmerged checklist results: when the CHECKLIST.md hash differs from json.mdHash and json.mdSeenHash (Stop has not merged it yet),
// parse its results section → Map(id→{status,note}). Same hash or no file → empty Map. Parse error → empty Map + error (fail-open).
export function pendingChecklistResults(json, mdText) {
  const map = new Map();
  if (typeof mdText !== 'string') return { map, error: null };
  const h = crypto.createHash('sha1').update(mdText, 'utf-8').digest('hex').slice(0, 12);
  if (json && (h === json.mdHash || h === json.mdSeenHash)) return { map, error: null };
  const p = parseChecklistResults(mdText, json);
  if (p.error) return { map, error: p.error };
  for (const it of p.block.items) map.set(it.id, { status: it.ai.status, note: it.ai.note });
  return { map, error: null };
}

// /tracker-test targets: neither user nor ai is ok. A URL in path / todo / expect → http, else ui.
// opts.pendingMd (Map id→{status}): unmerged checklist results. ok → not a target; otherwise pendingMd:true and uiLabelEligible:false (protects the pending verdict).
export function trackerTargets(json, opts = {}) {
  const pending = opts.pendingMd instanceof Map ? opts.pendingMd : new Map();
  const out = [];
  for (const it of itemsOf(json)) {
    const a = it.ai && typeof it.ai === 'object' ? it.ai : {};
    const u = it.user && typeof it.user === 'object' ? it.user : {};
    const pm = pending.get(it.id);
    if (u.status === 'ok' || a.status === 'ok' || (pm && pm.status === 'ok')) continue;
    const urls = [];
    for (const k of ['path', 'todo', 'expect']) {
      for (const m of str(it[k]).match(URL_RE) || []) {
        const url = m.replace(URL_TAIL_RE, '');
        if (url.length > 10 && !urls.includes(url)) urls.push(url);
      }
    }
    // A check that is an account tool command makes the item cmd (an agent runs it with a test account) — takes precedence over http / ui
    const check = str(it.check).trim();
    const kind = CHECK_CMD_RE.test(check) ? 'cmd' : (urls.length ? 'http' : 'ui');
    const aSt = AI_STATUS.includes(a.status) ? a.status : '-';
    const row = { id: it.id, kind, urls, uiLabelEligible: !pm && kind === 'ui' && (!a.by || a.by === 'claude') && aSt === '-' };
    if (kind === 'cmd') row.check = check;
    if (pm) row.pendingMd = true;
    out.push(row);
  }
  return out;
}

// CLI targets: honor unmerged results in tracker/CHECKLIST.md next to TRACKER.json
function targetsFromFile(file) {
  const json = readJsonFile(file);
  let text;
  try { text = fs.readFileSync(path.join(path.dirname(file), 'tracker', 'CHECKLIST.md'), 'utf-8'); } catch { text = undefined; }
  const pm = pendingChecklistResults(json, text);
  if (pm.error) process.stderr.write(`[tracker-md] CHECKLIST.md results section parse error (${pm.error}); unmerged results ignored\n`);
  return trackerTargets(json, { pendingMd: pm.map });
}

function readJsonFile(f) {
  const j = JSON.parse(fs.readFileSync(f, 'utf-8').replace(/^﻿/, ''));
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not-object');
  return j;
}

function cli(argv) {
  const [cmd, file] = argv;
  if (cmd === 'targets') {
    if (!file) return 2;
    process.stdout.write(`${JSON.stringify(targetsFromFile(file))}\n`);
    return 0;
  }
  if (cmd === 'parse') {
    const ti = argv.indexOf('--tracker');
    const tf = ti >= 0 ? argv[ti + 1] : '';
    if (!file || file === '--tracker' || !tf) return 2;
    const r = parseInboxText(fs.readFileSync(file, 'utf-8'), readJsonFile(tf));
    process.stdout.write(`${JSON.stringify(r.block)}\n`);
    return 0;
  }
  return 2;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === self.toLowerCase()) {
  try {
    process.exitCode = cli(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`[tracker-md] ${String((e && e.message) || e).split(/\r?\n/)[0]}\n`);
    process.exitCode = 1;
  }
}
