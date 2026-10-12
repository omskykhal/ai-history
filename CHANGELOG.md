# Changelog

## 0.2.0 — 2026-10-12

- Log retention: daily logs older than 30 days are gzipped into `.ai-history/archive/`, `.gz` older than 365 days are deleted; runs once per 24h per project (SessionStart / anchor change), never touches today's or yesterday's log or `STATUS.md`. Configure with the `RETENTION` file (`keep` / `archive` / `sessions`), the matching `AUTO_HISTORY_*_DAYS` env vars, or `install.mjs --config --keep-days/--archive-days/--sessions-days`. `keep=0` turns rotation off.
- Several sessions in one folder: `Stop` also writes `.ai-history/sessions/<agent>-<id8>.md`; the Reader adds the other sessions' copies from the last 48h (newest 2, 1,000 chars each) after `STATUS.md`, tagging the resumed session's own copy `(this session)`. Copies older than 7 days are pruned. `STATUS.md` format unchanged. Reader cap 8,000 → 10,000 chars.
- `[retention] …` log line (only when something was moved or deleted), `install.mjs --status` shows the retention policy.
- Tests: 190 cases (+20).

## 0.1.0 — 2026-10-10

First public packaging of the hooks that ran privately as "auto-history" (2026-10-08 → 10-10).

- Five hooks for Claude Code and Codex (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`), one shared `.ai-history/` per project with per-line agent attribution.
- Anchor rules: alias / `<name> project` mention → changed working directory → session state → adopt cwd. Root boundary only.
- STATUS block extraction with a single safe nudge; OMC-compatible safety exceptions.
- Generalized for distribution: `ROOT`/`LANG` conf files, `en`/`ko` wording, English `project`/`folder` keywords, installer modes `--config`, `--status`, `--git-ignore`, Codex `hooks.json` merge (other handlers kept), POSIX path branch (untested).
- Claude Code plugin manifest (`.claude-plugin/plugin.json`, `hooks/hooks.json`), experimental.
- Tests: 170 cases, artifacts in the OS temp dir.
