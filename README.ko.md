# ai-history

**Claude Code 와 OpenAI Codex 가 프로젝트마다 하나의 작업 히스토리를 자동으로 함께 쓰는 훅.**

[English README](README.md)

작업 중에 노트북을 닫아도, 다음 날 아무 폴더에서나 Claude Code 나 Codex 를 열고 프로젝트 이름만 말하면 에이전트가 `[현황]` 보고로 시작합니다. 무엇을 하던 중이었는지, 어디까지 했는지, 다음에 뭘 할지, 그리고 **마지막으로 누가(claude/codex) 작업했는지**까지.

- 도구 호출마다 `<프로젝트>/.ai-history/YYYY-MM-DD.md` 에 한 줄: `- HH:mm:ss [세션][claude|codex] ▶ [Bash] npm test`
- 응답 끝에 에이전트가 짧은 상태 블록을 쓰면 훅이 `<프로젝트>/.ai-history/STATUS.md` 로 저장(하던 일 / 한 일 / 다음 할 일 / 진행도)
- 세션 시작 때, 그리고 프로젝트 이름을 말할 때마다 `STATUS.md` 와 오늘·어제 로그 꼬리를 자동 주입
- Claude Code 와 Codex 가 **같은 파일**을 읽고 쓰므로 둘을 오가도 타임라인은 하나
- LLM 호출 없음, DB 없음, 클라우드 없음. 프로젝트 폴더 안의 마크다운뿐이고, 쓰는 건 작은 Node 스크립트

## 요구 사항

| 항목 | 요구 |
|---|---|
| Node.js | 18 이상 (`node --version`) |
| Claude Code | 훅 지원(`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`) |
| OpenAI Codex CLI | 0.160 이상, `hooks` 사용 가능(`codex features list` → `hooks stable true`), 선택 |
| OS | **Windows**(검증됨). macOS/Linux: 경로 처리는 구현돼 있으나 **미검증** |

## 설치

**Claude Code 플러그인(한 줄, Claude Code 2.1.275 이상)** — Claude 쪽만 설치되고, 플러그인 모드는 실험 단계(아래 참고):

```
/plugin install ai-history --marketplace omskykhal/ai-history
```

**설치 스크립트(권장, Claude Code 와 Codex 모두)**

먼저 파일을 한 번 받습니다. 이 저장소를 clone 하거나 GitHub Releases 에서 압축본을 내려받아 풀고, 그 폴더에서 터미널을 엽니다. 아래 명령은 전부 이미 받아 둔 파일로만 동작하며 설치 중에 새로 내려받는 것은 없습니다.

```bash
# 1) 프로젝트들이 모여 있는 상위 폴더 지정 + 주입 문구 언어 선택
node install.mjs --install --root "C:\Users\me\Desktop\Project" --lang ko
# 2) 선택: Codex 에도 같은 훅 등록(첫 Codex 실행 때 핸들러 5개 신뢰 승인 프롬프트가 뜸)
node install.mjs --codex-hooks
# 3) 선택: git 전역 제외 파일에 .ai-history/ 추가(모든 저장소에서 git status 에 안 잡힘)
node install.mjs --git-ignore
# 확인
node install.mjs --status
```

설치기가 손대는 것:

- `~/.claude/settings.json` → `hooks` 아래 5개 항목 추가(먼저 `settings.json.bak.ai-history.<시각>` 백업, hooks 외 키가 하나라도 달라지면 백업 복원)
- `~/.codex/hooks.json` → 병합, 다른 핸들러는 보존(백업 생성). `config.toml` 은 건드리지 않음
- 스크립트 옆 `ROOT`, `LANG` 파일
- git 전역 제외 파일(`core.excludesFile` 설정돼 있으면 그 파일, 아니면 `~/.config/git/ignore`) → `.ai-history/` 한 줄

제거:

```bash
node install.mjs --uninstall           # Claude Code 항목만
node install.mjs --codex-hooks-remove  # Codex 항목만
```

각 프로젝트의 `.ai-history/` 폴더는 남습니다. 필요 없으면 직접 삭제하세요.

## 동작 방식

### 기록 위치(앵커)

