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
| Claude Code | hooks support (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) |
| OpenAI Codex CLI | 0.160 or newer with `hooks` enabled (`codex features list` → `hooks stable true`), optional |
| OS | **Windows** (tested). macOS/Linux: path handling is implemented but **untested** |

## Install (recommended: installer script)

```bash
git clone https://github.com/<owner>/ai-history.git
cd ai-history
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

The `Stop` hook extracts it and writes `STATUS.md` with a header (`Session`, `Author: <agent> (<id>)`, `Updated`, `Anchor`). If the block is missing, the hook asks **once** for it (`decision: block`), never when the stop was caused by a context limit, an interruption, an auth error, a scheduled wake-up, or when context is ≥95% full. Disable the nudge with a `NO_BLOCK` file (Claude) / `NO_BLOCK_CODEX` file (Codex) in the conf dir, or `AUTO_HISTORY_NO_BLOCK=1`.

### What is logged

| Line | Content |
|---|---|
| `[User] …` | first 120 chars of your prompt |
| `▶ [Tool] …` / `✓ [Tool] … (1.2s)` | tool name and a short target (command, file path, pattern, agent description). **Tool output is never logged.** |
| `[Turn-end] …` | first 300 chars of the reply, or `STATUS updated` |
| `[anchor] set/changed …` | anchor changes |

API-key-looking strings (`AIza…`, `sk-…`, `ghp_…`, `Bearer …`, `password=…`) are masked before writing.

### Non-interactive runs

`claude -p` / SDK runs (`CLAUDE_CODE_ENTRYPOINT` not in `INTERACTIVE_ENTRYPOINTS`), sub-agents, and a Codex started *inside* a Claude Code session only get the machine log. No injection, no nudge.

## Configuration

All files live next to the scripts (or in `AUTO_HISTORY_CONF_DIR`). Missing file = default.

| File / env | Meaning |
|---|---|
| `ROOT` / `AUTO_HISTORY_ROOT` | boundary folder (default `~/Projects`) |
| `LANG` / `AUTO_HISTORY_LANG` | `en` (default) or `ko`: language of injected instructions, STATUS headings and header |
| `ALIASES` | `phrase1\|phrase2 => relative\path\under\root`, one target per line. See `ALIASES.example` |
| `INTERACTIVE_ENTRYPOINTS` | Claude entrypoints treated as interactive (`cli`) |
| `NO_BLOCK`, `NO_BLOCK_CODEX` | presence disables the one-time nudge |
| `NESTED_MARKERS`, `NESTED_MARKERS_CODEX` | `ENV=value` lines; a match means "nested run" → log only |
| `DUMP_INPUTS`, `DUMP_INPUTS_CODEX` | presence dumps masked hook inputs to `dumps/` (debugging) |
| `AUTO_HISTORY_DIRNAME` | history folder name (default `.ai-history`) |
| `AUTO_HISTORY_DISABLE=1` | turn everything off for that process (e.g. a daemon) |
| `AUTO_HISTORY_STATE_DIR` | per-session state files (default `state/` in the conf dir) |

Aliases are matched on word boundaries, case-insensitively, longest phrase first; separators may be space, dot or hyphen (`tauko work` = `tauko-work` = `tauko.work`). Text inside code fences, URLs, file paths and pasted blocks is ignored, and only the first 400 characters of the prompt are scanned.

## Claude Code plugin mode (experimental)

The repo also carries `.claude-plugin/plugin.json` and `hooks/hooks.json`, so it can be loaded with `claude --plugin-dir ./ai-history` or published through a marketplace. In plugin mode the conf dir is `CLAUDE_PLUGIN_DATA`, so set `AUTO_HISTORY_ROOT` (and optionally `AUTO_HISTORY_LANG`) as environment variables instead of the `ROOT`/`LANG` files. Codex still needs `install.mjs --codex-hooks`. This path is **not yet tested** end to end; the installer path above is.

## Tests

```bash
node test/run-tests.mjs <scratch-dir>
```

170 cases (hook behaviour, anchor rules, alias/folder matching, STATUS extraction, safety exceptions, installer round-trips, English mode). Test artifacts go to the OS temp dir, never into a real project.

## Known limits

- Windows is the only tested platform.
- Logs accumulate without rotation (one file per day per project).
- Two agents writing the same project at the same time interleave in the log; `STATUS.md` is last-writer-wins.
- Codex `decision: block` on `Stop` has not been observed in practice (Codex followed the instruction every time during testing).

## Author / License

Yang <omskykhal@gmail.com> · MIT (see `LICENSE`).
