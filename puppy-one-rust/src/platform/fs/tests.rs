use super::*;
use core::prelude::v1::test;

#[test]
fn windows_reserved_device_names_and_trailing_dots_are_detected() {
    for bad in [
        "CON",
        "con.txt",
        "Prn.md",
        "AUX",
        "NUL",
        "COM1",
        "com9.log",
        "LPT1",
        "LPT9.txt",
        "trailing.",
        "trailing ",
        "bad:name",
        "bad?name",
        "",
    ] {
        assert!(
            is_invalid_windows_filename(bad),
            "expected invalid Windows filename: {bad:?}"
        );
    }
    for good in ["console.md", "null.txt", "COM10.txt", "LPT0.md", "notes.md"] {
        assert!(
            !is_invalid_windows_filename(good),
            "expected valid Windows filename: {good:?}"
        );
    }
}

#[test]
fn sync_dir_and_exclusive_rename_work_on_cap_std_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = Dir::open_ambient_dir(tmp.path(), cap_std::ambient_authority()).unwrap();
    dir.write("a.txt", b"hello").unwrap();
    dir.write("existing.txt", b"keep").unwrap();

    sync_dir(&dir).unwrap();

    // Exclusive rename refuses to overwrite an existing file.
    let err = exclusive_rename(&dir, Path::new("a.txt"), &dir, Path::new("existing.txt"))
        .expect_err("exclusive rename must not replace existing target");
    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);

    // Exclusive rename succeeds onto an unused name.
    exclusive_rename(&dir, Path::new("a.txt"), &dir, Path::new("b.txt")).unwrap();
    assert_eq!(dir.read_to_string("b.txt").unwrap(), "hello");
    assert_eq!(dir.read_to_string("existing.txt").unwrap(), "keep");
}

#[test]
fn private_file_and_access_helpers_work_cross_platform() {
    let tmp = tempfile::tempdir().unwrap();
    let private_dir = tmp.path().join("private/nested");
    create_private_dir_all(&private_dir).unwrap();
    let file = private_dir.join("secret.txt");
    {
        use std::io::Write as _;
        let mut f = open_private_truncate(&file).unwrap();
        f.write_all(b"payload").unwrap();
    }
    can_access_read(&file).unwrap();
    let meta1 = std::fs::metadata(&file).unwrap();
    let meta2 = std::fs::metadata(&file).unwrap();
    assert!(same_metadata_identity(&meta1, &meta2));
    assert!(open_path_nofollow_read(&file).is_ok());
}

#[cfg(windows)]
#[test]
fn windows_long_paths_over_260_chars_succeed_for_identity_and_exclusive_rename() {
    let tmp = tempfile::tempdir().unwrap();
    // Build a directory hierarchy exceeding Windows' legacy 260-char MAX_PATH limit.
    let mut deep = tmp.path().to_path_buf();
    for i in 0..8 {
        deep.push(format!(
            "long_segment_{i:02}_abcdefghijklmnopqrstuvwxyz012345"
        ));
    }
    assert!(
        deep.as_os_str().len() > 270,
        "test path must exceed 260 chars: {}",
        deep.display()
    );
    let verbatim_deep = std::path::PathBuf::from(format!(r"\\?\{}", deep.display()));
    std::fs::create_dir_all(&verbatim_deep).unwrap();

    let dir = Dir::open_ambient_dir(&verbatim_deep, cap_std::ambient_authority()).unwrap();
    dir.write("source.txt", b"long-path-content").unwrap();
    dir.write("existing.txt", b"keep").unwrap();

    // Pass the non-verbatim >260-char path directly to `path_identity` to prove
    // `extended_path` prepends `\\?\` automatically for `CreateFileW`.
    let plain_long_file = deep.join("source.txt");
    assert!(plain_long_file.as_os_str().len() > 280);
    let id_from_path = path_identity(&plain_long_file)
        .expect("path_identity must handle >260-char Windows paths via \\\\?\\ prefix");
    let id_from_dir = dir_entry_identity(&dir, Path::new("source.txt"))
        .expect("dir_entry_identity must handle >260-char Windows paths");
    assert_eq!(id_from_path, id_from_dir);

    // Exclusive rename via MoveFileExW must reject collision and succeed on a fresh name.
    let err = exclusive_rename(
        &dir,
        Path::new("source.txt"),
        &dir,
        Path::new("existing.txt"),
    )
    .expect_err("exclusive rename must reject existing target at >260-char path");
    assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);

    exclusive_rename(
        &dir,
        Path::new("source.txt"),
        &dir,
        Path::new("renamed_over_260.txt"),
    )
    .expect("exclusive rename must succeed on >260-char Windows path");
    assert_eq!(
        dir.read_to_string("renamed_over_260.txt").unwrap(),
        "long-path-content"
    );
}
