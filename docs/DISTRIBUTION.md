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
4. **시험**: `node test/run-tests.mjs <scratch-dir>` → `TOTAL 203/203 PASS`.
5. **다른 PC 1대에서 설치 리허설**(가능하면): clone → `install.mjs --install --root … --lang en` → Claude Code 새 세션에서 `[Status]` 보고 확인 → `--codex-hooks` → Codex 에서 확인. Windows 외 OS 는 "미검증"이므로 README 문구를 유지하거나, 리허설 후 문구를 바꾸세요.
6. **GitHub 저장소 생성 후 push** → Release `v0.1.0` 태그.

## 2. 어디에 배포하나

| 채널 | 왜 | 어떻게 | 확인 상태 |
|---|---|---|---|
| **GitHub 저장소** (필수) | 모든 설치 경로의 출발점(`git clone`, 마켓플레이스 `github` 소스) | 공개 저장소 + Release 태그 + Topics: `claude-code`, `claude-code-hooks`, `claude-code-plugin`, `codex-cli`, `openai-codex`, `developer-tools` | 일반 절차 |
| **Claude Code 자체 마켓플레이스** | 사용자가 `/plugin marketplace add omskykhal/ai-history` 한 줄로 설치 | 이 저장소의 `.claude-plugin/marketplace.json` 이 이미 마켓플레이스 정의. 설치 명령: `/plugin marketplace add omskykhal/ai-history` 후 `/plugin install ai-history@ai-history-marketplace` | 형식은 공식 문서로 확인. 플러그인 모드 자체는 **미검증(실험)** |
| **Anthropic 공식 마켓플레이스 등재** | 노출 | 등재 신청 절차는 **확인하지 못했습니다**(공식 문서에서 제출 방법을 찾지 못함). 필요하면 `code.claude.com/docs/en/plugins/publish` 를 먼저 읽으세요 | 미확인 |
| **awesome 목록 PR** | 발견성 | 검색에서 확인된 목록: `rohitg00/awesome-claude-code-toolkit`(176+ 플러그인 수록). 그 외 "awesome-claude-code" 류 목록은 각 README 의 기여 규칙을 읽고 PR | 목록 존재만 확인 |
| **커뮤니티 글** | 사용자 유입 | Reddit `r/ClaudeAI`, `r/ChatGPTCoding`; X/Twitter; GitHub Discussions(anthropics/claude-code, openai/codex 는 Discussions 가 열려 있는지 올리기 전에 확인) | 게시 규칙 미확인 |
| **npm** | `npx` 설치 | 현재 구조는 `git clone` 전제. npm 배포는 `bin` 추가가 필요해 0.1.0 범위 밖 | 해당 없음 |

## 3. 복붙용 문구

### 3-1. GitHub 저장소 설명(About, 한 줄)

- EN: `One shared, human-readable work history per project for Claude Code and OpenAI Codex — written automatically by hooks, resumed with a [Status] report.`
- KO: `Claude Code 와 OpenAI Codex 가 프로젝트마다 하나의 작업 히스토리를 자동으로 함께 쓰고, 다음 세션을 [현황] 보고로 시작하게 하는 훅.`

### 3-2. 짧은 공지 (X/Twitter, 280자 안쪽)

EN:
```
I built ai-history: Claude Code + OpenAI Codex write ONE markdown work history per project (every tool call + a STATUS.md), and the next session — from either agent — starts with a [Status] report. No LLM calls, no DB, just hooks + markdown. MIT.
https://github.com/omskykhal/ai-history
```

KO:
```
ai-history 공개합니다. Claude Code 와 Codex 가 프로젝트마다 하나의 마크다운 히스토리(도구 호출 전부 + STATUS.md)를 자동으로 같이 쓰고, 다음 세션은 어느 쪽에서 열어도 [현황] 보고로 시작합니다. LLM 호출·DB 없음, 훅+마크다운뿐. MIT.
https://github.com/omskykhal/ai-history
```

### 3-3. 긴 공지 (Reddit / Discussions / 블로그)

EN:
```
ai-history — one shared work history for Claude Code and Codex, per project

Problem: I switch between Claude Code and Codex on the same repos, and I close the laptop mid-task. Neither tool's built-in resume knows what the other one did, and after a crash I had to re-explain where I was.

What it does
- Hooks (SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop) append one line per tool call to <project>/.ai-history/YYYY-MM-DD.md, tagged with the session and the agent: "- 14:02:11 [a1b2c3d4][codex] ▶ [Bash] npm test".
- At the end of each reply the agent writes a short block (Working on / Done / Next / Progress); the Stop hook saves it to STATUS.md with "Author: claude|codex".
- On session start, or whenever you mention a project by name ("MyApp project, continue"), the hook injects STATUS.md + the tail of today's and yesterday's log, and the agent opens with a [Status] report that names the last worker.
- Claude Code and Codex use the same scripts and the same files, so one timeline.
- No LLM calls, no database, no cloud. Plain markdown in the project folder. API-key-looking strings are masked; tool output is never logged.

Install: git clone, then `node install.mjs --install --root <your projects folder> --lang en`, optionally `--codex-hooks` and `--git-ignore`. Uninstall restores settings from a backup.

Limits (honest): tested on Windows only; macOS/Linux path code exists but is untested. Logs don't rotate. A Claude Code plugin manifest is included but plugin mode is experimental.

MIT. Feedback welcome, especially from macOS/Linux users.
https://github.com/omskykhal/ai-history
```