`--root` 로 지정한 루트 **안쪽** 폴더에만 `.ai-history/` 가 생깁니다. 홈 폴더·임시 폴더에는 아무것도 쓰지 않습니다. 세션마다 앵커는 이 순서로 정해집니다.

1. 요청문에 나온 프로젝트: `ALIASES` 의 별칭, 또는 `<폴더이름> 프로젝트` / `프로젝트 <폴더이름>` (`폴더` 도 가능, 깊이 1 폴더만). 영어 `project`/`folder` 도 같은 규칙. 루트 기준 깊이 1·2 폴더만 대상.
2. 작업 폴더가 직전 요청 때와 실제로 달라졌고 루트 안이면 그 폴더(현재 앵커의 하위면 앵커 유지).
3. 이 세션에 이미 기록된 앵커.
4. 앵커가 없고 작업 폴더가 루트 안이면 채택.

그래서 평소엔 **아무 데서나** 터미널을 열고 `claude` 나 `codex` 를 띄운 뒤 "MyApp 프로젝트 최근에 뭐 했어? 이어서 해줘"라고 말하면 됩니다. 훅이 `MyApp` 을 찾아 기록을 주입하고, 다른 프로젝트를 말하기 전까지 거기에 계속 씁니다.

### STATUS 블록

도구를 1건 이상 쓴 응답 끝에 에이전트는 아래 블록을 출력하도록 지시받습니다.

```
<!-- STATUS:BEGIN -->
## 하던 일
- ...
## 한 일
- ...
## 다음 할 일
- ...
## 진행도
- ...
<!-- STATUS:END -->
```

`Stop` 훅이 이걸 뽑아 머리말(`세션`, `작성: <agent> (<id>)`, `갱신`, `앵커`, `재개: claude --resume <id>` 또는 `재개: codex resume <id>`)과 함께 `STATUS.md` 로 씁니다. 세션이 끝나면(`/exit`·`/clear`·로그아웃) `SessionEnd` 훅이 로그에 `[exit] 종료(reason=prompt_input_exit) 재개: claude --resume <id>` 를 남기고, 이 세션의 `STATUS.md`·`sessions/` 사본에 `재개` 줄이 없으면 보강해 세션을 이어갈 명령이 히스토리에 남습니다. 블록이 없으면 **한 번만** 다시 요구(`decision: block`)하고, 컨텍스트 한도·사용자 중단·인증 오류·예약 깨우기·컨텍스트 95% 이상일 땐 요구하지 않습니다. 설정 폴더에 `NO_BLOCK`(Claude) / `NO_BLOCK_CODEX`(Codex) 파일을 두거나 `AUTO_HISTORY_NO_BLOCK=1` 로 끌 수 있습니다.

### 무엇이 기록되나

| 줄 | 내용 |
|---|---|
| `[User] …` | 요청문 앞 120자 |
| `▶ [도구] …` / `✓ [도구] … (1.2s)` | 도구 이름과 짧은 대상(명령·파일 경로·패턴·에이전트 설명). **도구 출력은 기록하지 않음** |
| `[Turn-end] …` | 응답 앞 300자, 또는 `STATUS 갱신` |
| `[anchor] 지정/변경 …` | 앵커 변화 |
| `[exit] 종료(reason=…) 재개: …` | 세션 종료와 그 세션을 재개하는 명령 |
| `[retention] 압축 N·gz 삭제 N·세션 사본 삭제 N` | 보존 정리가 실제로 옮기거나 지운 것이 있을 때만 기록 |

API 키처럼 보이는 문자열(`AIza…`, `sk-…`, `ghp_…`, `Bearer …`, `password=…`)은 쓰기 전에 마스킹합니다.

### 같은 폴더에 세션이 여럿일 때

`STATUS.md` 는 항상 마지막에 끝난 세션의 블록입니다. 그와 별도로 세션마다 자기 블록을 `.ai-history/sessions/<agent>-<id8>.md` 에 남깁니다. 세션 시작(또는 요청문에 프로젝트 언급) 때 Reader 는 `STATUS.md` 에 더해 48시간 안에 갱신된 다른 세션 사본(최신 2개, 각 1,000자)을 함께 주입합니다. 재개한 세션 자신의 사본에는 `(이 세션)` 표시가 붙어, 다른 세션이 `STATUS.md` 를 덮어썼어도 자기 상태를 되찾습니다. 7일 지난 세션 사본은 보존 정리 때 삭제됩니다.

