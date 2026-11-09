# 배포 가이드 / Distribution guide

작성: 2026-10-10. 이 문서는 저장소 소유자(Yang)용 체크리스트와 복붙용 공지 문구입니다. `omskykhal` 는 GitHub 계정명으로 바꾸세요(README.md·README.ko.md·package.json·.claude-plugin/plugin.json·.claude-plugin/marketplace.json 에도 같은 자리표시자가 있습니다).

## 1. 배포 전 할 일 (순서대로)

1. **이름 확정**: `ai-history`. 2026-10-10 검색에서 같은 이름의 Claude/Codex 훅 저장소는 찾지 못했지만 GitHub 전체 중복 확인은 하지 않았습니다. GitHub 에서 `ai-history` 를 한 번 검색해 보고, 겹치면 `ai-history-hooks` 같은 이름으로 바꾸세요. 플러그인 이름은 `claude-`·`anthropic-` 으로 시작하면 안 됩니다(공식 문서 규칙).
2. **자리표시자 치환**: 위 5개 파일의 `omskykhal`.
3. **플러그인 매니페스트 검증**(Claude Code 설치 환경에서):
   ```
   claude plugin validate .
   ```
   `Validation passed` 가 나와야 합니다. (이 저장소에서는 아직 실행하지 않았습니다.)
4. **시험**: `node test/run-tests.mjs <scratch-dir>` → `TOTAL 225/225 PASS`.
5. **다른 PC 1대에서 설치 리허설**(가능하면): clone → `install.mjs --install --root … --lang en` → Claude Code 새 세션에서 `[Status]` 보고 확인 → `--codex-hooks` → Codex 에서 확인. Windows 외 OS 는 "미검증"이므로 README 문구를 유지하거나, 리허설 후 문구를 바꾸세요.
6. **GitHub 저장소 생성 후 push** → Release `v0.1.0` 태그.

### 1-1. 0.5.0 추가 확인(2026-10-29)

0.5.0 은 훅 외에 `agents/tracker-verifier.md`·`skills/tracker-test/SKILL.md` 를 함께 배포합니다(`/tracker-test` 검증 루프). `hooks/hooks.json` 은 새 이벤트가 없어 변경 없음.

1. **매니페스트 검증**: `claude plugin validate .` → `Validation passed`. 실패하면 커밋·배포하지 않습니다.
2. **시험**: `node test/run-tests.mjs <scratch-dir>` → `TOTAL 263/263 PASS`(0.4.1 의 226 + 0.5.0 13행 37건, 2026-10-29 확인).
3. **전역 사본 일치**(이 PC 처럼 `~/.claude/agents`·`~/.claude/skills/tracker-test` 에 사본을 두는 경우): `node test/check-global-sync.mjs` → `SYNC OK 2/2`. 플러그인 리포가 정본이고 전역은 복사본입니다.
4. **스킬 호출 이름**: 플러그인 설치 시 `/tracker-test` 와 `/ai-history:tracker-test` 중 어느 쪽으로 불리는지, SKILL.md 본문의 `${CLAUDE_PLUGIN_ROOT}` 가 치환되는지는 **미확인**. 그래서 스킬은 훅이 지시문에 넣는 `tracker-md.mjs` 절대경로 1줄을 쓰고, README 에는 두 이름을 함께 적었습니다.
5. **HTTP 검증 수단**: 플러그인은 자체 HTTP 검사 도구를 넣지 않습니다. 사용자 프로젝트에 dev-harness `.harness.json` `live_check` 가 없으면 HTTP 검증 불가(README 명시).
6. **서브에이전트 Bash 권한**: `tracker-verifier` 는 `node … live-check.mjs …` 1개를 Bash 로 실행합니다. 사용자 권한 설정에 따라 묻거나 거부될 수 있음(README 에 허용 규칙 예시).
7. **push·태그·릴리스**는 저장소 소유자 승인 후.

### 1-2. 0.7.0 (2026-11-09) — 배포 노선 확정

