#![cfg(test)]
use super::*;
use crate::workspace::{Workspace, contracts::*, ports::*, testing::Memory};
use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

#[test]
fn local_reader_retains_its_root_and_open_file_when_paths_are_replaced() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("project");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("file.bin"), b"original").unwrap();
    let ws = Workspace::open(&root).unwrap();
    let resource = ws.resource(Path::new("file.bin")).unwrap();
    std::fs::rename(&root, temp.path().join("moved")).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("file.bin"), b"foreign").unwrap();
    let mut reader = resource.reader().unwrap();
    assert_eq!(reader.len(), 8);
    std::fs::rename(
        temp.path().join("moved/file.bin"),
        temp.path().join("saved.bin"),
    )
    .unwrap();
    std::fs::write(temp.path().join("moved/file.bin"), b"replacement").unwrap();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"original");
}

#[cfg(unix)]
#[test]
fn local_reader_refuses_link_substitution_before_opening_and_identity_retargeting() {
    for parent in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("docs")).unwrap();
        std::fs::create_dir(temp.path().join("other")).unwrap();
        std::fs::write(temp.path().join("docs/file.bin"), b"original").unwrap();
        std::fs::write(temp.path().join("other/file.bin"), b"secret").unwrap();
        let ws = Workspace::open(temp.path()).unwrap();
        let resource = ws.resource(Path::new("docs/file.bin")).unwrap();
        let mut retargeted = resource.clone();
        retargeted.identity.path = RelativePath::new(Path::new("other/file.bin")).unwrap();
        assert!(matches!(
            retargeted.reader(),
            Err(Error {
                kind: ErrorKind::ForeignResource,
                ..
            })
        ));
        if parent {
            std::fs::rename(temp.path().join("docs"), temp.path().join("saved")).unwrap();
            std::os::unix::fs::symlink("other", temp.path().join("docs")).unwrap();
        } else {
            std::fs::remove_file(temp.path().join("docs/file.bin")).unwrap();
            std::os::unix::fs::symlink("../other/file.bin", temp.path().join("docs/file.bin"))
                .unwrap();
        }
        assert!(resource.reader().is_err());
    }
}

#[test]
fn local_reader_is_lazy_and_cannot_seek_or_read_past_the_admitted_extent() {
    use std::io::Write;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("large.pdf");
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(b"%PDF-1.7").unwrap();
    file.set_len(512 * 1024 * 1024).unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let resource = ws.resource(Path::new("large.pdf")).unwrap();
    let mut reader = resource.reader().unwrap();
    assert_eq!(reader.len(), 512 * 1024 * 1024);
    let mut head = [0; 8];
    reader.read_exact(&mut head).unwrap();
    assert_eq!(&head, b"%PDF-1.7");
    file.set_len(513 * 1024 * 1024).unwrap();
    assert_eq!(reader.seek(SeekFrom::End(0)).unwrap(), 512 * 1024 * 1024);
    assert_eq!(reader.read(&mut head).unwrap(), 0);
    assert!(reader.seek(SeekFrom::End(1)).is_err());
    assert!(reader.seek(SeekFrom::Start(u64::MAX)).is_err());
    assert!(reader.seek(SeekFrom::Current(i64::MIN)).is_err());
    reader.seek(SeekFrom::End(-2)).unwrap();
    assert_eq!(reader.read(&mut head).unwrap(), 2);
    ws.revoke();
    assert_eq!(
        reader.read(&mut head).unwrap_err().kind(),
        io::ErrorKind::PermissionDenied
    );
    assert_eq!(
        reader.seek(SeekFrom::Start(0)).unwrap_err().kind(),
        io::ErrorKind::PermissionDenied
    );
    assert!(resource.reader().is_err());
}

