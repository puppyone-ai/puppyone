//! Project templates (`electron/local-api/templates`): a template is a plan
//! of files only — never a destination, a command or an Agent — written
//! into one new folder that appears whole or not at all. Built-in
//! templates ship with the app ([`builtin`]); a template store link
//! ([`link`]) resolves through the store ([`store`]) to a verified package
//! ([`package`]).
pub mod builtin;
pub mod link;
pub mod package;
pub mod store;

use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

/// `MAX_FILES`, `MAX_BYTES`.
const MAX_FILES: usize = 256;
pub const MAX_BYTES: usize = 32 * 1024 * 1024;
/// `PROJECT_NAME_MAX_LENGTH`.
pub const NAME_MAX: usize = 120;
/// `MAX_NUMBERED_NAMES`.
const MAX_NUMBERED: usize = 1000;

/// What a template writes: workspace-relative files, and the one to open.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Plan {
    pub files: Vec<(String, Vec<u8>)>,
    pub initial_open: Option<String>,
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn reserved(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or(part).to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}
/// `requireRelativeTemplatePath`: at most 16 portable segments, none empty,
/// `.`/`..`, reserved, or ending in a period or space.
pub fn require_relative_path(value: &str) -> Result<&str, String> {
    let invalid = || Err(format!("Invalid template path: {value}"));
    if value.len() > 1024 || value.contains('\\') {
        return Err("Invalid template path.".into());
    }
    let parts: Vec<&str> = value.split('/').collect();
    if parts.len() > 16 {
        return invalid();
    }
    for part in parts {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part
                .chars()
                .any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control())
            || part.ends_with(['.', ' '])
            || part.len() > 240
            || reserved(part)
        {
            return invalid();
        }
    }
    Ok(value)
}
/// `requireProjectName`: trimmed, at most 120 characters, a portable name.
pub fn require_project_name(value: &str) -> Result<&str, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("Enter a project name.".into());
    }
    if name.encode_utf16().count() > NAME_MAX {
        return Err(format!(
            "Project names must be {NAME_MAX} characters or fewer."
        ));
    }
    if name == "."
        || name == ".."
        || name.chars().any(|c| {
            matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control()
        })
        || name.ends_with(['.', ' '])
        || reserved(name)
    {
        return Err(
            "Use a project name without slashes, reserved characters, or a trailing period.".into(),
        );
    }
    Ok(name)
}
/// `projectNameFromTemplate`: a template's display name as a folder name.
pub fn project_name_from(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = joined.chars().take(NAME_MAX).collect();
    cut.trim_end_matches(['.', ' ']).to_owned()
}

/// JavaScript's string order (UTF-16 code units).
fn js_order(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}
/// `validateTemplatePlan`: no conflicting names (case and normalization
/// folded), no file where a folder must be, within the budgets, the file to
/// open among those written. Returns the folders to create, shallowest
/// first, and the plan's digest.
pub fn validate(plan: &Plan) -> Result<(Vec<String>, String), String> {
    use unicode_normalization::UnicodeNormalization as _;
    if plan.files.len() > MAX_FILES {
        return Err("Invalid template file count.".into());
    }
    let key = |name: &str| name.nfc().collect::<String>().to_lowercase();
    let mut names = HashSet::new();
    let mut directories = HashSet::new();
    let mut bytes = 0usize;
    for (path, content) in &plan.files {
        let name = require_relative_path(path)?;
        if !names.insert(key(name)) {
            return Err(format!("Conflicting template path: {name}"));
        }
        bytes += content.len();
        if bytes > MAX_BYTES {
            return Err("Template exceeds the local content budget.".into());
        }
        let parts: Vec<&str> = name.split('/').collect();
        for i in 1..parts.len() {
            directories.insert(parts[..i].join("/"));
        }
    }
    let mut folded: HashMap<String, &str> = HashMap::new();
    for name in &directories {
        let k = key(name);
        if names.contains(&k) || folded.get(&k).is_some_and(|known| *known != name) {
            return Err(format!("Conflicting template directory: {name}"));
        }
        folded.insert(k, name);
    }
    if let Some(open) = &plan.initial_open
        && !plan.files.iter().any(|(path, _)| path == open)
    {
        return Err("The template opening document must be a generated file.".into());
    }
    let mut digest = Sha256::new();
    digest.update(
        serde_json::to_string(&serde_json::json!({ "initialOpenPath": plan.initial_open }))
            .unwrap_or_default(),
    );
    let mut files: Vec<&(String, Vec<u8>)> = plan.files.iter().collect();
    files.sort_by(|a, b| js_order(&a.0, &b.0));
    for (path, content) in files {
        digest.update(serde_json::to_string(&(path, content.len())).unwrap_or_default());
        digest.update(content);
    }
    let mut directories: Vec<String> = directories.into_iter().collect();
    directories.sort_by_key(|d| (d.split('/').count(), d.clone()));
    let digest = digest
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((directories, digest))
}

