// Cursor 입력 지원 시험. 사용: node test/run-cursor-tests.mjs — 임시 폴더만 쓰고 실제 프로젝트·상태는 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from '../common.mjs';
import { cursorProjectSlug, transcriptToTurns, renderImport } from '../import-cursor.mjs';

const hostEnv = () => { const e = {}; for (const k of ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'USERNAME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TZ']) if (process.env[k] !== undefined) e[k] = process.env[k]; return e; }; // the parent's other variables are never passed to hooks
const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-cursor-'));
const root = path.join(box, 'Project');
const proj = path.join(root, 'mind');
const state = path.join(box, 'state');
const conf = path.join(box, 'conf');
for (const d of [proj, state, conf]) fs.mkdirSync(d, { recursive: true });
const env = { ...hostEnv(), AUTO_HISTORY_LANG: 'ko', AUTO_HISTORY_ROOT: root, AUTO_HISTORY_STATE_DIR: state, AUTO_HISTORY_CONF_DIR: conf };
for (const k of Object.keys(env)) if (/^CLAUDE/.test(k) || k === 'AUTO_HISTORY_DISABLE') delete env[k];

let pass = 0, fail = 0;
const check = (name, ok, actual = '') => { if (ok) pass += 1; else { fail += 1; console.log(`FAIL ${name} ${String(actual).slice(0, 300)}`); } };
const run = (script, input, raw = false) => spawnSync(process.execPath, [path.join(HOOK, script)], { input: raw ? input : JSON.stringify(input), env, encoding: raw ? undefined : 'utf8' });

const rootUri = `/${proj.replace(/\\/g, '/').replace(/^([A-Z]):/, (m, c) => `${c.toLowerCase()}:`)}`;
const base = (sid, over = {}) => ({ session_id: sid, conversation_id: sid, cursor_version: '3.20.21', workspace_roots: [rootUri], transcript_path: null, ...over });
const logText = () => { const d = path.join(proj, '.ai-history'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => fs.readFileSync(path.join(d, f), 'utf-8')).join('') : ''; };

// 순수 함수
check('경로 변환', C.cursorRootToPath('/c:/Users/a/mind') === 'c:/Users/a/mind');
check('다른 경로는 그대로', C.cursorRootToPath('C:\\x') === 'C:\\x');
check('BOM 제거', C.decodeInput(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])) === '{}');
check('UTF-16 해독', C.decodeInput(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{}', 'utf16le')])) === '{}');
check('Claude 입력 불변', (() => { const d = { session_id: 's', cwd: 'x' }; return C.normalizeHookInput(d, env) === d && C.AGENT === 'claude'; })());
const n = C.normalizeHookInput(base('s1', { hook_event_name: 'sessionStart', duration: 5 }), env);
check('Cursor 정규화', n.cwd.toLowerCase() === rootUri.slice(1).toLowerCase() && n.source === 'startup' && n.duration_ms === 5 && C.AGENT === 'cursor', JSON.stringify(n));
check('도구 cwd 우선', C.normalizeHookInput(base('s', { tool_input: { cwd: 'c:\\t' } }), env).cwd === 'c:\\t');
check('Shell 요약', C.summarizeTool({ tool_name: 'Shell', tool_input: { command: 'dir' } }) === '[Shell] dir');
check('백그라운드는 비대화형', !C.isInteractive({ is_background_agent: true }, env, 'cursor') && C.isInteractive({}, env, 'cursor'));
check('slug', cursorProjectSlug('C:\\Users\\me\\Desktop\\Project\\mind') === 'c-Users-me-Desktop-Project-mind', cursorProjectSlug('C:\\Users\\me\\Desktop\\Project\\mind'));

// 훅 실행: 프롬프트 → 도구 → 종료
const sid = 'f30e6b94-aaaa-4000-8000-000000000001';
const p = run('prompt-submit.mjs', base(sid, { hook_event_name: 'beforeSubmitPrompt', prompt: '화면 고쳐줘' }));
check('프롬프트 출력 없음', p.stdout === '' && p.status === 0, p.stdout);
check('프롬프트 기록', logText().includes(`[${sid.slice(0, 8)}][cursor] [User] 화면 고쳐줘`), logText());
run('pre-tool.mjs', base(sid, { hook_event_name: 'preToolUse', tool_name: 'Shell', tool_input: { command: 'dir' }, cwd: '' }));
run('post-tool.mjs', base(sid, { hook_event_name: 'postToolUse', tool_name: 'Write', tool_input: { file_path: path.join(proj, 'a.txt'), content: 'x' }, duration: 1500 }));
check('도구 기록', logText().includes('▶ [Shell] dir') && logText().includes('[Write]') && logText().includes('(1.5s)'), logText());

const transcript = path.join(box, 't.jsonl');
const statusBlock = '<!-- STATUS:BEGIN -->\n## 하던 일\n- a\n## 한 일\n- b\n## 다음 할 일\n- c\n## 진행도\n- d\n<!-- STATUS:END -->';
fs.writeFileSync(transcript, `${JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: `완료\n${statusBlock}` }] } })}\n`);
const s1 = run('stop.mjs', base(sid, { hook_event_name: 'stop', status: 'completed', loop_count: 0, transcript_path: transcript }));
check('STATUS 저장', fs.existsSync(path.join(proj, '.ai-history', 'STATUS.md')) && fs.readFileSync(path.join(proj, '.ai-history', 'STATUS.md'), 'utf-8').includes('작성: cursor'));
check('STATUS 있으면 트래커 블록만 요구(§22)', JSON.parse(s1.stdout || '{}').followup_message?.includes('TRACKER:BEGIN') && !JSON.parse(s1.stdout || '{}').followup_message?.includes('STATUS:BEGIN'), s1.stdout);

run('stop.mjs', base(sid, { hook_event_name: 'stop', status: 'completed', loop_count: 1, transcript_path: transcript })); // 후속 메시지의 Stop
run('prompt-submit.mjs', base(sid, { hook_event_name: 'beforeSubmitPrompt', prompt: '하나 더' }));
run('post-tool.mjs', base(sid, { hook_event_name: 'postToolUse', tool_name: 'Write', tool_input: { file_path: path.join(proj, 'b.txt'), content: 'x' } }));
fs.writeFileSync(transcript, `${JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: '블록 없는 답변' }] } })}\n`);
const s2 = run('stop.mjs', base(sid, { hook_event_name: 'stop', status: 'completed', loop_count: 0, transcript_path: transcript }));
check('블록 없으면 후속 메시지 1회(§22)', JSON.parse(s2.stdout || '{}').followup_message?.includes('STATUS:BEGIN') && logText().includes('[Turn-end] 블록 없는 답변'), s2.stdout);

const s3 = run('session-start.mjs', base('f30e6b94-aaaa-4000-8000-000000000002', { hook_event_name: 'sessionStart' }));
let ss = {};
try { ss = JSON.parse(s3.stdout); } catch { /* 아래 판정 */ }
check('세션 시작 주입 형식', typeof ss.additional_context === 'string' && ss.additional_context.includes('STATUS:BEGIN') && ss.hookSpecificOutput?.additionalContext === ss.additional_context &&!ss.additional_context.includes('ArtifactData'), s3.stdout);

// BOM 붙은 입력도 기록, 깨진 입력은 원인만 남김
const bomSid = 'f30e6b94-aaaa-4000-8000-000000000003';
run('prompt-submit.mjs', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(base(bomSid, { prompt: 'bom-요청' })), 'utf8')]), true);
check('BOM 입력 기록', logText().includes('bom-요청'), logText());
run('pre-tool.mjs', Buffer.from('{"secret":"abc'), true);
const errs = fs.existsSync(path.join(state, 'input-errors.log')) ? fs.readFileSync(path.join(state, 'input-errors.log'), 'utf-8') : '';
check('파싱 실패 기록·본문 없음', errs.includes('pre-tool.mjs parse len=') && !errs.includes('secret'), errs);

