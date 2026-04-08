# Go to Session (Cmd+P)

## What

A VS Code-style "Go to File" palette, but for sessions. Cmd+P opens a fuzzy-searchable list of all sessions across all projects and worktrees, sorted by most recently updated. Selecting one navigates directly to that session.

## Why

With many projects and worktrees, finding a specific session requires clicking through the sidebar. This is slow when you know the session name but not which project/worktree it's in. Cmd+P provides instant access to any session, matching the mental model of VS Code's Cmd+P for files.

## Implementation approach

### New file: `src/components/command-palette/SessionPalette.tsx`

A new component using the same `cmdk` / `CommandDialog` pattern as the existing `CommandPalette.tsx`:
- Uses the existing `useAllSessions()` TanStack Query hook to fetch sessions across all projects/worktrees
- Flattens all sessions into a single list, **filtering out archived sessions** (`session.archived_at` is truthy)
- Sorts by `updated_at` descending (most recent first)
- Groups results by project name for display
- Each row shows: session name, worktree name (secondary), and relative time ("5m ago")
- Search uses cmdk's built-in fuzzy matcher (`defaultFilter`) against session name + worktree name + project name.
- **`>` is an explicit project / session delimiter.** Typing `pok > add` matches sessions whose project name fuzzy-matches `pok` AND whose session/worktree name fuzzy-matches `add`. Each half is scored independently with `defaultFilter`, against `keywords[0]` (project) and `keywords[1]` (session + worktree). Either half may be empty (`> foo` = match all projects, `foo >` = match all sessions inside the project).
- **Match highlighting.** Matched glyphs are painted in-place: a left-to-right greedy subsequence walk produces the highlight positions (cmdk's scorer doesn't expose them). With `>`, the left half highlights the project group heading, the right half highlights session and worktree text. Without `>`, the same query is tried against both fields independently — wherever it matches gets highlighted, the rest is left untouched.
- Registers its own `keydown` listener for Cmd+P (with `!e.shiftKey` guard to avoid conflict with Cmd+Shift+P)

### Navigation on select (race condition aware)

When a session is selected, there are two code paths:
- **Same project**: dispatches `open-worktree-modal` CustomEvent directly (canvas is mounted, listener exists)
- **Different project**: uses `markWorktreeForAutoOpenSession(worktreeId, sessionId)` via Zustand, then calls `selectProject()`. The new `ProjectCanvasView` consumes the intent on mount via `consumeAutoOpenSession()`.

This avoids the race condition where a project switch causes `ProjectCanvasView` to remount, losing any `CustomEvent` dispatched before the new instance mounts.

### Store changes: `src/store/ui-store.ts`

- Add `sessionPaletteOpen: boolean` state (default `false`)
- Add `setSessionPaletteOpen(open: boolean)` setter

### Keybinding: `src/types/keybindings.ts`

- Add `'go_to_session'` to `KeybindingAction` union
- Add `go_to_session: 'mod+p'` to `DEFAULT_KEYBINDINGS`
- Add definition to `KEYBINDING_DEFINITIONS` (category: `'navigation'`)

### Event listener wiring: `src/hooks/useMainWindowEventListeners.ts`

- Add `case 'go_to_session'` to `executeKeybindingAction()` — opens the palette via `setSessionPaletteOpen(true)`
- Add `uiState.sessionPaletteOpen` to the blocking modals check so other keybindings don't fire while the palette is open

### Mount: `src/components/layout/MainWindow.tsx`

- Import and render `<SessionPalette />` alongside `<CommandPalette />`

### Shared UI tweak: `src/components/ui/command.tsx`

- Forward an optional `filter` prop on `CommandDialog` to the inner `Command`. Backward compatible — existing callers (`CommandPalette`) ignore it.

## Gotchas

- The `useAllSessions()` hook is only enabled when `sessionPaletteOpen` is true (lazy loading)
- Archived sessions must be filtered client-side; the `list_all_sessions` Rust command returns all sessions including archived ones
- Cmd+Shift+P is already taken by `open_provider_dropdown` — the Cmd+P handler explicitly checks `!e.shiftKey`
