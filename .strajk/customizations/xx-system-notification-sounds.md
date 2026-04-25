# System notification sounds

## Why

The notification sound picker for "Waiting" and "Review" only offers a small set of
custom sounds bundled with Jean. People already know and like the alert sounds that
ship with their OS — Glass, Submarine, Ping, Pop, etc. on macOS, the standard
Windows alerts, the freedesktop sounds on Linux. Letting users pick those keeps Jean
feeling native and gives a much wider menu of sounds without bundling more files.

## What changes

The two notification sound dropdowns (Waiting sound, Review sound) gain a second
group of options enumerated at runtime from the OS:

- **Custom** group — the existing bundled Jean sounds (Work Work, Job's Done, …).
  This group is the source of truth for any new bundled sounds added later.
- **System** group — every alert sound the host OS exposes, listed alphabetically.
  On macOS this means `/System/Library/Sounds/` and `~/Library/Sounds/`; on Windows
  the standard media folder; on Linux the freedesktop sound theme. Whatever the OS
  has, the dropdown shows.

Both groups behave the same: selecting a sound saves it to preferences, the preview
button plays it instantly, and the chosen sound fires when a session needs input
(Waiting) or finishes (Review).

The "None" option stays at the top of the list, ungrouped.

## Behavior details

- **Playback** is delegated to the OS for system sounds (so we don't have to teach
  the WebView to decode AIFF or worry about audio codecs across platforms). Custom
  bundled sounds keep playing through the WebView as before.
- **Identifiers** are stable strings persisted in preferences. System sounds are
  prefixed so a future OS update can't silently collide with a bundled-sound ID.
- **Missing sounds** (e.g. user picks a system sound on macOS, then opens settings
  on a Linux box where that sound doesn't exist) fall back gracefully to silence
  rather than crashing. The dropdown still shows the saved value as selected so the
  user can see what they had.
- **Preview button** uses the same playback path as real notifications so what you
  hear while configuring matches what you hear in use.

## Out of scope

- Letting users add their own sound files through the UI. Power users can drop files
  into the OS's user-sounds folder and they show up in the System group automatically.
- Per-session or per-project sound overrides. The two existing global slots are
  enough.
- Volume control. The OS's notification volume already governs this.
