//! Port of `security/activity-path-policy.mjs`: a candidate becomes public
//! only as a path inside the session's canonical workspace root. Symlinks
//! are resolved first, so a link cannot reveal or claim a file outside it;
//! a write-like target that does not exist yet resolves through its nearest
//! existing ancestor.
use super::{Access, PublicTarget, bounded_path};
use std::path::{Component, Path, PathBuf};

pub fn resolve(path: &str, access: Access, cwd: &str, root: &Path) -> Option<PublicTarget> {
    let root_text = root.to_str()?;
    if !bounded_path(path) || !bounded_path(cwd) || !bounded_path(root_text) || !root.is_absolute()
    {
        return None;
    }
    let canonical_root = std::fs::canonicalize(root).ok()?;
    let candidate = Path::new(path);
    let absolute = if candidate.is_absolute() {
        normalize(candidate)
    } else {
        normalize(&Path::new(cwd).join(candidate))
    };
    let canonical = canonicalize_target(&absolute, access)?;
    let relative = canonical.strip_prefix(&canonical_root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    let parts: Vec<&str> = relative
        .components()
        .map(|c| match c {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<_>>()?;
    let relative = parts.join("/");
    bounded_path(&relative).then_some(PublicTarget { relative, access })
}

fn canonicalize_target(absolute: &Path, access: Access) -> Option<PathBuf> {
    if let Ok(path) = std::fs::canonicalize(absolute) {
        return Some(path);
    }
    if !access.write_like() {
        return None;
    }
    let mut missing = Vec::new();
    let mut cursor = absolute.to_path_buf();
    loop {
        let name = cursor.file_name()?.to_owned();
        missing.push(name);
        cursor = cursor.parent()?.to_path_buf();
        if let Ok(parent) = std::fs::canonicalize(&cursor) {
            return Some(missing.iter().rev().fold(parent, |p, part| p.join(part)));
        }
    }
}

/// `path.normalize`: `.` and `..` resolved lexically.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn only_paths_inside_the_workspace_become_public() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "").unwrap();
        std::fs::write(dir.path().join("outside.txt"), "").unwrap();
        let cwd = root.to_str().unwrap();
        let read = |p: &str| resolve(p, Access::Read, cwd, &root).map(|t| t.relative);
        assert_eq!(read("src/a.rs").as_deref(), Some("src/a.rs"));
        assert_eq!(read("./src/../src/a.rs").as_deref(), Some("src/a.rs"));
        let absolute = root.join("src/a.rs");
        assert_eq!(
            read(absolute.to_str().unwrap()).as_deref(),
            Some("src/a.rs")
        );
        assert_eq!(read("../outside.txt"), None);
        assert_eq!(read("."), None);
        // A missing file is public only when it is being written.
        assert_eq!(read("src/new.rs"), None);
        let write = resolve("src/new/deep.rs", Access::Write, cwd, &root);
        assert_eq!(write.unwrap().relative, "src/new/deep.rs");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("outside.txt"), root.join("link")).unwrap();
            assert_eq!(read("link"), None);
        }
    }
}