// 경계 밖 프로젝트는 쓰지 않음
const out = path.join(box, 'outside');
fs.mkdirSync(out);
run('prompt-submit.mjs', base('f30e6b94-aaaa-4000-8000-000000000004', { prompt: 'x', workspace_roots: [`/${out.replace(/\\/g, '/').replace(/^([A-Z]):/, (m, c) => `${c.toLowerCase()}:`)}`] }));
check('경계 밖 무기록', !fs.existsSync(path.join(out, '.ai-history')));

// Claude·Codex 입력은 기존 동작
const cl = spawnSync(process.execPath, [path.join(HOOK, 'pre-tool.mjs')], { input: JSON.stringify({ session_id: 'c1aude00-1', cwd: proj, tool_name: 'Bash', tool_input: { command: 'ls' } }), env, encoding: 'utf8' });
check('Claude 라벨 유지', cl.status === 0 && logText().includes('[c1aude00][claude] ▶ [Bash] ls'), logText());

// 복원
const jsonl = [
  { role: 'user', message: { content: [{ type: 'text', text: '<user_query>\n원고 고쳐줘\n</user_query>' }] } },
  { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'c:\\p\\a.md', content: 'x' } }] } },
  { role: 'assistant', message: { content: [{ type: 'text', text: '고쳤습니다 ' + 'ghp_' + 'abcdefghijklmnopqrstuvwxyz1234' }] } },
  { type: 'status', status: 'x' },
].map((o) => JSON.stringify(o)).join('\n');
const turns = transcriptToTurns(jsonl);
const md = renderImport('f30e6b94-x', turns, 'src', 'now');
check('복원 턴', turns.length === 1 && turns[0].tools === 1 && md.includes('원고 고쳐줘') && md.includes('a.md') && !md.includes('<user_query>'), md);
check('복원 비밀 가림', !md.includes('ghp_' + 'abcdefghijklmnopqrstuvwxyz1234'), md);

fs.rmSync(box, { recursive: true, force: true });
console.log(`cursor tests pass=${pass} fail=${fail}`);
process.exitCode = fail ? 1 : 0;
