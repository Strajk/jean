// Enumerate and play OS-provided notification sounds.
//
// Sounds are looked up at request time (not cached) so users dropping files into
// their personal sound folder see them immediately. Playback is delegated to the
// OS — `afplay` on macOS, PowerShell's SoundPlayer on Windows, `paplay` on Linux —
// so we never have to teach the WebView how to decode AIFF or worry about codecs.
//
// The frontend identifies a system sound by `id` (a stable filesystem-name-derived
// string). The frontend never sends a path; we always re-resolve the id against
// the live filesystem listing so a malicious id can't escape the sound dirs.

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::platform::silent_command;

#[derive(Debug, Clone, Serialize)]
pub struct SystemSound {
    pub id: String,    // stable identifier persisted in preferences (e.g. "Glass")
    pub label: String, // human-readable label shown in the dropdown
}

#[cfg(target_os = "macos")]
fn sound_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/System/Library/Sounds"),
        PathBuf::from("/Library/Sounds"),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("Library/Sounds"));
    }
    dirs
}

#[cfg(target_os = "windows")]
fn sound_dirs() -> Vec<PathBuf> {
    // %SystemRoot%\Media holds the stock Windows alert sounds.
    let system_root =
        std::env::var_os("SystemRoot").unwrap_or_else(|| std::ffi::OsString::from("C:\\Windows"));
    vec![PathBuf::from(system_root).join("Media")]
}

#[cfg(target_os = "linux")]
fn sound_dirs() -> Vec<PathBuf> {
    // Freedesktop sound theme — most desktops ship the "freedesktop" theme stereo set.
    // Distro/desktop-specific themes live alongside; we only show the common one here
    // to avoid drowning the user in dozens of near-identical clicks.
    vec![PathBuf::from("/usr/share/sounds/freedesktop/stereo")]
}

fn allowed_extensions() -> &'static [&'static str] {
    // Anything the OS player can decode is fair game.
    &["aiff", "aif", "wav", "mp3", "m4a", "ogg", "oga", "flac"]
}

/// Scan the platform sound directories and return a deduped, alphabetically-sorted
/// list. Later directories override earlier ones (so a user-installed sound with
/// the same name wins over a system one — same precedence the OS uses itself).
fn collect_sounds() -> Vec<(String, PathBuf)> {
    let mut by_id: std::collections::BTreeMap<String, PathBuf> = std::collections::BTreeMap::new();
    let exts = allowed_extensions();

    for dir in sound_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            if !exts.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            // Filter ids to a safe charset — the id is only ever used as a lookup
            // key and as part of a label, never as a path component.
            if stem.is_empty()
                || !stem
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ')
            {
                continue;
            }
            by_id.insert(stem.to_string(), path);
        }
    }

    by_id.into_iter().collect()
}

#[tauri::command]
pub fn list_system_sounds() -> Vec<SystemSound> {
    collect_sounds()
        .into_iter()
        .map(|(id, _path)| SystemSound {
            label: id.clone(),
            id,
        })
        .collect()
}

fn resolve_sound_path(id: &str) -> Option<PathBuf> {
    collect_sounds()
        .into_iter()
        .find(|(sound_id, _)| sound_id == id)
        .map(|(_, path)| path)
}

#[cfg(target_os = "macos")]
fn play(path: &Path) -> Result<(), String> {
    silent_command("afplay")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("afplay failed: {e}"))
}

#[cfg(target_os = "windows")]
fn play(path: &Path) -> Result<(), String> {
    // SoundPlayer.Play() returns immediately (async); PlaySync would block the
    // command. We single-quote the path and escape embedded single quotes for
    // PowerShell's literal-string parsing — the path itself is filesystem-resolved,
    // not user-typed, but defense in depth doesn't hurt.
    let escaped = path.to_string_lossy().replace('\'', "''");
    let script = format!("(New-Object System.Media.SoundPlayer '{escaped}').Play()");
    silent_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("powershell failed: {e}"))
}

#[cfg(target_os = "linux")]
fn play(path: &Path) -> Result<(), String> {
    // paplay is part of pulseaudio-utils, present on most desktops. If it's missing
    // there's no good universal fallback (aplay can't play ogg, etc.) so we surface
    // the error to the frontend which falls back to the synthesized beep.
    silent_command("paplay")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("paplay failed: {e}"))
}

#[tauri::command]
pub fn play_system_sound(id: String) -> Result<(), String> {
    // Cap id length defensively. Real ids are filenames, well under this.
    if id.is_empty() || id.len() > 200 {
        return Err("Invalid sound id".to_string());
    }
    let path = resolve_sound_path(&id).ok_or_else(|| format!("Unknown system sound: {id}"))?;
    play(&path)
}
