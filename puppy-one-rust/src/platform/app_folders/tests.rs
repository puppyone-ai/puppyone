use super::*;

fn places(dir: &Path) -> Places {
    Places {
        home: dir.join("home"),
        app_data: dir.join("data"),
    }
}

#[test]
fn obsidian_offers_its_vaults_that_still_exist_newest_first() {
    let dir = tempfile::tempdir().unwrap();
    let (old, new) = (dir.path().join("Old"), dir.path().join("New"));
    std::fs::create_dir(&old).unwrap();
    std::fs::create_dir(&new).unwrap();
    std::fs::create_dir_all(dir.path().join("data/obsidian")).unwrap();
    let registry = serde_json::json!({ "vaults": {
        "a": { "path": old, "ts": 1 },
        "b": { "path": new, "ts": 9 },
        "c": { "path": dir.path().join("Gone"), "ts": 5 },
        "d": { "path": "relative/vault", "ts": 7 },
    }});
    std::fs::write(
        dir.path().join("data/obsidian/obsidian.json"),
        registry.to_string(),
    )
    .unwrap();
    let folders = list("obsidian", &places(dir.path())).unwrap();
    let names: Vec<_> = folders.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["New", "Old"]);
    assert_eq!(folders[0].last_used_at, Some(9));
}

#[test]
fn vs_code_and_cursor_offer_local_folders_from_their_history() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let storage = dir.path().join("data/Cursor/User/globalStorage");
    std::fs::create_dir_all(&storage).unwrap();
    let connection = rusqlite::Connection::open(storage.join("state.vscdb")).unwrap();
    connection
        .execute(
            "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
            [],
        )
        .unwrap();
    let history = serde_json::json!({ "entries": [
        { "folderUri": url::Url::from_file_path(&project).unwrap().to_string() },
        { "folderUri": "vscode-remote://ssh-remote+box/home/x", "remoteAuthority": "ssh-remote+box" },
        { "fileUri": "file:///tmp/a.md" },
        { "folderUri": "file:///%E0%A4%A" },
    ]});
    connection
        .execute(
            "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
            ["history.recentlyOpenedPathsList", &history.to_string()],
        )
        .unwrap();
    drop(connection);
    let folders = list("cursor", &places(dir.path())).unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].name, "project");
    // VS Code is not installed here: nothing to offer, not a failure.
    assert_eq!(list("vscode", &places(dir.path())), Ok(vec![]));
}

/// Typora's preferences also keep dates and data, which a whole-file
/// JSON conversion refuses; its recent folders are still read.
#[cfg(target_os = "macos")]
#[test]
fn typora_offers_its_recent_folders_beside_values_json_cannot_carry() {
    let dir = tempfile::tempdir().unwrap();
    let notes = dir.path().join("notes");
    std::fs::create_dir(&notes).unwrap();
    let prefs = dir.path().join("home/Library/Preferences");
    std::fs::create_dir_all(&prefs).unwrap();
    let plist = prefs.join("abnerworks.Typora.plist");
    let plutil = |args: &[&str]| {
        let status = std::process::Command::new("/usr/bin/plutil")
            .args(args)
            .arg(&plist)
            .status()
            .unwrap();
        assert!(status.success(), "{args:?}");
    };
    plutil(&["-create", "xml1"]);
    plutil(&["-insert", "lastLaunch", "-date", "2026-11-14T00:00:00Z"]);
    plutil(&["-insert", "opaqueData", "-data", "AQID"]);
    assert_eq!(
        list("typora", &places(dir.path())),
        Ok(vec![]),
        "no folder yet"
    );
    plutil(&["-insert", "recentFolder", "-array"]);
    plutil(&[
        "-insert",
        "recentFolder.0",
        "-string",
        &notes.to_string_lossy(),
    ]);
    let folders = list("typora", &places(dir.path())).unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].name, "notes");
}

#[test]
fn a_record_that_cannot_be_read_is_an_error_and_unknown_apps_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("data/obsidian")).unwrap();
    std::fs::write(dir.path().join("data/obsidian/obsidian.json"), "{not json").unwrap();
    assert!(list("obsidian", &places(dir.path())).is_err());
    assert!(list("notion", &places(dir.path())).is_err());
    assert_eq!(list("typora", &places(dir.path())), Ok(vec![]));
}

fn history(root: &Path, product: &str, value: &[u8], blob: bool) -> PathBuf {
    let database = root.join(product).join("User/globalStorage/state.vscdb");
    std::fs::create_dir_all(database.parent().unwrap()).unwrap();
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value)", [])
        .unwrap();
    if blob {
        connection
            .execute(
                "INSERT INTO ItemTable VALUES (?, ?)",
                rusqlite::params!["history.recentlyOpenedPathsList", value],
            )
            .unwrap();
    } else {
        connection
            .execute(
                "INSERT INTO ItemTable VALUES (?, ?)",
                [
                    "history.recentlyOpenedPathsList",
                    std::str::from_utf8(value).unwrap(),
                ],
            )
            .unwrap();
    }
    drop(connection);
    database
}

