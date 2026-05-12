# Scratchpad

## What

A markdown scratchpad panel that toggles open with Cmd+J (session-scoped) and
Shift+Cmd+J (project-scoped). Plain `<textarea>` editor, autosaved to disk,
with one extra trick: selecting text and pressing Cmd+Enter submits the
selection as a user message in the current session, removes that slice from
the pad, and closes the panel.

## Why

When mid-conversation with the agent, I often want to draft a longer prompt
in markdown — sometimes pasting a tool's output, sometimes structuring a
multi-step request — without committing it to the chat input until it's
ready. The chat input is for "send this now", a scratchpad is for "I'm
thinking about what to say next, and I want to send pieces of it as I'm
ready". Project-scoped pad is for higher-level notes that outlive any single
session.

The Cmd+Enter-on-selection submit is the killer feature: it lets the pad act
as a queue of half-written prompts. Draft three follow-ups, send the first
one when ready, keep the others around until the agent reaches a state where
they make sense.

## Scope

- Two scopes: `session` (one pad per chat session) and `project` (one pad per
  project, independent of which session is open).
- Plain markdown — no preview, no toolbar, no syntax highlighting in the
  editor itself. Goal is "fast textarea", not "rich editor".
- Persistence on disk so notes survive restarts.
- Cmd+Enter on a non-empty selection: submit selected text as user message
  to the currently-active session, splice the selection out of the pad,
  close the panel.
- Cmd+Enter with no selection: do nothing in the scratchpad (let the global
  shortcut system handle it — e.g. plan approval).
- Esc closes the panel.

## Non-goals

- No markdown preview / split view (yet).
- No multiple named scratchpads per scope.
- No sharing or syncing — per-machine, per-app-data-dir only.
- No rich attachments (images, files). It's a notebook, not a chat input.
- Project scope does NOT show a session picker when submitting — submission
  always goes to the currently-active session in the chat view. If no
  session is active, Cmd+Enter is a no-op (the global keybinding handler
  takes over).

## Storage

`<app data>/scratchpads/<scope>/<safe-id>.md` where scope is `session` or
`project` and id is sanitised to alphanumerics + dash + underscore.