/// `freeProjectName`: the name, else "name 2", "name 3"… — never a folder
/// that exists.
pub fn free_name(parent: &Path, name: &str) -> Result<String, String> {
    let mut chosen = name.to_owned();
    for number in 2..=MAX_NUMBERED {
        if std::fs::symlink_metadata(parent.join(&chosen)).is_err() {
            return Ok(chosen);
        }
        let suffix = format!(" {number}");
        let room = NAME_MAX - suffix.chars().count();
        let stem: String = name.chars().take(room).collect();
        chosen = require_project_name(&format!("{}{suffix}", stem.trim_end()))?.to_owned();
    }
    Ok(chosen)
}

/// `materializeTemplate`: the plan is written into a hidden staging folder
/// beside the target, which then takes the project's name in one step —
/// only if nothing has that name — so a project appears complete or not at
/// all, and never merges into an existing folder.
pub fn materialize(parent: &Path, name: &str, plan: &Plan) -> Result<PathBuf, String> {
    materialize_while(parent, name, plan, || Ok(()))
}
/// [`materialize`], published only if `still_allowed` holds once every file
/// is written (`validateSource` before `publishDirectory`): a template
/// handed out to one account is not published after another took over.
pub fn materialize_while(
    parent: &Path,
    name: &str,
    plan: &Plan,
    still_allowed: impl FnOnce() -> Result<(), String>,
) -> Result<PathBuf, String> {
    materialize_with(parent, name, plan, still_allowed, publish)
}
fn materialize_with(
    parent: &Path,
    name: &str,
    plan: &Plan,
    still_allowed: impl FnOnce() -> Result<(), String>,
    publish: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<PathBuf, String> {
    let (directories, _) = validate(plan)?;
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err("Invalid template directory name.".into());
    }
    let target = parent.join(name);
    let staging = parent.join(format!(
        ".puppyone-template-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let describe = |error: std::io::Error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!("A file or folder named “{name}” already exists in that location.")
        } else {
            error.to_string()
        }
    };
    let written = (|| -> std::io::Result<()> {
        for directory in &directories {
            std::fs::create_dir(staging.join(directory))?;
        }
        for (path, content) in &plan.files {
            use std::io::Write as _;
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(staging.join(path))?
                .write_all(content)?;
        }
        Ok(())
    })()
    .map_err(&describe)
    .and_then(|()| still_allowed())
    .and_then(|()| publish(&staging, &target).map_err(&describe));
    match written {
        Ok(()) => Ok(target),
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            Err(error)
        }
    }
}
/// `publishDirectory`: rename without replacing anything at `target`.
pub(super) fn publish(staging: &Path, target: &Path) -> std::io::Result<()> {
    if staging.parent() != target.parent() || !std::fs::symlink_metadata(staging)?.is_dir() {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::os::unix::ffi::OsStrExt as _;
        let from = std::ffi::CString::new(staging.as_os_str().as_bytes())?;
        let to = std::ffi::CString::new(target.as_os_str().as_bytes())?;
        // SAFETY: both are valid NUL-terminated paths for the call.
        #[cfg(target_os = "macos")]
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        // SAFETY: the two strings remain valid throughout the syscall. Both
        // names are siblings; no overwrite fallback is permitted on failure.
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(target_os = "windows")]
    {
        // Windows directory moves cannot replace an existing directory.
        std::fs::rename(staging, target)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    Err(std::io::ErrorKind::Unsupported.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn exclusive_publication_has_one_winner_even_for_two_empty_directories() {
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("target");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let mut attempts = Vec::new();
        for name in ["first", "second"] {
            let staging = parent.path().join(name);
            std::fs::create_dir(&staging).unwrap();
            let target = target.clone();
            let ready = barrier.clone();
            attempts.push(std::thread::spawn(move || {
                ready.wait();
                let result = publish(&staging, &target);
                (staging, result)
            }));
        }
        barrier.wait();
        let results: Vec<_> = attempts.into_iter().map(|a| a.join().unwrap()).collect();
        assert_eq!(
            results.iter().filter(|(_, result)| result.is_ok()).count(),
            1
        );
        for (staging, result) in results {
            match result {
                Ok(()) => assert!(!staging.exists()),
                Err(error) => {
                    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
                    assert!(staging.is_dir(), "the losing caller retains its staging");
                }
            }
        }
        assert!(target.is_dir());
        assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn publication_rejects_linked_staging_and_preserves_files_and_dangling_targets() {
        let parent = tempfile::tempdir().unwrap();
        let staging = parent.path().join("staging");
        std::fs::create_dir(&staging).unwrap();
        let target = parent.path().join("target");
        std::fs::write(&target, "keep").unwrap();
        assert!(publish(&staging, &target).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "keep");
        std::fs::remove_file(&target).unwrap();
        let absent = parent.path().join("absent");
        std::os::unix::fs::symlink(&absent, &target).unwrap();
        assert!(publish(&staging, &target).is_err());
        assert_eq!(std::fs::read_link(&target).unwrap(), absent);
        let linked = parent.path().join("linked");
        std::os::unix::fs::symlink(&staging, &linked).unwrap();
        assert_eq!(
            publish(&linked, &absent).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
        assert!(staging.is_dir());
        assert!(!absent.exists());
        let other = tempfile::tempdir().unwrap();
        assert_eq!(
            publish(&staging, &other.path().join("target"))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidInput
        );
    }

    fn plan(files: &[(&str, &str)], open: Option<&str>) -> Plan {
        Plan {
            files: files
                .iter()
                .map(|(p, c)| (p.to_string(), c.as_bytes().to_vec()))
                .collect(),
            initial_open: open.map(str::to_owned),
        }
    }

    #[test]
    fn a_plan_holds_portable_paths_without_conflicts() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        assert!(validate(&plan(&[("a.md", "x"), ("docs/b.md", "y")], Some("a.md"))).is_ok());
        for bad in [
            "../x.md",
            "/x.md",
            "a//b",
            "a\\b",
            "con.md",
            "a/trailing.",
            "x:y",
            // `project-initialization`'s unsafe outputs.
            "../outside",
            "a/../b",
            "a:",
            "NUL.txt",
            "a. ",
            "a/CON",
            "a\0b",
        ] {
            let error = materialize(parent, "Notes", &plan(&[(bad, "no")], None)).unwrap_err();
            assert!(error.to_lowercase().contains("invalid"), "{bad}: {error}");
        }
        assert_eq!(
            std::fs::read_dir(parent).unwrap().count(),
            0,
            "nothing written"
        );
        let refused = |files: &[(&str, &str)], open: Option<&str>, reason: &str| {
            let error = validate(&plan(files, open)).unwrap_err();
            assert!(error.to_lowercase().contains(reason), "{files:?}: {error}");
        };
        // Case-folded and canonically equivalent names, a file where a
        // folder must be, folders differing in case.
        for files in [
            [("A.md", "a"), ("a.md", "b")],
            [("a", "a"), ("a/b", "b")],
            [("docs", ""), ("docs/b.md", "")],
            [("\u{e9}.md", "a"), ("e\u{301}.md", "b")],
            [("A/b", "a"), ("a/c", "b")],
            [("Docs/a.md", ""), ("docs/b.md", "")],
        ] {
            refused(&files, None, "conflict");
        }
        // The file to open must be one it writes.
        refused(&[("a.md", "")], Some("b.md"), "opening document");
        refused(
            &[("a.md", "")],
            Some("https://example.com"),
            "opening document",
        );
        // Counts and bytes are bounded.
        let many: Vec<(String, &str)> = (0..=MAX_FILES).map(|n| (format!("{n}.md"), "")).collect();
        let many: Vec<(&str, &str)> = many.iter().map(|(p, c)| (p.as_str(), *c)).collect();
        refused(&many, None, "count");
        let big = "x".repeat(MAX_BYTES + 1);
        refused(&[("big", big.as_str())], None, "budget");
        let (folders, _) = validate(&plan(&[("x/y/z.md", ""), ("x/a.md", "")], None)).unwrap();
        assert_eq!(folders, vec!["x", "x/y"]);
    }

    #[test]
    fn a_project_appears_whole_and_never_merges() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        let made = materialize(
            parent,
            "Notes",
            &plan(&[("Getting Started.md", "# Hi"), ("a/b.md", "b")], None),
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(made.join("a/b.md")).unwrap(), "b");
        // An existing folder is never written into, and nothing is left behind.
        let error = materialize(parent, "Notes", &plan(&[("x.md", "")], None)).unwrap_err();
        assert!(error.contains("already exists"), "{error}");
        assert!(!made.join("x.md").exists());
        let leftovers = std::fs::read_dir(parent)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".puppyone-template-")
            })
            .count();
        assert_eq!(leftovers, 0);
        // An empty folder is not replaced either.
        std::fs::create_dir(parent.join("Empty")).unwrap();
        assert!(materialize(parent, "Empty", &plan(&[], None)).is_err());
        // Numbering picks a name no folder has yet.
        assert_eq!(free_name(parent, "Notes").unwrap(), "Notes 2");
        assert_eq!(free_name(parent, "Fresh").unwrap(), "Fresh");
    }

    /// Another process makes the project's folder after the files are
    /// staged: even an empty one is not replaced, and the staging goes.
    #[test]
    fn a_folder_made_just_before_publication_is_never_replaced() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        let target = parent.join("Notes");
        let error = materialize_while(
            parent,
            "Notes",
            &plan(
                &[("Getting Started.md", "hello")],
                Some("Getting Started.md"),
            ),
            || {
                assert!(!target.exists());
                std::fs::create_dir(&target).unwrap();
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.contains("already exists"), "{error}");
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 0);
        let names: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["Notes"]);
    }

    /// A failure after staging, or a publisher that cannot refuse to
    /// replace, removes only the staging and publishes nothing.
    #[test]
    fn a_failure_cleans_only_its_staging_and_never_publishes_part_of_a_project() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        std::fs::write(parent.join("keep.txt"), "keep").unwrap();
        let files = plan(&[("a", "a"), ("b", "b")], None);
        let error = materialize_while(parent, "Notes", &files, || Err("disk full".into()));
        assert_eq!(error, Err("disk full".into()));
        let error = materialize_with(
            parent,
            "Notes",
            &files,
            || Ok(()),
            |_, _| Err(std::io::Error::other("unsupported filesystem")),
        );
        assert_eq!(error, Err("unsupported filesystem".into()));
        let names: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["keep.txt"]);
        assert_eq!(
            std::fs::read_to_string(parent.join("keep.txt")).unwrap(),
            "keep"
        );
    }

    /// `cancels publication when the user changes account during
    /// materialization`: the check runs once every file is written, and a
    /// refusal publishes nothing and leaves nothing behind.
    #[test]
    fn a_refused_publication_leaves_nothing_behind() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        let files = plan(&[("README.md", "# Hi"), ("a/b.md", "b")], None);
        let error = materialize_while(parent, "CRM", &files, || {
            let staged: Vec<_> = std::fs::read_dir(parent)
                .unwrap()
                .map(|e| e.unwrap().path())
                .collect();
            assert_eq!(staged.len(), 1);
            assert_eq!(
                std::fs::read_to_string(staged[0].join("a/b.md")).unwrap(),
                "b"
            );
            Err("Sign in again.".into())
        })
        .unwrap_err();
        assert_eq!(error, "Sign in again.");
        assert_eq!(std::fs::read_dir(parent).unwrap().count(), 0);
        let made = materialize_while(parent, "CRM", &files, || Ok(())).unwrap();
        assert_eq!(made, parent.join("CRM"));
        assert!(made.join("README.md").is_file());
    }

    #[test]
    fn a_template_name_becomes_a_folder_name() {
        assert_eq!(
            project_name_from("  Weekly: plan / notes.. "),
            "Weekly plan notes"
        );
        assert_eq!(project_name_from("a\u{0}b"), "a b");
        assert_eq!(
            project_name_from(&"x".repeat(200)).chars().count(),
            NAME_MAX
        );
        assert!(require_project_name("COM1").is_err());
        assert!(require_project_name("Notes").is_ok());
    }
}