### 로그 보존

일자별 로그 `YYYY-MM-DD.md` 는 30일 동안 원본으로 두고, 그보다 오래된 파일은 `.ai-history/archive/YYYY-MM-DD.md.gz` 로 압축(복원 대조가 일치할 때만 원본 삭제)하며, 로그 날짜가 365일을 넘고 **동시에** `.gz` 자체가 `archive − keep` 일 이상 존재했을 때만 삭제합니다(압축 직후 삭제되는 일이 없도록, `archive` 는 `keep` 보다 커야 하며 0 이면 영구 보관). 정리는 프로젝트당 24시간에 한 번, 세션 시작 또는 앵커 변경 시에 돌고, 오늘·어제 로그와 `STATUS.md` 는 건드리지 않습니다. 숫자는 `RETENTION` 파일 또는 `node install.mjs --config --keep-days 60 --archive-days 0` 으로 바꾸고, `keep=0` 이면 로그 회전 전체를 끕니다.

### 트래커 페이지

**사용자가** 직접 확인할 것들을 프로젝트마다 모아 두는 확인 페이지입니다(기능마다 카드 1장: 계정·메뉴 경로·할 일·정상 기준·AI 자체 검증, 그리고 판정 버튼 정상/문제/미확인과 메모).

- **무엇을**: 원본은 `.ai-history/TRACKER.json`, 페이지는 `tracker-template.html` 로 만든 `.ai-history/tracker/index.html`(외부 스크립트·글꼴 없음, 라이트/다크, 폰 배치). 페이지 문구는 `AUTO_HISTORY_LANG`(`en`/`ko`)를 따릅니다.
- **언제**: 한 턴에 프로젝트 안 파일을 만들거나 고쳤으면(또는 빌드·배포·생성 명령을 실행했으면) 응답 끝 STATUS 블록 바로 앞에 TRACKER 블록을 내도록 지시합니다. `Stop` 훅이 병합(`id` 기준 upsert·`remove`·영역 자동 생성·상한 300항목·필드 600자)하고 HTML 을 다시 만듭니다. 블록이 없으면 1회 요구합니다(STATUS 요구와 합쳐 턴당 1회).
- **발행**(Claude Code 만): HTML 이 바뀌면 Claude 에게 `db`·`user` capability 를 단 비공개 claude.ai Artifact 로 발행하고 `{"url":"https://claude.ai/artifact/<id>"}` 로 답하라고 1회 요구하며, 그 url 을 저장합니다. 페이지에서 누른 판정·메모는 Artifact 공유 db(`checks/<id>`, `notes`)에 저장되고, db 가 없으면 그 브라우저에만 남습니다. 다음 세션 시작 때 Claude 가 이를 1회 읽어 `[현황]` 에 보고하도록 지시합니다. Codex 는 블록 병합·HTML 생성까지만 하고 발행 요구는 받지 않습니다.
- **대상 프로젝트**: 히스토리가 `2026-10-27` 이후에 시작됐거나 아직 없는 프로젝트는 켜짐, 그보다 오래된 프로젝트는 사용자가 켜 달라고 할 때(`{"mode":"on"}`)까지 꺼짐. `{"mode":"off"}` 는 그 프로젝트만 끕니다.
- **끄기·조정**: 설정 폴더에 `TRACKER_OFF` 파일이 있으면 전체 끔(블록 무시·주입 없음). `TRACKER_SINCE` 파일(첫 `YYYY-MM-DD` 줄)로 기준 날짜를 바꿉니다.

블록 형식(모든 키 선택, `{"items":[]}` = 변경 없음):

