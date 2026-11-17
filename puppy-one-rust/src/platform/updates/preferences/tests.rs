use super::*;
use serde_json::{Value, json};
use std::{fs, io};

const NAME: &str = "desktop-update-preferences.json";

#[test]
fn versioned_preferences_accept_only_an_explicit_boolean_opt_out() {
    let dir = tempfile::tempdir().unwrap();
    assert!(read_automatic_download(dir.path()));
    for (value, enabled) in [
        (
            json!({"schemaVersion":1,"automaticallyDownloadUpdates":false}),
            false,
        ),
        (
            json!({"schemaVersion":1,"automaticallyDownloadUpdates":true}),
            true,
        ),
        (
            json!({"schemaVersion":2,"automaticallyDownloadUpdates":false}),
            true,
        ),
        (
            json!({"schemaVersion":"1","automaticallyDownloadUpdates":false}),
            true,
        ),
        (
            json!({"schemaVersion":null,"automaticallyDownloadUpdates":false}),
            true,
        ),
        (
            json!({"schemaVersion":1,"automaticallyDownloadUpdates":"false"}),
            true,
        ),
        (
            json!({"schemaVersion":1,"automaticallyDownloadUpdates":0}),
            true,
        ),
        (json!({"schemaVersion":1}), true),
        (json!([false]), true),
        (Value::Null, true),
    ] {
        fs::write(dir.path().join(NAME), value.to_string()).unwrap();
        assert_eq!(read_automatic_download(dir.path()), enabled, "{value}");
    }
}

#[test]
fn legacy_native_opt_out_survives_and_the_next_write_migrates_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(NAME);
    fs::write(&path, r#"{"automaticallyDownloadUpdates":false}"#).unwrap();
    assert!(!read_automatic_download(dir.path()));
    write_automatic_download(dir.path(), false).unwrap();
    let stored: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(
        stored,
        json!({"schemaVersion":1,"automaticallyDownloadUpdates":false})
    );
    // Only the exact document emitted by the old native writer is a legacy document.
    fs::write(
        &path,
        r#"{"automaticallyDownloadUpdates":false,"unknown":1}"#,
    )
    .unwrap();
    assert!(read_automatic_download(dir.path()));
}

#[test]
fn persistence_is_private_and_updates_in_caller_order() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("profile");
    for enabled in [false, true, false] {
        write_automatic_download(&data, enabled).unwrap();
        assert_eq!(read_automatic_download(&data), enabled);
    }
    let path = data.join(NAME);
    assert_eq!(fs::read_dir(&data).unwrap().count(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&data).unwrap().permissions().mode() & 0o777,
            0o700
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        write_automatic_download(&data, true).unwrap();
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn invalid_destination_fails_without_residue_and_a_later_write_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(NAME);
    fs::create_dir(&path).unwrap();
    fs::write(path.join("untouched"), b"keep").unwrap();
    assert!(write_automatic_download(dir.path(), false).is_err());
    assert_eq!(fs::read(path.join("untouched")).unwrap(), b"keep");
    assert_eq!(
        fs::read_dir(dir.path()).unwrap().count(),
        1,
        "failed replacement left a temporary file"
    );
    fs::remove_file(path.join("untouched")).unwrap();
    fs::remove_dir(&path).unwrap();
    write_automatic_download(dir.path(), true).unwrap();
    assert!(read_automatic_download(dir.path()));
    for enabled in [false, true, false] {
        write_automatic_download(dir.path(), enabled).unwrap();
    }
    assert!(!read_automatic_download(dir.path()));
}

#[test]
fn absent_directory_is_not_a_valid_persistence_destination() {
    const CHILD: &str = "PUPPYONE_UPDATE_EMPTY_PATH_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let dir = tempfile::tempdir().unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "platform::updates::preferences::tests::absent_directory_is_not_a_valid_persistence_destination", "--nocapture"])
            .env(CHILD, "1")
            .current_dir(dir.path())
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        return;
    }
    for path in ["", "   "] {
        let error = write_automatic_download(Path::new(path), false).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        let mut warnings = 0;
        assert!(read_with_warning(Path::new(path), |_| warnings += 1));
        assert_eq!(warnings, 1);
    }
}