#[test]
fn app_data_routing_uses_each_platform_override_and_default_without_mutating_the_environment() {
    let root = tempfile::tempdir().unwrap();
    for (platform, key, suffix) in [
        ("linux", "XDG_CONFIG_HOME", ".config"),
        ("windows", "APPDATA", "AppData/Roaming"),
        ("macos", "ignored", "Library/Application Support"),
    ] {
        let home = root.path().join(platform);
        assert_eq!(
            Places::for_platform(home.clone(), platform, |_| None).app_data,
            home.join(suffix)
        );
        let overridden = root.path().join(format!("override-{platform}"));
        let places = Places::for_platform(home.clone(), platform, |name| {
            (platform == "macos" || name == key).then(|| overridden.clone().into_os_string())
        });
        assert_eq!(
            places.app_data,
            if platform == "macos" {
                home.join(suffix)
            } else {
                overridden
            }
        );
        let folder = home.join("notes");
        std::fs::create_dir_all(&folder).unwrap();
        history(&places.app_data, "Cursor", serde_json::json!({"entries":[{"folderUri":url::Url::from_file_path(&folder).unwrap().to_string()}]}).to_string().as_bytes(), false);
        assert_eq!(
            list("cursor", &places)
                .unwrap()
                .iter()
                .map(|f| f.path.clone())
                .collect::<Vec<_>>(),
            [folder]
        );
    }
}

#[test]
fn sqlite_history_rejects_malformed_uris_without_hiding_valid_local_folders_or_writing_records() {
    let root = tempfile::tempdir().unwrap();
    let plain = root.path().join("Notes space 中文");
    let falsey = root.path().join("Local with empty remote marker");
    let escaped = root.path().join("nested/child");
    let malformed = root.path().join("broken%ZZ");
    for folder in [&plain, &falsey, &escaped, &malformed] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let uri = url::Url::from_file_path(&plain).unwrap().to_string();
    let base = url::Url::from_directory_path(root.path())
        .unwrap()
        .to_string();
    let entries = serde_json::json!({"entries":[
        {"folderUri":format!("{base}broken%ZZ")},
        {"folderUri":format!("{base}nested%2fchild")},
        {"folderUri":format!("{base}broken%00")},
        {"folderUri":format!("{base}bad%FF")},
        {"folderUri":uri}, {"folderUri":uri},
        {"folderUri":url::Url::from_file_path(&falsey).unwrap().to_string(), "remoteAuthority":""},
        {"folderUri":uri, "remoteAuthority":"ssh-remote+host"},
        {"folderUri":"vscode-remote://host/remote"}, {"fileUri":uri}
    ]})
    .to_string();
    for (app, product, blob) in [("vscode", "Code", false), ("cursor", "Cursor", true)] {
        let database = history(
            &places(root.path()).app_data,
            product,
            entries.as_bytes(),
            blob,
        );
        let before = std::fs::read(&database).unwrap();
        let found = list(app, &places(root.path())).unwrap();
        assert_eq!(
            found.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
            [plain.clone(), falsey.clone()]
        );
        assert!(found.iter().all(|f| f.last_used_at.is_none()));
        assert_eq!(std::fs::read(&database).unwrap(), before);
        assert_eq!(
            std::fs::read_dir(database.parent().unwrap())
                .unwrap()
                .count(),
            1
        );
    }
}

#[test]
fn discovery_distinguishes_missing_corrupt_and_wrong_type_records() {
    for kind in [
        std::io::ErrorKind::PermissionDenied,
        std::io::ErrorKind::InvalidData,
        std::io::ErrorKind::Other,
    ] {
        assert!(matches!(
            Read::from(std::io::Error::from(kind)),
            Read::Failed(_)
        ));
    }

    let root = tempfile::tempdir().unwrap();
    let p = places(root.path());
    for app in APPS {
        assert_eq!(list(app, &p), Ok(vec![]));
    }
    for name in ["unknown", "__proto__", "constructor", "notion"] {
        assert!(list(name, &p).is_err());
    }
    let database = history(&p.app_data, "Code", b"not JSON", false);
    assert!(list("vscode", &p).is_err());
    std::fs::write(&database, b"not SQLite").unwrap();
    assert!(list("vscode", &p).is_err());
    std::fs::remove_file(&database).unwrap();
    std::fs::create_dir(&database).unwrap();
    assert!(
        list("vscode", &p).is_err(),
        "a directory is not an absent database"
    );
    // ENOTDIR, like ENOENT, means the app has no record at this location.
    std::fs::create_dir_all(p.app_data.join("Cursor")).unwrap();
    std::fs::write(p.app_data.join("Cursor/User"), b"not a directory").unwrap();
    assert_eq!(list("cursor", &p), Ok(vec![]));
}

