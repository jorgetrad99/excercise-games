# CLAUDE.md

@AGENTS.md

## Quick rules (repeat of the ones that matter most)

- For symbol navigation, prefer the LSP tool over grep; use grep only for literal text; trust the language server's results rather than re-reading files to confirm them.
- `src/core/` is pure TypeScript — no DOM, no three.js, no `Math.random`.
- Run `pnpm verify` before every commit and before saying anything is done. Log each session in `docs/PROGRESS.md`.
- Don't touch `fixtures/**`, `public/models/**`, `docs/PLAN.md`.
- Read `docs/PLAN.md` §2–§4 for the spec and milestone DoD. Work one milestone at a time.

## Setup once (human)

```bash
npm i -g typescript typescript-language-server   # LSP server binary on PATH
# in Claude Code:
/plugin install typescript-lsp@claude-plugins-official
```

## `.claude/settings.json` (create in M0)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/guard-paths.mjs" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/format-and-typecheck.mjs" }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/remind-progress-log.mjs" }] }
    ]
  }
}
```

Hook behavior (implement in M0, ≤ 40 lines each):

- `guard-paths.mjs`: read the tool input from stdin; if the target path matches `fixtures/`, `public/models/`, `docs/PLAN.md`, or `.claude/settings.json`, exit 2 with a message. Otherwise exit 0.
- `format-and-typecheck.mjs`: if the edited file is `*.ts`, run `prettier --write <file>` then `tsc --noEmit -p . --incremental`; print the first 30 lines of errors to stdout (the agent sees them). Exit 0 always (don't block; inform).
- `remind-progress-log.mjs`: if `git diff --name-only HEAD` doesn't include `docs/PROGRESS.md` and there are staged/unstaged code changes, print a reminder. Exit 0.