KO:
```
ai-history — Claude Code 와 Codex 가 프로젝트마다 하나의 작업 히스토리를 같이 쓰게 하는 훅

문제: 같은 저장소를 Claude Code 와 Codex 로 번갈아 작업하고, 작업 중에 노트북을 닫는 일이 잦습니다. 두 도구의 내장 resume 은 서로가 뭘 했는지 모르고, 강제 종료 뒤엔 매번 어디까지 했는지 다시 설명해야 했습니다.

하는 일
- 훅(SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop)이 도구 호출마다 <프로젝트>/.ai-history/YYYY-MM-DD.md 에 한 줄씩 씁니다. 세션과 에이전트 표시 포함: "- 14:02:11 [a1b2c3d4][codex] ▶ [Bash] npm test"
- 응답 끝에 에이전트가 짧은 블록(하던 일 / 한 일 / 다음 할 일 / 진행도)을 쓰면 Stop 훅이 "작성: claude|codex" 머리말과 함께 STATUS.md 로 저장합니다.
- 세션 시작 때, 또는 프로젝트 이름을 말할 때("MyApp 프로젝트 이어서") STATUS.md 와 오늘·어제 로그 꼬리를 주입하고, 에이전트는 마지막 작업자를 포함한 [현황] 보고로 시작합니다.
- Claude Code 와 Codex 가 같은 스크립트·같은 파일을 쓰므로 타임라인이 하나입니다.
- LLM 호출·DB·클라우드 없음. 프로젝트 폴더의 마크다운뿐. API 키처럼 보이는 문자열은 마스킹하고 도구 출력은 기록하지 않습니다.

설치: git clone 후 `node install.mjs --install --root <프로젝트 상위 폴더> --lang ko`, 선택으로 `--codex-hooks`, `--git-ignore`. 제거는 백업에서 settings 를 복원합니다.

한계(솔직하게): Windows 에서만 검증. macOS/Linux 경로 코드는 있지만 미검증. 로그 회전 없음. Claude Code 플러그인 매니페스트는 들어 있지만 플러그인 모드는 실험 단계.

MIT. 특히 macOS/Linux 사용자의 피드백을 기다립니다.
https://github.com/omskykhal/ai-history
```

### 3-4. Release v0.1.0 노트

EN:
```
v0.1.0 — first public release

- Five hooks for Claude Code and Codex, one shared .ai-history/ per project with per-line agent attribution
- STATUS.md written from the agent's end-of-reply block; one safe nudge if it is missing
- Project selection by alias or "<name> project" mention from any working directory
- Installer: --install / --uninstall / --codex-hooks / --codex-hooks-remove / --git-ignore / --config / --status
- en / ko wording, 170 automated tests
- Tested on Windows only; macOS/Linux untested
```

KO:
```
v0.1.0 — 첫 공개

- Claude Code 와 Codex 용 훅 5종, 프로젝트마다 하나의 .ai-history/ 에 줄마다 작업 에이전트 표시
- 응답 끝 블록에서 STATUS.md 생성, 누락 시 안전한 1회 요구
- 아무 작업 폴더에서나 별칭 또는 "<이름> 프로젝트" 언급으로 프로젝트 선택
- 설치기: --install / --uninstall / --codex-hooks / --codex-hooks-remove / --git-ignore / --config / --status
- 영어/한국어 문구, 자동 시험 170건
- Windows 만 검증, macOS/Linux 미검증
```

## 4. 배포 뒤

- 이슈 템플릿은 없습니다. 첫 이슈가 들어오면 "OS / Node 버전 / `node install.mjs --status` 출력 / `DUMP_INPUTS` 덤프 1건" 을 요청하면 원인 파악에 충분합니다.
- 버전 올릴 때 `package.json`·`.claude-plugin/plugin.json`·`.claude-plugin/marketplace.json`·`CHANGELOG.md` 네 곳을 같이 바꾸세요.
- 이 PC 의 라이브 훅(`~/.claude/hooks/auto-history/`)은 이 저장소와 별개입니다. 저장소를 고쳐도 라이브는 바뀌지 않고, 라이브를 고쳐도 저장소는 바뀌지 않습니다.
