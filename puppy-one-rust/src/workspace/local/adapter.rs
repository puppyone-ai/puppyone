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

struct LocalProvider {
    inner: Arc<Workspace>,
    descriptor: Descriptor,
    hub: Arc<WatchHub>,
    observation_reads: Arc<AtomicU64>,
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
    let observation_reads = Arc::new(AtomicU64::new(0));
    let hub = Arc::new(WatchHub::new(inner.clone(), observation_reads.clone()));
    Ok(Arc::new(LocalProvider {
        inner,
        descriptor,
        hub,
        observation_reads,
    }))
}

impl DataPort for LocalProvider {
    fn descriptor(&self) -> Descriptor {
        self.descriptor.clone()
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
    fn platform_path(&self, path: &RelativePath) -> Result<PathBuf> {
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
                        self.flush_root_invalidation();
                        burst_started = None;
                        last_tree_event = None;
                        continue;
                    }
                    match rx.recv_timeout(deadline.saturating_duration_since(now)) {
                        Ok(sig) => sig,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            self.flush_root_invalidation();
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
                        let now = Instant::now();
                        burst_started.get_or_insert(now);
                        last_tree_event = Some(now);
                    }
                    let ids = self.matching_doc_ids(resync_all, &rel_paths);
                    if !ids.is_empty() {
                        self.check_document_ids(&ids);
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

    fn flush_root_invalidation(&self) {
        let callbacks: Vec<Notify> = {
            let Ok(state) = self.state.lock() else {
                return;
            };
            state
                .root_subs
                .values()
                .map(|sub| {
                    if let Ok(mut slot) = sub.events.lock() {
                        *slot = Some(WatchEvent::Invalidated);
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
                            let content_or_perm_changed = snap.last_error.is_some()
                                || Some(fresh_hash) != snap.last_hash
                                || fresh_stat.readonly != snap.last_readonly;
                            if let Ok(mut state) = self.state.lock()
                                && let Some(sub) = state.doc_subs.get_mut(&snap.id)
                            {
                                sub.last_stat = Some(fresh_stat);
                                sub.last_hash = Some(fresh_hash);
                                sub.last_readonly = fresh_stat.readonly;
                                sub.last_error = None;
                                if content_or_perm_changed {
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
