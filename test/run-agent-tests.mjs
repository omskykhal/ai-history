// §22 Grok·Kimi·Cursor 동등 기능 시험. 사용: node test/run-agent-tests.mjs — 임시 폴더만 쓰고 실제 프로젝트·상태·설정은 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from '../common.mjs';

const hostEnv = () => { const e = {}; for (const k of ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'USERNAME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TZ']) if (process.env[k] !== undefined) e[k] = process.env[k]; return e; }; // the parent's other variables are never passed to hooks
const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-agents-'));
const root = path.join(box, 'Project');
const state = path.join(box, 'state');
const conf = path.join(box, 'conf');
const kimiHome = path.join(box, 'kimi');
for (const d of [root, state, conf, kimiHome]) fs.mkdirSync(d, { recursive: true });
const baseEnv = { ...hostEnv(), AUTO_HISTORY_LANG: 'ko', AUTO_HISTORY_ROOT: root, AUTO_HISTORY_STATE_DIR: state, AUTO_HISTORY_CONF_DIR: conf, AUTO_HISTORY_KIMI_HOME: kimiHome };
for (const k of Object.keys(baseEnv)) if (/^(CLAUDE|GROK_)/.test(k) || k === 'AUTO_HISTORY_DISABLE') delete baseEnv[k];

