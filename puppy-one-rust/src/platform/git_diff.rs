//! Structured file diffs for Changes and History: the product's
//! `getWorkspaceGitFileDiff` / `getWorkspaceGitCommitDetail` (`parseGitPatch`,
//! `buildUntrackedFileDiff`, `deriveGitRevisionSpecs`). Git CLI only, paths as
//! literal pathspecs; no presentation.
mod working;

use super::git::{self, git_read as git};
use std::{path::Path, sync::atomic::AtomicBool};

/// `GIT_DETAIL_MAX_FILE_DIFF_LINES` / `GIT_DETAIL_MAX_TOTAL_DIFF_LINES`.
const MAX_FILE_LINES: usize = 900;
const MAX_TOTAL_LINES: usize = 4000;
/// `MAX_EDITOR_BYTES`: larger untracked files are summarised, not shown.
const MAX_UNTRACKED_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineKind {
    Hunk,
    Add,
    Remove,
    Context,
}
/// `GitDiffLine`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: LineKind,
    pub text: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

/// `GitCommitChangeStatus`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Changed,
}

/// One side of a binary revision pair (`GitRevisionSide`, as far as the
/// summary shows it).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Side {
    /// The file does not exist on this side.
    Missing,
    /// Its size, when Git could read it.
    Present(Option<u64>),
    /// Known size, but bytes exceed the shared diff resource budget.
    SizeLimited(u64),
}

/// `GitFileDiff`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: Status,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub binary: bool,
    pub lines: Vec<DiffLine>,
    pub truncated: bool,
    pub omitted_lines: u32,
    /// Before / after sizes, for binary files of a working-tree diff.
    pub revision: Option<(Side, Side)>,
    /// A Word document's redline of its revision pair (`docx-redline`), or
    /// why it could not be made.
    pub redline: Option<Result<super::docx_redline::Presentation, String>>,
}

/// `GitWorkingDiffScope` for local work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Unstaged,
    Staged,
    Untracked,
}

/// `parseGitPatch`: files with numbered lines, capped per file and overall.
pub fn parse_patch(patch: &str) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut current: Option<(FileDiff, u32, u32)> = None;
    let (mut old, mut new, mut total) = (0u32, 0u32, 0usize);
    let finish = |files: &mut Vec<FileDiff>, current: Option<(FileDiff, u32, u32)>| {
        if let Some((mut file, additions, deletions)) = current {
            if !file.binary {
                file.additions = Some(additions);
                file.deletions = Some(deletions);
            }
            file.truncated = file.omitted_lines > 0;
            files.push(file);
        }
    };
    for line in patch.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some(body) = line.strip_prefix("diff --git ") {
            finish(&mut files, current.take());
            current = Some((header(body), 0, 0));
            (old, new) = (0, 0);
            continue;
        }
        let Some((file, additions, deletions)) = current.as_mut() else {
            continue;
        };
        let mut push = |file: &mut FileDiff, line: DiffLine| {
            if file.lines.len() >= MAX_FILE_LINES || total >= MAX_TOTAL_LINES {
                file.omitted_lines += 1;
            } else {
                file.lines.push(line);
                total += 1;
            }
        };
        let line_at = |n: u32| (n > 0).then_some(n);
        if line.starts_with("new file mode ") {
            file.status = Status::Added;
        } else if line.starts_with("deleted file mode ") {
            file.status = Status::Deleted;
        } else if let Some(from) = line.strip_prefix("rename from ") {
            file.old_path = Some(from.to_owned());
            file.status = Status::Renamed;
        } else if let Some(to) = line.strip_prefix("rename to ") {
            file.path = to.to_owned();
            file.status = Status::Renamed;
        } else if line.starts_with("Binary files ") {
            file.binary = true;
        } else if line.starts_with("@@ ") {
            let (o, n) = hunk_start(line).unwrap_or((0, 0));
            (old, new) = (o, n);
            push(
                file,
                DiffLine {
                    kind: LineKind::Hunk,
                    text: line.to_owned(),
                    old_line: None,
                    new_line: None,
                },
            );
        } else if line.starts_with('+') && !line.starts_with("+++") {
            *additions += 1;
            push(
                file,
                DiffLine {
                    kind: LineKind::Add,
                    text: line[1..].to_owned(),
                    old_line: None,
                    new_line: line_at(new),
                },
            );
            new += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            *deletions += 1;
            push(
                file,
                DiffLine {
                    kind: LineKind::Remove,
                    text: line[1..].to_owned(),
                    old_line: line_at(old),
                    new_line: None,
                },
            );
            old += 1;
        } else if let Some(text) = line.strip_prefix(' ') {
            push(
                file,
                DiffLine {
                    kind: LineKind::Context,
                    text: text.to_owned(),
                    old_line: line_at(old),
                    new_line: line_at(new),
                },
            );
            old += 1;
            new += 1;
        }
    }
    finish(&mut files, current);
    files
}

