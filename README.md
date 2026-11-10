# ai-history

**One shared, human-readable work history for Claude Code, OpenAI Codex, Grok, Kimi and Cursor, per project, written automatically by hooks.**

[한국어 README](README.ko.md)

[![Release](https://img.shields.io/github/v/release/omskykhal/ai-history?label=release)](https://github.com/omskykhal/ai-history/releases/latest) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Platforms](https://img.shields.io/badge/tested-Windows%20%7C%20Linux-informational) ![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Grok%20%7C%20Kimi%20%7C%20Cursor-lightgrey)

Install in Claude Code (one line; the installer script covers the other agents, see [Install](#install)):

```
/plugin install ai-history --marketplace omskykhal/ai-history
```

Close the laptop mid-task, come back tomorrow, open Claude Code, Codex, Grok, Kimi or Cursor from any folder, say the project's name, and the agent starts with a `[Status]` report of what was being done, how far it got, what is next, and **which agent did it last**.

- Every tool call is appended to `<project>/.ai-history/YYYY-MM-DD.md` as one line: `- HH:mm:ss [session][claude|codex|grok|kimi|cursor] ▶ [Bash] npm test`.
- At the end of each reply the agent writes a short status block; a hook saves it to `<project>/.ai-history/STATUS.md` (Working on / Done / Next / Progress, optionally Suggested).
- On session start, and whenever you mention a project by name, the hook injects `STATUS.md` plus the tail of today's and yesterday's log.
- All of these agents read and write the **same files**, so you can switch between them and keep one timeline.
- No LLM calls, no database, no cloud. Plain Markdown in the project folder, written by small Node scripts.

## Requirements

| Item | Requirement |
|---|---|
| Node.js | 18 or newer (`node --version`) |
| Claude Code | hooks support (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`) |
| OpenAI Codex CLI | 0.160 or newer with `hooks` enabled (`codex features list` → `hooks stable true`), optional |
| Grok, Kimi Code, Cursor | Tested with Grok 1.0.70, Kimi Code 2.3.3 and Cursor 3.20.21, optional. See [Other agents](#other-agents-grok-kimi-cursor-060) |
| OS | **Windows** and **Linux** (tested: plugin install and update via `claude plugin update`, the six hooks, a `claude -p` e2e run and all three test suites, on 0.11.0, 2026-11-10). macOS: path handling is implemented but **untested** |

## Install

**Claude Code plugin (one line, Claude Code 2.1.275+)** — installs the six hooks, the `/tracker-test` skill and the `tracker-verifier` agent from this repository's own marketplace. The plugin is not listed in the Anthropic plugin directory (it accepts hooks of type `command` and script files only from verified organizations), so the `--marketplace omskykhal/ai-history` part is required. In plugin mode set `AUTO_HISTORY_ROOT` (and optionally `AUTO_HISTORY_LANG`) as environment variables; see [Claude Code plugin](#claude-code-plugin).

```
/plugin install ai-history --marketplace omskykhal/ai-history
```

**Installer script (Claude Code without the plugin, plus Codex, Grok and Kimi)**

Get the files once: clone this repository (or download a release archive from the GitHub Releases page and unpack it) and open a terminal in that folder. Everything below runs from the files you now have on disk; nothing is fetched at install time.

```bash
# 1) point it at the folder that holds all your projects, choose the language of the injected instructions
node install.mjs --install --root "C:\Users\me\Projects" --lang en
# 2) optional: register the same hooks for Codex (first Codex start asks you to trust 5 handlers)
node install.mjs --codex-hooks
# optional: Kimi Code (adds 6 [[hooks]] to ~/.kimi-code/config.toml) and Grok (session start hook)
node install.mjs --kimi-hooks
node install.mjs --grok-hooks
# 3) optional: keep .ai-history/ out of every git repo via git's global excludes file
node install.mjs --git-ignore
# check
node install.mjs --status
```

What the installer touches:

- `~/.claude/settings.json` → adds 5 entries under `hooks` (a backup `settings.json.bak.ai-history.<time>` is written first; every other key is verified unchanged, otherwise the backup is restored).
- `~/.codex/hooks.json` → merged, other handlers are kept (backup written). `config.toml` is not modified.
- `ROOT` and `LANG` files next to the scripts.
- git global excludes file (`core.excludesFile` if set, else `~/.config/git/ignore`) → one line `.ai-history/`.

Uninstall:

```bash
node install.mjs --uninstall           # Claude Code entries only
node install.mjs --codex-hooks-remove  # Codex entries only
node install.mjs --kimi-hooks-remove   # Kimi entries only
node install.mjs --grok-hooks-remove   # Grok file only
```

Project folders keep their `.ai-history/` folders; delete them yourself if you no longer want them.

## How it works

### Where the history is written (the "anchor")

Only folders **inside your root** (`--root`) get a `.ai-history/`. Nothing is ever written in your home folder or a temp folder. For each session the anchor is decided in this order:

A symlink (or Windows junction) under the root that points at a directory counts as a project folder too (0.11.2); the session cwd and the name mention both use the link path.

1. A project named in your prompt: an alias from `ALIASES`, or `<folder name> project` / `project <folder name>` (`folder` also works for depth-1 folders); `project called <name>` / `folder named <name>` work too, and in Korean one of `라는`·`이라는`·`란`·`이란` may sit between the name and the keyword. The folder must be at depth 1 or 2 under the root. When no name is found, an absolute path in the prompt is used instead: the path of a project folder itself counts like its name (`C:\Projects\MyApp is the project folder, fix …`), and a path inside a project counts only while the session has no anchor yet. Quote a path whose folder name has spaces.
2. The working directory, when it really changed since the last prompt and is inside the root (a sub-folder of the current anchor keeps the anchor).
3. The anchor already recorded for this session.
4. No anchor yet and the working directory is inside the root → adopt it.

So the usual way of working is: open a terminal **anywhere**, start `claude` or `codex`, and say *"MyApp project, what did we do last time? Continue."* The hook finds `MyApp`, injects its history, and keeps writing there until you name another project.

### The STATUS block

After any reply in which the agent used a tool, it is instructed to end with:

```
<!-- STATUS:BEGIN -->
## Working on
- ...
## Done
- ...
## Next
- ...
## Progress
- ...
## Suggested
- ...
<!-- STATUS:END -->
```

`Suggested` holds 1-3 lines on what would be good to do next given the context (the nearest next step if nothing stands out). If the per-turn question gets in the way of short repetitive work, set `SUGGEST_ASK` to `start` (ask only at session start) or `off` (never ask); the lines are still written. The agent writes it down and does not act on anything it was not asked to do. In the reply that writes them and after `[Status]` in the next session, the agent asks about those items as a choice (AskUserQuestion when available, else a numbered list): one option per item plus a last option "Something else". Nothing starts until the user picks. A block without this section still counts as complete.

The `Stop` hook extracts it and writes `STATUS.md` with a header (`Session`, `Author: <agent> (<id>)`, `Updated`, `Anchor`, `Resume: claude --resume <id>` or `Resume: codex resume <id>`). When the session ends (`/exit`, `/clear`, logout), the `SessionEnd` hook first logs the Working on / Next bullets of that session's STATUS as `[exit] Working on: …` lines (up to 2 each), then `[exit] session end(reason=prompt_input_exit) resume: claude --resume <id>`, and adds the `Resume` line to this session's `STATUS.md` / `sessions/` copy if it is missing, so the command to continue the session stays in the history. If the block is missing, the hook asks **once** for it (`decision: block`), never when the stop was caused by a context limit, an interruption, an auth error, a scheduled wake-up, or when context is ≥95% full. Disable the nudge with a `NO_BLOCK` file (Claude) / `NO_BLOCK_CODEX` file (Codex) in the conf dir, or `AUTO_HISTORY_NO_BLOCK=1`.

### What is logged

| Line | Content |
|---|---|
| `[User] …` | first 120 chars of your prompt |
| `▶ [Tool] …` / `✓ [Tool] … (1.2s)` | tool name and a short target (command, file path, pattern, agent description). **Tool output is never logged.** |
| `[Turn-end] …` | first 300 chars of the reply, or `STATUS updated` |
| `[anchor] set/changed …` | anchor changes |
| `[exit] session end(reason=…) resume: …` | session end and the command that resumes it |
| `[retention] archived N · gz deleted N · session copies deleted N` | written only when a retention run actually moved or deleted something |

API-key-looking strings (`AIza…`, `sk-…`, `ghp_…`, `Bearer …`, `password=…`) are masked before writing.

### Several sessions in one folder

`STATUS.md` always holds the block of the session that finished last. In addition every session's block is kept in `.ai-history/sessions/<agent>-<id8>.md`. When a session starts (or a project is named in a prompt), the Reader injects `STATUS.md` **plus** the other sessions' copies updated in the last 48 hours (newest 2, 1,000 chars each). A copy belonging to the session being resumed is tagged `(this session)`, so a resumed session gets its own state back even if another session overwrote `STATUS.md`. Session copies older than 7 days are removed by the retention run.

### Log retention

Daily logs are kept as plain `YYYY-MM-DD.md` for 30 days. Older files are gzipped into `.ai-history/archive/YYYY-MM-DD.md.gz` (the original is deleted only after a gunzip round-trip matches) and `.gz` files are deleted once the log date is more than 365 days old **and** the `.gz` itself has existed for at least `archive − keep` days (so nothing is deleted right after being archived; `archive` must be greater than `keep`, or 0). The run happens once per 24 hours per project, at session start or when the anchor changes, and never touches today's or yesterday's log or `STATUS.md`. Change the numbers with the `RETENTION` file or `node install.mjs --config --keep-days 60 --archive-days 0`; `keep=0` turns the whole log rotation off.

### Search (0.9.0)

`node search.mjs <text>` scans the `.ai-history/` folders of the projects under the root line by line (no index, no database, no network): dated logs, `STATUS.md`, `sessions/*.md` and `cursor-import-*.md`, plus `archive/*.md.gz` with `--archived`. Run inside a project folder to search only that project; outside, every project (`--all` forces that); `--project <name>` picks one. `--since 7d` (or `YYYY-MM-DD`) limits the dated logs, `--regex` switches to a regular expression, and `--limit` (default 200) and `--json` are available. Exit code 0 = hits, 1 = none, 2 = usage error. From a plugin install call `node "<plugin folder>/search.mjs" …`. Output lines go through the same masking as the stored files.

### Injection size (0.10.0)

What is injected at session start or on a project mention is an index: `STATUS.md` (up to 4,000 chars) + the tracker summary + other sessions' STATUS + the last **15** lines of today's log + the last **5** of yesterday's (log lines cut at 200 chars), 8,000 chars in total. A "More history" section at the end names the `search.mjs` command and the dated log path, and the instruction says the tails are partial. Change the sizes with the conf file `INJECT` (one per line: `today=15`, `yday=5`, `line=200`, `total=8000`, `status=4000`) or the env var `AUTO_HISTORY_INJECT` (`today=15,yday=5,…`, which wins over the file). Up to 0.9.x this was 40/20 lines and 10,000 chars.

### Tracker page

A per-project checklist page for the things **you** should check by hand (one card per feature: account, menu path, what to do, what "OK" looks like, the AI's own check, and your verdict buttons OK / Problem / Unchecked plus a note).

- **What**: `.ai-history/TRACKER.json` is the source of truth; `.ai-history/tracker/index.html` is built from `tracker-template.html` (no external scripts or fonts, light/dark, phone layout). Page labels follow `AUTO_HISTORY_LANG` (`en` / `ko`).
- **When**: if a turn created or edited files under the project (or ran a build / deploy / create command), the agent is asked to end its reply with a TRACKER block right before the STATUS block. The `Stop` hook merges it (upsert by `id`, `remove`, auto areas, limits: 300 items, 600 chars per field) and rebuilds the HTML. If the block is missing it asks once (combined with the STATUS nudge, one block per turn).
- **Publishing** (Claude Code only): when the HTML changed, Claude is asked once to publish it as a private claude.ai Artifact with the `db` and `user` capabilities and to reply with `{"url":"https://claude.ai/artifact/<id>"}`, which is stored. Your verdicts and notes on the page are stored in the Artifact's shared db (`checks/<id>`, `notes`); without it they stay in that browser only. At the next session start Claude is asked to read them once and report them in `[Status]`. Codex merges blocks and builds the HTML but is never asked to publish.
- **Which projects (off by default since 0.11.0)**: every project stays off until you ask ("turn the tracker on") and the agent outputs the `{"mode":"on"}` block. While off, a one-line "tracker is off, ask to turn it on" hint is injected once per session. A `TRACKER_ON` file in the conf dir restores the 0.10 rule (on for projects whose history starts on or after `2026-10-27`, or that have no history yet). `{"mode":"off"}` turns it off for one project. Projects that already have a `TRACKER.json` follow that file's mode, so nothing changes for them.
- **Turning it on, by example**: when you say `turn the tracker on`, the agent ends that reply with the three lines below, right before the STATUS block. The `Stop` hook creates `TRACKER.json`, and from the next turn on a TRACKER block is requested whenever files were changed or built.

  ```
  <!-- TRACKER:BEGIN -->
  {"mode":"on"}
  <!-- TRACKER:END -->
  ```

  To turn it off: `turn the tracker off` → the same block with `{"mode":"off"}`. The other agents (Codex, Grok, Kimi, Cursor) use the same block.
- **Turn off / tune**: a `TRACKER_OFF` file in the conf dir turns it off everywhere (blocks are ignored, nothing is injected). `node install.mjs --config --tracker on|off|default` writes and removes the `TRACKER_ON` / `TRACKER_OFF` files. A `TRACKER_SINCE` file (first `YYYY-MM-DD` line) is the cut-off date used with `TRACKER_ON`.

Block format (every key optional; `{"items":[]}` = no change):

```
<!-- TRACKER:BEGIN -->
{"project":"one-line description","areas":[{"id":"A","title":"Sign-in"}],
 "items":[{"id":"A-1","area":"A","title":"Email sign-in","account":"test@example.com / Pass1234!",
   "path":"Top bar 'Sign in'","todo":"Press 'Sign in'","expect":"Dashboard opens","ai":{"status":"ok|fail|-","note":"evidence"}}],
 "remove":[],"note":""}
<!-- TRACKER:END -->
```

Note: `TRACKER.json` is not masked, because accounts are meant to be written inline. Use test accounts only. Log lines (`[TRACKER] …`) are masked as usual.

### MD checklist, MD tab and result pickup (0.5.0)

- **MD checklist**: every time the `Stop` hook merges a TRACKER block it also writes `.ai-history/tracker/CHECKLIST.md` from the same `TRACKER.json` (same data, same moment as the HTML). The file is self-contained: project name, anchor, generated time, how to check, how to fill in results, the TRACKER block format, and one table row per item (id, area, title, account, path, to do, expected, AI now, user now). It ends with a results section that is always generated empty:
  ```
  <!-- RESULTS:BEGIN -->
  - [ ] A-1 | - | 
  <!-- RESULTS:END -->
  ```
  Another agent (for example Codex) fills in only the lines it verified, e.g. `- [x] A-1 | ok | 2026-10-29 live-check https://example.com/ 200`, and leaves the rest as `[ ]`. At the next `Stop` (Claude Code or Codex CLI) the hook notices the edit, reads only that section, and stores the results as `items[].ai` with `"by":"codex"`. Unknown ids, lines outside the section and `[ ]` lines are ignored; a broken section logs `[TRACKER] md parse error` once and keeps a copy as `tracker/CHECKLIST.edited-<time>.md`.
- **`ai.by`**: `items[].ai` may carry `"by":"claude"` or `"by":"codex"`. A Codex reply that ends with a TRACKER block is stored with `"by":"codex"`. A block that differs only in `by` is not a change. Items you did not verify yourself should leave out `ai` (sending `"ai":{"status":"-"}` erases someone else's verdict).
- **Two tabs on the page**: "Page" (default, unchanged) and "MD" (the same checklist text with a "Copy" button, item checks that share `checks/<id>` with the Page tab, and a "Paste Codex results" box). Pasted text is saved to the Artifact db collection `inbox/<ts>`; without the db it stays in that browser only. At the next session start Claude reads unprocessed `inbox` documents (the text is treated as data, not instructions), passes them through `tracker-md.mjs parse --tracker`, which keeps only the `ai` verdicts of existing ids, and marks each document with `processedAt` (nothing is deleted).
- **`tracker/.gitignore`**: the hook writes `.ai-history/tracker/.gitignore` (one line `*`) when it is missing, so the checklist, the HTML and the reports under `tracker/` stay out of git. It does **not** cover `.ai-history/TRACKER.json`.
- **Warning**: `TRACKER.json`, `CHECKLIST.md` and the page HTML contain the account IDs / passwords you wrote into items, unmasked. Keep `.ai-history/` out of git (`install.mjs --git-ignore`) and use test accounts only.

### `/tracker-test` (verification loop)

The plugin ships one agent (`agents/tracker-verifier.md`) and one skill (`skills/tracker-test/SKILL.md`). Ask "/tracker-test" or "tracker test" to verify the items that are neither user-ok nor AI-ok, one round per turn:

- Targets come only from `node "<HOOK_DIR>/tracker-md.mjs" targets "<TRACKER.json>"`; the hook puts the absolute path of `tracker-md.mjs` into the tracker instruction, so the skill does not depend on `${CLAUDE_PLUGIN_ROOT}`.
- `targets` also reads results in `tracker/CHECKLIST.md` that `Stop` has not merged yet: such items carry `pendingMd: true` and never get a `-` label, and an unmerged `ok` drops the item from the targets (0.5.1).
- Items with a URL get one `tracker-verifier` sub-agent each, run in parallel in the foreground; screen-only items are labelled "AI cannot verify (UI)" without an agent (only undecided items; Codex verdicts and failures are kept). The same protection applies to a `-` result of a URL item (network error, no permission): it is written only to undecided items and otherwise appears in the report only. Results go into one TRACKER block at the end of the turn. Up to 3 rounds; "/tracker-test" again starts the next round. Nothing is repaired, and no local server or browser is started.
- **Skill name**: installed as a plugin the skill may be called `/ai-history:tracker-test` instead of `/tracker-test` (not verified). Both names are listed here; use whichever your Claude Code shows.
- **HTTP checks need dev-harness**: the agent runs only the `live_check` command from the project's `.harness.json` (the dev-harness format, e.g. `"live_check": "node <path>/live-check.mjs https://example.com/"`). **Without a `.harness.json` `live_check`, HTTP verification is not possible** and URL items are reported as "no HTTP check available".
- **Sub-agent Bash permission**: the agent needs Bash to run that one `node … live-check.mjs …` command. Depending on your permission settings Claude Code may ask, or refuse; a refused item is reported as `-` "no permission". To avoid the prompt, allow that exact command in your settings, for example `"Bash(node <path>/live-check.mjs *)"`.

### Non-interactive runs

`claude -p` / SDK runs (`CLAUDE_CODE_ENTRYPOINT` not in `INTERACTIVE_ENTRYPOINTS`), sub-agents, and a Codex, Grok or Kimi started *inside* a Claude Code session only get the machine log. No injection, no nudge.

## Configuration

All files live next to the scripts (or in `AUTO_HISTORY_CONF_DIR`). Missing file = default.

| File / env | Meaning |
|---|---|
| `ROOT` / `AUTO_HISTORY_ROOT` | boundary folder (default `~/Projects`) |
| `LANG` / `AUTO_HISTORY_LANG` | `en` (default) or `ko`: language of injected instructions, STATUS headings and header |
| `SUGGEST_ASK` / `AUTO_HISTORY_SUGGEST_ASK` | how often the agent asks about Suggested items: `always` (default: a choice in every reply that writes them), `start` (only at session start / project mention), `off` (write only). The section itself is always written |
| `INJECT` / `AUTO_HISTORY_INJECT` | injection sizes: `today=15`, `yday=5` (lines), `line=200`, `total=8000`, `status=4000` (chars). One per line in the file, comma-separated in the env var |
| `RETENTION` / `AUTO_HISTORY_KEEP_DAYS`, `AUTO_HISTORY_ARCHIVE_DAYS`, `AUTO_HISTORY_SESSIONS_DAYS` | lines `keep=30`, `archive=365`, `sessions=7` (days). `keep=0` disables log rotation, `archive=0` keeps `.gz` forever, `sessions=0` keeps session copies |
| `ALIASES` | `phrase1\|phrase2 => relative\path\under\root`, one target per line. See `ALIASES.example` |
| `INTERACTIVE_ENTRYPOINTS` | Claude entrypoints treated as interactive (`cli`) |
| `NO_BLOCK`, `NO_BLOCK_CODEX` | presence disables the one-time nudge |
| `NESTED_MARKERS`, `NESTED_MARKERS_CODEX` | `ENV=value` lines; a match means "nested run" → log only |
| `DUMP_INPUTS`, `DUMP_INPUTS_CODEX` | presence dumps masked hook inputs to `dumps/` (debugging) |
| `TRACKER_OFF` | presence turns the tracker page off for every project |
| `TRACKER_ON` | presence turns the tracker on automatically for new projects (the 0.10 rule). Without it the default is off; ask per project ("turn the tracker on") |
| `TRACKER_SINCE` | with `TRACKER_ON`, first `YYYY-MM-DD` line: projects whose history starts earlier keep the tracker off until asked (default `2026-10-27`) |
| `AUTO_HISTORY_DIRNAME` | history folder name (default `.ai-history`) |
| `AUTO_HISTORY_DISABLE=1` | turn everything off for that process (e.g. a daemon) |
| `AUTO_HISTORY_STATE_DIR` | per-session state files (default `state/` in the conf dir) |

Aliases are matched on word boundaries, case-insensitively, longest phrase first; separators may be space, dot or hyphen (`tauko work` = `tauko-work` = `tauko.work`). Text inside code fences, URLs, file paths and pasted blocks is ignored, and only the first 400 characters of the prompt are scanned. A project name that merely appears inside a path is not a name match; the path itself is handled by the path rule above (inside the root only; paths in code fences, URLs and pasted blocks are ignored there too).

## Other agents: Grok, Kimi, Cursor (0.6.0)

The history files, the STATUS block, the one-time nudge, the resume command and the tracker files work the same. Each tool only lets a hook reach the model at certain points, so the timing differs:

| | Grok | Kimi Code | Cursor |
|---|---|---|---|
| Registered by | `--install` (Grok reads `~/.claude/settings.json`) + `--grok-hooks` | `--kimi-hooks` | `--install` (Cursor reads `~/.claude/settings.json`) |
| Earlier history and `[Status]` | after the first tool call, or after the first reply if no tool ran | with the first prompt | at session start |
| Resume command | `grok --resume <id>` | `kimi -S session_<id>` | none |
| Missing STATUS block | asked once in the same turn | asked once; the corrected reply is saved at the next prompt or session end | one automatic follow-up message (uses your quota) |

- Grok runs your hooks only in folders you trust (`/hooks-trust`). Its sub-agent sessions have their own ids and are not logged.
- Publishing the tracker page and reading verdicts from it stay Claude-only because they need the Artifact tool. Other agents still write `TRACKER.json`, the HTML and `CHECKLIST.md`.
- To turn off the nudge per agent, create `NO_BLOCK_GROK`, `NO_BLOCK_KIMI` or `NO_BLOCK_CURSOR` in the conf folder.
- `node import-cursor.mjs <project folder>` copies earlier Cursor conversations into `.ai-history/cursor-import-<id8>.md`.

Status: logging, agent labels and input fields were checked with one real `grok -p` and `kimi -p` run on Windows, and Cursor logging in one real project. Whether the model acts on the injected text in a stand-alone interactive Grok or Kimi session, and Cursor's follow-up message, have not been observed yet.

## Claude Code plugin

The repo carries `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `hooks/hooks.json`, so `/plugin install ai-history --marketplace omskykhal/ai-history` (or `claude --plugin-dir ./ai-history`) installs the six hooks (`SessionStart` … `SessionEnd`), the `/tracker-test` skill and the `tracker-verifier` agent. In plugin mode the conf dir is `CLAUDE_PLUGIN_DATA`, so set `AUTO_HISTORY_ROOT` (and optionally `AUTO_HISTORY_LANG`) as environment variables instead of the `ROOT`/`LANG` files. Codex, Grok and Kimi still need `install.mjs --codex-hooks` / `--grok-hooks` / `--kimi-hooks` from a clone. Do not combine the plugin with `install.mjs --install` on the same machine: both sets of hooks would run and every log line would be written twice. The skill uses the `tracker-md.mjs` path that the hook puts into the tracker instruction, so it does not depend on `${CLAUDE_PLUGIN_ROOT}`.

Distribution: this repository is its own marketplace. 0.6.3 had removed the hooks to meet the Anthropic plugin directory policy (hooks of type `command` only from verified organizations); the directory then also rejected the script files themselves, so 0.7.0 restores the hooks and the directory listing is not pursued. Hooks loaded through the plugin were verified once on Windows with `claude --plugin-dir` (2026-10-12); the marketplace install uses the same loading path but was not tested separately.

## Tests

```bash
node test/run-tests.mjs <scratch-dir>
node test/run-agent-tests.mjs
node test/run-cursor-tests.mjs
```

266 + 92 + 23 cases (hook behaviour, anchor rules, alias/folder matching, STATUS extraction, safety exceptions, installer round-trips, English mode, log retention, multi-session STATUS, resume command, tracker page, MD checklist / result pickup / tracker-test rules). Test artifacts go to the OS temp dir, never into a real project.

If you keep global copies of the agent and skill (`~/.claude/agents/tracker-verifier.md`, `~/.claude/skills/tracker-test/SKILL.md`), `node test/check-global-sync.mjs` compares them with this repo (sha1 after removing a BOM and turning CRLF into LF): `SYNC OK 2/2`, "not copied" (exit 0) or "mismatch" (exit 1). It is not part of `npm test`.

## Known limits

- Tested platforms: Windows and Linux (plugin install and update, hook behaviour, e2e, all three test suites, on 0.11.0, 2026-11-10). macOS is untested.
- Headless `claude -p` writes tool logs only; injection and the STATUS nudge are for interactive sessions. Without `AUTO_HISTORY_ROOT`, nothing happens on a machine where the default `~/Projects` does not exist.
- Two agents writing the same project at the same time interleave in the log; `STATUS.md` is last-writer-wins (each session's own block survives in `sessions/`, see above).
- `grok -p` run outside Claude Code counts as interactive, because no signal to tell it apart was found.
- Codex `decision: block` on `Stop` has not been observed in practice (Codex followed the instruction every time during testing).

## Author / License

Yang <omskykhal@gmail.com> · MIT (see `LICENSE`).
