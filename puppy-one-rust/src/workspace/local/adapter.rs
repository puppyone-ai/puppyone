//! Adapt the capability filesystem to the common ports, backed by a single
//! shared recursive OS watcher per local workspace root (`DP-20`, `DP-21`, `DP-51`).
use super::{StatFingerprint, Version, Workspace};
use crate::workspace::{contracts::*, ports::*};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
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
    // On inotify (Linux), creating a nested directory and immediately writing
    // inside it can race with recursive sub-watch attachment, so only the new
    // directory's creation event arrives. Trigger a scoped refresh so callers
    // re-scan the new subtree rather than missing files created inside it.
    if matches!(
        event.kind,
        notify::EventKind::Create(notify::event::CreateKind::Folder)
    ) {
        return Some(WatchEvent::Invalidated);
    }
    let mut paths = Vec::new();
    for absolute in event.paths {
        let Ok(relative) = absolute.strip_prefix(root) else {
            return Some(WatchEvent::Invalidated);
        };
        if relative.components().any(|c| c.as_os_str() == ".git") || is_staging_file(relative) {
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

/// A save's own staging file (`.puppyone-rust-….tmp`, and the TS app's
/// `.name.puppyone-….tmp`): an atomic save's burst names only its target.
fn is_staging_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with('.') && name.ends_with(".tmp") && name.contains("puppyone-")
        })
}

struct LocalProvider {
    inner: Arc<Workspace>,
    descriptor: Descriptor,
    markdown_dialect: Option<crate::formats::markdown::MarkdownDialect>,
    hub: Arc<WatchHub>,
    observation_reads: Arc<AtomicU64>,
}

