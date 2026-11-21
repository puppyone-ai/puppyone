#[cfg(unix)]
use super::super::docx_redline;
#[cfg(unix)]
use super::*;
#[cfg(unix)]
use std::sync::atomic::Ordering;

#[cfg(unix)]
#[test]
fn real_git_cache_reuses_models_but_revalidates_working_identity_and_retry_errors() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let cancel = AtomicBool::new(false);
    let run = |args: &[&str]| git::git(root, args, None, &cancel).unwrap();
    run(&["init", "-q", "-b", "main"]);
    for (key, value) in [
        ("user.name", "Fixture"),
        ("user.email", "fixture@example.invalid"),
        ("commit.gpgsign", "false"),
        ("core.hooksPath", "/dev/null"),
    ] {
        run(&["config", key, value]);
    }
    let write = |text: &str| {
        std::fs::write(
            root.join("report.docx"),
            docx_redline::test_docx(&format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>")),
        )
        .unwrap()
    };
    let reader = Reader::default();
    let read = |scope| {
        reader
            .file_diff(root, "", "report.docx", None, scope, &cancel)
            .unwrap()
            .remove(0)
            .redline
            .unwrap()
    };
    write("first");
    let first = read(Scope::Untracked).unwrap();
    let usage = reader.cache_usage();
    assert_eq!(usage.0, 1);
    assert_eq!(read(Scope::Untracked).unwrap(), first);
    assert_eq!(reader.cache_usage(), usage);
    let modified = std::fs::metadata(root.join("report.docx"))
        .unwrap()
        .modified()
        .unwrap();
    write("other");
    std::fs::File::open(root.join("report.docx"))
        .unwrap()
        .set_modified(modified)
        .unwrap();
    assert_ne!(read(Scope::Untracked).unwrap(), first);
    assert_eq!(reader.cache_usage().0, 2);
    std::fs::write(root.join("report.docx"), b"bad package").unwrap();
    assert!(read(Scope::Untracked).is_err());
    assert!(read(Scope::Untracked).is_err());
    assert_eq!(reader.cache_usage().0, 2);
    write("fixed");
    assert!(read(Scope::Untracked).is_ok());
    assert_eq!(reader.cache_usage().0, 3);
    run(&["add", "report.docx"]);
    let staged = read(Scope::Staged).unwrap();
    assert_eq!(read(Scope::Staged).unwrap(), staged);
    assert_eq!(reader.cache_usage().0, 4);
    run(&["commit", "-qm", "root"]);
    let oid = String::from_utf8(run(&["rev-parse", "HEAD"])).unwrap();
    assert_eq!(
        reader.commit_detail(root, oid.trim(), &cancel).unwrap()[0]
            .redline
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap(),
        &staged
    );
    assert_eq!(
        reader.cache_usage().0,
        4,
        "same immutable pair reuses across selection types"
    );
    cancel.store(true, Ordering::Release);
    assert!(
        reader
            .file_diff(root, "", "report.docx", None, Scope::Untracked, &cancel)
            .is_err()
    );
    reader.invalidate();
    assert_eq!(reader.cache_usage(), (0, 0));
}

#[cfg(unix)]
#[test]
fn admitted_cache_hits_still_reject_changed_paths() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let cancel = AtomicBool::new(false);
    let reader = Reader::default();
    let bytes = docx_redline::test_docx("<w:p><w:r><w:t>body</w:t></w:r></w:p>");
    std::fs::write(root.path().join("report.docx"), &bytes).unwrap();
    let admit = || {
        Admitted::Working(Box::new(
            working::Revision::open(root.path(), "report.docx", &cancel)
                .unwrap()
                .unwrap(),
        ))
    };
    reader
        .model(
            root.path(),
            "report.docx",
            Admitted::Missing,
            admit(),
            &cancel,
        )
        .unwrap();
    let stale = admit();
    std::fs::rename(
        root.path().join("report.docx"),
        root.path().join("original"),
    )
    .unwrap();
    symlink(
        root.path().join("original"),
        root.path().join("report.docx"),
    )
    .unwrap();
    assert!(
        reader
            .model(
                root.path(),
                "report.docx",
                Admitted::Missing,
                stale,
                &cancel
            )
            .is_err()
    );
    assert!(working::Revision::open(root.path(), "report.docx", &cancel).is_err());
    // Restoring the exact regular file admits a fresh identity.
    std::fs::remove_file(root.path().join("report.docx")).unwrap();
    std::fs::rename(
        root.path().join("original"),
        root.path().join("report.docx"),
    )
    .unwrap();
    for _ in 0..64 {
        reader
            .model(
                root.path(),
                "report.docx",
                Admitted::Missing,
                admit(),
                &cancel,
            )
            .unwrap();
    }
    assert!(reader.cache_usage().0 <= 2);
}
