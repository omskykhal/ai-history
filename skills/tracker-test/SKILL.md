---
name: tracker-test
description: 트래커 미확인·문제 항목을 검증 에이전트(tracker-verifier)로 1라운드 검증한다. "/tracker-test", "트래커 검사해줘", "트래커 테스트", "tracker test", "run tracker test" 요청 시 사용. "트래커 검사 처음부터" 는 라운드를 0 으로 강제 초기화한다. 검증만 하고 수리는 하지 않는다.
---
# tracker-test — 트래커 검증 루프(1턴 = 1라운드)

**실행 모드:** 서브 에이전트, **전경 병렬**(한 메시지에 Agent 호출 여러 개). **run_in_background 금지.**
**1턴 = 1라운드.** 이 스킬 1회 = 라운드 1개. 라운드 결과는 이 턴의 마지막 응답 끝 **누적 TRACKER 블록 1개**로만 낸다(중간 블록 금지).
**시작:** 사용자 명령으로만 시작한다. 자동 시작 금지.

## 준비
- 앵커 = 이 프로젝트의 auto-history 앵커 폴더. `TRACKER.json` = `<앵커>/.ai-history/TRACKER.json`.
- 트래커 도구 = 훅이 프롬프트 지시문에 넣는 `트래커 도구: node "<HOOK_DIR>/tracker-md.mjs"` 줄(영어 모드는 `Tracker tool: …`)의 절대경로를 그대로 쓴다(플러그인 설치에서도 같은 줄을 쓴다). 그 줄이 없으면 실행하지 말고 「트래커 도구 경로 없음」 으로 보고 후 종료.

## 판정 보호 규칙(UI 라벨·http `-` 공통)
- 블록에 `"status":"-"` 를 넣을 수 있는 항목 = `ai.by` 가 없거나 `claude` 이고 `ai.status` 가 `-` 인 **미판정 항목에만**(targets 출력의 `uiLabelEligible` 과 같은 조건: ai.by 없음/claude ∧ ai.status `-`).
- `ai.status` 가 `fail`(또는 `ok`)이거나 `ai.by` 가 `codex` 인 항목에 `-` 결과(UI 라벨·「네트워크 오류」·「확인 불가」·「권한 없음」·「명령 불일치」)가 나오면 **블록에서 제외하고 보고서에만 적는다**(다른 주체·기존 판정 보존).
- `ok`·`fail` 결과는 직접 검증한 결과이므로 그대로 블록에 넣는다.

## 절차
1. `TRACKER.json` 확인. 없거나 mode off → 보고 후 종료.
2. 대상 목록: `node "<HOOK_DIR>/tracker-md.mjs" targets "<TRACKER.json>"` 출력**만** 사용한다(직접 판단 금지). 대상식 = `user.status != 'ok'` 이고 `ai.status != 'ok'` 인 항목. 출력 각 항목은 `{id, kind:'http'|'ui', urls:[], uiLabelEligible}`. 이번 대상 id 집합 = 출력 id 들.
3. 직전 실행 기록 `<앵커>/.ai-history/tracker/reports/last-run.json` 을 읽는다. 형식:
   `{round, roundIds, targetsHash, noChangeCount, updatedAt, endReason, results:{<id>:{status,note}}, agents, agentsTotal}`
   - `roundIds` = 1라운드 시작 시점의 대상 id 배열(정렬). `targetsHash` = `roundIds` 를 `,` 로 이은 문자열의 sha1 앞 12자(기록용, 1라운드에서만 계산하고 이어진 라운드에서는 다시 계산하지 않는다).
   - **이어서 라운드 +1** 하는 경우(모두 참): 파일 있음 ∧ 직전 `endReason` 이 `다음라운드대기` ∧ 이번 대상 id 집합이 `roundIds` 의 **부분집합**(ok 가 생겨 줄어든 것은 이어감) ∧ 사용자가 "트래커 검사 처음부터" 라고 하지 않음.
   - **라운드 0 으로 초기화**(그 외 전부): 파일 없음 / 직전 `endReason` 이 `대상0`·`변화없음`·`상한` 중 하나 / 이번 대상에 `roundIds` 에 없는 id 가 있음(새 항목 등장) / 사용자가 "트래커 검사 처음부터" 라고 함. 초기화하면 이번이 1라운드: `roundIds`·`targetsHash` 를 이번 대상으로 새로 정하고 `noChangeCount=0`, `agentsTotal=0` 에서 시작.
   - 이어진 라운드(2 이상)의 대상은 이번 대상 중 직전 실행에서 `-` + "네트워크 오류" 였던 http 항목만.
