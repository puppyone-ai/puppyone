//! `folder-availability.mjs` and the finding half of `folder-relocation.mjs`:
//! whether a project's folder can be opened right now, and if not, why, in
//! terms a person can act on — gone from where it was, its disk not
//! connected, or not ours to open. A folder is never assumed gone while its
//! disk is merely away. Calls touch the file system: run them off the main
//! thread.
use std::path::{Path, PathBuf};

/// `FolderStatus.state`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Available,
    Missing,
    Disconnected,
    Denied,
    NotAFolder,
}

/// `probeFolderAvailability`.
pub fn probe(folder: &Path) -> State {
    if !folder.is_absolute() {
        return State::Missing;
    }
    match std::fs::metadata(folder) {
        Ok(meta) if !meta.is_dir() => State::NotAFolder,
        Ok(_) => match std::fs::read_dir(folder) {
            Ok(_) => State::Available,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => State::Denied,
            Err(_) => State::Available,
        },
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => State::Denied,
        Err(_) => match volume_root(folder) {
            Some(volume) if !volume.exists() => State::Disconnected,
            _ => State::Missing,
        },
    }
}

/// The mount point a removable or network disk is reached through, when the
/// path is on one.
fn volume_root(folder: &Path) -> Option<PathBuf> {
    let parts: Vec<&std::ffi::OsStr> = folder
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(part) => Some(part),
            _ => None,
        })
        .collect();
    let root = |n: usize| -> PathBuf {
        std::iter::once(std::ffi::OsStr::new("/"))
            .chain(parts[..n].iter().copied())
            .collect()
    };
    if cfg!(target_os = "macos") {
        (parts.len() >= 2 && parts[0] == "Volumes").then(|| root(2))
    } else if parts.first().is_some_and(|p| *p == "media") && parts.len() >= 3 {
        Some(root(3))
    } else if parts.first().is_some_and(|p| *p == "mnt") && parts.len() >= 2 {
        Some(root(2))
    } else {
        None
    }
}

/// `fsIdentity`: the folder itself, wherever it is renamed to on its disk.
pub fn identity(folder: &Path) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::metadata(folder).ok()?;
        meta.is_dir()
            .then(|| format!("fs:{}:{}", meta.dev(), meta.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = folder;
        None
    }
}

/// `renamedInPlace`: the same folder, renamed where it was — the commonest
/// way a project goes missing. At most 2000 neighbours are looked at.
pub fn renamed_in_place(original: &Path, identity_was: &str) -> Option<PathBuf> {
    if !identity_was.starts_with("fs:") {
        return None;
    }
    let parent = original.parent()?;
    std::fs::read_dir(parent)
        .ok()?
        .flatten()
        .take(2000)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .map(|entry| entry.path())
        .find(|candidate| identity(candidate).as_deref() == Some(identity_was))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_is_available_missing_or_not_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("file.md"), "x").unwrap();
        assert_eq!(probe(&root), State::Available);
        assert_eq!(probe(&root.join("gone")), State::Missing);
        assert_eq!(probe(&root.join("file.md")), State::NotAFolder);
        assert_eq!(probe(Path::new("relative")), State::Missing);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_folder_on_a_disk_that_is_away_is_disconnected_not_gone() {
        assert_eq!(
            probe(Path::new("/Volumes/No Such Disk 4f1c/Projects/notes")),
            State::Disconnected
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_renamed_where_it_was_is_found_again() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let before = root.join("Notes");
        std::fs::create_dir(&before).unwrap();
        std::fs::create_dir(root.join("Other")).unwrap();
        let was = identity(&before).unwrap();
        let after = root.join("Notes 2026");
        std::fs::rename(&before, &after).unwrap();
        assert_eq!(probe(&before), State::Missing);
        assert_eq!(renamed_in_place(&before, &was), Some(after));
        assert_eq!(renamed_in_place(&before, "cloud:x"), None);
    }
}
