// Copies Cursor conversations into the project history. Usage: node import-cursor.mjs <project folder>
// The source has no message times, so this writes a separate `<history>/cursor-import-<id8>.md` and one line in today's log.
// Running it again overwrites that file. The source is read only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { historyDir, appendLog, mask, oneLine, writeAtomic, normalizeWinPath, inScope, hookEnv } from './common.mjs';

const USER_MAX = 600;
const REPLY_MAX = 400;

export function cursorProjectSlug(dir) {
  return path.resolve(dir).replace(/^([A-Za-z]):/, '$1').split(/[\\/]+/).filter(Boolean).join('-').replace(/^([A-Z])-/, (m, c) => `${c.toLowerCase()}-`);
}

function textOf(message) {
  const c = message && message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

function userText(raw) {
  const m = String(raw).match(/<user_query>([\s\S]*?)<\/user_query>/);
  return m ? m[1] : raw;
}

// source lines → turns (request, last reply, files touched)
export function transcriptToTurns(jsonl) {
  const turns = [];
  let cur = null;
  for (const line of String(jsonl).split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.role === 'user') {
      const q = userText(textOf(o.message));
      if (!q.trim()) continue;
      cur = { user: q, reply: '', files: new Set(), tools: 0 };
      turns.push(cur);
    } else if (o.role === 'assistant' && cur) {
      const t = textOf(o.message);
      if (t.trim()) cur.reply = t;
      for (const b of (o.message && o.message.content) || []) {
        if (!b || b.type !== 'tool_use') continue;
        cur.tools += 1;
        const f = b.input && (b.input.file_path || b.input.path);
        if (typeof f === 'string' && f) cur.files.add(f);
      }
    }
  }
  return turns;
}

export function renderImport(id, turns, source, mtime) {
  const out = [
    `# Cursor conversation ${id.slice(0, 8)}`,
    '',
    `- Source: ${source}`,
    `- Source last modified: ${mtime}`,
    '- The source has no message times, so only the order is kept. Secret patterns are masked and long text is cut.',
    '',
  ];
  turns.forEach((t, i) => {
    out.push(`## Turn ${i + 1}`, `- Request: ${oneLine(mask(oneLine(t.user)), USER_MAX)}`);
    if (t.reply) out.push(`- Reply end: ${oneLine(mask(oneLine(t.reply)).slice(-REPLY_MAX))}`);
    out.push(`- Tools ${t.tools}${t.files.size ? ` · files ${[...t.files].slice(0, 15).map((f) => path.basename(f)).join(', ')}` : ''}`, '');
  });
  return out.join('\n');
}

export function importProject(dir, { cursorHome = path.join(os.homedir(), '.cursor'), env = hookEnv() } = {}) {
  const anchor = normalizeWinPath(path.resolve(dir));
  if (!inScope(anchor, env)) throw new Error(`Outside the project root: ${dir}`);
  const root = path.join(cursorHome, 'projects', cursorProjectSlug(dir), 'agent-transcripts');
  const done = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const src = path.join(root, e.name, `${e.name}.jsonl`);
    if (!fs.existsSync(src)) continue;
    const turns = transcriptToTurns(fs.readFileSync(src, 'utf-8'));
    if (!turns.length) continue;
    const name = `cursor-import-${e.name.slice(0, 8)}.md`;
    fs.mkdirSync(historyDir(anchor, env), { recursive: true });
    writeAtomic(path.join(historyDir(anchor, env), name), renderImport(e.name, turns, src, fs.statSync(src).mtime.toISOString()));
    appendLog(anchor, { session_id: e.name }, `[import] Cursor conversation: ${turns.length} turns → ${name}`, env);
    done.push({ id: e.name, turns: turns.length, file: name });
  }
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node import-cursor.mjs <project folder>'); process.exit(2); }
  console.log(JSON.stringify(importProject(dir)));
}
