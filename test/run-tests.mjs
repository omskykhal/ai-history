// auto-history 단위 시험 (플랜 v4.1 §5 1~6행 + 변경 2 §14.4 = 7행, 2c (p)~(v), §15 = 8행, 배포 일반화 = 9행, 보존·다중 세션 = 10행, 재개 명령 = 11행, 트래커 페이지 = 12행). 사용: node run-tests.mjs <scratch-dir> [<설치 전 settings 사본>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from '../common.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Test artifacts live in the OS temp dir (override with AI_HISTORY_TEST_BASE). Never under a real project root.
const T_BASE = path.resolve(process.env.AI_HISTORY_TEST_BASE || path.join(os.tmpdir(), 'ai-history-test'));
// All expectations below use the Korean wording → force lang=ko for spawned hooks and direct calls.
process.env.AUTO_HISTORY_LANG = 'ko';
const TEST_ROOT = path.join(T_BASE, 'run');
const SCRATCH = path.resolve(process.argv[2] || path.join(os.tmpdir(), `ah-test-${process.pid}`));
const STATE = path.join(SCRATCH, 'state');
const CONF = path.join(SCRATCH, 'conf');
const CONF_SDKTS = path.join(SCRATCH, 'conf-sdkts');
const CONF_NESTED = path.join(SCRATCH, 'conf-nested');
const CONF_NOBLOCK = path.join(SCRATCH, 'conf-noblock');
const CONF_ALIAS = path.join(SCRATCH, 'conf-alias');
const OUTSIDE = path.join(SCRATCH, 'outside');
const CONF_NOBLOCK_CODEX = path.join(SCRATCH, 'conf-noblock-codex');
const CONF_NESTED_CODEX = path.join(SCRATCH, 'conf-nested-codex');
// §15.1 히스토리 폴더명(기본값)
const HD = '.ai-history';
// 변경 2 시험 루트: 실제 경계 루트(Desktop\Project) 기준 깊이 3 이상에 두어 실제 스캔 후보가 되지 않게 함
const ROOT2 = path.join(TEST_ROOT, 'c2root', 'r');
const ROOT3 = path.join(TEST_ROOT, 'c2root', 'r3');

// 변경 2d 시험용 별칭표(실제 ALIASES 는 읽지 않음). ghost 줄=없는 경로, 화살표 없는 줄=오류 줄
const ALIAS_TEXT = [
  '# 시험용 별칭표',
  'tauko|타우코|school|스쿨|academy|아카데미|play|플레이 => teacher\\tauko',
  'tauko thinking|tauko-thinking|thinking|씽킹 => teacher\\tauko-thinking',
  'landing|tauko-landing|랜딩 => teacher\\tauko-landing',
  'auto-history|auto history|오토히스토리 => auto-history',
  'ghostword|유령 => teacher\\no-such-folder',
  '이 줄은 화살표가 없다',
  '',
].join('\n');
const results = [];
function rec(row, id, expect, actual, pass) {
  results.push({ row, id, expect, actual: String(actual).slice(0, 240), pass: !!pass });
}

function reset() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  for (const d of [STATE, OUTSIDE]) fs.mkdirSync(d, { recursive: true });
  const mk = (dir, files) => {
    fs.mkdirSync(dir, { recursive: true });
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
  };
  mk(CONF, { INTERACTIVE_ENTRYPOINTS: 'cli\n' });
  mk(CONF_SDKTS, { INTERACTIVE_ENTRYPOINTS: 'cli\nsdk-ts\n' });
  mk(CONF_NESTED, { INTERACTIVE_ENTRYPOINTS: 'cli\n', NESTED_MARKERS: 'AH_NESTED_TEST=1\n' });
  mk(CONF_NOBLOCK, { INTERACTIVE_ENTRYPOINTS: 'cli\n', NO_BLOCK: '' });
  mk(CONF_ALIAS, { INTERACTIVE_ENTRYPOINTS: 'cli\n', ALIASES: ALIAS_TEXT });
  mk(CONF_NOBLOCK_CODEX, { INTERACTIVE_ENTRYPOINTS: 'cli\n', NO_BLOCK_CODEX: '' });
  mk(CONF_NESTED_CODEX, { INTERACTIVE_ENTRYPOINTS: 'cli\n', NESTED_MARKERS_CODEX: 'AH_NESTED_TEST=1\n' });
  fs.rmSync(T_BASE, { recursive: true, force: true }); // 시험 전용 폴더(이전 산출물 정리)
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

const sidNew = () => crypto.randomUUID();
const P = (name) => path.join(TEST_ROOT, name);

// Child processes get a minimal environment: only what node and git need to start (paths, temp, home).
// Nothing else from the parent (tokens, API keys, CLAUDE* / AUTO_HISTORY* settings) is forwarded.
const HOST_ENV_KEYS = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'USERNAME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TZ'];
function hostEnv(over = {}) {
  const e = {};
  for (const k of HOST_ENV_KEYS) { const v = process.env[k]; if (v !== undefined) e[k] = v; }
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete e[k]; else e[k] = v; }
  return e;
}

function baseEnv(sid, over = {}) {
  const e = hostEnv();
  Object.assign(e, {
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SESSION_ID: sid,
    AUTO_HISTORY_ROOT: TEST_ROOT,
    AUTO_HISTORY_STATE_DIR: STATE,
    AUTO_HISTORY_CONF_DIR: CONF,
    AUTO_HISTORY_LANG: 'ko',
  });
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete e[k]; else e[k] = v;
  }
  return e;
}

function run(script, input, env, args = []) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [path.join(HOOK, script), ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf-8', timeout: 15000,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', ms };
}
function runAsync(script, input, env, keepOpen = false) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const cp = spawn(process.execPath, [path.join(HOOK, script)], { env });
    let out = '';
    cp.stdout.on('data', (d) => { out += d; });
    if (!keepOpen) cp.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
    cp.on('close', (code) => resolve({ code, out, ms: Date.now() - t0 }));
  });
}

const stateFile = (sid) => path.join(STATE, `${sid}.json`);
const toolFile = (sid) => path.join(STATE, `${sid}.tool`);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; } };
const today = () => C.ymd(new Date());
const logOf = (anchor) => { try { return fs.readFileSync(path.join(anchor, HD, `${today()}.md`), 'utf-8'); } catch { return ''; } };
const statusOf = (anchor) => { try { return fs.readFileSync(path.join(anchor, HD, 'STATUS.md'), 'utf-8'); } catch { return null; } };
const lastLine = (s) => s.trimEnd().split('\n').pop() || '';

function startSession(anchor, sid = sidNew(), extraEnv = {}) {
  fs.mkdirSync(anchor, { recursive: true });
  run('session-start.mjs', { session_id: sid, source: 'startup', cwd: anchor }, baseEnv(sid, extraEnv));
  return sid;
}
function arm(sid) { fs.writeFileSync(toolFile(sid), ''); }

