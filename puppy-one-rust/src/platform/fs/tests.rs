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
