//! Adapt the existing capability filesystem to the common ports.
use super::Workspace;
use crate::workspace::{contracts::*, ports::*};
use std::{
    path::Path,
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

/// Quiet that ends a burst of directory changes.
const BURST_QUIET: Duration = Duration::from_millis(120);
/// Longest a continuous stream of changes defers the tree's reread.
const BURST_LIMIT: Duration = Duration::from_secs(1);

// Preserve the provider's path scope for resource previews. Unknown scopes
// (including OS event queue overflow) must still invalidate every consumer.
fn change_hint(root: &Path, result: notify::Result<notify::Event>) -> Option<WatchEvent> {
    let event = match result {
        Ok(event) => event,
        Err(error) => {
            return Some(WatchEvent::Failed(Error::new(
                ErrorKind::Io,
                error.to_string(),
            )));
        }
    };
    if event.need_rescan() || event.paths.is_empty() {
        return Some(WatchEvent::Invalidated);
    }
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return None;
    }
    let mut paths = Vec::new();
    for absolute in event.paths {
        let Ok(relative) = absolute.strip_prefix(root) else {
            return Some(WatchEvent::Invalidated);
        };
        if relative.components().any(|c| c.as_os_str() == ".git") {
            continue;
        }
        let Ok(path) = RelativePath::new(relative) else {
            return Some(WatchEvent::Invalidated);
        };
        if !paths.contains(&path) {
            paths.push(path);
        }
        if paths.len() > 256 {
            return Some(WatchEvent::Invalidated);
        }
    }
    (!paths.is_empty()).then_some(WatchEvent::Changed(paths))
}

struct LocalProvider {
    inner: Arc<Workspace>,
    descriptor: Descriptor,
}
pub(in crate::workspace) fn open(path: &Path, legacy_text: bool) -> Result<Arc<dyn Provider>> {
    let inner = Workspace::open_with(path, legacy_text)?;
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
        let events = Arc::new(Mutex::new(None::<WatchEvent>));
        let pending = events.clone();
        let (tx, rx) = mpsc::channel::<WatchEvent>();
        let filtered = root.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                if let Some(event) = change_hint(&filtered, result) {
                    let _ = tx.send(event);
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
                    Ok(mut event) => {
                        // Coalesce the burst, then publish one reset; a
                        // stream that never quiets (a build, an install)
                        // still publishes once per `BURST_LIMIT`.
                        let started = Instant::now();
                        while started.elapsed() < BURST_LIMIT {
                            let Ok(next) = rx.recv_timeout(BURST_QUIET) else {
                                break;
                            };
                            event = event.coalesce(next);
                        }
                        if let Ok(mut slot) = pending.lock() {
                            *slot = Some(match slot.take() {
                                Some(previous) => previous.coalesce(event),
                                None => event,
                            });
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

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{
        Event, EventKind,
        event::{Flag, ModifyKind, RenameMode},
    };

    #[test]
    fn root_notifications_keep_both_rename_paths_and_ignore_git_internals() {
        let root = Path::new("/project");
        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(root.join("old/image.png"))
            .add_path(root.join("new/image.png"))
            .add_path(root.join(".git/index"));
        let Some(WatchEvent::Changed(paths)) = change_hint(root, Ok(event)) else {
            panic!("scoped paths required")
        };
        assert_eq!(
            paths.iter().map(|p| p.as_path()).collect::<Vec<_>>(),
            [Path::new("old/image.png"), Path::new("new/image.png")]
        );
        let event = Event::new(EventKind::Any).add_path(root.join(".git/objects/abc"));
        assert!(change_hint(root, Ok(event)).is_none());
    }

    #[test]
    fn overflow_unknown_and_outside_root_changes_force_revalidation() {
        let root = Path::new("/project");
        for event in [
            Event::new(EventKind::Any),
            Event::new(EventKind::Any).add_path(Path::new("/outside/image.png").into()),
            Event::new(EventKind::Any)
                .add_path(root.join("image.png"))
                .set_flag(Flag::Rescan),
        ] {
            assert!(matches!(
                change_hint(root, Ok(event)),
                Some(WatchEvent::Invalidated)
            ));
        }
        let mut event = Event::new(EventKind::Any);
        for n in 0..257 {
            event = event.add_path(root.join(format!("{n}.png")));
        }
        assert!(matches!(
            change_hint(root, Ok(event)),
            Some(WatchEvent::Invalidated)
        ));
        assert!(matches!(
            change_hint(root, Err(notify::Error::generic("watch unavailable"))),
            Some(WatchEvent::Failed(_))
        ));
    }
}
