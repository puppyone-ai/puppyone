//! Structured file diffs for Changes and History: the product's
//! `getWorkspaceGitFileDiff` / `getWorkspaceGitCommitDetail` (`parseGitPatch`,
//! `buildUntrackedFileDiff`, `deriveGitRevisionSpecs`). Git CLI only, paths as
//! literal pathspecs; no presentation.
use super::git::{self, git};
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
        return untracked(root, path, local).map(|file| vec![file]);
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
    Ok(files)
}

/// `getWorkspaceGitCommitDetail`: every file a commit changed.
pub fn commit_detail(root: &Path, id: &str, cancel: &AtomicBool) -> Result<Vec<FileDiff>, String> {
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
    Ok(parse_patch(&String::from_utf8_lossy(&patch)))
}

/// `buildUntrackedFileDiff`: every line added — the product splits on line
/// breaks, so a final newline shows as an empty last line.
fn untracked(root: &Path, path: &str, local: &str) -> Result<FileDiff, String> {
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let file = root.join(local).canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&base) {
        return Err(crate::localization::t("native.git.symlinkPreview").into());
    }
    let summary = |binary: bool| FileDiff {
        path: path.to_owned(),
        old_path: None,
        status: Status::Added,
        additions: None,
        deletions: None,
        binary,
        lines: Vec::new(),
        truncated: false,
        omitted_lines: 0,
        revision: Some((
            Side::Missing,
            Side::Present(std::fs::metadata(&file).ok().map(|m| m.len())),
        )),
    };
    let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
    if meta.is_dir() || meta.len() > MAX_UNTRACKED_BYTES {
        return Ok(summary(true));
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Ok(summary(true));
    }
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<DiffLine> = text
        .split('\n')
        .enumerate()
        .map(|(i, line)| DiffLine {
            kind: LineKind::Add,
            text: line.strip_suffix('\r').unwrap_or(line).to_owned(),
            old_line: None,
            new_line: Some(i as u32 + 1),
        })
        .collect();
    Ok(FileDiff {
        additions: Some(lines.len() as u32),
        deletions: Some(0),
        revision: None,
        lines,
        ..summary(false)
    })
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
        Side::Present(size)
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
        Side::Present(
            git::local(prefix, &file.path)
                .and_then(|local| std::fs::symlink_metadata(root.join(local)).ok())
                .map(|m| m.len()),
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