pub(in crate::workspace) fn open(path: &Path, legacy_text: bool) -> Result<Arc<dyn Provider>> {
    let inner = Workspace::open_with(path, legacy_text)?;
    let markdown_dialect = inner.markdown_dialect()?;
    provider(inner, Limits::LOCAL, markdown_dialect)
}
/// Only the scoped file provider may use this adapter. Do not inspect the
/// parent folder's project metadata while opening a standalone document.
pub(in crate::workspace) fn open_file_parent(path: &Path) -> Result<Arc<dyn Provider>> {
    provider(
        Workspace::open_with_limit(path, true, Limits::FILE_WINDOW_BYTES)?,
        Limits::FILE_WINDOW,
        None,
    )
}
fn provider(
    inner: Arc<Workspace>,
    limits: Limits,
    markdown_dialect: Option<crate::formats::markdown::MarkdownDialect>,
) -> Result<Arc<dyn Provider>> {
    let uri = url::Url::from_directory_path(&inner.path)
        .map_err(|_| Error::from("Invalid local workspace root"))?;
    let descriptor = Descriptor {
        limits,
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
    let observation_reads = Arc::new(AtomicU64::new(0));
    let hub = Arc::new(WatchHub::new(inner.clone(), observation_reads.clone()));
    Ok(Arc::new(LocalProvider {
        inner,
        descriptor,
        markdown_dialect,
        hub,
        observation_reads,
    }))
}

impl DataPort for LocalProvider {
    fn descriptor(&self) -> Descriptor {
        self.descriptor.clone()
    }
    fn markdown_dialect(&self) -> Option<crate::formats::markdown::MarkdownDialect> {
        self.markdown_dialect
    }
    fn revoke(&self) {
        self.hub.revoke();
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
        let version = Version::parse(base)?;
        let line_ending = version.line_ending;
        self.write_normalized(path, base, text, line_ending)
    }
    fn write_normalized(
        &self,
        path: &RelativePath,
        base: &Revision,
        text: &str,
        line_ending: LineEnding,
    ) -> Result<WriteResult> {
        let version = Version::parse(base)?;
        let result = self
            .inner
            .save_version(path.as_path(), &version, line_ending, text)?;
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
    fn preview_bytes(&self, path: &RelativePath, max: u64) -> Result<Vec<u8>> {
        self.inner.preview_bytes(path.as_path(), max)
    }
    fn preview_reader(&self, path: &RelativePath) -> Result<super::super::ports::ResourceReader> {
        self.inner.preview_reader(path.as_path())
    }
    fn preview_session_reader(
        &self,
        path: &RelativePath,
    ) -> super::super::ports::SessionReadResult<super::super::ports::SessionReader> {
        self.inner.preview_session_reader(path.as_path())
    }
    fn platform_path(&self, path: &RelativePath) -> Result<std::path::PathBuf> {
        self.inner.absolute(path.as_path())
    }
    fn stat_entry(&self, path: &RelativePath) -> Result<EntryStat> {
        self.inner.stat_entry(path.as_path())
    }
    fn read_head(&self, path: &RelativePath, max_bytes: usize) -> Result<Vec<u8>> {
        self.inner.read_head(path.as_path(), max_bytes)
    }
}

impl ResourceWatchPort for LocalProvider {
    fn watch_root(&self, notify: Notify) -> Result<WatchSubscription> {
        self.hub.subscribe_root(notify)
    }
    fn watch(
        &self,
        path: &RelativePath,
        baseline: &Revision,
        notify: Notify,
    ) -> Result<WatchSubscription> {
        let version = Version::parse(baseline)?;
        self.hub.subscribe_document(path.clone(), version, notify)
    }
    fn observation_full_reads(&self) -> u64 {
        self.observation_reads.load(Ordering::Acquire)
    }
}

enum HubSignal {
    Fs(notify::Result<notify::Event>),
    InitialCheck(u64),
    CheckStop,
}

struct RootSub {
    events: Arc<Mutex<Option<WatchEvent>>>,
    notify: Notify,
}

struct DocSub {
    path: RelativePath,
    last_stat: Option<StatFingerprint>,
    last_hash: Option<blake3::Hash>,
    last_readonly: bool,
    last_error: Option<Error>,
    events: Arc<Mutex<Option<WatchEvent>>>,
    notify: Notify,
}

#[derive(Default)]
struct HubState {
    next_id: u64,
    root_subs: BTreeMap<u64, RootSub>,
    doc_subs: BTreeMap<u64, DocSub>,
    worker_tx: Option<mpsc::Sender<HubSignal>>,
}

struct WatchHub {
    inner: Arc<Workspace>,
    observation_reads: Arc<AtomicU64>,
    revoked: AtomicBool,
    state: Mutex<HubState>,
}

impl WatchHub {
    fn new(inner: Arc<Workspace>, observation_reads: Arc<AtomicU64>) -> Self {
        Self {
            inner,
            observation_reads,
            revoked: AtomicBool::new(false),
            state: Mutex::new(HubState::default()),
        }
    }

    fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
        if let Ok(mut state) = self.state.lock() {
            state.root_subs.clear();
            state.doc_subs.clear();
            if let Some(tx) = state.worker_tx.take() {
                let _ = tx.send(HubSignal::CheckStop);
            }
        }
    }

    fn ensure_worker_locked(
        self: &Arc<Self>,
        state: &mut HubState,
    ) -> Result<mpsc::Sender<HubSignal>> {
        if let Some(tx) = &state.worker_tx {
            return Ok(tx.clone());
        }
        use notify::{RecursiveMode, Watcher};
        let root = self.inner.absolute(Path::new(""))?;
        let (tx, rx) = mpsc::channel::<HubSignal>();
        let event_tx = tx.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let _ = event_tx.send(HubSignal::Fs(result));
            })
            .map_err(|e| Error::new(ErrorKind::Io, e.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| Error::new(ErrorKind::Io, e.to_string()))?;

        state.worker_tx = Some(tx.clone());
        let hub = Arc::clone(self);
        crate::localization::spawn(move || {
            hub.run_worker(watcher, root, rx);
        });
        Ok(tx)
    }

    fn subscribe_root(self: &Arc<Self>, notify: Notify) -> Result<WatchSubscription> {
        if self.revoked.load(Ordering::Acquire) {
            return Err(Error::new(
                ErrorKind::StaleLease,
                "Workspace access has expired; reopen it",
            ));
        }
        let events = Arc::new(Mutex::new(None));
        let id = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| Error::new(ErrorKind::Io, "Watch state unavailable"))?;
            let _ = self.ensure_worker_locked(&mut state)?;
            state.next_id += 1;
            let id = state.next_id;
            state.root_subs.insert(
                id,
                RootSub {
                    events: events.clone(),
                    notify,
                },
            );
            id
        };
        let hub = Arc::clone(self);
        Ok(WatchSubscription {
            events,
            cancel: WatchCancellation::new(move || {
                if let Ok(mut state) = hub.state.lock() {
                    state.root_subs.remove(&id);
                    if state.root_subs.is_empty()
                        && state.doc_subs.is_empty()
                        && let Some(tx) = state.worker_tx.take()
                    {
                        let _ = tx.send(HubSignal::CheckStop);
                    }
                }
            }),
        })
    }

    fn subscribe_document(
        self: &Arc<Self>,
        path: RelativePath,
        baseline: Version,
        notify: Notify,
    ) -> Result<WatchSubscription> {
        if self.revoked.load(Ordering::Acquire) {
            return Err(Error::new(
                ErrorKind::StaleLease,
                "Workspace access has expired; reopen it",
            ));
        }
        let events = Arc::new(Mutex::new(None));
        let (id, tx) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| Error::new(ErrorKind::Io, "Watch state unavailable"))?;
            let tx = self.ensure_worker_locked(&mut state)?;
            state.next_id += 1;
            let id = state.next_id;
            state.doc_subs.insert(
                id,
                DocSub {
                    path,
                    last_stat: Some(baseline.stat),
                    last_hash: baseline.hash(),
                    last_readonly: baseline.stat.readonly,
                    last_error: None,
                    events: events.clone(),
                    notify,
                },
            );
            (id, tx)
        };
        // Stat-first revalidation closes any race between `read` and `watch`
        // while keeping full-file reads at exact `0` when the file is idle (`DP-21`, `DP-51`).
        let _ = tx.send(HubSignal::InitialCheck(id));

        let hub = Arc::clone(self);
        Ok(WatchSubscription {
            events,
            cancel: WatchCancellation::new(move || {
                if let Ok(mut state) = hub.state.lock() {
                    state.doc_subs.remove(&id);
                    if state.root_subs.is_empty()
                        && state.doc_subs.is_empty()
                        && let Some(tx) = state.worker_tx.take()
                    {
                        let _ = tx.send(HubSignal::CheckStop);
                    }
                }
            }),
        })
    }

    fn run_worker(
        self: Arc<Self>,
        _watcher: notify::RecommendedWatcher,
        root: PathBuf,
        rx: mpsc::Receiver<HubSignal>,
    ) {
        let mut burst_started: Option<Instant> = None;
        let mut last_tree_event: Option<Instant> = None;
        let mut pending_hint: Option<WatchEvent> = None;
        let mut pending_documents = std::collections::HashSet::new();

        loop {
            if self.revoked.load(Ordering::Acquire) {
                return;
            }
            let signal = match (burst_started, last_tree_event) {
                (Some(started), Some(last)) => {
                    let now = Instant::now();
                    let quiet_deadline = last + BURST_QUIET;
                    let limit_deadline = started + BURST_LIMIT;
                    let deadline = quiet_deadline.min(limit_deadline);
                    if now >= deadline {
                        self.check_document_ids(&pending_documents.drain().collect::<Vec<_>>());
                        if let Some(hint) = pending_hint.take() {
                            self.flush_root_invalidation(hint);
                        }
                        burst_started = None;
                        last_tree_event = None;
                        continue;
                    }
                    match rx.recv_timeout(deadline.saturating_duration_since(now)) {
                        Ok(sig) => sig,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            self.check_document_ids(&pending_documents.drain().collect::<Vec<_>>());
                            if let Some(hint) = pending_hint.take() {
                                self.flush_root_invalidation(hint);
                            }
                            burst_started = None;
                            last_tree_event = None;
                            continue;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
                _ => match rx.recv() {
                    Ok(sig) => sig,
                    Err(_) => return,
                },
            };

            match signal {
                HubSignal::CheckStop => {
                    if self.should_stop() {
                        return;
                    }
                }
                HubSignal::InitialCheck(id) => {
                    self.check_document_ids(&[id]);
                }
                HubSignal::Fs(result) => {
                    let (tree_dirty, resync_all, rel_paths) = classify_fs_event(&root, &result);
                    if tree_dirty && self.has_root_subs() {
                        if let Some(hint) = change_hint(&root, result) {
                            pending_hint = Some(match pending_hint.take() {
                                Some(previous) => previous.coalesce(hint),
                                None => hint,
                            });
                        } else {
                            continue;
                        }
                        let now = Instant::now();
                        burst_started.get_or_insert(now);
                        last_tree_event = Some(now);
                    }
                    let ids = self.matching_doc_ids(resync_all, &rel_paths);
                    if !ids.is_empty() {
                        // One logical save can emit create/write/metadata/rename
                        // events. Hash its settled fingerprint once per bounded
                        // burst instead of publishing intermediate baselines.
                        pending_documents.extend(ids);
                        let now = Instant::now();
                        burst_started.get_or_insert(now);
                        last_tree_event = Some(now);
                    }
                }
            }
        }
    }

    fn should_stop(&self) -> bool {
        if self.revoked.load(Ordering::Acquire) {
            return true;
        }
        let Ok(mut state) = self.state.lock() else {
            return true;
        };
        if state.root_subs.is_empty() && state.doc_subs.is_empty() {
            state.worker_tx = None;
            true
        } else {
            false
        }
    }

    fn has_root_subs(&self) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| !state.root_subs.is_empty())
    }

    fn flush_root_invalidation(&self, event: WatchEvent) {
        let callbacks: Vec<Notify> = {
            let Ok(state) = self.state.lock() else {
                return;
            };
            state
                .root_subs
                .values()
                .map(|sub| {
                    if let Ok(mut slot) = sub.events.lock() {
                        *slot = Some(match slot.take() {
                            Some(previous) => previous.coalesce(event.clone()),
                            None => event.clone(),
                        });
                    }
                    sub.notify.clone()
                })
                .collect()
        };
        for notify in callbacks {
            notify();
        }
    }

    fn matching_doc_ids(&self, resync_all: bool, rel_paths: &[PathBuf]) -> Vec<u64> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        if state.doc_subs.is_empty() {
            return Vec::new();
        }
        if resync_all {
            return state.doc_subs.keys().copied().collect();
        }
        state
            .doc_subs
            .iter()
            .filter(|(_, sub)| {
                let doc = sub.path.as_path();
                rel_paths.iter().any(|ev| {
                    ev.as_os_str().is_empty()
                        || doc == ev.as_path()
                        || doc.starts_with(ev.as_path())
                })
            })
            .map(|(&id, _)| id)
            .collect()
    }

    fn check_document_ids(&self, ids: &[u64]) {
        #[derive(Clone)]
        struct Snapshot {
            id: u64,
            path: RelativePath,
            last_stat: Option<StatFingerprint>,
            last_hash: Option<blake3::Hash>,
            last_readonly: bool,
            last_error: Option<Error>,
        }

        let snapshots: Vec<Snapshot> = {
            let Ok(state) = self.state.lock() else {
                return;
            };
            ids.iter()
                .filter_map(|id| {
                    state.doc_subs.get(id).map(|sub| Snapshot {
                        id: *id,
                        path: sub.path.clone(),
                        last_stat: sub.last_stat,
                        last_hash: sub.last_hash,
                        last_readonly: sub.last_readonly,
                        last_error: sub.last_error.clone(),
                    })
                })
                .collect()
        };

        let mut to_notify: Vec<Notify> = Vec::new();
        for snap in snapshots {
            // DP-21: always stat first; skip reading/hashing when StatFingerprint is unchanged.
            match self.inner.stat_fingerprint(snap.path.as_path()) {
                Ok(stat) if Some(stat) == snap.last_stat && snap.last_error.is_none() => {
                    continue;
                }
                Ok(_) => {
                    self.observation_reads.fetch_add(1, Ordering::AcqRel);
                    match self.inner.read_hash_and_stat(snap.path.as_path()) {
                        Ok((fresh_stat, fresh_hash)) => {
                            // Identity and metadata are part of the observation
                            // baseline too: an atomic replacement with identical
                            // bytes must retire the old file's authority.
                            let baseline_changed = snap.last_error.is_some()
                                || Some(fresh_stat) != snap.last_stat
                                || Some(fresh_hash) != snap.last_hash
                                || fresh_stat.readonly != snap.last_readonly;
                            if let Ok(mut state) = self.state.lock()
                                && let Some(sub) = state.doc_subs.get_mut(&snap.id)
                            {
                                sub.last_stat = Some(fresh_stat);
                                sub.last_hash = Some(fresh_hash);
                                sub.last_readonly = fresh_stat.readonly;
                                sub.last_error = None;
                                if baseline_changed {
                                    if let Ok(mut slot) = sub.events.lock() {
                                        *slot = Some(WatchEvent::Invalidated);
                                    }
                                    to_notify.push(sub.notify.clone());
                                }
                            }
                        }
                        Err(err) => {
                            if let Ok(mut state) = self.state.lock()
                                && let Some(sub) = state.doc_subs.get_mut(&snap.id)
                            {
                                sub.last_stat = None;
                                if sub.last_error.as_ref() != Some(&err) {
                                    sub.last_error = Some(err.clone());
                                    if let Ok(mut slot) = sub.events.lock() {
                                        *slot = Some(WatchEvent::Failed(err));
                                    }
                                    to_notify.push(sub.notify.clone());
                                }
                            }
                        }
                    }
                }
                Err(err) => {
                    if let Ok(mut state) = self.state.lock()
                        && let Some(sub) = state.doc_subs.get_mut(&snap.id)
                    {
                        sub.last_stat = None;
                        if sub.last_error.as_ref() != Some(&err) {
                            sub.last_error = Some(err.clone());
                            if let Ok(mut slot) = sub.events.lock() {
                                *slot = Some(WatchEvent::Failed(err));
                            }
                            to_notify.push(sub.notify.clone());
                        }
                    }
                }
            }
        }

        for notify in to_notify {
            notify();
        }
    }
}

