# Linear via mcporter MCP

## What

Add a second Linear backend that reads issues through the user's existing [mcporter](https://github.com/runebookai/mcporter) Linear MCP connection instead of calling Linear's GraphQL API with a personal access token.

The user picks a backend in Settings → Integrations → Linear:

- **Personal API key** (default, upstream behavior) — unchanged.
- **mcporter MCP** — shell out to `mcporter call linear.<tool>` for every Linear read.

When `mcporter` is selected, all of Jean's existing Linear features (list issues in the new-worktree modal, the Magic load-context tab, the per-session loaded-issue panel, deep-link `linear:` resolution) keep working without a Linear PAT.

## Why

Some orgs disable personal API key issuance entirely. Jean's upstream Linear integration only knows how to read with a personal key, so users on those orgs lose every Linear feature.

The hosted Linear MCP (`https://mcp.linear.app/mcp`) already speaks OAuth and is what mcporter is authed against. Leveraging it gives us a working Linear path with zero new OAuth code, zero new Linear-app registration, and zero new token storage. The trade-off is a hard dependency on `mcporter` being installed and authed — fine for a personal customization, not viable as the upstream-default path.

Why a customization, not an upstream PR: too opinionated. Upstream-correct fix is to add native Linear OAuth (see "Non-goals"). mcporter is a fast workaround that only makes sense for users who already have mcporter wired up.

## Scope

Read-only Linear access via mcporter:

- List active issues (optionally filtered by team).
- Search issues.
- Get a single issue with comments.
- Get an issue by number (used by branch-name / deep-link flows).
- List teams (for the team picker in project settings).

All five command surfaces are existing Tauri commands in upstream Jean; this customization adds an alternate code path behind a preference flag.

## Backend selection

A new preference `linear_backend` (values `"pat"` | `"mcporter"`, default `"pat"`) gates which path runs. When `mcporter` is selected, an additional `linear_mcporter_team` preference (a team key like `"KCW"` or team name) acts as the equivalent of `linear_team_id` for filtering — mcporter's `list_issues` accepts a team key/name, not a UUID, so we can't reuse the existing field.

Backend resolution order (when `linear_backend == "mcporter"`):

1. mcporter path: `linear_mcporter_binary` preference if set, else `mcporter` on PATH (Jean's existing `silent_command` already fixes PATH on macOS GUI launches).
2. Team filter: `linear_mcporter_team` preference if set, else no filter.

The per-project `linear_api_key` override remains valid only for the `pat` backend.

## Field-mapping notes

mcporter's response shape differs from Linear's GraphQL — adapter maps:

- `id` (mcporter) is the human identifier (e.g. `"KCW-23"`), not a UUID. Jean's `LinearIssue.id` and `.identifier` both get this value.
- `status` (string) + `statusType` (string) → `state {name, type, color}`. Color isn't returned by mcporter — defaulted by `statusType` (e.g. backlog → grey, started → blue).
- `labels: string[]` → `[{name, color}]` with a default color.
- `assignee` (display name) → `{name, displayName}` duplicating the string into both.
- Active-state filter (`type in [started, unstarted, backlog, triage]`) — mcporter's `list_issues` doesn't filter server-side, so we filter the response client-side on `statusType`.
- `get_issue` doesn't return comments; comments fetched via a separate `list_comments` call.

## UI

Settings → Integrations → Linear:

- A radio / select for backend.
- When `pat` is selected: existing API-key input + Save/Remove.
- When `mcporter` is selected: a "Team key / name" input (optional) and a "Test connection" button that runs `mcporter call linear.list_teams --args '{"limit": 1}'` and reports success/failure.

Per-project Linear settings keep the existing team-UUID field for the PAT backend, untouched.

## Non-goals

- Native Linear OAuth in Jean. The proper upstream fix — separate effort, see the previous conversation around this customization for the sketch (PKCE loopback flow, token storage in prefs, refresh on 401).
- Writing to Linear (comments, status updates). mcporter's MCP supports it, but Jean today is read-only against Linear and adding writes is out of scope.
- Bundling mcporter or auto-authing it. Users bring their own working mcporter setup.
- Daemonizing mcporter for lower latency. Each call spawns a fresh `mcporter` process (~hundreds of ms). Acceptable for the modal-open and tab-open call sites; if it becomes painful, revisit with a long-lived connection.
