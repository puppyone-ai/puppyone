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
