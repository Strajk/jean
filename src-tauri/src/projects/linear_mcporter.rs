// [strajk-fork] mcporter Linear MCP adapter. See .strajk/customizations/xx-linear-mcporter.md.
//
// Shells out to `mcporter call linear.<tool>` instead of calling Linear's GraphQL API directly.
// Used when `prefs.linear_backend == "mcporter"`. Lets users on orgs that disable personal API
// keys keep Jean's Linear features working, by routing through the hosted Linear MCP that
// mcporter has OAuth-authed against.

use serde_json::{json, Value};
use tauri::AppHandle;

use super::linear_issues::{
    LinearComment, LinearIssue, LinearIssueDetail, LinearIssueListResult, LinearIssueState,
    LinearLabel, LinearTeam, LinearUser,
};
use crate::platform::silent_command;

/// Resolve which `mcporter` binary to invoke. Honors `prefs.linear_mcporter_binary` override,
/// otherwise relies on `silent_command` finding `mcporter` on PATH (Jean already syncs the
/// user's shell PATH on macOS GUI launches, so a homebrew/bun-installed mcporter resolves).
fn resolve_mcporter_binary(app: &AppHandle) -> Result<String, String> {
    let prefs = crate::load_preferences_sync(app)?;
    Ok(prefs
        .linear_mcporter_binary
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "mcporter".to_string()))
}

/// Resolve the team filter passed to mcporter's `list_issues` / `query` tools.
/// mcporter expects a team **key** (e.g. "KCW") or name, not a UUID, so we use a separate
/// pref from `linear_team_id` (which holds a UUID and only applies to the PAT backend).
pub fn resolve_mcporter_team(app: &AppHandle) -> Result<Option<String>, String> {
    let prefs = crate::load_preferences_sync(app)?;
    Ok(prefs.linear_mcporter_team.filter(|s| !s.trim().is_empty()))
}

/// Whether the user has opted into the mcporter backend.
pub fn is_mcporter_backend(app: &AppHandle) -> Result<bool, String> {
    let prefs = crate::load_preferences_sync(app)?;
    Ok(prefs.linear_backend.as_deref() == Some("mcporter"))
}

/// Invoke `mcporter call linear.<tool> --args <json>` and parse stdout as JSON.
///
/// mcporter spawns a fresh Node process and connects to the remote Linear MCP — typical
/// call latency is hundreds of ms to ~2s. We block-execute via `silent_command` (which avoids
/// Windows console flashes and PATH issues) and parse the entire stdout as one JSON document,
/// matching the format mcporter prints.
fn call_mcporter(app: &AppHandle, tool: &str, args: Value) -> Result<Value, String> {
    let binary = resolve_mcporter_binary(app)?;
    let args_str = args.to_string();
    let qualified_tool = format!("linear.{tool}");

    log::trace!("mcporter call {qualified_tool} --args {args_str}");

    let output = silent_command(&binary)
        .args(["call", &qualified_tool, "--args", &args_str])
        .output()
        .map_err(|e| {
            format!(
                "Failed to spawn `{binary}` (configure path in Settings → Integrations → Linear): {e}"
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "mcporter call {qualified_tool} failed (exit {:?}):\n{stderr}\n{stdout}",
            output.status.code()
        ));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("mcporter returned non-UTF8 output: {e}"))?;

    serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse mcporter JSON output: {e}\n---\n{stdout}"))
}

/// Map mcporter's `statusType` string to an approximate hex color so the UI's
/// existing color-coded badges still work (mcporter doesn't return state colors).
fn status_type_to_color(status_type: &str) -> &'static str {
    match status_type {
        "backlog" => "#bec2c8",
        "unstarted" => "#e2e2e2",
        "started" => "#f2c94c",
        "completed" => "#5e6ad2",
        "canceled" => "#95a2b3",
        "triage" => "#eb5757",
        _ => "#bec2c8",
    }
}

