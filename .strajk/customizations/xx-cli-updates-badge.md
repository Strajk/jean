# CLI updates badge

## Why

When multiple CLIs have updates available (Claude, GitHub, Codex, OpenCode), Jean
fires individual toast notifications that stack up, auto-persist with `Infinity`
duration, and compete for attention with actual workflow toasts. They're easy to
accidentally dismiss and impossible to revisit once gone.

A consolidated badge in the titlebar is less disruptive, always visible while
updates exist, and lets the user act on their own schedule — the same pattern Jean
already uses for app updates.

## What changes

CLI update detection no longer produces toast notifications. Instead, detected
updates are collected into a list in global UI state and surfaced as a small badge
in the right side of the titlebar (next to the existing app-update indicator).

- **Badge**: a compact icon-plus-count button (e.g. download icon with "3"). Hover
  tooltip spells out "3 CLI updates available". The badge disappears when there are
  no updates.
- **Popover**: clicking the badge opens a dropdown listing each CLI with its name,
  current version, and available version. Each row has an "Update" button (triggers
  the existing update/reinstall modal flow) and a dismiss "X" button. When two or
  more updates are listed, an "Update All" button appears at the bottom.
- **Auto-close**: the popover closes automatically when the last update in the list
  is acted on or dismissed.

## Behavior details

- Update detection timing and logic are unchanged — the hook still defers GitHub API
  calls by 10 seconds after startup and re-checks periodically.
- Dismissing an update is session-scoped. On next app launch the hook re-detects it
  and the badge reappears. This matches the old toast behavior.

## Out of scope

- Persisting dismissed updates across restarts.
- A global preference to disable CLI update checking entirely.
- "Update All" button — update modals are sequential and can't be batched reliably.
