//! A working revision owns an admitted descriptor under a retained root.
//! Paths cannot be reopened through symlinks and no read can exceed its budget.
use crate::platform::webview::files::{LocalRoot, OpenedFile};
use std::{
    fs::Metadata,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

const CHUNK_BYTES: usize = 64 * 1024;
pub(super) const CANCELLED: &str = "Git diff reading was cancelled.";
const CHANGED: &str = "Working-tree revision changed while it was being read.";
const TOO_LARGE: &str = "The revision exceeds the diff resource budget.";

pub(super) fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}

pub(super) struct Revision {
    root: LocalRoot,
    path: PathBuf,
    opened: OpenedFile,
    before: Metadata,
}
impl Revision {
    /// Directories have no bytes to preview; the caller may show metadata.
    pub(super) fn open(
        root: &Path,
        path: &str,
        cancel: &AtomicBool,
    ) -> Result<Option<Self>, String> {
        check_cancel(cancel)?;
        let root = LocalRoot::open(root).map_err(|e| e.to_string())?;
        let path = PathBuf::from(path);
        let metadata = root.metadata_exact(&path).map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            return Ok(None);
        }
        let opened = root.file_exact(&path).map_err(|e| e.to_string())?;
        let before = opened.file.metadata().map_err(|e| e.to_string())?;
        check_cancel(cancel)?;
        Ok(Some(Self {
            root,
            path,
            opened,
            before,
        }))
    }
    pub(super) fn size(&self) -> u64 {
        self.before.len()
    }

    pub(super) fn read(mut self, max: u64, cancel: &AtomicBool) -> Result<Vec<u8>, String> {
        check_cancel(cancel)?;
        if self.size() > max {
            return Err(TOO_LARGE.into());
        }
        let bytes = read_bytes(&mut self.opened.file, max, cancel)?;
        self.validate(cancel)?;
        if bytes.len() as u64 != self.size() {
            return Err(CHANGED.into());
        }
        Ok(bytes)
    }
    pub(super) fn validate(&self, cancel: &AtomicBool) -> Result<(), String> {
        check_cancel(cancel)?;
        let after = self.opened.file.metadata().map_err(|e| e.to_string())?;
        let at_path = self
            .root
            .file_exact(&self.path)
            .map_err(|_| CHANGED.to_owned())?;
        let at_path = at_path.file.metadata().map_err(|e| e.to_string())?;
        check_cancel(cancel)?;
        if !same_snapshot(&self.before, &after) || !same_snapshot(&self.before, &at_path) {
            return Err(CHANGED.into());
        }
        Ok(())
    }
    pub(super) fn identity(&self) -> Option<String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let m = &self.before;
            Some(format!(
                "working:{}:{}:{}:{}:{}:{}:{}:{}",
                m.dev(),
                m.ino(),
                m.mode(),
                m.len(),
                m.mtime(),
                m.mtime_nsec(),
                m.ctime(),
                m.ctime_nsec()
            ))
        }
        // Do not reuse mutable revisions on hosts without a complete native
        // file identity. Immutable Git blobs can still use the cache.
        #[cfg(not(unix))]
        {
            None
        }
    }
}

fn same_snapshot(a: &Metadata, b: &Metadata) -> bool {
    if a.len() != b.len() || a.modified().ok() != b.modified().ok() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if (a.dev(), a.ino(), a.mode(), a.ctime(), a.ctime_nsec())
            != (b.dev(), b.ino(), b.mode(), b.ctime(), b.ctime_nsec())
        {
            return false;
        }
    }
    true
}

