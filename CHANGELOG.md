# Changelog

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