#[cfg(unix)]
#[test]
fn preference_links_are_not_read_and_atomic_writes_never_modify_their_targets() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("profile");
    fs::create_dir(&data).unwrap();
    let outside = dir.path().join("outside.json");
    let contents = br#"{"schemaVersion":1,"automaticallyDownloadUpdates":false}"#;
    fs::write(&outside, contents).unwrap();
    symlink(&outside, data.join(NAME)).unwrap();
    assert!(read_automatic_download(&data));
    symlink(&outside, data.join(".desktop-update-preferences.json.tmp")).unwrap();
    write_automatic_download(&data, true).unwrap();
    assert_eq!(fs::read(outside).unwrap(), contents);
    assert!(
        !fs::symlink_metadata(data.join(NAME))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(
        fs::symlink_metadata(data.join(".desktop-update-preferences.json.tmp"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(read_automatic_download(&data));
}

#[test]
fn oversized_or_nonregular_preferences_fall_back_to_automatic_downloads() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(NAME);
    let mut bytes = br#"{"schemaVersion":1,"automaticallyDownloadUpdates":false}"#.to_vec();
    bytes.resize(64 * 1024, b' ');
    fs::write(&path, &bytes).unwrap();
    assert!(
        !read_automatic_download(dir.path()),
        "the limit is inclusive"
    );
    bytes.push(b' ');
    fs::write(&path, bytes).unwrap();
    assert!(read_automatic_download(dir.path()));
    fs::write(&path, "not json").unwrap();
    assert!(read_automatic_download(dir.path()));
    fs::remove_file(&path).unwrap();
    fs::create_dir(path).unwrap();
    assert!(read_automatic_download(dir.path()));
}

#[test]
fn missing_and_unsupported_documents_are_quiet_but_unreadable_preferences_warn_once() {
    use std::cell::Cell;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(NAME);
    let warnings = Cell::new(0);
    let read = || read_with_warning(dir.path(), |_| warnings.set(warnings.get() + 1));
    assert!(read());
    assert_eq!(warnings.get(), 0);
    fs::write(
        &path,
        r#"{"schemaVersion":2,"automaticallyDownloadUpdates":false}"#,
    )
    .unwrap();
    assert!(read());
    assert_eq!(warnings.get(), 0);
    fs::write(&path, "not json").unwrap();
    assert!(read());
    assert_eq!(warnings.get(), 1);
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(read());
    assert_eq!(warnings.get(), 2);
}

#[test]
fn temporary_file_creation_failure_does_not_poison_later_mutations() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("profile");
    fs::write(&data, b"not a directory").unwrap();
    assert!(write_automatic_download(&data, false).is_err());
    assert_eq!(fs::read(&data).unwrap(), b"not a directory");
    fs::remove_file(&data).unwrap();
    for enabled in [true, false, true, false] {
        write_automatic_download(&data, enabled).unwrap();
        assert_eq!(read_automatic_download(&data), enabled);
    }
    assert_eq!(fs::read_dir(data).unwrap().count(), 1);
}

#[test]
fn concurrent_writers_publish_whole_documents_without_colliding_temporary_files() {
    use std::sync::{Arc, Barrier};
    let dir = tempfile::tempdir().unwrap();
    write_automatic_download(dir.path(), true).unwrap();
    let barrier = Arc::new(Barrier::new(8));
    std::thread::scope(|scope| {
        let mut threads = Vec::new();
        for i in 0..8 {
            let barrier = barrier.clone();
            let data = dir.path();
            threads.push(scope.spawn(move || {
                barrier.wait();
                for j in 0..12 {
                    write_automatic_download(data, (i + j) % 2 == 0).unwrap();
                    let value: Value =
                        serde_json::from_slice(&fs::read(data.join(NAME)).unwrap()).unwrap();
                    assert_eq!(value["schemaVersion"], 1);
                    assert!(value["automaticallyDownloadUpdates"].is_boolean());
                }
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }
    });
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    write_automatic_download(dir.path(), false).unwrap();
    assert!(!read_automatic_download(dir.path()));
}

#[cfg(unix)]
#[test]
fn a_named_pipe_is_rejected_without_waiting_for_a_writer() {
    use std::os::unix::ffi::OsStrExt;
    let dir = tempfile::tempdir().unwrap();
    let path = std::ffi::CString::new(dir.path().join(NAME).as_os_str().as_bytes()).unwrap();
    // SAFETY: path is a live, NUL-terminated string inside this test's tempdir.
    assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    let mut warned = false;
    assert!(read_with_warning(dir.path(), |_| warned = true));
    assert!(warned);
}
