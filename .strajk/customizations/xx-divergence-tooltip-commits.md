# Divergence Tooltip Commit Lists

**Summary:** Show individual commit hashes and messages in pull-side and base-branch divergence badge tooltips — not just terse counts like "Merge N new commits from origin/main" or "Push N on main". Companion to `xx-push-tooltip-commit-list.md`, which covers the worktree-level unpushed case.

## Why

The sister to `xx-push-tooltip-commit-list.md` (which already enriched the worktree-level unpushed tooltip). Three other pull/push tooltips in the app still show only a count:

1. **Worktree pull badge** — "Merge N new commits from origin/{base}". Before pulling, it's useful to see *which* commits are about to land, since a pull can change the ground under an in-flight session (auto-stash, rebase, surprise upstream changes).
2. **Project-line base-branch pull badge** — fires when local `main` drifts behind `origin/main` (e.g., someone pushed from a terminal or another machine). Same payoff as #1, but for the base branch the project sits on.
3. **Project-line base-branch push badge** — fires when local `main` has commits not on `origin/main`. Helpful before pushing the base branch directly to confirm what's about to leave.

Hover the badge → see the commits. No clicks, no opening modals.

## How

### Backend: piggyback on existing git status polling

All three new lists are computed in the same poll cycle that already produces the matching counts — no new commands or round-trips. Three new fields on `GitBranchStatus`, each capped at 20 and gated on the corresponding non-zero count to skip useless `git log` calls when there's nothing to report:

- `incoming_commits` — commits in `origin/{base_branch}` not in `HEAD` (worktree-level pull).
- `base_branch_incoming_commits` — commits in `origin/{base_branch}` not in local `base_branch` (project-line pull).
- `base_branch_unpushed_commits` — commits in local `base_branch` not in `origin/{base_branch}` (project-line push).

Naming intentionally mirrors the existing `unpushed_commits` so the four lists form a consistent set on the same struct.

### Frontend: enrich the three tooltips

Same visual treatment as the existing unpushed tooltip — header line, thin border, hash-and-subject list, "...and N more" when truncated:

- `GitStatusBadges` (shared) gains an `incomingCommits` prop and renders the list inside the pull tooltip. Callers (`ProjectCanvasView`, `SessionChatModal`) pass it through.
- `WorktreeItem`'s inline pull tooltip (which doesn't go through `GitStatusBadges`) reads `gitStatus?.incoming_commits` directly.
- `ProjectTreeItem`'s base-branch pull and push tooltips read `gitStatus?.base_branch_incoming_commits` and `gitStatus?.base_branch_unpushed_commits` from the first worktree's poll output (those are repo-level facts — any worktree's poll surfaces the same lists).

## Gotchas

- All three lists are transient per-poll data — never written to the worktree cache. Pre-first-poll renders fall back to the count-only message, which is fine.
- For base session worktrees (`current_branch == base_branch`), `incoming_commits` and `base_branch_incoming_commits` are identical by construction — they're computed against the same range. Same with `unpushed_commits` and `base_branch_unpushed_commits`. The redundancy doesn't matter; the project line and worktree line read different fields and don't collide.
- The project-line tooltips only fire when there is no base session worktree (existing behavior). When a base session exists, the worktree-level pull/push tooltips already cover that case via `incoming_commits` / `unpushed_commits`.

## Non-goals

- No diff preview, no per-commit drill-down — just the subject line. If you need the diff, click into the commit history view.
- No pre-pull conflict detection. The tooltip is an awareness aid; conflict surfacing happens after pull.
