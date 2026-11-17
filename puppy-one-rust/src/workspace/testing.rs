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
    pub markdown_dialect: Option<crate::formats::markdown::MarkdownDialect>,
    pub text: Mutex<String>,
    pub calls: AtomicUsize,
    pub hook: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    /// The next writes that fail (storage unavailable).
    pub failing_writes: AtomicUsize,
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
            markdown_dialect: None,
            text: Mutex::new("original".into()),
            calls: AtomicUsize::new(0),
            hook: Mutex::new(None),
            failing_writes: AtomicUsize::new(0),
        }
    }
    fn snapshot(&self) -> TextSnapshot {
        let text = self.text.lock().unwrap().clone();
        TextSnapshot {
            encoding: Default::default(),
            line_ending: Default::default(),
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
    fn markdown_dialect(&self) -> Option<crate::formats::markdown::MarkdownDialect> {
        self.markdown_dialect
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
        if self
            .failing_writes
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
        {
            return Err(Error::new(ErrorKind::Io, "Storage unavailable"));
        }
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
    fn stat_entry(&self, path: &RelativePath) -> Result<EntryStat> {
        self.called();
        if path.as_path() == std::path::Path::new("note.md") {
            let size = self.text.lock().unwrap().len() as u64;
            return Ok(EntryStat {
                size,
                is_file: true,
                readonly: !self.descriptor.capabilities.write,
            });
        }
        Ok(EntryStat {
            size: 3,
            is_file: true,
            readonly: !self.descriptor.capabilities.write,
        })
    }
    fn read_head(&self, path: &RelativePath, max_bytes: usize) -> Result<Vec<u8>> {
        self.called();
        if path.as_path() == std::path::Path::new("note.md") {
            let text = self.text.lock().unwrap();
            let len = text.len().min(max_bytes);
            return Ok(text.as_bytes()[..len].to_vec());
        }
        let sample = [1u8, 2, 3];
        Ok(sample[..sample.len().min(max_bytes)].to_vec())
    }
}
impl ResourceWatchPort for Memory {
    fn watch(&self, _: &RelativePath, _: &Revision, _: Notify) -> Result<WatchSubscription> {
        Err(Error::unsupported())
    }
}

/// A provider with immutable binary snapshots and controllable notifications.
/// Consumers can prove that preview refreshes do not go through text storage.
type ResourceSink = (std::sync::Weak<Mutex<Option<WatchEvent>>>, Notify);
pub struct Resources {
    pub memory: Memory,
    pub bytes: Mutex<std::collections::HashMap<String, Vec<u8>>>,
    pub reads: Mutex<Vec<String>>,
    pub failures: Mutex<std::collections::HashMap<String, Error>>,
    pub after_read: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    sinks: Mutex<Vec<ResourceSink>>,
}
impl Default for Resources {
    fn default() -> Self {
        let mut memory = Memory::new("memory://preview-tests/project/");
        memory.descriptor.capabilities.watch = true;
        Self {
            memory,
            bytes: Default::default(),
            reads: Default::default(),
            failures: Default::default(),
            after_read: Default::default(),
            sinks: Default::default(),
        }
    }
}
impl Resources {
    pub fn publish(&self, event: WatchEvent) {
        self.sinks.lock().unwrap().retain(|(slot, notify)| {
            if let Some(slot) = slot.upgrade() {
                let mut pending = slot.lock().unwrap();
                *pending = Some(
                    pending
                        .take()
                        .map_or_else(|| event.clone(), |old| old.coalesce(event.clone())),
                );
                drop(pending);
                notify();
                true
            } else {
                false
            }
        });
    }
    pub fn subscribers(&self) -> usize {
        self.sinks
            .lock()
            .unwrap()
            .iter()
            .filter(|(slot, _)| slot.strong_count() > 0)
            .count()
    }
}
impl DataPort for Resources {
    fn descriptor(&self) -> Descriptor {
        self.memory.descriptor.clone()
    }
    fn list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
        self.memory.list(path)
    }
}
impl DocumentStoragePort for Resources {
    fn read(&self, _: &RelativePath) -> Result<TextSnapshot> {
        panic!("binary previews must not request text")
    }
    fn write(&self, _: &RelativePath, _: &Revision, _: &str) -> Result<WriteResult> {
        panic!("binary preview refresh must not write")
    }
}
impl ResourcePort for Resources {
    fn preview(&self, path: &RelativePath) -> Result<PreviewData> {
        let name = path.as_path().to_str().unwrap().to_owned();
        self.reads.lock().unwrap().push(name.clone());
        let snapshot = if let Some(error) = self.failures.lock().unwrap().get(&name) {
            Err(error.clone())
        } else {
            self.bytes
                .lock()
                .unwrap()
                .get(&name)
                .cloned()
                .ok_or_else(|| Error::new(ErrorKind::NotFound, "Preview removed"))
        };
        let hook = self.after_read.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
        Ok(PreviewData::Bytes {
            mime: "application/octet-stream".into(),
            bytes: snapshot?.into(),
        })
    }
}
impl ResourceWatchPort for Resources {
    fn watch_root(&self, notify: Notify) -> Result<WatchSubscription> {
        let events = Arc::new(Mutex::new(Some(WatchEvent::Invalidated)));
        self.sinks
            .lock()
            .unwrap()
            .push((Arc::downgrade(&events), notify.clone()));
        notify();
        Ok(WatchSubscription {
            events,
            cancel: WatchCancellation::new(|| {}),
        })
    }
    fn watch(&self, _: &RelativePath, _: &Revision, _: Notify) -> Result<WatchSubscription> {
        panic!("binary previews have no text revision")
    }
}

/// Scriptable text storage for tests crossing the actual provider, document
/// coordinator and viewer boundaries. Reads capture immutable snapshots before
/// an optional blocking hook; notifications are scoped exactly like real watches.
pub struct Texts {
    pub descriptor: Descriptor,
    pub files: Mutex<std::collections::BTreeMap<String, TextSnapshot>>,
    pub reads: Mutex<Vec<String>>,
    pub writes: Mutex<Vec<(String, Revision, String)>>,
    pub failures: Mutex<std::collections::BTreeMap<String, Error>>,
    pub after_read: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    watches: Resources,
}

impl Texts {
    pub fn new(root: std::path::PathBuf) -> Self {
        let mut descriptor = Memory::new("memory://text-matrix/project/").descriptor;
        descriptor.local_root = Some(root);
        descriptor.capabilities.watch = true;
        Self {
            descriptor,
            files: Default::default(),
            reads: Default::default(),
            writes: Default::default(),
            failures: Default::default(),
            after_read: Default::default(),
            watches: Resources::default(),
        }
    }

    pub fn put(&self, path: &str, text: &str, version: &str) {
        self.files.lock().unwrap().insert(
            path.into(),
            TextSnapshot {
                text: text.into(),
                revision: Revision(version.into()),
                encoding: Default::default(),
                line_ending: Default::default(),
            },
        );
    }

    pub fn publish(&self, event: WatchEvent) {
        self.watches.publish(event);
    }

    fn snapshot(&self, path: &RelativePath) -> Result<TextSnapshot> {
        let key = path.as_path().to_string_lossy();
        self.files
            .lock()
            .unwrap()
            .get(key.as_ref())
            .cloned()
            .ok_or_else(|| Error::new(ErrorKind::NotFound, "Text fixture removed"))
    }
}

impl DataPort for Texts {
    fn descriptor(&self) -> Descriptor {
        self.descriptor.clone()
    }
    fn list(&self, _: &RelativePath) -> Result<Vec<Entry>> {
        Ok(Vec::new())
    }
}

impl DocumentStoragePort for Texts {
    fn read(&self, path: &RelativePath) -> Result<TextSnapshot> {
        let key = path.as_path().to_string_lossy().into_owned();
        self.reads.lock().unwrap().push(key.clone());
        let result = self
            .failures
            .lock()
            .unwrap()
            .get(&key)
            .cloned()
            .map_or_else(|| self.snapshot(path), Err);
        let hook = self.after_read.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
        result
    }
    fn write(&self, path: &RelativePath, base: &Revision, text: &str) -> Result<WriteResult> {
        let key = path.as_path().to_string_lossy().into_owned();
        self.writes
            .lock()
            .unwrap()
            .push((key.clone(), base.clone(), text.into()));
        let mut files = self.files.lock().unwrap();
        let current = files
            .get_mut(&key)
            .ok_or_else(|| Error::new(ErrorKind::NotFound, "Text fixture removed"))?;
        if &current.revision != base {
            return Ok(WriteResult::Conflict(current.clone()));
        }
        current.text = text.into();
        current.revision = Revision(format!("saved-{}", blake3::hash(text.as_bytes())));
        Ok(WriteResult::Saved(current.clone()))
    }
}

impl ResourcePort for Texts {
    fn preview(&self, path: &RelativePath) -> Result<PreviewData> {
        Ok(PreviewData::Bytes {
            mime: "text/plain".into(),
            bytes: self.snapshot(path)?.text.into_bytes().into(),
        })
    }
    fn stat_entry(&self, path: &RelativePath) -> Result<EntryStat> {
        Ok(EntryStat {
            size: self.snapshot(path)?.text.len() as u64,
            is_file: true,
            readonly: false,
        })
    }
    fn read_head(&self, path: &RelativePath, max_bytes: usize) -> Result<Vec<u8>> {
        Ok(self
            .snapshot(path)?
            .text
            .as_bytes()
            .iter()
            .take(max_bytes)
            .copied()
            .collect())
    }
}

impl ResourceWatchPort for Texts {
    fn watch(&self, _: &RelativePath, _: &Revision, notify: Notify) -> Result<WatchSubscription> {
        let subscription = self.watches.watch_root(notify)?;
        // Unlike a binary root subscription, a newly read text document already
        // has a baseline. Only explicit subsequent notifications invalidate it.
        subscription.next();
        Ok(subscription)
    }
}
