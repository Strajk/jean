# Resume command prepends `cd <worktree-path>`

## What

The "Copy Resume Command" action (in the sidebar session context menu, the
session-tab context menu, and the burger / floating dock menus) copies a shell
command of the form:

```
cd '/abs/path/to/worktree' && claude --resume <id>
```

instead of just `claude --resume <id>`. Same shape for the Codex
(`codex resume …`), OpenCode (`opencode -s …`), and Cursor
(`cursor-agent --resume …`) variants.

## Why

The CLIs resolve resume IDs relative to the current working directory. Pasting
the bare `claude --resume <uuid>` into a fresh terminal usually fails — or
worse, silently resumes the wrong session — unless you're already cd'd into
the right repo. Including the `cd` makes the copied command self-contained:
paste it anywhere and it Just Works.

## Scope

- Only affects the string assembled by `getResumeCommand`. UI placement,
  keyboard shortcuts, and the toast message are unchanged.
- Path is single-quoted with embedded single quotes escaped (`'\''`), so
  paths with spaces or quotes survive.
- All four backends (claude / codex / opencode / cursor) get the same
  treatment.
- Worktree path is read from the existing React Query cache (or a
  `useWorktree` lookup where the call site already has `worktreeId`); no new
  Tauri commands.
- If the worktree path isn't available for some reason (cache miss, web
  context), fall back to the bare resume command rather than copying a broken
  `cd` line.

## Non-goals

- Not POSIX-portable beyond bash/zsh/fish/sh — no PowerShell / cmd.exe
  variant. Users running on Windows shells can adjust by hand.
- Doesn't validate the path or the worktree's existence.
- Doesn't try to chain anything else (env vars, `nvm use`, etc.) — just `cd`.
