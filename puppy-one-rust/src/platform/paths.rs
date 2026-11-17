//! Lexical path arithmetic on the host's path flavor: absolute paths,
//! `relative` paths between two of them, containment and file names, with
//! the same answers as Node's `path` module that the product's Main process
//! uses. No call touches the file system.
use std::path::{Component, MAIN_SEPARATOR_STR, Path, PathBuf};

/// The absolute `path` with `.` dropped and `..` folded (Node `path.normalize`): drops `.` and folds `..`
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

/// `input` made absolute against the process working directory (Node
/// `path.resolve(input)`).
pub fn absolute(input: impl AsRef<Path>) -> PathBuf {
    resolve(std::env::current_dir().unwrap_or_default(), input)
}

/// `input` made absolute against `base` (Node `path.resolve(base, input)`).
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

/// The path from `from` to `to`: `""` for the same path, `..` segments to
/// leave `from`, and `to` itself across Windows drives (Node
/// `path.relative`).
pub fn relative(from: impl AsRef<Path>, to: impl AsRef<Path>) -> String {
    let from = absolute(from);
    let to = absolute(to);
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

/// Whether `value` is an absolute path on this host.
pub fn is_absolute(value: &str) -> bool {
    Path::new(value).is_absolute()
}

/// The last component of `value`, or `""`.
pub fn file_name(value: &str) -> String {
    Path::new(value)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Whether `target` is `root` or lies inside it, lexically (the product's
/// `isSameOrInside(root, filename)`).
pub fn is_same_or_inside(root: impl AsRef<Path>, target: impl AsRef<Path>) -> bool {
    let relative = relative(root, target);
    relative.is_empty() || (!relative.starts_with("..") && !is_absolute(&relative))
}

/// The user's home directory, or an empty path.
pub fn home_dir() -> PathBuf {
    std::env::home_dir().unwrap_or_default()
}

/// POSIX and Windows path strings, whatever the host (Node `path.posix`
/// and `path.win32`).
pub mod flavor {
    /// `path.posix.isAbsolute(value)`.
    pub fn posix_is_absolute(value: &str) -> bool {
        value.starts_with('/')
    }

    /// `path.posix.basename(value)`.
    pub fn posix_basename(value: &str) -> &str {
        value.trim_end_matches('/').rsplit('/').next().unwrap_or("")
    }

    /// `path.win32.isAbsolute(value)`: a drive root, a UNC path or a rooted
    /// path.
    pub fn win32_is_absolute(value: &str) -> bool {
        let bytes = value.as_bytes();
        matches!(bytes.first(), Some(b'\\' | b'/'))
            || (bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/'))
    }

    /// `path.win32.basename(value)`.
    pub fn win32_basename(value: &str) -> &str {
        value
            .trim_end_matches(['\\', '/'])
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
    }

    /// `path.win32.dirname(value)`.
    pub fn win32_dirname(value: &str) -> &str {
        let trimmed = value.trim_end_matches(['\\', '/']);
        match trimmed.rfind(['\\', '/']) {
            Some(0) => &trimmed[..1],
            Some(index) if index == 2 && trimmed.as_bytes()[1] == b':' => &trimmed[..3],
            Some(index) => &trimmed[..index],
            None => ".",
        }
    }

    /// `path.win32.join(...segments)` for an absolute first segment.
    pub fn win32_join(segments: &[&str]) -> String {
        let mut joined = String::new();
        for segment in segments.iter().filter(|s| !s.is_empty()) {
            let first = joined.is_empty();
            if !first && !joined.ends_with(['\\', '/']) {
                joined.push('\\');
            }
            let segment = if first {
                segment
            } else {
                segment.trim_start_matches(['\\', '/'])
            };
            joined.push_str(segment);
        }
        joined.replace('/', "\\")
    }
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
        assert_eq!(file_name("/usr/bin/codex"), "codex");
    }
}
