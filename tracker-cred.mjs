// Test account tool for tracker checks (0.5.2). Lets agents (Claude, Codex) verify with real accounts without printing passwords or tokens.
// Where accounts are declared: <anchor>/.ai-history/accounts.json (the history folder is git-ignored)
//   {"file":"tests/e2e/.credentials/test-accounts.json", "firebaseApiKey":"AIza…", "emailEnv":"TEST_EMAIL", "passwordEnv":"TEST_PASSWORD", "tokenEnv":"TEST_ID_TOKEN"}
//   file = path relative to the anchor, or absolute. Format {alias:{email,password,…}} or [{id,email,password,…}]. "accounts" may hold them inline instead of file.
// CLI: node tracker-cred.mjs list  [--anchor <dir>]
//      node tracker-cred.mjs login <alias> [--anchor <dir>]          (Firebase Auth REST login → prints only the uid)
//      node tracker-cred.mjs run <alias> [--anchor <dir>] [--email-env N] [--password-env N] [--with-token] -- <command> [args…]
//        → runs the child with the account in environment variables; passwords / tokens in its output are masked as ***.
// 6-digit phone / email verification codes are not handled here (the user passes them on).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { t } from './common.mjs';

export const ACCOUNTS_FILE = 'accounts.json';
const SECRET_KEYS = /pass|pw|secret|token|otp|key/i;

export function findAnchor(start) {
  let d = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(d, '.ai-history', ACCOUNTS_FILE))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export function loadAccounts(anchor) {
  const cfgPath = path.join(anchor, '.ai-history', ACCOUNTS_FILE);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8').replace(/^﻿/, ''));
  let raw = cfg.accounts;
  if (!raw && cfg.file) {
    const f = path.isAbsolute(cfg.file) ? cfg.file : path.join(anchor, cfg.file);
    raw = JSON.parse(fs.readFileSync(f, 'utf-8').replace(/^﻿/, ''));
  }
  const map = new Map();
  if (Array.isArray(raw)) {
    for (const a of raw) if (a && typeof a === 'object' && (a.id || a.alias)) map.set(String(a.id || a.alias), a);
  } else if (raw && typeof raw === 'object') {
    for (const [k, a] of Object.entries(raw)) if (a && typeof a === 'object') map.set(k, a);
  }
  return { cfg, map };
}

// Public fields only (secret-looking keys show presence, not the value)
export function publicView(alias, a, L = t()) {
  const o = { alias };
  for (const [k, v] of Object.entries(a)) {
    if (k === 'id' || k === 'alias') continue;
    if (SECRET_KEYS.test(k)) o[k] = v ? L.credHas : L.credHasNot;
    else if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = v;
  }
  return o;
}

export function maskText(text, secrets) {
  let s = String(text);
  for (const sec of secrets) if (sec && sec.length >= 4) s = s.split(sec).join('***');
  return s;
}

async function firebaseLogin(apiKey, email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, code: (j.error && j.error.message) || 'unknown' };
  return { ok: true, status: r.status, uid: j.localId, idToken: j.idToken };
}

export function winQuote(a) {
  const s = String(a);
  return s && !/[\s"&|<>^()%!]/.test(s) ? s : `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

function argVal(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function pick(argv) {
  const anchor = findAnchor(argVal(argv, '--anchor'));
  if (!anchor) throw new Error(t().credNoAnchor(`.ai-history/${ACCOUNTS_FILE}`));
  return { anchor, ...loadAccounts(anchor) };
}

export async function cli(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const dash = argv.indexOf('--');
  const head = dash >= 0 ? argv.slice(0, dash) : argv;
  const [cmd, alias] = head;
  const L = t();
  if (cmd === 'list') {
    const { anchor, map } = pick(head);
    io.out(`ACCOUNTS ${map.size} · ${L.credAnchor} ${anchor}\n`);
    for (const [k, a] of map) io.out(`${JSON.stringify(publicView(k, a, L))}\n`);
    return 0;
  }
  if (cmd !== 'login' && cmd !== 'run') {
    io.err(`${L.credUsage}\n`);
    return 2;
  }
  if (!alias || alias.startsWith('--')) { io.err(`${L.credNeedAlias}\n`); return 2; }
  const { cfg, map } = pick(head);
  const a = map.get(alias);
  if (!a) { io.err(`${L.credNoAlias(alias)}\n`); return 2; }
  const email = a.email || a.id || '';
  const pass = a.password || a.pw || '';
  const secrets = [pass];
  if (cmd === 'login' || head.includes('--with-token')) {
    if (!cfg.firebaseApiKey) { io.err(`${L.credNoApiKey}\n`); return 2; }
  }
  if (cmd === 'login') {
    const r = await firebaseLogin(cfg.firebaseApiKey, email, pass);
    io.out(r.ok ? `LOGIN OK ${alias} ${email} uid=${r.uid} http=${r.status}\n` : `LOGIN FAIL ${alias} ${email} http=${r.status} code=${r.code}\n`);
    return r.ok ? 0 : 1;
  }
  if (dash < 0 || dash === argv.length - 1) { io.err(`${L.credNeedCmd}\n`); return 2; }
  const env = { ...process.env };
  env[argVal(head, '--email-env') || cfg.emailEnv || 'TEST_EMAIL'] = email;
  env[argVal(head, '--password-env') || cfg.passwordEnv || 'TEST_PASSWORD'] = pass;
  if (head.includes('--with-token')) {
    const r = await firebaseLogin(cfg.firebaseApiKey, email, pass);
    if (!r.ok) { io.out(`LOGIN FAIL ${alias} ${email} http=${r.status} code=${r.code}\n`); return 1; }
    env[cfg.tokenEnv || 'TEST_ID_TOKEN'] = r.idToken;
    env.TEST_UID = r.uid;
    secrets.push(r.idToken);
  }
  const [bin, ...rest] = argv.slice(dash + 1);
  return await new Promise((resolve) => {
    // Windows: use a shell so .cmd programs such as npx run, but quote the arguments ourselves into one string (keeps spaces and quotes).
    const child = process.platform === 'win32'
      ? spawn([bin, ...rest].map(winQuote).join(' '), { env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(bin, rest, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => io.out(maskText(b.toString('utf-8'), secrets)));
    child.stderr.on('data', (b) => io.err(maskText(b.toString('utf-8'), secrets)));
    child.on('error', (e) => { io.err(`${L.credRunFail(e.message)}\n`); resolve(1); });
    child.on('close', (code) => resolve(code == null ? 1 : code));
  });
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === self.toLowerCase()) {
  cli(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => {
    process.stderr.write(`[tracker-cred] ${String((e && e.message) || e).split(/\r?\n/)[0]}\n`);
    process.exitCode = 1;
  });
}