type ReadHook = Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>;
struct Probe {
    cursor: Cursor<Vec<u8>>,
    reads: Arc<AtomicUsize>,
    drops: Arc<AtomicUsize>,
    seeks: Arc<AtomicUsize>,
    on_read: ReadHook,
}
impl Drop for Probe {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl Read for Probe {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let n = self.cursor.read(bytes)?;
        if let Some(hook) = self.on_read.lock().unwrap().take() {
            hook();
        }
        Ok(n)
    }
}
impl Seek for Probe {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.seeks.fetch_add(1, Ordering::SeqCst);
        self.cursor.seek(from)
    }
}
struct StreamProvider {
    memory: Memory,
    reads: Arc<AtomicUsize>,
    drops: Arc<AtomicUsize>,
    seeks: Arc<AtomicUsize>,
    on_read: ReadHook,
}
impl DataPort for StreamProvider {
    fn descriptor(&self) -> Descriptor {
        self.memory.descriptor()
    }
    fn list(&self, _: &RelativePath) -> Result<Vec<Entry>> {
        Ok(vec![])
    }
}
impl DocumentStoragePort for StreamProvider {
    fn read(&self, _: &RelativePath) -> Result<TextSnapshot> {
        Err(Error::unsupported())
    }
    fn write(&self, _: &RelativePath, _: &Revision, _: &str) -> Result<WriteResult> {
        Err(Error::unsupported())
    }
}
impl ResourcePort for StreamProvider {
    fn preview(&self, _: &RelativePath) -> Result<PreviewData> {
        Ok(PreviewData::LocalFile(
            "/does-not-exist/provider-owned.bin".into(),
        ))
    }
    fn preview_reader(&self, _: &RelativePath) -> Result<ResourceReader> {
        if let Some(hook) = self.memory.hook.lock().unwrap().take() {
            hook();
        }
        let mut cursor = Cursor::new(b"dataEXCESS".to_vec());
        cursor.set_position(5);
        Ok(ResourceReader {
            length: 4,
            reader: Box::new(Probe {
                cursor,
                reads: self.reads.clone(),
                drops: self.drops.clone(),
                seeks: self.seeks.clone(),
                on_read: self.on_read.clone(),
            }),
        })
    }
    fn preview_session_reader(&self, path: &RelativePath) -> SessionReadResult<SessionReader> {
        let hook = self.on_read.clone();
        Ok(SessionReader {
            source: self.preview_reader(path)?,
            validate: Arc::new(move || {
                let hook = hook.lock().unwrap().take();
                if let Some(hook) = hook {
                    hook();
                }
                Ok(())
            }),
        })
    }
}
impl ResourceWatchPort for StreamProvider {
    fn watch(&self, _: &RelativePath, _: &Revision, _: Notify) -> Result<WatchSubscription> {
        Err(Error::unsupported())
    }
}

#[test]
fn provider_reader_is_not_buffered_closes_on_drop_and_fences_late_read_results() {
    let provider = Arc::new(StreamProvider {
        memory: Memory::new("memory://reader/root/"),
        reads: Arc::default(),
        drops: Arc::default(),
        seeks: Arc::default(),
        on_read: Arc::default(),
    });
    let ws = Workspace::from_provider(provider.clone()).unwrap();
    let resource = ws.resource(Path::new("data.bin")).unwrap();
    let mut reader = resource.reader().unwrap();
    assert_eq!(provider.reads.load(Ordering::SeqCst), 0);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"data");
    assert_eq!(provider.reads.load(Ordering::SeqCst), 1);
    drop(reader);
    assert_eq!(provider.drops.load(Ordering::SeqCst), 1);
    let mut reader = resource.reader().unwrap();
    let revoker = ws.clone();
    *provider.on_read.lock().unwrap() = Some(Box::new(move || revoker.revoke()));
    let mut late = [0xff; 4];
    assert_eq!(
        reader.read(&mut late).unwrap_err().kind(),
        io::ErrorKind::PermissionDenied
    );
    assert_eq!(
        late, [0; 4],
        "An error must not leave retired bytes in the consumer buffer"
    );
    let reads = provider.reads.load(Ordering::SeqCst);
    assert!(reader.read(&mut [0; 4]).is_err());
    assert_eq!(provider.reads.load(Ordering::SeqCst), reads);
    drop(reader);
    assert_eq!(provider.drops.load(Ordering::SeqCst), 2);
    let reopened = Workspace::from_provider(provider.clone()).unwrap();
    let preview = reopened.resource(Path::new("data.bin")).unwrap();
    let revoker = reopened.clone();
    *provider.memory.hook.lock().unwrap() = Some(Box::new(move || revoker.revoke()));
    let seeks = provider.seeks.load(Ordering::SeqCst);
    assert!(matches!(
        preview.reader(),
        Err(Error {
            kind: ErrorKind::StaleLease,
            ..
        })
    ));
    assert_eq!(provider.seeks.load(Ordering::SeqCst), seeks);
    assert_eq!(provider.drops.load(Ordering::SeqCst), 3);
}

#[test]
fn cached_snapshot_reader_preserves_its_input_version_and_checks_lease_on_seek() {
    let provider = Arc::new(crate::workspace::testing::Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), b"old snapshot".to_vec());
    let ws = Workspace::from_provider(provider.clone()).unwrap();
    let resource = ws.resource(Path::new("image.png")).unwrap();
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("image.png".into(), b"changed".to_vec());
    let mut reader = resource.reader().unwrap();
    assert_eq!(reader.len(), 12);
    reader.seek(SeekFrom::Start(4)).unwrap();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"snapshot");
    reader.seek(SeekFrom::Start(0)).unwrap();
    ws.revoke();
    assert!(reader.read(&mut [0; 1]).is_err());
    assert!(reader.seek(SeekFrom::End(0)).is_err());
}