fn read_bytes(reader: &mut impl Read, max: u64, cancel: &AtomicBool) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; CHUNK_BYTES];
    loop {
        check_cancel(cancel)?;
        // At most one byte beyond the limit is read to detect growth, never
        // appended to the owned result. An adversarial reader cannot allocate
        // an unbounded Vec even when it never reaches EOF.
        let remaining = max.saturating_sub(bytes.len() as u64).saturating_add(1);
        let take = (remaining.min(CHUNK_BYTES as u64)) as usize;
        let count = reader
            .read(&mut buffer[..take])
            .map_err(|e| e.to_string())?;
        check_cancel(cancel)?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len() as u64 + count as u64 > max {
            return Err(TOO_LARGE.into());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Cursor};

    #[test]
    fn bounded_chunks_cancel_before_reading_or_delivering_another_chunk() {
        struct CancelOnRead<'a> {
            cancel: &'a AtomicBool,
            calls: usize,
        }
        impl Read for CancelOnRead<'_> {
            fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
                self.calls += 1;
                out.fill(7);
                self.cancel.store(true, Ordering::Release);
                Ok(out.len())
            }
        }
        let cancel = AtomicBool::new(true);
        let mut reader = CancelOnRead {
            cancel: &cancel,
            calls: 0,
        };
        assert_eq!(
            read_bytes(&mut reader, 2 * CHUNK_BYTES as u64, &cancel).unwrap_err(),
            CANCELLED
        );
        assert_eq!(reader.calls, 0);
        cancel.store(false, Ordering::Release);
        assert_eq!(
            read_bytes(&mut reader, 2 * CHUNK_BYTES as u64, &cancel).unwrap_err(),
            CANCELLED
        );
        assert_eq!(reader.calls, 1);
        cancel.store(false, Ordering::Release);
        let mut bytes = Cursor::new(vec![3; 2 * CHUNK_BYTES]);
        assert_eq!(read_bytes(&mut bytes, 10, &cancel).unwrap_err(), TOO_LARGE);
        assert_eq!(bytes.position(), 11, "only one overflow probe byte");
    }

    #[test]
    fn a_revision_rejects_growth_and_replacement_after_admission() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("working");
        let cancel = AtomicBool::new(false);
        std::fs::write(&path, b"original").unwrap();
        let revision = Revision::open(root.path(), "working", &cancel)
            .unwrap()
            .unwrap();
        std::fs::write(&path, b"original plus growth").unwrap();
        assert!(
            revision
                .read(1024, &cancel)
                .unwrap_err()
                .contains("changed")
        );
        let revision = Revision::open(root.path(), "working", &cancel)
            .unwrap()
            .unwrap();
        std::fs::rename(&path, root.path().join("retired")).unwrap();
        std::fs::write(&path, b"replacement content").unwrap();
        assert!(
            revision
                .read(1024, &cancel)
                .unwrap_err()
                .contains("changed")
        );
    }

    #[cfg(unix)]
    #[test]
    fn root_and_parent_replacements_cannot_redirect_admitted_bytes() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::create_dir_all(outside.join("sub")).unwrap();
        std::fs::write(root.join("sub/file"), b"admitted").unwrap();
        std::fs::write(outside.join("sub/file"), b"outside secret").unwrap();
        let cancel = AtomicBool::new(false);
        let revision = Revision::open(&root, "sub/file", &cancel).unwrap().unwrap();
        std::fs::rename(&root, temp.path().join("retained")).unwrap();
        symlink(&outside, &root).unwrap();
        assert_eq!(revision.read(1024, &cancel).unwrap(), b"admitted");
        let root = temp.path().join("retained");
        let revision = Revision::open(&root, "sub/file", &cancel).unwrap().unwrap();
        std::fs::rename(root.join("sub"), root.join("retired-sub")).unwrap();
        symlink(outside.join("sub"), root.join("sub")).unwrap();
        assert!(revision.read(1024, &cancel).is_err());
        assert!(Revision::open(&root, "sub/file", &cancel).is_err());
    }

    #[test]
    fn git_reads_require_exact_names_and_preserve_binary_bytes() {
        let root = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        std::fs::write(root.path().join("space\u{a0}name"), b"\0\xff\x80").unwrap();
        assert!(Revision::open(root.path(), "space name", &cancel).is_err());
        let revision = Revision::open(root.path(), "space\u{a0}name", &cancel)
            .unwrap()
            .unwrap();
        assert_eq!(revision.size(), 3);
        assert_eq!(revision.read(3, &cancel).unwrap(), b"\0\xff\x80");
        assert!(
            matches!(Revision::open(root.path(), "missing", &AtomicBool::new(true)), Err(e) if e.contains("cancelled"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn non_regular_entries_never_block_a_revision_read() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let root = tempfile::tempdir().unwrap();
        let pipe = CString::new(root.path().join("pipe").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(pipe.as_ptr(), 0o600) }, 0);
        let cancel = AtomicBool::new(false);
        assert!(Revision::open(root.path(), "pipe", &cancel).is_err());
        std::fs::create_dir(root.path().join("folder")).unwrap();
        assert!(
            Revision::open(root.path(), "folder", &cancel)
                .unwrap()
                .is_none()
        );
    }

    #[cfg(unix)]
    #[test]
    fn same_size_writes_cannot_hide_behind_a_restored_modification_time() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        std::fs::write(&path, b"original").unwrap();
        let cancel = AtomicBool::new(false);
        let revision = Revision::open(root.path(), "file", &cancel)
            .unwrap()
            .unwrap();
        let modified = revision.before.modified().unwrap();
        std::fs::write(&path, b"replaced").unwrap();
        std::fs::File::open(&path)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        assert!(
            revision
                .read(1024, &cancel)
                .unwrap_err()
                .contains("changed")
        );
    }
}