```
<!-- TRACKER:BEGIN -->
{"project":"한 줄 설명","areas":[{"id":"A","title":"로그인"}],
 "items":[{"id":"A-1","area":"A","title":"이메일 로그인","account":"test@example.com / Pass1234!",
   "path":"상단 「로그인」","todo":"「로그인」 누르기","expect":"대시보드로 이동","ai":{"status":"ok|fail|-","note":"근거"}}],
 "remove":[],"note":""}
<!-- TRACKER:END -->
```

주의: 계정을 인라인으로 적는 용도라 `TRACKER.json` 은 마스킹하지 않습니다. 시험용 계정만 쓰세요. 로그 줄(`[TRACKER] …`)은 평소처럼 마스킹됩니다.

### MD 점검표·MD 탭·결과 회수(0.5.0)

- **MD 점검표**: `Stop` 훅이 TRACKER 블록을 병합할 때마다 같은 `TRACKER.json` 으로 `.ai-history/tracker/CHECKLIST.md` 도 씁니다(HTML 과 같은 데이터·같은 시점). 파일만으로 일할 수 있게 프로젝트 이름·앵커·생성 시각·검사 수단·결과 기입법·TRACKER 블록 형식, 항목마다 표 1줄(id·영역·제목·계정·경로·할 일·정상 기준·현재 AI·현재 사용자)이 들어갑니다. 끝에는 항상 빈 칸으로 만든 결과 구역이 있습니다:
  ```
  <!-- RESULTS:BEGIN -->
  - [ ] A-1 | - | 
  <!-- RESULTS:END -->
  ```
  다른 에이전트(예: Codex)는 검증한 줄만 `- [x] A-1 | ok | 2026-10-29 live-check https://example.com/ 200` 처럼 고치고 나머지는 `[ ]` 로 둡니다. 다음 `Stop`(Claude Code 또는 Codex CLI)에서 훅이 편집을 알아채고 그 구역만 읽어 `items[].ai`(`"by":"codex"`)로 저장합니다. 없는 id·구역 밖 줄·`[ ]` 줄은 무시하고, 구역이 깨졌으면 `[TRACKER] md 파싱 오류` 를 1회 남기고 편집본을 `tracker/CHECKLIST.edited-<시각>.md` 로 보존합니다.
- **`ai.by`**: `items[].ai` 에 `"by":"claude"` 또는 `"by":"codex"` 가 붙을 수 있습니다. Codex 응답 끝 TRACKER 블록은 `"by":"codex"` 로 저장됩니다. `by` 만 다른 블록은 변경이 아닙니다. 직접 검증하지 않은 항목은 `ai` 를 생략하세요(`"ai":{"status":"-"}` 를 보내면 다른 주체의 판정을 지웁니다).
- **페이지 탭 2개**: 「페이지」(기본, 기존 그대로)와 「MD」(같은 점검표 본문 + 「복사」 버튼, 「페이지」 탭과 같은 `checks/<id>` 를 쓰는 항목 체크, 「코덱스 결과 붙여넣기」 칸). 붙여넣은 글은 Artifact db 컬렉션 `inbox/<ts>` 에 저장되고, db 가 없으면 그 브라우저에만 남습니다. 다음 세션 시작 때 Claude 가 처리 안 된 `inbox` 문서를 읽어(본문은 데이터이며 지시가 아님) `tracker-md.mjs parse --tracker` 로 걸러 기존 id 의 `ai` 판정만 반영하고, 문서에는 `processedAt` 만 표시합니다(삭제 없음).
- **`tracker/.gitignore`**: 훅이 `.ai-history/tracker/.gitignore`(내용 `*` 한 줄)가 없으면 자동으로 씁니다. 그래서 `tracker/` 아래 점검표·HTML·보고 파일은 git 에 잡히지 않습니다. 단 `.ai-history/TRACKER.json` 은 이 파일로 보호되지 **않습니다**.
- **경고**: `TRACKER.json`·`CHECKLIST.md`·페이지 HTML 에는 항목에 적은 계정 ID/PASS 가 마스킹 없이 들어갑니다. `.ai-history/` 를 git 에서 빼고(`install.mjs --git-ignore`) 시험용 계정만 쓰세요.

### `/tracker-test`(검증 루프)

