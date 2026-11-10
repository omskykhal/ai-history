# Changelog

## 0.10.3 — 2026-11-10

- Tests only, third Linux pass (Linux after 0.10.2: run-tests 272/279, agent 92/92, cursor 22/23): the alias expectation in row 7 (ba) uses `path.join`, and the Cursor normalisation check strips the leading `/` of the workspace-root URI only on Windows. Hook code unchanged. Linux after this change: run-tests 279/279, agent 92/92, cursor 23/23 — the suites pass on both platforms; README platform wording updated.

## 0.10.2 — 2026-11-10

- Tests only, second Linux pass (Linux after 0.10.1: run-tests 259/279, agent 92/92, cursor 22/23). Fixtures that still assumed `\` or a drive letter: the Edit path in row 4, the alias table (`teacher\tauko` → `teacher/tauko`; the parser accepts both separators), the `--migrate-dirname` expectations, the Codex `hooks.json` command regex (`/` or `X:/`), and the Cursor workspace-root URI (POSIX roots are plain paths, no leading extra `/`). Hook code unchanged.

## 0.10.1 — 2026-11-10

- Tests only: the suites pass on Linux as well. Cases whose expectations were Windows paths (boundary cases in row 1, the case-insensitive cwd, the path-in-prompt case, the checklist anchors, the tracker change detection, the Cursor slug, the Grok anchor suffix) now have POSIX twins chosen by `process.platform`. Hook code unchanged. Linux: plugin install, the six hooks and a `claude -p` e2e run were verified on 2026-11-10; the suite there was 250/279, 89/92, 21/23 before this change.

## 0.10.0 — 2026-11-10

- **Injection is an index now.** Session start and project mentions inject `STATUS.md` + tracker summary + other sessions + the last 15 lines of today's log and 5 of yesterday's (lines cut at 200 chars), 8,000 chars in total (was 40 / 20 lines and 10,000). A new "More history" section names the `search.mjs` command and the dated log path, and the instruction (ko/en) says the tails are partial. Sizes: conf file `INJECT` or `AUTO_HISTORY_INJECT` (`today`, `yday`, `line`, `total`, `status`; env wins). New exports `INJECT_DEFAULTS`, `injectLimits()`, `readerTotalMax()`, `tailLinesCut()`, `SEARCH_TOOL`; `READER_TOTAL_MAX` stays as the default value. Measured on the author's machine before the change: 16 projects, average 3,307 chars, maximum 10,942, four projects hit the old cap.
- Tests: row 15 (i), row 10 (o) expects 8,000; run-tests 278 → 279.

## 0.9.0 — 2026-11-10

- **Search.** `node search.mjs <text>` searches the history files of the projects under the root line by line: dated logs, `STATUS.md`, `sessions/*.md`, `cursor-import-*.md`, and `archive/*.md.gz` with `--archived`. Options `--project`, `--all`, `--since <YYYY-MM-DD|<n>d>`, `--regex`, `--limit`, `--json`; inside a project folder only that project is searched. No index, no database; output goes through the same masking as the stored files. Exit code 0 / 1 / 2 (hits / none / usage). The same file runs in the author's local hook set.
- Tests: row 15 (h), run-tests 277 → 278.

## 0.8.1 — 2026-11-10

- `추천` / `Suggested` items are now offered as a choice, not just mentioned: in the reply that writes them and after `[Status]` in the next session, the agent asks with AskUserQuestion when available (else a numbered list), one option per item plus a last option 「다른 할 일」 / "Something else", and starts nothing until the user picks. Instruction text only (ko/en); README updated; test row 15 (e) adjusted.

## 0.8.0 — 2026-11-10

Functionally the same as the author's local hook set again (only local configuration such as ALIASES differs). The plugin directory is no longer a constraint.

- **Project mention, link words.** One link word may sit between the folder name and the keyword: Korean `라는`·`이라는`·`란`·`이란` after the name (`ai-test 라는 프로젝트 시작하자`), English `called`·`named` after the keyword (`project called ai-test`). Word boundaries and the depth-2 rule are unchanged. Tests: row 15 (a)–(c).
- **STATUS block, optional `추천` / `Suggested` section.** A fifth heading after Progress: 0–3 lines on what would be good to do next given the context, written down only and never acted on. The template and the prompt instruction carry it; a block without it is still complete. On session start (and on a project mention) the agent is told to present those items in one line at the end of `[현황]` / `[Status]` and ask whether to proceed instead of starting them. Tests: row 15 (d)–(f).
- **Account tool restored** (`tracker-cred.mjs`, `items[].check`, `kind: "cmd"`; the 0.6.1 removal is reverted). It was removed only because the plugin directory flagged it; the directory listing is not pursued since 0.7.0, so the distributed copy carries it again. Test fixtures keep the neutral user name.
- README (en / ko): mention rule, STATUS sample and the Suggested paragraph.
- Tests: run-tests 266 → 277 (row 14 account tests back, row 15 new), agent 92, cursor 23.

## 0.7.0 — 2026-11-09

The plugin carries its hooks again and is distributed only through this repository's own marketplace.

- Restored `hooks/hooks.json` (the six `command` hooks of 0.6.2, unchanged). `/plugin install ai-history --marketplace omskykhal/ai-history` or `claude --plugin-dir` registers the hooks, the `/tracker-test` skill and the `tracker-verifier` agent, so a plugin install writes the history again. Do not combine it with `install.mjs --install` on the same machine (double logging).
- The Anthropic plugin directory listing is not pursued: after 0.6.3 (hooks removed) the directory also rejected the script files themselves ("scripts, programs, and files outside the allowed types only from Verified organizations"), which rules out the hook scripts and the installer. Apart from the hooks file, the version and the README, the code is the same as 0.6.3.
- README (en / ko): install section and the plugin section rewritten.
- Tests: unchanged, 266 + 92 + 23.

## 0.6.3 — 2026-11-08

The Anthropic plugin directory rejected 0.6.1 and 0.6.2 with "Hooks of type command accepted only from Verified organizations" (the security scan itself passed). The plugin therefore no longer carries hooks.

- Removed `hooks/hooks.json` (six `command` hooks, `SessionStart` … `SessionEnd`). A marketplace or `--plugin-dir` install now provides only the `/tracker-test` skill and the `tracker-verifier` agent and writes no history.
- The automatic history is unchanged and comes from the installer: `node install.mjs --install` (Claude Code), `--codex-hooks`, `--grok-hooks`, `--kimi-hooks`, Cursor as in 0.6.0. Hook scripts, `common.mjs`, i18n, tracker files and tests are unchanged; `CLAUDE_PLUGIN_DATA` / `AUTO_HISTORY_*` are still honored when set.
- README (en / ko): install section and the plugin section rewritten accordingly.
- Tests: unchanged, 266 + 92 + 23.

## 0.6.2 — 2026-11-06

A session started outside the root (for example Kimi Code opened in the home folder) that was given its project only as a full path wrote no history at all: paths are removed before the prompt is scanned for a project name, and the working directory was outside the root, so the session never got an anchor. The rule is the same for every agent.

- New path rule in `UserPromptSubmit`, used only when no project name or alias is found: an absolute path inside the root selects its project. The path of a project folder itself counts like its name (and can move the anchor); a path inside a project counts only while the session has no anchor yet, so a file path given for reference does not move the anchor.
- The project is the deepest folder with history that holds the path, else the folder equal to the path, else the depth-1 folder. So the path of a sub-folder without history goes to its parent project with history.
- With several paths in one prompt, the first one that is a project folder itself wins over an earlier path inside a project.
- Paths outside the root, in code fences, URLs and pasted blocks are ignored; only the first 400 characters are scanned and a path cut by that limit is dropped. A trailing comma or a Korean particle glued to the path is dropped. A folder name with spaces must be quoted.
- Name matching (`<folder> project`, aliases) is unchanged: a name that only appears inside a path is still not a match.
- Tests: `test/run-agent-tests.mjs` 75 → 92.

## 0.6.1 — 2026-11-05

Removes the account tool (`tracker-cred.mjs`) and the `items[].check` / `kind: "cmd"` contract added in 0.5.2. That tool read test-account passwords from a project file and sent them to the Firebase Auth REST API, which the plugin directory flags as credential forwarding (MCP_FORWARDS_CREDENTIAL_ENV) and which is a project-specific workflow rather than part of a shared history. Hooks, the installer, `hooks/hooks.json` and the history / STATUS / tracker files are unchanged.

- Removed `tracker-cred.mjs`, the "Account tool" lines and rules in the checklist, the tracker instruction's account sentence, the "Check command" card row and the related i18n keys (ko / en). `TRACKER.json` stays version 1; a `check` field on an item is no longer carried or classified.
- `agents/tracker-verifier.md` / `skills/tracker-test/SKILL.md`: back to http / ui items only.
- Tests: 266 cases (row 14 (ca)–(cd) removed); test fixtures no longer contain a real user name in paths.

## 0.6.0 — 2026-11-04

Grok, Kimi Code and Cursor now get the same history, STATUS block, one-time nudge, resume command and tracker files as Claude Code and Codex. `TRACKER.json` stays version 1. Hook events for Claude Code and Codex are unchanged.

- Grok: recognized from its input (it loads `~/.claude/settings.json` hooks without arguments). New `install.mjs --grok-hooks` adds the session start hook (`new|load`). Its text reaches the model after the first tool call, or through one `Stop` block when a turn used no tool. The extra `Stop` at session end is ignored, a reply clipped at 32,768 characters is read from the transcript, and resume keeps the launch folder.
- Kimi Code: new `install.mjs --kimi-hooks` adds six `[[hooks]]` to `~/.kimi-code/config.toml` (it stops if the file defines hooks in another form). The reply is read from the session's `wire.jsonl`, since `Stop` input has no text. Kimi does not call `Stop` again after a block, so the corrected reply is handled at the next prompt or session end. Nothing is demanded when the final reply cannot be read.
- Cursor: recognized from `cursor_version`. Text goes in at session start and after the first tool call. A missing block gets one automatic follow-up message; the `Stop` right after a follow-up never asks again, and background agents are left out. New `import-cursor.mjs` copies earlier conversations into the history folder.
- Tool names and input keys are normalized for logs and tracker change detection (`run_terminal_command`, `StrReplace`, `target_file`, `path`, relative paths).
- Conf file names per agent: `NO_BLOCK_GROK`, `NO_BLOCK_KIMI`, `NO_BLOCK_CURSOR` (same for `DUMP_INPUTS_`, `NESTED_MARKERS_`).
- `items[].ai.by` also accepts `grok`, `kimi`, `cursor`.
- Hook input with a BOM or in UTF-16 is decoded; unreadable input leaves one line (length and first char codes only) in `state/input-errors.log`.
- `hooks/hooks.json`: the `SessionStart` matcher also accepts `new|load`.
- Tests: `npm test` now also runs `test/run-agent-tests.mjs` (75) and `test/run-cursor-tests.mjs` (23).

## 0.5.2 — 2026-10-30

Account checks: agents (Claude, Codex) verify tracker items with real test accounts, so only 6-digit phone / email verification codes need the user. `TRACKER.json` stays version 1 (one optional item field). No new hook events; the installer and `hooks/hooks.json` are unchanged.

- New `tracker-cred.mjs` (an on-demand CLI, not a hook): `list` prints aliases and emails with secret-looking fields shown only as present / absent; `login <alias>` signs in through the Firebase Auth REST API and prints only the uid; `run <alias> [--with-token] -- <command>` runs a command with the account (and optionally an ID token) in environment variables and masks the password / token as `***` in its output. Accounts are declared per project in `<anchor>/.ai-history/accounts.json` (a path to the project's own git-ignored account file, or inline `accounts`, plus `firebaseApiKey` for login). It reads only that declaration and the file it names.
- `items[].check` (optional): an account tool command (`node "<…>tracker-cred.mjs" login|run|list …`). `tracker-md.mjs targets` reports such items as `kind: "cmd"` with the `check` string; any other command is not classified as cmd.
- Checklist: an "Account tool" line under the anchor (absolute path in the file, a placeholder name in the page tab), two rules on using the account tool and on 6-digit codes, and a "Check commands" section listing each item's check (tool path hidden in the page tab).
- Tracker instruction: account rule sentence, and a final `Account tool: node "<abs path>/tracker-cred.mjs"` line (Korean: `계정 도구:`).
- Tracker page: "Check command" row on cards that have one.
- `agents/tracker-verifier.md` / `skills/tracker-test/SKILL.md`: cmd items are run with the item's check string exactly as given (no `.harness.json` `live_check` needed); the verifier never reads account files directly.
- New i18n keys (ko / en) for the rules, checklist lines, page labels and the account tool's messages.
- Tests: 270 cases (+4, row 14 (ca)–(cd)); row 13 (d) leaves the "Account tool" line out of the file / tab comparison like the anchor line.

## 0.5.1 — 2026-10-29

- `tracker-md.mjs targets` now honors results in `tracker/CHECKLIST.md` that `Stop` has not merged yet (file hash differs from `mdHash` / `mdSeenHash`): those items get `pendingMd: true` and `uiLabelEligible: false`, and an unmerged `ok` removes the item from the targets. A broken results section is ignored with one stderr line. This stops `/tracker-test` from putting a UI label over a pending Codex verdict in the same turn.
- `skills/tracker-test/SKILL.md`: items with `pendingMd: true` never get a `-` result in the block (same rule as the verdict protection).
- Tests: 266 cases (+3, row 13 (ab)–(ad)).

## 0.5.0 — 2026-10-29

MD checklist, a second page tab, result pickup from Codex, and the `/tracker-test` verification loop. `TRACKER.json` stays version 1 (only optional fields added). No new hook events; the installer and `hooks/hooks.json` are unchanged.

- MD checklist: `Stop` writes `.ai-history/tracker/CHECKLIST.md` from the same `TRACKER.json` whenever it merges a block (new `tracker-md.mjs`). Same data → same bytes; the results section (`<!-- RESULTS:BEGIN/END -->`) is always generated empty.
- `.ai-history/tracker/.gitignore` (one line `*`) is written when missing.
- Result pickup: (1) a TRACKER block at the end of a Codex reply is stored with `ai.by: "codex"`; (2) results written into the checklist's results section are picked up at the next `Stop` (content hash `mdHash` / `mdSeenHash`, only existing ids, only `ai`); a broken section logs `[TRACKER] md parse error` once and keeps `tracker/CHECKLIST.edited-<time>.md`; (3) text pasted on the page is stored in the Artifact db `inbox/<ts>`, and the session-start db read now also covers `inbox` through `tracker-md.mjs parse --tracker` (existing ids' `ai` only) and marks documents with `processedAt`.
- `items[].ai.by` (optional, `claude` | `codex`). A block that differs only in `by` is not a change. Tracker rules now say to leave out `ai` for items you did not verify.
- Tracker page: tabs "Page" / "MD" (checklist text, Copy, item checks on the same `checks/<id>`, "Paste Codex results" → `inbox`), `(codex)` / `(claude)` next to the AI check.
- `/tracker-test`: new `agents/tracker-verifier.md` and `skills/tracker-test/SKILL.md`. One round per turn, foreground parallel sub-agents, one TRACKER block at the end, up to 3 rounds (`last-run.json`). HTTP checks run only the dev-harness `.harness.json` `live_check` command; without it HTTP items are reported as not checkable.
- `test/check-global-sync.mjs` (not part of `npm test`): sha1 comparison of the plugin's agent / skill with copies in `~/.claude`.
- New i18n keys (ko / en) for the checklist, log lines, the inbox wording and the page tabs. The TRACKER block example no longer carries `"ai":{"status":"-","note":""}`.
- The tracker instruction ends with `Tracker tool: node "<abs path>/tracker-md.mjs"` (Korean: `트래커 도구:`); the session-start db read gives absolute paths for `parse --tracker`.
- `.ai-history/tracker/CHECKLIST.md` results are merged before the turn's block, then `TRACKER.json` is written once and HTML / md are built once. If md results and a `{"url":…}` block arrive in the same `Stop`, `publishedHash` is the HTML from before the rebuild and `pending` stays on.
- Page JSON escapes U+2028 / U+2029. Log retention tolerates a marker mtime up to 1 s after "now" (fractional file-system ms).
- Tests: 263 cases (+37, row 13: checklist builder, result pickup paths, parser limits, inbox injection filter, template tabs, UI-label rule, English mode, skill / agent files).

## 0.4.1 — 2026-10-28

Plugin-directory review follow-up (automated scan notes "reads a credential from the user's environment" and "downloads code and runs it"). No feature change.

- Hooks no longer touch `process.env` as a whole: every hook builds its environment with the new `hookEnv()`, which copies only the fixed `ENV_KEYS` allow-list (`AUTO_HISTORY_*`, the `CLAUDE_*` session/plugin variables, `AI_AGENT`). Tokens, API keys and other tools' variables are never read.
- `DUMP_INPUTS` debug dumps record only that same fixed key list; the Codex dump no longer copies every `CODEX*` variable.
- `NESTED_MARKERS` lines (`NAME=value`) now accept only a plain identifier as `NAME`; the variable is compared with the value and nothing else is done with it.
- `install.mjs --config` builds its retention check from the allow-list instead of a copy of the whole environment.
- README (en/ko): the install section no longer shows a clone-then-run block; it says to get the files once (clone or release archive) and run the installer from the files already on disk. Nothing is downloaded at install time.
- Tests: 226 cases (+1, `hookEnv` allow-list).

## 0.4.0 — 2026-10-27

- Tracker page (user check page) per project: `.ai-history/TRACKER.json` (source of truth) and `.ai-history/tracker/index.html`, built by the new `tracker-build.mjs` from the new `tracker-template.html` (no external loads, light/dark, phone layout; labels and `<html lang>` follow `AUTO_HISTORY_LANG`).
- `PostToolUse` arms a per-session `.tracker` marker on edits under the anchor (outside `.ai-history`, `.git`, `node_modules`, `.omc`, `.claude`) and on build / deploy / create shell commands. `UserPromptSubmit` adds a TRACKER instruction after the STATUS instruction (format + wording rules; a one-line "how to turn it on" for older projects).
- `Stop` extracts the last `<!-- TRACKER:BEGIN/END -->` block, merges it (upsert by id, remove, auto areas, 300 items, 600 chars per field, 50 notes; a `no changes` note is not stored) and rebuilds the HTML (`pending`). One combined block per turn asks for a missing STATUS block, a missing TRACKER block and (Claude only) publishing the changed HTML as a claude.ai Artifact with `db` + `user`; a `{"url":…}` block stores the published url. The `[Turn-end]` summary leaves the TRACKER block out. Log lines: `[TRACKER] items +a ~b -c`, `published url saved`, `JSON error`, `off`, `block ignored (tracker inactive)`, `publish requested`, `block requested`.
- Reader: a tracker section (url, item / verdict counts, publish pending, last 3 notes; ≤1,200 chars) after `STATUS.md`. Session start / project mention ask Claude to read the page db (`checks`, `notes`) once when a url exists.
- Eligibility: global `TRACKER_OFF` conf file > `TRACKER.json` mode > history age (projects whose history starts before `TRACKER_SINCE`, default `2026-10-27`, stay off until a `{"mode":"on"}` block).
- No new hook events; the installer and `hooks/hooks.json` are unchanged.
- Tests: 225 cases (+22, row 12).

## 0.3.0 — 2026-10-26

- Resume command: the `STATUS.md` header (and the `sessions/` copy) gets a `Resume: claude --resume <id>` / `Resume: codex resume <id>` line after `Anchor` (`재개:` in Korean mode). The line is omitted for an unknown agent or a session id with spaces or quotes.
- New `SessionEnd` hook (`session-end.mjs`, 6 hooks in total): on `/exit`, `/clear` or logout it logs `[exit] session end(reason=<reason>) resume: <command>` and adds the `Resume` line to this session's `STATUS.md` / `sessions/` copy when it is missing (`[exit] STATUS resume line added`). It uses the anchor already recorded for the session (never picks a new one), only touches a header whose `Session` is this session, and prints nothing.
- Installer: `--install` and `--codex-hooks` register `SessionEnd` (timeout 5); re-running `--codex-hooks` on an existing file adds it and keeps other handlers. Plugin manifest `hooks/hooks.json` includes it.
- Tests: 203 cases (+11).

## 0.2.0 — 2026-10-12

- Log retention: daily logs older than 30 days are gzipped into `.ai-history/archive/`, `.gz` older than 365 days are deleted; runs once per 24h per project (SessionStart / anchor change), never touches today's or yesterday's log or `STATUS.md`. Configure with the `RETENTION` file (`keep` / `archive` / `sessions`), the matching `AUTO_HISTORY_*_DAYS` env vars, or `install.mjs --config --keep-days/--archive-days/--sessions-days`. `keep=0` turns rotation off.
- Several sessions in one folder: `Stop` also writes `.ai-history/sessions/<agent>-<id8>.md`; the Reader adds the other sessions' copies from the last 48h (newest 2, 1,000 chars each) after `STATUS.md`, tagging the resumed session's own copy `(this session)`. Copies older than 7 days are pruned. `STATUS.md` format unchanged. Reader cap 8,000 → 10,000 chars.
- `[retention] …` log line (only when something was moved or deleted), `install.mjs --status` shows the retention policy.
- Tests: child processes spawned by `test/run-tests.mjs` now receive a minimal allow-listed environment (PATH, temp, home) instead of a copy of the parent environment, so no token or API key from the tester's machine can reach a hook or the installer. The hooks themselves never read credentials: the only environment variables they use are `AUTO_HISTORY_*`, `CLAUDE_*` and `CODEX_*` settings. (Addresses the plugin-directory scan note MCP_FORWARDS_CREDENTIAL_ENV.)
- Tests: 192 cases (+22). Review fixes: `archive` must exceed `keep` (installer rejects, hook raises it), a `.gz` is deleted only after existing `archive − keep` days, clashing archive names go to `<name>.dup-<ts>.gz`, 800 ms time budget per run (no marker when interrupted), marker mtime in the future is ignored.

## 0.1.0 — 2026-10-10

First public packaging of the hooks that ran privately as "auto-history" (2026-10-08 → 10-10).

- Five hooks for Claude Code and Codex (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`), one shared `.ai-history/` per project with per-line agent attribution.
- Anchor rules: alias / `<name> project` mention → changed working directory → session state → adopt cwd. Root boundary only.
- STATUS block extraction with a single safe nudge; OMC-compatible safety exceptions.
- Generalized for distribution: `ROOT`/`LANG` conf files, `en`/`ko` wording, English `project`/`folder` keywords, installer modes `--config`, `--status`, `--git-ignore`, Codex `hooks.json` merge (other handlers kept), POSIX path branch (untested).
- Claude Code plugin manifest (`.claude-plugin/plugin.json`, `hooks/hooks.json`), experimental.
- Tests: 170 cases, artifacts in the OS temp dir.