- Anthropic 플러그인 디렉터리 등재는 **추진하지 않습니다**. 0.6.1·0.6.2 는 "`command` 훅은 인증된 조직만", 훅을 뺀 0.6.3 은 "md·txt·json·yaml·이미지 외 파일은 인증된 조직만" 으로 거절됐습니다(보안 스캔은 통과). 훅 스크립트와 설치기가 제품 본체라 더 뺄 수 없습니다. oh-my-claudecode 같은 플러그인도 디렉터리 없이 자기 저장소를 마켓플레이스로 삼아 배포합니다.
- 0.7.0 에서 `hooks/hooks.json`(훅 6개) 을 되살렸습니다. 배포 경로는 ① 이 저장소 자체 마켓플레이스(한 줄 설치), ② clone + `install.mjs` 두 가지뿐입니다.
- 확인 명령: `claude plugin validate .` → `Validation passed`, `npm test` → 266 + 92 + 23. 릴리스 v0.7.0 생성 완료, About·Topics 갱신 완료(2026-11-09).
- **미확인**: 마켓플레이스 한 줄 설치가 실제로 훅을 등록하는지(`--plugin-dir` 로는 2026-10-12 1회 확인). 공지 전에 다른 PC 또는 새 프로필에서 1회 실측 권장.

### 1-3. 0.8.0 / 0.8.1 (2026-11-10)

- 0.8.0: 이름 연결어(`라는`·`이라는`·`란`·`이란` / `called`·`named`) 허용, STATUS 선택 절 「추천」/「Suggested」, 계정 도구(tracker-cred) 복원 → 로컬 훅과 기능 동일. 0.8.1: 추천 항목을 선택지(항목별 + 「다른 할 일」)로 묻는 지시문. 확인: `npm test` 277 + 92 + 23, `claude plugin validate .` 통과.

## 2. 어디에 배포하나

| 채널 | 왜 | 어떻게 | 확인 상태 |
|---|---|---|---|
| **GitHub 저장소** (필수) | 모든 설치 경로의 출발점(`git clone`, 마켓플레이스 `github` 소스) | 공개 저장소 + Release 태그 + Topics(`claude-code`, `claude-code-hooks`, `claude-code-plugin`, `claude-code-marketplace`, `codex-cli`, `openai-codex`, `grok`, `kimi`, `cursor`, `developer-tools`, `session-memory`) | 완료(v0.7.0 Latest, 2026-11-09) |
| **자체 마켓플레이스** (주 경로) | 사용자가 Claude Code 안에서 한 줄로 설치 | 이 저장소의 `.claude-plugin/marketplace.json`(이름 `ai-history-marketplace`, source `./`). 설치: `/plugin install ai-history --marketplace omskykhal/ai-history` 또는 `/plugin marketplace add omskykhal/ai-history` 뒤 `/plugin install ai-history@ai-history-marketplace` | 형식 검증 통과. 실설치 실측 **미확인** |
| **Anthropic 플러그인 디렉터리** | 노출 | **추진 안 함**(§1-2). 정책이 바뀌면 재검토 | 거절 2회(2026-11-07·11-08) |
| **awesome 목록 PR** | 발견성 | `rohitg00/awesome-claude-code-toolkit` 등. 각 README 의 기여 규칙을 읽고 한 줄 PR. 타인 저장소 push 이므로 소유자 승인 후 | 목록 존재만 확인 |
| **커뮤니티 글** | 사용자 유입 | Reddit `r/ClaudeAI`, `r/ChatGPTCoding`; X/Twitter; GitHub Discussions(anthropics/claude-code, openai/codex 는 Discussions 가 열려 있는지 올리기 전에 확인). 게시는 소유자 계정으로 | 게시 규칙 미확인 |
| **npm** | `npx` 설치 | 현재 구조는 `git clone`·마켓플레이스 전제. 해당 없음 | 해당 없음 |

## 3. 복붙용 문구 (0.7.0 기준, 2026-11-09)

### 3-1. GitHub 저장소 설명(About, 한 줄)

