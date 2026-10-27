//! In-memory provider used to prove that consumers do not require a local root.
use super::{contracts::*, ports::*};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

pub fn preview(name: &str) -> super::PreviewResource {
    super::Workspace::from_provider(Arc::new(Memory::new("memory://fixtures/project/")))
        .unwrap()
        .resource(std::path::Path::new(name))
        .unwrap()
}

pub struct Memory {
    pub descriptor: Descriptor,
    pub text: Mutex<String>,
    pub calls: AtomicUsize,
    pub hook: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}
impl Memory {
    pub fn new(namespace: &str) -> Self {
        Self {
            descriptor: Descriptor {
                limits: Limits::LOCAL,
                storage: StorageId::new(namespace).unwrap(),
                name: "Memory".into(),
                local_root: None,
                capabilities: Capabilities {
                    read: true,
                    write: true,
                    preview: true,
                    ..Default::default()
                },
            },
            text: Mutex::new("original".into()),
            calls: AtomicUsize::new(0),
            hook: Mutex::new(None),
        }
    }
    fn snapshot(&self) -> TextSnapshot {
        let text = self.text.lock().unwrap().clone();
        TextSnapshot {
            revision: Revision(blake3::hash(text.as_bytes()).to_string()),
            text,
        }
    }
    fn called(&self) {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(hook) = self.hook.lock().unwrap().take() {
            hook();
        }
    }
}
impl DataPort for Memory {
    fn descriptor(&self) -> Descriptor {
        self.descriptor.clone()
    }
    fn list(&self, _: &RelativePath) -> Result<Vec<Entry>> {
        self.called();
        Ok(vec![Entry {
            path: RelativePath::new("note.md".as_ref())?,
            name: "note.md".into(),
            folder: false,
        }])
    }
}
impl DocumentStoragePort for Memory {
    fn read(&self, path: &RelativePath) -> Result<TextSnapshot> {
        self.called();
        if path.as_path() != std::path::Path::new("note.md") {
            return Err(Error::new(ErrorKind::NotFound, "Not found"));
        }
        Ok(self.snapshot())
    }
    fn write(&self, _: &RelativePath, baseline: &Revision, text: &str) -> Result<WriteResult> {
        self.called();
        let latest = self.snapshot();
        if &latest.revision != baseline {
            return Ok(WriteResult::Conflict(latest));
        }
        *self.text.lock().unwrap() = text.into();
        Ok(WriteResult::Saved(self.snapshot()))
    }
}
impl ResourcePort for Memory {
    fn preview(&self, _: &RelativePath) -> Result<PreviewData> {
        self.called();
        Ok(PreviewData::Bytes {
            mime: "image/png".into(),
            bytes: Arc::from([1, 2, 3]),
        })
    }
}
impl ResourceWatchPort for Memory {
    fn watch(&self, _: &RelativePath, _: &Revision, _: Notify) -> Result<WatchSubscription> {
        Err(Error::unsupported())
    }
}
