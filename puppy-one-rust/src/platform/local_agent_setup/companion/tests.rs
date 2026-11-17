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
    bundle("Renamed.app", "com.openai.codex", true);
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

fn make_bundle(root: &Path, name: &str, identity: &str, executable: &str, real_executable: bool) {
    let contents = root.join(name).join("Contents");
    std::fs::create_dir_all(contents.join("MacOS")).unwrap();
    std::fs::write(
        contents.join("Info.plist"),
        serde_json::to_vec(&serde_json::json!({
            "CFBundleIdentifier": identity, "CFBundleExecutable": executable
        }))
        .unwrap(),
    )
    .unwrap();
    if real_executable {
        let path = contents.join("MacOS").join(executable);
        std::fs::write(&path, "never execute this metadata fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
}
fn fixture_metadata(path: &Path) -> Option<(String, String)> {
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    Some((
        value["CFBundleIdentifier"].as_str()?.into(),
        value["CFBundleExecutable"].as_str()?.into(),
    ))
}
#[test]
fn unrelated_missing_and_invalid_executables_never_prove_companion_presence() {
    for (identity, executable, exists, expected) in [
        ("com.openai.chat", "ChatGPT", true, Presence::NotFound),
        ("com.openai.codex", "Codex", false, Presence::Unknown),
        ("com.openai.codex", "../../bin/sh", false, Presence::Unknown),
        ("com.openai.codex", ".", false, Presence::Unknown),
        ("com.openai.codex", "..", false, Presence::Unknown),
        ("com.openai.codex", "", false, Presence::Unknown),
        ("com.openai.codex", "sub\\Codex", false, Presence::Unknown),
        ("com.openai.codex", "Codex\0", false, Presence::Unknown),
        ("com.openai.codex", "Codex", true, Presence::Present),
    ] {
        let dir = tempfile::tempdir().unwrap();
        make_bundle(dir.path(), "Renamed.app", identity, executable, exists);
        let found = scan(
            &[dir.path().into()],
            &identities(),
            &fixture_metadata,
            Duration::from_secs(3),
        );
        assert_eq!(found[0], ("codex", expected), "{identity} {executable:?}");
        assert_eq!(found.len(), 2);
    }
}
#[test]
fn unreadable_roots_and_metadata_are_unknown_while_missing_roots_are_absence() {
    let dir = tempfile::tempdir().unwrap();
    let unreadable = dir.path().join("not-a-directory");
    std::fs::write(&unreadable, "private filesystem failure").unwrap();
    let unknown = scan(
        &[unreadable],
        &identities(),
        &fixture_metadata,
        Duration::from_secs(3),
    );
    assert!(unknown.iter().all(|(_, p)| *p == Presence::Unknown));
    let missing = scan(
        &[dir.path().join("missing")],
        &identities(),
        &fixture_metadata,
        Duration::from_secs(3),
    );
    assert!(missing.iter().all(|(_, p)| *p == Presence::NotFound));
    make_bundle(dir.path(), "Renamed.app", "com.openai.codex", "Codex", true);
    let unknown = scan(
        &[dir.path().into()],
        &identities(),
        &|_| None,
        Duration::from_secs(3),
    );
    assert!(unknown.iter().all(|(_, p)| *p == Presence::Unknown));
    std::fs::write(
        dir.path().join("Renamed.app/Contents/Info.plist"),
        vec![b'x'; 128 * 1024 + 1],
    )
    .unwrap();
    let unknown = scan(
        &[dir.path().into()],
        &identities(),
        &|_| panic!("oversized plist must not be read"),
        Duration::from_secs(3),
    );
    assert!(unknown.iter().all(|(_, p)| *p == Presence::Unknown));
}
#[test]
fn entry_budget_deadline_and_cancellation_never_turn_partial_metadata_into_absence() {
    let dir = tempfile::tempdir().unwrap();
    for index in 0..257 {
        std::fs::write(dir.path().join(format!("entry-{index}")), "").unwrap();
    }
    let unknown = scan(
        &[dir.path().into()],
        &identities(),
        &fixture_metadata,
        Duration::from_secs(3),
    );
    assert!(unknown.iter().all(|(_, p)| *p == Presence::Unknown));
    std::fs::remove_file(dir.path().join("entry-256")).unwrap();
    let absent = scan(
        &[dir.path().into()],
        &identities(),
        &fixture_metadata,
        Duration::from_secs(3),
    );
    assert!(absent.iter().all(|(_, p)| *p == Presence::NotFound));
    let dir = tempfile::tempdir().unwrap();
    make_bundle(dir.path(), "Renamed.app", "com.openai.codex", "Codex", true);
    let unknown = scan(
        &[dir.path().into()],
        &identities(),
        &|_| panic!("deadline expired"),
        Duration::ZERO,
    );
    assert!(unknown.iter().all(|(_, p)| *p == Presence::Unknown));
    let cancel = AtomicBool::new(true);
    let unknown = scan_with_cancel(
        &[dir.path().into()],
        &identities(),
        &|_| panic!("cancelled before read"),
        Duration::from_secs(3),
        &cancel,
    );
    assert!(unknown.iter().all(|(_, p)| *p == Presence::Unknown));
    cancel.store(false, Ordering::Relaxed);
    let unknown = scan_with_cancel(
        &[dir.path().into()],
        &identities(),
        &|path| {
            cancel.store(true, Ordering::Relaxed);
            fixture_metadata(path)
        },
        Duration::from_secs(3),
        &cancel,
    );
    assert!(unknown.iter().all(|(_, p)| *p == Presence::Unknown));
}