- EN(적용됨): `One shared, human-readable work history per project for Claude Code, Codex, Grok, Kimi and Cursor, written automatically by hooks and resumed with a [Status] report.`
- KO: `Claude Code·Codex·Grok·Kimi·Cursor 가 프로젝트마다 하나의 작업 히스토리를 자동으로 함께 쓰고, 다음 세션을 [현황] 보고로 시작하게 하는 훅.`

### 3-2. 짧은 공지 (X/Twitter, 280자 안쪽)

EN:
```
ai-history: Claude Code, Codex, Grok, Kimi and Cursor write ONE markdown work history per project (every tool call + STATUS.md), and the next session — from any of them — opens with a [Status] report. No LLM calls, no DB, just hooks + markdown. MIT.
Install in Claude Code: /plugin install ai-history --marketplace omskykhal/ai-history
https://github.com/omskykhal/ai-history
```

KO:
```
ai-history 공개합니다. Claude Code·Codex·Grok·Kimi·Cursor 가 프로젝트마다 하나의 마크다운 히스토리(도구 호출 전부 + STATUS.md)를 자동으로 같이 쓰고, 다음 세션은 어느 쪽에서 열어도 [현황] 보고로 시작합니다. LLM 호출·DB 없음, 훅+마크다운뿐. MIT.
Claude Code 에서 한 줄: /plugin install ai-history --marketplace omskykhal/ai-history
https://github.com/omskykhal/ai-history
```

### 3-3. 긴 공지 (Reddit / Discussions / 블로그)

EN:
```
ai-history — one shared work history per project for Claude Code, Codex, Grok, Kimi and Cursor

Problem: I switch between several coding agents on the same repos, and I close the laptop mid-task. No tool's built-in resume knows what the other one did, and after a crash I had to re-explain where I was.

What it does
- Hooks (SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SessionEnd) append one line per tool call to <project>/.ai-history/YYYY-MM-DD.md, tagged with the session and the agent: "- 14:02:11 [a1b2c3d4][codex] ▶ [Bash] npm test".
- At the end of each reply the agent writes a short block (Working on / Done / Next / Progress); the Stop hook saves it to STATUS.md with the author.
- On session start, or whenever you mention a project by name ("MyApp project, continue") or by path, the hook injects STATUS.md + the tail of today's and yesterday's log, and the agent opens with a [Status] report that names the last worker.
- Same scripts, same files for every agent, so one timeline. Optional tracker page (a checklist of items for you to verify) and a /tracker-test skill that checks URL items.
- Name a project from anywhere: "MyApp project, continue", "project called MyApp" (Korean "MyApp 라는 프로젝트" works too). The STATUS block may end with a Suggested section — 0-3 things worth doing next; the agent offers them as a choice (plus "Something else") and starts nothing until you pick.
- No LLM calls, no database, no cloud. Plain markdown in the project folder. API-key-looking strings are masked; tool output is never logged.

Install
- Claude Code, one line: /plugin install ai-history --marketplace omskykhal/ai-history (six hooks + skill + agent; set AUTO_HISTORY_ROOT to your projects folder).
- Or clone and run node install.mjs --install --root <your projects folder> --lang en; add --codex-hooks, --grok-hooks, --kimi-hooks as needed (Cursor is covered by the same install). Uninstall restores settings from a backup. Don't use both on the same machine (double logging).

Why not the Anthropic plugin directory: it currently accepts command hooks and script files only from verified organizations, so this ships from its own marketplace.

Limits (honest): tested on Windows and Linux (plugin install, hooks, e2e); macOS path code exists but is untested. Headless `claude -p` logs tools only. Logs older than 30 days are gzipped.

MIT. Feedback welcome, especially from macOS/Linux users.
https://github.com/omskykhal/ai-history
```

