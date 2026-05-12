# Ask About Highlighted Text (Ephemeral Side Discussions)

## What

Lets the user select any text in a chat message and ask a side question about it
("explain this term", "what does this acronym mean", "summarise this in plain
English"). The Q&A appears in a small floating panel anchored to the selection,
and **never enters the main session log** — it doesn't get sent back to Claude
as conversation context on the next turn, doesn't show up in the message list,
doesn't count toward the session's token usage history.

Each side discussion is anchored to a yellow highlight (the same persistent
highlight feature Jean already has). The highlight stays after the Q&A is done,
and hovering over it later offers an "Open thread" button to revisit the
answer.

The discussion runs in a detached background process. The user can close the
panel while it's still streaming, do other things, and reopen it later — the
answer keeps streaming and is reflected when they come back.

## Why

A common need while reading a long Claude response is to clarify a single
sentence or term without disrupting the main task. Today the only way to do
this is to type a follow-up message into the session — which:

1. Pollutes the conversation history (Claude will treat the clarification as
   context for the *next* turn).
2. Pushes the actual work off-screen.
3. Feels heavy for a "btw" question.

The whole feature is built around the principle that asking a side question
should feel as casual as highlighting text in a PDF reader.

## Scope

In scope:

- "Ask about this" entry point alongside the existing "Highlight" button in
  the selection popover.
- A third selection action: "Copy as markdown" (since we were doing UI work on
  the popover anyway, and copying selected text as actual markdown — with
  code fences, links, etc. preserved — is a generally useful adjacent feature).
- Floating side panel showing quoted text + input + streaming answer, with
  proper markdown rendering of the answer (code blocks, lists, tables, etc.).
- Background-running ephemeral Claude process that survives the panel being
  closed.
- Revisit affordance on existing highlights ("Open thread" appears on hover
  when a thread is anchored to that highlight).
- Cancel + discard.
- Panel is resizable from its bottom-right corner (drag to grow/shrink).
- Send the full text of the source message to the LLM alongside the
  highlighted snippet, so references like "this function" / "that approach"
  can be resolved without a clarification round-trip.

Out of scope (deliberately, to make this trivially revertible and testable):

- Multi-turn follow-ups inside a thread. Each "Ask" is a single Q&A.
- Persistence across app restart. Threads live in memory only — closing and
  reopening the app discards them. The yellow highlight stays, so the user
  can re-ask.
- Persisting the resized panel size across panel reopens. Default size always
  on reopen.
- Codex / OpenCode / Cursor backends. Claude only. Other backends silently use
  Claude for the side discussion regardless of the session's primary CLI
  (acceptable because side discussions don't need code execution and Claude is
  always installed when the feature is reachable).
- Visual indicator on highlights that have a thread (e.g. a tiny dot).
  Discoverability is via hover only.
- Sharing context across the whole conversation. The thread only sees the
  highlighted text + its source message, not the rest of the chat.

## Behaviour

### Triggering

- User selects text in a chat message → selection popover appears with
  **three** opaque buttons (positioned just above the selection's right edge,
  clamped to the viewport so it never goes off-screen):
  - **Yellow "Highlight"** — creates a persistent yellow highlight, no thread.
  - **Blue "Ask about this"** — also creates a yellow highlight (so the thread
    has an anchor) AND opens the side panel ready for the user's question.
  - **Slate "Copy as markdown"** — copies the selection to the clipboard,
    preserving markdown formatting recovered from the rendered DOM (inline
    code, bold, links with URLs, code fences, lists, headings).
- Buttons use fully opaque colours so they pop against busy chat content.

### The panel

- Anchored near the selection (clamped to viewport — never off-screen even
  if the selection is at the edge).
- Sits visually above everything (above the sidebar, titlebar, and other
  popovers).
- Default size is roomy enough to read; drag the bottom-right corner to
  resize.
- Header: small dot + "Ask about selection" + spinner while streaming +
  close button + (when finished/errored) discard button.
- Body, top: quoted text snippet (dim, italic, line-clamped to 3 lines,
  selectable).
- Body, middle: the user's question (when set), then the streaming/finished
  answer **rendered as markdown** (same renderer the main chat uses — full
  GFM support, code highlighting, copy buttons on code blocks), with a
  blinking cursor while streaming. All body text is user-selectable.
- Footer: input field + send button (Enter to send) for new threads;
  "Cancel" link while streaming; nothing once finished.
- Esc closes the panel. Outside-click closes the panel. **Closing does NOT
  cancel the underlying Claude process** — that's the whole point.

### Revisiting an in-flight or completed thread

- Hovering over an existing yellow highlight that has a thread shows the
  remove (X) button as before, plus a new blue "Open thread" button.
- Clicking "Open thread" reopens the side panel, showing whatever has
  streamed in so far (or the final answer if it's done).

### Cancel / discard

- "Cancel" while streaming kills the detached Claude process and marks the
  thread as cancelled. The thread + answer-so-far stay in memory; user can
  discard them or just close.
- "Discard" (visible after done/error/cancelled) removes the thread from
  memory. The yellow highlight stays — user can re-ask if they want.
- Removing the underlying highlight does NOT auto-discard the thread (it
  becomes unreachable, but in-memory state is harmless and clears on app
  restart).

## Backend constraints

The side discussion must:

1. Spawn its own detached process so the work survives the panel closing.
2. Use `--no-session-persistence` (Claude CLI flag) so it doesn't pollute the
   user's local Claude session store. The conversation must be invisible to
   anything outside this feature.
3. Disable tools entirely (`--allowed-tools ""` and `--permission-mode plan`).
   Side discussions are pure Q&A; the backend should be incapable of editing
   files even if Claude tried.
4. Stream output incrementally to the frontend so the user sees text appear
   in the panel as it's generated.
5. Be cancellable by killing the process group (no special server-side
   interrupt — there's no server).
6. Accept both the highlighted snippet AND the full source message as
   separate prompt fields, so the model can disambiguate references. The
   source message is capped at ~8k chars to avoid runaway prompts.
7. Tell the model that the highlighted text is the focus of the question
   and the surrounding message is just context — don't summarise the
   surrounding message unless asked.

The temp NDJSON files used to bridge the CLI and the frontend should be
cleaned up when the thread finishes.

## Adjacent fix bundled into this customization

A pre-existing bug in the highlight-rendering code surfaced once the panel
was added: when navigating away from a session and back, yellow highlights
sometimes didn't re-paint because the message DOM hadn't rendered yet by the
time the re-apply timer fired. Fixed by watching for new message-shaped
elements in the scroll container and re-applying when they appear. Applies
to all yellow highlights (Ask-created or otherwise).

## Non-goals

- Replacing the main chat. This is for marginal "btw" questions, not full
  conversations. If you need real back-and-forth, use a regular session.
- Costing nothing. Every Q&A is a real Claude API call. Token usage is not
  surfaced in the UI — be aware that opening lots of threads is not free.

## Reverting

Designed to be reverted as a single git commit:

- One new Rust module under `src-tauri/src/chat/` exposing two Tauri commands
  (`start_highlight_thread`, `cancel_highlight_thread`) and emitting events
  with names prefixed `highlight-thread:`.
- Three new frontend files: a Zustand store for thread state, a floating
  panel component, and a small hook that wires the four Rust events into the
  store.
- Tiny additive edits in: chat module entry point, Tauri command handler
  list, WebSocket dispatch, the existing selection popover (three extra
  buttons + viewport clamping helper), the existing text-highlight hook (the
  re-paint fix described above), and ChatWindow (mounting the panel + the
  events hook).
- One new dependency: `turndown` (HTML → markdown, for the "copy as
  markdown" button).

All non-additive edits are flagged with a `// [STRAJK FORK]` marker comment so
they're trivial to spot and revert.