let pass = 0, fail = 0;
const check = (name, ok, actual = '') => { if (ok) pass += 1; else { fail += 1; console.log(`FAIL ${name} ${String(actual).slice(0, 400)}`); } };
const run = (script, input, args = [], env = baseEnv) => spawnSync(process.execPath, [path.join(HOOK, script), ...args], { input: JSON.stringify(input), env, encoding: 'utf8' });
const project = (name, withStatus = false) => {
  const p = path.join(root, name);
  fs.mkdirSync(path.join(p, '.ai-history'), { recursive: true });
  if (withStatus) {
    fs.writeFileSync(path.join(p, '.ai-history', 'STATUS.md'), '# STATUS\n세션: old00000\n작성: claude (old00000)\n갱신: 2026-11-01 10:00:00\n앵커: x\n\n## 하던 일\n- 이전 작업 표지\n');
    fs.writeFileSync(path.join(p, '.ai-history', '2020-01-01.md'), '- 옛 기록\n'); // 트래커 legacy(STATUS 요구만 따로 시험)
  }
  return p;
};
const logOf = (p) => { const d = path.join(p, '.ai-history'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => fs.readFileSync(path.join(d, f), 'utf-8')).join('') : ''; };
const statusOf = (p) => { const f = path.join(p, '.ai-history', 'STATUS.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : ''; };
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const STATUS = '<!-- STATUS:BEGIN -->\n## 하던 일\n- a\n## 한 일\n- b\n## 다음 할 일\n- c\n## 진행도\n- d\n<!-- STATUS:END -->';
const sp = (sid) => C.statePaths(sid, baseEnv);

// ---- Grok: ~/.claude/settings.json 을 인자 없이 그대로 불러오므로 입력으로 판별한다
const gp = project('grokp', true);
const gsid = '01a0e9d1-a1e4-7531-bfcb-c2bddd3882e5';
const g = (over = {}, sid = gsid, cwd = gp) => ({ hookEventName: 'x', hook_event_name: 'X', sessionId: sid, session_id: sid, cwd, workspaceRoot: cwd, permissionMode: 'default', timestamp: 't', ...over });

const g1 = run('session-start.mjs', g({ source: 'new' }));
check('Grok 세션 시작: 출력 없음(모델에 안 닿는 이벤트)', g1.stdout === '' && g1.status === 0, g1.stdout);
check('Grok 세션 시작: 기록 대기', fs.existsSync(sp(gsid).ctx));
const g2 = run('prompt-submit.mjs', g({ prompt: '화면 고쳐줘' }));
check('Grok 프롬프트: 작업자 grok', logOf(gp).includes(`[${gsid.slice(0, 8)}][grok] [User] 화면 고쳐줘`), logOf(gp));
check('Grok 프롬프트: 출력 없음', g2.stdout === '', g2.stdout);
run('pre-tool.mjs', g({ toolName: 'run_terminal_command', tool_name: 'run_terminal_command', tool_input: { command: 'npm run build' } }));
check('Grok 셸 요약', logOf(gp).includes('▶ [run_terminal_command] npm run build'), logOf(gp));
const g3 = run('post-tool.mjs', g({ tool_name: 'write', tool_input: { path: path.join(gp, 'a.txt'), content: 'x' }, duration_ms: 1500 }));
const g3j = json(g3.stdout);
const g3c = g3j && g3j.hookSpecificOutput && g3j.hookSpecificOutput.additionalContext;
check('Grok 첫 도구: 이전 기록 전달', typeof g3c === 'string' && g3c.includes('이전 작업 표지') && g3c.includes('STATUS:BEGIN') && g3j.hookSpecificOutput.hookEventName === 'PostToolUse', g3.stdout);
check('Grok 첫 도구: 지시가 앞(10,000자 절단 대비)', typeof g3c === 'string' && g3c.indexOf('STATUS:BEGIN') < g3c.indexOf('이전 작업 표지'), g3c);
check('Grok 파일 경로 기록', logOf(gp).toLowerCase().includes('a.txt') && logOf(gp).includes('(1.5s)'), logOf(gp));
check('Grok 편집 → 트래커 마커', fs.existsSync(sp(gsid).tracker));
const g4 = run('post-tool.mjs', g({ tool_name: 'read_file', tool_input: { target_file: path.join(gp, 'b.txt') } }));
check('Grok 둘째 도구: 중복 전달 없음', g4.stdout === '', g4.stdout);
check('Grok target_file 경로', logOf(gp).toLowerCase().includes('b.txt'), logOf(gp));
const g5 = run('stop.mjs', g({ reason: 'end_turn', stop_hook_active: false, last_assistant_message: `완료\n${STATUS}` }));
check('Grok STATUS 저장', statusOf(gp).includes('작성: grok') && statusOf(gp).includes(`재개: grok --resume ${gsid}`), statusOf(gp));
check('Grok STATUS 있으면 차단 없음', !json(g5.stdout) || json(g5.stdout).decision !== 'block', g5.stdout);

run('prompt-submit.mjs', g({ prompt: '또' }));
run('post-tool.mjs', g({ tool_name: 'write', tool_input: { path: path.join(gp, 'c.txt') } }));
const g6 = run('stop.mjs', g({ reason: 'end_turn', stop_hook_active: false, last_assistant_message: '블록 없음' }));
check('Grok 블록 없음: 1회 차단', json(g6.stdout) && json(g6.stdout).decision === 'block' && json(g6.stdout).reason.includes('STATUS:BEGIN'), g6.stdout);
const g7 = run('stop.mjs', g({ reason: 'end_turn', stop_hook_active: true, last_assistant_message: '또 없음' }));
check('Grok 재진입 차단 없음', g7.stdout === '', g7.stdout);
const before = logOf(gp).length;
run('stop.mjs', g({ reason: 'shutdown', last_assistant_message: 'x' }));
check('Grok 세션 종료 Stop 무시', logOf(gp).length === before, logOf(gp).slice(before));

const gp2 = project('grokq', true);
const gsid2 = '01a0e9d1-bbbb-7531-bfcb-c2bddd3882e5';
run('session-start.mjs', g({ source: 'load' }, gsid2, gp2));
run('prompt-submit.mjs', g({ prompt: '안녕' }, gsid2, gp2));
const g8 = run('stop.mjs', g({ reason: 'end_turn', stop_hook_active: false, last_assistant_message: '안녕하세요' }, gsid2, gp2));
check('Grok 도구 없는 턴: 차단으로 이전 기록 전달', json(g8.stdout) && json(g8.stdout).decision === 'block' && json(g8.stdout).reason.includes('이전 작업 표지'), g8.stdout);
check('Grok 기록 전달 후 대기 삭제', !fs.existsSync(sp(gsid2).ctx));
const g8b = run('stop.mjs', g({ reason: 'end_turn', stop_hook_active: true, last_assistant_message: '[현황] 완료' }, gsid2, gp2));
check('Grok 기록 전달 뒤 재차단 없음', g8b.stdout === '', g8b.stdout);

const gsid3 = '01a0e9d1-cccc-7531-bfcb-c2bddd3882e5';
const nested = { ...baseEnv, CLAUDECODE: '1' };
const g9 = run('session-start.mjs', g({ source: 'new' }, gsid3), [], nested);
run('post-tool.mjs', g({ tool_name: 'write', tool_input: { path: path.join(gp, 'n.txt') } }, gsid3), [], nested);
const g10 = run('stop.mjs', g({ reason: 'end_turn', last_assistant_message: 'x' }, gsid3), [], nested);
check('Claude 안의 Grok: 기록만', g9.stdout === '' && g10.stdout === '' && !fs.existsSync(sp(gsid3).ctx), g10.stdout);

const g11 = run('post-tool.mjs', g({ subagentType: 'explore', tool_name: 'write', tool_input: { path: path.join(gp, 's.txt') } }));
check('Grok 서브에이전트 출력 없음', g11.stdout === '', g11.stdout);

// 새 프로젝트 트래커: Claude 와 같이 블록 요구·병합. 발행(Artifact)은 Claude 전용
const gt = project('grokt');
const gtsid = '01a0e9d1-eeee-7531-bfcb-c2bddd3882e5';
run('prompt-submit.mjs', g({ prompt: '트래커' }, gtsid, gt));
run('post-tool.mjs', g({ tool_name: 'search_replace', tool_input: { path: path.join(gt, 'a.txt') } }, gtsid, gt));
const gt1 = run('stop.mjs', g({ reason: 'end_turn', last_assistant_message: `완료\n${STATUS}` }, gtsid, gt));
check('Grok 새 프로젝트: 트래커 블록 요구', json(gt1.stdout) && json(gt1.stdout).reason.includes('TRACKER:BEGIN') && !json(gt1.stdout).reason.includes('Artifact'), gt1.stdout);
const tb = '<!-- TRACKER:BEGIN -->\n{"project":"p","items":[{"id":"A-1","title":"t","ai":{"status":"ok","note":"n","by":"grok"}}]}\n<!-- TRACKER:END -->';
const gt2 = run('stop.mjs', g({ reason: 'end_turn', stop_hook_active: true, last_assistant_message: `${tb}\n${STATUS}` }, gtsid, gt));
const gtj = json(fs.existsSync(path.join(gt, '.ai-history', 'TRACKER.json')) ? fs.readFileSync(path.join(gt, '.ai-history', 'TRACKER.json'), 'utf-8') : '');
check('Grok 트래커 병합·작성자 grok', gtj && gtj.items && gtj.items[0].ai && gtj.items[0].ai.by === 'grok' && gt2.stdout === '', JSON.stringify(gtj) + gt2.stdout);

// ---- Kimi: config.toml 에 --agent kimi 로 등록. session_ 접두 ID, Stop 에 응답 본문이 없음
const kp = project('kimip', true);
const kid = 'edcc1b09-0887-4eff-869f-39f29ebe4d2c';
const ksid = `session_${kid}`;
const k = (over = {}, sid = ksid, cwd = kp) => ({ hook_event_name: 'X', session_id: sid, session_title: 't', client_type: 'tui', cwd, ...over });
const KA = ['--agent', 'kimi'];
const k1 = run('session-start.mjs', k({ source: 'startup', model: 'k3', profile: 'default' }), KA);
check('Kimi 세션 시작: 출력 없음·대기', k1.stdout === '' && fs.existsSync(sp(kid).ctx), k1.stdout);
const k2 = run('prompt-submit.mjs', k({ prompt: [{ type: 'text', text: '고쳐줘' }], is_steer: false }), KA);
check('Kimi 프롬프트: 평문 출력(이전 기록+지시)', k2.stdout.includes('이전 작업 표지') && k2.stdout.includes('STATUS:BEGIN') && !json(k2.stdout), k2.stdout);
check('Kimi 작업자·ID 접두 제거', logOf(kp).includes(`[${kid.slice(0, 8)}][kimi] [User] 고쳐줘`), logOf(kp));
check('Kimi 대기 비움', !fs.existsSync(sp(kid).ctx));
const k3 = run('prompt-submit.mjs', k({ prompt: '둘째' }), KA);
check('Kimi 둘째 프롬프트: 지시만', k3.stdout.includes('STATUS:BEGIN') && !k3.stdout.includes('이전 작업 표지'), k3.stdout);
run('post-tool.mjs', k({ tool_name: 'Write', tool_input: { path: path.join(kp, 'a.txt'), content: 'x' }, tool_call_id: '1', tool_output: 'ok' }), KA);
check('Kimi path 경로 기록·트래커 마커', logOf(kp).toLowerCase().includes('a.txt') && fs.existsSync(sp(kid).tracker), logOf(kp));

const wireDir = path.join(kimiHome, 'sessions', 'wd_x', ksid, 'agents', 'main');
fs.mkdirSync(wireDir, { recursive: true });
const wire = (text) => fs.writeFileSync(path.join(wireDir, 'wire.jsonl'), [
  { type: 'metadata' },
  { message: { message: { role: 'user', content: [{ type: 'text', text: '요청' }] } }, type: 'agent.message.appended', kind: 'event' },
  { message: { message: { role: 'assistant', content: [{ type: 'think', think: '생각' }, { type: 'text', text }], toolCalls: [] } }, type: 'agent.message.appended', kind: 'event' },
  { type: 'turn.ended', reason: 'completed' },
].map((o) => JSON.stringify(o)).join('\n') + '\n');
wire(`완료\n${STATUS}`);
const k4 = run('stop.mjs', k({ stop_hook_active: false }), KA);
check('Kimi 응답을 세션 파일에서 읽어 STATUS 저장', statusOf(kp).includes('작성: kimi') && statusOf(kp).includes(`재개: kimi -S ${ksid}`) && k4.stdout === '', statusOf(kp) + k4.stdout);
check('Kimi 세션 사본 이름', fs.existsSync(path.join(kp, '.ai-history', 'sessions', `kimi-${kid.slice(0, 8)}.md`)));

run('prompt-submit.mjs', k({ prompt: '셋째' }), KA);
run('post-tool.mjs', k({ tool_name: 'Edit', tool_input: { path: path.join(kp, 'b.txt') } }), KA);
wire('블록 없는 답변');
const k5 = run('stop.mjs', k({ stop_hook_active: false }), KA);
const k5j = json(k5.stdout);
check('Kimi 블록 없음: deny 형식 차단', k5j && k5j.hookSpecificOutput && k5j.hookSpecificOutput.permissionDecision === 'deny' && k5j.hookSpecificOutput.permissionDecisionReason.includes('STATUS:BEGIN'), k5.stdout);
const k5b = run('stop.mjs', k({ stop_hook_active: false }), KA);
check('Kimi 같은 턴 재차단 없음', k5b.stdout === '', k5b.stdout);
check('Kimi 턴 끝 요약', logOf(kp).includes('[Turn-end] 블록 없는 답변'), logOf(kp));
run('session-end.mjs', k({ reason: 'exit' }), KA);
check('Kimi 종료 기록', logOf(kp).includes(`재개: kimi -S ${ksid}`) && logOf(kp).includes('[exit]'), logOf(kp));
const kn = run('prompt-submit.mjs', k({ prompt: '중첩' }, 'session_nested00-0000'), KA, { ...baseEnv, CLAUDECODE: '1' });
check('Claude 안의 Kimi: 기록만', kn.stdout === '', kn.stdout);

// ---- Cursor: 프롬프트 단계 주입 불가 → postToolUse, 차단은 followup_message + loop_count 가드
const cp = project('cursorp', true);
const cp2 = project('cursorq', true);
const uri = (p) => `/${p.replace(/\\/g, '/').replace(/^([A-Z]):/, (m, c) => `${c.toLowerCase()}:`)}`;
const csid = 'f30e6b94-aaaa-4000-8000-00000000000a';
const c = (over = {}) => ({ session_id: csid, conversation_id: csid, cursor_version: '3.20.21', workspace_roots: [uri(cp)], transcript_path: null, ...over });
const c0 = run('prompt-submit.mjs', c({ hook_event_name: 'beforeSubmitPrompt', prompt: 'cursorq 프로젝트 고쳐줘' }));
check('Cursor 프롬프트 출력 없음', c0.stdout === '', c0.stdout);
const c1 = run('post-tool.mjs', c({ hook_event_name: 'postToolUse', tool_name: 'StrReplace', tool_input: { path: path.join(cp2, 'a.txt') }, duration: 10 }));
const c1j = json(c1.stdout);
check('Cursor 첫 도구: additional_context 로 언급 프로젝트 기록', c1j && typeof c1j.additional_context === 'string' && c1j.additional_context.includes('이전 작업 표지') && !c1j.additional_context.includes('ArtifactData'), c1.stdout);
check('Cursor StrReplace 경로·마커', logOf(cp2).toLowerCase().includes('a.txt') && fs.existsSync(sp(csid).tracker), logOf(cp2));
run('post-tool.mjs', c({ hook_event_name: 'postToolUse', tool_name: 'Shell', tool_input: { command: 'dir' } }));
const transcript = path.join(box, 'c.jsonl');
fs.writeFileSync(transcript, `${JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: '블록 없음' }] } })}\n`);
const cStop = () => run('stop.mjs', c({ hook_event_name: 'stop', status: 'completed', transcript_path: transcript }));
const c3 = cStop();
const c3j = json(c3.stdout);
check('Cursor 블록 없음: 후속 메시지(두 형식 동일 내용)', c3j && typeof c3j.followup_message === 'string' && c3j.followup_message.startsWith('[auto-history]') && c3j.decision === 'block' && c3j.reason === c3j.followup_message, c3.stdout);
const lenBefore = logOf(cp2).length;
const c4 = run('prompt-submit.mjs', c({ prompt: c3j ? c3j.followup_message : '[auto-history] x' }));
check('Cursor 자동 후속 메시지는 요청으로 기록 안 함', c4.stdout === '' && !logOf(cp2).slice(lenBefore).includes('[User]'), logOf(cp2).slice(lenBefore));
const c5 = cStop();
check('Cursor 후속 메시지 다음 Stop 은 요구 없음', c5.stdout === '', c5.stdout);
run('prompt-submit.mjs', c({ prompt: '둘째' }));
run('post-tool.mjs', c({ tool_name: 'Write', tool_input: { path: path.join(cp2, 'b.txt') } }));
const c6 = cStop();
check('Cursor 새 요청에서는 다시 1회', json(c6.stdout) && json(c6.stdout).followup_message, c6.stdout);
// 후속 메시지를 요청으로 판별 못 해 상태가 초기화돼도 반복이 끊겨야 한다
run('prompt-submit.mjs', c({ prompt: '감싸인 [auto-history] 후속' }));
run('post-tool.mjs', c({ tool_name: 'Write', tool_input: { path: path.join(cp2, 'c.txt') } }));
check('Cursor 판별 실패해도 연속 후속 없음', cStop().stdout === '');
const bsid = 'f30e6b94-aaaa-4000-8000-00000000000b';
const bg = (over = {}) => c({ session_id: bsid, conversation_id: bsid, ...over });
run('session-start.mjs', bg({ hook_event_name: 'sessionStart', is_background_agent: true }));
run('post-tool.mjs', bg({ tool_name: 'Write', tool_input: { path: path.join(cp, 'bg.txt') } }));
const bgs = run('stop.mjs', bg({ status: 'completed', transcript_path: transcript }));
check('Cursor 백그라운드: 후속 메시지 없음', bgs.stdout === '', bgs.stdout);
const nsid = 'f30e6b94-aaaa-4000-8000-00000000000c';
fs.writeFileSync(path.join(conf, 'NO_BLOCK'), '');
const nb = (over = {}) => c({ session_id: nsid, conversation_id: nsid, ...over });
run('prompt-submit.mjs', nb({ prompt: '금지' }));
run('post-tool.mjs', nb({ tool_name: 'Write', tool_input: { path: path.join(cp, 'nb.txt') } }));
const nbs = run('stop.mjs', nb({ status: 'completed', transcript_path: transcript }));
fs.rmSync(path.join(conf, 'NO_BLOCK'));
check('Cursor NO_BLOCK 존중', nbs.stdout === '', nbs.stdout);

// ---- 리뷰 지적 재발 방지
const kl = project('kimil', true);
const klid = 'aaaa1b09-0887-4eff-869f-39f29ebe4d2c';
const klS = `session_${klid}`;
const kk = (over = {}) => k(over, klS, kl);
const lDir = path.join(kimiHome, 'sessions', 'wd_x', klS, 'agents', 'main');
fs.mkdirSync(lDir, { recursive: true });
const lWire = (msgs) => fs.writeFileSync(path.join(lDir, 'wire.jsonl'), msgs.map((m) => JSON.stringify({ message: { message: m }, type: 'agent.message.appended' })).join('\n') + '\n');
const asst = (text, toolCalls = []) => ({ role: 'assistant', content: [{ type: 'text', text }], toolCalls });
run('prompt-submit.mjs', kk({ prompt: '첫째' }), KA);
run('post-tool.mjs', kk({ tool_name: 'Edit', tool_input: { path: path.join(kl, 'a.txt') } }), KA);
lWire([{ role: 'user', content: [] }, asst('호출 중', [{ id: '1' }])]);
const ksub = run('stop.mjs', kk({}), KA);
check('Kimi 최종 응답 못 읽으면 차단 안 함(서브에이전트·기록 지연)', ksub.stdout === '', ksub.stdout);
check('Kimi 못 읽어도 도구 마커 유지', fs.existsSync(sp(klid).tool));
lWire([{ role: 'user', content: [] }, asst('블록 없음')]);
const kb = run('stop.mjs', kk({}), KA);
check('Kimi 차단', json(kb.stdout) && json(kb.stdout).hookSpecificOutput.permissionDecision === 'deny', kb.stdout);
lWire([{ role: 'user', content: [] }, asst('블록 없음'), { role: 'user', content: [] }, asst(`교정\n${STATUS}`), { role: 'user', content: [{ type: 'text', text: '다음 요청' }] }]);
run('prompt-submit.mjs', kk({ prompt: '다음 요청' }), KA);
check('Kimi 교정 응답을 다음 프롬프트에서 저장', statusOf(kl).includes('작성: kimi') && statusOf(kl).includes('- b'), statusOf(kl));
check('Kimi 처리 뒤 표지 삭제', !JSON.parse(fs.readFileSync(sp(klid).json, 'utf-8')).kimiCaptureDue);
const ke = project('kimie', true);
const keid = 'bbbb1b09-0887-4eff-869f-39f29ebe4d2c';
const keS = `session_${keid}`;
const eDir = path.join(kimiHome, 'sessions', 'wd_x', keS, 'agents', 'main');
fs.mkdirSync(eDir, { recursive: true });
run('prompt-submit.mjs', k({ prompt: '첫째' }, keS, ke), KA);
run('post-tool.mjs', k({ tool_name: 'Edit', tool_input: { path: path.join(ke, 'a.txt') } }, keS, ke), KA);
fs.writeFileSync(path.join(eDir, 'wire.jsonl'), `${JSON.stringify({ message: { message: asst('없음') }, type: 'agent.message.appended' })}\n`);
run('stop.mjs', k({}, keS, ke), KA);
fs.writeFileSync(path.join(eDir, 'wire.jsonl'), `${JSON.stringify({ message: { message: asst(`교정\n${STATUS}`) }, type: 'agent.message.appended' })}\n`);
run('session-end.mjs', k({ reason: 'exit' }, keS, ke), KA);
check('Kimi 교정 응답을 세션 종료에서 저장', statusOf(ke).includes('작성: kimi') && statusOf(ke).includes(`재개: kimi -S ${keS}`), statusOf(ke));

const gc = project('grokc', true);
const gcid = '01a0e9d1-ffff-7531-bfcb-c2bddd3882e5';
run('prompt-submit.mjs', g({ prompt: '길게' }, gcid, gc));
run('post-tool.mjs', g({ tool_name: 'write', tool_input: { path: path.join(gc, 'a.txt') } }, gcid, gc));
const clip = `${'가'.repeat(100)}… [+900 chars]`;
const gc1 = run('stop.mjs', g({ reason: 'end_turn', last_assistant_message: clip }, gcid, gc));
check('Grok 잘린 응답·원본 없음: 차단 안 함', gc1.stdout === '', gc1.stdout);
run('prompt-submit.mjs', g({ prompt: '길게2' }, gcid, gc));
run('post-tool.mjs', g({ tool_name: 'write', tool_input: { path: path.join(gc, 'b.txt') } }, gcid, gc));
const gct = path.join(box, 'g.jsonl');
fs.writeFileSync(gct, `${JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: `전체\n${STATUS}` }] })}\n`);
const gc2 = run('stop.mjs', g({ reason: 'end_turn', last_assistant_message: clip, transcript_path: gct }, gcid, gc));
check('Grok 잘린 응답: 원본에서 STATUS 저장', statusOf(gc).includes('작성: grok') && gc2.stdout === '', statusOf(gc) + gc2.stdout);

const mono = path.join(root, 'mono');
const pkg = path.join(mono, 'pkg');
fs.mkdirSync(path.join(pkg, '.ai-history'), { recursive: true });
const gmid = '01a0e9d1-1111-7531-bfcb-c2bddd3882e5';
run('session-start.mjs', g({ source: 'new' }, gmid, pkg), [], { ...baseEnv, CLAUDE_PROJECT_DIR: mono });
run('session-start.mjs', g({ source: 'load' }, gmid, pkg), [], { ...baseEnv, CLAUDE_PROJECT_DIR: mono });
check('Grok 재개: 저장소 루트로 안 바뀜', JSON.parse(fs.readFileSync(sp(gmid).json, 'utf-8')).anchor.endsWith('\\pkg'), fs.readFileSync(sp(gmid).json, 'utf-8'));

const ka = project('kimia', true);
const kb2 = project('kimib', true);
fs.writeFileSync(path.join(ka, '.ai-history', 'STATUS.md'), '# STATUS\n세션: a\n\n## 하던 일\n- 폴더A 표지\n');
fs.writeFileSync(path.join(kb2, '.ai-history', 'STATUS.md'), '# STATUS\n세션: b\n\n## 하던 일\n- 폴더B 표지\n');
const kaid = 'session_cccc1b09-0887-4eff-869f-39f29ebe4d2c';
run('session-start.mjs', k({ source: 'startup' }, kaid, ka), KA);
const kmix = run('prompt-submit.mjs', k({ prompt: 'kimib 프로젝트 고쳐줘' }, kaid, ka), KA);
check('언급으로 앵커 변경: 새 폴더 기록만', kmix.stdout.includes('폴더B 표지') && !kmix.stdout.includes('폴더A 표지'), kmix.stdout);

check('/c/ 절대 경로 트래커 판정(회귀)', C.isTrackerChangeTool({ tool_name: 'Write', cwd: 'C:\\Users\\me', tool_input: { file_path: '/c/Users/me/Desktop/Project/x/a.ts' } }, 'c:\\users\\me\\desktop\\project\\x', baseEnv));
check('상대 경로 트래커 판정', C.isTrackerChangeTool({ tool_name: 'Write', cwd: 'C:\\Users\\me\\Desktop\\Project\\x', tool_input: { path: 'src/a.ts' } }, 'c:\\users\\me\\desktop\\project\\x', baseEnv));

// ---- 순수 함수·회귀
check('재개 명령', C.resumeCommand('abc', 'grok') === 'grok --resume abc' && C.resumeCommand('session_abc', 'kimi') === 'kimi -S session_abc' && C.resumeCommand('abc', 'cursor') === '' && C.resumeCommand('abc', 'codex') === 'codex resume abc' && C.resumeCommand('abc', 'claude') === 'claude --resume abc');
check('설정 이름', C.agentConfName('NO_BLOCK', 'claude') === 'NO_BLOCK' && C.agentConfName('NO_BLOCK', 'codex') === 'NO_BLOCK_CODEX' && C.agentConfName('NO_BLOCK', 'grok') === 'NO_BLOCK_GROK' && C.agentConfName('NO_BLOCK', 'kimi') === 'NO_BLOCK_KIMI');
const dp = project('dumpp');
fs.writeFileSync(path.join(conf, 'DUMP_INPUTS_GROK'), '');
run('prompt-submit.mjs', g({ prompt: '덤프' }, '01a0e9d1-dddd-7531-bfcb-c2bddd3882e5', dp));
check('Grok 입력 덤프', fs.existsSync(path.join(conf, 'dumps')) && fs.readdirSync(path.join(conf, 'dumps')).some((f) => f.startsWith('grok-UserPromptSubmit')));
fs.rmSync(path.join(conf, 'DUMP_INPUTS_GROK'));
const clp = project('claudep');
const cl = run('pre-tool.mjs', { session_id: 'c1aude00-1', cwd: clp, tool_name: 'Bash', tool_input: { command: 'ls' } });
check('Claude 라벨 유지', cl.status === 0 && logOf(clp).includes('[c1aude00][claude] ▶ [Bash] ls'), logOf(clp));
const cxp = project('codexp');
const cx = run('prompt-submit.mjs', { session_id: 'c0dex000-1', cwd: cxp, prompt: 'hi' }, ['--agent', 'codex']);
const cxj = json(cx.stdout);
check('Codex 주입 형식 유지', cxj && cxj.hookSpecificOutput && cxj.hookSpecificOutput.hookEventName === 'UserPromptSubmit' && logOf(cxp).includes('[codex] [User] hi'), cx.stdout);
const ctr = path.join(cp, 'TRACKER.json');
check('트래커 작성자 허용 목록', ['grok', 'kimi', 'cursor', 'claude', 'codex'].every((a) => C.AI_BY.includes(a)), ctr);

// ---- 설치기
const inst = (args) => spawnSync(process.execPath, [path.join(HOOK, 'install.mjs'), ...args], { env: baseEnv, encoding: 'utf8' });
const toml = path.join(box, 'config.toml');
const original = 'default_model = "k"\n\n[providers."m"]\ntype = "kimi"\napi_key = "placeholder"\n\n[[hooks]]\nevent = "Stop"\ncommand = "echo other"\n';
fs.writeFileSync(toml, original);
const i1 = json(inst(['--kimi-hooks', '--kimi-file', toml]).stdout);
const t1 = fs.readFileSync(toml, 'utf-8');
check('Kimi 설치: 6개 추가·기존 유지', i1 && i1.oursCount === 6 && t1.startsWith(original) && (t1.match(/\[\[hooks\]\]/g) || []).length === 7 && t1.includes('--agent kimi'), t1);
check('Kimi 설치: 허용 필드만', !/matcher\s*=/.test(t1.slice(original.length)) && /timeout = \d+/.test(t1), t1);
inst(['--kimi-hooks', '--kimi-file', toml]);
check('Kimi 재설치: 중복 없음', (fs.readFileSync(toml, 'utf-8').match(/\[\[hooks\]\]/g) || []).length === 7);
const rewritten = `${original}\n[[hooks]]\nevent = "Stop"\ncommand = "node \\"C:/Users/x/ai-history/stop.mjs\\" --agent kimi"\ntimeout = 5\n`;
fs.writeFileSync(toml, rewritten);
inst(['--kimi-hooks-remove', '--kimi-file', toml]);
check('Kimi 제거: Kimi 가 다시 쓴 꼴도 제거·기존 유지', fs.readFileSync(toml, 'utf-8').trim() === original.trim(), fs.readFileSync(toml, 'utf-8'));
check('Kimi 설치 전 백업', fs.readdirSync(box).some((f) => f.startsWith('config.toml.bak.ai-history.')));
const baks = () => fs.readdirSync(box).filter((f) => f.startsWith('config.toml.bak.ai-history.')).length;
inst(['--kimi-hooks', '--kimi-file', toml]);
const bakN = baks();
const same = json(inst(['--kimi-hooks', '--kimi-file', toml]).stdout);
check('Kimi 변경 없으면 다시 쓰지 않음', same && same.unchanged === true && baks() === bakN, JSON.stringify(same));
inst(['--kimi-hooks-remove', '--kimi-file', toml]);
for (const bad of ['hooks = []\n', '[hooks]\nx = 1\n']) {
  fs.writeFileSync(toml, bad);
  inst(['--kimi-hooks', '--kimi-file', toml]);
  check(`Kimi 다른 hooks 정의면 중단: ${bad.split('\n')[0]}`, fs.readFileSync(toml, 'utf-8') === bad, fs.readFileSync(toml, 'utf-8'));
}
const withComment = `default_model = "k"\n\n[[hooks]]\nevent = "Stop"\ncommand = 'node "C:/x/ai-history/stop.mjs" --agent kimi'\ntimeout = 5\n# 내 주석\n\nnote = 1\n`;
fs.writeFileSync(toml, `a = """\n[[hooks]]\n/ai-history/\n"""\n${withComment.replace('note = 1\n', '')}`);
inst(['--kimi-hooks-remove', '--kimi-file', toml]);
const kept = fs.readFileSync(toml, 'utf-8');
check('Kimi 제거: 주석·여러 줄 문자열 보존', kept.includes('# 내 주석') && kept.includes('a = """\n[[hooks]]\n/ai-history/\n"""') && !kept.includes('stop.mjs'), kept);
const gf = path.join(box, 'grokhooks', 'auto-history.json');
inst(['--grok-hooks', '--grok-file', gf]);
const gj = json(fs.existsSync(gf) ? fs.readFileSync(gf, 'utf-8') : '');
const gh = gj && gj.hooks && gj.hooks.SessionStart && gj.hooks.SessionStart[0];
check('Grok 설치: SessionStart new|load 만, 인자 없음', gh && gh.matcher === 'new|load' && Object.keys(gj.hooks).length === 1 && /session-start\.mjs"$/.test(gh.hooks[0].command), JSON.stringify(gj));
inst(['--grok-hooks-remove', '--grok-file', gf]);
check('Grok 제거', !fs.existsSync(gf));

fs.rmSync(box, { recursive: true, force: true });
console.log(`agent tests pass=${pass} fail=${fail}`);
process.exitCode = fail ? 1 : 0;