/// `parseGitDiffHeader`: `a/<old> b/<new>`.
fn header(body: &str) -> FileDiff {
    let strip = |v: &str| {
        v.strip_prefix("a/")
            .or_else(|| v.strip_prefix("b/"))
            .unwrap_or(v)
            .to_owned()
    };
    let (old, path) = match body.find(" b/") {
        Some(i) => (strip(&body[..i]), body[i + 3..].to_owned()),
        None => (String::new(), strip(body)),
    };
    FileDiff {
        old_path: (!old.is_empty() && old != path).then_some(old),
        path,
        status: Status::Modified,
        additions: None,
        deletions: None,
        binary: false,
        lines: Vec::new(),
        truncated: false,
        omitted_lines: 0,
        revision: None,
        redline: None,
    }
}

/// `@@ -<old>[,n] +<new>[,n] @@`.
fn hunk_start(line: &str) -> Option<(u32, u32)> {
    let mut parts = line.split(' ');
    parts.next()?;
    let number = |part: &str, sign: char| -> Option<u32> {
        part.strip_prefix(sign)?.split(',').next()?.parse().ok()
    };
    let old = number(parts.next()?, '-')?;
    let new = number(parts.next()?, '+')?;
    Some((old, new))
}

/// `getWorkspaceGitFileDiff` for local work: the selected file (and the
/// source of a rename) in the index, the working tree, or untracked.
///
/// `path` and `old_path` are repository-relative; the opened folder sits at
/// `prefix` in the repository and reads never leave it.
pub fn file_diff(
    root: &Path,
    prefix: &str,
    path: &str,
    old_path: Option<&str>,
    scope: Scope,
    cancel: &AtomicBool,
) -> Result<Vec<FileDiff>, String> {
    git::coordinator::wait_for_reads(root, cancel)?;
    let outside = || crate::localization::t("native.git.pathOutside").to_owned();
    git::validate_path(path)?;
    let local = git::local(prefix, path).ok_or_else(outside)?;
    let old_local = match old_path {
        Some(old) => {
            git::validate_path(old)?;
            Some(git::local(prefix, old).ok_or_else(outside)?)
        }
        None => None,
    };
    if scope == Scope::Untracked {
        return untracked(root, path, local, cancel).map(|file| vec![file]);
    }
    let mut args = vec![
        "diff",
        "--find-renames",
        "--patch",
        "--unified=3",
        "--no-ext-diff",
        "--no-textconv",
    ];
    if scope == Scope::Staged {
        args.push("--cached");
    }
    args.push("--");
    if let Some(old) = old_local.filter(|o| *o != local) {
        args.push(old);
    }
    args.push(local);
    let patch = git(root, &args, None, cancel)?;
    let mut files = parse_patch(&String::from_utf8_lossy(&patch));
    for file in files.iter_mut().filter(|f| f.binary) {
        file.revision = Some(binary_sides(root, prefix, file, scope, cancel));
    }
    for file in files.iter_mut().filter(|f| is_docx(&f.path)) {
        let before_path = file.old_path.as_deref().unwrap_or(&file.path);
        let before = (file.status != Status::Added).then(|| {
            Revision::Blob(if scope == Scope::Staged {
                format!("HEAD:{before_path}")
            } else {
                format!(":{before_path}")
            })
        });
        let after = (file.status != Status::Deleted).then(|| {
            if scope == Scope::Staged {
                Revision::Blob(format!(":{}", file.path))
            } else {
                Revision::Working(git::local(prefix, &file.path).map(str::to_owned))
            }
        });
        file.redline = Some(redline(root, before, after, cancel));
    }
    working::check_cancel(cancel)?;
    Ok(files)
}

