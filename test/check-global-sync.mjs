// Compares the plugin's agents/ and skills/ files (source of truth) with the global copies under ~/.claude (BOM and CRLF ignored).
// Not part of `npm test`. Exit code 0 = all match or some copies are missing (reported as "not copied"); 1 = a copy differs.
// Usage: node test/check-global-sync.mjs [claudeDir]   (default: <home>/.claude)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_DIR = process.argv[2] || path.join(os.homedir(), '.claude');
const PAIRS = [
  ['agents/tracker-verifier.md', 'agents/tracker-verifier.md'],
  ['skills/tracker-test/SKILL.md', 'skills/tracker-test/SKILL.md'],
];

// Hash the text after removing a BOM and turning CRLF into LF, so a git checkout with core.autocrlf does not count as a difference.
const normalize = (p) => fs.readFileSync(p, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const sha1 = (p) => crypto.createHash('sha1').update(normalize(p), 'utf-8').digest('hex');
let ok = 0;
let missing = 0;
let diff = 0;
for (const [rel, globalRel] of PAIRS) {
  const src = path.join(ROOT, rel);
  const dst = path.join(CLAUDE_DIR, globalRel);
  if (!fs.existsSync(src)) { console.log(`SOURCE MISSING ${rel}`); diff++; continue; }
  if (!fs.existsSync(dst)) { console.log(`NOT COPIED (미복사) ${dst}`); missing++; continue; }
  const a = sha1(src);
  const b = sha1(dst);
  if (a === b) { console.log(`OK ${rel} ${a.slice(0, 12)}`); ok++; } else { console.log(`MISMATCH (불일치) ${rel} plugin=${a.slice(0, 12)} global=${b.slice(0, 12)}`); diff++; }
}
if (diff) console.log(`SYNC FAIL ${ok}/${PAIRS.length}`);
else if (missing) console.log(`SYNC NOT COPIED ${ok}/${PAIRS.length} (missing ${missing})`);
else console.log(`SYNC OK ${ok}/${PAIRS.length}`);
process.exitCode = diff ? 1 : 0;
