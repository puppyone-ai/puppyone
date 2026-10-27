//! Admitted workspace handle: stable resource identity, revocable provider lease
//! and capability enforcement. Only `local` knows the capability filesystem.
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

use crate::model::{MAX_DIRECTORY_ENTRIES, Node};
use contracts::{Descriptor, RelativePath, Revision, TextSnapshot, WriteResult};
pub use contracts::{Error, ErrorKind, PreviewData, ResourceId, Result};
use ports::{Notify, Provider, WatchEvent, WatchSubscription};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};
use uuid::Uuid;
pub const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
struct Lease {
    id: Uuid,
    live: Arc<AtomicBool>,
    watches: Arc<Mutex<Vec<Weak<mpsc::Sender<()>>>>>,
}
impl Lease {
    fn check(&self) -> Result<()> {
        if self.live.load(Ordering::Acquire) {
            Ok(())
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
        let descriptor = provider.descriptor();
        if descriptor.capabilities.local_actions && descriptor.local_root.is_none() {
            return Err(Error::from(
                "Native actions require a native workspace root",
            ));
        }
        Ok(Arc::new(Self {
            descriptor,
            provider,
            lease: Lease {
                id: Uuid::new_v4(),
                live: Arc::new(AtomicBool::new(true)),
                watches: Arc::default(),
            },
        }))
    }
    pub fn local_root(&self) -> Option<&Path> {
        self.descriptor.local_root.as_deref()
    }
    pub fn name(&self) -> &str {
        &self.descriptor.name
    }
    pub fn capabilities(&self) -> contracts::Capabilities {
        self.descriptor.capabilities
    }
    pub fn revoke(&self) {
        self.lease.live.store(false, Ordering::Release);
        if let Ok(mut watches) = self.lease.watches.lock() {
            for cancel in watches.drain(..).filter_map(|weak| weak.upgrade()) {
                let _ = cancel.send(());
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
        if value.text.len() > MAX_TEXT_BYTES
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
    pub fn save(&self, document: &Document, text: &str) -> Result<WriteOutcome> {
        self.check_document(document)?;
        self.admit(self.capabilities().write)?;
        if text.len() > MAX_TEXT_BYTES || text.contains(['\0', '\r']) {
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
        if rows.len() > MAX_DIRECTORY_ENTRIES {
            return Err(Error::from(crate::localization::t(
                "native.workspace.folderLimit",
            )));
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
        if text.len() > MAX_TEXT_BYTES {
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