#[cfg(unix)]
#[test]
fn filesystem_read_failures_are_reported_instead_of_being_treated_as_missing() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let p = places(root.path());
    let database = p.app_data.join("Cursor/User/globalStorage/state.vscdb");
    std::fs::create_dir_all(database.parent().unwrap()).unwrap();
    symlink("state.vscdb", &database).unwrap();
    assert!(
        list("cursor", &p).is_err(),
        "ELOOP is a read failure, not no record"
    );
    let cycle = root.path().join("cycle");
    symlink("cycle", &cycle).unwrap();
    std::fs::create_dir_all(p.app_data.join("obsidian")).unwrap();
    std::fs::write(
        p.app_data.join("obsidian/obsidian.json"),
        serde_json::json!({"vaults":{"a":{"path":cycle}}}).to_string(),
    )
    .unwrap();
    assert!(
        list("obsidian", &p).is_err(),
        "candidate metadata failure must remain visible"
    );
}

#[test]
fn obsidian_caps_unique_existing_folders_at_fifty_and_preserves_their_contents() {
    let root = tempfile::tempdir().unwrap();
    let p = places(root.path());
    let mut vaults = serde_json::Map::new();
    vaults.insert("invalid".into(), serde_json::Value::Null);
    vaults.insert(
        "missing".into(),
        serde_json::json!({"path":root.path().join("missing"),"ts":1000}),
    );
    vaults.insert(
        "relative".into(),
        serde_json::json!({"path":"relative","ts":1000}),
    );
    vaults.insert(
        "null".into(),
        serde_json::json!({"path":"/bad\u{0}path","ts":1000}),
    );
    let mut expected = vec![];
    for index in 0..55 {
        let folder = root.path().join(format!("vault-{index:02}"));
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("note.md"), format!("original {index}")).unwrap();
        vaults.insert(
            format!("v{index}"),
            serde_json::json!({"path":folder,"ts":index}),
        );
        if index >= 5 {
            expected.push(folder);
        }
    }
    vaults.insert(
        "duplicate".into(),
        serde_json::json!({"path":root.path().join("vault-54/../vault-54"),"ts":54}),
    );
    std::fs::create_dir_all(p.app_data.join("obsidian")).unwrap();
    std::fs::write(
        p.app_data.join("obsidian/obsidian.json"),
        serde_json::json!({"vaults":vaults}).to_string(),
    )
    .unwrap();
    expected.reverse();
    let found = list("obsidian", &p).unwrap();
    assert_eq!(
        found.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
        expected
    );
    for index in 0..55 {
        let folder = root.path().join(format!("vault-{index:02}"));
        assert_eq!(
            std::fs::read_to_string(folder.join("note.md")).unwrap(),
            format!("original {index}")
        );
        assert_eq!(std::fs::read_dir(folder).unwrap().count(), 1);
    }
}

#[test]
fn typora_is_not_read_outside_macos_even_when_a_record_exists() {
    let root = tempfile::tempdir().unwrap();
    let p = places(root.path());
    let plist = p.home.join("Library/Preferences/abnerworks.Typora.plist");
    std::fs::create_dir_all(plist.parent().unwrap()).unwrap();
    std::fs::write(plist, b"corrupt plist").unwrap();
    assert!(
        matches!(typora_with(&p, false, Path::new("unavailable-converter"), Duration::ZERO), Ok(v) if v.is_empty())
    );
}

#[cfg(unix)]
#[test]
fn plist_conversion_has_bounded_time_output_and_an_owned_child_lifetime() {
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(PLIST_TIMEOUT, Duration::from_secs(5));
    let root = tempfile::tempdir().unwrap();
    let p = places(root.path());
    let plist = p.home.join("Library/Preferences/abnerworks.Typora.plist");
    std::fs::create_dir_all(plist.parent().unwrap()).unwrap();
    std::fs::write(&plist, b"fixture").unwrap();
    let executable = root.path().join("converter");
    for (script, timeout, expected) in [
        (
            "echo $$ > child.pid\nsleep 30\n",
            Duration::from_millis(100),
            "timed out",
        ),
        ("head -c 1048577 /dev/zero\n", PLIST_TIMEOUT, "output limit"),
        (
            "printf 'broken plist' >&2\nexit 1\n",
            PLIST_TIMEOUT,
            "broken plist",
        ),
    ] {
        std::fs::write(&executable, format!("#!/bin/sh\n{script}")).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let start = std::time::Instant::now();
        let error = match typora_with(&p, true, &executable, timeout) {
            Err(Read::Failed(error)) => error,
            _ => panic!("conversion did not fail"),
        };
        assert!(error.contains(expected), "{error}");
        assert!(start.elapsed() < timeout + Duration::from_secs(3));
        let pid = plist.parent().unwrap().join("child.pid");
        if let Ok(pid) = std::fs::read_to_string(&pid) {
            let pid: i32 = pid.trim().parse().unwrap();
            assert_eq!(unsafe { libc::kill(pid, 0) }, -1, "converter still running");
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH)
            );
        }
    }
    std::fs::write(
        &executable,
        "#!/bin/sh\nprintf 'No value at that key path' >&2\nexit 1\n",
    )
    .unwrap();
    assert!(matches!(typora_with(&p, true, &executable, PLIST_TIMEOUT), Ok(v) if v.is_empty()));
}
