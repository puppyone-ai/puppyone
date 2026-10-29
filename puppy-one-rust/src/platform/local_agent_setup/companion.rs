//! Port of `platform/macos/companion-apps.mjs`: whether a companion app
//! (Codex, Cursor) is installed, from bundle metadata only. A discovered
//! app is never launched and its data never read. An incomplete scan
//! reports `Unknown`, never absence.
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presence {
    Present,
    NotFound,
    Unknown,
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
    if !cfg!(target_os = "macos") {
        return identities
            .iter()
            .map(|(id, _)| (*id, Presence::NotFound))
            .collect();
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let roots = [PathBuf::from("/Applications"), home.join("Applications")];
    scan(
        &roots,
        identities,
        &read_bundle_identity,
        Duration::from_secs(3),
    )
}

/// `(CFBundleIdentifier, CFBundleExecutable)` of a bundle's `Info.plist`.
type Reader = dyn Fn(&Path) -> Option<(String, String)>;
pub(crate) fn scan(
    roots: &[PathBuf],
    identities: &[(&'static str, &'static str)],
    read: &Reader,
    budget: Duration,
) -> Vec<(&'static str, Presence)> {
    let deadline = Instant::now() + budget;
    let mut found: Vec<&'static str> = vec![];
    let mut incomplete = false;
    'roots: for root in roots.iter().take(2) {
        let entries = match std::fs::read_dir(root) {
            Ok(entries) => entries,
            Err(e) => {
                incomplete |= e.kind() != std::io::ErrorKind::NotFound;
                continue;
            }
        };
        for (count, entry) in entries.enumerate() {
            if count >= 256 || Instant::now() > deadline {
                incomplete = true;
                continue 'roots;
            }
            let Ok(entry) = entry else {
                incomplete = true;
                continue;
            };
            let name = entry.file_name();
            if !name.to_string_lossy().ends_with(".app") || !entry.path().is_dir() {
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
            let Some((id, _)) = identities.iter().find(|(_, b)| *b == bundle) else {
                continue;
            };
            if executable.is_empty()
                || executable.len() > 160
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
fn read_bundle_identity(plist: &Path) -> Option<(String, String)> {
    let cancel = AtomicBool::new(false);
    let path = plist.to_str()?;
    let out = crate::platform::process::run(
        Path::new("/usr/bin/plutil"),
        &["-convert", "json", "-o", "-", "--", path],
        Path::new("/"),
        None,
        Duration::from_millis(500),
        &cancel,
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
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn bundles_are_identified_by_metadata_and_gaps_stay_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let apps = dir.path().join("Applications");
        let bundle = |name: &str, id: &str, executable: bool| {
            let contents = apps.join(name).join("Contents");
            std::fs::create_dir_all(contents.join("MacOS")).unwrap();
            std::fs::write(contents.join("Info.plist"), id).unwrap();
            if executable {
                let exe = contents.join("MacOS/app");
                std::fs::write(&exe, "").unwrap();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt as _;
                    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
                }
            }
        };
        bundle("Codex.app", "com.openai.codex", true);
        bundle("Other.app", "com.example.other", true);
        let read = |plist: &Path| -> Option<(String, String)> {
            Some((std::fs::read_to_string(plist).ok()?, "app".into()))
        };
        let identities = identities();
        let missing = dir.path().join("Missing");
        let result = scan(
            &[apps.clone(), missing],
            &identities,
            &read,
            Duration::from_secs(3),
        );
        assert_eq!(
            result,
            [("codex", Presence::Present), ("cursor", Presence::NotFound)]
        );
        // A bundle without its executable makes the answer unknown.
        bundle("Cursor.app", "com.todesktop.230313mzl4w4u92", false);
        let result = scan(&[apps], &identities, &read, Duration::from_secs(3));
        assert_eq!(
            result,
            [("codex", Presence::Present), ("cursor", Presence::Unknown)]
        );
    }
    #[test]
    fn this_machine_answers_for_every_companion() {
        let identities = identities();
        let result = inspect(&identities);
        assert_eq!(
            result.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
            ["codex", "cursor"]
        );
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn plutil_reads_a_real_property_list() {
        let dir = tempfile::tempdir().unwrap();
        let plist = dir.path().join("Info.plist");
        std::fs::write(&plist, r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.openai.codex</string><key>CFBundleExecutable</key><string>Codex</string></dict></plist>"#).unwrap();
        assert_eq!(
            read_bundle_identity(&plist),
            Some(("com.openai.codex".into(), "Codex".into()))
        );
    }
}