/// `GIT_DIFF_REVISION_LIMITS.maxResourceBytes`; expanded XML has a separate budget.
const MAX_RESOURCE_BYTES: u64 = 25 * 1024 * 1024;

/// `docxRedlineContribution.match`: a Word (OpenXML) document.
fn is_docx(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("docx"))
        && path.contains('.')
}

/// One side of a Word revision pair: a Git object, or the working file
/// (its path under the opened folder, if it is there).
enum Revision {
    Blob(String),
    Working(Option<String>),
}

/// `loadDocxRedline`: both revisions read (`None`: the side is missing),
/// then the redline built.
fn redline(
    root: &Path,
    before: Option<Revision>,
    after: Option<Revision>,
    cancel: &AtomicBool,
) -> Result<super::docx_redline::Presentation, String> {
    let read = |side: Option<Revision>| -> Result<Option<Vec<u8>>, String> {
        match side {
            None => Ok(None),
            Some(Revision::Blob(spec)) => {
                // Resolve mutable HEAD/index specs once, then read the same
                // immutable blob for size and content even if refs change.
                let oid = git(
                    root,
                    &["rev-parse", "--verify", "--end-of-options", &spec],
                    None,
                    cancel,
                )?;
                let oid = std::str::from_utf8(&oid).map_err(|e| e.to_string())?.trim();
                if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("Git returned an invalid revision object id.".into());
                }
                let size: u64 = git(root, &["cat-file", "-s", oid], None, cancel)
                    .ok()
                    .and_then(|out| String::from_utf8_lossy(&out).trim().parse().ok())
                    .ok_or("The Word revision could not be read from Git.")?;
                if size > MAX_RESOURCE_BYTES {
                    return Err("The Word revision exceeds the semantic diff budget.".into());
                }
                let bytes = git::git_read_bounded(
                    root,
                    &["cat-file", "blob", oid],
                    None,
                    cancel,
                    MAX_RESOURCE_BYTES as usize,
                )?;
                if bytes.len() as u64 != size {
                    return Err("Git returned an incomplete revision blob.".into());
                }
                Ok(Some(bytes))
            }
            Some(Revision::Working(local)) => {
                let local = local
                    .ok_or_else(|| crate::localization::t("native.git.pathOutside").to_owned())?;
                read_working(root, &local, cancel)
            }
        }
    };
    let before = read(before)?;
    let after = read(after)?;
    working::check_cancel(cancel)?;
    let model = super::docx_redline::build(before.as_deref(), after.as_deref());
    working::check_cancel(cancel)?;
    model
}

/// A working Word file is read once through an admitted, bounded descriptor.
fn read_working(root: &Path, local: &str, cancel: &AtomicBool) -> Result<Option<Vec<u8>>, String> {
    working::Revision::open(root, local, cancel)?
        .ok_or_else(|| "The Word revision is not a regular file.".to_owned())?
        .read(MAX_RESOURCE_BYTES, cancel)
        .map(Some)
}

/// `getWorkspaceGitCommitDetail`: every file a commit changed.
pub fn commit_detail(root: &Path, id: &str, cancel: &AtomicBool) -> Result<Vec<FileDiff>, String> {
    git::coordinator::wait_for_reads(root, cancel)?;
    if !(4..=64).contains(&id.len()) || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Commit id must be a Git object id.".into());
    }
    let patch = git(
        root,
        &[
            "show",
            "--format=",
            "--find-renames",
            "--patch",
            "--unified=3",
            "--no-ext-diff",
            "--no-textconv",
            id,
        ],
        None,
        cancel,
    )?;
    let mut files = parse_patch(&String::from_utf8_lossy(&patch));
    // A root commit has no parent: its files are all added.
    let parent = git(
        root,
        &["rev-parse", "--verify", "--quiet", &format!("{id}^")],
        None,
        cancel,
    )
    .is_ok();
    for file in files.iter_mut().filter(|f| is_docx(&f.path)) {
        let before_path = file.old_path.as_deref().unwrap_or(&file.path);
        let before = (parent && file.status != Status::Added)
            .then(|| Revision::Blob(format!("{id}^:{before_path}")));
        let after =
            (file.status != Status::Deleted).then(|| Revision::Blob(format!("{id}:{}", file.path)));
        file.redline = Some(redline(root, before, after, cancel));
    }
    working::check_cancel(cancel)?;
    Ok(files)
}

