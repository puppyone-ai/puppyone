//! Narrow worker ports. Implementations do not own document models/save queues.
use super::contracts::*;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
};

pub trait DataPort: Send + Sync {
    fn descriptor(&self) -> Descriptor;
    fn list(&self, path: &RelativePath) -> Result<Vec<Entry>>;
    fn create(
        &self,
        _parent: &RelativePath,
        _name: &str,
        _folder: bool,
        _text: &str,
    ) -> Result<RelativePath> {
        Err(Error::unsupported())
    }
    fn rename(&self, _path: &RelativePath, _name: &str) -> Result<RelativePath> {
        Err(Error::unsupported())
    }
    fn remove(&self, _path: &RelativePath) -> Result<()> {
        Err(Error::unsupported())
    }
    fn move_entry(&self, _from: &RelativePath, _folder: &RelativePath) -> Result<RelativePath> {
        Err(Error::unsupported())
    }
    fn copy(&self, _from: &RelativePath, _folder: &RelativePath) -> Result<RelativePath> {
        Err(Error::unsupported())
    }
    /// Source is an explicit native user selection, not a resource URI.
    fn import(&self, _source: &Path, _folder: &RelativePath) -> Result<RelativePath> {
        Err(Error::unsupported())
    }
}
pub trait DocumentStoragePort: Send + Sync {
    fn read(&self, path: &RelativePath) -> Result<TextSnapshot>;
    fn write(&self, path: &RelativePath, base: &Revision, text: &str) -> Result<WriteResult>;
}
pub trait ResourcePort: Send + Sync {
    fn preview(&self, path: &RelativePath) -> Result<PreviewData>;
    fn platform_path(&self, _path: &RelativePath) -> Result<PathBuf> {
        Err(Error::unsupported())
    }
}
/// Reset/revalidate semantics: coalescing never discards a specific path mutation.
#[derive(Clone, Debug)]
pub enum WatchEvent {
    Invalidated,
    Failed(Error),
}
pub type Notify = Arc<dyn Fn() + Send + Sync>;
pub struct WatchSubscription {
    pub(crate) events: Arc<Mutex<Option<WatchEvent>>>,
    pub(crate) cancel: Arc<mpsc::Sender<()>>,
}
impl WatchSubscription {
    pub fn next(&self) -> Option<WatchEvent> {
        self.events.lock().ok()?.take()
    }
}
impl Drop for WatchSubscription {
    fn drop(&mut self) {
        let _ = self.cancel.send(());
    }
}
pub trait ResourceWatchPort: Send + Sync {
    /// Dropping the subscription must stop observation and release its resources.
    fn watch(
        &self,
        path: &RelativePath,
        baseline: &Revision,
        notify: Notify,
    ) -> Result<WatchSubscription>;
}
pub trait Provider: DataPort + DocumentStoragePort + ResourcePort + ResourceWatchPort {}
impl<T: DataPort + DocumentStoragePort + ResourcePort + ResourceWatchPort> Provider for T {}
