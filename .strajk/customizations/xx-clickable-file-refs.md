# Clickable file references in inline code

## What

When an inline code block in chat looks like a file reference — e.g. `` `src/types/preferences.ts:1088` `` or `` `src/types/preferences.ts:1088-1090` `` — clicking it opens that file in the user's preferred editor at the right line. Range form is accepted; only the start line is used. Relative paths resolve against the active project's path.

## Why

Assistant messages frequently reference files by path with a line number. Currently, jumping from a chat reference to the actual code is a copy-paste-into-editor exercise. One click is the whole point.

## Scope

- Applies to **inline code only** (single backticks). Fenced code blocks are unchanged.
- Detection runs **only when the user clicks** the inline code — no per-render parsing — because chats can contain a lot of inline code and we don't want to pay for matching that almost always doesn't apply.
- Pattern accepted: a file-shaped path (must contain a `/` or `\` separator AND a file extension) optionally followed by `:line` or `:line-line` (range trims to start line). Examples: `` `src/foo.ts` ``, `` `src/foo.ts:42` ``, `` `src/foo.ts:42-50` ``. Bare identifiers like `` `useState` `` or `` `console.log` `` are intentionally not matched. Without a line number, the file opens at the top.
- **Routes through the existing editor-spawn machinery** (`open_file_in_default_app`), so it respects the user's editor preference (Cursor / VS Code / Zed / IntelliJ / Xcode) instead of being hardcoded to one editor. Line jump is encoded per editor: `--goto path:line` for Cursor and VS Code, `path:line` positional for Zed, `--line N path` for IntelliJ and Xcode. The macOS `open -a` fallback (used when the editor's CLI isn't on PATH) silently drops the line jump — that's acceptable.
- Relative paths resolve against the **active project's** path (the original repo, not the worktree). Reasoning: chat references usually point at the canonical file; opening in the project keeps editing free of working-tree noise. If the project path can't be found, fall back to the worktree path. Absolute paths (`/...` or `C:\...`) are used as-is.
- Wrapping characters around the reference (backticks, single/double quotes, parens, brackets) are stripped before matching, so noisy `textContent` (e.g. rendered inline code that still contains the literal backticks) still resolves cleanly.
- Visual cue: inline code gets a pointer cursor and a subtle hover state, signalling it's interactive. The check is cheap on click, so we don't try to gate the cursor on whether the text actually matches.

## Non-goals

- No column number support.
- No clickable behavior on fenced code blocks or plain prose paths.
- No path validation — if the file doesn't exist, that's between the editor and the OS.
- Web/non-native context: no-op (the underlying command is native-only; nothing to do in a browser).
