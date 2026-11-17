//! Port of `platform/macos/companion-apps.mjs`: whether a companion app
//! (Codex, Cursor) is installed, from bundle metadata only. A discovered
//! app is never launched and its data never read. An incomplete scan
//! reports `Unknown`, never absence.
mod io;
pub mod session;

use std::{
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presence {
    Present,
    NotFound,
    Unknown,
    Unsupported,
}
/// The companions of the setup routes: (setup id, bundle identifier).
pub fn identities() -> Vec<(&'static str, &'static str)> {
    super::ROUTES
        .iter()
        .filter_map(|r| r.companion.map(|bundle| (r.id, bundle)))
        .collect()
}
/// `inspect` over `/Applications` and `~/Applications` (256 entries each,
/// three seconds in all).
pub fn inspect(identities: &[(&'static str, &'static str)]) -> Vec<(&'static str, Presence)> {
    inspect_with_cancel(identities, &AtomicBool::new(false))
}
pub fn inspect_with_cancel(
    identities: &[(&'static str, &'static str)],
    cancel: &AtomicBool,
) -> Vec<(&'static str, Presence)> {
    static PORT: OnceLock<io::Port> = OnceLock::new();
    let targets = identities.to_vec();
    PORT.get_or_init(io::Port::default).inspect(
        super::platform(),
        identities,
        cancel,
        Duration::from_secs(3),
        move |signal| {
            let Some(home) = std::env::var_os("HOME").filter(|home| !home.is_empty()) else {
                return targets
                    .iter()
                    .map(|(id, _)| (*id, Presence::Unknown))
                    .collect();
            };
            let roots = [
                PathBuf::from("/Applications"),
                PathBuf::from(home).join("Applications"),
            ];
            scan_with_cancel(
                &roots,
                &targets,
                &|path| read_bundle_identity_with_cancel(path, &signal),
                Duration::from_secs(3),
                &signal,
            )
        },
    )
}

/// `(CFBundleIdentifier, CFBundleExecutable)` of a bundle's `Info.plist`.
type Reader<'a> = dyn Fn(&Path) -> Option<(String, String)> + 'a;
#[cfg(test)]
pub(crate) fn scan(
    roots: &[PathBuf],
    identities: &[(&'static str, &'static str)],
    read: &Reader<'_>,
    budget: Duration,
) -> Vec<(&'static str, Presence)> {
    scan_with_cancel(roots, identities, read, budget, &AtomicBool::new(false))
}
fn scan_with_cancel(
    roots: &[PathBuf],
    identities: &[(&'static str, &'static str)],
    read: &Reader<'_>,
    budget: Duration,
    cancel: &AtomicBool,
) -> Vec<(&'static str, Presence)> {
    let deadline = Instant::now() + budget;
    let mut found: Vec<&'static str> = vec![];
    let mut incomplete = false;
    'roots: for root in roots.iter().take(2) {
        if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
            incomplete = true;
            break;
        }
        let entries = match std::fs::read_dir(root) {
            Ok(entries) => entries,
            Err(e) => {
                incomplete |= e.kind() != std::io::ErrorKind::NotFound;
                continue;
            }
        };
        for (count, entry) in entries.enumerate() {
            if count >= 256 || cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
                incomplete = true;
                continue 'roots;
            }
            let Ok(entry) = entry else {
                incomplete = true;
                continue;
            };
            let name = entry.file_name();
            if !name.to_string_lossy().ends_with(".app")
                || !entry.file_type().is_ok_and(|kind| kind.is_dir())
            {
                continue;
            }
            let contents = entry.path().join("Contents");
            let plist = contents.join("Info.plist");
            match std::fs::metadata(&plist) {
                Ok(m) if m.is_file() && m.len() <= 128 * 1024 => {}
                _ => {
                    incomplete = true;
                    continue;
                }
            }
            let Some((bundle, executable)) = read(&plist) else {
                incomplete = true;
                continue;
            };
            if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
                incomplete = true;
                break 'roots;
            }
            let Some((id, _)) = identities.iter().find(|(_, b)| *b == bundle) else {
                continue;
            };
            if executable.is_empty()
                || executable.chars().count() > 160
                || executable.contains(['/', '\\', '\0'])
                || executable == "."
                || executable == ".."
                || !executable_file(&contents.join("MacOS").join(&executable))
            {
                incomplete = true;
                continue;
            }
            if !found.contains(id) {
                found.push(id);
            }
            if found.len() == identities.len() {
                break 'roots;
            }
        }
    }
    identities
        .iter()
        .map(|(id, _)| {
            let presence = if found.contains(id) {
                Presence::Present
            } else if incomplete {
                Presence::Unknown
            } else {
                Presence::NotFound
            };
            (*id, presence)
        })
        .collect()
}
fn executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        path.metadata()
            .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    path.is_file()
}
/// `readBundleMetadata`: `plutil` converts the property list (binary or
/// XML) to JSON within half a second.
#[cfg(test)]
fn read_bundle_identity(plist: &Path) -> Option<(String, String)> {
    read_bundle_identity_with_cancel(plist, &AtomicBool::new(false))
}
fn read_bundle_identity_with_cancel(plist: &Path, cancel: &AtomicBool) -> Option<(String, String)> {
    let path = plist.to_str()?;
    let out = crate::platform::process::run(
        Path::new("/usr/bin/plutil"),
        &["-convert", "json", "-o", "-", "--", path],
        Path::new("/"),
        None,
        Duration::from_millis(500),
        cancel,
    )
    .ok()?;
    if out.len() > 128 * 1024 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&out).ok()?;
    Some((
        value.get("CFBundleIdentifier")?.as_str()?.to_owned(),
        value
            .get("CFBundleExecutable")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_owned(),
    ))
}

#[cfg(test)]
mod tests;
