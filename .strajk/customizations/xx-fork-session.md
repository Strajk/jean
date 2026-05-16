# Fork Session

## What

Adds a "Fork" icon (lucide `GitBranch`) next to the existing copy-as-markdown
icon under every assistant message. Clicking it creates a new session whose
history is the current session truncated up to (and including) that exact
assistant response, then switches to the new session.

## Why

When Claude (or another backend) takes a wrong turn three responses ago, the
cheap thing to do today is start a brand-new session and re-paste context.
The expensive thing is to keep replying inside the broken thread and hope it
course-corrects. Forking at a specific assistant message gives a third
option: branch from the moment things were still fine, leave the original
thread intact for comparison, and let the underlying CLI actually resume
from that point so the next message lands in real context — not display-only
history.

The button lives next to the copy icon because that's where users are
already looking when they decide a response was either keep-worthy or
diverge-worthy.

## Behavior

- **Trigger**: Fork icon inline with the duration / copy buttons under each
  assistant message. Hover tooltip: "Fork session from this message".
- **Truncation point**: The clicked assistant message is **included** in the
  fork. Everything after it is dropped.
- **Resume semantics**: The CLI session pointers (claude session id, codex
  thread id, cursor chat id) of the LAST kept run are promoted to the new
  session's session-level resume pointers. The next message the user sends
  in the fork resumes the actual underlying CLI conversation from that
  branch point — not just visible history. OpenCode tracks session at
  session-level (not per-run) so its pointer is inherited as-is.
- **Settings preserved**: Backend, model, thinking level, provider,
  execution mode, MCP servers, GitHub issue/PR references.
- **State reset**: Answered questions, submitted answers, fixed findings,
  review results, permission denials (all backends), queued messages, label,
  digest, plan approvals, plan file path, highlights, scheduled wakeups,
  archived flags, waiting-for-input state — all cleared because the fork is
  a new branch in the user's workflow.
- **Run state cleanup**: All kept runs forced to `Completed` status with
  PIDs and codex turn IDs cleared (the fork inherits a static history; no
  live processes are attached, and stale PIDs would make the app try to
  tail non-existent processes after restart).
- **Naming**: `"{original name} (fork)"` with `session_naming_completed:
false` so auto-rename triggers on the first new message.
- **Activation**: Fork is immediately made the active session tab.
- **Backends**: Works across all four backends (Claude, Codex, OpenCode,
  Cursor) — the per-run CLI ID promotion is the only backend-specific bit
  and it's handled by reading whatever per-run pointer the source had.

## Scope

Self-contained feature touching the standard command pipeline:

1. A Tauri command that loads source metadata, finds the run with the
   matching `assistant_message_id`, copies the relevant `{run_id}.jsonl`
   files, creates a new session via the standard sessions mutation
   helper, and overwrites its metadata with the truncated run list plus
   reset transient state.
2. Registration in both the native IPC handler and the WebSocket dispatch
   handler.
3. A TanStack Query mutation hook that invokes the command, invalidates
   sessions queries, and switches the active session to the fork.
4. A small icon button rendered alongside the existing copy-as-markdown
   button in the assistant message footer (where the duration shows).

## Dependencies

None.

## Non-goals

- No "fork at user message" — branching from a user message is ambiguous
  (does the fork include the user's question or stop just before it?).
  Anchoring on assistant messages is unambiguous.
- No mid-message fork (e.g. forking after the first paragraph of a long
  response). The smallest forkable unit is one full run/response.
- No fork-and-edit. The fork's first user message starts fresh; we don't
  copy a draft into the input.
- No session-level "Fork Session" context menu action that duplicates the
  whole session — forking at the latest assistant message already covers
  that case with continued CLI resume, which is strictly more useful.