4. kind=ui: 에이전트 없이 `"ai":{"status":"-","note":"AI 검증 불가(UI)·사용자 육안","by":"claude"}` 를 넣는다. **`uiLabelEligible` 이 true 인 항목에만** 넣는다(위 판정 보호 규칙). 이미 같은 note 면 블록에서 뺀다(변경 없음).
5. kind=http: 항목당 tracker-verifier 1개를 **한 메시지에서 동시에(전경)** 호출한다(최대 8개, 넘으면 다음 메시지에서 이어 호출, 같은 턴). run_in_background 금지.
   - live-check 명령 = 앵커 git 루트 `.harness.json` 의 `live_check` 문자열 **그대로**(1글자도 바꾸지 않음, 필요 시 뒤에 ` --grep <문자열>` 만).
   - 항목 URL 이 live_check 안의 URL 과 다르면: live_check 값에서 마지막 `http(s)://` 토큰만 떼고 항목 URL 을 붙인다(같은 절대경로·슬래시). 이 명령은 dev-harness G-5 증거로 기록되지 않으므로 보고에 「G-5 비대상 URL」 이라 적는다.
   - `.harness.json` 이 없거나 `live_check` 가 빈 값이면 에이전트를 띄우지 않고 그 http 항목을 `-` + 「HTTP 확인 수단 없음(.harness.json live_check 없음)」 으로 둔다(판정 보호 규칙 적용).
   - 에이전트 입력: id, 항목 필드, urls[], live-check 명령 문자열, 보고 파일 경로. 반환: JSON 1줄 `{id,status,note}`.
   - 사후 점검: ① 보고 파일의 실행 명령 줄이 넘긴 live-check 문자열로 시작하는지 ② 보고 파일 외에 새 파일이 생기지 않았는지(`git status`·폴더 목록으로 확인). 어긋나면 그 판정을 `-` + "명령 불일치" 로 바꾸고(판정 보호 규칙 적용) 보고에 적는다.

## 보고 경로
- 항목별 보고 파일: `<앵커>/.omc/research/<YYYY-MM-DD>-tracker-test-<id>.md`.
- 그 경로가 `git check-ignore` 로 무시되지 않으면 대신 `<앵커>/.ai-history/tracker/reports/<YYYY-MM-DD>-tracker-test-<id>.md`(`tracker/.gitignore` 로 무시됨).
- 실행 기록: `<앵커>/.ai-history/tracker/reports/last-run.json`.

## 종료 조건
- `대상0`: 이번 라운드 대상이 0 (1라운드에서 0 이면 즉시 종료 보고).
- `변화없음`: 직전 라운드와 id별 판정이 같으면 `noChangeCount` +1, 다르면 0 으로. `noChangeCount` 가 2 가 되면 종료.
- `상한`: 3라운드를 마치는 시점에 `endReason=상한` 을 **바로 기록**한다(다음 실행에서 곧장 라운드 0 으로 초기화되도록).
- 위에 해당하지 않으면 `다음라운드대기`.
- 변화 없음과 상한이 같은 시점일 수 있다 — 기록은 `상한`, 보고에 두 사유를 구분해 적는다.

## 기록과 출력
6. 모든 결과를 모아 `last-run.json` 을 **Write 도구로** 기록한다:
   `round`·`roundIds`·`targetsHash`·`noChangeCount`·`updatedAt`(ISO)·`endReason`(`대상0`|`변화없음`|`상한`|`다음라운드대기`)·`results`(id별 판정, 블록에서 제외한 것 포함)·`agents`(이번 에이전트 수)·`agentsTotal`(누적).
   그리고 응답 끝에 TRACKER 블록 1개(`items[].ai`, `"by":"claude"`, **직접 검증하지 않은 항목과 판정 보호 규칙으로 제외한 항목은 넣지 않음**)를 STATUS 블록 앞에 출력한다. 형식:
   ```
   <!-- TRACKER:BEGIN -->
   {"items":[{"id":"<id>","ai":{"status":"ok|fail|-","note":"근거 (보고: <경로>)","by":"claude"}}]}
   <!-- TRACKER:END -->
   ```
7. 훅이 발행을 요구하면(같은 턴 Stop 차단) 그 절차대로 **같은 url** 로 발행하고 `{"url":…}` 블록을 낸다.
8. 종료 보고(한국어):
   - `ok N·fail N·검증 불가 N`, 라운드 번호, 종료 사유(대상 0 / 변화 없음 / 상한 / 다음 라운드 대기), 이번 에이전트 수·누적 수, 보고 파일 목록, 실행한 live-check 명령 전수(「G-5 비대상 URL」 표시 포함), 판정 보호 규칙으로 블록에서 제외한 항목, "사용자 미확인".
   - 다음 라운드가 필요하면 "`/tracker-test` 를 다시 입력하면 다음 라운드" 한 줄.

## 금지
- 수리(소스·설정·데이터 수정), 로컬 서버·브라우저·에뮬레이터, curl·wget, 자동 시작.
- Bash 로 파일 쓰기(`cat >`·`>>`·`tee`·`Set-Content`·`New-Item` 은 훅 변경 감지에 걸린다). 파일은 Write 도구로만.
- run_in_background, 라운드 중간 TRACKER 블록, 한 턴에 2라운드 이상.
