//! Adapt the existing capability filesystem to the common ports.
use super::Workspace;
use crate::workspace::{contracts::*, ports::*};
use std::{
    path::Path,
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

struct LocalProvider {
    inner: Arc<Workspace>,
    descriptor: Descriptor,
}
pub(in crate::workspace) fn open(path: &Path) -> Result<Arc<dyn Provider>> {
    let inner = Workspace::open(path)?;
    let uri = url::Url::from_directory_path(&inner.path)
        .map_err(|_| Error::from("Invalid local workspace root"))?;
    let descriptor = Descriptor {
        limits: Limits::LOCAL,
        storage: StorageId::new(uri.as_str())?,
        name: inner
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        local_root: Some(inner.path.clone()),
        capabilities: Capabilities {
            read: true,
            write: true,
            create: true,
            rename: true,
            remove: true,
            move_entry: true,
            copy: true,
            import: true,
            watch: true,
            preview: true,
            local_actions: true,
        },
    };
    Ok(Arc::new(LocalProvider { inner, descriptor }))
}
impl DataPort for LocalProvider {
    fn descriptor(&self) -> Descriptor {
        self.descriptor.clone()
    }
    fn list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
        self.inner
            .list(path.as_path())?
            .into_iter()
            .map(|n| {
                Ok(Entry {
                    path: RelativePath::new(&n.path)?,
                    name: n.name,
                    folder: n.folder,
                })
            })
            .collect()
    }
    fn create(
        &self,
        parent: &RelativePath,
        name: &str,
        folder: bool,
        text: &str,
    ) -> Result<RelativePath> {
        RelativePath::new(
            &self
                .inner
                .create_entry(parent.as_path(), name, folder, text)?,
        )
    }
    fn rename(&self, path: &RelativePath, name: &str) -> Result<RelativePath> {
        RelativePath::new(&self.inner.rename_entry(path.as_path(), name)?)
    }
    fn remove(&self, path: &RelativePath) -> Result<()> {
        self.inner.remove_entry(path.as_path())
    }
    fn move_entry(&self, from: &RelativePath, folder: &RelativePath) -> Result<RelativePath> {
        RelativePath::new(&self.inner.move_entry(from.as_path(), folder.as_path())?)
    }
    fn copy(&self, from: &RelativePath, folder: &RelativePath) -> Result<RelativePath> {
        RelativePath::new(&self.inner.copy_entry(from.as_path(), folder.as_path())?)
    }
    fn import(&self, source: &Path, folder: &RelativePath) -> Result<RelativePath> {
        RelativePath::new(&self.inner.import_external(source, folder.as_path())?)
    }
}
impl DocumentStoragePort for LocalProvider {
    fn read(&self, path: &RelativePath) -> Result<TextSnapshot> {
        Ok(self.inner.read(path.as_path())?.into_snapshot())
    }
    fn write(&self, path: &RelativePath, base: &Revision, text: &str) -> Result<WriteResult> {
        let document = self.inner.read(path.as_path())?;
        if &document.version.revision() != base {
            return Ok(WriteResult::Conflict(document.into_snapshot()));
        }
        // The filesystem writer repeats its check around staging/publication,
        // preserving BOM/line endings and permissions from this exact baseline.
        let result = self.inner.save(&document, text)?;
        let snapshot = result.document.into_snapshot();
        Ok(if result.updated {
            WriteResult::Conflict(snapshot)
        } else {
            WriteResult::Saved(snapshot)
        })
    }
}
impl ResourcePort for LocalProvider {
    fn preview(&self, path: &RelativePath) -> Result<PreviewData> {
        self.inner
            .resource(path.as_path())
            .map(PreviewData::LocalFile)
    }
    fn platform_path(&self, path: &RelativePath) -> Result<std::path::PathBuf> {
        self.inner.absolute(path.as_path())
    }
}
impl ResourceWatchPort for LocalProvider {
    /// `useWorkbenchWorkspaceContentWatch`: one recursive OS watcher on the
    /// granted root. Bursts coalesce into one reset; `.git` internals do not
    /// invalidate the tree. Dropping the subscription stops the watcher.
    fn watch_root(&self, notify: Notify) -> Result<WatchSubscription> {
        use notify::{RecursiveMode, Watcher};
        let root = self.inner.absolute(std::path::Path::new(""))?;
        let events = Arc::new(Mutex::new(None));
        let pending = events.clone();
        let (tx, rx) = mpsc::channel::<()>();
        let filtered = root.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let relevant = match &result {
                    Ok(event) => event.paths.iter().any(|p| {
                        !p.strip_prefix(&filtered)
                            .unwrap_or(p)
                            .components()
                            .any(|c| c.as_os_str() == ".git")
                    }),
                    Err(_) => true,
                };
                if relevant {
                    let _ = tx.send(());
                }
            })
            .map_err(|e| Error::new(ErrorKind::Io, e.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| Error::new(ErrorKind::Io, e.to_string()))?;
        let (stop_tx, stop) = mpsc::channel::<()>();
        crate::localization::spawn(move || {
            // Owns the watcher: dropping it here stops the OS subscription.
            let _watcher = watcher;
            loop {
                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(()) => {
                        // Coalesce the burst, then publish one reset.
                        while rx.recv_timeout(Duration::from_millis(120)).is_ok() {}
                        if let Ok(mut slot) = pending.lock() {
                            *slot = Some(WatchEvent::Invalidated);
                        }
                        notify();
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if !matches!(stop.try_recv(), Err(mpsc::TryRecvError::Empty)) {
                    return;
                }
            }
        });
        Ok(WatchSubscription {
            events,
            cancel: WatchCancellation::new(move || {
                let _ = stop_tx.send(());
            }),
        })
    }
    fn watch(
        &self,
        path: &RelativePath,
        baseline: &Revision,
        notify: Notify,
    ) -> Result<WatchSubscription> {
        let (cancel, stop) = mpsc::channel();
        let events = Arc::new(Mutex::new(None));
        let pending = events.clone();
        let inner = self.inner.clone();
        let path = path.clone();
        let mut previous = Ok(baseline.clone());
        crate::localization::spawn(move || {
            while matches!(
                stop.recv_timeout(Duration::from_millis(500)),
                Err(mpsc::RecvTimeoutError::Timeout)
            ) {
                let current = inner.read(path.as_path()).map(|d| d.version.revision());
                if current != previous {
                    let event = match &current {
                        Ok(_) => WatchEvent::Invalidated,
                        Err(e) => WatchEvent::Failed(e.clone()),
                    };
                    previous = current;
                    // One latest reset/error. Recovery cannot be lost behind an
                    // older error when the UI is temporarily not consuming.
                    if let Ok(mut slot) = pending.lock() {
                        *slot = Some(event);
                    }
                    notify();
                }
            }
        });
        Ok(WatchSubscription {
            events,
            cancel: WatchCancellation::new(move || {
                let _ = cancel.send(());
            }),
        })
    }
}