KO:
```
ai-history — Claude Code·Codex·Grok·Kimi·Cursor 가 프로젝트마다 하나의 작업 히스토리를 같이 쓰게 하는 훅

문제: 같은 저장소를 여러 코딩 에이전트로 번갈아 작업하고, 작업 중에 노트북을 닫는 일이 잦습니다. 어느 도구의 내장 resume 도 다른 도구가 뭘 했는지 모르고, 강제 종료 뒤엔 매번 어디까지 했는지 다시 설명해야 했습니다.

하는 일
- 훅(SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SessionEnd)이 도구 호출마다 <프로젝트>/.ai-history/YYYY-MM-DD.md 에 한 줄씩 씁니다. 세션과 에이전트 표시 포함: "- 14:02:11 [a1b2c3d4][codex] ▶ [Bash] npm test"
- 응답 끝에 에이전트가 짧은 블록(하던 일 / 한 일 / 다음 할 일 / 진행도)을 쓰면 Stop 훅이 작성자 머리말과 함께 STATUS.md 로 저장합니다.
- 세션 시작 때, 또는 프로젝트를 이름("MyApp 프로젝트 이어서")이나 경로로 말할 때 STATUS.md 와 오늘·어제 로그 꼬리를 주입하고, 에이전트는 마지막 작업자를 포함한 [현황] 보고로 시작합니다.
- 모든 에이전트가 같은 스크립트·같은 파일을 쓰므로 타임라인이 하나입니다. 선택으로 트래커 페이지(사용자 확인 점검표)와 URL 항목을 검사하는 /tracker-test 스킬이 있습니다.
- 어디서 열었든 "MyApp 프로젝트 이어서", "MyApp 라는 프로젝트" 처럼 이름만 말하면 그 프로젝트에 기록합니다. STATUS 블록 끝의 「추천」 절(다음에 하면 좋은 일 0~3줄)은 에이전트가 선택지(+「다른 할 일」)로 물어보고, 고르기 전에는 시작하지 않습니다.
- LLM 호출·DB·클라우드 없음. 프로젝트 폴더의 마크다운뿐. API 키처럼 보이는 문자열은 마스킹하고 도구 출력은 기록하지 않습니다.

설치
- Claude Code 한 줄: /plugin install ai-history --marketplace omskykhal/ai-history (훅 6개 + 스킬 + 에이전트, 환경변수 AUTO_HISTORY_ROOT 에 프로젝트 상위 폴더 지정).
- 또는 clone 후 node install.mjs --install --root <프로젝트 상위 폴더> --lang ko, 필요하면 --codex-hooks·--grok-hooks·--kimi-hooks(Cursor 는 같은 설치로 처리). 제거는 백업에서 settings 복원. 같은 PC 에서 둘을 함께 쓰면 2중 기록됩니다.

Anthropic 플러그인 디렉터리에 없는 이유: 현재 command 훅과 스크립트 파일을 인증된 조직에만 허용해서, 자체 마켓플레이스로 배포합니다.

한계(솔직하게): Windows 와 Linux 에서 검증(플러그인 설치·훅·e2e). macOS 경로 코드는 있지만 미검증. 헤드리스 `claude -p` 는 도구 로그만 남깁니다. 30일 지난 로그는 gzip 보관.

MIT. 특히 macOS/Linux 사용자의 피드백을 기다립니다.
https://github.com/omskykhal/ai-history
```

### 3-4. Release 노트

릴리스 노트는 `CHANGELOG.md` 의 해당 버전 절을 그대로 씁니다(v0.7.0 은 2026-11-09 생성 완료). 옛 v0.1.0 노트는 git 이력(0.6.3 이전 이 문서)에 있습니다.

## 4. 배포 뒤

- 이슈 템플릿은 없습니다. 첫 이슈가 들어오면 "OS / Node 버전 / `node install.mjs --status` 출력 / `DUMP_INPUTS` 덤프 1건" 을 요청하면 원인 파악에 충분합니다.
- 버전 올릴 때 `package.json`·`.claude-plugin/plugin.json`·`.claude-plugin/marketplace.json`·`CHANGELOG.md` 네 곳을 같이 바꾸세요.
- `agents/`·`skills/` 를 고치면 전역 사본도 다시 복사하고 `node test/check-global-sync.mjs` 로 확인하세요.
- 이 PC 의 라이브 훅(`~/.claude/hooks/auto-history/`)은 이 저장소와 별개입니다. 저장소를 고쳐도 라이브는 바뀌지 않고, 라이브를 고쳐도 저장소는 바뀌지 않습니다.