/// `buildUntrackedFileDiff`: every line added — the product splits on line
/// breaks, so a final newline shows as an empty last line.
fn untracked(
    root: &Path,
    path: &str,
    local: &str,
    cancel: &AtomicBool,
) -> Result<FileDiff, String> {
    let working = working::Revision::open(root, local, cancel)?;
    let size = working.as_ref().map(working::Revision::size);
    let mut file = FileDiff {
        path: path.to_owned(),
        old_path: None,
        status: Status::Added,
        additions: None,
        deletions: None,
        binary: true,
        lines: Vec::new(),
        truncated: false,
        omitted_lines: 0,
        revision: Some((Side::Missing, side_size(size))),
        redline: None,
    };
    let word = is_docx(path);
    let Some(working) = working else {
        if word {
            file.redline = Some(Err("The Word revision is not a regular file.".into()));
        }
        return Ok(file);
    };
    if !word && working.size() > MAX_UNTRACKED_BYTES {
        return Ok(file);
    }
    let bytes = match working.read(
        if word {
            MAX_RESOURCE_BYTES
        } else {
            MAX_UNTRACKED_BYTES
        },
        cancel,
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            working::check_cancel(cancel)?;
            if !word {
                return Err(error);
            }
            file.redline = Some(Err(error));
            return Ok(file);
        }
    };
    if word {
        file.redline = Some(super::docx_redline::build(None, Some(&bytes)));
        working::check_cancel(cancel)?;
    }
    if bytes.len() as u64 > MAX_UNTRACKED_BYTES || bytes.contains(&0) {
        return Ok(file);
    }
    let text = String::from_utf8_lossy(&bytes);
    file.lines = text
        .split('\n')
        .enumerate()
        .map(|(i, line)| DiffLine {
            kind: LineKind::Add,
            text: line.strip_suffix('\r').unwrap_or(line).to_owned(),
            old_line: None,
            new_line: Some(i as u32 + 1),
        })
        .collect();
    working::check_cancel(cancel)?;
    file.binary = false;
    file.additions = Some(file.lines.len() as u32);
    file.deletions = Some(0);
    file.revision = None;
    Ok(file)
}

fn side_size(size: Option<u64>) -> Side {
    match size {
        Some(size) if size > MAX_RESOURCE_BYTES => Side::SizeLimited(size),
        size => Side::Present(size),
    }
}

