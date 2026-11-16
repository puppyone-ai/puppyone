use super::*;

struct Repo(tempfile::TempDir);
impl Repo {
    fn new() -> Self {
        let repo = Self(tempfile::tempdir().unwrap());
        repo.git(&["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "Fixture"),
            ("user.email", "fixture@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", "/dev/null"),
        ] {
            repo.git(&["config", key, value]);
        }
        repo
    }
    fn git(&self, args: &[&str]) {
        git::git(self.0.path(), args, None, &AtomicBool::new(false)).unwrap();
    }
    fn write(&self, path: &str, bytes: &[u8]) {
        let path = self.0.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    fn diff(&self, path: &str, old: Option<&str>, scope: Scope) -> Vec<FileDiff> {
        file_diff(self.0.path(), "", path, old, scope, &AtomicBool::new(false)).unwrap()
    }
}

#[test]
fn actual_git_paths_survive_quoting_spaces_and_user_prefix_preferences() {
    let repo = Repo::new();
    let paths = [
        "new\nline.txt",
        "tab\tname.txt",
        "quote\"name.txt",
        "back\\slash.txt",
        "a b/name.txt",
        "目录/é.txt",
        "trailing space .txt",
    ];
    for path in paths {
        repo.write(path, b"before\n");
    }
    repo.git(&["add", "."]);
    repo.git(&["commit", "-qm", "base"]);
    for path in paths {
        repo.write(path, b"after\n");
    }
    for (key, value) in [("diff.noprefix", "true"), ("diff.mnemonicPrefix", "true")] {
        repo.git(&["config", key, value]);
    }
    for path in paths {
        let files = repo.diff(path, None, Scope::Unstaged);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, path);
        assert_eq!(files[0].old_path, None);
        assert_eq!((files[0].additions, files[0].deletions), (Some(1), Some(1)));
        assert!(
            files[0]
                .lines
                .iter()
                .any(|l| l.kind == LineKind::Add && l.text == "after")
        );
    }
}

#[test]
fn patch_header_looking_body_lines_are_counted_and_numbered_as_content() {
    let repo = Repo::new();
    repo.write("body.txt", b"--- removed\n+++ previous\ncontext\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-qm", "base"]);
    repo.write("body.txt", b"+++ added\n--- replacement\ncontext\n");
    let files = repo.diff("body.txt", None, Scope::Unstaged);
    let file = &files[0];
    assert_eq!((file.additions, file.deletions), (Some(2), Some(2)));
    let rows: Vec<_> = file
        .lines
        .iter()
        .filter(|l| l.kind != LineKind::Hunk)
        .map(|l| (l.kind, l.text.as_str(), l.old_line, l.new_line))
        .collect();
    assert_eq!(
        rows,
        [
            (LineKind::Remove, "--- removed", Some(1), None),
            (LineKind::Remove, "+++ previous", Some(2), None),
            (LineKind::Add, "+++ added", None, Some(1)),
            (LineKind::Add, "--- replacement", None, Some(2)),
            (LineKind::Context, "context", Some(3), Some(3))
        ]
    );
}

#[test]
fn quoted_word_renames_and_history_keep_the_real_paths_and_semantic_bodies() {
    use super::super::docx_redline::{self, State};
    let repo = Repo::new();
    let old = "old\n\"report.docx";
    let new = "new\t\"report.docx";
    let bytes = docx_redline::test_docx("<w:p><w:r><w:t>Body</w:t></w:r></w:p>");
    repo.write(old, &bytes);
    repo.git(&["add", "."]);
    repo.git(&["commit", "-qm", "base"]);
    repo.git(&["mv", "--", old, new]);
    let files = repo.diff(new, Some(old), Scope::Staged);
    assert_eq!(files.len(), 1);
    assert_eq!(
        (
            &*files[0].path,
            files[0].old_path.as_deref(),
            files[0].status
        ),
        (new, Some(old), Status::Renamed)
    );
    assert_eq!(
        files[0].redline.as_ref().unwrap().as_ref().unwrap().state,
        State::Empty
    );
    repo.git(&["commit", "-qm", "rename"]);
    let id = git(
        repo.0.path(),
        &["rev-parse", "HEAD"],
        None,
        &AtomicBool::new(false),
    )
    .unwrap();
    let files = commit_detail(
        repo.0.path(),
        std::str::from_utf8(&id).unwrap().trim(),
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        (&*files[0].path, files[0].old_path.as_deref()),
        (new, Some(old))
    );
    assert_eq!(
        files[0].redline.as_ref().unwrap().as_ref().unwrap().state,
        State::Empty
    );
}

#[test]
fn binary_word_paths_with_ambiguous_header_spacing_still_select_the_correct_model() {
    use super::super::docx_redline::{self, SegmentKind};
    let repo = Repo::new();
    let paths = [
        "space b/report.docx",
        "quote\"report.docx",
        "目录/报告.docx",
    ];
    let before = docx_redline::test_docx("<w:p><w:r><w:t>Original body</w:t></w:r></w:p>");
    let after = docx_redline::test_docx("<w:p><w:r><w:t>Revised body</w:t></w:r></w:p>");
    for path in paths {
        repo.write(path, &before);
    }
    repo.git(&["add", "."]);
    repo.git(&["commit", "-qm", "base"]);
    for path in paths {
        repo.write(path, &after);
        let files = repo.diff(path, None, Scope::Unstaged);
        assert_eq!(files[0].path, path);
        assert_eq!(files[0].old_path, None);
        assert!(files[0].binary);
        let model = files[0].redline.as_ref().unwrap().as_ref().unwrap();
        assert!(
            model
                .changes
                .iter()
                .flat_map(|c| &c.segments)
                .any(|s| s.kind == SegmentKind::Add && s.text.contains("Revised"))
        );
    }
}

#[test]
fn copy_and_binary_patch_headers_preserve_classification_and_exact_names() {
    let files = parse_patch(
        "diff --git \"a/old\\nname\" \"b/new\\tname\"\nsimilarity index 100%\ncopy from \"old\\nname\"\ncopy to \"new\\tname\"\nGIT binary patch\nliteral 3\nabc\n",
    );
    assert_eq!(files.len(), 1);
    let file = &files[0];
    assert_eq!(
        (&*file.path, file.old_path.as_deref(), file.status),
        ("new\tname", Some("old\nname"), Status::Copied)
    );
    assert!(file.binary && file.lines.is_empty());
    assert_eq!((file.additions, file.deletions), (None, None));
}