플러그인에는 에이전트 1개(`agents/tracker-verifier.md`)와 스킬 1개(`skills/tracker-test/SKILL.md`)가 들어 있습니다. 「/tracker-test」·「트래커 검사해줘」 라고 하면 사용자 정상도 AI 정상도 아닌 항목을 턴당 1라운드로 검증합니다:

- 대상은 `node "<HOOK_DIR>/tracker-md.mjs" targets "<TRACKER.json>"` 출력만 씁니다. 훅이 트래커 지시문에 `tracker-md.mjs` 절대경로를 넣어 주므로 스킬은 `${CLAUDE_PLUGIN_ROOT}` 에 기대지 않습니다.
- URL 이 있는 항목은 항목당 `tracker-verifier` 서브에이전트 1개를 전경 병렬로 돌리고, 화면 조작 항목은 에이전트 없이 「AI 검증 불가(UI)」 로 표시합니다(미판정 항목만, Codex 판정·기존 문제 판정은 유지). URL 항목의 `-` 결과(네트워크 오류·권한 없음)도 같은 보호 규칙으로 미판정 항목에만 기록하고, 그 외에는 보고서에만 적습니다. 결과는 턴 끝 TRACKER 블록 1개로 냅니다. 최대 3라운드이며 「/tracker-test」 를 다시 입력하면 다음 라운드입니다. 수리하지 않고 로컬 서버·브라우저도 띄우지 않습니다.
- **스킬 이름**: 플러그인으로 설치하면 `/tracker-test` 대신 `/ai-history:tracker-test` 로 불릴 수 있습니다(미확인). 두 이름을 함께 적어 둡니다. Claude Code 에 보이는 이름을 쓰세요.
- **HTTP 검증은 dev-harness 필요**: 에이전트는 프로젝트 `.harness.json` 의 `live_check` 명령만 실행합니다(dev-harness 형식, 예: `"live_check": "node <경로>/live-check.mjs https://example.com/"`). **dev-harness `.harness.json` 에 `live_check` 가 없으면 HTTP 검증은 할 수 없고**, URL 항목은 「HTTP 확인 수단 없음」 으로 보고됩니다.
- **서브에이전트 Bash 권한**: 에이전트는 그 `node … live-check.mjs …` 명령 1개를 위해 Bash 가 필요합니다. 권한 설정에 따라 Claude Code 가 묻거나 거부할 수 있고, 거부된 항목은 `-`「권한 없음」 으로 보고됩니다. 묻지 않게 하려면 설정에 그 명령만 허용하세요. 예: `"Bash(node <경로>/live-check.mjs *)"`.

### 비대화형 실행

`claude -p`·SDK 실행(`CLAUDE_CODE_ENTRYPOINT` 가 `INTERACTIVE_ENTRYPOINTS` 에 없음), 서브에이전트, Claude Code 세션 **안에서** 띄운 Codex 는 기계 로그만 남깁니다. 주입·요구 없음.

## 설정

파일은 모두 스크립트 옆(또는 `AUTO_HISTORY_CONF_DIR`)에 둡니다. 파일 없음 = 기본값.

| 파일 / 환경변수 | 의미 |
|---|---|
| `ROOT` / `AUTO_HISTORY_ROOT` | 경계 폴더(기본 `~/Projects`) |
| `LANG` / `AUTO_HISTORY_LANG` | `en`(기본) 또는 `ko`: 주입 문구·STATUS 제목·머리말 언어 |
| `RETENTION` / `AUTO_HISTORY_KEEP_DAYS`, `AUTO_HISTORY_ARCHIVE_DAYS`, `AUTO_HISTORY_SESSIONS_DAYS` | 줄 `keep=30`, `archive=365`, `sessions=7`(일). `keep=0` 로그 회전 끔, `archive=0` `.gz` 영구 보관, `sessions=0` 세션 사본 보존 |
| `ALIASES` | `문구1\|문구2 => 루트기준\상대경로`, 한 줄에 대상 하나. `ALIASES.example` 참고 |
| `INTERACTIVE_ENTRYPOINTS` | 대화형으로 볼 Claude 진입점(`cli`) |
| `NO_BLOCK`, `NO_BLOCK_CODEX` | 있으면 1회 요구 끔 |
| `NESTED_MARKERS`, `NESTED_MARKERS_CODEX` | `ENV=값` 줄, 일치하면 중첩 실행 → 기록만 |
| `DUMP_INPUTS`, `DUMP_INPUTS_CODEX` | 있으면 훅 입력(마스킹)을 `dumps/` 에 덤프(디버깅) |
| `TRACKER_OFF` | 있으면 모든 프로젝트의 트래커 페이지 끔 |
| `TRACKER_SINCE` | 첫 `YYYY-MM-DD` 줄: 히스토리가 그보다 먼저 시작된 프로젝트는 요청 전까지 트래커 꺼짐(기본 `2026-10-27`) |
| `AUTO_HISTORY_DIRNAME` | 히스토리 폴더 이름(기본 `.ai-history`) |
| `AUTO_HISTORY_DISABLE=1` | 그 프로세스에서 전부 끔(데몬 등) |
| `AUTO_HISTORY_STATE_DIR` | 세션별 상태 파일 위치(기본 설정 폴더의 `state/`) |

