//! `planExplorerRefresh`: refresh a loaded folder itself and its nearest
//! loaded ancestor. An unopened subtree reads fresh bytes when expanded.
use crate::workspace::contracts::RelativePath;
use std::path::PathBuf;

pub(super) fn folders(loaded: &[PathBuf], changed: Option<&[RelativePath]>) -> Vec<PathBuf> {
    let Some(changed) = changed else {
        return loaded.to_vec();
    };
    let mut result = Vec::new();
    for path in changed {
        if loaded.iter().any(|p| p == path.as_path()) {
            result.push(path.as_path().into());
        }
        let mut ancestor = path.as_path().parent();
        while let Some(path) = ancestor {
            if loaded.iter().any(|p| p == path) {
                result.push(path.into());
                break;
            }
            ancestor = path.parent();
        }
    }
    result.sort();
    result.dedup();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn scoped_changes_refresh_the_nearest_loaded_ancestor_and_never_unopened_folders() {
        let loaded = ["", "docs", "docs/deep", "other"].map(PathBuf::from);
        for (changed, expected) in [
            (vec!["docs/guide.md"], vec!["docs"]),
            (vec!["readme.md"], vec![""]),
            (vec!["docs/deep"], vec!["docs", "docs/deep"]),
            (vec!["archive/2024/report.md"], vec![""]),
            (
                vec!["docs/guide.md", "docs/new.md", "docs/deep/note.md"],
                vec!["docs", "docs/deep"],
            ),
            (vec!["docs"], vec!["", "docs"]),
        ] {
            let paths: Vec<_> = changed
                .iter()
                .map(|p| RelativePath::new(Path::new(p)).unwrap())
                .collect();
            assert_eq!(
                folders(&loaded, Some(&paths)),
                expected.iter().map(PathBuf::from).collect::<Vec<_>>(),
                "{changed:?}"
            );
        }
        assert_eq!(folders(&loaded, None), loaded);
        assert!(folders(&loaded, Some(&[])).is_empty());
    }
}
