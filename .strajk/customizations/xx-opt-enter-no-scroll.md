# Opt+Enter Submits Without Scrolling To Bottom

## What

Holding Option (Alt) while submitting a chat message — i.e. Opt+Enter in the prompt input — sends the message without auto-scrolling the conversation to the bottom. Plain Enter keeps its existing behavior (submit + jump to bottom).

## Why

The common flow: the assistant is mid-response, you're scrolled up reading earlier output, and a follow-up question pops into your head. Plain Enter sends the message but yanks you to the bottom, losing your reading position. Opt+Enter lets you queue the follow-up and stay where you are; the bottom will still be there when you're ready.

## Scope

- Only the chat prompt input's submit path — when Enter (without Shift) submits, check the `altKey` modifier on the keyboard event and skip the "mark at bottom" call that drives auto-scroll on the next message.
- Send-button click and other non-keyboard submits are unaffected (they always scroll, same as before).

## Non-goals

- Don't introduce a new configurable keybinding for this; the modifier sits naturally on top of the existing Enter shortcut.
- Don't change scroll behavior for assistant messages, tool output, or any other non-user-submit code path.