/// `deriveGitRevisionSpecs` → sizes: unstaged compares the index with the
/// working tree, staged `HEAD` with the index.
fn binary_sides(
    root: &Path,
    prefix: &str,
    file: &FileDiff,
    scope: Scope,
    cancel: &AtomicBool,
) -> (Side, Side) {
    let before_path = file.old_path.as_deref().unwrap_or(&file.path);
    let blob = |spec: String| -> Side {
        let size = git(root, &["cat-file", "-s", &spec], None, cancel)
            .ok()
            .and_then(|out| String::from_utf8_lossy(&out).trim().parse().ok());
        side_size(size)
    };
    let before = if file.status == Status::Added {
        Side::Missing
    } else if scope == Scope::Staged {
        blob(format!("HEAD:{before_path}"))
    } else {
        blob(format!(":{before_path}"))
    };
    let after = if file.status == Status::Deleted {
        Side::Missing
    } else if scope == Scope::Staged {
        blob(format!(":{}", file.path))
    } else {
        // `HEAD:path` and `:path` name repository paths; the working file
        // is under the opened folder.
        side_size(
            git::local(prefix, &file.path)
                .and_then(|local| working::Revision::open(root, local, cancel).ok().flatten())
                .map(|revision| revision.size()),
        )
    };
    (before, after)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn patches_parse_like_parse_git_patch() {
        let patch = "diff --git a/src/app.ts b/src/app.ts\nindex 1..2 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,3 @@\n-// old\n+// new\n a\n b\n@@ -20,2 +20,3 @@ fn\n x\n+y\n z\ndiff --git a/old.txt b/new.txt\nsimilarity index 90%\nrename from old.txt\nrename to new.txt\ndiff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n";
        let files = parse_patch(patch);
        assert_eq!(files.len(), 3);
        let app = &files[0];
        assert_eq!(
            (app.path.as_str(), app.status, app.additions, app.deletions),
            ("src/app.ts", Status::Modified, Some(2), Some(1))
        );
        let kinds: Vec<LineKind> = app.lines.iter().map(|l| l.kind).collect();
        use LineKind::*;
        assert_eq!(
            kinds,
            [
                Hunk, Remove, Add, Context, Context, Hunk, Context, Add, Context
            ]
        );
        assert_eq!(
            (app.lines[1].old_line, app.lines[2].new_line),
            (Some(1), Some(1))
        );
        assert_eq!(
            (app.lines[7].text.as_str(), app.lines[7].new_line),
            ("y", Some(21))
        );
        assert_eq!(
            (app.lines[8].old_line, app.lines[8].new_line),
            (Some(21), Some(22))
        );
        let renamed = &files[1];
        assert_eq!(
            (
                renamed.status,
                renamed.old_path.as_deref(),
                renamed.path.as_str()
            ),
            (Status::Renamed, Some("old.txt"), "new.txt")
        );
        let binary = &files[2];
        assert!(binary.binary && binary.additions.is_none() && binary.lines.is_empty());
    }

    #[test]
    fn long_patches_are_capped_per_file() {
        let mut patch = String::from("diff --git a/a.txt b/a.txt\n@@ -0,0 +1,1000 @@\n");
        for i in 0..1000 {
            patch.push_str(&format!("+line {i}\n"));
        }
        let file = &parse_patch(&patch)[0];
        assert_eq!(file.lines.len(), MAX_FILE_LINES);
        assert_eq!(
            (file.truncated, file.omitted_lines, file.additions),
            (true, 101, Some(1000))
        );
    }

    #[cfg(unix)]
    #[test]
    fn working_diff_never_follows_symbolic_links_even_inside_the_workspace() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let cancel = AtomicBool::new(false);
        git::operate(root, &git::Operation::Init, &cancel).unwrap();
        std::fs::write(root.join("actual.txt"), "private bytes\n").unwrap();
        symlink("actual.txt", root.join("alias.txt")).unwrap();
        assert!(file_diff(root, "", "alias.txt", None, Scope::Untracked, &cancel).is_err());
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "outside secret\n").unwrap();
        symlink(outside.path().join("secret.txt"), root.join("outside.txt")).unwrap();
        assert!(file_diff(root, "", "outside.txt", None, Scope::Untracked, &cancel).is_err());
    }

    #[test]
    fn word_revision_reading_obeys_the_same_25_mib_resource_budget_as_typescript() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let cancel = AtomicBool::new(false);
        git::operate(root, &git::Operation::Init, &cancel).unwrap();
        let file = std::fs::File::create(root.join("oversize.docx")).unwrap();
        file.set_len(25 * 1024 * 1024 + 1).unwrap();
        let diff = file_diff(root, "", "oversize.docx", None, Scope::Untracked, &cancel).unwrap();
        assert_eq!(
            diff[0].revision,
            Some((Side::Missing, Side::SizeLimited(25 * 1024 * 1024 + 1)))
        );
        let error = diff[0].redline.as_ref().unwrap().as_ref().unwrap_err();
        assert!(
            error.contains("exceeds"),
            "must refuse bytes before parsing: {error}"
        );
        std::fs::hard_link(root.join("oversize.docx"), root.join("oversize.bin")).unwrap();
        let binary = file_diff(root, "", "oversize.bin", None, Scope::Untracked, &cancel).unwrap();
        assert_eq!(binary[0].revision, diff[0].revision);
        assert!(binary[0].lines.is_empty() && binary[0].redline.is_none());
        git::git(root, &["add", "oversize.docx"], None, &cancel).unwrap();
        let staged = file_diff(root, "", "oversize.docx", None, Scope::Staged, &cancel).unwrap();
        assert_eq!(staged[0].revision, diff[0].revision);
        assert!(
            staged[0]
                .redline
                .as_ref()
                .unwrap()
                .as_ref()
                .unwrap_err()
                .contains("exceeds")
        );
        assert!(
            file_diff(
                root,
                "",
                "oversize.docx",
                None,
                Scope::Untracked,
                &AtomicBool::new(true)
            )
            .is_err()
        );
    }

    #[test]
    fn total_patch_limits_preserve_later_files_and_exact_change_counts() {
        let mut patch = String::new();
        for file in 0..7 {
            patch.push_str(&format!(
                "diff --git a/{file}.txt b/{file}.txt\n@@ -0,0 +1,1000 @@\n"
            ));
            for line in 0..1000 {
                patch.push_str(&format!("+file {file} line {line}\n"));
            }
        }
        let files = parse_patch(&patch);
        assert_eq!(files.len(), 7);
        assert_eq!(
            files.iter().map(|file| file.lines.len()).sum::<usize>(),
            MAX_TOTAL_LINES
        );
        for (i, file) in files.iter().enumerate() {
            assert_eq!(file.path, format!("{i}.txt"));
            assert!(file.lines.len() <= MAX_FILE_LINES && file.truncated);
            assert_eq!((file.additions, file.deletions), (Some(1000), Some(0)));
            assert_eq!(file.lines.len() + file.omitted_lines as usize, 1001);
        }
        assert!(files.last().unwrap().lines.is_empty());
    }

    #[test]
    fn real_word_revision_scopes_distinguish_head_index_worktree_rename_and_deletion() {
        use super::super::docx_redline::{self, SegmentKind, State};
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let cancel = AtomicBool::new(false);
        let run = |args: &[&str]| git::git(root, args, None, &cancel).unwrap();
        run(&["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "Diff Fixture"),
            ("user.email", "diff@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", "/dev/null"),
        ] {
            run(&["config", key, value]);
        }
        let write = |name: &str, body: &str| {
            std::fs::write(
                root.join(name),
                docx_redline::test_docx(&format!("<w:p><w:r><w:t>{body}</w:t></w:r></w:p>")),
            )
            .unwrap();
        };
        let diff = |path: &str, old: Option<&str>, scope| {
            file_diff(root, "", path, old, scope, &cancel)
                .unwrap()
                .remove(0)
        };
        write("report.docx", "Base");
        run(&["add", "report.docx"]);
        let unborn = diff("report.docx", None, Scope::Staged);
        assert_eq!(unborn.status, Status::Added);
        assert_eq!(unborn.revision.as_ref().unwrap().0, Side::Missing);
        assert_eq!(
            unborn.redline.as_ref().unwrap().as_ref().unwrap().state,
            State::Added
        );
        run(&["commit", "-qm", "base"]);
        let head = String::from_utf8(run(&["rev-parse", "HEAD"])).unwrap();
        write("report.docx", "Staged");
        run(&["add", "report.docx"]);
        write("report.docx", "Working");
        let words = |file: &FileDiff, kind| {
            file.redline
                .as_ref()
                .unwrap()
                .as_ref()
                .unwrap()
                .changes
                .iter()
                .flat_map(|change| &change.segments)
                .filter(|part| part.kind == kind)
                .map(|part| part.text.as_str())
                .collect::<String>()
        };
        let staged = diff("report.docx", None, Scope::Staged);
        let unstaged = diff("report.docx", None, Scope::Unstaged);
        assert_eq!(words(&staged, SegmentKind::Remove), "Base");
        assert_eq!(words(&staged, SegmentKind::Add), "Staged");
        assert_eq!(words(&unstaged, SegmentKind::Remove), "Staged");
        assert_eq!(words(&unstaged, SegmentKind::Add), "Working");
        let historical = commit_detail(root, head.trim(), &cancel).unwrap().remove(0);
        assert_eq!(words(&historical, SegmentKind::Add), "Base");
        // Rename unchanged index bytes so Git's similarity heuristic cannot
        // turn this scope assertion into an unrelated add/delete fixture.
        run(&["restore", "--staged", "report.docx"]);
        run(&["mv", "report.docx", "renamed.docx"]);
        let renamed = diff("renamed.docx", Some("report.docx"), Scope::Staged);
        assert_eq!(
            (renamed.status, renamed.old_path.as_deref()),
            (Status::Renamed, Some("report.docx"))
        );
        assert_eq!(
            renamed.redline.as_ref().unwrap().as_ref().unwrap().state,
            State::Empty
        );
        let renamed_working = diff("renamed.docx", None, Scope::Unstaged);
        assert_eq!(words(&renamed_working, SegmentKind::Remove), "Base");
        assert_eq!(words(&renamed_working, SegmentKind::Add), "Working");
        assert_eq!(
            words(&staged, SegmentKind::Add),
            "Staged",
            "already delivered models own their original bytes"
        );
        run(&["rm", "-f", "renamed.docx"]);
        let deleted = diff("report.docx", None, Scope::Staged);
        assert_eq!(deleted.status, Status::Deleted);
        assert_eq!(deleted.revision.as_ref().unwrap().1, Side::Missing);
        assert_eq!(
            deleted.redline.as_ref().unwrap().as_ref().unwrap().state,
            State::Deleted
        );
        assert_eq!(words(&deleted, SegmentKind::Remove), "Base");
        write("new.docx", "New body");
        assert_eq!(
            diff("new.docx", None, Scope::Untracked)
                .redline
                .unwrap()
                .unwrap()
                .state,
            State::Added
        );
        run(&["add", "new.docx"]);
        assert_eq!(
            diff("new.docx", None, Scope::Staged)
                .redline
                .unwrap()
                .unwrap()
                .state,
            State::Added
        );
    }

    #[test]
    fn working_tree_diffs_cover_each_scope() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let run = |args: &[&str]| {
            assert!(
                std::process::Command::new("/usr/bin/git")
                    .args(args)
                    .current_dir(root)
                    .output()
                    .unwrap()
                    .status
                    .success(),
                "{args:?}"
            );
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "a@b.c"]);
        run(&["config", "user.name", "A"]);
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(root.join("blob.bin"), [0u8, 1, 2]).unwrap();
        run(&["add", "."]);
        run(&["commit", "-qm", "init"]);
        std::fs::write(root.join("a.txt"), "one\nTWO\n").unwrap();
        run(&["add", "a.txt"]);
        std::fs::write(root.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        std::fs::write(root.join("blob.bin"), [0u8, 1, 2, 3, 4]).unwrap();
        std::fs::write(root.join("new.md"), "# New\n").unwrap();
        let cancel = AtomicBool::new(false);
        let staged = file_diff(root, "", "a.txt", None, Scope::Staged, &cancel).unwrap();
        assert_eq!(
            (staged[0].additions, staged[0].deletions),
            (Some(1), Some(1))
        );
        let unstaged = file_diff(root, "", "a.txt", None, Scope::Unstaged, &cancel).unwrap();
        assert_eq!(
            (unstaged[0].additions, unstaged[0].deletions),
            (Some(1), Some(0))
        );
        let binary = &file_diff(root, "", "blob.bin", None, Scope::Unstaged, &cancel).unwrap()[0];
        assert_eq!(
            binary.revision,
            Some((Side::Present(Some(3)), Side::Present(Some(5))))
        );
        let new = &file_diff(root, "", "new.md", None, Scope::Untracked, &cancel).unwrap()[0];
        assert_eq!(
            (new.status, new.additions, new.lines.len()),
            (Status::Added, Some(2), 2)
        );
        assert_eq!(new.lines[1].text, "");
        assert!(file_diff(root, "", "../x", None, Scope::Unstaged, &cancel).is_err());
        let head = String::from_utf8(
            std::process::Command::new("/usr/bin/git")
                .args(["rev-parse", "HEAD"])
                .current_dir(root)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        let detail = commit_detail(root, head.trim(), &cancel).unwrap();
        assert_eq!(
            detail.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            ["a.txt", "blob.bin"]
        );
        assert!(commit_detail(root, "HEAD; rm", &cancel).is_err());
    }
}