fn classify_fs_event(
    root: &Path,
    result: &notify::Result<notify::Event>,
) -> (bool, bool, Vec<PathBuf>) {
    match result {
        Err(_) => (true, true, Vec::new()),
        Ok(event) => {
            let resync = event.need_rescan() || event.paths.is_empty();
            let mut tree_dirty = resync;
            let mut rel_paths = Vec::with_capacity(event.paths.len());
            for path in &event.paths {
                let rel = match path.strip_prefix(root) {
                    Ok(r) => r.to_path_buf(),
                    Err(_) => path
                        .canonicalize()
                        .ok()
                        .and_then(|c| c.strip_prefix(root).ok().map(Path::to_path_buf))
                        .unwrap_or_default(),
                };
                let in_git = rel.components().any(|c| c.as_os_str() == ".git");
                if !in_git {
                    tree_dirty = true;
                    rel_paths.push(rel);
                }
            }
            (tree_dirty, resync, rel_paths)
        }
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

    /// `workspaceMutationPipeline`: a save's rename/change burst with its
    /// staging file names its target once; a large edit coalesces into one
    /// lossless, deduplicated batch; past 256 paths, or with any unknown
    /// path, the batch becomes a scoped full refresh of this root.
    #[test]
    fn bursts_coalesce_losslessly_and_degrade_to_a_scoped_refresh() {
        let root = Path::new("/project");
        let event = |kind, path: &str| {
            change_hint(root, Ok(Event::new(kind).add_path(root.join(path)))).unwrap_or(
                // A burst of staging files alone names nothing.
                WatchEvent::Changed(Vec::new()),
            )
        };
        let rename = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
        let change = EventKind::Modify(ModifyKind::Any);
        let save = [
            event(rename, ".note.md.puppyone-123-a1b2.tmp"),
            event(rename, ".puppyone-rust-5f1c.tmp"),
            event(rename, "note.md"),
            event(change, "note.md"),
            event(rename, "note.md"),
        ]
        .into_iter()
        .reduce(WatchEvent::coalesce)
        .unwrap();
        assert!(
            matches!(&save, WatchEvent::Changed(paths) if paths.iter().map(|p| p.as_path()).eq([Path::new("note.md")])),
            "{save:?}"
        );

        let paths: Vec<String> = (0..200).map(|n| format!("generated/file-{n}.ts")).collect();
        let batch = paths
            .iter()
            .map(|path| event(change, path))
            .chain([event(rename, &paths[0]), event(change, &paths[0])])
            .reduce(WatchEvent::coalesce)
            .unwrap();
        let WatchEvent::Changed(batch) = batch else {
            panic!("a 200-file edit stays scoped")
        };
        assert!(
            batch
                .iter()
                .map(|p| p.as_path())
                .eq(paths.iter().map(Path::new))
        );

        let storm = (0..=256)
            .map(|n| event(change, &format!("generated/file-{n}.ts")))
            .reduce(WatchEvent::coalesce)
            .unwrap();
        assert!(matches!(storm, WatchEvent::Invalidated));
        let mixed = event(change, "known.md").coalesce(WatchEvent::Invalidated);
        assert!(matches!(mixed, WatchEvent::Invalidated));
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