/// Convert a single mcporter issue node into Jean's `LinearIssue`.
/// Returns `None` when required fields are missing (defensive — shouldn't happen for valid responses).
fn parse_mcporter_issue(node: &Value) -> Option<LinearIssue> {
    let identifier = node.get("id")?.as_str()?.to_string();
    let title = node.get("title")?.as_str()?.to_string();

    let status_name = node
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();
    let status_type = node
        .get("statusType")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let state_color = status_type_to_color(&status_type).to_string();

    let labels = node
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|l| l.as_str())
                .map(|name| LinearLabel {
                    name: name.to_string(),
                    color: "#a8a8a8".to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let assignee = node.get("assignee").and_then(|v| v.as_str()).map(|name| {
        // mcporter only gives a single display name string; duplicate into both name fields
        // so downstream UI rendering keeps working without nullable handling.
        LinearUser {
            name: name.to_string(),
            display_name: name.to_string(),
        }
    });

    let (priority, priority_label) = node
        .get("priority")
        .map(|p| {
            let value = p.get("value").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let label = p
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("No priority")
                .to_string();
            (value, label)
        })
        .unwrap_or((0, "No priority".to_string()));

    Some(LinearIssue {
        // mcporter doesn't expose the issue UUID; use the human identifier in both slots.
        // All Jean code paths that look up by `id` actually pass `identifier` for mcporter
        // (we route `get_issue_by_id` straight to mcporter's `get_issue` which takes the identifier).
        id: identifier.clone(),
        identifier,
        title,
        description: node
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        state: LinearIssueState {
            name: status_name,
            state_type: status_type,
            color: state_color,
        },
        labels,
        assignee,
        created_at: node
            .get("createdAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        url: node
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        priority,
        priority_label,
    })
}

/// Active-state filter — Jean's PAT path filters server-side via GraphQL, but mcporter's
/// `list_issues` doesn't expose state-type filtering. Apply it client-side.
fn is_active(issue: &LinearIssue) -> bool {
    matches!(
        issue.state.state_type.as_str(),
        "started" | "unstarted" | "backlog" | "triage"
    )
}

/// List active issues, optionally filtered by team key.
pub fn list_issues(app: &AppHandle) -> Result<LinearIssueListResult, String> {
    let team = resolve_mcporter_team(app)?;
    let mut args = json!({ "limit": 100, "orderBy": "updatedAt" });
    if let Some(t) = team {
        args["team"] = json!(t);
    }

    let response = call_mcporter(app, "list_issues", args)?;
    let nodes = response
        .get("issues")
        .and_then(|v| v.as_array())
        .ok_or("mcporter list_issues: missing `issues` array")?;

    let issues: Vec<LinearIssue> = nodes
        .iter()
        .filter_map(parse_mcporter_issue)
        .filter(is_active)
        .collect();

    Ok(LinearIssueListResult { issues })
}

/// Search issues by free-text query.
pub fn search_issues(app: &AppHandle, query: &str) -> Result<Vec<LinearIssue>, String> {
    let team = resolve_mcporter_team(app)?;
    let mut args = json!({ "query": query, "limit": 50, "orderBy": "updatedAt" });
    if let Some(t) = team {
        args["team"] = json!(t);
    }

    let response = call_mcporter(app, "list_issues", args)?;
    let nodes = response
        .get("issues")
        .and_then(|v| v.as_array())
        .ok_or("mcporter list_issues (search): missing `issues` array")?;

    let issues: Vec<LinearIssue> = nodes
        .iter()
        .filter_map(parse_mcporter_issue)
        .filter(is_active)
        .collect();

    Ok(issues)
}

/// Fetch a single issue with comments. `identifier_or_uuid` may be either Jean's
/// "id" (which for the mcporter backend is actually the human identifier) or the
/// identifier directly (e.g. "ENG-123") — mcporter's `get_issue` accepts both.
pub fn get_issue(app: &AppHandle, identifier_or_uuid: &str) -> Result<LinearIssueDetail, String> {
    let issue_response = call_mcporter(app, "get_issue", json!({ "id": identifier_or_uuid }))?;
    let base = parse_mcporter_issue(&issue_response)
        .ok_or("mcporter get_issue: failed to parse response")?;

    // Comments live in a separate endpoint. List_comments takes the issue identifier.
    let comments_response = call_mcporter(
        app,
        "list_comments",
        json!({ "issueId": &base.identifier, "limit": 250 }),
    )?;
    let comment_nodes = comments_response
        .get("comments")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let comments: Vec<LinearComment> = comment_nodes
        .iter()
        .filter_map(|c| {
            let body = c.get("body")?.as_str()?.to_string();
            let user = c
                .get("user")
                .and_then(|v| v.as_str())
                .map(|name| LinearUser {
                    name: name.to_string(),
                    display_name: name.to_string(),
                });
            let created_at = c
                .get("createdAt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(LinearComment {
                body,
                user,
                created_at,
            })
        })
        .collect();

    Ok(LinearIssueDetail {
        id: base.id,
        identifier: base.identifier,
        title: base.title,
        description: base.description,
        state: base.state,
        labels: base.labels,
        assignee: base.assignee,
        created_at: base.created_at,
        url: base.url,
        priority: base.priority,
        priority_label: base.priority_label,
        comments,
    })
}

/// Look up an issue by its numeric portion (e.g. 23) — used by branch-name / deeplink flows.
/// mcporter accepts the full identifier directly, so we reconstruct it from the configured team key.
pub fn get_issue_by_number(
    app: &AppHandle,
    issue_number: i64,
) -> Result<Option<LinearIssue>, String> {
    let team = resolve_mcporter_team(app)?
        .ok_or("Cannot look up Linear issue by number without `linear_mcporter_team` set (need a team key like \"ENG\" to form the identifier)")?;
    let identifier = format!("{team}-{issue_number}");
    let response = call_mcporter(app, "get_issue", json!({ "id": &identifier }))?;
    Ok(parse_mcporter_issue(&response))
}

/// List Linear teams the authed user can see. Returns up to 250 teams.
pub fn list_teams(app: &AppHandle) -> Result<Vec<LinearTeam>, String> {
    let response = call_mcporter(app, "list_teams", json!({ "limit": 250 }))?;
    let nodes = response
        .get("teams")
        .and_then(|v| v.as_array())
        .ok_or("mcporter list_teams: missing `teams` array")?;

    let teams: Vec<LinearTeam> = nodes
        .iter()
        .filter_map(|node| {
            // mcporter exposes id (UUID) + name; not always `key`. Synthesize key from name
            // when missing — UI surfaces `key` in the picker label, so something is better than nothing.
            let id = node.get("id")?.as_str()?.to_string();
            let name = node.get("name")?.as_str()?.to_string();
            let key = node
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or(&name)
                .to_string();
            Some(LinearTeam { id, name, key })
        })
        .collect();

    Ok(teams)
}
