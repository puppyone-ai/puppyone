use super::*;
struct Repo(tempfile::TempDir);
impl Repo {
    fn new() -> Self {
        let repo = Self(tempfile::tempdir().unwrap());
        repo.git(&["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "History fixture"),
            ("user.email", "history@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", "/dev/null"),
        ] {
            repo.git(&["config", key, value]);
        }
        repo
    }
    fn git(&self, args: &[&str]) -> String {
        String::from_utf8(
            super::super::git::git(self.0.path(), args, None, &AtomicBool::new(false)).unwrap(),
        )
        .unwrap()
        .trim()
        .into()
    }
    fn write(&self, name: &str, text: &str) {
        std::fs::write(self.0.path().join(name), text).unwrap();
    }
    fn commit(&self, message: &str) {
        self.git(&["add", "."]);
        self.git(&["commit", "-qm", message]);
    }
    fn read(&self) -> History {
        history(self.0.path(), &AtomicBool::new(false)).unwrap()
    }
}
#[test]
fn history_preserves_filename_boundaries_and_control_characters_in_subjects() {
    let repo = Repo::new();
    let paths = [
        "new\nline.txt",
        "tab\tname.txt",
        "quote\"name.txt",
        "back\\slash.txt",
        "ordinary => arrow.txt",
        "{literal => braces}.txt",
        "\nleading.txt",
        "trailing.txt ",
        "unit\x1fseparator.txt",
        "record\x1eseparator.txt",
        "报告.txt",
    ];
    for path in paths {
        repo.write(path, "one\ntwo\n");
    }
    let message = "A subject with \x1e and \x1f separators";
    repo.commit(message);
    let history = repo.read();
    assert_eq!(history.commits.len(), 1);
    let commit = &history.commits[0];
    assert_eq!(commit.message, message);
    assert_eq!(history.head.as_deref(), Some(commit.id.as_str()));
    assert_eq!(commit.changes.len(), paths.len());
    for path in paths {
        let change = commit
            .changes
            .iter()
            .find(|c| c.path == path)
            .unwrap_or_else(|| panic!("lost path {path:?}: {:?}", commit.changes));
        assert_eq!(
            (change.status, change.additions, change.deletions),
            (Status::Added, Some(2), Some(0))
        );
        assert!(change.old_path.is_none());
    }
}
#[test]
fn a_history_rename_keeps_exact_old_and_new_paths_and_one_stats_record() {
    let repo = Repo::new();
    let old = "old\n\"report.txt";
    let new = "literal {old => new}\tfile.txt";
    repo.write(old, "unchanged\nbody\n");
    repo.commit("base");
    repo.git(&["mv", "--", old, new]);
    repo.commit("rename");
    let history = repo.read();
    let commit = &history.commits[0];
    assert_eq!(commit.changes.len(), 1);
    let change = &commit.changes[0];
    assert_eq!(
        (change.path.as_str(), change.old_path.as_deref()),
        (new, Some(old))
    );
    assert_eq!(
        (change.status, change.additions, change.deletions),
        (Status::Renamed, Some(0), Some(0))
    );
}
#[test]
fn history_failures_and_cancellation_cannot_become_empty_successes() {
    let plain = tempfile::tempdir().unwrap();
    assert!(history(plain.path(), &AtomicBool::new(false)).is_err());
    let repo = Repo::new();
    assert_eq!(repo.read(), History::default());
    assert!(history(repo.0.path(), &AtomicBool::new(true)).is_err());
    repo.write("a.txt", "body\n");
    repo.commit("base");
    let head = repo.git(&["rev-parse", "HEAD"]);
    let object = repo
        .0
        .path()
        .join(".git/objects")
        .join(&head[..2])
        .join(&head[2..]);
    assert!(object.is_file());
    std::fs::remove_file(&object).unwrap();
    std::fs::write(object, b"corrupted fixture object").unwrap();
    assert!(history(repo.0.path(), &AtomicBool::new(false)).is_err());
}

#[test]
fn both_history_passes_and_the_head_badge_use_the_captured_commit() {
    let repo = Repo::new();
    repo.write("a.txt", "first\n");
    repo.commit("captured snapshot");
    let captured = repo.git(&["rev-parse", "HEAD"]);
    repo.write("a.txt", "second\n");
    repo.commit("later snapshot");
    let old = read_at(repo.0.path(), &captured, &AtomicBool::new(false)).unwrap();
    assert_eq!(old.head.as_deref(), Some(captured.as_str()));
    assert_eq!(old.commits.len(), 1);
    assert_eq!(old.commits[0].message, "captured snapshot");
    assert_eq!(old.commits[0].changes[0].additions, Some(1));
    assert_eq!(old.commits[0].changes[0].deletions, Some(0));
    let current = repo.read();
    assert_ne!(current.head, old.head);
    assert_eq!(current.commits.len(), 2);
    assert_eq!(current.commits[0].message, "later snapshot");
    assert_eq!(current.commits[0].changes[0].deletions, Some(1));
}
