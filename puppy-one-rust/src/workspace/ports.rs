//! Narrow worker ports. Implementations do not own document models/save queues.
use super::contracts::*;
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

pub trait DataPort: Send + Sync {
    fn descriptor(&self) -> Descriptor;
    /// Metadata captured by the provider during admission; no filesystem I/O
    /// is performed when a foreground viewer selects its composition.
    fn markdown_dialect(&self) -> Option<crate::formats::markdown::MarkdownDialect> {
        None
    }
    /// The hosted Agent target of a Cloud workspace (its Project, running
    /// workbench and account binding); local folders have none.
    fn agent_target(&self) -> Option<super::cloud::agent::AgentTarget> {
        None
    }
    /// The Cloud Computer sandbox and screen-stream target; local folders have none.
    fn sandbox_target(&self) -> Option<super::cloud::sandbox::SandboxTarget> {
        None
    }
    /// Local admission is checked by the facade. Remote authority additionally
    /// expires on account, service, permission or runtime-generation changes.
    fn check_authority(&self) -> Result<()> {
        Ok(())
    }
    /// Retire this admitted adapter's work. Revocable adapters are constructed
    /// per admission, never shared between independently opened handles.
    fn revoke(&self) {}
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
    /// A document's Markdown media request has a narrower purpose than a
    /// general preview. Scoped providers may enforce that purpose separately.
    fn markdown_asset_bytes(&self, path: &RelativePath, max: u64) -> Result<Vec<u8>> {
        match self.preview(path)? {
            PreviewData::Bytes { bytes, .. } if bytes.len() as u64 <= max => Ok(bytes.to_vec()),
            PreviewData::Bytes { .. } => Err(Error::new(
                ErrorKind::InvalidInput,
                "Media exceeds its byte limit",
            )),
            PreviewData::LocalFile(_) => self.preview_bytes(path, max),
        }
    }
    /// Deferred local bytes are opened by the admitted provider, never by
    /// treating the display/platform path in PreviewData as read authority.
    fn preview_bytes(&self, _path: &RelativePath, _max: u64) -> Result<Vec<u8>> {
        Err(Error::unsupported())
    }
    /// Open one regular resource through the provider's retained authority.
    /// The facade fences each read/seek by its lease and this admitted length.
    fn preview_reader(&self, _path: &RelativePath) -> Result<ResourceReader> {
        Err(Error::unsupported())
    }
    /// Lazy resource sessions also need a stable file identity and a check
    /// for recovery sidecars. A plain path/reader cannot confer this authority.
    fn preview_session_reader(&self, _path: &RelativePath) -> SessionReadResult<SessionReader> {
        Err(SessionReadFailure::Resource(Error::unsupported()))
    }
    fn platform_path(&self, _path: &RelativePath) -> Result<PathBuf> {
        Err(Error::unsupported())
    }
}
pub trait ReadSeek: std::io::Read + std::io::Seek + Send {}
impl<T: std::io::Read + std::io::Seek + Send> ReadSeek for T {}
pub struct ResourceReader {
    pub length: u64,
    pub reader: Box<dyn ReadSeek>,
}
#[derive(Clone, Debug)]
pub enum SessionReadFailure {
    Resource(Error),
    Changed,
    Recovery,
}
impl From<Error> for SessionReadFailure {
    fn from(error: Error) -> Self {
        Self::Resource(error)
    }
}
pub type SessionReadResult<T> = std::result::Result<T, SessionReadFailure>;
pub struct SessionReader {
    pub source: ResourceReader,
    /// Called before and after each query, even if the engine uses cached
    /// pages. Validating must not fetch the whole resource.
    pub validate: std::sync::Arc<dyn Fn() -> SessionReadResult<()> + Send + Sync>,
}
/// Reset/revalidate semantics: coalescing never discards a specific path mutation.
#[derive(Clone, Debug)]
pub enum WatchEvent {
    Invalidated,
    /// Validated relative paths; an unknown/overflowed scope is Invalidated.
    Changed(Vec<RelativePath>),
    Failed(Error),
}
impl WatchEvent {
    pub(crate) fn coalesce(self, next: Self) -> Self {
        match (self, next) {
            (_, Self::Failed(error)) => Self::Failed(error),
            (Self::Invalidated, Self::Changed(_)) | (_, Self::Invalidated) => Self::Invalidated,
            (Self::Changed(mut paths), Self::Changed(more)) => {
                for path in more {
                    if !paths.contains(&path) {
                        paths.push(path);
                    }
                    if paths.len() > 256 {
                        return Self::Invalidated;
                    }
                }
                Self::Changed(paths)
            }
            (_, next) => next,
        }
    }
}
pub type Notify = Arc<dyn Fn() + Send + Sync>;
pub struct WatchCancellation {
    cancelled: AtomicBool,
    cancel: Box<dyn Fn() + Send + Sync>,
}
impl WatchCancellation {
    pub fn new(cancel: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            cancelled: AtomicBool::new(false),
            cancel: Box::new(cancel),
        })
    }
    pub fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::AcqRel) {
            (self.cancel)();
        }
    }
}
pub struct WatchSubscription {
    pub(crate) events: Arc<Mutex<Option<WatchEvent>>>,
    pub(crate) cancel: Arc<WatchCancellation>,
}
impl WatchSubscription {
    pub fn next(&self) -> Option<WatchEvent> {
        self.events.lock().ok()?.take()
    }
}
impl Drop for WatchSubscription {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
pub trait ResourceWatchPort: Send + Sync {
    fn watch_root(&self, _notify: Notify) -> Result<WatchSubscription> {
        Err(Error::unsupported())
    }
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