#[test]
fn session_readers_keep_provider_roots_and_validate_identity_without_loading_the_file() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    let file = std::fs::File::create(root.join("large.db")).unwrap();
    file.set_len(8 * 1024 * 1024 * 1024).unwrap();
    let ws = Workspace::open(&root).unwrap();
    let resource = ws.resource(Path::new("large.db")).unwrap();
    std::fs::rename(&root, temp.path().join("admitted")).unwrap();
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("large.db"), b"foreign").unwrap();
    let mut session = resource.session_reader().unwrap();
    assert_eq!(session.source.length, 8 * 1024 * 1024 * 1024);
    (session.validate)().unwrap();
    let mut first = [255; 16];
    session.source.reader.read_exact(&mut first).unwrap();
    assert_eq!(first, [0; 16]);
    file.set_len(1).unwrap();
    assert!(matches!(
        (session.validate)(),
        Err(SessionReadFailure::Changed)
    ));
}

#[test]
fn session_readers_reject_atomic_replacement_even_when_length_and_mtime_match() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("snapshot.db");
    std::fs::write(&path, b"original").unwrap();
    let before = std::fs::metadata(&path).unwrap().modified().unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let session = ws
        .resource(Path::new("snapshot.db"))
        .unwrap()
        .session_reader()
        .unwrap();
    let replacement = temp.path().join("replacement");
    std::fs::write(&replacement, b"replaced").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&replacement)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(before))
        .unwrap();
    std::fs::rename(replacement, &path).unwrap();
    assert!(matches!(
        (session.validate)(),
        Err(SessionReadFailure::Changed)
    ));
}

#[cfg(unix)]
#[test]
fn session_readers_refuse_links_and_recheck_new_or_dangling_recovery_sidecars() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("snapshot.db");
    std::fs::write(&path, b"original").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let resource = ws.resource(Path::new("snapshot.db")).unwrap();
    for suffix in ["-journal", "-wal", "-shm"] {
        let session = resource.session_reader().unwrap();
        let sidecar = temp.path().join(format!("snapshot.db{suffix}"));
        std::os::unix::fs::symlink("missing", &sidecar).unwrap();
        assert!(matches!(
            (session.validate)(),
            Err(SessionReadFailure::Recovery)
        ));
        assert!(matches!(
            resource.session_reader(),
            Err(SessionReadFailure::Recovery)
        ));
        std::fs::remove_file(sidecar).unwrap();
    }
    std::fs::rename(&path, temp.path().join("original.db")).unwrap();
    std::os::unix::fs::symlink("original.db", &path).unwrap();
    assert!(resource.session_reader().is_err());
}

#[test]
fn hosted_session_readers_keep_the_admitted_snapshot_and_revoke_cached_authority() {
    let provider = Arc::new(crate::workspace::testing::Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("snapshot.db".into(), b"original".to_vec());
    let ws = Workspace::from_provider(provider.clone()).unwrap();
    let resource = ws.resource(Path::new("snapshot.db")).unwrap();
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("snapshot.db".into(), b"replaced".to_vec());
    let mut session = resource.session_reader().unwrap();
    let mut bytes = Vec::new();
    session.source.reader.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"original");
    (session.validate)().unwrap();
    ws.revoke();
    assert!(matches!(
        (session.validate)(),
        Err(SessionReadFailure::Resource(Error {
            kind: ErrorKind::StaleLease,
            ..
        }))
    ));
    assert!(session.source.reader.seek(SeekFrom::Start(0)).is_err());
    assert!(resource.session_reader().is_err());
}

#[test]
fn removing_a_session_source_expires_it_even_when_its_descriptor_remains_readable() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("snapshot.db");
    std::fs::write(&path, b"original").unwrap();
    let ws = Workspace::open(temp.path()).unwrap();
    let resource = ws.resource(Path::new("snapshot.db")).unwrap();
    let session = resource.session_reader().unwrap();
    std::fs::remove_file(path).unwrap();
    assert!(matches!(
        (session.validate)(),
        Err(SessionReadFailure::Changed)
    ));
}

#[test]
fn session_validation_rechecks_the_lease_after_the_provider_returns() {
    for pending in [true, false] {
        let provider = Arc::new(StreamProvider {
            memory: Memory::new("memory://session-validation/root/"),
            reads: Arc::default(),
            drops: Arc::default(),
            seeks: Arc::default(),
            on_read: Arc::default(),
        });
        let ws = Workspace::from_provider(provider.clone()).unwrap();
        let resource = ws.resource(Path::new("data.db")).unwrap();
        let ready = (!pending).then(|| resource.session_reader().unwrap());
        let revoker = ws.clone();
        *provider.on_read.lock().unwrap() = Some(Box::new(move || revoker.revoke()));
        let error = if let Some(session) = ready {
            (session.validate)().unwrap_err()
        } else {
            match resource.session_reader() {
                Err(error) => error,
                Ok(_) => panic!("revoked session was admitted"),
            }
        };
        assert!(matches!(
            error,
            SessionReadFailure::Resource(Error {
                kind: ErrorKind::StaleLease,
                ..
            })
        ));
        assert_eq!(provider.drops.load(Ordering::Acquire), 1);
        assert_eq!(provider.reads.load(Ordering::Acquire), 0);
    }
}