function block(tag, { crlf = false, drop = null } = {}) {
  const parts = ['<!-- STATUS:BEGIN -->'];
  for (const h of ['하던 일', '한 일', '다음 할 일', '진행도']) {
    if (h === drop) continue;
    parts.push(`## ${h}`, `- ${tag} ${h} 내용`);
  }
  parts.push('<!-- STATUS:END -->');
  return parts.join(crlf ? '\r\n' : '\n');
}
const AC2 = /^# STATUS\n세션: [0-9a-f]{8}\n작성: claude \([0-9a-f]{8}\)\n갱신: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\n앵커: .+\n/;
const hasAll4 = (s) => ['하던 일', '한 일', '다음 할 일', '진행도'].every((h) => new RegExp(`^## ${h}$`, 'm').test(s));
const BLOCK_RE = /^\{"decision":"block","reason":"\[auto-history\]/;

async function main() {
  reset();

  // ---------- 1행 common ----------
  const BROOT = 'C:\\Users\\me\\Desktop\\Project';
  const BENV = { AUTO_HISTORY_ROOT: BROOT };
  const bcases = [
    ['C:\\Users\\me\\Desktop\\Project\\x', true],
    ['C:\\Users\\me\\Desktop\\Project', false],
    ['C:\\Users\\me', false],
    ['C:\\Users\\me\\AppData\\Local\\Temp\\x', false],
    ['c:/users/me/desktop/project/x', true],
    ['/c/Users/me/Desktop/Project/x', true],
    ['//c/Users/me/Desktop/Project/x', true],
    ['\\\\?\\C:\\Users\\me\\Desktop\\Project\\x', true],
    ['\\\\server\\share\\x', false],
    ['C:\\Users\\me\\Desktop\\ProjectX\\y', false],
    ['C:\\Users\\me\\Desktop\\Project\\0. POSTING', true],
    ['C:\\Users\\me\\Desktop\\Project\\미래세상\\sub', true],
  ];
  bcases.forEach(([p, want], i) => {
    const got = C.inScope(p, BENV);
    rec(1, `경계-${i + 1} ${p}`, want ? 'in' : 'out', `${got ? 'in' : 'out'} (norm=${C.normalizeWinPath(p)})`, got === want);
  });
  const mcases = [
    'key AIzaSyA1234567890abcdefghijklmnopqrstuv end',
    'sk-abcdefghijklmnop1234 end',
    'ghp_abcdefghijklmnopqrstuvwxyz12 end',
    'Authorization: Bearer abc.def.ghi end',
    'password=hunter2 end',
  ];
  mcases.forEach((s, i) => {
    const m = C.mask(s);
    rec(1, `마스킹-${i + 1}`, '\\*\\*\\* 포함·원문 비밀 제거', m, /\*\*\*/.test(m) && !/AIzaSy|sk-abc|ghp_abc|abc\.def|hunter2/.test(m));
  });
  const S = 'aaaaaaaa-1111-2222-3333-444444444444';
  const ie = (over, conf = CONF) => ({ CLAUDE_CODE_SESSION_ID: S, AUTO_HISTORY_CONF_DIR: conf, ...over });
  const icases = [
    ['(cli, 목록 cli)', ie({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), true],
    ['(cli, env SESSION_ID 없음)', { CLAUDE_CODE_ENTRYPOINT: 'cli', AUTO_HISTORY_CONF_DIR: CONF }, true],
    ['(빈 값)', ie({ CLAUDE_CODE_ENTRYPOINT: '' }), false],
    ['(session-summary)', ie({ CLAUDE_CODE_ENTRYPOINT: 'session-summary' }), false],
    ['(sdk-cli)', ie({ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), false],
    ['(목록에 sdk-ts 추가, sdk-ts)', ie({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }, CONF_SDKTS), false],
    ['(cli, env SESSION_ID≠stdin)', ie({ CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_ID: 'bbbbbbbb-x' }), false],
    ['(cli, NESTED_MARKERS 일치)', ie({ CLAUDE_CODE_ENTRYPOINT: 'cli', AH_NESTED_TEST: '1' }, CONF_NESTED), false],
  ];
  for (const [name, env, want] of icases) {
    const got = C.isInteractive({ session_id: S }, env);
    rec(1, `isInteractive ${name}`, String(want), String(got), got === want);
  }
  // hookEnv: allow-listed keys only; tokens / API keys / other tools' variables in the host env never reach the hooks
  {
    const host = { AUTO_HISTORY_ROOT: 'r', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_MESSAGING_TOKEN: 'tkn', ANTHROPIC_API_KEY: 'sk-abcdefghijklmnop1234', CODEX_API_KEY: 'x', GH_TOKEN: 'y', PATH: 'p' };
    const e = C.hookEnv(host);
    const keys = Object.keys(e).sort().join(',');
    rec(1, 'hookEnv 허용목록', 'AUTO_HISTORY_ROOT,CLAUDE_CODE_ENTRYPOINT 만', keys,
      keys === 'AUTO_HISTORY_ROOT,CLAUDE_CODE_ENTRYPOINT' && C.ENV_KEYS.every((k) => /^(AUTO_HISTORY_|CLAUDE_|CLAUDECODE$|AI_AGENT$)/.test(k)) && !C.ENV_KEYS.some((k) => /TOKEN|KEY|SECRET|PASS/i.test(k)));
  }

  // ---------- 2행 session-start ----------
  {
    const a = P('p2a'); const sid = sidNew();
    fs.mkdirSync(path.join(a, HD), { recursive: true });
    fs.writeFileSync(path.join(a, HD, 'STATUS.md'), '# STATUS\n세션: 12345678\n갱신: 2026-10-08 10:00:00\n앵커: x\n\n## 하던 일\n- 시험\n');
    fs.writeFileSync(path.join(a, HD, `${today()}.md`), '- 10:00:00 [12345678] [User] hi\n');
    const r = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, baseEnv(sid));
    let ctx = ''; try { ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext; } catch { /* */ }
    rec(2, '(a) 히스토리 있음', 'additionalContext ~ /^# STATUS/m && /\\[현황\\]/', ctx.slice(0, 120), /^# STATUS/m.test(ctx) && /\[현황\]/.test(ctx) && r.code === 0);
  }
  {
    const a = P('p2b'); fs.mkdirSync(a, { recursive: true }); const sid = sidNew();
    const r = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, baseEnv(sid));
    rec(2, '(b) 히스토리 없음', '/히스토리 없음/', r.out, /히스토리 없음/.test(r.out));
  }
  {
    const sid = sidNew();
    const r = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: OUTSIDE }, baseEnv(sid));
    const ok = r.out === '' && !fs.existsSync(stateFile(sid)) && !fs.existsSync(path.join(OUTSIDE, HD));
    rec(2, '(c) 경계 밖', '무출력·상태 파일 없음', `out='${r.out}' state=${fs.existsSync(stateFile(sid))}`, ok);
  }
  {
    const a = P('p2d'); fs.mkdirSync(a, { recursive: true }); const sid = sidNew();
    const r = run('session-start.mjs', { session_id: sid, source: 'compact', cwd: a }, baseEnv(sid));
    rec(2, '(d) compact', '무출력', `out='${r.out}'`, r.out === '');
  }
  {
    const sid = sidNew(); fs.mkdirSync(P('p2e'), { recursive: true });
    run('session-start.mjs', { session_id: sid, source: 'startup', cwd: TEST_ROOT.replace(/\\/g, '/') + '/P2e' }, baseEnv(sid));
    const st = readJson(stateFile(sid));
    const want = C.normalizeWinPath(path.join(TEST_ROOT, 'p2e'));
    rec(2, '(e) startup 앵커', `anchor=${want}`, st && st.anchor, st && st.anchor === want);
  }
  {
    const sid = sidNew(); const a = P('p2f'); fs.mkdirSync(path.join(a, 'sub'), { recursive: true });
    run('session-start.mjs', { session_id: sid, source: 'clear', cwd: path.join(a, 'sub') }, baseEnv(sid, { CLAUDE_PROJECT_DIR: a }));
    const st = readJson(stateFile(sid));
    rec(2, '(f) clear+cwd 하위+PROJECT_DIR', `anchor=${C.normalizeWinPath(a)}`, st && st.anchor, st && st.anchor === C.normalizeWinPath(a));
  }
  {
    const sid = sidNew(); const a = P('p2g'); fs.mkdirSync(a, { recursive: true });
    const r = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, baseEnv(sid, { CLAUDE_CODE_ENTRYPOINT: 'session-summary' }));
    rec(2, '(g) session-summary', '상태 파일 생성·출력 없음', `out='${r.out}' state=${fs.existsSync(stateFile(sid))}`, r.out === '' && fs.existsSync(stateFile(sid)));
  }
  {
    const oldF = path.join(STATE, 'old-session.json'); const newF = path.join(STATE, 'new-session.json');
    fs.writeFileSync(oldF, '{}'); fs.writeFileSync(newF, '{}');
    const now = Date.now() / 1000;
    fs.utimesSync(oldF, now - 8 * 86400, now - 8 * 86400);
    fs.utimesSync(newF, now - 1 * 86400, now - 1 * 86400);
    const sid = sidNew(); const a = P('p2h'); fs.mkdirSync(a, { recursive: true });
    run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, baseEnv(sid));
    rec(2, '(h) mtime 8일 삭제/1일 유지', 'old 없음·new 있음', `old=${fs.existsSync(oldF)} new=${fs.existsSync(newF)}`, !fs.existsSync(oldF) && fs.existsSync(newF));
    fs.rmSync(newF, { force: true });
  }
  {
    const sid = sidNew(); const a = P('p2i'); fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(stateFile(sid), JSON.stringify({ anchor: C.normalizeWinPath(a), promptAt: null, blockedAt: null }));
    arm(sid);
    const r = run('session-start.mjs', { session_id: sid, source: 'resume', cwd: OUTSIDE }, baseEnv(sid));
    const ok = r.out === '' && !fs.existsSync(stateFile(sid)) && !fs.existsSync(toolFile(sid));
    rec(2, '(i) resume+경계 밖 cwd', '상태 파일·.tool 삭제·무출력', `out='${r.out}' state=${fs.existsSync(stateFile(sid))} tool=${fs.existsSync(toolFile(sid))}`, ok);
  }
  {
    const sid = sidNew(); const a = P('p2k'); fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(stateFile(sid), JSON.stringify({ anchor: C.normalizeWinPath(a), promptAt: null, blockedAt: null }));
    const r = run('session-start.mjs', { session_id: sid, source: 'clear', cwd: a }, baseEnv(sid, { CLAUDE_PROJECT_DIR: OUTSIDE }));
    const st = readJson(stateFile(sid));
    rec(2, '(수정·§14.1) clear+PROJECT_DIR 경계 밖+cwd 경계 안', `anchor=cwd(${C.normalizeWinPath(a)})·주입 있음`, `out='${r.out.slice(0, 60)}' anchor=${st && st.anchor}`,
      st && st.anchor === C.normalizeWinPath(a) && /히스토리 없음/.test(r.out));
  }
  {
    const sid = sidNew(); const a = P('p2l'); fs.mkdirSync(a, { recursive: true });
    run('session-start.mjs', { session_id: sid, source: 'resume', cwd: a }, baseEnv(sid));
    const st = readJson(stateFile(sid));
    rec(2, '(추가) resume+PROJECT_DIR 없음+cwd 경계 안', `anchor=${C.normalizeWinPath(a)}`, st && st.anchor, st && st.anchor === C.normalizeWinPath(a));
  }
  {
    const sid = sidNew(); const a = P('p2j'); fs.mkdirSync(a, { recursive: true });
    const r = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, baseEnv(sid, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }));
    rec(2, '(j) sdk-cli', '출력 없음', `out='${r.out}'`, r.out === '');
  }

  // ---------- 3행 prompt-submit ----------
  {
    const a = P('p3'); const sid = startSession(a); arm(sid);
    const r = run('prompt-submit.mjs', { session_id: sid, cwd: a, prompt: '빌드 고쳐줘 hello' }, baseEnv(sid));
    const st = readJson(stateFile(sid));
    rec(3, 'promptAt 갱신', 'promptAt≠null, blockedAt=null', JSON.stringify(st), st && st.promptAt && st.blockedAt === null);
    rec(3, '.tool 삭제', '.tool 없음', `tool=${fs.existsSync(toolFile(sid))}`, !fs.existsSync(toolFile(sid)));
    rec(3, '대화형 출력', '/STATUS:BEGIN/', r.out.slice(0, 100), /STATUS:BEGIN/.test(r.out));
    const ll = lastLine(logOf(a));
    rec(3, '[User] 로그', '/^- \\d\\d:\\d\\d:\\d\\d \\[[0-9a-f]{8}\\]\\[claude\\] \\[User\\] /', ll, /^- \d\d:\d\d:\d\d \[[0-9a-f]{8}\]\[claude\] \[User\] /.test(ll));
    const r2 = run('prompt-submit.mjs', { session_id: sid, cwd: a, prompt: 'x' }, baseEnv(sid, { CLAUDE_CODE_ENTRYPOINT: 'session-summary' }));
    rec(3, 'session-summary', '무출력', `out='${r2.out}'`, r2.out === '');
    run('prompt-submit.mjs', { session_id: sid, cwd: a, prompt: 'key AIzaSyA1234567890abcdefghijklmnopqrstuv' }, baseEnv(sid));
    const ll2 = lastLine(logOf(a));
    rec(3, '(추가) 요청문 마스킹', '/\\[User\\] key \\*\\*\\*$/', ll2, /\[User\] key \*\*\*$/.test(ll2));
    run('prompt-submit.mjs', { session_id: sid, cwd: a }, baseEnv(sid));
    const ll3 = lastLine(logOf(a));
    rec(3, '(추가) 본문 필드 없음', '/\\[User\\] \\(본문 필드 미확인\\)$/', ll3, /\[User\] \(본문 필드 미확인\)$/.test(ll3));
  }

  // ---------- 4행 pre/post-tool ----------
  {
    const a = P('p4'); const sid = startSession(a);
    run('pre-tool.mjs', { session_id: sid, cwd: a, tool_name: 'Bash', tool_input: { command: 'npm run build' } }, baseEnv(sid));
    let ll = lastLine(logOf(a));
    rec(4, 'Pre Bash', '/▶ \\[Bash\\] npm run build$/', ll, /▶ \[Bash\] npm run build$/.test(ll));
    run('pre-tool.mjs', { session_id: sid, cwd: a, tool_name: 'Edit', tool_input: { file_path: `${TEST_ROOT}\\a.ts` } }, baseEnv(sid));
    ll = lastLine(logOf(a));
    const wantEdit = `[Edit] ${C.normalizeWinPath(path.join(TEST_ROOT, 'a.ts'))}`;
    rec(4, 'Pre Edit', `...${wantEdit}`, ll, ll.endsWith(wantEdit));
    run('post-tool.mjs', { session_id: sid, cwd: a, tool_name: 'Bash', tool_input: { command: 'npm run build' }, duration_ms: 12345, tool_response: { stdout: 'SECRET_OUTPUT' } }, baseEnv(sid));
    ll = lastLine(logOf(a));
    rec(4, 'Post Bash', '/✓ \\[Bash\\] .* \\(\\d+(\\.\\d)?s\\)$/', ll, /✓ \[Bash\] .* \(\d+(\.\d)?s\)$/.test(ll));
    rec(4, 'Post 후 .tool', '.tool 존재', `tool=${fs.existsSync(toolFile(sid))}`, fs.existsSync(toolFile(sid)));
    rec(4, '(추가) tool_response 미기록', 'SECRET_OUTPUT 없음', `found=${logOf(a).includes('SECRET_OUTPUT')}`, !logOf(a).includes('SECRET_OUTPUT'));
    const rc = run('pre-tool.mjs', '{not json', baseEnv(sid));
    rec(4, '손상 JSON', 'exit 0·무출력', `code=${rc.code} out='${rc.out}'`, rc.code === 0 && rc.out === '');
    const sidO = sidNew();
    run('pre-tool.mjs', { session_id: sidO, cwd: OUTSIDE, tool_name: 'Bash', tool_input: { command: 'ls' } }, baseEnv(sidO));
    run('post-tool.mjs', { session_id: sidO, cwd: OUTSIDE, tool_name: 'Bash', tool_input: { command: 'ls' }, duration_ms: 5 }, baseEnv(sidO));
    const outsideEntries = fs.readdirSync(OUTSIDE);
    rec(4, '경계 밖', '무변화(outside 빈 폴더·상태 없음)', `entries=${outsideEntries.length} state=${fs.existsSync(stateFile(sidO))} tool=${fs.existsSync(toolFile(sidO))}`,
      outsideEntries.length === 0 && !fs.existsSync(stateFile(sidO)) && !fs.existsSync(toolFile(sidO)));
    fs.rmSync(toolFile(sid), { force: true });
    run('post-tool.mjs', { session_id: sid, cwd: a, agent_id: 'agent-abcdef123456', agent_type: 'Explore', tool_name: 'Read', tool_input: { file_path: 'C:/x/y.txt' }, duration_ms: 10 }, baseEnv(sid));
    ll = lastLine(logOf(a));
    rec(4, 'agent_id', '/\\[sub:/ · .tool 미생성', `${ll} | tool=${fs.existsSync(toolFile(sid))}`, /\[sub:/.test(ll) && !fs.existsSync(toolFile(sid)));
    const sidA = sidNew(); const ax = P('p4x'); fs.mkdirSync(ax, { recursive: true });
    run('pre-tool.mjs', { session_id: sidA, cwd: ax, agent_id: 'agent-zz', tool_name: 'Bash', tool_input: { command: 'ls' } }, baseEnv(sidA));
    rec(4, 'agent_id+상태 없음', '무기록', `history=${fs.existsSync(path.join(ax, HD))}`, !fs.existsSync(path.join(ax, HD)));
    const procs = [];
    for (let i = 0; i < 5; i++) procs.push(runAsync('post-tool.mjs', { session_id: sid, cwd: a, tool_name: 'Bash', tool_input: { command: `echo ${i}` }, duration_ms: 100 + i }, baseEnv(sid)));
    const rs = await Promise.all(procs);
    const st = readJson(stateFile(sid));
    rec(4, 'Post 5개 동시', '.tool 존재·상태 JSON 유효·exit 0×5', `tool=${fs.existsSync(toolFile(sid))} json=${!!st} codes=${rs.map((x) => x.code).join(',')}`,
      fs.existsSync(toolFile(sid)) && !!st && rs.every((x) => x.code === 0));
    const sidY = sidNew(); const ay = P('p4y'); fs.mkdirSync(ay, { recursive: true });
    run('pre-tool.mjs', { session_id: sidY, cwd: OUTSIDE, tool_name: 'Bash', tool_input: { command: 'echo y' } }, baseEnv(sidY, { CLAUDE_PROJECT_DIR: ay }));
    rec(4, '(수정·§14.1-5) 상태 없음+PROJECT_DIR in+cwd 경계 밖', '무기록(PROJECT_DIR 미사용)·상태 없음',
      `history=${fs.existsSync(path.join(ay, HD))} state=${fs.existsSync(stateFile(sidY))} outside=${fs.readdirSync(OUTSIDE).length}`,
      !fs.existsSync(path.join(ay, HD)) && !fs.existsSync(stateFile(sidY)) && fs.readdirSync(OUTSIDE).length === 0);
    const sidZ = sidNew(); const az = P('p4z'); fs.mkdirSync(az, { recursive: true });
    run('pre-tool.mjs', { session_id: sidZ, cwd: az, tool_name: 'Bash', tool_input: { command: 'echo z' } }, baseEnv(sidZ, { CLAUDE_PROJECT_DIR: OUTSIDE }));
    run('stop.mjs', { session_id: sidZ, cwd: az, last_assistant_message: 'z' }, baseEnv(sidZ, { CLAUDE_PROJECT_DIR: OUTSIDE }));
    const stZ = readJson(stateFile(sidZ));
    rec(4, '(수정·§14.1-4) 상태 없음+PROJECT_DIR 경계 밖+cwd 경계 안', '기록됨(▶ echo z·Turn-end z)·상태 파일 생성(anchor=cwd)',
      `pre=${/▶ \[Bash\] echo z$/m.test(logOf(az))} end=${/\[Turn-end\] z$/m.test(logOf(az))} anchor=${stZ && stZ.anchor}`,
      /▶ \[Bash\] echo z$/m.test(logOf(az)) && /\[Turn-end\] z$/m.test(logOf(az)) && stZ && stZ.anchor === C.normalizeWinPath(az));
    const sidW = sidNew(); const aw = P('p4w'); fs.mkdirSync(aw, { recursive: true });
    run('pre-tool.mjs', { session_id: sidW, cwd: aw, tool_name: 'Bash', tool_input: { command: 'echo w' } }, baseEnv(sidW));
    rec(4, '(추가) 상태 없음+PROJECT_DIR 없음+cwd 경계 안', '기록됨', lastLine(logOf(aw)), /▶ \[Bash\] echo w$/.test(lastLine(logOf(aw))));
    const sidV = sidNew(); const av = P('p4v'); fs.mkdirSync(av, { recursive: true });
    const rv = run('prompt-submit.mjs', { session_id: sidV, cwd: av, prompt: 'hi' }, baseEnv(sidV, { CLAUDE_PROJECT_DIR: av }));
    rec(4, '(수정·§14.1-2) prompt-submit 상태 없음+cwd 경계 안', '상태 생성·/STATUS:BEGIN/ 주입·[User] 기록', `out='${rv.out.slice(0, 60)}' state=${fs.existsSync(stateFile(sidV))} | ${lastLine(logOf(av))}`,
      /STATUS:BEGIN/.test(rv.out) && fs.existsSync(stateFile(sidV)) && /\[User\] hi$/.test(lastLine(logOf(av))));
  }

  // ---------- 5행 stop ----------
  const stop = (sid, a, extra = {}, envOver = {}) => run('stop.mjs', { session_id: sid, cwd: a, transcript_path: '', stop_hook_active: false, ...extra }, baseEnv(sid, envOver));
  {
    const a = P('p5a'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: `완료했습니다.\n${block('A')}` });
    const s = statusOf(a) || '';
    rec(5, '(a) 블록→STATUS', 'AC-2 정규식·4제목', s.slice(0, 120), AC2.test(s) && hasAll4(s) && r.out === '');
    rec(5, '(a) Turn-end', '/\\[Turn-end\\] STATUS 갱신/', lastLine(logOf(a)), /\[Turn-end\] STATUS 갱신/.test(lastLine(logOf(a))));
    rec(5, '(a) .tool 삭제', '.tool 없음', `tool=${fs.existsSync(toolFile(sid))}`, !fs.existsSync(toolFile(sid)));
  }
  {
    const a = P('p5b'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: '블록 없는 답변' });
    const st = readJson(stateFile(sid));
    rec(5, '(b) 블록 없음·.tool', BLOCK_RE.source, r.out.slice(0, 120), BLOCK_RE.test(r.out));
    rec(5, '(b) blockedAt·.tool 유지', 'blockedAt≠null·.tool 존재', `blockedAt=${st && st.blockedAt} tool=${fs.existsSync(toolFile(sid))}`, st && st.blockedAt && fs.existsSync(toolFile(sid)));
    const r2 = stop(sid, a, { last_assistant_message: '여전히 블록 없음' });
    const st2 = readJson(stateFile(sid));
    rec(5, '(c) 2회차', '무출력·.tool 삭제·blockedAt=null', `out='${r2.out}' tool=${fs.existsSync(toolFile(sid))} blockedAt=${st2 && st2.blockedAt}`,
      r2.out === '' && !fs.existsSync(toolFile(sid)) && st2 && st2.blockedAt === null);
  }
  {
    const a = P('p5d'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { stop_hook_active: true, last_assistant_message: `재작성\n${block('D')}` });
    const s = statusOf(a) || '';
    rec(5, '(d) stop_hook_active', '무출력·STATUS 갱신·마커 정리', `out='${r.out}' status=${/- D 하던 일/.test(s)} tool=${fs.existsSync(toolFile(sid))}`,
      r.out === '' && /- D 하던 일/.test(s) && !fs.existsSync(toolFile(sid)));
  }
  const excCases = [
    ['(e) stop_reason context_limit', { stop_reason: 'context_limit' }],
    ['(f) user_requested', { user_requested: true }],
    ['(g) stop_reason token_expired', { stop_reason: 'token_expired' }],
    ['(h) stop_reason scheduled_wakeup', { stop_reason: 'scheduled_wakeup' }],
    ['(i) end_turn_reason max_tokens', { end_turn_reason: 'max_tokens' }],
  ];
  for (const [name, extra] of excCases) {
    const a = P(`p5${name[1]}`); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: '블록 없음', ...extra });
    rec(5, name, '무출력', `out='${r.out}'`, r.out === '');
  }
  {
    const a = P('p5j'); const sid = startSession(a); arm(sid);
    const tp = path.join(SCRATCH, 'transcript-96.jsonl');
    fs.writeFileSync(tp, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 96000 } }, context_window: 100000 })}\n`);
    const r = stop(sid, a, { last_assistant_message: '블록 없음', transcript_path: tp });
    rec(5, '(j) transcript 96%', '무출력', `out='${r.out}'`, r.out === '');
  }
  {
    const sid = sidNew(); const a = P('p5k'); fs.mkdirSync(a, { recursive: true });
    const r = stop(sid, a, { last_assistant_message: '안녕' });
    rec(5, '(k·수정) 상태 파일 없음+cwd 경계 안', '무출력·Turn-end 기록·상태 생성', `out='${r.out}' state=${fs.existsSync(stateFile(sid))} | ${lastLine(logOf(a))}`,
      r.out === '' && /\[Turn-end\] 안녕$/.test(lastLine(logOf(a))) && fs.existsSync(stateFile(sid)));
    const sid2 = sidNew(); const a2 = P('p5k2'); fs.mkdirSync(a2, { recursive: true });
    const r2 = stop(sid2, OUTSIDE, { last_assistant_message: '안녕' }, { CLAUDE_PROJECT_DIR: a2 });
    rec(5, '(k·추가) 상태 없음+cwd 경계 밖+PROJECT_DIR in', '무출력·무기록', `out='${r2.out}' history=${fs.existsSync(path.join(a2, HD))}`,
      r2.out === '' && !fs.existsSync(path.join(a2, HD)) && !fs.existsSync(stateFile(sid2)));
  }
  {
    const a = P('p5l'); const sid = startSession(a);
    const r = stop(sid, a, { last_assistant_message: '블록 없음' });
    rec(5, '(l) .tool 없음·블록 없음', '무출력', `out='${r.out}'`, r.out === '');
  }
  {
    const a = P('p5m'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: '블록 없음' }, { AUTO_HISTORY_CONF_DIR: CONF_NOBLOCK });
    rec(5, '(m) NO_BLOCK 파일', '무출력', `out='${r.out}'`, r.out === '');
  }
  {
    const a = P('p5n'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: '블록 없음' }, { AUTO_HISTORY_NO_BLOCK: '1' });
    rec(5, '(n) AUTO_HISTORY_NO_BLOCK=1', '무출력', `out='${r.out}'`, r.out === '');
  }
  {
    const a = P('p5o'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: `x\n${block('O')}` }, { AUTO_HISTORY_DISABLE: '1' });
    const hist = fs.existsSync(path.join(a, HD));
    rec(5, '(o) AUTO_HISTORY_DISABLE=1', '무출력·무기록', `out='${r.out}' history=${hist} tool=${fs.existsSync(toolFile(sid))}`, r.out === '' && !hist && fs.existsSync(toolFile(sid)));
  }
  {
    const sid = sidNew();
    const r = stop(sid, OUTSIDE, { last_assistant_message: `x\n${block('P')}` });
    rec(5, '(p) 앵커 경계 밖', '무출력·무변화', `out='${r.out}' entries=${fs.readdirSync(OUTSIDE).length}`, r.out === '' && fs.readdirSync(OUTSIDE).length === 0);
  }
  const statusCase = (id, msg, check, expect) => {
    const a = P(`p5${id}`); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: msg });
    const s = statusOf(a);
    const ll = logOf(a);
    rec(5, expect[0], expect[1], `status=${s === null ? 'null' : JSON.stringify(s.slice(s.indexOf('\n\n') + 2, s.indexOf('\n\n') + 60))} | ${lastLine(ll).slice(0, 80)}`, check(s, ll, r));
  };
  statusCase('q', `서두\n인용:\n${block('QUOTE')}\n설명 1\n설명 2\n설명 3\n설명 4\n마무리\n${block('TAIL')}`,
    (s) => s && /TAIL/.test(s) && !/QUOTE/.test(s), ['(q) 중간 인용+꼬리 블록', '꼬리(TAIL)만']);
  statusCase('r', `x\n${block('FIRST')}\n${block('SECOND')}`, (s) => s && /SECOND/.test(s) && !/FIRST/.test(s), ['(r) 블록 2개', '마지막(SECOND)']);
  statusCase('s', `x\n\`\`\`\n${block('FENCED')}\n\`\`\``, (s) => s && /FENCED/.test(s) && !/```/.test(s) && hasAll4(s), ['(s) 펜스 안', '추출·펜스 제거']);
  statusCase('t', 'x\n<!-- STATUS:BEGIN -->\n## 하던 일\n- 끝 없음', (s, ll) => s === null && !/STATUS 갱신/.test(ll), ['(t) END 없음', '블록 없음(STATUS.md 미생성)']);
  statusCase('u', `x\r\n${block('CRLF', { crlf: true })}\r\n`, (s) => s && /CRLF/.test(s) && !/\r/.test(s) && hasAll4(s), ['(u) CRLF', '정상 추출·\\r 없음']);
  statusCase('v', `x\n${block('V')}\n${'가'.repeat(60)}\n${'나'.repeat(60)}`, (s, ll) => s && /V 하던 일/.test(s) && /꼬리 텍스트 허용/.test(ll),
    ['(v) END 뒤 2줄 120자', '추출+/꼬리 텍스트 허용/']);
  statusCase('w', `x\n${block('W')}\n1\n2\n3\n4\n5`, (s) => s === null, ['(w) END 뒤 5줄', '블록 없음']);
  statusCase('x', `x\n${block('AIzaSyA1234567890abcdefghijklmnopqrstuv')}`, (s) => s && /\*\*\*/.test(s) && !/AIzaSy/.test(s), ['(x) AIza 마스킹', '/\\*\\*\\*/·AIza 없음']);
  statusCase('y', `x\n${block('Y', { drop: '진행도' })}`, (s, ll) => s && /형식 불완전\(누락: 진행도\)/.test(ll), ['(y) 제목 누락', '/형식 불완전\\(누락: /']);
  {
    const a = P('p5z'); const sid = startSession(a);
    const r = stop(sid, a, { last_assistant_message: '' });
    rec(5, '(z) 빈 메시지·transcript 없음', '/\\(메시지 미확보\\)/', lastLine(logOf(a)), r.code === 0 && /\(메시지 미확보\)/.test(lastLine(logOf(a))));
  }
  {
    const a = P('p5aa'); const sid = startSession(a);
    const tp = path.join(SCRATCH, 'transcript-aa.jsonl');
    const lines = [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `답\n${block('TRANSCRIPT')}` }] } },
    ];
    fs.writeFileSync(tp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    stop(sid, a, { transcript_path: tp });
    const s = statusOf(a);
    rec(5, '(aa) transcript 꼬리 assistant', 'STATUS에 TRANSCRIPT', s ? s.slice(0, 80) : 'null', s && /TRANSCRIPT 하던 일/.test(s));
  }
  {
    const a = P('p5ab'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: '블록 없음 ab' }, { CLAUDE_CODE_ENTRYPOINT: 'session-summary' });
    rec(5, '(ab) session-summary', '무출력·Turn-end 기록', `out='${r.out}' | ${lastLine(logOf(a))}`, r.out === '' && /\[Turn-end\] 블록 없음 ab$/.test(lastLine(logOf(a))));
  }
  {
    const a = P('p5ac'); const sid = startSession(a); arm(sid);
    const r = stop(sid, a, { last_assistant_message: '블록 없음 ac' }, { CLAUDE_CODE_SESSION_ID: 'ffffffff-0000' });
    rec(5, '(ac) env SESSION_ID≠stdin', '무출력·Turn-end 기록', `out='${r.out}' | ${lastLine(logOf(a))}`, r.out === '' && /\[Turn-end\] 블록 없음 ac$/.test(lastLine(logOf(a))));
  }
  {
    const sid = sidNew();
    const r1 = run('stop.mjs', '{"session_id": broken', baseEnv(sid));
    const r2 = run('stop.mjs', '', baseEnv(sid));
    const r3 = await runAsync('stop.mjs', null, baseEnv(sid), true);
    rec(5, '(ad) 손상/빈/타임아웃 stdin', 'exit 0·무출력(타임아웃 ≤3초)', `codes=${r1.code},${r2.code},${r3.code} outs='${r1.out}${r2.out}${r3.out}' timeoutMs=${r3.ms}`,
      r1.code === 0 && r2.code === 0 && r3.code === 0 && !(r1.out + r2.out + r3.out) && r3.ms < 3000);
    for (const sc of ['session-start.mjs', 'prompt-submit.mjs', 'pre-tool.mjs', 'post-tool.mjs']) {
      const x = run(sc, '{bad', baseEnv(sid)); const y = run(sc, '', baseEnv(sid));
      rec(5, `(ad 추가) ${sc} 손상/빈 stdin`, 'exit 0·무출력', `codes=${x.code},${y.code} out='${x.out}${y.out}'`, x.code === 0 && y.code === 0 && !(x.out + y.out));
    }
  }
  {
    const a = P('p5ae'); const sid = startSession(a); arm(sid);
    const r1 = stop(sid, a, { last_assistant_message: `x\n${block('AE')}` });
    const r2 = stop(sid, a, { last_assistant_message: '알림 턴 응답(블록 없음)' });
    rec(5, '(ae) 통과 후 Prompt 없는 Stop', '무출력×2', `out1='${r1.out}' out2='${r2.out}'`, r1.out === '' && r2.out === '');
  }

  // ---------- 6행 install 사본 왕복 ----------
  {
    const copy = path.join(SCRATCH, 'settings-copy.json');
    if (process.argv[3]) fs.copyFileSync(process.argv[3], copy);
    else fs.writeFileSync(copy, JSON.stringify({ permissions: { allow: ['Read'] }, model: 'test-model' }, null, 2) + '\n');
    const orig = fs.readFileSync(copy, 'utf-8');
    const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args, '--settings', copy], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_LANG: 'ko' }) });
    const d = inst(['--install', '--dry-run']);
    rec(6, 'dry-run 무변경', '파일 내용 동일', `same=${fs.readFileSync(copy, 'utf-8') === orig} code=${d.status}`, fs.readFileSync(copy, 'utf-8') === orig && d.status === 0);
    const i1 = inst(['--install']);
    let o1 = {}; try { o1 = JSON.parse(i1.stdout); } catch { /* */ }
    const afterI = readJson(copy) || {};
    const evs = afterI.hooks ? Object.keys(afterI.hooks) : [];
    rec(6, 'install', '6 이벤트·hooks 외 키/값 동일·백업 존재', `events=${evs.join(',')} keysEq=${o1.nonHooksKeysEqual} valsEq=${o1.nonHooksValuesEqual} backup=${o1.backup && fs.existsSync(o1.backup)}`,
      evs.length === 6 && o1.nonHooksValuesEqual === true && o1.backup && fs.existsSync(o1.backup));
    inst(['--install']);
    const afterI2 = readJson(copy) || {};
    const counts = Object.values(afterI2.hooks || {}).map((g) => g.length);
    rec(6, '재설치 멱등', '이벤트당 1그룹', counts.join(','), counts.length === 6 && counts.every((c) => c === 1));
    const u = inst(['--uninstall']);
    const afterU = readJson(copy) || {};
    rec(6, 'install→uninstall 왕복', '키 집합·값 원본과 동일·hooks 키 없음', `equal=${JSON.stringify(afterU) === JSON.stringify(JSON.parse(orig))} hooks=${'hooks' in afterU} code=${u.status}`,
      JSON.stringify(afterU) === JSON.stringify(JSON.parse(orig)) && !('hooks' in afterU));
    // 기존 타 훅이 있는 경우 보존
    const withForeign = { ...JSON.parse(orig), hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo foreign' }] }] } };
    fs.writeFileSync(copy, JSON.stringify(withForeign, null, 2) + '\n');
    inst(['--install']);
    const mid = readJson(copy) || {};
    inst(['--uninstall']);
    const fin = readJson(copy) || {};
    rec(6, '(추가) 타 훅 보존 왕복', 'Stop 2그룹→foreign만 복귀', `mid=${(mid.hooks && mid.hooks.Stop || []).length} equal=${JSON.stringify(fin) === JSON.stringify(withForeign)}`,
      (mid.hooks && mid.hooks.Stop || []).length === 2 && JSON.stringify(fin) === JSON.stringify(withForeign));
  }

  // ---------- 7행 변경 2 (§14.4) — AUTO_HISTORY_ROOT=ROOT2, 홈 역할=OUTSIDE ----------
  {
    const e2 = (sid, over = {}) => baseEnv(sid, { AUTO_HISTORY_ROOT: ROOT2, ...over });
    const R = (rel) => path.join(ROOT2, rel);
    const N = (rel) => C.normalizeWinPath(R(rel));
    const mkProj = (rel, status) => {
      fs.mkdirSync(path.join(R(rel), HD), { recursive: true });
      if (status) fs.writeFileSync(path.join(R(rel), HD, 'STATUS.md'), `# STATUS\n세션: 12345678\n갱신: 2026-10-08 10:00:00\n앵커: x\n\n## 하던 일\n- ${status}\n`);
    };
    mkProj('MyMemo', 'MYMEMO_MARK'); mkProj('tauko', 'TAUKO_MARK'); mkProj('tauko-work', 'TW_MARK');
    mkProj(path.join('grp', 'policy'), 'POLICY_MARK'); mkProj('미래세상', 'MIRAE_MARK');
    mkProj('nostatus', null); mkProj('.hidden', 'HIDDEN'); mkProj('node_modules', 'NM'); mkProj(path.join('deep', 'a', 'b'), 'DEEP');
    for (const d of ['proj_b', 'proj_c', 'A', path.join('A', 'sub'), 'B', 'proj_k', 'proj_l']) fs.mkdirSync(R(d), { recursive: true });
    const ctxOf = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
    const anchorOf = (sid) => { const st = readJson(stateFile(sid)); return st && st.anchor; };
    const has = (rel) => fs.existsSync(path.join(R(rel), HD));
    const outsideClean = () => fs.readdirSync(OUTSIDE).length === 0;

    // (a) 홈 cwd + "MyMemo 이어서"
    {
      const sid = sidNew();
      const r0 = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: OUTSIDE }, e2(sid));
      const r = run('prompt-submit.mjs', { session_id: sid, cwd: OUTSIDE, prompt: 'MyMemo 프로젝트 최근에 뭐 했어? 이어서 해줘' }, e2(sid));
      const ctx = ctxOf(r.out); const log = logOf(R('MyMemo'));
      rec(7, '(a) 홈 cwd+"MyMemo 이어서"', `anchor=${N('MyMemo')}·주입 STATUS(MYMEMO_MARK)·[현황]·STATUS:BEGIN·로그 [anchor] 지정·홈 무생성`,
        `start='${r0.out}' anchor=${anchorOf(sid)} mark=${/MYMEMO_MARK/.test(ctx)} 현황=${/\[현황\]/.test(ctx)} begin=${/STATUS:BEGIN/.test(ctx)} 지정=${log.includes(`[anchor] 지정 ${N('MyMemo')}`)} outside=${fs.readdirSync(OUTSIDE).length}`,
        r0.out === '' && anchorOf(sid) === N('MyMemo') && /MYMEMO_MARK/.test(ctx) && /\[현황\]/.test(ctx) && /STATUS:BEGIN/.test(ctx)
          && /요청에 언급된 프로젝트 `MyMemo`/.test(ctx) && log.includes(`[anchor] 지정 ${N('MyMemo')}`) && /\[User\] MyMemo 프로젝트/.test(log) && outsideClean());
      const r2 = run('prompt-submit.mjs', { session_id: sid, cwd: OUTSIDE, prompt: 'MyMemo 계속 진행' }, e2(sid));
      const ctx2 = ctxOf(r2.out); const n = (logOf(R('MyMemo')).match(/\[anchor\]/g) || []).length;
      rec(7, '(a-2) 같은 앵커 재언급', 'Reader 생략(MYMEMO_MARK 없음)·지시(STATUS:BEGIN)만·[anchor] 줄 1개 유지',
        `mark=${/MYMEMO_MARK/.test(ctx2)} begin=${/STATUS:BEGIN/.test(ctx2)} anchorLines=${n}`, !/MYMEMO_MARK/.test(ctx2) && /STATUS:BEGIN/.test(ctx2) && n === 1);
      run('pre-tool.mjs', { session_id: sid, cwd: OUTSIDE, tool_name: 'Bash', tool_input: { command: 'echo a3' } }, e2(sid));
      rec(7, '(a-3) 이후 도구(cwd 홈)', 'MyMemo 로그에 ▶ echo a3·홈 무생성', lastLine(logOf(R('MyMemo'))), /▶ \[Bash\] echo a3$/.test(lastLine(logOf(R('MyMemo')))) && outsideClean());
    }
    // (b) 언급 없음 + cwd 경계 안
    {
      const sid = sidNew();
      const r = run('prompt-submit.mjs', { session_id: sid, cwd: R('proj_b'), prompt: '빌드해줘' }, e2(sid));
      const ctx = ctxOf(r.out);
      rec(7, '(b) 언급 없음+cwd 경계 안', `anchor=${N('proj_b')}·지시만`, `anchor=${anchorOf(sid)} begin=${/STATUS:BEGIN/.test(ctx)} reader=${/언급된 프로젝트/.test(ctx)}`,
        anchorOf(sid) === N('proj_b') && /STATUS:BEGIN/.test(ctx) && !/언급된 프로젝트/.test(ctx) && /\[User\] 빌드해줘$/.test(lastLine(logOf(R('proj_b')))));
    }
    // (c) Post, 상태 없음, cwd 경계 안
    {
      const sid = sidNew();
      run('post-tool.mjs', { session_id: sid, cwd: R('proj_c'), tool_name: 'Bash', tool_input: { command: 'echo c' }, duration_ms: 10 }, e2(sid));
      rec(7, '(c) Post·상태 없음·cwd 경계 안', `anchor=${N('proj_c')}·✓ 기록·.tool 생성`, `anchor=${anchorOf(sid)} tool=${fs.existsSync(toolFile(sid))} | ${lastLine(logOf(R('proj_c')))}`,
        anchorOf(sid) === N('proj_c') && fs.existsSync(toolFile(sid)) && /✓ \[Bash\] echo c \(0\.0s\)$/.test(lastLine(logOf(R('proj_c')))));
    }
    // (d) 상태 앵커 A + Pre/Post/Stop cwd=B → A 유지,  (e) UserPromptSubmit cwd=B → B 로 변경
    {
      const sid = sidNew();
      run('prompt-submit.mjs', { session_id: sid, cwd: R('A'), prompt: '작업 시작' }, e2(sid));
      run('pre-tool.mjs', { session_id: sid, cwd: R('B'), tool_name: 'Bash', tool_input: { command: 'echo d' } }, e2(sid));
      run('post-tool.mjs', { session_id: sid, cwd: R('B'), tool_name: 'Bash', tool_input: { command: 'echo d' }, duration_ms: 5 }, e2(sid));
      run('stop.mjs', { session_id: sid, cwd: R('B'), last_assistant_message: '턴 끝 d', stop_hook_active: false }, e2(sid));
      const la = logOf(R('A'));
      rec(7, '(d) 상태 A + Pre/Post/Stop cwd=B', `anchor=${N('A')} 유지·B 무생성·A 에 ▶·✓·Turn-end`,
        `anchor=${anchorOf(sid)} B=${has('B')} pre=${/▶ \[Bash\] echo d$/m.test(la)} post=${/✓ \[Bash\] echo d/.test(la)} end=${/\[Turn-end\] 턴 끝 d$/m.test(la)}`,
        anchorOf(sid) === N('A') && !has('B') && /▶ \[Bash\] echo d$/m.test(la) && /✓ \[Bash\] echo d/.test(la) && /\[Turn-end\] 턴 끝 d$/m.test(la));
      run('prompt-submit.mjs', { session_id: sid, cwd: R('B'), prompt: '다음 작업' }, e2(sid));
      const lb = logOf(R('B'));
      rec(7, '(e) UserPromptSubmit cwd=B', `anchor=${N('B')}·B 로그 [anchor] 변경 A→B`, `anchor=${anchorOf(sid)} | ${lb.split('\n')[0]}`,
        anchorOf(sid) === N('B') && lb.includes(`[anchor] 변경 ${N('A')}→${N('B')}`) && /\[User\] 다음 작업$/.test(lastLine(lb)));
    }
    const projects = C.listHistoryProjects({ AUTO_HISTORY_ROOT: ROOT2 });
    const names = projects.map((p) => p.name).sort();
    const m = (s) => { const p = C.matchProjectMention(s, projects); return p ? p.name : null; }; // 통일 규칙(2d): 키워드 필요
    // (f) <agent-message 등 시작 → 매칭 안 함
    {
      const sid = sidNew();
      const r = run('prompt-submit.mjs', { session_id: sid, cwd: OUTSIDE, prompt: '<agent-message from="x">MyMemo 이어서</agent-message>' }, e2(sid));
      const leaked = logOf(R('MyMemo')).includes(`[${sid.slice(0, 8)}]`);
      rec(7, '(f) <agent-message 시작', '매칭 없음·무출력·상태 없음·MyMemo 로그 무기록', `out='${r.out}' state=${fs.existsSync(stateFile(sid))} leaked=${leaked}`,
        r.out === '' && !fs.existsSync(stateFile(sid)) && !leaked && outsideClean());
      const f2 = [m('<task-notification>MyMemo done</task-notification>'), m('<system-reminder>MyMemo</system-reminder>'), m('  <agent-message>MyMemo')];
      rec(7, '(f-2) <task-notification·<system·앞 공백 <agent-message', 'null,null,null', f2.map(String).join(','), f2.every((x) => x === null));
    }
    // (g) policyholder ≠ policy, 미래세상 부분 매칭
    {
      const got = [m('policyholder 프로젝트 정리'), m('policy 프로젝트 정리'), m('미래세상 프로젝트에서 이어서'), m('MyMemo 폴더를 이어서'), m('mymemo 프로젝트 이어서'), m('xMyMemo 프로젝트 이어서')].map(String);
      const want = ['null', 'policy', '미래세상', 'MyMemo', 'MyMemo', 'null'];
      rec(7, '(g) 단어 경계·한글 부분', want.join(','), got.join(','), got.join(',') === want.join(','));
    }
    // (h) tauko·tauko-work 최장 우선
    {
      const got = [m('tauko-work 프로젝트 이어서'), m('tauko 프로젝트 이어서'), m('Tauko-Work 프로젝트 랑 tauko 비교')].map(String);
      const sid = sidNew();
      run('prompt-submit.mjs', { session_id: sid, cwd: OUTSIDE, prompt: 'tauko-work 프로젝트 이어서 해줘' }, e2(sid));
      rec(7, '(h) 최장 우선', `tauko-work,tauko,tauko-work·훅 anchor=${N('tauko-work')}`, `${got.join(',')} anchor=${anchorOf(sid)}`,
        got.join(',') === 'tauko-work,tauko,tauko-work' && anchorOf(sid) === N('tauko-work'));
    }
    // (i) STATUS.md 없는 폴더·점 폴더·node_modules·깊이 3 제외
    {
      const want = ['MyMemo', 'policy', 'tauko', 'tauko-work', '미래세상'].sort().join(',');
      const pol = projects.find((p) => p.name === 'policy');
      rec(7, '(i) 후보 목록', `${want} (nostatus·.hidden·node_modules·깊이3 제외, policy=깊이2)`, names.join(','),
        names.join(',') === want && m('nostatus 해줘') === null && pol && pol.anchor === N(path.join('grp', 'policy')));
      const bad = C.listHistoryProjects({ AUTO_HISTORY_ROOT: path.join(SCRATCH, 'no-such-root') });
      rec(7, '(i-2) 루트 없음', '[]', JSON.stringify(bad), Array.isArray(bad) && bad.length === 0);
    }
    // (j) cwd 가 앵커 하위 → 앵커 유지
    {
      const sid = sidNew();
      run('prompt-submit.mjs', { session_id: sid, cwd: R('A'), prompt: 'j 시작' }, e2(sid));
      run('prompt-submit.mjs', { session_id: sid, cwd: R(path.join('A', 'sub')), prompt: 'j 하위에서' }, e2(sid));
      const r = run('session-start.mjs', { session_id: sid, source: 'clear', cwd: R(path.join('A', 'sub')) }, e2(sid));
      const changed = logOf(R('A')).split('\n').some((l) => l.includes(`[${sid.slice(0, 8)}]`) && l.includes('[anchor]'));
      rec(7, '(j) cwd=앵커\\sub (Prompt·SessionStart clear)', `anchor=${N('A')} 유지·변경 줄 없음·sub 무생성`,
        `anchor=${anchorOf(sid)} changed=${changed} sub=${has(path.join('A', 'sub'))} startOut=${r.out.length > 0}`,
        anchorOf(sid) === N('A') && !changed && !has(path.join('A', 'sub')) && /\[User\] j 하위에서$/m.test(logOf(R('A'))));
    }
    // (k) 비대화형(sdk-cli) → 매칭 주입 없음, 기록은 함
    {
      const sid = sidNew();
      const r = run('prompt-submit.mjs', { session_id: sid, cwd: R('proj_k'), prompt: 'MyMemo 이어서 k' }, e2(sid, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }));
      const leaked = logOf(R('MyMemo')).includes(`[${sid.slice(0, 8)}]`);
      rec(7, '(k) sdk-cli', `무출력·anchor=${N('proj_k')}(cwd)·proj_k 에 [User]·MyMemo 무기록`, `out='${r.out}' anchor=${anchorOf(sid)} leaked=${leaked} | ${lastLine(logOf(R('proj_k')))}`,
        r.out === '' && anchorOf(sid) === N('proj_k') && !leaked && /\[User\] MyMemo 이어서 k$/.test(lastLine(logOf(R('proj_k')))));
    }
    // (l) agent_id + 상태 없음 → 무기록
    {
      const sid = sidNew();
      const r1 = run('prompt-submit.mjs', { session_id: sid, cwd: R('proj_l'), agent_id: 'agent-l1', prompt: 'MyMemo 이어서 l' }, e2(sid));
      const r2 = run('pre-tool.mjs', { session_id: sid, cwd: R('proj_l'), agent_id: 'agent-l1', tool_name: 'Bash', tool_input: { command: 'echo l' } }, e2(sid));
      const leaked = logOf(R('MyMemo')).includes(`[${sid.slice(0, 8)}]`);
      rec(7, '(l) agent_id+상태 없음', '무출력·무기록·상태 없음', `out='${r1.out}${r2.out}' state=${fs.existsSync(stateFile(sid))} proj_l=${has('proj_l')} leaked=${leaked}`,
        r1.out === '' && r2.out === '' && !fs.existsSync(stateFile(sid)) && !has('proj_l') && !leaked);
    }
    // (m)(n) lastCwd: cwd 규칙은 cwd 가 실제로 바뀌었을 때만
    {
      fs.mkdirSync(R('teacher'), { recursive: true });
      const sid = sidNew();
      run('prompt-submit.mjs', { session_id: sid, cwd: R('tauko'), prompt: '시작 m' }, e2(sid));
      const st0 = readJson(stateFile(sid));
      run('prompt-submit.mjs', { session_id: sid, cwd: R('tauko'), prompt: 'MyMemo 프로젝트 이어서' }, e2(sid));
      const a1 = anchorOf(sid);
      run('prompt-submit.mjs', { session_id: sid, cwd: R('tauko'), prompt: '계속 진행해줘 m2' }, e2(sid));
      const a2 = anchorOf(sid); const st2 = readJson(stateFile(sid));
      rec(7, '(m) anchor=tauko·lastCwd=tauko → "MyMemo 이어서" → 언급 없는 요청(cwd 불변)', `초기 anchor·lastCwd=${N('tauko')}, 이후 MyMemo, MyMemo 유지`,
        `init=${st0 && st0.anchor}/${st0 && st0.lastCwd} a1=${a1} a2=${a2} lastCwd=${st2 && st2.lastCwd}`,
        !!st0 && st0.anchor === N('tauko') && st0.lastCwd === N('tauko') && a1 === N('MyMemo') && a2 === N('MyMemo') && st2.lastCwd === N('tauko'));
      run('prompt-submit.mjs', { session_id: sid, cwd: R('teacher'), prompt: 'n 다른 폴더에서' }, e2(sid));
      const a3 = anchorOf(sid); const st3 = readJson(stateFile(sid)); const lt = logOf(R('teacher'));
      rec(7, '(n) 같은 상태에서 cwd 가 teacher 로 실제 변경', `anchor=${N('teacher')}·teacher 로그 [anchor] 변경 ${N('MyMemo')}→${N('teacher')}·lastCwd 갱신`,
        `anchor=${a3} lastCwd=${st3 && st3.lastCwd} | ${lt.split('\n')[0]}`,
        a3 === N('teacher') && st3.lastCwd === N('teacher') && lt.includes(`[anchor] 변경 ${N('MyMemo')}→${N('teacher')}`));
    }
    // (o) 구버전 상태 파일(lastCwd 없음)
    {
      const sid = sidNew();
      fs.writeFileSync(stateFile(sid), JSON.stringify({ anchor: N('MyMemo'), promptAt: null, blockedAt: null, createdAt: '2026-10-08T00:00:00.000Z' }));
      const r = run('prompt-submit.mjs', { session_id: sid, cwd: R('tauko'), prompt: 'o 구버전 상태' }, e2(sid));
      const st = readJson(stateFile(sid));
      rec(7, '(o) 구버전 상태(lastCwd 없음)', `exit 0·현재 규칙대로 anchor=${N('tauko')}·lastCwd 채워짐`,
        `code=${r.code} anchor=${st && st.anchor} lastCwd=${st && st.lastCwd} err='${r.err.slice(0, 80)}'`,
        r.code === 0 && !!st && st.anchor === N('tauko') && st.lastCwd === N('tauko'));
      const sid2 = sidNew();
      fs.writeFileSync(stateFile(sid2), JSON.stringify({ anchor: N('tauko'), promptAt: null, blockedAt: null, createdAt: '2026-10-08T00:00:00.000Z' }));
      run('prompt-submit.mjs', { session_id: sid2, cwd: R('tauko'), prompt: 'o2 구버전 동일 cwd' }, e2(sid2));
      const st2 = readJson(stateFile(sid2));
      rec(7, '(o-2) 구버전 상태·cwd=앵커', 'anchor 유지·lastCwd 채워짐', `anchor=${st2 && st2.anchor} lastCwd=${st2 && st2.lastCwd}`,
        !!st2 && st2.anchor === N('tauko') && st2.lastCwd === N('tauko'));
    }
    // ---- (p)~(v) 변경 2c: 기록 없는 프로젝트를 "프로젝트/폴더" 키워드와 함께 지정 (§14.2 보강) ----
    {
      for (const d of ['teacher', 'X', path.join('X', 'web'), 'map']) fs.mkdirSync(R(d), { recursive: true });
      mkProj('tk', 'TK_MARK'); fs.mkdirSync(R('tk-work'), { recursive: true });
      const proj2 = C.listHistoryProjects({ AUTO_HISTORY_ROOT: ROOT2 });
      const cand2 = C.listCandidateFolders({ AUTO_HISTORY_ROOT: ROOT2 });
      const m2 = (s) => { const p = C.matchProjectMention(s, proj2, cand2); return p ? p.name : null; };
      const promptAt = (prompt, cwd = OUTSIDE) => { const sid = sidNew(); const r = run('prompt-submit.mjs', { session_id: sid, cwd, prompt }, e2(sid)); return { sid, r, ctx: ctxOf(r.out) }; };
      // (p)
      {
        const { sid, ctx } = promptAt('이제 teacher 프로젝트 봐줘');
        const log = logOf(R('teacher'));
        rec(7, '(p) 기록 없는 깊이1 teacher + "teacher 프로젝트"', `anchor=${N('teacher')}·로그 [anchor] 지정·주입 "기록이 없다"·[현황]·STATUS:BEGIN`,
          `anchor=${anchorOf(sid)} 지정=${log.includes(`[anchor] 지정 ${N('teacher')}`)} 없다=${/기록이 없다/.test(ctx)} 현황=${/\[현황\]/.test(ctx)} begin=${/STATUS:BEGIN/.test(ctx)} outside=${fs.readdirSync(OUTSIDE).length}`,
          anchorOf(sid) === N('teacher') && log.includes(`[anchor] 지정 ${N('teacher')}`) && /기록이 없다/.test(ctx) && /\[현황\]/.test(ctx) && /STATUS:BEGIN/.test(ctx) && outsideClean());
        const r2 = run('prompt-submit.mjs', { session_id: sid, cwd: OUTSIDE, prompt: 'teacher 프로젝트 계속' }, e2(sid));
        rec(7, '(p-2) 같은 앵커 재언급', '"기록이 없다" 생략·지시만', `없다=${/기록이 없다/.test(ctxOf(r2.out))} begin=${/STATUS:BEGIN/.test(ctxOf(r2.out))}`,
          !/기록이 없다/.test(ctxOf(r2.out)) && /STATUS:BEGIN/.test(ctxOf(r2.out)));
        const sidN = sidNew();
        const rn = run('prompt-submit.mjs', { session_id: sidN, cwd: OUTSIDE, prompt: 'teacher 프로젝트 봐줘' }, e2(sidN, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }));
        rec(7, '(p-3) 비대화형', '주입 없음', `out='${rn.out}'`, rn.out === '');
      }
      // (q)
      {
        const { sid, r } = promptAt('teacher 봐줘');
        rec(7, '(q) "teacher 봐줘"(키워드 없음)', '매칭 없음·앵커 불변(상태 없음)', `anchor=${anchorOf(sid)} out='${r.out.slice(0, 40)}' m=${m2('teacher 봐줘')}`,
          m2('teacher 봐줘') === null && !anchorOf(sid) && r.out === '');
      }
      // (r)
      {
        const a = m2('web 폴더 보여줘'); const b = m2('X 프로젝트'); const c = m2('web 프로젝트 보여줘');
        const { sid } = promptAt('X 프로젝트 봐줘');
        rec(7, '(r) 깊이2 X\web "web 폴더" 불가·"X 프로젝트" X', 'null,X,web(프로젝트는 허용)·anchor=X', `${a},${b},${c} anchor=${anchorOf(sid)}`,
          a === null && b === 'X' && c === 'web' && anchorOf(sid) === N('X'));
      }
      // (s)
      {
        const { sid, ctx } = promptAt('MyMemo 프로젝트 이어서 해줘');
        rec(7, '(s) 기록 있는 폴더도 키워드 필요(통일)', `"MyMemo 프로젝트"→anchor=${N('MyMemo')}·주입 STATUS(MYMEMO_MARK); "MyMemo 이어서"=null`, `anchor=${anchorOf(sid)} mark=${/MYMEMO_MARK/.test(ctx)} m=${m2('MyMemo 이어서')}`,
          anchorOf(sid) === N('MyMemo') && /MYMEMO_MARK/.test(ctx) && m2('MyMemo 이어서') === null && m2('MyMemo 프로젝트 이어서') === 'MyMemo');
      }
      // (t)
      {
        const { sid, r } = promptAt('지도(map) 문서 정리해줘');
        rec(7, '(t) 흔한 단어 폴더(map, 기록 없음) + 일상 문장', '매칭 없음', `m=${m2('지도(map) 문서 정리해줘')} anchor=${anchorOf(sid)} out='${r.out.slice(0, 30)}'`,
          m2('지도(map) 문서 정리해줘') === null && !anchorOf(sid) && r.out === '' && m2('map 폴더 열어줘') === 'map');
      }
      // (u)
      {
        const { sid, ctx } = promptAt('tk-work 프로젝트');
        rec(7, '(u) A tk(기록) + B tk-work(기록 없음) + "tk-work 프로젝트"', `tk-work(최장 우선)·anchor=${N('tk-work')}·기록 없음 주입; "tk 이어서"=tk`,
          `m=${m2('tk-work 프로젝트')} anchor=${anchorOf(sid)} 없다=${/기록이 없다/.test(ctx)} tk=${m2('tk 프로젝트')}`,
          m2('tk-work 프로젝트') === 'tk-work' && anchorOf(sid) === N('tk-work') && /기록이 없다/.test(ctx) && m2('tk 프로젝트') === 'tk');
      }
      // (v)
      {
        const { sid } = promptAt('프로젝트 teacher 봐줘');
        rec(7, '(v) "프로젝트 teacher 봐줘"(키워드 앞)', `teacher·anchor=${N('teacher')}`, `m=${m2('프로젝트 teacher 봐줘')} anchor=${anchorOf(sid)} xteacher=${m2('프로젝트 xteacher')}`,
          m2('프로젝트 teacher 봐줘') === 'teacher' && anchorOf(sid) === N('teacher') && m2('프로젝트 xteacher') === null);
      }
    }
  }

  // ---------- 7행 변경 2d (w)~(ad): 별칭표 + 통일 키워드 규칙 — AUTO_HISTORY_ROOT=ROOT3, 별칭 conf=CONF_ALIAS ----------
  {
    const e3 = (sid, over = {}) => baseEnv(sid, { AUTO_HISTORY_ROOT: ROOT3, AUTO_HISTORY_CONF_DIR: CONF_ALIAS, ...over });
    const R = (rel) => path.join(ROOT3, rel);
    const N = (rel) => C.normalizeWinPath(R(rel));
    const TK = path.join('teacher', 'tauko'); const TT = path.join('teacher', 'tauko-thinking'); const POL = path.join('grp', 'policy');
    for (const d of [TK, TT, path.join('teacher', 'tauko-landing'), path.join(POL, HD)]) fs.mkdirSync(R(d), { recursive: true });
    fs.writeFileSync(path.join(R(POL), HD, 'STATUS.md'), '# STATUS\n\n## 하던 일\n- POLICY3_MARK\n');
    const ctxOf = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
    const anchorOf = (sid) => { const st = readJson(stateFile(sid)); return st && st.anchor; };
    const promptAt = (prompt, over = {}) => { const sid = sidNew(); const r = run('prompt-submit.mjs', { session_id: sid, cwd: OUTSIDE, prompt }, e3(sid, over)); return { sid, r, ctx: ctxOf(r.out) }; };
    const outsideClean = () => fs.readdirSync(OUTSIDE).length === 0;
    const aliases = C.loadAliases({ AUTO_HISTORY_ROOT: ROOT3, AUTO_HISTORY_CONF_DIR: CONF_ALIAS });
    const folders = C.listCandidateFolders({ AUTO_HISTORY_ROOT: ROOT3 });
    const projs = C.listHistoryProjects({ AUTO_HISTORY_ROOT: ROOT3 });
    const mm = (s) => { const p = C.matchProjectMention(s, projs, folders, aliases); return p ? p.dir : null; };
    // (w)
    {
      const { sid, ctx } = promptAt('play 라이브 확인해줘');
      const log = logOf(R(TK));
      rec(7, '(w) "play 라이브 확인해줘" → 별칭 play', `anchor=${N(TK)}·[anchor] 지정·"기록이 없다"·[현황]·홈 무생성`,
        `anchor=${anchorOf(sid)} 지정=${log.includes(`[anchor] 지정 ${N(TK)}`)} 없다=${/기록이 없다/.test(ctx)} 현황=${/\[현황\]/.test(ctx)} outside=${fs.readdirSync(OUTSIDE).length}`,
        anchorOf(sid) === N(TK) && log.includes(`[anchor] 지정 ${N(TK)}`) && /기록이 없다/.test(ctx) && /\[현황\]/.test(ctx) && outsideClean());
    }
    // (x)
    {
      const { sid } = promptAt('tauko thinking 이어서');
      rec(7, '(x) "tauko thinking 이어서" → 긴 별칭 우선', `anchor=${N(TT)}`, `anchor=${anchorOf(sid)} fn=${mm('tauko thinking 이어서')}`,
        anchorOf(sid) === N(TT) && mm('tauko thinking 이어서') === R(TT));
    }
    // (y)
    {
      const { sid } = promptAt('tauko-thinking 이어서');
      rec(7, '(y) "tauko-thinking" 하이픈 표기', `anchor=${N(TT)}`, `anchor=${anchorOf(sid)} dot=${mm('Tauko.Thinking 작업')}`,
        anchorOf(sid) === N(TT) && mm('Tauko.Thinking 작업') === R(TT));
    }
    // (z)
    {
      const a = mm('policy 문서'); const b = mm('policy 프로젝트');
      const { sid, ctx } = promptAt('policy 프로젝트 이어서');
      rec(7, '(z) 기록 있는 grp\\policy: "policy 문서"=null, "policy 프로젝트"=매칭', 'null,policy 경로·anchor=policy·Reader(POLICY3_MARK)',
        `${a},${b} anchor=${anchorOf(sid)} mark=${/POLICY3_MARK/.test(ctx)}`,
        a === null && b === R(POL) && anchorOf(sid) === N(POL) && /POLICY3_MARK/.test(ctx));
    }
    // (aa)
    {
      const { sid } = promptAt('teacher 안에 tauko 있어');
      rec(7, '(aa) "teacher 안에 tauko" → tauko(별칭), teacher 아님', `anchor=${N(TK)}`, `anchor=${anchorOf(sid)}`, anchorOf(sid) === N(TK));
    }
    // (ab)
    {
      const noAl = C.loadAliases({ AUTO_HISTORY_ROOT: ROOT3, AUTO_HISTORY_CONF_DIR: CONF });
      const { sid, r } = promptAt('play 라이브 확인해줘', { AUTO_HISTORY_CONF_DIR: CONF });
      const { sid: sid2 } = promptAt('tauko 프로젝트 봐줘', { AUTO_HISTORY_CONF_DIR: CONF });
      rec(7, '(ab) ALIASES 없음 → 별칭 없이 키워드 규칙만', 'aliases=[]·"play …" 무매칭(상태 없음·무출력)·"tauko 프로젝트"=깊이2 tauko',
        `aliases=${noAl.length} anchor1=${anchorOf(sid)} out='${r.out.slice(0, 30)}' anchor2=${anchorOf(sid2)}`,
        Array.isArray(noAl) && noAl.length === 0 && !anchorOf(sid) && r.out === '' && anchorOf(sid2) === N(TK));
    }
    // (ac)
    {
      const ghost = aliases.filter((x) => /ghost|유령/.test(x.phrase));
      const { sid, r } = promptAt('ghostword 확인해줘');
      rec(7, '(ac) 존재하지 않는 경로/오류 줄 → 무시', 'ghost 별칭 0개·무매칭·stderr 비어 있음', `ghost=${ghost.length} anchor=${anchorOf(sid)} out='${r.out.slice(0, 30)}' err='${r.err.slice(0, 40)}'`,
        ghost.length === 0 && !anchorOf(sid) && r.out === '' && r.err === '' && aliases.length > 0);
    }
    // (ad)
    {
      const { sid } = promptAt('씽킹 작업 이어서');
      rec(7, '(ad) 한글 별칭 "씽킹 작업" → tauko-thinking', `anchor=${N(TT)}`, `anchor=${anchorOf(sid)} 스쿨=${mm('스쿨 확인')}`,
        anchorOf(sid) === N(TT) && mm('스쿨 확인') === R(TK));
    }
    // (ao)~(au) 별칭 단어 경계·구분자 제한·길이 우선 (2026-10-10 결함 수정)
    {
      const AH = 'auto-history'; const AT = '_auto_history_test';
      for (const d of [AH, AT]) fs.mkdirSync(path.join(R(d), HD), { recursive: true });
      for (const d of [AH, AT]) fs.writeFileSync(path.join(R(d), HD, 'STATUS.md'), '# STATUS\n\n## 하던 일\n- AH_MARK\n');
      const al2 = C.loadAliases({ AUTO_HISTORY_ROOT: ROOT3, AUTO_HISTORY_CONF_DIR: CONF_ALIAS });
      const fo2 = C.listCandidateFolders({ AUTO_HISTORY_ROOT: ROOT3 });
      const pr2 = C.listHistoryProjects({ AUTO_HISTORY_ROOT: ROOT3 });
      const m3 = (s) => { const p = C.matchProjectMention(s, pr2, fo2, al2); return p ? p.dir : null; };
      const { sid: sao } = promptAt('_auto_history_test 프로젝트 최근에');
      rec(7, '(ao) "_auto_history_test 프로젝트 최근에" → 폴더(별칭 아님)', `dir=${R(AT)}·anchor=${N(AT)}`, `dir=${m3('_auto_history_test 프로젝트 최근에')} anchor=${anchorOf(sao)}`,
        m3('_auto_history_test 프로젝트 최근에') === R(AT) && anchorOf(sao) === N(AT));
      const { sid: sap, r: rap } = promptAt('autohistory 테스트');
      rec(7, '(ap) "autohistory 테스트" → 매칭 없음', '무매칭·상태 없음·무출력', `m=${m3('autohistory 테스트')} anchor=${anchorOf(sap)} out='${rap.out.slice(0, 30)}'`,
        m3('autohistory 테스트') === null && !anchorOf(sap) && rap.out === '');
      const aqs = ['auto-history 이어서', 'auto history 이어서', '오토히스토리 봐줘'];
      rec(7, '(aq) auto-history / auto history / 오토히스토리 → auto-history', `3건 모두 ${R(AH)}`, aqs.map((x) => m3(x)).join(','),
        aqs.every((x) => m3(x) === R(AH)));
      rec(7, '(ar) "myauto-history" → 매칭 없음', 'null', String(m3('myauto-history')), m3('myauto-history') === null);
      rec(7, '(as) "씽킹을 이어서"(조사) → tauko-thinking', R(TT), String(m3('씽킹을 이어서')), m3('씽킹을 이어서') === R(TT));
      rec(7, '(at) "x_play 확인"=null, "play 확인"=tauko', `null,${R(TK)}`, `${m3('x_play 확인')},${m3('play 확인')}`,
        m3('x_play 확인') === null && m3('play 확인') === R(TK));
      const prior150 = results.slice(0, results.length - 6);
      rec(7, '(au) 기존 7행까지 140건 전부 통과(8행 기존 11건=최종 집계 158 에 포함)', `${prior150.length}/${prior150.length} PASS`, `${prior150.filter((x) => x.pass).length}/${prior150.length}`,
        prior150.length === 140 && prior150.every((x) => x.pass));
      // (av)~(ba) 정제본 매칭: URL·경로·코드·붙여넣기 제외, 앞 400자 (2026-10-10 결함 수정)
      const url = 'https://chatgpt.com/codex?app-landing-page=true';
      rec(7, '(av) URL 안 landing → 매칭 없음', 'null', String(m3(`이거 봐줘 ${url}`)), m3(`이거 봐줘 ${url}`) === null);
      const wp = 'C:\\Users\\me\\Desktop\\Project\\teacher\\tauko-landing\\x.txt 열어줘';
      rec(7, '(aw) 파일 경로 안 → 매칭 없음', 'null', String(m3(wp)), m3(wp) === null);
      rec(7, '(ax) 코드 스팬 `play` → 매칭 없음', 'null', String(m3('`play` 변수 확인')), m3('`play` 변수 확인') === null);
      const filler = '가나다 '.repeat(150);
      rec(7, '(ay) 400자 뒤 play=null, 앞 play 확인=tauko', `null,${R(TK)}`, `${m3(`${filler}play 확인`)},${m3(`play 확인 ${filler}`)}`,
        m3(`${filler}play 확인`) === null && m3(`play 확인 ${filler}`) === R(TK));
      const pc = '<pasted_content id="x">\nlanding page\n</pasted_content> 이거 뭐야';
      rec(7, '(az) pasted_content 안 landing → 매칭 없음', 'null', String(m3(pc)), m3(pc) === null);
      rec(7, '(ba) "landing 랜딩 작업 이어서" → tauko-landing', R('teacher\\tauko-landing'), String(m3('landing 랜딩 작업 이어서')),
        m3('landing 랜딩 작업 이어서') === R('teacher\\tauko-landing'));
    }
  }

  // ---------- 8행 §15 다중 에이전트(Claude+Codex)·폴더명 .ai-history ----------
  {
    const CX = ['--agent', 'codex'];
    // codex 환경: Claude 표지(CLAUDE*) 없음. baseEnv(hostEnv) 는 부모의 CLAUDE* 를 전달하지 않음
    const cxEnv = (sid, over = {}) => baseEnv(sid, { CLAUDE_CODE_ENTRYPOINT: undefined, CLAUDE_CODE_SESSION_ID: undefined, ...over });
    const runC = (script, input, env) => run(script, input, env, CX);
    const ctxOf = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
    const stOf = (sid) => readJson(stateFile(sid)) || {};
    const id8 = (sid) => sid.slice(0, 8);
    const cxPayload = (sid, cwd, ev, extra = {}) => ({ session_id: sid, cwd, hook_event_name: ev, model: 'gpt-5-codex', transcript_path: null, ...extra });

    // (ae) --agent codex: 로그 [id8][codex], STATUS 작성: codex, 상태 파일 agent=codex
    const aAE = P('s15ae');
    {
      fs.mkdirSync(aAE, { recursive: true });
      const sid = sidNew();
      runC('session-start.mjs', cxPayload(sid, aAE, 'SessionStart', { source: 'startup' }), cxEnv(sid));
      runC('pre-tool.mjs', cxPayload(sid, aAE, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'npm test' } }), cxEnv(sid));
      const pre = lastLine(logOf(aAE));
      runC('stop.mjs', cxPayload(sid, aAE, 'Stop', { stop_hook_active: false, last_assistant_message: `완료\n${block('CX')}` }), cxEnv(sid));
      const s = statusOf(aAE) || '';
      const re = new RegExp(`^- \\d\\d:\\d\\d:\\d\\d \\[${id8(sid)}\\]\\[codex\\] ▶ \\[Bash\\] npm test$`);
      rec(8, '(ae) --agent codex 로그·STATUS·상태', `/[id8][codex] ▶/·작성: codex (${id8(sid)})·state.agent=codex`,
        `${pre} | 작성=${(s.match(/^작성: .+$/m) || [''])[0]} agent=${stOf(sid).agent}`,
        re.test(pre) && new RegExp(`^# STATUS\\n세션: ${id8(sid)}\\n작성: codex \\(${id8(sid)}\\)\\n갱신: `).test(s) && /- CX 하던 일/.test(s) && stOf(sid).agent === 'codex');
    }
    // (af) 기본(--agent 없음) = claude
    const aAF = P('s15af');
    {
      const sid = startSession(aAF);
      run('pre-tool.mjs', { session_id: sid, cwd: aAF, tool_name: 'Bash', tool_input: { command: 'echo af' } }, baseEnv(sid));
      const pre = lastLine(logOf(aAF));
      run('stop.mjs', { session_id: sid, cwd: aAF, last_assistant_message: `x\n${block('AF')}` }, baseEnv(sid));
      const s = statusOf(aAF) || '';
      const badArg = run('pre-tool.mjs', { session_id: sid, cwd: aAF, tool_name: 'Bash', tool_input: { command: 'echo bad' } }, baseEnv(sid), ['--agent', '../x y']);
      const bad = lastLine(logOf(aAF));
      rec(8, '(af) 기본 [claude]·작성: claude·잘못된 --agent 값=claude', '/[id8][claude] ▶/·작성: claude·state.agent=claude',
        `${pre} | 작성=${(s.match(/^작성: .+$/m) || [''])[0]} agent=${stOf(sid).agent} | ${bad}`,
        new RegExp(`\\[${id8(sid)}\\]\\[claude\\] ▶ \\[Bash\\] echo af$`).test(pre) && /^작성: claude \([0-9a-f]{8}\)$/m.test(s) && stOf(sid).agent === 'claude'
          && badArg.code === 0 && /\]\[claude\] ▶ \[Bash\] echo bad$/.test(bad) && C.parseAgent(['node', 'x', '--agent', 'Codex']) === 'codex' && C.parseAgent(['node', 'x']) === 'claude');
    }
    // (ag) Reader 첫 줄 '마지막 작업자: <agent> · 갱신 <시각>'
    {
      const sid = sidNew();
      const r = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: aAE }, baseEnv(sid));
      const ctx = ctxOf(r.out);
      const first = ctx.split('\n')[0];
      const sid2 = sidNew();
      const r2 = runC('session-start.mjs', cxPayload(sid2, aAF, 'SessionStart', { source: 'startup' }), cxEnv(sid2));
      const first2 = ctxOf(r2.out).split('\n')[0];
      const aOld = P('s15ag-old'); fs.mkdirSync(path.join(aOld, HD), { recursive: true });
      fs.writeFileSync(path.join(aOld, HD, 'STATUS.md'), '# STATUS\n세션: 12345678\n갱신: 2026-10-08 10:00:00\n앵커: x\n\n## 하던 일\n- 구형\n');
      const sid3 = sidNew();
      const ctx3 = ctxOf(run('session-start.mjs', { session_id: sid3, source: 'startup', cwd: aOld }, baseEnv(sid3)).out);
      rec(8, '(ag) Reader 주입 첫 줄 마지막 작업자', 'claude 세션→"마지막 작업자: codex · 갱신 …"·지시문 포함; codex 세션→claude; 구형 STATUS(작성 줄 없음)→생략',
        `${first} | ${first2} | old=${/마지막 작업자: /.test(ctx3)}`,
        /^\[auto-history\] 마지막 작업자: codex · 갱신 \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(first) && /\[현황\]` 첫 줄에 마지막 작업자와 시각을 포함하라/.test(ctx)
          && /^\[auto-history\] 마지막 작업자: claude · 갱신 /.test(first2) && !/마지막 작업자: /.test(ctx3) && /구형/.test(ctx3));
    }
    // (ah) codex 형 payload 로 5 스크립트 정상
    {
      const a = P('s15ah'); fs.mkdirSync(a, { recursive: true });
      const sid = sidNew();
      const r1 = runC('session-start.mjs', cxPayload(sid, a, 'SessionStart', { source: 'startup' }), cxEnv(sid));
      const r2 = runC('prompt-submit.mjs', cxPayload(sid, a, 'UserPromptSubmit', { turn_id: 't1', prompt: '테스트 실행해줘' }), cxEnv(sid));
      const r3 = runC('pre-tool.mjs', cxPayload(sid, a, 'PreToolUse', { turn_id: 't1', tool_name: 'shell', tool_use_id: 'c1', tool_input: { command: ['npm', 'test'] } }), cxEnv(sid));
      const r4 = runC('post-tool.mjs', cxPayload(sid, a, 'PostToolUse', { turn_id: 't1', tool_name: 'shell', tool_use_id: 'c1', tool_input: { command: ['npm', 'test'] }, tool_response: { output: 'SECRET_CX' } }), cxEnv(sid));
      const r5 = runC('stop.mjs', cxPayload(sid, a, 'Stop', { turn_id: 't1', stop_hook_active: false, last_assistant_message: '블록 없는 codex 답변' }), cxEnv(sid));
      const log = logOf(a); const p = `[${id8(sid)}][codex]`;
      const ok = [r1, r2, r3, r4, r5].every((x) => x.code === 0)
        && /히스토리 없음/.test(ctxOf(r1.out)) && /STATUS:BEGIN/.test(ctxOf(r2.out)) && ctxOf(r2.out).includes(`${HD}/STATUS.md`)
        && log.includes(`${p} [User] 테스트 실행해줘`) && log.includes(`${p} ▶ [shell]`) && log.includes(`${p} ✓ [shell]`) && log.includes(`${p} [Turn-end] 블록 없는 codex 답변`)
        && !log.includes('SECRET_CX') && BLOCK_RE.test(r5.out) && fs.existsSync(path.join(a, HD));
      const rc = runC('session-start.mjs', cxPayload(sidNew(), a, 'SessionStart', { source: 'compact' }), cxEnv(sid));
      rec(8, '(ah) codex payload 5 스크립트', 'exit 0×5·주입(SessionStart·UserPromptSubmit)·[User]/▶/✓/Turn-end·tool_response 미기록·블록 미출력 시 block(단계 A 기본 플래그 없음)·compact 무출력',
        `codes=${[r1, r2, r3, r4, r5].map((x) => x.code).join(',')} block=${BLOCK_RE.test(r5.out)} compact='${rc.out}' | ${log.split('\n').slice(-4).join(' / ').slice(0, 150)}`,
        ok && rc.out === '');
    }
    // (ai) codex + CLAUDECODE=1 / CLAUDE_CODE_ENTRYPOINT / NESTED_MARKERS_CODEX → 비대화형(기록만)
    {
      const a = P('s15ai'); fs.mkdirSync(a, { recursive: true });
      const sid = sidNew();
      const nested = cxEnv(sid, { CLAUDECODE: '1' });
      const r1 = runC('session-start.mjs', cxPayload(sid, a, 'SessionStart', { source: 'startup' }), nested);
      const r2 = runC('prompt-submit.mjs', cxPayload(sid, a, 'UserPromptSubmit', { prompt: '중첩 요청' }), nested);
      runC('post-tool.mjs', cxPayload(sid, a, 'PostToolUse', { tool_name: 'shell', tool_input: {} }), nested);
      const r3 = runC('stop.mjs', cxPayload(sid, a, 'Stop', { stop_hook_active: false, last_assistant_message: '중첩 끝' }), nested);
      const log = logOf(a);
      const S2 = 'cccccccc-1111';
      const ic = (env) => C.isInteractive({ session_id: S2 }, env, 'codex');
      const flags = [ic({}), ic({ CLAUDECODE: '1' }), ic({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), ic({ AUTO_HISTORY_CONF_DIR: CONF_NESTED_CODEX, AH_NESTED_TEST: '1' }),
        ic({ AUTO_HISTORY_CONF_DIR: CONF_NESTED, AH_NESTED_TEST: '1' }), ic({ AUTO_HISTORY_DISABLE: '1' }),
        C.isInteractive({ session_id: S2 }, { CLAUDE_CODE_ENTRYPOINT: 'cli', AUTO_HISTORY_CONF_DIR: CONF_NESTED_CODEX, AH_NESTED_TEST: '1' }, 'claude')];
      rec(8, '(ai) codex+CLAUDECODE=1 → 기록만', '출력 없음×3·[User]/Turn-end 기록·isInteractive codex: 표지 없음 true, CLAUDECODE·ENTRYPOINT·NESTED_MARKERS_CODEX·DISABLE false, Claude NESTED_MARKERS 무관 true, Claude 판정은 NESTED_MARKERS_CODEX 무관 true',
        `outs='${r1.out}${r2.out}${r3.out}' flags=${flags.join(',')} | ${lastLine(log)}`,
        r1.out === '' && r2.out === '' && r3.out === '' && log.includes(`[${id8(sid)}][codex] [User] 중첩 요청`) && /\[Turn-end\] 중첩 끝$/.test(lastLine(log))
          && flags.join(',') === 'true,false,false,false,true,false,true');
    }
    // (aj) 폴더명 기본 .ai-history, 후보 스캔은 .ai-history/STATUS.md 만 인식, AUTO_HISTORY_DIRNAME 덮어쓰기
    {
      const RJ = path.join(TEST_ROOT, 'c15', 'rj');
      for (const [rel, dn] of [['oldonly', '.claude-history'], ['newonly', HD], [path.join('grp', 'deepnew'), HD], ['custom', '.x-hist']]) {
        fs.mkdirSync(path.join(RJ, rel, dn), { recursive: true });
        fs.writeFileSync(path.join(RJ, rel, dn, 'STATUS.md'), '# STATUS\n');
      }
      const names = C.listHistoryProjects({ AUTO_HISTORY_ROOT: RJ }).map((p) => p.name).sort().join(',');
      const cands = C.listCandidateFolders({ AUTO_HISTORY_ROOT: RJ });
      const rOld = (cands.find((p) => p.name === 'oldonly') || {}).recorded; const rNew = (cands.find((p) => p.name === 'newonly') || {}).recorded;
      const custom = C.listHistoryProjects({ AUTO_HISTORY_ROOT: RJ, AUTO_HISTORY_DIRNAME: '.x-hist' }).map((p) => p.name).join(',');
      const dn = [C.historyDirName({}), C.historyDirName({ AUTO_HISTORY_DIRNAME: '.x-hist' }), C.historyDirName({ AUTO_HISTORY_DIRNAME: 'a/b' }), C.historyDirName({ AUTO_HISTORY_DIRNAME: '..' })].join(',');
      const a = P('s15aj'); fs.mkdirSync(a, { recursive: true }); const sid = sidNew();
      run('pre-tool.mjs', { session_id: sid, cwd: a, tool_name: 'Bash', tool_input: { command: 'echo aj' } }, baseEnv(sid, { AUTO_HISTORY_DIRNAME: '.x-hist' }));
      const wroteCustom = fs.existsSync(path.join(a, '.x-hist', `${today()}.md`)) && !fs.existsSync(path.join(a, HD));
      rec(8, '(aj) 기본 .ai-history·스캔은 .ai-history 만', 'deepnew,newonly·recorded old=false new=true·DIRNAME=.x-hist→custom·이름 .ai-history,.x-hist,.ai-history,.ai-history·훅도 .x-hist 에 기록',
        `names=${names} rec=${rOld}/${rNew} custom=${custom} dn=${dn} wroteCustom=${wroteCustom}`,
        names === 'deepnew,newonly' && rOld === false && rNew === true && custom === 'custom' && dn === '.ai-history,.x-hist,.ai-history,.ai-history' && wroteCustom);
    }
    // (ak) NO_BLOCK_CODEX: codex block 없음, Claude 는 영향 없음
    {
      const a = P('s15ak'); fs.mkdirSync(a, { recursive: true });
      const sid = sidNew();
      const env = cxEnv(sid, { AUTO_HISTORY_CONF_DIR: CONF_NOBLOCK_CODEX });
      runC('session-start.mjs', cxPayload(sid, a, 'SessionStart', { source: 'startup' }), env);
      runC('post-tool.mjs', cxPayload(sid, a, 'PostToolUse', { tool_name: 'shell', tool_input: {} }), env);
      const r1 = runC('stop.mjs', cxPayload(sid, a, 'Stop', { stop_hook_active: false, last_assistant_message: '블록 없음 ak' }), env);
      const b = P('s15ak-claude'); const sidC = startSession(b, sidNew(), { AUTO_HISTORY_CONF_DIR: CONF_NOBLOCK_CODEX }); arm(sidC);
      const r2 = run('stop.mjs', { session_id: sidC, cwd: b, last_assistant_message: '블록 없음 ak claude', stop_hook_active: false }, baseEnv(sidC, { AUTO_HISTORY_CONF_DIR: CONF_NOBLOCK_CODEX }));
      const c = P('s15ak-cx-noblock'); fs.mkdirSync(c, { recursive: true }); const sidX = sidNew();
      const envX = cxEnv(sidX, { AUTO_HISTORY_CONF_DIR: CONF_NOBLOCK });
      runC('session-start.mjs', cxPayload(sidX, c, 'SessionStart', { source: 'startup' }), envX);
      runC('post-tool.mjs', cxPayload(sidX, c, 'PostToolUse', { tool_name: 'shell', tool_input: {} }), envX);
      const r3 = runC('stop.mjs', cxPayload(sidX, c, 'Stop', { stop_hook_active: false, last_assistant_message: '블록 없음 ak2' }), envX);
      rec(8, '(ak) NO_BLOCK_CODEX 분리', 'codex+NO_BLOCK_CODEX 무출력·Claude+NO_BLOCK_CODEX 는 block·codex+NO_BLOCK(Claude 용)은 block',
        `cx='${r1.out.slice(0, 30)}' claude='${r2.out.slice(0, 30)}' cxWithClaudeFlag='${r3.out.slice(0, 30)}'`,
        r1.out === '' && BLOCK_RE.test(r2.out) && BLOCK_RE.test(r3.out) && /\[Turn-end\] 블록 없음 ak$/.test(lastLine(logOf(a))));
      // DUMP_INPUTS_CODEX: codex 만 덤프, Claude 는 DUMP_INPUTS 없으면 덤프 안 함
      const CONF_DUMP_CX = path.join(SCRATCH, 'conf-dump-codex');
      fs.mkdirSync(CONF_DUMP_CX, { recursive: true }); fs.writeFileSync(path.join(CONF_DUMP_CX, 'DUMP_INPUTS_CODEX'), '');
      const d = P('s15ak-dump'); fs.mkdirSync(d, { recursive: true }); const sidD = sidNew();
      runC('pre-tool.mjs', cxPayload(sidD, d, 'PreToolUse', { tool_name: 'shell', tool_input: { command: 'echo key AIzaSyA1234567890abcdefghijklmnopqrstuv' } }), cxEnv(sidD, { AUTO_HISTORY_CONF_DIR: CONF_DUMP_CX }));
      run('pre-tool.mjs', { session_id: sidD, cwd: d, tool_name: 'Bash', tool_input: { command: 'echo claude' } }, baseEnv(sidD, { AUTO_HISTORY_CONF_DIR: CONF_DUMP_CX }));
      let dumps = []; try { dumps = fs.readdirSync(path.join(CONF_DUMP_CX, 'dumps')); } catch { /* */ }
      const dj = dumps.length ? fs.readFileSync(path.join(CONF_DUMP_CX, 'dumps', dumps[0]), 'utf-8') : '';
      const sidO = sidNew();
      runC('pre-tool.mjs', cxPayload(sidO, OUTSIDE, 'PreToolUse', { tool_name: 'shell', tool_input: {} }), cxEnv(sidO, { AUTO_HISTORY_CONF_DIR: CONF_DUMP_CX }));
      let dumps2 = []; try { dumps2 = fs.readdirSync(path.join(CONF_DUMP_CX, 'dumps')); } catch { /* */ }
      rec(8, '(ak-2) DUMP_INPUTS_CODEX', 'codex 덤프 1개(codex- 접두·agent=codex·마스킹)·Claude 덤프 없음·경계 밖 덤프 없음',
        `dumps=${dumps.join(',')} after-outside=${dumps2.length} masked=${!/AIzaSy/.test(dj)}`,
        dumps.length === 1 && /^codex-PreToolUse-/.test(dumps[0]) && /"agent": "codex"/.test(dj) && !/AIzaSy/.test(dj) && dumps2.length === 1);
    }
    // (al) 마이그레이션: .claude-history 만 → 이름 변경, 둘 다 → 건너뜀, 깊이 3·점 폴더 무시, dry-run 무변경
    {
      const RM = path.join(TEST_ROOT, 'c15', 'rm');
      const mkH = (rel, dn, mark) => { fs.mkdirSync(path.join(RM, rel, dn), { recursive: true }); fs.writeFileSync(path.join(RM, rel, dn, 'STATUS.md'), `# STATUS\n- ${mark}\n`); };
      mkH('only', '.claude-history', 'ONLY'); mkH('both', '.claude-history', 'BOTH_OLD'); mkH('both', HD, 'BOTH_NEW');
      mkH(path.join('g', 'deep2'), '.claude-history', 'DEEP2'); mkH(path.join('g', 'x', 'deep3'), '.claude-history', 'DEEP3');
      mkH('.hidden', '.claude-history', 'HIDDEN'); fs.mkdirSync(path.join(RM, 'none'), { recursive: true });
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_LANG: 'ko', AUTO_HISTORY_DIRNAME: '' }) });
      const parse = (x) => { try { return JSON.parse(x.stdout); } catch { return {}; } };
      const rel = (arr) => (arr || []).map((d) => path.relative(RM, d)).sort().join(',');
      const ex = (r, dn) => fs.existsSync(path.join(RM, r, dn));
      const d = parse(inst(['--migrate-dirname', '--dry-run', '--root', RM]));
      const dryOk = rel(d.wouldRename) === ['g\\deep2', 'only'].sort().join(',') && rel(d.skippedBoth) === 'both' && (d.renamed || []).length === 0 && ex('only', '.claude-history') && !ex('only', HD);
      const m = parse(inst(['--migrate-dirname', '--root', RM]));
      const read = (r, dn) => { try { return fs.readFileSync(path.join(RM, r, dn, 'STATUS.md'), 'utf-8'); } catch { return ''; } };
      const runOk = rel(m.renamed) === ['g\\deep2', 'only'].sort().join(',') && rel(m.skippedBoth) === 'both' && (m.errors || []).length === 0
        && !ex('only', '.claude-history') && /ONLY/.test(read('only', HD)) && /DEEP2/.test(read(path.join('g', 'deep2'), HD))
        && /BOTH_OLD/.test(read('both', '.claude-history')) && /BOTH_NEW/.test(read('both', HD))
        && ex(path.join('g', 'x', 'deep3'), '.claude-history') && !ex(path.join('g', 'x', 'deep3'), HD) && ex('.hidden', '.claude-history') && !ex('none', HD);
      const again = parse(inst(['--migrate-dirname', '--root', RM]));
      rec(8, '(al) 마이그레이션', 'dry-run: only·g\\deep2 예정·both 건너뜀·무변경 / 실행: 2개 이름 변경·내용 유지·both 둘 다 유지·깊이3·점 폴더 무변경 / 재실행 0건',
        `dry=${rel(d.wouldRename)}|${rel(d.skippedBoth)} run=${rel(m.renamed)}|${rel(m.skippedBoth)} err=${(m.errors || []).length} again=${(again.renamed || []).length}`,
        dryOk && runOk && (again.renamed || []).length === 0 && rel(again.skippedBoth) === 'both');
    }
    // (am) --codex-hooks: 임시 경로에만 생성(실제 ~/.codex 미접근), 6 이벤트·--agent codex·절대 경로, 이미 있으면 중단, remove 왕복
    {
      const cf = path.join(SCRATCH, 'codex-home', '.codex', 'hooks.json');
      const env = hostEnv({ AUTO_HISTORY_LANG: 'ko', HOME: path.join(SCRATCH, 'codex-home'), USERPROFILE: path.join(SCRATCH, 'codex-home') });
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args, '--codex-file', cf], { encoding: 'utf-8', env });
      const dry = inst(['--codex-hooks', '--dry-run']);
      const dryNoFile = !fs.existsSync(cf) && dry.status === 0;
      const c1 = inst(['--codex-hooks']);
      const j = readJson(cf) || {};
      const evs = Object.keys(j.hooks || {});
      const hookFwd = HOOK.replace(/\\/g, '/');
      const scripts = { SessionStart: 'session-start.mjs', UserPromptSubmit: 'prompt-submit.mjs', PreToolUse: 'pre-tool.mjs', PostToolUse: 'post-tool.mjs', Stop: 'stop.mjs', SessionEnd: 'session-end.mjs' };
      const handlersOk = evs.length === 6 && evs.every((ev) => {
        const g = j.hooks[ev];
        if (!Array.isArray(g) || g.length !== 1 || 'matcher' in g[0] || g[0].hooks.length !== 1) return false;
        const h = g[0].hooks[0];
        const want = `node "${hookFwd}/${scripts[ev]}" --agent codex`;
        return h.type === 'command' && h.command === want && h.commandWindows === want && /^node "[A-Za-z]:\//.test(h.command) && Number.isFinite(h.timeout);
      });
      const before = fs.readFileSync(cf, 'utf-8');
      const c2 = inst(['--codex-hooks']);
      let o2 = {}; try { o2 = JSON.parse(c2.stdout); } catch { /* */ }
      const unchanged = fs.readFileSync(cf, 'utf-8') === before && o2.changed === false && c2.status === 0;
      const rm = inst(['--codex-hooks-remove']);
      const gone = !fs.existsSync(cf) && rm.status === 0;
      // 타 핸들러가 섞인 파일: 우리 것만 제거
      fs.mkdirSync(path.dirname(cf), { recursive: true });
      const foreign = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo foreign' }] }] } };
      const mixed = JSON.parse(JSON.stringify(j)); mixed.hooks.Stop.push(foreign.hooks.Stop[0]);
      fs.writeFileSync(cf, JSON.stringify(mixed, null, 2));
      inst(['--codex-hooks-remove']);
      const left = readJson(cf);
      const realCodex = path.join(os.homedir(), '.codex', 'hooks.json');
      rec(8, '(am) codex hooks.json 생성', 'dry-run 무생성·6 이벤트·matcher 없음·command=commandWindows=node "<절대경로>/<x>.mjs" --agent codex·재실행 무변경(멱등)·remove 왕복·타 핸들러 보존',
        `events=${evs.join(',')} handlers=${handlersOk} dry=${dryNoFile} code=${c1.status} exists-stop=${unchanged} removed=${gone} foreignLeft=${JSON.stringify(left)} realPathUsed=${path.resolve(cf) === path.resolve(realCodex)}`,
        dryNoFile && handlersOk && unchanged && gone && JSON.stringify(left) === JSON.stringify(foreign) && path.resolve(cf) !== path.resolve(realCodex));
    }
    // (an) 기존 케이스 전부 새 폴더명으로 통과 + 이전 이름 폴더 미생성
    {
      const prior = results.filter((x) => x.row <= 7);
      let stray = 0;
      const walk = (dir, depth) => {
        if (depth > 8) return;
        let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (!e.isDirectory()) continue;
          if (e.name === '.claude-history') { if (!dir.includes(`${path.sep}c15${path.sep}`)) stray++; continue; }
          walk(path.join(dir, e.name), depth + 1);
        }
      };
      walk(TEST_ROOT, 0);
      rec(8, '(an) 기존 1~7행 전부 PASS(새 폴더명)', `${prior.length}/${prior.length} PASS·시험 산출물에 .claude-history 생성 0(c15 의 의도적 생성 제외)`,
        `${prior.filter((x) => x.pass).length}/${prior.length} stray=${stray}`, prior.every((x) => x.pass) && stray === 0);
    }
  }


  // (bb) 기존 158건 전부 통과(정제 수정 전 집계)
  {
    const prior157 = results.filter((x) => !/^\((av|aw|ax|ay|az|ba)\)/.test(x.id));
    rec(8, '(bb) 기존 158건 전부 통과', `${prior157.length}/${prior157.length} PASS(158건)`, `${prior157.filter((x) => x.pass).length}/${prior157.length}`,
      prior157.length === 158 && prior157.every((x) => x.pass));
  }

  // ---------- 9행 배포용 일반화: 영어 모드·ROOT/LANG 설정 파일·설치기 신규 모드 ----------
  {
    const R9 = path.join(TEST_ROOT, 'r9');
    const CONF_EN = path.join(SCRATCH, 'conf-en');
    fs.mkdirSync(CONF_EN, { recursive: true });
    fs.writeFileSync(path.join(CONF_EN, 'INTERACTIVE_ENTRYPOINTS'), 'cli\n');
    const en = (sid, over = {}) => baseEnv(sid, { AUTO_HISTORY_ROOT: R9, AUTO_HISTORY_CONF_DIR: CONF_EN, AUTO_HISTORY_LANG: 'en', ...over });
    const mk = (n) => { const d = path.join(R9, n); fs.mkdirSync(d, { recursive: true }); return d; };
    // (en-a) English instruction + English STATUS block → English header, English log line
    {
      const a = mk('enproj');
      const sid = sidNew();
      run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, en(sid));
      const p = run('prompt-submit.mjs', { session_id: sid, cwd: a, prompt: 'hello' }, en(sid));
      let ctx = ''; try { ctx = JSON.parse(p.out).hookSpecificOutput.additionalContext; } catch { /* */ }
      arm(sid);
      const blk = ['<!-- STATUS:BEGIN -->', '## Working on', '- EN_MARK', '## Done', '- x', '## Next', '- y', '## Progress', '- z', '<!-- STATUS:END -->'].join('\n');
      const st = run('stop.mjs', { session_id: sid, cwd: a, last_assistant_message: 'reply\n' + blk }, en(sid));
      const s = statusOf(a) || '';
      const ll = lastLine(logOf(a));
      const lw = C.lastWorkerLine(a, { AUTO_HISTORY_LANG: 'en' });
      const headOk = /^# STATUS\nSession: [0-9a-f]{8}\nAuthor: claude \([0-9a-f]{8}\)\nUpdated: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\nAnchor: .+\n/.test(s);
      rec(9, '(en-a) 영어 모드 지시문·헤더·로그', '지시문 "## Working on"·"must END with the block"·STATUS 헤더 Author: claude·로그 "STATUS updated"·Last worker 파싱',
        `ctx=${/## Working on/.test(ctx) && /must END with the block/.test(ctx)} head=${headOk} mark=${/EN_MARK/.test(s)} ll=${ll.slice(-60)} lw=${lw} out='${st.out}'`,
        /## Working on/.test(ctx) && /must END with the block/.test(ctx) && !/하던 일/.test(ctx) && headOk && /EN_MARK/.test(s)
          && /\[Turn-end\] STATUS updated \| reply$/.test(ll) && /^Last worker: claude · updated \d{4}-/.test(lw) && st.out === '');
    }
    // (en-b) Korean block while lang=en → still saved (all 4 headings of any one language count as complete); Korean header parsed under en
    {
      const a = mk('mixed');
      const sid = startSession(a, sidNew(), { AUTO_HISTORY_ROOT: R9, AUTO_HISTORY_CONF_DIR: CONF_EN, AUTO_HISTORY_LANG: 'en' });
      arm(sid);
      run('stop.mjs', { session_id: sid, cwd: a, last_assistant_message: 'x\n' + block('MIX') }, en(sid));
      const s = statusOf(a) || '';
      const log = logOf(a);
      fs.writeFileSync(path.join(a, HD, 'STATUS.md'), '# STATUS\n세션: 12345678\n작성: codex (12345678)\n갱신: 2026-01-01 10:00:00\n앵커: x\n\n## 하던 일\n- k\n');
      const lw = C.lastWorkerLine(a, { AUTO_HISTORY_LANG: 'en' });
      rec(9, '(en-b) 언어 혼용 허용', '한국어 블록도 저장(불완전 로그 없음)·한국어 헤더를 en 에서 파싱', `mark=${/MIX 하던 일/.test(s)} incomplete=${/incomplete/.test(log)} lw=${lw}`,
        /MIX 하던 일/.test(s) && !/incomplete/.test(log) && /^Last worker: codex · updated 2026-01-01 10:00:00$/.test(lw));
    }
    // (en-c) English folder keywords
    {
      for (const n of ['Alpha', 'grp']) mk(n);
      mk(path.join('grp', 'web'));
      const folders = C.listCandidateFolders({ AUTO_HISTORY_ROOT: R9 });
      const m = (p) => { const h = C.matchProjectMention(p, [], folders, []); return h ? h.name : null; };
      const got = [m('continue the Alpha project'), m('project Alpha please'), m('Alpha folder'), m('Alpha projects'), m('Alphaproject'), m('open the web folder'), m('web project')].map(String).join(',');
      rec(9, '(en-c) 영어 키워드 project/folder', 'Alpha,Alpha,Alpha,null,null,null,web', got, got === 'Alpha,Alpha,Alpha,null,null,null,web');
    }
    // (conf-a) ROOT / LANG conf files + --config + --status
    {
      const CONF_R = path.join(SCRATCH, 'conf-root');
      fs.mkdirSync(CONF_R, { recursive: true });
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_CONF_DIR: CONF_R, AUTO_HISTORY_ROOT: '', AUTO_HISTORY_LANG: '' }) });
      const c = inst(['--config', '--root', R9, '--lang', 'ko']);
      const rootFile = fs.existsSync(path.join(CONF_R, 'ROOT')) ? fs.readFileSync(path.join(CONF_R, 'ROOT'), 'utf-8').trim() : '';
      const langFile = fs.existsSync(path.join(CONF_R, 'LANG')) ? fs.readFileSync(path.join(CONF_R, 'LANG'), 'utf-8').trim() : '';
      const envR = { AUTO_HISTORY_CONF_DIR: CONF_R };
      const rootOk = C.normalizeWinPath(C.getRoot(envR)) === C.normalizeWinPath(R9) && C.inScope(path.join(R9, 'enproj'), envR) && !C.inScope(SCRATCH, envR);
      const langOk = C.lang(envR) === 'ko' && C.lang({ ...envR, AUTO_HISTORY_LANG: 'en' }) === 'en' && C.lang({ AUTO_HISTORY_CONF_DIR: CONF_EN }) === 'en';
      const bad = inst(['--config', '--root', path.join(SCRATCH, 'no-such-dir')]);
      const badLang = inst(['--config', '--lang', 'xx']);
      let stt = {}; try { stt = JSON.parse(inst(['--status']).stdout); } catch { /* */ }
      rec(9, '(conf-a) ROOT/LANG 설정 파일·--config·--status', 'ROOT=R9·LANG=ko·getRoot/inScope/lang 반영·없는 루트·잘못된 lang 은 exit 1·--status root 표시',
        `code=${c.status} root=${rootFile === path.resolve(R9)} lang=${langFile} rootOk=${rootOk} langOk=${langOk} bad=${bad.status},${badLang.status} status.rootSource=${stt.rootSource} status.lang=${stt.lang}`,
        c.status === 0 && rootFile === path.resolve(R9) && langFile === 'ko' && rootOk && langOk && bad.status === 1 && badLang.status === 1 && stt.rootSource === 'ROOT file' && stt.lang === 'ko');
    }
    // (git-a) --git-ignore writes to the XDG file when core.excludesfile is unset (isolated global git config)
    {
      const GH = path.join(SCRATCH, 'git-home');
      fs.mkdirSync(GH, { recursive: true });
      fs.writeFileSync(path.join(GH, 'gitconfig'), '');
      const env = hostEnv({ AUTO_HISTORY_LANG: 'ko', HOME: GH, USERPROFILE: GH, XDG_CONFIG_HOME: path.join(GH, 'xdg'), GIT_CONFIG_GLOBAL: path.join(GH, 'gitconfig') });
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args], { encoding: 'utf-8', env });
      const parse = (x) => { try { return JSON.parse(x.stdout); } catch { return {}; } };
      const d = parse(inst(['--git-ignore', '--dry-run']));
      const f = path.join(GH, 'xdg', 'git', 'ignore');
      const dryOk = d.wouldAdd === true && !fs.existsSync(f);
      const r1 = parse(inst(['--git-ignore']));
      const content = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
      const r2 = parse(inst(['--git-ignore']));
      rec(9, '(git-a) --git-ignore', 'dry-run 무생성·추가 .ai-history/·재실행 present', `dry=${dryOk} added=${r1.added} content=${JSON.stringify(content)} again=${r2.reason}`,
        dryOk && r1.added === true && content === '.ai-history/\n' && r2.added === false && r2.reason === 'present');
    }
    // (cx-a) --codex-hooks merges into an existing file with foreign handlers (kept) and is idempotent
    {
      const cf = path.join(SCRATCH, 'codex2', 'hooks.json');
      fs.mkdirSync(path.dirname(cf), { recursive: true });
      fs.writeFileSync(cf, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo foreign' }] }] } }, null, 2));
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args, '--codex-file', cf], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_LANG: 'ko' }) });
      const parse = (x) => { try { return JSON.parse(x.stdout); } catch { return {}; } };
      const r1 = parse(inst(['--codex-hooks']));
      const j = readJson(cf) || {};
      const stopGroups = (j.hooks && j.hooks.Stop) || [];
      const r2 = parse(inst(['--codex-hooks']));
      const j2 = readJson(cf) || {};
      rec(9, '(cx-a) codex hooks.json 병합', '기존 foreign 보존·Stop 2그룹·6 이벤트·백업 생성·재실행 changed=false', `existed=${r1.existed} changed=${r1.changed} backup=${!!(r1.backup && fs.existsSync(r1.backup))} stop=${stopGroups.length} evs=${Object.keys(j.hooks || {}).length} again=${r2.changed} same=${JSON.stringify(j) === JSON.stringify(j2)}`,
        r1.existed === true && r1.changed === true && r1.backup && fs.existsSync(r1.backup) && stopGroups.length === 2 && stopGroups[0].hooks[0].command === 'echo foreign'
          && Object.keys(j.hooks).length === 6 && r2.changed === false && JSON.stringify(j) === JSON.stringify(j2));
    }
  }

  // ---------- 10행 로그 보존(retention) + 같은 폴더 다중 세션 STATUS ----------
  {
    const zlib = await import('node:zlib');
    const DAY = 86400000;
    const dstr = (daysAgo, now = Date.now()) => C.ymd(new Date(now - daysAgo * DAY));
    const setOld = (f, daysAgo) => { const t = new Date(Date.now() - daysAgo * DAY); fs.utimesSync(f, t, t); };
    const ctxOf = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
    const sessFile = (a, sid, agent = 'claude') => path.join(a, HD, 'sessions', `${agent}-${sid.slice(0, 8)}.md`);
    const CONF_RET = path.join(SCRATCH, 'conf-ret');
    fs.mkdirSync(CONF_RET, { recursive: true });
    fs.writeFileSync(path.join(CONF_RET, 'INTERACTIVE_ENTRYPOINTS'), 'cli\n');
    fs.writeFileSync(path.join(CONF_RET, 'RETENTION'), '# 시험\nkeep=10\narchive = 100\nsessions=3\nbogus=5\nkeep=abc\n');

    // (a) 정책 해석: 기본값 / RETENTION 파일 / env 우선 / 잘못된 값 무시
    {
      const def = C.retentionPolicy({ AUTO_HISTORY_CONF_DIR: path.join(SCRATCH, 'no-such-conf') });
      const file = C.retentionPolicy({ AUTO_HISTORY_CONF_DIR: CONF_RET });
      const envp = C.retentionPolicy({ AUTO_HISTORY_CONF_DIR: CONF_RET, AUTO_HISTORY_KEEP_DAYS: '45', AUTO_HISTORY_ARCHIVE_DAYS: '0', AUTO_HISTORY_SESSIONS_DAYS: 'x' });
      rec(10, '(a) retentionPolicy 기본·파일·env', 'def 30/365/7 · file 10/100/3 · env 45/0/3', `${JSON.stringify(def)} ${JSON.stringify(file)} ${JSON.stringify(envp)}`,
        JSON.stringify(def) === '{"keep":30,"archive":365,"sessions":7}' && JSON.stringify(file) === '{"keep":10,"archive":100,"sessions":3}'
        && JSON.stringify(envp) === '{"keep":45,"archive":0,"sessions":3}');
    }
    // (b) runRetention: 오래된 로그 → gz 이동(복원 일치), 오늘·어제·keep 이내 유지, 오래된 gz 삭제, 오래된 세션 사본 삭제, 마커 생성
    const aB = P('r16b');
    {
      const h = path.join(aB, HD); fs.mkdirSync(path.join(h, 'archive'), { recursive: true }); fs.mkdirSync(path.join(h, 'sessions'), { recursive: true });
      const mk = (days, body) => fs.writeFileSync(path.join(h, `${dstr(days)}.md`), body);
      mk(0, '- today\n'); mk(1, '- yday\n'); mk(5, '- d5\n'); mk(10, '- d10\n'); mk(11, '- d11 old\n'); mk(40, '- d40 old\n'.repeat(500));
      fs.writeFileSync(path.join(h, 'STATUS.md'), '# STATUS\n세션: aaaaaaaa\n');
      fs.writeFileSync(path.join(h, 'archive', `${dstr(101)}.md.gz`), zlib.gzipSync('old')); setOld(path.join(h, 'archive', `${dstr(101)}.md.gz`), 91);
      fs.writeFileSync(path.join(h, 'archive', `${dstr(99)}.md.gz`), zlib.gzipSync('keep'));
      fs.writeFileSync(path.join(h, 'sessions', 'claude-11111111.md'), '# STATUS\n세션: 11111111\n'); setOld(path.join(h, 'sessions', 'claude-11111111.md'), 4);
      fs.writeFileSync(path.join(h, 'sessions', 'claude-22222222.md'), '# STATUS\n세션: 22222222\n');
      const env = { AUTO_HISTORY_CONF_DIR: CONF_RET };
      const res = C.runRetention(aB, env);
      const names = fs.readdirSync(h).sort().join(',');
      const arch = fs.readdirSync(path.join(h, 'archive')).sort().join(',');
      const back40 = (() => { try { return zlib.gunzipSync(fs.readFileSync(path.join(h, 'archive', `${dstr(40)}.md.gz`))).toString(); } catch { return ''; } })();
      const sess = fs.readdirSync(path.join(h, 'sessions')).join(',');
      const ok = res.ran && res.archived === 2 && res.deleted === 1 && res.sessionsDeleted === 1
        && !fs.existsSync(path.join(h, `${dstr(11)}.md`)) && !fs.existsSync(path.join(h, `${dstr(40)}.md`))
        && [0, 1, 5, 10].every((d) => fs.existsSync(path.join(h, `${dstr(d)}.md`))) && fs.existsSync(path.join(h, 'STATUS.md'))
        && arch === [`${dstr(11)}.md.gz`, `${dstr(40)}.md.gz`, `${dstr(99)}.md.gz`].sort().join(',')
        && back40 === '- d40 old\n'.repeat(500) && sess === 'claude-22222222.md' && fs.existsSync(path.join(h, '.retention'));
      rec(10, '(b) runRetention keep=10·archive=100·sessions=3', 'd11·d40→gz(복원 일치)·today/yday/d5/d10/STATUS 유지·gz101 삭제·gz99 유지·세션4일 삭제·마커',
        `res=${JSON.stringify(res)} files=${names} arch=${arch} sess=${sess} back=${back40.length}`, ok);
      // (c) 24h 스로틀 → ran=false·무변경 / force → ran=true
      mk(12, '- d12 late\n');
      const r2 = C.runRetention(aB, env);
      const r3 = C.runRetention(aB, env, { force: true });
      rec(10, '(c) 24h 스로틀·force', 'r2.ran=false·d12 유지 → force: ran=true·d12 압축', `r2=${JSON.stringify(r2)} d12after2=${fs.existsSync(path.join(h, `${dstr(12)}.md`))} r3=${JSON.stringify(r3)} d12after3=${fs.existsSync(path.join(h, `${dstr(12)}.md`))}`,
        r2.ran === false && r3.ran === true && r3.archived === 1 && !fs.existsSync(path.join(h, `${dstr(12)}.md`)) && fs.existsSync(path.join(h, 'archive', `${dstr(12)}.md.gz`)));
      // (c-2) 마커가 하루 넘게 오래되면 다시 실행
      setOld(path.join(h, '.retention'), 2); mk(13, '- d13\n');
      const r4 = C.runRetention(aB, env);
      rec(10, '(c-2) 마커 25h 경과 → 재실행', 'ran=true·archived=1', JSON.stringify(r4), r4.ran === true && r4.archived === 1);
    }
    // (d) keep=0 → 로그 압축·gz 삭제 없음(세션 사본 정리는 유지) / archive=0 → gz 영구 보관 / sessions=0 → 사본 보존
    {
      const a = P('r16d'); const h = path.join(a, HD); fs.mkdirSync(path.join(h, 'archive'), { recursive: true }); fs.mkdirSync(path.join(h, 'sessions'), { recursive: true });
      fs.writeFileSync(path.join(h, `${dstr(400)}.md`), 'x'); fs.writeFileSync(path.join(h, 'archive', `${dstr(900)}.md.gz`), zlib.gzipSync('x'));
      fs.writeFileSync(path.join(h, 'sessions', 'claude-99999999.md'), 'x'); setOld(path.join(h, 'sessions', 'claude-99999999.md'), 30);
      const r0 = C.runRetention(a, { AUTO_HISTORY_CONF_DIR: CONF_RET, AUTO_HISTORY_KEEP_DAYS: '0' }, { force: true });
      const keep0ok = r0.ran && r0.archived === 0 && r0.deleted === 0 && r0.sessionsDeleted === 1 && fs.existsSync(path.join(h, `${dstr(400)}.md`)) && fs.existsSync(path.join(h, 'archive', `${dstr(900)}.md.gz`));
      const ra = C.runRetention(a, { AUTO_HISTORY_CONF_DIR: CONF_RET, AUTO_HISTORY_ARCHIVE_DAYS: '0' }, { force: true });
      const arch0ok = ra.archived === 1 && ra.deleted === 0 && fs.existsSync(path.join(h, 'archive', `${dstr(900)}.md.gz`)) && !fs.existsSync(path.join(h, `${dstr(400)}.md`));
      fs.writeFileSync(path.join(h, 'sessions', 'claude-88888888.md'), 'x'); setOld(path.join(h, 'sessions', 'claude-88888888.md'), 30);
      const rs = C.runRetention(a, { AUTO_HISTORY_CONF_DIR: CONF_RET, AUTO_HISTORY_SESSIONS_DAYS: '0' }, { force: true });
      rec(10, '(d) keep=0 / archive=0 / sessions=0', 'keep0: 압축0·삭제0·세션1 / archive0: 압축1·gz900 유지 / sessions0: 사본 유지',
        `keep0=${JSON.stringify(r0)} arch0=${JSON.stringify(ra)} sess0=${JSON.stringify(rs)} s88=${fs.existsSync(path.join(h, 'sessions', 'claude-88888888.md'))}`,
        keep0ok && arch0ok && rs.sessionsDeleted === 0 && fs.existsSync(path.join(h, 'sessions', 'claude-88888888.md')));
    }
    // (e) 충돌: archive 에 같은 이름 gz 가 다른 내용으로 이미 있으면 원본 보존(삭제 0)
    {
      const a = P('r16e'); const h = path.join(a, HD); fs.mkdirSync(path.join(h, 'archive'), { recursive: true });
      fs.writeFileSync(path.join(h, `${dstr(50)}.md`), 'real'); fs.writeFileSync(path.join(h, 'archive', `${dstr(50)}.md.gz`), zlib.gzipSync('different'));
      const r = C.runRetention(a, { AUTO_HISTORY_CONF_DIR: CONF_RET }, { force: true });
      const gzBack = zlib.gunzipSync(fs.readFileSync(path.join(h, 'archive', `${dstr(50)}.md.gz`))).toString();
      const dup = fs.readdirSync(path.join(h, 'archive')).find((x) => x.startsWith(`${dstr(50)}.md.dup-`));
      const dupBack = dup ? zlib.gunzipSync(fs.readFileSync(path.join(h, 'archive', dup))).toString() : '';
      rec(10, '(e) gz 충돌(내용 불일치) → .dup- 이름으로 보관·기존 gz 불변', 'archived=1·원본 삭제·기존 gz 내용 유지·dup gz=real', `r=${JSON.stringify(r)} src=${fs.existsSync(path.join(h, `${dstr(50)}.md`))} gz=${gzBack} dup=${dup} dupBack=${dupBack}`,
        r.archived === 1 && !fs.existsSync(path.join(h, `${dstr(50)}.md`)) && gzBack === 'different' && !!dup && dupBack === 'real');
    }
    // (f) 1회 상한 20개
    {
      const a = P('r16f'); const h = path.join(a, HD); fs.mkdirSync(h, { recursive: true });
      for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(h, `${dstr(100 + i)}.md`), `x${i}`);
      const r = C.runRetention(a, { AUTO_HISTORY_CONF_DIR: CONF_RET }, { force: true });
      const left = fs.readdirSync(h).filter((n) => /^\d{4}-\d\d-\d\d\.md$/.test(n)).length;
      rec(10, '(f) 1회 최대 20개', 'archived=20·남은 로그 5', `archived=${r.archived} left=${left}`, r.archived === 20 && left === 5);
    }
    // (g) 훅 통합: SessionStart 가 정리 실행 + [retention] 로그 1줄, 히스토리 없는 폴더는 무동작·.ai-history 미생성
    {
      const a = P('r16g'); const h = path.join(a, HD); fs.mkdirSync(h, { recursive: true });
      fs.writeFileSync(path.join(h, `${dstr(60)}.md`), '- old\n'); fs.writeFileSync(path.join(h, 'STATUS.md'), '# STATUS\n세션: zzzzzzzz\n작성: claude (zzzzzzzz)\n갱신: t\n앵커: a\n\n## 하던 일\n- G_MARK\n');
      const sid = sidNew();
      const r = run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, baseEnv(sid, { AUTO_HISTORY_CONF_DIR: CONF_RET }));
      const log = logOf(a);
      const g1 = fs.existsSync(path.join(h, 'archive', `${dstr(60)}.md.gz`)) && !fs.existsSync(path.join(h, `${dstr(60)}.md`)) && /\[retention\] 압축 1·gz 삭제 0·세션 사본 삭제 0$/.test(log.trim()) && /G_MARK/.test(ctxOf(r.out));
      const a2 = P('r16g2'); fs.mkdirSync(a2, { recursive: true });
      const sid2 = sidNew();
      run('session-start.mjs', { session_id: sid2, source: 'startup', cwd: a2 }, baseEnv(sid2, { AUTO_HISTORY_CONF_DIR: CONF_RET }));
      rec(10, '(g) SessionStart 정리+[retention] 로그·신규 폴더 무생성', 'gz 생성·원본 삭제·로그 1줄·Reader 정상 / 신규: .ai-history 없음', `g1=${g1} log=${lastLine(log)} new=${fs.existsSync(path.join(a2, HD))}`,
        g1 && !fs.existsSync(path.join(a2, HD)));
      // (g-2) 두 번째 SessionStart(같은 날) → 스로틀로 로그 줄 추가 없음
      const n0 = logOf(a).split('\n').filter((l) => /\[retention\]/.test(l)).length;
      const sid3 = sidNew();
      run('session-start.mjs', { session_id: sid3, source: 'startup', cwd: a }, baseEnv(sid3, { AUTO_HISTORY_CONF_DIR: CONF_RET }));
      const n1 = logOf(a).split('\n').filter((l) => /\[retention\]/.test(l)).length;
      rec(10, '(g-2) 재시작 스로틀', '[retention] 줄 수 변화 없음(1)', `${n0}→${n1}`, n0 === 1 && n1 === 1);
    }
    // (h) 변경 없는 정리는 로그 없음(마커만)
    {
      const a = P('r16h'); const h = path.join(a, HD); fs.mkdirSync(h, { recursive: true }); fs.writeFileSync(path.join(h, 'STATUS.md'), '# STATUS\n');
      const sid = startSession(a);
      rec(10, '(h) 정리 대상 없음 → [retention] 로그 없음·마커 있음', 'log 에 [retention] 0·.retention 존재', `ret=${/\[retention\]/.test(logOf(a))} marker=${fs.existsSync(path.join(h, '.retention'))} sid=${sid.slice(0, 4)}`,
        !/\[retention\]/.test(logOf(a)) && fs.existsSync(path.join(h, '.retention')));
    }
    // (i) §17 Stop → STATUS.md + sessions/claude-<id8>.md 동일 내용
    const aI = P('r17i');
    const sI1 = startSession(aI); arm(sI1);
    {
      run('stop.mjs', { session_id: sI1, cwd: aI, last_assistant_message: `끝\n${block('S1')}` }, baseEnv(sI1));
      const s = statusOf(aI) || ''; const c = (() => { try { return fs.readFileSync(sessFile(aI, sI1), 'utf-8'); } catch { return null; } })();
      rec(10, '(i) Stop → sessions 사본', 'sessions/claude-<id8>.md 존재·STATUS.md 와 동일', `exists=${c !== null} same=${c === s}`, c !== null && c === s && /- S1 하던 일/.test(s));
    }
    // (j) 두 세션 같은 폴더: STATUS.md=마지막(S2), Reader(S1 기준)=다른 세션 S1 "(이 세션)", Reader(S2 기준)=S1 표시·S2 중복 없음
    const sI2 = startSession(aI); arm(sI2);
    {
      run('stop.mjs', { session_id: sI2, cwd: aI, last_assistant_message: `끝\n${block('S2')}` }, baseEnv(sI2));
      const s = statusOf(aI) || '';
      const r1 = C.readerBody(aI, baseEnv(sI1), { sid8: sI1.slice(0, 8) });
      const r2 = C.readerBody(aI, baseEnv(sI2), { sid8: sI2.slice(0, 8) });
      const ok = /- S2 하던 일/.test(s) && new RegExp(`^세션: ${sI2.slice(0, 8)}$`, 'm').test(s)
        && /=== 다른 세션 STATUS\(48시간 내, 최대 2개\) ===/.test(r1) && new RegExp(`--- 세션 ${sI1.slice(0, 8)} \\(claude\\) \\(이 세션\\) ---`).test(r1) && /- S1 하던 일/.test(r1)
        && (r1.match(/- S2 하던 일/g) || []).length === 1
        && new RegExp(`--- 세션 ${sI1.slice(0, 8)} \\(claude\\) ---`).test(r2) && !/\(이 세션\)/.test(r2) && (r2.match(/- S2 하던 일/g) || []).length === 1;
      rec(10, '(j) 두 세션 → STATUS=S2·Reader 다른 세션=S1(이 세션 표시)', 'S1 Reader: 다른 세션 절·S1(이 세션)·S2 1회 / S2 Reader: S1 표시·(이 세션) 없음', `s=${(s.match(/^세션: .+$/m) || [''])[0]} r1=${r1.replace(/\n/g, '⏎').slice(0, 400)}`, ok);
    }
    // (k) resume 주입: S1 이 SessionStart(resume) 하면 자기 사본이 "(이 세션)" 으로 주입됨
    {
      const r = run('session-start.mjs', { session_id: sI1, source: 'resume', cwd: aI }, baseEnv(sI1));
      const ctx = ctxOf(r.out);
      rec(10, '(k) S1 resume → 자기 STATUS 사본 주입', 'ctx 에 S1 하던 일·(이 세션)·STATUS.md 는 S2', `len=${ctx.length} s1=${/- S1 하던 일/.test(ctx)} mine=${/\(이 세션\)/.test(ctx)} s2=${/- S2 하던 일/.test(ctx)}`,
        /- S1 하던 일/.test(ctx) && /\(이 세션\)/.test(ctx) && /- S2 하던 일/.test(ctx));
    }
    // (l) 48h 창·최대 2개: 사본 4개(S1 49h 전, S3·S4 최신) → S4=STATUS, 다른 세션 = S3·S2 만, S1 제외
    {
      setOld(sessFile(aI, sI1), 49 / 24);
      for (const tag of ['S3', 'S4']) {
        const sid = startSession(aI); arm(sid);
        run('stop.mjs', { session_id: sid, cwd: aI, last_assistant_message: `끝\n${block(tag)}` }, baseEnv(sid));
        if (tag === 'S3') setOld(sessFile(aI, sid), 1 / 24);
      }
      const r = C.readerBody(aI, baseEnv(sI2), { sid8: sI2.slice(0, 8) });
      const others = (r.match(/^--- 세션 /gm) || []).length;
      rec(10, '(l) 48h 밖 제외·최신 2개만', 'S1 없음·S3·S2 표시(STATUS=S4 제외)·2개', `others=${others} s1=${/- S1 하던 일/.test(r)} s2=${/- S2 하던 일/.test(r)} s3=${/- S3 하던 일/.test(r)} s4cnt=${(r.match(/- S4 하던 일/g) || []).length}`,
        others === 2 && !/- S1 하던 일/.test(r) && /- S2 하던 일/.test(r) && /- S3 하던 일/.test(r) && (r.match(/- S4 하던 일/g) || []).length === 1);
    }
    // (m) codex + claude 같은 폴더: sessions/codex-<id8>.md, Reader 에 (codex) 표시
    {
      const a = P('r17m'); fs.mkdirSync(a, { recursive: true });
      const sc = sidNew();
      const cxEnv = baseEnv(sc, { CLAUDE_CODE_ENTRYPOINT: undefined, CLAUDE_CODE_SESSION_ID: undefined });
      run('session-start.mjs', { session_id: sc, source: 'startup', cwd: a }, cxEnv, ['--agent', 'codex']);
      run('stop.mjs', { session_id: sc, cwd: a, last_assistant_message: `끝\n${block('CX')}` }, cxEnv, ['--agent', 'codex']);
      const sk = startSession(a); arm(sk);
      run('stop.mjs', { session_id: sk, cwd: a, last_assistant_message: `끝\n${block('CL')}` }, baseEnv(sk));
      const r = C.readerBody(a, baseEnv(sk), { sid8: sk.slice(0, 8) });
      rec(10, '(m) codex+claude 사본·Reader (codex) 표시', 'sessions/codex-<id8>.md 존재·--- 세션 <id8> (codex) ---·CX 내용', `cx=${fs.existsSync(sessFile(a, sc, 'codex'))} r=${r.replace(/\n/g, '⏎').slice(0, 300)}`,
        fs.existsSync(sessFile(a, sc, 'codex')) && new RegExp(`--- 세션 ${sc.slice(0, 8)} \\(codex\\) ---`).test(r) && /- CX 하던 일/.test(r));
    }
    // (n) sessions 폴더 없음·STATUS 없음 → otherSessionsBody '' · 기존 Reader 형식 유지
    {
      const a = P('r17n'); fs.mkdirSync(path.join(a, HD), { recursive: true });
      const o = C.otherSessionsBody(a, baseEnv('x'));
      const r = C.readerBody(a, baseEnv('x'));
      rec(10, '(n) 사본 없음 → 절 생략', "''·Reader 에 '다른 세션' 없음", `o='${o}' hasOther=${/다른 세션/.test(r)}`, o === '' && !/다른 세션/.test(r) && /=== STATUS.md ===/.test(r));
    }
    // (o) 상한: READER_TOTAL_MAX=10000, 사본 1,000자 절단
    {
      const a = P('r17o'); const h = path.join(a, HD); fs.mkdirSync(path.join(h, 'sessions'), { recursive: true });
      fs.writeFileSync(path.join(h, 'STATUS.md'), '# STATUS\n세션: aaaaaaaa\n');
      fs.writeFileSync(path.join(h, 'sessions', 'claude-bbbbbbbb.md'), `# STATUS\n세션: bbbbbbbb\n작성: claude (bbbbbbbb)\n\n${'y'.repeat(3000)}`);
      const o = C.otherSessionsBody(a, baseEnv('x'));
      rec(10, '(o) 사본 1,000자 절단·상한 10000', 'len≈1000+…(생략)·READER_TOTAL_MAX=10000', `olen=${o.length} trunc=${/…\(생략\)/.test(o)} max=${C.READER_TOTAL_MAX}`,
        /…\(생략\)/.test(o) && o.length < 1200 && C.READER_TOTAL_MAX === 10000);
    }
    // (q) 영어 모드: 다른 세션 절·retention 로그 영어 문구, 헤더는 양언어 파싱
    {
      const a = P('r17q'); const h = path.join(a, HD); fs.mkdirSync(path.join(h, 'sessions'), { recursive: true });
      fs.writeFileSync(path.join(h, 'STATUS.md'), '# STATUS\nSession: aaaaaaaa\nAuthor: claude (aaaaaaaa)\n\n## Working on\n- A\n');
      fs.writeFileSync(path.join(h, 'sessions', 'codex-bbbbbbbb.md'), '# STATUS\nSession: bbbbbbbb\nAuthor: codex (bbbbbbbb)\n\n## Working on\n- B_EN\n');
      fs.writeFileSync(path.join(h, `${dstr(60)}.md`), '- old\n');
      const envEn = { AUTO_HISTORY_CONF_DIR: CONF_RET, AUTO_HISTORY_LANG: 'en' };
      const o = C.otherSessionsBody(a, envEn, 'bbbbbbbb');
      const rl = C.retentionLogLine(C.runRetention(a, envEn, { force: true }), envEn);
      const koMix = C.otherSessionsBody(a, { ...envEn, AUTO_HISTORY_LANG: 'ko' }, null);
      rec(10, '(q) 영어 모드 문구·헤더 양언어 파싱', "=== Other sessions' STATUS (last 48h, up to 2) ===·--- session bbbbbbbb (codex) (this session) ---·[retention] archived 1 · gz deleted 0 · session copies deleted 0·ko 에서도 영어 헤더 파싱",
        `o=${o.replace(/\n/g, '⏎').slice(0, 160)} rl=${rl} ko=${/B_EN/.test(koMix)}`,
        /=== Other sessions' STATUS \(last 48h, up to 2\) ===/.test(o) && /--- session bbbbbbbb \(codex\) \(this session\) ---/.test(o) && /- B_EN/.test(o)
        && rl === '[retention] archived 1 · gz deleted 0 · session copies deleted 0' && /B_EN/.test(koMix) && /--- 세션 bbbbbbbb \(codex\) ---/.test(koMix));
    }
    // (r) install --config --keep-days/--archive-days/--sessions-days → RETENTION 파일, --status 에 retention, 잘못된 값 exit 1, dry-run 무변경
    {
      const CONF_R2 = path.join(SCRATCH, 'conf-ret2'); fs.mkdirSync(CONF_R2, { recursive: true });
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_CONF_DIR: CONF_R2, AUTO_HISTORY_ROOT: '', AUTO_HISTORY_LANG: '', AUTO_HISTORY_KEEP_DAYS: '', AUTO_HISTORY_ARCHIVE_DAYS: '', AUTO_HISTORY_SESSIONS_DAYS: '' }) });
      const c1 = inst(['--config', '--keep-days', '60']);
      const f1 = fs.existsSync(path.join(CONF_R2, 'RETENTION')) ? fs.readFileSync(path.join(CONF_R2, 'RETENTION'), 'utf-8') : '';
      const c2 = inst(['--config', '--archive-days', '0']);
      const pol = C.retentionPolicy({ AUTO_HISTORY_CONF_DIR: CONF_R2 });
      const bad = inst(['--config', '--keep-days', 'x']);
      let stt = {}; try { stt = JSON.parse(inst(['--status']).stdout); } catch { /* */ }
      const dry = inst(['--config', '--sessions-days', '1', '--dry-run']);
      const polAfterDry = C.retentionPolicy({ AUTO_HISTORY_CONF_DIR: CONF_R2 });
      rec(10, '(r) --config RETENTION·--status·잘못된 값·dry-run', 'keep=60 → archive=0 누적(keep 유지)·status.retention 일치·bad exit 1·dry-run 무변경',
        `c1=${c1.status} f1=${JSON.stringify(f1)} c2=${c2.status} pol=${JSON.stringify(pol)} bad=${bad.status} status=${JSON.stringify(stt.retention)} src=${stt.retentionSource} dry=${dry.status} afterDry=${JSON.stringify(polAfterDry)}`,
        c1.status === 0 && f1 === 'keep=60\narchive=365\nsessions=7\n' && c2.status === 0 && JSON.stringify(pol) === '{"keep":60,"archive":0,"sessions":7}'
        && bad.status === 1 && JSON.stringify(stt.retention) === JSON.stringify(pol) && stt.retentionSource === 'RETENTION file (+env)' && dry.status === 0 && JSON.stringify(polAfterDry) === JSON.stringify(pol));
    }
    // (s) 리뷰 반영: archive<=keep 이면 keep+1 로 올려 압축 직후 삭제 금지 / 불일치 파일도 budget 차감 / 시간 예산 초과 시 중단·마커 없음 / 마커 mtime 이 미래면 재실행
    {
      const a = P('r16s'); const h = path.join(a, HD); fs.mkdirSync(path.join(h, 'archive'), { recursive: true });
      fs.writeFileSync(path.join(h, `${dstr(40)}.md`), '- d40\n');
      const r1 = C.runRetention(a, { AUTO_HISTORY_CONF_DIR: CONF_RET, AUTO_HISTORY_KEEP_DAYS: '10', AUTO_HISTORY_ARCHIVE_DAYS: '10' }, { force: true });
      const gzKept = fs.existsSync(path.join(h, 'archive', `${dstr(40)}.md.gz`));
      // 불일치 20개(더 오래된 날짜) + 정상 1개 → budget 20 이 불일치에 다 소모되어 정상 파일은 다음 실행으로 넘어감
      const b = P('r16s2'); const hb = path.join(b, HD); fs.mkdirSync(path.join(hb, 'archive'), { recursive: true });
      for (let i = 0; i < 20; i++) { fs.writeFileSync(path.join(hb, `${dstr(50 + i)}.md`), 'real'); fs.writeFileSync(path.join(hb, 'archive', `${dstr(50 + i)}.md.gz`), zlib.gzipSync('other')); }
      fs.writeFileSync(path.join(hb, `${dstr(40)}.md`), 'good');
      const r2 = C.runRetention(b, { AUTO_HISTORY_CONF_DIR: CONF_RET }, { force: true });
      const goodLeft = fs.existsSync(path.join(hb, `${dstr(40)}.md`));
      const dups = fs.readdirSync(path.join(hb, 'archive')).filter((x) => x.includes('.md.dup-') && x.endsWith('.gz')).length;
      const r2b = C.runRetention(b, { AUTO_HISTORY_CONF_DIR: CONF_RET }, { force: true });
      // 시간 예산 0ms → 첫 파일 전에 중단, 마커 없음, interrupted=true
      const c = P('r16s3'); const hc = path.join(c, HD); fs.mkdirSync(hc, { recursive: true });
      fs.writeFileSync(path.join(hc, `${dstr(50)}.md`), 'x');
      const r3 = C.runRetention(c, { AUTO_HISTORY_CONF_DIR: CONF_RET }, { force: true, timeBudgetMs: -1 });
      const marker3 = fs.existsSync(path.join(hc, '.retention'));
      const r3b = C.runRetention(c, { AUTO_HISTORY_CONF_DIR: CONF_RET });
      // 마커 mtime 미래 → 스로틀 무시하고 실행
      const d = P('r16s4'); const hd = path.join(d, HD); fs.mkdirSync(hd, { recursive: true });
      fs.writeFileSync(path.join(hd, '.retention'), 'x'); const fut = new Date(Date.now() + 3 * DAY); fs.utimesSync(path.join(hd, '.retention'), fut, fut);
      const r4 = C.runRetention(d, { AUTO_HISTORY_CONF_DIR: CONF_RET });
      rec(10, '(s) 리뷰 반영: archive<=keep 보호·불일치 budget·시간 예산·시계 역행', 'r1 archived=1 deleted=0 gz 유지 / r2 충돌 20개 dup 보관(archived=20)·good 유지(budget) → r2b archived=1 / r3 interrupted·마커 없음 → r3b ran=true archived=1 / r4 ran=true',
        `r1=${r1.archived}/${r1.deleted} gz=${gzKept} r2=${r2.archived}/${r2.deleted} dups=${dups} good=${goodLeft} r2b=${r2b.archived} r3=${r3.archived}/${r3.interrupted} marker3=${marker3} r3b=${r3b.ran}/${r3b.archived}/${r3b.interrupted} r4=${r4.ran}`,
        r1.archived === 1 && r1.deleted === 0 && gzKept
        && r2.archived === 20 && dups === 20 && goodLeft && r2b.archived === 1
        && r3.interrupted === true && r3.archived === 0 && !marker3 && r3b.ran === true && r3b.archived === 1 && r3b.interrupted === false
        && r4.ran === true);
    }
    // (t) 리뷰 반영: install --config 가 archive<=keep·값 누락을 거부
    {
      const CONF_R3 = path.join(SCRATCH, 'conf-ret3'); fs.mkdirSync(CONF_R3, { recursive: true });
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_CONF_DIR: CONF_R3, AUTO_HISTORY_ROOT: '', AUTO_HISTORY_LANG: '', AUTO_HISTORY_KEEP_DAYS: '', AUTO_HISTORY_ARCHIVE_DAYS: '', AUTO_HISTORY_SESSIONS_DAYS: '' }) });
      const bad1 = inst(['--config', '--keep-days', '30', '--archive-days', '30']);
      const bad2 = inst(['--config', '--keep-days']);
      const ok1 = inst(['--config', '--keep-days', '30', '--archive-days', '0']);
      const ok2 = inst(['--config', '--keep-days', '0', '--archive-days', '5']);
      rec(10, '(t) --config archive<=keep·값 누락 거부', 'bad1·bad2 exit 1·RETENTION 미생성 → ok1(archive=0)·ok2(keep=0) exit 0',
        `bad1=${bad1.status} bad2=${bad2.status} file=${fs.existsSync(path.join(CONF_R3, 'RETENTION'))} ok1=${ok1.status} ok2=${ok2.status} err=${(bad1.stderr || '').split('\n')[0].slice(0, 80)}`,
        bad1.status === 1 && bad2.status === 1 && /must be greater than keep/.test(bad1.stderr) && ok1.status === 0 && ok2.status === 0 && fs.existsSync(path.join(CONF_R3, 'RETENTION')));
    }
    // (p) 기존 1~9행 전부 통과
    {
      const prior = results.filter((x) => x.row <= 9);
      rec(10, '(p) 기존 1~9행 전부 통과', `${prior.length}/${prior.length} PASS`, `${prior.filter((x) => x.pass).length}/${prior.length}`, prior.every((x) => x.pass));
    }
  }

  // ---------- 11행 재개 명령(SessionEnd·STATUS 재개 줄) ----------
  {
    const CX = ['--agent', 'codex'];
    const cxEnv = (sid, over = {}) => baseEnv(sid, { CLAUDE_CODE_ENTRYPOINT: undefined, CLAUDE_CODE_SESSION_ID: undefined, ...over });
    const sessFile = (a, sid, agent = 'claude') => path.join(a, HD, 'sessions', `${agent}-${sid.slice(0, 8)}.md`);
    const readF = (f) => { try { return fs.readFileSync(f, 'utf-8'); } catch { return null; } };
    const headLines = (s) => (s || '').replace(/\r\n/g, '\n').split('\n\n')[0].split('\n');
    const resumeLineOf = (s, key = '재개') => headLines(s).find((l) => l.startsWith(`${key}: `)) || '';
    const afterAnchor = (s, ak = '앵커', rk = '재개') => { const h = headLines(s); const i = h.findIndex((l) => l.startsWith(`${ak}: `)); return i >= 0 && !!h[i + 1] && h[i + 1].startsWith(`${rk}: `); };
    const filesIn = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
    const stripTime = (l) => l.replace(/^- \d\d:\d\d:\d\d /, '');

    // (a) resumeCommand·statusHeader 단위: claude/codex 형식, 공백·따옴표 포함 id → '', 모르는 에이전트 → '' (재개 줄 생략)
    {
      const sid = '210995b2-050f-4541-853a-78cb521508b5';
      const hC = C.statusHeader(sid, 'c:/x', process.env, 'claude');
      const hG = C.statusHeader(sid, 'c:/x', process.env, 'gemini');
      rec(11, '(a) resumeCommand·statusHeader', 'claude --resume <id> / codex resume <id> / 잘못된 id·모르는 에이전트 빈 문자열·머리에 재개 줄 없음',
        `${C.resumeCommand(sid, 'claude')} | ${C.resumeCommand(sid, 'codex')} | ${JSON.stringify(C.resumeCommand('a b', 'claude'))} | ${JSON.stringify(C.resumeCommand(sid, 'gemini'))} | hC=${/^재개: claude --resume /m.test(hC)} hG=${/^재개: /m.test(hG)}`,
        C.resumeCommand(sid, 'claude') === `claude --resume ${sid}` && C.resumeCommand(sid, 'codex') === `codex resume ${sid}`
        && C.resumeCommand('a b', 'claude') === '' && C.resumeCommand(`${sid}"`, 'claude') === '' && C.resumeCommand(sid, 'gemini') === ''
        && AC2.test(hC + '\n## 하던 일\n') && new RegExp(`^재개: claude --resume ${sid}$`, 'm').test(hC) && !/^재개: /m.test(hG));
    }
    // (b) Stop → STATUS.md·sessions 사본 머리에 `재개: claude --resume <sid>`(앵커 줄 다음), AC-2 정규식 유지, Reader 주입에 포함
    const aB = P('r19b');
    const sB = startSession(aB); arm(sB);
    {
      run('stop.mjs', { session_id: sB, cwd: aB, last_assistant_message: `끝\n${block('R19')}` }, baseEnv(sB));
      const s = statusOf(aB) || ''; const c = readF(sessFile(aB, sB)) || '';
      const want = `재개: claude --resume ${sB}`;
      const rd = C.readerBody(aB, baseEnv(sB), { sid8: sB.slice(0, 8) });
      rec(11, '(b) Stop → 재개 줄', 'STATUS·사본 모두 앵커 다음 줄에 재개 명령·AC-2 유지·Reader 포함',
        `status=${resumeLineOf(s)} copy=${resumeLineOf(c)} afterAnchor=${afterAnchor(s)} ac2=${AC2.test(s)} reader=${rd.includes(want)}`,
        resumeLineOf(s) === want && resumeLineOf(c) === want && afterAnchor(s) && AC2.test(s) && hasAll4(s) && rd.includes(want));
    }
    // (c) SessionEnd(prompt_input_exit): 로그 `[exit] 종료(reason=prompt_input_exit) 재개: claude --resume <sid>`, 재개 줄 이미 있음 → 보강 로그 없음, 출력 없음, 상태 파일 유지
    {
      const before = statusOf(aB);
      const r = run('session-end.mjs', { session_id: sB, cwd: aB, reason: 'prompt_input_exit', hook_event_name: 'SessionEnd' }, baseEnv(sB));
      const exitLine = logOf(aB).trimEnd().split('\n').filter((l) => l.includes('[exit]'));
      rec(11, '(c) SessionEnd /exit → 로그', '[exit] 종료(reason=prompt_input_exit) 재개: claude --resume <sid>·보강 로그 없음·STATUS 불변·무출력',
        `lines=${JSON.stringify(exitLine.map(stripTime))} same=${statusOf(aB) === before} out=${JSON.stringify(r.out)} state=${fs.existsSync(stateFile(sB))}`,
        exitLine.length === 1 && exitLine[0].endsWith(`[${sB.slice(0, 8)}][claude] [exit] 종료(reason=prompt_input_exit) 재개: claude --resume ${sB}`)
        && statusOf(aB) === before && r.out === '' && r.code === 0 && fs.existsSync(stateFile(sB)));
    }
    // (d) 구형 STATUS(재개 줄 없음, 세션 일치) → SessionEnd 가 앵커 다음에 재개 줄 삽입 + `[exit] STATUS 재개 줄 보강` 로그, 본문 불변. 사본 없음 → 생성하지 않음
    {
      const a = P('r19d'); const sid = startSession(a);
      const h = path.join(a, HD); fs.mkdirSync(h, { recursive: true });
      const old = `# STATUS\n세션: ${sid.slice(0, 8)}\n작성: claude (${sid.slice(0, 8)})\n갱신: 2026-10-01 00:00:00\n앵커: ${a}\n\n## 하던 일\n- 구형\n## 한 일\n- x\n## 다음 할 일\n- y\n## 진행도\n- z\n`;
      fs.writeFileSync(path.join(h, 'STATUS.md'), old);
      run('session-end.mjs', { session_id: sid, cwd: a, reason: 'logout' }, baseEnv(sid));
      const s = statusOf(a) || '';
      const bodySame = s.split('\n\n').slice(1).join('\n\n') === old.split('\n\n').slice(1).join('\n\n');
      const okLog = /\[exit\] STATUS 재개 줄 보강/.test(logOf(a)) && /\(reason=logout\)/.test(logOf(a));
      rec(11, '(d) 구형 STATUS 보강', '재개 줄 삽입(앵커 다음)·본문 동일·보강 로그·사본 미생성',
        `line=${resumeLineOf(s)} afterAnchor=${afterAnchor(s)} body=${bodySame} log=${okLog} copy=${fs.existsSync(sessFile(a, sid))}`,
        resumeLineOf(s) === `재개: claude --resume ${sid}` && afterAnchor(s) && bodySame && okLog && !fs.existsSync(sessFile(a, sid)));
    }
    // (e) STATUS 가 다른 세션 소유 → 머리 불변(남의 재개 줄 안 바꿈), 자기 사본만 보강, [exit] 로그는 기록
    {
      const a = P('r19e');
      const s1 = startSession(a); arm(s1);
      run('stop.mjs', { session_id: s1, cwd: a, last_assistant_message: `끝\n${block('A')}` }, baseEnv(s1));
      const s2 = startSession(a); arm(s2);
      run('stop.mjs', { session_id: s2, cwd: a, last_assistant_message: `끝\n${block('B')}` }, baseEnv(s2));
      // s1 사본의 재개 줄을 지워 보강 대상으로 만듦
      const c1 = readF(sessFile(a, s1)).split('\n').filter((l) => !l.startsWith('재개: ')).join('\n');
      fs.writeFileSync(sessFile(a, s1), c1);
      const statusBefore = statusOf(a);
      run('session-end.mjs', { session_id: s1, cwd: a, reason: 'prompt_input_exit' }, baseEnv(s1));
      const c1after = readF(sessFile(a, s1)) || '';
      const exitLogged = logOf(a).includes(`[${s1.slice(0, 8)}][claude] [exit] 종료(reason=prompt_input_exit)`);
      rec(11, '(e) 다른 세션 STATUS 보호', 'STATUS.md(세션 s2) 불변·s1 사본만 재개 줄 복원·[exit] 로그 s1',
        `statusSame=${statusOf(a) === statusBefore} statusLine=${resumeLineOf(statusOf(a))} copy=${resumeLineOf(c1after)} exitLog=${exitLogged}`,
        statusOf(a) === statusBefore && resumeLineOf(statusOf(a)) === `재개: claude --resume ${s2}` && resumeLineOf(c1after) === `재개: claude --resume ${s1}` && exitLogged);
    }
    // (f) 상태 파일 없음(경계 안 cwd 라도) → 파일 생성 없음·무출력 / AUTO_HISTORY_DISABLE=1 → 무기록 / session_id 없음 → 무기록
    {
      const a = P('r19f'); fs.mkdirSync(a, { recursive: true });
      const sid = sidNew();
      const r1 = run('session-end.mjs', { session_id: sid, cwd: a, reason: 'other' }, baseEnv(sid));
      const noFiles = filesIn(path.join(a, HD)).length === 0;
      const sid2 = startSession(a);
      const logBefore = logOf(a);
      const r2 = run('session-end.mjs', { session_id: sid2, cwd: a, reason: 'other' }, baseEnv(sid2, { AUTO_HISTORY_DISABLE: '1' }));
      const r3 = run('session-end.mjs', { cwd: a, reason: 'other' }, baseEnv(sid2));
      rec(11, '(f) 무상태·DISABLE·id 없음 → 무기록', '히스토리 폴더 없음·로그 불변·무출력·exit 0',
        `noFiles=${noFiles} logSame=${logOf(a) === logBefore} outs=${JSON.stringify([r1.out, r2.out, r3.out])} codes=${[r1.code, r2.code, r3.code]}`,
        noFiles && logOf(a) === logBefore && r1.out === '' && r2.out === '' && r3.out === '' && r1.code === 0 && r2.code === 0 && r3.code === 0);
    }
    // (g) --agent codex: Stop 머리 `재개: codex resume <sid>`, SessionEnd 로그 [codex] 태그·codex resume, 사본 sessions/codex-<id8>.md
    {
      const a = P('r19g'); fs.mkdirSync(a, { recursive: true });
      const sc = sidNew();
      run('session-start.mjs', { session_id: sc, source: 'startup', cwd: a }, cxEnv(sc), CX);
      run('stop.mjs', { session_id: sc, cwd: a, last_assistant_message: `끝\n${block('CX')}` }, cxEnv(sc), CX);
      const s = statusOf(a) || '';
      run('session-end.mjs', { session_id: sc, cwd: a, hook_event_name: 'SessionEnd' }, cxEnv(sc), CX);
      const exitLine = logOf(a).trimEnd().split('\n').filter((l) => l.includes('[exit]'));
      rec(11, '(g) codex 재개 명령', 'STATUS 재개: codex resume <sid>·사본 동일·로그 [id8][codex] [exit] 종료 재개: codex resume <sid>(reason 없음 → 괄호 없음)',
        `status=${resumeLineOf(s)} copy=${resumeLineOf(readF(sessFile(a, sc, 'codex')))} exit=${JSON.stringify(exitLine.map(stripTime))}`,
        resumeLineOf(s) === `재개: codex resume ${sc}` && resumeLineOf(readF(sessFile(a, sc, 'codex'))) === `재개: codex resume ${sc}`
        && exitLine.length === 1 && exitLine[0].endsWith(`[${sc.slice(0, 8)}][codex] [exit] 종료 재개: codex resume ${sc}`));
    }
    // (h) install --install(임시 settings) → 6 이벤트에 SessionEnd(matcher *, session-end.mjs, timeout 5) 포함, 재설치 멱등, uninstall 왕복
    {
      const copy = path.join(SCRATCH, 'settings-r19.json');
      const foreignStop = { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo foreign' }] }] };
      fs.writeFileSync(copy, JSON.stringify({ foo: 1, hooks: foreignStop }, null, 2) + '\n');
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args, '--settings', copy], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_LANG: 'ko' }) });
      inst(['--install']); inst(['--install']);
      const j = readJson(copy) || {};
      const se = (j.hooks && j.hooks.SessionEnd) || [];
      const h = se[0] && se[0].hooks && se[0].hooks[0];
      const ok = se.length === 1 && se[0].matcher === '*' && !!h && /session-end\.mjs"$/.test(h.command) && h.timeout === 5 && Object.keys(j.hooks).length === 6 && j.hooks.Stop.length === 2;
      inst(['--uninstall']);
      const fin = readJson(copy) || {};
      rec(11, '(h) install → SessionEnd 등록', '6 이벤트·SessionEnd 1그룹 matcher *·session-end.mjs·t5·멱등·uninstall 후 foreign 만',
        `events=${Object.keys(j.hooks || {}).join(',')} se=${JSON.stringify(se)} fin=${JSON.stringify(fin.hooks)}`,
        ok && JSON.stringify(fin.hooks) === JSON.stringify(foreignStop));
    }
    // (i) --codex-hooks 재실행: 기존 파일(우리 0.2.0 의 5 이벤트 + 타 핸들러) → SessionEnd 추가·타 핸들러 보존·멱등·백업 생성·dry-run 무변경
    {
      const cf = path.join(SCRATCH, 'codex-home-r19', '.codex', 'hooks.json');
      fs.mkdirSync(path.dirname(cf), { recursive: true });
      const hookFwd = HOOK.replace(/\\/g, '/');
      const ours = (script, timeout) => ({ hooks: [{ type: 'command', command: `node "${hookFwd}/${script}" --agent codex`, commandWindows: `node "${hookFwd}/${script}" --agent codex`, timeout }] });
      const foreign = { hooks: [{ type: 'command', command: 'node "C:/x/other-tool/stop.mjs" --agent codex', timeout: 3 }] };
      const old = { hooks: {
        SessionStart: [ours('session-start.mjs', 5)], UserPromptSubmit: [ours('prompt-submit.mjs', 3)], PreToolUse: [ours('pre-tool.mjs', 3)],
        PostToolUse: [ours('post-tool.mjs', 3)], Stop: [foreign, ours('stop.mjs', 5)], SubagentStop: [foreign],
      } };
      fs.writeFileSync(cf, JSON.stringify(old, null, 2) + '\n');
      const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args, '--codex-file', cf], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_LANG: 'ko' }) });
      const parse = (x) => { try { return JSON.parse(x.stdout); } catch { return {}; } };
      const before = fs.readFileSync(cf, 'utf-8');
      const d = inst(['--codex-hooks', '--dry-run']);
      const dryOk = fs.readFileSync(cf, 'utf-8') === before && d.status === 0;
      const r1 = parse(inst(['--codex-hooks']));
      const j1 = readJson(cf) || {};
      const r2 = parse(inst(['--codex-hooks']));
      const j2 = readJson(cf) || {};
      const isOurs = (x) => x && typeof x.command === 'string' && x.command.replace(/\\/g, '/').startsWith(`node "${hookFwd}/`);
      const oursOf = (j) => Object.values(j.hooks || {}).flat().flatMap((g) => g.hooks || []).filter(isOurs);
      const se = j1.hooks && j1.hooks.SessionEnd && j1.hooks.SessionEnd[0] && j1.hooks.SessionEnd[0].hooks[0];
      rec(11, '(i) --codex-hooks 재실행 → SessionEnd 추가', '우리 6개(SessionEnd t5 추가)·타 핸들러(Stop·SubagentStop) 보존·재실행 changed=false·백업·dry-run 무변경',
        `ours=${oursOf(j1).length}/${oursOf(j2).length} stop=${(j1.hooks && j1.hooks.Stop || []).length} se=${JSON.stringify(se)} changed=${r1.changed}/${r2.changed} backup=${!!r1.backup} dry=${dryOk}`,
        oursOf(j1).length === 6 && oursOf(j2).length === 6 && JSON.stringify(j1) === JSON.stringify(j2)
        && j1.hooks.Stop.length === 2 && j1.hooks.Stop[0].hooks[0].command === foreign.hooks[0].command && JSON.stringify(j1.hooks.SubagentStop) === JSON.stringify([foreign])
        && !!se && se.command === `node "${hookFwd}/session-end.mjs" --agent codex` && se.commandWindows === se.command && se.timeout === 5
        && r1.changed === true && r2.changed === false && !!r1.backup && fs.existsSync(r1.backup) && dryOk);
    }
    // (k) 영어 모드: codex Stop 머리 `Resume: codex resume <sid>`(Anchor 다음), SessionEnd 영어 로그, 영어 구형 머리에 Resume 줄 보강
    {
      const a = P('r19k'); fs.mkdirSync(a, { recursive: true });
      const sc = sidNew();
      const enEnv = cxEnv(sc, { AUTO_HISTORY_LANG: 'en' });
      const blk = ['<!-- STATUS:BEGIN -->', '## Working on', '- EN19', '## Done', '- x', '## Next', '- y', '## Progress', '- z', '<!-- STATUS:END -->'].join('\n');
      run('session-start.mjs', { session_id: sc, source: 'startup', cwd: a }, enEnv, CX);
      run('stop.mjs', { session_id: sc, cwd: a, last_assistant_message: `done\n${blk}` }, enEnv, CX);
      const s = statusOf(a) || '';
      const r = run('session-end.mjs', { session_id: sc, cwd: a, reason: 'prompt_input_exit' }, enEnv, CX);
      const exitLine = logOf(a).trimEnd().split('\n').filter((l) => l.includes('[exit]'));
      // 영어 구형 머리(Resume 없음) → upsertStatusResume 이 Anchor 다음에 Resume 줄 삽입, 두 번째 호출은 변경 없음
      const f = path.join(SCRATCH, 'r19k-old-status.md');
      fs.writeFileSync(f, `# STATUS\nSession: ${sc.slice(0, 8)}\nAuthor: codex (${sc.slice(0, 8)})\nUpdated: 2026-10-01 00:00:00\nAnchor: ${a}\n\n## Working on\n- old\n`);
      const u1 = C.upsertStatusResume(f, sc.slice(0, 8), `codex resume ${sc}`, { AUTO_HISTORY_LANG: 'en' });
      const u2 = C.upsertStatusResume(f, sc.slice(0, 8), `codex resume ${sc}`, { AUTO_HISTORY_LANG: 'en' });
      const fo = readF(f) || '';
      rec(11, '(k) 영어 모드 Resume 줄·로그', 'STATUS Resume: codex resume <sid>(Anchor 다음)·로그 [exit] session end(reason=prompt_input_exit) resume: codex resume <sid>·구형 영어 머리 보강 1회·본문 유지',
        `status=${resumeLineOf(s, 'Resume')} afterAnchor=${afterAnchor(s, 'Anchor', 'Resume')} exit=${JSON.stringify(exitLine.map(stripTime))} out=${JSON.stringify(r.out)} u=${u1}/${u2} old=${resumeLineOf(fo, 'Resume')}`,
        resumeLineOf(s, 'Resume') === `Resume: codex resume ${sc}` && afterAnchor(s, 'Anchor', 'Resume') && !/^재개: /m.test(s)
        && exitLine.length === 1 && exitLine[0].endsWith(`[${sc.slice(0, 8)}][codex] [exit] session end(reason=prompt_input_exit) resume: codex resume ${sc}`) && r.out === ''
        && u1 === true && u2 === false && afterAnchor(fo, 'Anchor', 'Resume') && resumeLineOf(fo, 'Resume') === `Resume: codex resume ${sc}` && fo.endsWith('\n\n## Working on\n- old\n'));
    }
    // (j) 기존 1~10행 전부 통과
    {
      const prior = results.filter((x) => x.row <= 10);
      rec(11, '(j) 기존 1~10행 전부 통과', `${prior.length}/${prior.length} PASS`, `${prior.filter((x) => x.pass).length}/${prior.length}`, prior.every((x) => x.pass));
    }
  }

  // ---------- 12행 트래커 페이지 자동 생성·갱신 ----------
  await row12();

  // ---------- 결과 ----------
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '⏎');
  const rows = results.map((x) => `| ${x.row} | ${esc(x.id)} | \`${esc(x.expect)}\` | ${esc(x.actual)} | ${x.pass ? 'PASS' : 'FAIL'} |`);
  const pass = results.filter((x) => x.pass).length;
  const md = `| 행 | 케이스 | 기대 | 실제 | 판정 |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n합계: ${pass}/${results.length} PASS, ${results.length - pass} FAIL\n`;
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, 'results.md'), md);
  fs.writeFileSync(path.join(SCRATCH, 'results.json'), JSON.stringify(results, null, 2));
  for (const x of results.filter((r) => !r.pass)) console.log(`FAIL [${x.row}] ${x.id} :: expect ${x.expect} :: actual ${x.actual}`);
  console.log(`TOTAL ${pass}/${results.length} PASS -> ${path.join(SCRATCH, 'results.md')}`);
}

