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
    let written = (|| {
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
        publish(&staging, &target)
    })();
    match written {
        Ok(()) => Ok(target),
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!("A file or folder named “{name}” already exists in that location.")
            } else {
                error.to_string()
            })
        }
    }
}
/// `publishDirectory`: rename without replacing anything at `target`.
fn publish(staging: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt as _;
        let from = std::ffi::CString::new(staging.as_os_str().as_bytes())?;
        let to = std::ffi::CString::new(target.as_os_str().as_bytes())?;
        // SAFETY: both are valid NUL-terminated paths for the call.
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        if result == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        if std::fs::symlink_metadata(target).is_ok() {
            return Err(std::io::ErrorKind::AlreadyExists.into());
        }
        std::fs::rename(staging, target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

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
        assert!(validate(&plan(&[("a.md", "x"), ("docs/b.md", "y")], Some("a.md"))).is_ok());
        for bad in [
            "../x.md",
            "/x.md",
            "a//b",
            "a\\b",
            "con.md",
            "a/trailing.",
            "x:y",
        ] {
            assert!(validate(&plan(&[(bad, "")], None)).is_err(), "{bad}");
        }
        // Case-folded names and a file where a folder must be.
        assert!(validate(&plan(&[("A.md", ""), ("a.md", "")], None)).is_err());
        assert!(validate(&plan(&[("docs", ""), ("docs/b.md", "")], None)).is_err());
        assert!(validate(&plan(&[("Docs/a.md", ""), ("docs/b.md", "")], None)).is_err());
        // The file to open must be one it writes.
        assert!(validate(&plan(&[("a.md", "")], Some("b.md"))).is_err());
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
