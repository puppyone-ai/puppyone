//! Window subscriptions have unique lifetimes; a repository owns one worker.
use super::{Identity, WorkerHandle, identity, worker};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, LazyLock, Mutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

#[cfg(test)]
mod tests;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Key {
    Repository(Identity),
    Pending(PathBuf),
}
static REGISTRY: LazyLock<Mutex<HashMap<Key, Weak<Core>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_SUBSCRIPTION: AtomicU64 = AtomicU64::new(1);

struct Client {
    id: u64,
    owner: Mutex<Arc<Core>>,
    active: AtomicBool,
    changed: Mutex<Box<dyn Fn() + Send>>,
}
/// Dropping an old subscription never removes another subscription from the
/// same window or folder, and the last owner drops the repository worker.
pub struct GitWatch {
    client: Arc<Client>,
}
impl Drop for GitWatch {
    fn drop(&mut self) {
        self.client.active.store(false, Ordering::Release);
        // A callback admitted before cancellation completes before stop
        // returns; a queued callback rechecks active while holding this lock.
        drop(self.client.changed.lock().unwrap());
        let owner = self.client.owner.lock().unwrap().clone();
        owner.clients.lock().unwrap().remove(&self.client.id);
    }
}

enum Start {
    Starting,
    Ready(WorkerHandle),
    Failed(String),
}
struct Core {
    root: PathBuf,
    scope: Mutex<PathBuf>,
    pending: AtomicBool,
    clients: Mutex<BTreeMap<u64, Weak<Client>>>,
    start: Mutex<Start>,
    ready: Condvar,
    initialized: AtomicBool,
    initial_invalidation: AtomicBool,
}
impl Core {
    fn new(root: PathBuf, pending: bool) -> Self {
        Self {
            scope: Mutex::new(root.clone()),
            pending: AtomicBool::new(pending),
            root,
            clients: Mutex::new(BTreeMap::new()),
            start: Mutex::new(Start::Starting),
            ready: Condvar::new(),
            initialized: AtomicBool::new(false),
            initial_invalidation: AtomicBool::new(false),
        }
    }
    // Run only on the background worker. Explicit workspace notifications must
    // never wait for Git, even when a formerly empty folder becomes a repository.
    fn promote_pending(self: &Arc<Self>) -> Arc<Self> {
        if !self.pending.load(Ordering::Acquire) {
            return self.clone();
        }
        let Ok(resolved) = identity(&self.root) else {
            return self.clone();
        };
        let mut registry = REGISTRY.lock().unwrap();
        let key = Key::Repository(resolved.clone());
        let owner = registry
            .get(&key)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| self.clone());
        if !Arc::ptr_eq(self, &owner) {
            transfer_clients(self, &owner);
        }
        *owner.scope.lock().unwrap() = resolved.top_level;
        owner.pending.store(false, Ordering::Release);
        self.pending.store(false, Ordering::Release);
        registry.retain(|_, core| {
            !core.ptr_eq(&Arc::downgrade(self)) && !core.ptr_eq(&Arc::downgrade(&owner))
        });
        registry.insert(key, Arc::downgrade(&owner));
        owner
    }
    fn emit(self: &Arc<Self>) -> usize {
        if !self.initialized.load(Ordering::Acquire) {
            self.initial_invalidation.store(true, Ordering::Release);
            if !self.initialized.load(Ordering::Acquire)
                || !self.initial_invalidation.swap(false, Ordering::AcqRel)
            {
                return 0;
            }
        }
        let clients: Vec<_> = self
            .clients
            .lock()
            .unwrap()
            .values()
            .filter_map(Weak::upgrade)
            .collect();
        let mut delivered = 0;
        for client in clients {
            let owns = Arc::ptr_eq(&client.owner.lock().unwrap(), self);
            let changed = client.changed.lock().unwrap();
            if client.active.load(Ordering::Acquire) && owns {
                changed();
                delivered += 1;
            }
        }
        delivered
    }
    fn wait(&self) -> Result<(), String> {
        let mut state = self.start.lock().unwrap();
        loop {
            match &*state {
                Start::Starting => state = self.ready.wait(state).unwrap(),
                Start::Ready(handle) => {
                    let _ = &handle.stop;
                    return Ok(());
                }
                Start::Failed(error) => return Err(error.clone()),
            }
        }
    }
}

