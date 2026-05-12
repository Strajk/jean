# Secondary editor and terminal in "Open in"

## What

The "Open in" menu and the dropdown next to the "Open in {Editor}" button each show a single editor and a single terminal — whichever the user picked as their default. This customization adds an optional **secondary** editor and an optional **secondary** terminal to preferences. When set, each appears as its own row in the "Open in" modal directly below the primary one, with an `⌥`-prefixed keyboard hint (`⌥E` for the alt editor, `⌥T` for the alt terminal). The same alternates also show up in the dropdown next to the inline "Open in" button.

Sublime Text is added to the supported editors list at the same time, since the original motivation here was "I use Cursor, Sublime, and Zed and want to jump between them quickly."

## Why

I bounce between multiple editors during the day. Cursor is my daily driver, Zed is what I open when I want a fast, no-AI environment, Sublime is what I open when I just want to read or scratch-edit a file. Re-opening the preferences pane every time to flip the default is friction; so is leaving the IDE-level "Open in…" menu and using the OS file manager instead. A second slot in the menu fixes ~95% of those cases for me.

## Scope

- Two new (optional) preferences: `editor_secondary` and `terminal_secondary`. `null` = no secondary, behavior unchanged.
- Each is rendered as its own row in the "Open in" modal directly under the primary row, with the same icon and an `⌥{letter}` keyboard hint. Pressing `⌥E` / `⌥T` while the modal is focused launches the secondary; pressing `E` / `T` launches the primary as before.
- The secondary's value is launched through the existing editor/terminal launching plumbing — no new launch paths, no new commands, no platform-specific code beyond what already exists for the primary.
- The settings pane gains two new selects ("Secondary editor", "Secondary terminal") with a "None" option as the first entry. The select for the secondary excludes the value already chosen as primary, so you can't pick the same app for both.
- The dropdown next to the inline "Open in {Editor}" button also lists the secondaries when set — same labels, no kbd hints (the dropdown is mouse-driven anyway).
- Sublime Text added to the editors list. Supported on macOS, Windows, and Linux. CLI is `subl`; on macOS we fall back to `open -a "Sublime Text"` if the `subl` symlink isn't on PATH (matches how Zed/Cursor/IntelliJ are handled).

## Why option A (one alt slot, opt-key shortcut), not the alternatives

We considered a few designs before landing on this one:
- **Sub-flyout per category** ("Editor ▸" → list of all enabled editors). More elegant for power users with many editors, but adds a hover/keystroke layer and more nav state.
- **Flat list of every enabled editor and terminal** with letter shortcuts (`Z` Zed, `C` Cursor, `S` Sublime, `T` Terminal, `W` Warp, …). Maximally discoverable, but the modal grows long and the "default" gets visually demoted.
- **Favorites array** (`editors: EditorApp[]`, `terminals: TerminalApp[]`). Most flexible, but requires multi-select UI in settings, migration of the existing scalar pref, and renderer changes for a variable number of rows.

We picked **one alt slot + opt-key shortcut** mainly for ease of implementation: the data model stays scalar (just one extra optional field per category), the modal renderer needs almost no new layout code (just two more rows), and the existing keybinding logic handled `metaKey`-gated rows already — adding `altKey` was a one-line analog. This covers ~95% of the "I have two editors I bounce between" use case I actually have.

If down the road I find myself wishing for a third or fourth editor/terminal in the menu, we should rethink toward the favorites-array approach (or sub-flyouts). For now, two is enough.

## Non-goals

- No multi-select / favorites array. Exactly one secondary per category.
- No per-project override of editor/terminal — preference is global.
- No auto-detection of installed editors. Selecting a secondary that isn't installed silently no-ops (or surfaces the same OS error as the primary path does today).
- No new keyboard shortcut to *open* the "Open in" modal directly to the secondary — `Cmd+O` then `⌥E`/`⌥T` is the flow.
- No upstream PR for this. It's a power-user feature, easy to add per fork; it would clutter the settings pane for users who don't bounce between editors.
