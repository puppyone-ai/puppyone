//! Node's `path` module as the product's Main process uses it: lexical
//! `resolve`, `relative` and `basename` on the host's path flavor. No call
//! touches the file system.
use std::path::{Component, MAIN_SEPARATOR_STR, Path, PathBuf};

/// `path.normalize(path)` for an absolute path: drops `.` and folds `..`
/// without walking above the root.
pub fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if normalized.parent().is_some() {
                    normalized.pop();
                }
            }
            Component::Normal(segment) => normalized.push(segment),
        }
    }
    normalized
}

/// `path.resolve(input)`: relative to the process working directory.
pub fn resolve_one(input: impl AsRef<Path>) -> PathBuf {
    resolve(std::env::current_dir().unwrap_or_default(), input)
}

/// `path.resolve(base, input)`.
pub fn resolve(base: impl AsRef<Path>, input: impl AsRef<Path>) -> PathBuf {
    let input = input.as_ref();
    if input.is_absolute() {
        return normalize(input);
    }
    let base = base.as_ref();
    let base = if base.is_absolute() {
        base.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(base)
    };
    normalize(&base.join(input))
}

fn same_component(left: &Component<'_>, right: &Component<'_>) -> bool {
    if cfg!(windows) {
        left.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
    } else {
        left == right
    }
}

/// `path.relative(from, to)`: `""` for the same path, `..` segments to
/// leave `from`, and `to` itself across Windows drives.
pub fn relative(from: impl AsRef<Path>, to: impl AsRef<Path>) -> String {
    let from = resolve_one(from);
    let to = resolve_one(to);
    let from: Vec<Component<'_>> = from.components().collect();
    let target: Vec<Component<'_>> = to.components().collect();
    let common = from
        .iter()
        .zip(&target)
        .take_while(|(left, right)| same_component(left, right))
        .count();
    if common == 0 {
        return to.to_string_lossy().into_owned();
    }
    let mut parts: Vec<String> = vec!["..".into(); from.len() - common];
    parts.extend(
        target[common..]
            .iter()
            .map(|component| component.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join(MAIN_SEPARATOR_STR)
}

/// `path.isAbsolute(value)`.
pub fn is_absolute(value: &str) -> bool {
    Path::new(value).is_absolute()
}

/// `path.basename(value)`.
pub fn basename(value: &str) -> String {
    Path::new(value)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The product's `isSameOrInside(root, filename)`: `relative === "" ||
/// (!relative.startsWith("..") && !path.isAbsolute(relative))`.
pub fn is_same_or_inside(root: impl AsRef<Path>, target: impl AsRef<Path>) -> bool {
    let relative = relative(root, target);
    relative.is_empty() || (!relative.starts_with("..") && !is_absolute(&relative))
}

/// `os.homedir()`.
pub fn homedir() -> PathBuf {
    std::env::home_dir().unwrap_or_default()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn resolves_and_relates_like_node_posix() {
        assert_eq!(resolve("/a/b", "../c/./d"), PathBuf::from("/a/c/d"));
        assert_eq!(resolve("/a", "/x/../y"), PathBuf::from("/y"));
        assert_eq!(resolve("/", "../../a"), PathBuf::from("/a"));
        assert_eq!(relative("/a/b", "/a/b"), "");
        assert_eq!(relative("/a/b", "/a/b/c/d"), "c/d");
        assert_eq!(relative("/a/b", "/a/c"), "../c");
        assert!(is_same_or_inside("/w", "/w/x"));
        assert!(is_same_or_inside("/w", "/w"));
        assert!(!is_same_or_inside("/w", "/wx"));
        assert!(!is_same_or_inside("/w", "/"));
        assert_eq!(basename("/usr/bin/codex"), "codex");
    }
}
