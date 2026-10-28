# ai-history

**One shared, human-readable work history for Claude Code and OpenAI Codex, per project, written automatically by hooks.**

[한국어 README](README.ko.md)

Close the laptop mid-task, come back tomorrow, open Claude Code *or* Codex from any folder, say the project's name, and the agent starts with a `[Status]` report of what was being done, how far it got, what is next, and **which agent did it last**.

- Every tool call is appended to `<project>/.ai-history/YYYY-MM-DD.md` as one line: `- HH:mm:ss [session][claude|codex] ▶ [Bash] npm test`.
- At the end of each reply the agent writes a short status block; a hook saves it to `<project>/.ai-history/STATUS.md` (Working on / Done / Next / Progress).
- On session start, and whenever you mention a project by name, the hook injects `STATUS.md` plus the tail of today's and yesterday's log.
- Claude Code and Codex read and write the **same files**, so you can switch between them and keep one timeline.
- No LLM calls, no database, no cloud. Plain Markdown in the project folder, written by small Node scripts.

## Requirements

| Item | Requirement |
|---|---|
| Node.js | 18 or newer (`node --version`) |
| Claude Code | hooks support (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`) |
| OpenAI Codex CLI | 0.160 or newer with `hooks` enabled (`codex features list` → `hooks stable true`), optional |
| OS | **Windows** (tested). macOS/Linux: path handling is implemented but **untested** |

## Install

**Claude Code plugin (one line, Claude Code 2.1.275+)** — Claude Code side only; plugin mode is experimental, see below:

```
/plugin install ai-history --marketplace omskykhal/ai-history
```

**Installer script (recommended, covers Claude Code and Codex)**

Get the files once: clone this repository (or download a release archive from the GitHub Releases page and unpack it) and open a terminal in that folder. Everything below runs from the files you now have on disk; nothing is fetched at install time.

```bash
# 1) point it at the folder that holds all your projects, choose the language of the injected instructions
node install.mjs --install --root "C:\Users\me\Projects" --lang en
# 2) optional: register the same hooks for Codex (first Codex start asks you to trust 5 handlers)
node install.mjs --codex-hooks
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
```

Project folders keep their `.ai-history/` folders; delete them yourself if you no longer want them.

## How it works

### Where the history is written (the "anchor")

Only folders **inside your root** (`--root`) get a `.ai-history/`. Nothing is ever written in your home folder or a temp folder. For each session the anchor is decided in this order:

1. A project named in your prompt: an alias from `ALIASES`, or `<folder name> project` / `project <folder name>` (`folder` also works for depth-1 folders). The folder must be at depth 1 or 2 under the root.
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
<!-- STATUS:END -->
```

The `Stop` hook extracts it and writes `STATUS.md` with a header (`Session`, `Author: <agent> (<id>)`, `Updated`, `Anchor`, `Resume: claude --resume <id>` or `Resume: codex resume <id>`). When the session ends (`/exit`, `/clear`, logout), the `SessionEnd` hook logs `[exit] session end(reason=prompt_input_exit) resume: claude --resume <id>` and adds the `Resume` line to this session's `STATUS.md` / `sessions/` copy if it is missing, so the command to continue the session stays in the history. If the block is missing, the hook asks **once** for it (`decision: block`), never when the stop was caused by a context limit, an interruption, an auth error, a scheduled wake-up, or when context is ≥95% full. Disable the nudge with a `NO_BLOCK` file (Claude) / `NO_BLOCK_CODEX` file (Codex) in the conf dir, or `AUTO_HISTORY_NO_BLOCK=1`.

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

### Tracker page

A per-project checklist page for the things **you** should check by hand (one card per feature: account, menu path, what to do, what "OK" looks like, the AI's own check, and your verdict buttons OK / Problem / Unchecked plus a note).

- **What**: `.ai-history/TRACKER.json` is the source of truth; `.ai-history/tracker/index.html` is built from `tracker-template.html` (no external scripts or fonts, light/dark, phone layout). Page labels follow `AUTO_HISTORY_LANG` (`en` / `ko`).
- **When**: if a turn created or edited files under the project (or ran a build / deploy / create command), the agent is asked to end its reply with a TRACKER block right before the STATUS block. The `Stop` hook merges it (upsert by `id`, `remove`, auto areas, limits: 300 items, 600 chars per field) and rebuilds the HTML. If the block is missing it asks once (combined with the STATUS nudge, one block per turn).
- **Publishing** (Claude Code only): when the HTML changed, Claude is asked once to publish it as a private claude.ai Artifact with the `db` and `user` capabilities and to reply with `{"url":"https://claude.ai/artifact/<id>"}`, which is stored. Your verdicts and notes on the page are stored in the Artifact's shared db (`checks/<id>`, `notes`); without it they stay in that browser only. At the next session start Claude is asked to read them once and report them in `[Status]`. Codex merges blocks and builds the HTML but is never asked to publish.
- **Which projects**: on for projects whose history starts on or after `2026-10-27` (or that have no history yet); older projects stay off until you ask to turn it on (`{"mode":"on"}`). `{"mode":"off"}` turns it off for one project.
- **Turn off / tune**: a `TRACKER_OFF` file in the conf dir turns it off everywhere (blocks are ignored, nothing is injected). A `TRACKER_SINCE` file (first `YYYY-MM-DD` line) moves the cut-off date.

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

### Non-interactive runs

`claude -p` / SDK runs (`CLAUDE_CODE_ENTRYPOINT` not in `INTERACTIVE_ENTRYPOINTS`), sub-agents, and a Codex started *inside* a Claude Code session only get the machine log. No injection, no nudge.

## Configuration

All files live next to the scripts (or in `AUTO_HISTORY_CONF_DIR`). Missing file = default.

| File / env | Meaning |
|---|---|
| `ROOT` / `AUTO_HISTORY_ROOT` | boundary folder (default `~/Projects`) |
| `LANG` / `AUTO_HISTORY_LANG` | `en` (default) or `ko`: language of injected instructions, STATUS headings and header |
| `RETENTION` / `AUTO_HISTORY_KEEP_DAYS`, `AUTO_HISTORY_ARCHIVE_DAYS`, `AUTO_HISTORY_SESSIONS_DAYS` | lines `keep=30`, `archive=365`, `sessions=7` (days). `keep=0` disables log rotation, `archive=0` keeps `.gz` forever, `sessions=0` keeps session copies |
| `ALIASES` | `phrase1\|phrase2 => relative\path\under\root`, one target per line. See `ALIASES.example` |
| `INTERACTIVE_ENTRYPOINTS` | Claude entrypoints treated as interactive (`cli`) |
| `NO_BLOCK`, `NO_BLOCK_CODEX` | presence disables the one-time nudge |
| `NESTED_MARKERS`, `NESTED_MARKERS_CODEX` | `ENV=value` lines; a match means "nested run" → log only |
| `DUMP_INPUTS`, `DUMP_INPUTS_CODEX` | presence dumps masked hook inputs to `dumps/` (debugging) |
| `TRACKER_OFF` | presence turns the tracker page off for every project |
| `TRACKER_SINCE` | first `YYYY-MM-DD` line: projects whose history starts earlier keep the tracker off until asked (default `2026-10-27`) |
| `AUTO_HISTORY_DIRNAME` | history folder name (default `.ai-history`) |
| `AUTO_HISTORY_DISABLE=1` | turn everything off for that process (e.g. a daemon) |
| `AUTO_HISTORY_STATE_DIR` | per-session state files (default `state/` in the conf dir) |

Aliases are matched on word boundaries, case-insensitively, longest phrase first; separators may be space, dot or hyphen (`tauko work` = `tauko-work` = `tauko.work`). Text inside code fences, URLs, file paths and pasted blocks is ignored, and only the first 400 characters of the prompt are scanned.

## Claude Code plugin mode (experimental)

The repo also carries `.claude-plugin/plugin.json` and `hooks/hooks.json`, so it can be loaded with `claude --plugin-dir ./ai-history` or installed from the marketplace (`/plugin install ai-history --marketplace omskykhal/ai-history`). In plugin mode the conf dir is `CLAUDE_PLUGIN_DATA`, so set `AUTO_HISTORY_ROOT` (and optionally `AUTO_HISTORY_LANG`) as environment variables instead of the `ROOT`/`LANG` files. Codex still needs `install.mjs --codex-hooks`.

Status: verified once on Windows with `claude --plugin-dir` (2026-10-12: `.ai-history/`, daily log and `STATUS.md` written, status block requested). The marketplace install uses the same loading path but was not tested separately. Do not combine plugin mode with `install.mjs --install` on the same machine: both sets of hooks would run and every log line would be written twice.

## Tests

```bash
node test/run-tests.mjs <scratch-dir>
```

226 cases (hook behaviour, anchor rules, alias/folder matching, STATUS extraction, safety exceptions, installer round-trips, English mode, log retention, multi-session STATUS, resume command, tracker page). Test artifacts go to the OS temp dir, never into a real project.

## Known limits

- Windows is the only tested platform.
- Two agents writing the same project at the same time interleave in the log; `STATUS.md` is last-writer-wins (each session's own block survives in `sessions/`, see above).
- Codex `decision: block` on `Stop` has not been observed in practice (Codex followed the instruction every time during testing).

## Author / License

Yang <omskykhal@gmail.com> · MIT (see `LICENSE`).
