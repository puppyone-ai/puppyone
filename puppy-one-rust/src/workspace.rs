//! Admitted workspace handle: stable resource identity, revocable provider lease
//! and capability enforcement. Only `local` knows the capability filesystem.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "Live Cloud adapter is protocol-tested; navigation awaits conflict policy and execution isolation"
    )
)]
pub mod cloud;
pub mod contracts;
mod local;
#[cfg(test)]
#[path = "workspace/local_tests.rs"]
mod local_compatibility_tests;
pub mod ports;
#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;

use crate::model::Node;
use contracts::{Descriptor, RelativePath, Revision, TextSnapshot, WriteResult};
pub use contracts::{Error, ErrorKind, PreviewData, ResourceId, Result};
use ports::{Notify, Provider, WatchCancellation, WatchEvent, WatchSubscription};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
};
use uuid::Uuid;
pub const MAX_TEXT_BYTES: usize = contracts::Limits::LOCAL.text_bytes;

#[derive(Clone)]
struct Lease {
    id: Uuid,
    live: Arc<AtomicBool>,
    watches: Arc<Mutex<Vec<Weak<WatchCancellation>>>>,
    provider: Arc<dyn Provider>,
}
impl std::fmt::Debug for Lease {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Lease")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}
impl Lease {
    fn check(&self) -> Result<()> {
        if self.live.load(Ordering::Acquire) {
            self.provider.check_authority()
        } else {
            Err(Error::new(
                ErrorKind::StaleLease,
                "Workspace access has expired; reopen it",
            ))
        }
    }
}
pub struct Workspace {
    descriptor: Descriptor,
    provider: Arc<dyn Provider>,
    lease: Lease,
}
#[derive(Clone, Debug)]
pub struct Document {
    /// Editing-instance ID; not the stable resource identity.
    pub id: String,
    pub relative: PathBuf,
    pub text: String,
    pub identity: ResourceId,
    revision: Revision,
    lease: Uuid,
}
#[derive(Debug)]
pub struct WriteOutcome {
    pub document: Document,
    pub updated: bool,
}
#[derive(Clone, Debug)]
pub struct PreviewResource {
    pub identity: ResourceId,
    data: PreviewData,
    lease: Lease,
}
impl PreviewResource {
    pub fn data(&self) -> Result<&PreviewData> {
        self.lease.check()?;
        Ok(&self.data)
    }
}
impl PartialEq for PreviewResource {
    fn eq(&self, other: &Self) -> bool {
        self.identity == other.identity
            && self.lease.id == other.lease.id
            && self.data == other.data
    }
}
pub struct Subscription {
    inner: WatchSubscription,
    lease: Lease,
}
impl Subscription {
    pub fn next(&self) -> Option<WatchEvent> {
        if let Err(error) = self.lease.check() {
            return Some(WatchEvent::Failed(error));
        }
        self.inner.next()
    }
}
impl Workspace {
    pub fn open(path: &Path) -> Result<Arc<Self>> {
        Self::from_provider(local::open(path)?)
    }
    pub fn from_provider(provider: Arc<dyn Provider>) -> Result<Arc<Self>> {
        provider.check_authority()?;
        let descriptor = provider.descriptor();
        if descriptor.limits.text_bytes == 0
            || descriptor.limits.text_bytes > contracts::Limits::MAX_TEXT_BYTES
            || descriptor.limits.directory_entries == 0
            || descriptor.limits.directory_entries > contracts::Limits::CLOUD.directory_entries
        {
            return Err(Error::from("Invalid provider limits"));
        }
        if descriptor.capabilities.local_actions && descriptor.local_root.is_none() {
            return Err(Error::from(
                "Native actions require a native workspace root",
            ));
        }
        Ok(Arc::new(Self {
            descriptor,
            provider: provider.clone(),
            lease: Lease {
                provider,
                id: Uuid::new_v4(),
                live: Arc::new(AtomicBool::new(true)),
                watches: Arc::default(),
            },
        }))
    }
    pub fn local_root(&self) -> Option<&Path> {
        self.descriptor.local_root.as_deref()
    }
    pub fn text_limit(&self) -> usize {
        self.descriptor.limits.text_bytes
    }
    pub fn name(&self) -> &str {
        &self.descriptor.name
    }
    pub fn capabilities(&self) -> contracts::Capabilities {
        self.descriptor.capabilities
    }
    pub fn revoke(&self) {
        self.lease.live.store(false, Ordering::Release);
        self.provider.revoke();
        if let Ok(mut watches) = self.lease.watches.lock() {
            for cancel in watches.drain(..).filter_map(|weak| weak.upgrade()) {
                cancel.cancel();
            }
        }
    }
    pub fn resource_id(&self, path: &Path) -> Result<ResourceId> {
        Ok(ResourceId {
            storage: self.descriptor.storage.clone(),
            path: RelativePath::new(path)?,
        })
    }
    fn admit(&self, capability: bool) -> Result<()> {
        self.lease.check()?;
        if capability {
            Ok(())
        } else {
            Err(Error::unsupported())
        }
    }
    fn finish<T>(&self, result: Result<T>) -> Result<T> {
        self.lease.check()?;
        result
    }
    fn mutated<T>(&self, result: Result<T>) -> Result<T> {
        if self.lease.check().is_err() {
            return Err(Error::new(
                ErrorKind::OutcomeUnknown,
                "Workspace changed after dispatch; do not automatically repeat the operation",
            ));
        }
        result
    }
    fn check_identity(&self, id: &ResourceId) -> Result<()> {
        self.lease.check()?;
        if id.storage != self.descriptor.storage {
            return Err(self.foreign());
        }
        Ok(())
    }
    fn foreign(&self) -> Error {
        Error::new(
            ErrorKind::ForeignResource,
            crate::localization::t("native.workspace.foreignDocument"),
        )
    }
    fn check_document(&self, doc: &Document) -> Result<()> {
        self.check_identity(&doc.identity)?;
        if doc.lease != self.lease.id || self.resource_id(&doc.relative)? != doc.identity {
            return Err(self.foreign());
        }
        Ok(())
    }
    fn document(&self, identity: ResourceId, value: TextSnapshot, id: String) -> Result<Document> {
        if value.text.len() > self.text_limit()
            || value.text.contains(['\0', '\r'])
            || value.revision.0.is_empty()
        {
            return Err(Error::from("Invalid provider text snapshot"));
        }
        Ok(Document {
            id,
            relative: identity.path.as_path().to_owned(),
            text: value.text,
            identity,
            revision: value.revision,
            lease: self.lease.id,
        })
    }
    pub fn read_resource(&self, identity: &ResourceId) -> Result<Document> {
        self.check_identity(identity)?;
        self.admit(self.capabilities().read)?;
        if identity.path.is_root() {
            return Err(Error::from("A file resource is required"));
        }
        let value = self.finish(self.provider.read(&identity.path))?;
        self.document(identity.clone(), value, Uuid::new_v4().to_string())
    }
    pub fn read(&self, path: &Path) -> Result<Document> {
        self.read_resource(&self.resource_id(path)?)
    }
    pub fn observe(&self, document: &Document) -> Result<Document> {
        self.check_document(document)?;
        let mut current = self.read_resource(&document.identity)?;
        current.id = document.id.clone();
        Ok(current)
    }
    /// A Working Copy kept from an earlier lease of the same storage (the
    /// same account's Project root, reopened): read it afresh under this
    /// lease. The caller reconciles the text; nothing is written or replayed.
    pub fn adopt(&self, previous: &Document) -> Result<Document> {
        self.check_identity(&previous.identity)?;
        let mut current = self.read_resource(&previous.identity)?;
        current.id = previous.id.clone();
        Ok(current)
    }
    /// Verify the moved address before changing a retained Working Copy's
    /// binding. A lost receipt may be reconciled, never blindly replayed.
    pub fn rebind(&self, document: &Document, path: &Path) -> Result<Document> {
        self.check_document(document)?;
        let mut next = self.read(path)?;
        if next.text != document.text {
            return Err(Error::new(
                ErrorKind::OutcomeUnknown,
                "The moved file differs from the saved document; reconcile it before continuing",
            ));
        }
        next.id = document.id.clone();
        Ok(next)
    }
    pub fn entry_exists(&self, path: &Path) -> Result<bool> {
        Self::entry_path(path)?;
        Ok(self
            .list(path.parent().unwrap_or(Path::new("")))?
            .iter()
            .any(|entry| entry.path == path))
    }
    pub fn save(&self, document: &Document, text: &str) -> Result<WriteOutcome> {
        self.check_document(document)?;
        self.admit(self.capabilities().write)?;
        if text.len() > self.text_limit() || text.contains(['\0', '\r']) {
            return Err(Error::from(crate::localization::t(
                "native.workspace.invalidText",
            )));
        }
        let result = self.mutated(self.provider.write(
            &document.identity.path,
            &document.revision,
            text,
        ))?;
        let (value, updated) = match result {
            WriteResult::Saved(v) => (v, false),
            WriteResult::Conflict(v) => (v, true),
        };
        Ok(WriteOutcome {
            document: self.document(document.identity.clone(), value, document.id.clone())?,
            updated,
        })
    }
    pub fn list(&self, path: &Path) -> Result<Vec<Node>> {
        self.admit(self.capabilities().read)?;
        let relative = RelativePath::new(path)?;
        let rows = self.finish(self.provider.list(&relative))?;
        if rows.len() > self.descriptor.limits.directory_entries {
            return Err(Error::from(
                if self.descriptor.limits.directory_entries
                    == contracts::Limits::LOCAL.directory_entries
                {
                    crate::localization::t("native.workspace.folderLimit").to_owned()
                } else {
                    format!(
                        "Directory exceeds the {}-entry provider limit",
                        self.descriptor.limits.directory_entries
                    )
                },
            ));
        }
        let mut seen = std::collections::HashSet::new();
        rows.into_iter()
            .map(|row| {
                if row.path.is_root()
                    || row.path.as_path().parent() != Some(relative.as_path())
                    || !seen.insert(row.path.clone())
                {
                    return Err(Error::from("Invalid provider directory entry"));
                }
                Ok(Node {
                    name: row.name,
                    path: row.path.as_path().to_owned(),
                    folder: row.folder,
                    ..Default::default()
                })
            })
            .collect()
    }
    pub fn create_entry(
        &self,
        parent: &Path,
        name: &str,
        folder: bool,
        text: &str,
    ) -> Result<PathBuf> {
        self.admit(self.capabilities().create)?;
        Self::entry_name(name)?;
        if text.len() > self.text_limit() {
            return Err(Error::from("Template exceeds the editor limit"));
        }
        self.mutated(
            self.provider
                .create(&RelativePath::new(parent)?, name, folder, text),
        )
        .map(|p| p.as_path().to_owned())
    }
    fn entry_path(path: &Path) -> Result<RelativePath> {
        let path = RelativePath::new(path)?;
        if path.is_root() {
            return Err(Error::from(
                "A workspace root cannot be mutated as an entry",
            ));
        }
        Ok(path)
    }
    fn entry_name(name: &str) -> Result<()> {
        if name.trim() != name || name.contains(['/', '\\', '\0']) {
            return Err(Error::from("A single filename is required"));
        }
        Self::entry_path(Path::new(name))?;
        Ok(())
    }
    pub fn rename_entry(&self, path: &Path, name: &str) -> Result<PathBuf> {
        self.admit(self.capabilities().rename)?;
        Self::entry_name(name)?;
        self.mutated(self.provider.rename(&Self::entry_path(path)?, name))
            .map(|p| p.as_path().to_owned())
    }
    pub fn remove_entry(&self, path: &Path) -> Result<()> {
        self.admit(self.capabilities().remove)?;
        self.mutated(self.provider.remove(&Self::entry_path(path)?))
    }
    pub fn move_entry(&self, from: &Path, folder: &Path) -> Result<PathBuf> {
        self.admit(self.capabilities().move_entry)?;
        self.mutated(
            self.provider
                .move_entry(&Self::entry_path(from)?, &RelativePath::new(folder)?),
        )
        .map(|p| p.as_path().to_owned())
    }
    pub fn copy_entry(&self, from: &Path, folder: &Path) -> Result<PathBuf> {
        self.admit(self.capabilities().copy)?;
        self.mutated(
            self.provider
                .copy(&Self::entry_path(from)?, &RelativePath::new(folder)?),
        )
        .map(|p| p.as_path().to_owned())
    }
    pub fn import_external(&self, source: &Path, folder: &Path) -> Result<PathBuf> {
        self.admit(self.capabilities().import)?;
        self.mutated(self.provider.import(source, &RelativePath::new(folder)?))
            .map(|p| p.as_path().to_owned())
    }
    pub fn resource(&self, relative: &Path) -> Result<PreviewResource> {
        self.admit(self.capabilities().preview)?;
        let identity = self.resource_id(relative)?;
        if identity.path.is_root() {
            return Err(Error::from("A preview file is required"));
        }
        let data = self.finish(self.provider.preview(&identity.path))?;
        Ok(PreviewResource {
            identity,
            data,
            lease: self.lease.clone(),
        })
    }
    pub fn absolute(&self, relative: &Path) -> Result<PathBuf> {
        self.admit(self.capabilities().local_actions)?;
        self.finish(self.provider.platform_path(&RelativePath::new(relative)?))
    }
    pub fn watch(&self, document: &Document, notify: Notify) -> Result<Subscription> {
        self.check_document(document)?;
        self.admit(self.capabilities().watch)?;
        let inner = self.finish(self.provider.watch(
            &document.identity.path,
            &document.revision,
            notify,
        ))?;
        self.register_watch(inner)
    }
    pub fn watch_root(&self, notify: Notify) -> Result<Subscription> {
        self.admit(self.capabilities().watch)?;
        self.register_watch(self.finish(self.provider.watch_root(notify))?)
    }
    fn register_watch(&self, inner: WatchSubscription) -> Result<Subscription> {
        {
            let mut watches = self
                .lease
                .watches
                .lock()
                .map_err(|_| Error::new(ErrorKind::Io, "Watch registration unavailable"))?;
            self.lease.check()?;
            watches.retain(|weak| weak.strong_count() > 0);
            watches.push(Arc::downgrade(&inner.cancel));
        }
        Ok(Subscription {
            inner,
            lease: self.lease.clone(),
        })
    }
}
