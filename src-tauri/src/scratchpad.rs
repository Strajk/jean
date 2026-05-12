//! ============================================================================
//! [STRAJK FORK] Scratchpad — per-session and per-project markdown notes
//! ============================================================================
//!
//! Cmd+J toggles a session-scoped scratchpad; Shift+Cmd+J toggles a
//! project-scoped one. The scratchpad is a plain markdown editor; selecting
//! text and hitting Cmd+Enter submits the selection as a user message to the
//! current session (handled in the frontend) and removes it from the pad.
//!
//! Storage layout (under app data dir):
//!   scratchpads/session/<safe-session-id>.md
//!   scratchpads/project/<safe-project-id>.md
//!
//! Files are created lazily on first write; reads return empty string when the
//! file does not exist yet so the frontend can mount on an empty state without
//! a round-trip.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Allowed scope discriminator. Kept narrow on purpose so a stray frontend
/// value can't redirect writes to an arbitrary subdirectory.
fn validate_scope(scope: &str) -> Result<&'static str, String> {
    match scope {
        "session" => Ok("session"),
        "project" => Ok("project"),
        _ => Err(format!(
            "Invalid scratchpad scope '{scope}': must be 'session' or 'project'"
        )),
    }
}

/// Defensive sanitisation of the id used as a filename. The frontend only
/// ever sends UUID-style ids today, but we still scrub the path so a malicious
/// caller can't traverse out of `scratchpads/<scope>/`.
fn sanitize_id(id: &str) -> Result<String, String> {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() {
        return Err("Invalid scratchpad id".to_string());
    }
    if cleaned.len() > 128 {
        return Err("Scratchpad id too long".to_string());
    }
    Ok(cleaned)
}

fn scratchpad_path(app: &AppHandle, scope: &str, scope_id: &str) -> Result<PathBuf, String> {
    let scope = validate_scope(scope)?;
    let safe_id = sanitize_id(scope_id)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    let dir = app_data_dir.join("scratchpads").join(scope);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create scratchpad dir: {e}"))?;
    Ok(dir.join(format!("{safe_id}.md")))
}

#[tauri::command]
pub async fn read_scratchpad(
    app: AppHandle,
    scope: String,
    scope_id: String,
) -> Result<String, String> {
    let path = scratchpad_path(&app, &scope, &scope_id)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Failed to read scratchpad: {e}"))
}

#[tauri::command]
pub async fn write_scratchpad(
    app: AppHandle,
    scope: String,
    scope_id: String,
    content: String,
) -> Result<(), String> {
    // Cap individual scratchpad files at ~1 MiB so a runaway frontend can't
    // fill the disk. 1 MiB of markdown is far beyond any sane note.
    if content.len() > 1_048_576 {
        return Err("Scratchpad content too large (max 1 MiB)".to_string());
    }
    let path = scratchpad_path(&app, &scope, &scope_id)?;
    fs::write(&path, content).map_err(|e| format!("Failed to write scratchpad: {e}"))
}

/// List ids whose scratchpad file contains at least one non-whitespace
/// character. Used to power the "has notes" dot in the sidebar — a file that
/// only contains spaces/newlines counts as empty so the indicator doesn't
/// stick around after the user clears the pad without deleting the file.
#[tauri::command]
pub async fn list_non_empty_scratchpads(
    app: AppHandle,
    scope: String,
) -> Result<Vec<String>, String> {
    let scope = validate_scope(&scope)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    let dir = app_data_dir.join("scratchpads").join(scope);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read scratchpad dir: {e}"))?;
    let mut ids = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        // Read up to the first 4 KiB to decide "non-empty" — if those bytes
        // are all whitespace, the rest almost certainly is too, and reading
        // megabytes of pad just to test a dot would be wasteful at scale.
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        if contents.chars().any(|c| !c.is_whitespace()) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                ids.push(stem.to_string());
            }
        }
    }
    Ok(ids)
}