// The registry lock serializes identity promotion and subscription creation.
fn transfer_clients(previous: &Arc<Core>, owner: &Arc<Core>) {
    let clients: Vec<_> = previous
        .clients
        .lock()
        .unwrap()
        .values()
        .filter_map(Weak::upgrade)
        .collect();
    for client in clients {
        *client.owner.lock().unwrap() = owner.clone();
        owner
            .clients
            .lock()
            .unwrap()
            .insert(client.id, Arc::downgrade(&client));
    }
    previous.clients.lock().unwrap().clear();
}

fn canonical(root: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(root)
        .or_else(|_| std::path::absolute(root))
        .map_err(|error| error.to_string())
}

pub(super) fn watch(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
) -> Result<GitWatch, String> {
    watch_using(root, noise, changed, worker::start)
}

fn watch_using(
    root: &Path,
    noise: fn(&str) -> bool,
    changed: impl Fn() + Send + 'static,
    start: impl FnOnce(&Path, fn(&str) -> bool, Box<dyn Fn() + Send>) -> Result<WorkerHandle, String>,
) -> Result<GitWatch, String> {
    let root = canonical(root)?;
    let resolved = identity(&root).ok();
    let key = resolved
        .clone()
        .map(Key::Repository)
        .unwrap_or_else(|| Key::Pending(root.clone()));
    let (owner, created, client) = {
        let mut registry = REGISTRY.lock().unwrap();
        registry.retain(|_, core| core.strong_count() > 0);
        let pending = if resolved.is_some() {
            registry
                .remove(&Key::Pending(root.clone()))
                .and_then(|c| c.upgrade())
        } else {
            None
        };
        let existing = registry.get(&key).and_then(Weak::upgrade);
        let (owner, created) = match existing.or_else(|| pending.clone()) {
            Some(owner) => (owner, false),
            None => (
                Arc::new(Core::new(
                    resolved
                        .as_ref()
                        .map_or_else(|| root.clone(), |i| i.top_level.clone()),
                    resolved.is_none(),
                )),
                true,
            ),
        };
        // If this pending root was promoted while another subscription created
        // the repository entry, move its tokens rather than keeping two workers.
        if let Some(previous) = pending.filter(|p| !Arc::ptr_eq(p, &owner)) {
            transfer_clients(&previous, &owner);
        }
        if let Some(resolved) = &resolved {
            *owner.scope.lock().unwrap() = resolved.top_level.clone();
            owner.pending.store(false, Ordering::Release);
        }
        registry.insert(key, Arc::downgrade(&owner));
        let client = Arc::new(Client {
            id: NEXT_SUBSCRIPTION.fetch_add(1, Ordering::Relaxed),
            owner: Mutex::new(owner.clone()),
            active: AtomicBool::new(true),
            changed: Mutex::new(Box::new(changed)),
        });
        owner
            .clients
            .lock()
            .unwrap()
            .insert(client.id, Arc::downgrade(&client));
        (owner, created, client)
    };
    if created {
        let weak = Arc::downgrade(&owner);
        let result = start(
            &root,
            noise,
            Box::new(move || {
                if let Some(owner) = weak.upgrade() {
                    owner.promote_pending().emit();
                }
            }),
        );
        *owner.start.lock().unwrap() = match result {
            Ok(handle) => Start::Ready(handle),
            Err(error) => Start::Failed(error),
        };
        owner.initialized.store(true, Ordering::Release);
        owner.ready.notify_all();
        if owner.initial_invalidation.swap(false, Ordering::AcqRel) {
            owner.emit();
        }
    }
    let subscription = GitWatch { client };
    owner.wait()?;
    Ok(subscription)
}

/// Explicit workspace writes fan out immediately, without waiting for Git's
/// metadata watcher (which deliberately excludes the working tree).
pub fn invalidate_working_tree(root: &Path) -> usize {
    let Ok(root) = canonical(root) else {
        return 0;
    };
    let owners: Vec<_> = {
        let registry = REGISTRY.lock().unwrap();
        let mut owners = Vec::new();
        for owner in registry.values().filter_map(Weak::upgrade) {
            if root.starts_with(&*owner.scope.lock().unwrap())
                && !owners.iter().any(|other| Arc::ptr_eq(other, &owner))
            {
                owners.push(owner);
            }
        }
        owners
    };
    owners.iter().map(Core::emit).sum()
}