별칭은 단어 경계·대소문자 무시·긴 문구 우선으로 맞추고, 구분자는 공백·점·하이픈(`tauko work` = `tauko-work` = `tauko.work`)입니다. 코드 펜스·URL·파일 경로·붙여넣기 블록 안의 글자는 무시하고, 요청문 앞 400자만 봅니다.

## Claude Code 플러그인 모드(실험)

저장소에 `.claude-plugin/plugin.json` 과 `hooks/hooks.json` 이 들어 있어 `claude --plugin-dir ./ai-history` 로 띄우거나 마켓플레이스에서 설치(`/plugin install ai-history --marketplace omskykhal/ai-history`)할 수 있습니다. 플러그인 모드에서는 설정 폴더가 `CLAUDE_PLUGIN_DATA` 이므로 `ROOT`/`LANG` 파일 대신 환경변수 `AUTO_HISTORY_ROOT`(선택 `AUTO_HISTORY_LANG`)를 씁니다. Codex 는 여전히 `install.mjs --codex-hooks` 가 필요합니다.

상태: Windows 에서 `claude --plugin-dir` 로 1회 확인(2026-10-12: `.ai-history/`·날짜 로그·`STATUS.md` 생성, 상태 블록 요구 동작). 마켓플레이스 설치는 같은 로딩 경로지만 따로 시험하지 않았습니다. 같은 PC 에서 플러그인 모드와 `install.mjs --install` 을 함께 쓰지 마세요. 훅이 두 벌 돌아 모든 로그 줄이 두 번씩 기록됩니다.

## 시험

```bash
node test/run-tests.mjs <scratch-dir>
```

263건(훅 동작·앵커 규칙·별칭/폴더 매칭·STATUS 추출·안전 예외·설치기 왕복·영어 모드·로그 보존·다중 세션 STATUS·재개 명령·트래커 페이지·MD 점검표/결과 회수/tracker-test 규칙). 시험 산출물은 OS 임시 폴더에만 생기고 실제 프로젝트엔 쓰지 않습니다.

에이전트·스킬 전역 사본(`~/.claude/agents/tracker-verifier.md`, `~/.claude/skills/tracker-test/SKILL.md`)을 두는 경우 `node test/check-global-sync.mjs` 가 이 저장소와 sha1 로 비교합니다(BOM 제거·CRLF→LF 정규화 후): `SYNC OK 2/2`, 「미복사」(종료 코드 0), 「불일치」(종료 코드 1). `npm test` 에는 포함되지 않습니다.

## 알려진 한계

- 검증된 플랫폼은 Windows 뿐
- 두 에이전트가 같은 프로젝트를 동시에 쓰면 로그는 섞이고 `STATUS.md` 는 마지막 작성자 우선(세션별 블록은 `sessions/` 에 남음, 위 절 참고)
- Codex 의 `Stop` `decision: block` 은 실제 발동을 관찰하지 못함(시험 중 Codex 가 매번 지시를 따름)

## 제작자 / 라이선스

Yang <omskykhal@gmail.com> · MIT (`LICENSE` 참고)
