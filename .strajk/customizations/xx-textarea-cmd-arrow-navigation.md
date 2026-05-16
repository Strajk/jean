# Textarea Cmd+Up/Down Cursor Navigation

## What

Allow Cmd+Up / Cmd+Down to move the caret to the start / end of the text inside any focused input, textarea, or contentEditable element — the standard macOS text-navigation gesture.

## Why

Upstream binds Cmd+Up / Cmd+Down globally to "scroll chat up/down (page)". The handler runs in the capture phase and calls `preventDefault()`, so the gesture never reaches the focused text field. In the prompt input, this is especially painful: jumping to the very top or bottom of a long draft is muscle memory on macOS, and there's no good substitute.

The chat-scroll binding still makes sense when nothing is being typed; we just want the text field, when focused, to win.

## Scope

- Only when focus is in an `<input>`, `<textarea>`, or contentEditable element.
- Cmd+Up / Cmd+Down only — Cmd+Left/Right (line start/end) was never bound and already works.
- Single-key Up/Down (small-scroll bindings) already short-circuit on text-field focus via the existing no-modifier guard, so no change there.

## Non-goals

- Don't remove or rebind `scroll_chat_up` / `scroll_chat_down` — they still work everywhere else.
- Don't touch the ChatInput-local key handler; the global capture-phase listener is what was eating the keystroke.