// ---------- 12행: 트래커 페이지(TRACKER 블록·프로젝트별 TRACKER.json·템플릿 빌드) ----------
async function row12() {
  const B = await import('../tracker-build.mjs');
  const CX = ['--agent', 'codex'];
  const cxEnv = (sid, over = {}) => baseEnv(sid, { CLAUDE_CODE_ENTRYPOINT: undefined, CLAUDE_CODE_SESSION_ID: undefined, ...over });
  const trFile = (a) => path.join(a, HD, 'TRACKER.json');
  const htmlFile = (a) => path.join(a, HD, 'tracker', 'index.html');
  const marker = (sid) => path.join(STATE, `${sid}.tracker`);
  const reasonOf = (out) => { try { return JSON.parse(out).reason || ''; } catch { return ''; } };
  const ctxOf = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext || ''; } catch { return ''; } };
  const tblock = (obj) => `<!-- TRACKER:BEGIN -->\n${JSON.stringify(obj)}\n<!-- TRACKER:END -->`;
  const stop12 = (sid, a, msg, extra = {}, env = baseEnv(sid)) => run('stop.mjs', { session_id: sid, cwd: a, transcript_path: '', stop_hook_active: false, last_assistant_message: msg, ...extra }, env);
  const postT = (sid, a, tool, input, extra = {}, env = baseEnv(sid)) => run('post-tool.mjs', { session_id: sid, cwd: a, tool_name: tool, tool_input: input, duration_ms: 5, ...extra }, env);
  const mkConf = (name, files) => { const d = path.join(SCRATCH, name); fs.mkdirSync(d, { recursive: true }); for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c); return d; };
  const CONF_TOFF = mkConf('conf-tracker-off', { INTERACTIVE_ENTRYPOINTS: 'cli\n', TRACKER_OFF: '' });
  const CONF_TSINCE = mkConf('conf-tracker-since', { INTERACTIVE_ENTRYPOINTS: 'cli\n', TRACKER_SINCE: '# 시험\n2026-09-01\n' });
  const ITEM = { id: 'A-1', area: 'A', title: '이메일 로그인', account: 'test@x.com / Pass1234!', path: '상단 「로그인」', todo: '「로그인」 누르기', expect: '대시보드 이동', ai: { status: 'ok', note: 'live 200' } };

  // (a) trackerEligibility: 없음→new / SINCE 이전 로그→legacy / gz 만 있어도 legacy / json on·off / TRACKER_OFF / TRACKER_SINCE 파일
  {
    const e = { AUTO_HISTORY_CONF_DIR: CONF };
    const aNew = P('t20a-new'); fs.mkdirSync(aNew, { recursive: true });
    const aOld = P('t20a-old'); fs.mkdirSync(path.join(aOld, HD), { recursive: true }); fs.writeFileSync(path.join(aOld, HD, '2026-10-01.md'), '- x\n');
    const aGz = P('t20a-gz'); fs.mkdirSync(path.join(aGz, HD, 'archive'), { recursive: true }); fs.writeFileSync(path.join(aGz, HD, 'archive', '2026-09-01.md.gz'), 'x');
    const aToday = P('t20a-today'); fs.mkdirSync(path.join(aToday, HD), { recursive: true }); fs.writeFileSync(path.join(aToday, HD, `${today()}.md`), '- x\n');
    const aOn = P('t20a-on'); fs.mkdirSync(path.join(aOn, HD), { recursive: true }); fs.writeFileSync(trFile(aOn), JSON.stringify({ mode: 'on' }));
    fs.writeFileSync(path.join(aOn, HD, '2026-01-01.md'), '- 오래된 로그라도 json 이 우선\n');
    const aOff = P('t20a-off'); fs.mkdirSync(path.join(aOff, HD), { recursive: true }); fs.writeFileSync(trFile(aOff), JSON.stringify({ mode: 'off' }));
    const aMid = P('t20a-mid'); fs.mkdirSync(path.join(aMid, HD), { recursive: true }); fs.writeFileSync(path.join(aMid, HD, '2026-09-15.md'), '- x\n');
    const m = (a, env = e) => C.trackerEligibility(a, env).mode;
    const got = [m(aNew), m(aOld), m(aGz), m(aToday), m(aOn), m(aOff), m(aNew, { AUTO_HISTORY_CONF_DIR: CONF_TOFF }), m(aMid), m(aMid, { AUTO_HISTORY_CONF_DIR: CONF_TSINCE })];
    const want = ['new', 'legacy', 'legacy', 'new', 'on', 'off', 'off', 'legacy', 'new'];
    rec(12, '(a) trackerEligibility', want.join(','), `${got.join(',')} since=${C.trackerSince(e)}/${C.trackerSince({ AUTO_HISTORY_CONF_DIR: CONF_TSINCE })}`,
      got.join(',') === want.join(',') && C.TRACKER_SINCE_DEFAULT === '2026-10-27' && C.trackerSince(e) === '2026-10-27' && C.trackerSince({ AUTO_HISTORY_CONF_DIR: CONF_TSINCE }) === '2026-09-01');
  }

  // (b) PostToolUse 마커: Edit 앵커 안→touch, .ai-history 안→no, Bash 빌드→touch, Read→no, 서브에이전트→no / TRACKER_CHANGE_RE 단위
  {
    const a = P('t20b'); const sid = startSession(a);
    const step = (tool, input, extra) => { fs.rmSync(marker(sid), { force: true }); postT(sid, a, tool, input, extra); return fs.existsSync(marker(sid)); };
    const got = {
      editIn: step('Edit', { file_path: path.join(a, 'src', 'app.ts') }),
      editHist: step('Edit', { file_path: path.join(a, HD, 'note.md') }),
      editNm: step('Write', { file_path: path.join(a, 'node_modules', 'x', 'i.js') }),
      editOut: step('Write', { file_path: path.join(OUTSIDE, 'x.ts') }),
      bashBuild: step('Bash', { command: 'npm run build' }),
      bashLs: step('Bash', { command: 'ls -la' }),
      read: step('Read', { file_path: path.join(a, 'src', 'app.ts') }),
      sub: step('Edit', { file_path: path.join(a, 'src', 'app.ts') }, { agent_id: 'agent-123', agent_type: 'executor' }),
      nb: step('NotebookEdit', { notebook_path: path.join(a, 'n.ipynb') }),
    };
    const wantB = { editIn: true, editHist: false, editNm: false, editOut: false, bashBuild: true, bashLs: false, read: false, sub: false, nb: true };
    rec(12, '(b) PostToolUse .tracker 마커', JSON.stringify(wantB), JSON.stringify(got), JSON.stringify(got) === JSON.stringify(wantB));
    const yes = ['firebase deploy --only hosting', 'pnpm build', 'next build', 'docker compose up -d', 'git commit -m x', 'echo a >> f.txt', 'Set-Content -Path a.txt -Value 1', 'npx create-next-app x', 'gcloud run deploy svc', 'WRANGLER DEPLOY'];
    const no = ['git status', 'ls -la', 'npm test', 'cat README.md', 'node --check a.mjs', 'scp a b'];
    const bad = yes.filter((s) => !C.TRACKER_CHANGE_RE.test(s)).concat(no.filter((s) => C.TRACKER_CHANGE_RE.test(s)));
    rec(12, '(b) TRACKER_CHANGE_RE', '빌드·배포·생성 명령 참 / 조회 명령 거짓', `오판=${JSON.stringify(bad)}`, bad.length === 0);
  }

  // (c) extractTracker: 정상·JSON 오류·STATUS 공존·rest 에서 제거·펜스 줄 제외·마지막 블록
  {
    const m1 = `본문\n${tblock({ items: [ITEM] })}\n${block('C1')}`;
    const x1 = C.extractTracker(m1);
    const ok1 = x1.found && x1.json && x1.json.items[0].id === 'A-1' && !x1.error && !/TRACKER:/.test(x1.rest) && /STATUS:BEGIN/.test(x1.rest) && /^본문/.test(x1.rest);
    const x2 = C.extractTracker('a\n<!-- TRACKER:BEGIN -->\n{"items":[\n<!-- TRACKER:END -->');
    const ok2 = x2.found && x2.json === null && !!x2.error;
    const x3 = C.extractTracker(`${tblock({ note: '처음' })}\n<!-- TRACKER:BEGIN -->\n\`\`\`json\n{"note":"마지막"}\n\`\`\`\n<!-- TRACKER:END -->`);
    const ok3 = x3.found && x3.json && x3.json.note === '마지막' && /처음/.test(x3.rest);
    const x4 = C.extractTracker('블록 없음');
    const ok4 = !x4.found && x4.json === null && x4.rest === '블록 없음';
    rec(12, '(c) extractTracker', '정상·오류(found+error)·마지막 블록+펜스 제외·없음', `ok=${[ok1, ok2, ok3, ok4]} err=${x2.error}`, ok1 && ok2 && ok3 && ok4);
  }

  // (d) mergeTracker: upsert·remove·area 자동·검증 상한·user 만 변경 시 changed=false·"변경 없음"/"no changes" 메모
  {
    const now = '2026-10-27T01:00:00.000Z';
    const m0 = C.mergeTracker(null, { project: 'P', items: [ITEM, { id: 'Q-3', title: '자동 영역' }] }, { by: 'claude-t', now });
    const m1 = C.mergeTracker(m0.json, { items: [{ id: 'A-1', title: '바뀐 제목' }] }, { by: 'claude-t', now });
    const it1 = m1.json.items.find((x) => x.id === 'A-1');
    const okUpsert = m0.added === 2 && m1.changed && m1.updated === 1 && it1.title === '바뀐 제목' && it1.account === ITEM.account && it1.ai.status === 'ok';
    const okArea = m0.json.items.find((x) => x.id === 'Q-3').area === 'Q' && m0.json.areas.some((x) => x.id === 'Q' && x.title === 'Q') && m0.json.areas.some((x) => x.id === 'A');
    const m2 = C.mergeTracker(m1.json, { remove: ['Q-3', 'NONE'] }, { now });
    const okRemove = m2.removed === 1 && m2.changed && m2.json.items.length === 1;
    const many = []; for (let i = 0; i < 305; i++) many.push({ id: `M-${i}` });
    const m3 = C.mergeTracker(null, { items: many.concat([{ id: '-bad' }, { id: 'x'.repeat(17) }, { id: 'L-1', title: '가'.repeat(700), ai: { status: 'weird' }, user: { status: 'weird' } }]) }, { now });
    const okLimit = m3.json.items.length === 300 && !m3.json.items.some((x) => x.id === '-bad' || x.id.length > 16);
    const m3b = C.mergeTracker(m0.json, { items: [{ id: 'L-1', title: '가'.repeat(700), ai: { status: 'weird' }, user: { status: 'weird' } }] }, { now });
    const l1 = m3b.json.items.find((x) => x.id === 'L-1');
    const okCap = l1.title.length === 600 && l1.ai.status === '-' && l1.user.status === '';
    const m4 = C.mergeTracker(m1.json, { items: [{ id: 'A-1', user: { status: 'ok', note: '확인함' } }] }, { now });
    const okUser = m4.changed === false && m4.userOnly === true && m4.json.items.find((x) => x.id === 'A-1').user.status === 'ok' && m4.json.userSyncAt === now;
    const m5 = C.mergeTracker(m1.json, { note: '변경 없음', items: [] }, { now });
    const m5e = C.mergeTracker(m1.json, { note: 'No changes.' }, { now });
    const okNoChange = m5.changed === false && m5.json.notes.length === 0 && m5e.changed === false && m5e.json.notes.length === 0;
    const m6 = C.mergeTracker(m1.json, { note: '사용자에게 남기는 메모' }, { now });
    rec(12, '(d) mergeTracker', 'upsert·area 자동·remove·상한(300·600·id)·status 정규화·user 만=userOnly·"변경 없음"/"No changes." 무변경·메모=changed',
      `upsert=${okUpsert} area=${okArea} remove=${okRemove} limit=${okLimit}(${m3.json.items.length}) cap=${okCap} user=${okUser} nochange=${okNoChange} note=${m6.changed}/${m6.json.notes.length}`,
      okUpsert && okArea && okRemove && okLimit && okCap && okUser && okNoChange && m6.changed && m6.json.notes.length === 1);
  }

  // (e) Stop: 블록 → TRACKER.json·HTML 생성·pending·로그·Turn-end 에 블록 없음 / (g) 같은 Stop 이 발행 차단 1회
  const aE = P('t20e'); const sE = startSession(aE);
  {
    postT(sE, aE, 'Write', { file_path: path.join(aE, 'index.html') });
    const r = stop12(sE, aE, `구현했습니다.\n${tblock({ project: '시험 프로젝트', areas: [{ id: 'A', title: '로그인' }], items: [ITEM] })}\n${block('E')}`);
    const j = readJson(trFile(aE)) || {};
    const log = logOf(aE);
    const turnEnd = log.split('\n').filter((l) => l.includes('[Turn-end]')).pop() || '';
    rec(12, '(e) Stop 블록 → json·html·pending·로그', 'TRACKER.json(mode on·항목 1·pending true·htmlHash 12자)·index.html·[TRACKER] 항목 +1 ~0 -0·Turn-end 에 TRACKER 없음·STATUS 저장',
      `mode=${j.mode} n=${(j.items || []).length} pending=${j.pending} hash=${j.htmlHash} html=${fs.existsSync(htmlFile(aE))} logOk=${/\[TRACKER\] 항목 \+1 ~0 -0/.test(log)} turnEnd=${turnEnd.slice(-60)}`,
      j.mode === 'on' && (j.items || []).length === 1 && j.items[0].account === ITEM.account && j.pending === true && /^[0-9a-f]{12}$/.test(String(j.htmlHash))
      && fs.existsSync(htmlFile(aE)) && /\[TRACKER\] 항목 \+1 ~0 -0/.test(log) && !/TRACKER:BEGIN/.test(turnEnd) && /STATUS 갱신/.test(turnEnd) && /- E 하던 일/.test(statusOf(aE) || ''));
    const reason = reasonOf(r.out);
    const st = readJson(stateFile(sE)) || {};
    rec(12, '(g) pending → 발행 차단 1회', 'block·reason 에 file_path(index.html)·capabilities {"db":{},"user":{}}·publishAskedAt·[TRACKER] 발행 요구',
      `block=${BLOCK_RE.test(r.out)} file=${reason.toLowerCase().includes(htmlFile(aE).toLowerCase())} caps=${reason.includes('capabilities {"db":{},"user":{}}')} asked=${st.publishAskedAt} log=${/\[TRACKER\] 발행 요구/.test(logOf(aE))}`,
      BLOCK_RE.test(r.out) && reason.toLowerCase().includes(htmlFile(aE).toLowerCase()) && reason.includes('capabilities {"db":{},"user":{}}')
      && reason.includes('시험 프로젝트 트래커') && !!st.publishAskedAt && /\[TRACKER\] 발행 요구/.test(logOf(aE)) && !/상태 블록이 없습니다/.test(reason));
    // 같은 턴 두 번째 Stop(stop_hook_active 아님): pending 이지만 publishAskedAt 있음 → 차단 없음
    const r2 = stop12(sE, aE, `아직 발행 안 함\n${block('E1')}`, { stop_hook_active: false });
    // url 블록 → pending=false·publishedAt·publishedHash·로그
    const r3 = stop12(sE, aE, tblock({ url: 'https://claude.ai/artifact/abcDEF123456' }), { stop_hook_active: true });
    const j3 = readJson(trFile(aE)) || {};
    // 잘못된 url 은 무시
    const r4 = stop12(sE, aE, tblock({ url: 'https://evil.example.com/artifact/abcdef' }), { stop_hook_active: true });
    const j4 = readJson(trFile(aE)) || {};
    rec(12, '(g) url 블록 → pending=false·publishedAt', '2회차 무출력·url 저장·pending false·publishedHash=htmlHash·[TRACKER] 발행 url 저장·잘못된 url 무시',
      `out2='${r2.out}' url=${j3.url} pending=${j3.pending} pubAt=${j3.publishedAt} pubHash=${j3.publishedHash === j3.htmlHash} log=${/\[TRACKER\] 발행 url 저장/.test(logOf(aE))} bad=${j4.url}`,
      r2.out === '' && r3.out === '' && r4.out === '' && j3.url === 'https://claude.ai/artifact/abcDEF123456' && j3.pending === false && !!j3.publishedAt
      && j3.publishedHash === j3.htmlHash && /\[TRACKER\] 발행 url 저장/.test(logOf(aE)) && j4.url === 'https://claude.ai/artifact/abcDEF123456');
    // user 만 바뀐 블록 → 저장만(pending 유지 false·html 불변)
    const htmlBefore = fs.readFileSync(htmlFile(aE), 'utf-8');
    stop12(sE, aE, tblock({ items: [{ id: 'A-1', user: { status: 'fail', note: '버튼 없음' } }] }), { stop_hook_active: true });
    const j5 = readJson(trFile(aE)) || {};
    rec(12, '(d·e) user 만 변경 → 저장만', 'user.status=fail 저장·pending false·html 불변·userSyncAt',
      `user=${j5.items && j5.items[0].user.status} pending=${j5.pending} same=${fs.readFileSync(htmlFile(aE), 'utf-8') === htmlBefore} sync=${!!j5.userSyncAt}`,
      j5.items && j5.items[0].user.status === 'fail' && j5.pending === false && fs.readFileSync(htmlFile(aE), 'utf-8') === htmlBefore && !!j5.userSyncAt);
    // JSON 오류 → 로그 1줄·재차단 없음(블록 있음으로 간주)
    run('prompt-submit.mjs', { session_id: sE, cwd: aE, prompt: '다음 작업' }, baseEnv(sE));
    postT(sE, aE, 'Edit', { file_path: path.join(aE, 'index.html') });
    const r6 = stop12(sE, aE, `x\n<!-- TRACKER:BEGIN -->\n{"items":[\n<!-- TRACKER:END -->\n${block('E2')}`);
    rec(12, '(c·e) JSON 오류 → 로그·재차단 없음', '[TRACKER] JSON 오류·무출력', `out='${r6.out}' log=${/\[TRACKER\] JSON 오류/.test(logOf(aE))}`,
      r6.out === '' && /\[TRACKER\] JSON 오류/.test(logOf(aE)));
  }

  // (f) 마커 있고 블록 없음 → 차단 1회(reason 에 TRACKER 형식), 두 번째 Stop(stop_hook_active)·trackerBlockedAt 이면 차단 없음, STATUS 와 합쳐 1회
  {
    const a = P('t20f'); const sid = startSession(a);
    postT(sid, a, 'Edit', { file_path: path.join(a, 'main.ts') });
    const r1 = stop12(sid, a, `수정했습니다.\n${block('F')}`);
    const rs1 = reasonOf(r1.out);
    const st1 = readJson(stateFile(sid)) || {};
    const r2 = stop12(sid, a, '여전히 없음', { stop_hook_active: true });
    postT(sid, a, 'Edit', { file_path: path.join(a, 'main.ts') });
    const r3 = stop12(sid, a, `또 수정.\n${block('F3')}`);
    rec(12, '(f) 마커+블록 없음 → 차단 1회', 'block·reason 에 TRACKER:BEGIN·STATUS 요구 없음·trackerBlockedAt·로그 / 2회차(stop_hook_active) 무출력 / trackerBlockedAt 남음 → 무출력',
      `block=${BLOCK_RE.test(r1.out)} fmt=${rs1.includes('<!-- TRACKER:BEGIN -->')} status=${/상태 블록이 없습니다/.test(rs1)} tba=${!!st1.trackerBlockedAt} out2='${r2.out}' out3='${r3.out}' log=${/\[TRACKER\] 블록 요구/.test(logOf(a))}`,
      BLOCK_RE.test(r1.out) && rs1.includes('<!-- TRACKER:BEGIN -->') && !/상태 블록이 없습니다/.test(rs1) && !!st1.trackerBlockedAt
      && r2.out === '' && r3.out === '' && /\[TRACKER\] 블록 요구/.test(logOf(a)));
    // 프롬프트 제출 → trackerBlockedAt·publishAskedAt null·.tracker 제거 → 다음 턴 STATUS·TRACKER 둘 다 없으면 합쳐 1회
    postT(sid, a, 'Edit', { file_path: path.join(a, 'main.ts') });
    run('prompt-submit.mjs', { session_id: sid, cwd: a, prompt: '계속' }, baseEnv(sid));
    const stP = readJson(stateFile(sid)) || {};
    const mkGone = !fs.existsSync(marker(sid));
    postT(sid, a, 'Bash', { command: 'npm run build' });
    const r4 = stop12(sid, a, '블록 둘 다 없음');
    const rs4 = reasonOf(r4.out);
    const nBlocks = (r4.out.match(/"decision":"block"/g) || []).length;
    const r5 = stop12(sid, a, '여전히 없음', { stop_hook_active: true });
    rec(12, '(f) STATUS 와 합쳐 1회', '프롬프트 후 null·마커 제거 / reason 1개에 STATUS 형식+TRACKER 형식 / 2회차 무출력·마커 정리',
      `reset=${stP.trackerBlockedAt === null && stP.publishAskedAt === null} mkGone=${mkGone} blocks=${nBlocks} both=${/상태 블록이 없습니다/.test(rs4)}/${rs4.includes('<!-- TRACKER:BEGIN -->')} out5='${r5.out}' marker=${fs.existsSync(marker(sid))}`,
      stP.trackerBlockedAt === null && stP.publishAskedAt === null && mkGone && nBlocks === 1 && /상태 블록이 없습니다/.test(rs4) && rs4.includes('<!-- TRACKER:BEGIN -->')
      && rs4.startsWith('[auto-history]') && r5.out === '' && !fs.existsSync(marker(sid)));
  }

  // (h) codex → 블록 병합·HTML 까지, 발행 차단 없음·pending 유지
  {
    const a = P('t20h'); fs.mkdirSync(a, { recursive: true }); const sc = sidNew();
    run('session-start.mjs', { session_id: sc, source: 'startup', cwd: a }, cxEnv(sc), CX);
    run('post-tool.mjs', { session_id: sc, cwd: a, tool_name: 'Bash', tool_input: { command: 'npm run build' }, duration_ms: 3 }, cxEnv(sc), CX);
    const r = run('stop.mjs', { session_id: sc, cwd: a, last_assistant_message: `끝\n${tblock({ items: [ITEM] })}\n${block('H')}` }, cxEnv(sc), CX);
    const j = readJson(trFile(a)) || {};
    rec(12, '(h) codex → 발행 차단 없음·pending 유지', '무출력·TRACKER.json pending true·html 생성·by=codex-<id8>',
      `out='${r.out}' pending=${j.pending} html=${fs.existsSync(htmlFile(a))} by=${j.items && j.items[0].by}`,
      r.out === '' && j.pending === true && fs.existsSync(htmlFile(a)) && j.items && j.items[0].by === `codex-${sc.slice(0, 8)}`);
  }

  // (i) legacy → 마커 있어도 차단 없음·블록 무시, mode:on 블록 → 켜짐 / mode:off → 끔 / 전역 TRACKER_OFF
  {
    const a = P('t20i'); fs.mkdirSync(path.join(a, HD), { recursive: true });
    fs.writeFileSync(path.join(a, HD, '2026-10-01.md'), '- 기존 기록\n');
    const sid = startSession(a);
    postT(sid, a, 'Edit', { file_path: path.join(a, 'x.ts') });
    const hadMarker = fs.existsSync(marker(sid));
    const r1 = stop12(sid, a, `수정.\n${block('I')}`);
    const r2 = stop12(sid, a, `수정.\n${tblock({ items: [ITEM] })}\n${block('I2')}`, { stop_hook_active: true });
    const ignored = /\[TRACKER\] 비활성 프로젝트 블록 무시/.test(logOf(a)) && !fs.existsSync(trFile(a));
    stop12(sid, a, `켜기.\n${tblock({ mode: 'on', items: [ITEM] })}\n${block('I3')}`, { stop_hook_active: true });
    const j = readJson(trFile(a)) || {};
    const eligOn = C.trackerEligibility(a, { AUTO_HISTORY_CONF_DIR: CONF }).mode;
    stop12(sid, a, `끄기.\n${tblock({ mode: 'off' })}\n${block('I4')}`, { stop_hook_active: true });
    const eligOff = C.trackerEligibility(a, { AUTO_HISTORY_CONF_DIR: CONF }).mode;
    rec(12, '(i) legacy → 차단 없음·mode on 으로 켬·mode off 로 끔', '마커 있음·무출력·블록 무시 로그·json 없음 → mode on 블록 후 on·항목 1 → off 블록 후 off·[TRACKER] 끔',
      `marker=${hadMarker} out1='${r1.out}' out2='${r2.out}' ignored=${ignored} mode=${j.mode} n=${(j.items || []).length} elig=${eligOn}→${eligOff} log=${/\[TRACKER\] 끔/.test(logOf(a))}`,
      hadMarker && r1.out === '' && r2.out === '' && ignored && j.mode === 'on' && (j.items || []).length === 1 && eligOn === 'on' && eligOff === 'off' && /\[TRACKER\] 끔/.test(logOf(a)));
    const b = P('t20i2'); const sb = startSession(b, sidNew(), { AUTO_HISTORY_CONF_DIR: CONF_TOFF });
    postT(sb, b, 'Edit', { file_path: path.join(b, 'x.ts') }, {}, baseEnv(sb, { AUTO_HISTORY_CONF_DIR: CONF_TOFF }));
    const rb = stop12(sb, b, `수정.\n${block('IB')}`, {}, baseEnv(sb, { AUTO_HISTORY_CONF_DIR: CONF_TOFF }));
    stop12(sb, b, `수정.\n${tblock({ mode: 'on', items: [ITEM] })}\n${block('IB2')}`, { stop_hook_active: true }, baseEnv(sb, { AUTO_HISTORY_CONF_DIR: CONF_TOFF }));
    rec(12, '(i) 전역 TRACKER_OFF', '무출력·mode on 블록도 무시(json 없음)', `out='${rb.out}' json=${fs.existsSync(trFile(b))}`, rb.out === '' && !fs.existsSync(trFile(b)));
  }

  // (j) Reader `=== 트래커 ===` 절·위치·길이 상한·json 없으면 생략
  {
    const sec = C.trackerReaderSection(aE, baseEnv(sE));
    const body = C.readerBody(aE, baseEnv(sE), { sid8: sE.slice(0, 8) });
    const iS = body.indexOf('=== STATUS.md ==='); const iT = body.indexOf('=== 트래커 ==='); const iL = body.indexOf('=== 오늘 로그 꼬리');
    const big = P('t20j'); fs.mkdirSync(path.join(big, HD), { recursive: true });
    const notes = []; for (let i = 0; i < 10; i++) notes.push({ at: '2026-10-27T00:00:00Z', text: '메모'.repeat(300) });
    fs.writeFileSync(trFile(big), JSON.stringify({ mode: 'on', url: `https://claude.ai/artifact/${'x'.repeat(2000)}`, items: [], notes }));
    const secBig = C.trackerReaderSection(big, baseEnv(sE));
    const none = P('t20j-none'); fs.mkdirSync(none, { recursive: true });
    rec(12, '(j) Reader 트래커 절', 'url·항목 1·사용자 문제 1·발행 대기 아니오 포함·STATUS 뒤 로그 앞·상한 1200·json 없음 → ""',
      `pos=${iS}<${iT}<${iL} url=${sec.includes('abcDEF123456')} fail=${/사용자 정상 0·문제 1·미확인 0/.test(sec)} big=${secBig.length} none=${JSON.stringify(C.trackerReaderSection(none, baseEnv(sE)))}`,
      iS >= 0 && iT > iS && iL > iT && sec.includes('https://claude.ai/artifact/abcDEF123456') && /항목 1 /.test(sec) && /사용자 정상 0·문제 1·미확인 0/.test(sec)
      && /발행 대기: 아니오/.test(sec) && secBig.length <= 1200 && C.trackerReaderSection(none, baseEnv(sE)) === '' && !C.readerBody(none, baseEnv(sE)).includes('=== 트래커 ==='));
  }

  // (k) 프롬프트 지시문: on+pending+claude → TRACKER·발행 단락, codex → 발행 없음, legacy → 켜기 한 줄 / 세션 시작 db 읽기 지시(url 있을 때만)
  {
    const a = P('t20k'); fs.mkdirSync(path.join(a, HD), { recursive: true });
    fs.writeFileSync(trFile(a), JSON.stringify({ version: 1, mode: 'on', project: '케이 프로젝트', pending: true, items: [ITEM] }));
    const s1 = startSession(a);
    const c1 = ctxOf(run('prompt-submit.mjs', { session_id: s1, cwd: a, prompt: '작업' }, baseEnv(s1)).out);
    const sc = sidNew();
    run('session-start.mjs', { session_id: sc, source: 'startup', cwd: a }, cxEnv(sc), CX);
    const c2 = ctxOf(run('prompt-submit.mjs', { session_id: sc, cwd: a, prompt: '작업' }, cxEnv(sc), CX).out);
    const n = P('t20k-new'); const s3 = startSession(n);
    const c3 = ctxOf(run('prompt-submit.mjs', { session_id: s3, cwd: n, prompt: '작업' }, baseEnv(s3)).out);
    const l = P('t20k-legacy'); fs.mkdirSync(path.join(l, HD), { recursive: true }); fs.writeFileSync(path.join(l, HD, '2026-10-02.md'), '- x\n');
    const s4 = startSession(l);
    const c4 = ctxOf(run('prompt-submit.mjs', { session_id: s4, cwd: l, prompt: '작업' }, baseEnv(s4)).out);
    const hasFmt = (c) => c.includes('<!-- TRACKER:BEGIN -->\n{"project"');
    const hasPub = (c) => c.includes('지금 발행하세요');
    rec(12, '(k) 프롬프트 지시문', 'on+pending+claude: STATUS·TRACKER·발행 / codex: TRACKER 만 / new: TRACKER 만 / legacy: 켜기 한 줄만',
      `on=${/STATUS:BEGIN/.test(c1)}/${hasFmt(c1)}/${hasPub(c1)} cx=${hasFmt(c2)}/${hasPub(c2)} new=${hasFmt(c3)}/${hasPub(c3)} legacy=${hasFmt(c4)}/${hasPub(c4)}/${/트래커 켜줘/.test(c4)}`,
      /STATUS:BEGIN/.test(c1) && hasFmt(c1) && hasPub(c1) && c1.toLowerCase().includes(htmlFile(a).toLowerCase()) && c1.indexOf('STATUS:BEGIN') < c1.indexOf('TRACKER:BEGIN')
      && hasFmt(c2) && !hasPub(c2) && hasFmt(c3) && !hasPub(c3) && !hasFmt(c4) && !hasPub(c4) && /트래커 켜줘/.test(c4) && /STATUS:BEGIN/.test(c4));
    const s5 = sidNew();
    const c5 = ctxOf(run('session-start.mjs', { session_id: s5, source: 'startup', cwd: aE }, baseEnv(s5)).out);
    const s6 = sidNew();
    const c6 = ctxOf(run('session-start.mjs', { session_id: s6, source: 'startup', cwd: a }, baseEnv(s6)).out);
    rec(12, '(k) 세션 시작 db 읽기 지시', 'url 있음 → ArtifactData list checks·notes 1회·[현황] 수치·Reader 트래커 절 / url 없음 → 지시 없음',
      `withUrl=${/ArtifactData `list`/.test(c5)}/${c5.includes('abcDEF123456')}/${c5.includes('=== 트래커 ===')} noUrl=${/ArtifactData/.test(c6)} len=${c5.length}`,
      /ArtifactData `list`/.test(c5) && /`checks`/.test(c5) && /`notes`/.test(c5) && c5.includes('https://claude.ai/artifact/abcDEF123456') && c5.includes('=== 트래커 ===')
      && /\[현황\]/.test(c5) && !/ArtifactData/.test(c6) && c5.length <= C.READER_TOTAL_MAX);
  }

  // (l) buildTrackerHtml: 데이터 치환·</script 이스케이프·필수 토큰·sha1 안정·템플릿 없음 → ''
  {
    const j = C.mergeTracker(null, { project: '빌드 </script><b>x</b> $& $\'', items: [ITEM] }, { by: 'claude-t', now: '2026-10-27T02:00:00.000Z' }).json;
    const h1 = B.buildTrackerHtml(j, { anchor: aE });
    const h2 = B.buildTrackerHtml({ ...j, pending: true, htmlHash: 'zzz' }, { anchor: aE });
    const dataLine = (h1.split('\n').find((x) => x.startsWith('var D = ')) || '');
    let parsed = null; try { parsed = JSON.parse(dataLine.slice('var D = '.length, -1)); } catch { /* */ }
    const scripts = (h1.match(/<\/script>/gi) || []).length;
    const tokens = ['<title>', '<html lang="ko">', 'data-theme', "claude.use('db')", 'checks/', "claude.use('user')", 'prefers-color-scheme: dark', ':root:not([data-theme="light"])', ':root[data-theme="dark"]', 'max-width: 480px'];
    const missing = tokens.filter((x) => !h1.includes(x));
    const tt = /<title>([^<]*)<\/title>/.exec(h1);
    const dir0 = path.join(SCRATCH, 'no-template');
    const empty = B.buildTrackerHtml(j, { dir: dir0 });
    const tmpA = P('t20l'); fs.mkdirSync(tmpA, { recursive: true });
    const hash = B.writeTrackerHtml(tmpA, j, baseEnv(sE));
    const fileHash = crypto.createHash('sha1').update(fs.readFileSync(htmlFile(tmpA), 'utf-8'), 'utf-8').digest('hex').slice(0, 12);
    fs.writeFileSync(path.join(SCRATCH, 'sample-tracker.html'), h1);
    rec(12, '(l) buildTrackerHtml', '데이터 JSON 파싱 가능(lang ko·라벨 사전)·</script 1개(본문만)·<title> 치환·__TRACKER_ 잔재 없음·필수 토큰·발행 필드 무관 sha1 동일·템플릿 없음 ""·writeTrackerHtml 12자=파일 sha1',
      `parsed=${!!parsed && parsed.project === j.project} lang=${parsed && parsed.lang} L=${parsed && parsed.L && parsed.L.memoHead} scripts=${scripts} title=${tt && tt[1]} rest=${/__TRACKER_/.test(h1)} missing=${JSON.stringify(missing)} stable=${B.sha12(h1) === B.sha12(h2)} empty=${JSON.stringify(empty)} hash=${hash}/${fileHash}`,
      !!parsed && parsed.project === j.project && parsed.items[0].account === ITEM.account && parsed.lang === 'ko' && parsed.L && parsed.L.memoHead === 'Claude 에게 메모'
      && scripts === 1 && !!tt && tt[1].endsWith(' 트래커') && !/<b>/.test(tt[1])
      && !/__TRACKER_/.test(h1) && missing.length === 0 && B.sha12(h1) === B.sha12(h2) && empty === '' && /^[0-9a-f]{12}$/.test(hash) && hash === fileHash);
  }

  // (o) 영어 모드: 프롬프트 지시문·Stop 로그·발행 reason·페이지 lang/라벨·Reader 절이 영어
  {
    const a = P('t20o'); const sid = sidNew();
    const enEnv = baseEnv(sid, { AUTO_HISTORY_LANG: 'en' });
    fs.mkdirSync(a, { recursive: true });
    run('session-start.mjs', { session_id: sid, source: 'startup', cwd: a }, enEnv);
    const c = ctxOf(run('prompt-submit.mjs', { session_id: sid, cwd: a, prompt: 'work' }, enEnv).out);
    const enBlk = ['<!-- STATUS:BEGIN -->', '## Working on', '- O', '## Done', '- x', '## Next', '- y', '## Progress', '- z', '<!-- STATUS:END -->'].join('\n');
    run('post-tool.mjs', { session_id: sid, cwd: a, tool_name: 'Write', tool_input: { file_path: path.join(a, 'app.js') }, duration_ms: 1 }, enEnv);
    const r = run('stop.mjs', { session_id: sid, cwd: a, transcript_path: '', last_assistant_message: `done\n${tblock({ project: 'Demo app', items: [{ id: 'A-1', title: 'Sign in' }] })}\n${enBlk}` }, enEnv);
    const rs = reasonOf(r.out);
    const html = fs.existsSync(htmlFile(a)) ? fs.readFileSync(htmlFile(a), 'utf-8') : '';
    const sec = C.trackerReaderSection(a, { AUTO_HISTORY_LANG: 'en' });
    const okPrompt = c.includes('The tracker (user check page) is ON') && c.includes('"title":"Email sign-in"') && !/트래커/.test(c);
    const okStop = /\[TRACKER\] items \+1 ~0 -0/.test(logOf(a)) && rs.includes('Publish it now.') && rs.includes('title "Demo app tracker"') && !/트래커/.test(rs);
    const okHtml = html.includes('<html lang="en">') && html.includes('<title>Demo app tracker</title>') && html.includes('"memoHead":"Note to Claude"') && html.includes('"lang":"en"');
    const okReader = sec.startsWith('\n\n=== Tracker ===') && /publish pending: yes/.test(sec);
    rec(12, '(o) 영어 모드', '지시문 영어·로그 [TRACKER] items +1 ~0 -0·발행 reason 영어(Demo app tracker)·<html lang="en">·라벨 영어·Reader === Tracker ===',
      `prompt=${okPrompt} stop=${okStop} html=${okHtml} reader=${okReader}`, okPrompt && okStop && okHtml && okReader);
  }

  // (m) 기존 1~11행 전부 통과
  {
    const prior = results.filter((x) => x.row <= 11);
    rec(12, '(m) 기존 1~11행 전부 통과', `${prior.length}/${prior.length} PASS`, `${prior.filter((x) => x.pass).length}/${prior.length}`, prior.every((x) => x.pass));
  }

  // (n) 설치 dry-run 변화 없음·이벤트 6개 그대로(트래커는 이벤트 추가 없음)
  {
    const copy = path.join(SCRATCH, 'settings-r20.json');
    if (process.argv[3]) fs.copyFileSync(process.argv[3], copy);
    else fs.writeFileSync(copy, JSON.stringify({ permissions: { allow: ['Read'] }, model: 'test-model' }, null, 2) + '\n');
    const orig = fs.readFileSync(copy, 'utf-8');
    const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args, '--settings', copy], { encoding: 'utf-8', env: hostEnv({ AUTO_HISTORY_LANG: 'ko' }) });
    const d = inst(['--install', '--dry-run']);
    const same = fs.readFileSync(copy, 'utf-8') === orig;
    inst(['--install']);
    const evs = Object.keys((readJson(copy) || {}).hooks || {}).sort();
    const want = ['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'];
    rec(12, '(n) 설치 dry-run 변화 없음', 'dry-run 무변경·exit 0·install 이벤트 6개(추가 없음)', `same=${same} code=${d.status} events=${evs.join(',')}`,
      same && d.status === 0 && evs.join(',') === want.join(','));
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
