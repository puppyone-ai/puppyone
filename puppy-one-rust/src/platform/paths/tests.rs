use super::*;
use core::prelude::v1::test;

#[cfg(unix)]
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

#[test]
fn standard_directories_are_non_empty_and_scoped() {
    assert!(!data_dir().as_os_str().is_empty());
    assert!(!config_dir().as_os_str().is_empty());
    assert!(!cache_dir().as_os_str().is_empty());
    assert!(!logs_dir().as_os_str().is_empty());
}

#[test]
fn electron_dir_prefers_lowercase_channel_name_before_legacy() {
    let dir = tempfile::tempdir().unwrap();
    let picked = pick_electron_dir(dir.path(), Channel::Stable);
    assert_eq!(picked, dir.path().join("puppyone"));

    std::fs::create_dir(dir.path().join("PuppyOne")).unwrap();
    let legacy = pick_electron_dir(dir.path(), Channel::Stable);
    assert_eq!(legacy, dir.path().join("PuppyOne"));

    std::fs::create_dir(dir.path().join("puppyone")).unwrap();
    let canonical = pick_electron_dir(dir.path(), Channel::Stable);
    assert_eq!(canonical, dir.path().join("puppyone"));
}
