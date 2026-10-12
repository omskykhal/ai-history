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
| Claude Code | 훅 지원(`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) |
| OpenAI Codex CLI | 0.160 이상, `hooks` 사용 가능(`codex features list` → `hooks stable true`), 선택 |
| OS | **Windows**(검증됨). macOS/Linux: 경로 처리는 구현돼 있으나 **미검증** |

## 설치 (권장: 설치 스크립트)

```bash
git clone https://github.com/omskykhal/ai-history.git
cd ai-history
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

`Stop` 훅이 이걸 뽑아 머리말(`세션`, `작성: <agent> (<id>)`, `갱신`, `앵커`)과 함께 `STATUS.md` 로 씁니다. 블록이 없으면 **한 번만** 다시 요구(`decision: block`)하고, 컨텍스트 한도·사용자 중단·인증 오류·예약 깨우기·컨텍스트 95% 이상일 땐 요구하지 않습니다. 설정 폴더에 `NO_BLOCK`(Claude) / `NO_BLOCK_CODEX`(Codex) 파일을 두거나 `AUTO_HISTORY_NO_BLOCK=1` 로 끌 수 있습니다.

### 무엇이 기록되나

| 줄 | 내용 |
|---|---|
| `[User] …` | 요청문 앞 120자 |
| `▶ [도구] …` / `✓ [도구] … (1.2s)` | 도구 이름과 짧은 대상(명령·파일 경로·패턴·에이전트 설명). **도구 출력은 기록하지 않음** |
| `[Turn-end] …` | 응답 앞 300자, 또는 `STATUS 갱신` |
| `[anchor] 지정/변경 …` | 앵커 변화 |

API 키처럼 보이는 문자열(`AIza…`, `sk-…`, `ghp_…`, `Bearer …`, `password=…`)은 쓰기 전에 마스킹합니다.

### 비대화형 실행

`claude -p`·SDK 실행(`CLAUDE_CODE_ENTRYPOINT` 가 `INTERACTIVE_ENTRYPOINTS` 에 없음), 서브에이전트, Claude Code 세션 **안에서** 띄운 Codex 는 기계 로그만 남깁니다. 주입·요구 없음.

## 설정

파일은 모두 스크립트 옆(또는 `AUTO_HISTORY_CONF_DIR`)에 둡니다. 파일 없음 = 기본값.

| 파일 / 환경변수 | 의미 |
|---|---|
| `ROOT` / `AUTO_HISTORY_ROOT` | 경계 폴더(기본 `~/Projects`) |
| `LANG` / `AUTO_HISTORY_LANG` | `en`(기본) 또는 `ko`: 주입 문구·STATUS 제목·머리말 언어 |
| `ALIASES` | `문구1\|문구2 => 루트기준\상대경로`, 한 줄에 대상 하나. `ALIASES.example` 참고 |
| `INTERACTIVE_ENTRYPOINTS` | 대화형으로 볼 Claude 진입점(`cli`) |
| `NO_BLOCK`, `NO_BLOCK_CODEX` | 있으면 1회 요구 끔 |
| `NESTED_MARKERS`, `NESTED_MARKERS_CODEX` | `ENV=값` 줄, 일치하면 중첩 실행 → 기록만 |
| `DUMP_INPUTS`, `DUMP_INPUTS_CODEX` | 있으면 훅 입력(마스킹)을 `dumps/` 에 덤프(디버깅) |
| `AUTO_HISTORY_DIRNAME` | 히스토리 폴더 이름(기본 `.ai-history`) |
| `AUTO_HISTORY_DISABLE=1` | 그 프로세스에서 전부 끔(데몬 등) |
| `AUTO_HISTORY_STATE_DIR` | 세션별 상태 파일 위치(기본 설정 폴더의 `state/`) |

별칭은 단어 경계·대소문자 무시·긴 문구 우선으로 맞추고, 구분자는 공백·점·하이픈(`tauko work` = `tauko-work` = `tauko.work`)입니다. 코드 펜스·URL·파일 경로·붙여넣기 블록 안의 글자는 무시하고, 요청문 앞 400자만 봅니다.

## Claude Code 플러그인 모드(실험)

저장소에 `.claude-plugin/plugin.json` 과 `hooks/hooks.json` 이 들어 있어 `claude --plugin-dir ./ai-history` 로 띄우거나 마켓플레이스로 배포할 수 있습니다. 플러그인 모드에서는 설정 폴더가 `CLAUDE_PLUGIN_DATA` 이므로 `ROOT`/`LANG` 파일 대신 환경변수 `AUTO_HISTORY_ROOT`(선택 `AUTO_HISTORY_LANG`)를 씁니다. Codex 는 여전히 `install.mjs --codex-hooks` 가 필요합니다. 이 경로는 **끝까지 시험하지 않았습니다**. 위의 설치 스크립트 경로는 시험됐습니다.

## 시험

```bash
node test/run-tests.mjs <scratch-dir>
```

170건(훅 동작·앵커 규칙·별칭/폴더 매칭·STATUS 추출·안전 예외·설치기 왕복·영어 모드). 시험 산출물은 OS 임시 폴더에만 생기고 실제 프로젝트엔 쓰지 않습니다.

## 알려진 한계

- 검증된 플랫폼은 Windows 뿐
- 로그는 회전 없이 누적(프로젝트당 하루 한 파일)
- 두 에이전트가 같은 프로젝트를 동시에 쓰면 로그는 섞이고 `STATUS.md` 는 마지막 작성자 우선
- Codex 의 `Stop` `decision: block` 은 실제 발동을 관찰하지 못함(시험 중 Codex 가 매번 지시를 따름)

## 제작자 / 라이선스

Yang <omskykhal@gmail.com> · MIT (`LICENSE` 참고)
