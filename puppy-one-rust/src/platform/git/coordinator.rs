//! Process-wide ownership of application Git mutations. Reserve all domains
//! atomically; independent worktrees remain parallel until shared refs change.
//! Git's own locks remain authoritative for other applications/processes.
use std::{
    collections::{BTreeSet, VecDeque},
    path::{Path, PathBuf},
    sync::{
        Condvar, LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Key {
    Worktree(PathBuf),
    Repository(PathBuf),
}
impl Key {
    fn path(&self) -> &Path {
        match self {
            Self::Worktree(path) | Self::Repository(path) => path,
        }
    }
}
struct Entry {
    id: u64,
    keys: BTreeSet<Key>,
}
#[derive(Default)]
struct State {
    next: u64,
    entries: VecDeque<Entry>,
}
#[derive(Default)]
pub struct Coordinator {
    state: Mutex<State>,
    changed: Condvar,
}
pub struct Lease<'a> {
    coordinator: &'a Coordinator,
    id: u64,
}
pub static GLOBAL: LazyLock<Coordinator> = LazyLock::new(Coordinator::default);
const CANCELLED: &str = "Git operation wait was cancelled.";

fn keys(keys: &[Key]) -> Result<BTreeSet<Key>, String> {
    if keys.is_empty() || keys.iter().any(|key| key.path().as_os_str().is_empty()) {
        return Err("At least one nonempty Git operation domain is required.".into());
    }
    Ok(keys.iter().cloned().collect())
}
impl Coordinator {
    /// FIFO for overlapping domains, without putting unrelated work behind
    /// the head of a global queue. Pending requests own their place as well.
    pub fn acquire(&self, requested: &[Key], cancel: &AtomicBool) -> Result<Lease<'_>, String> {
        let requested = keys(requested)?;
        let mut state = self.state.lock().unwrap();
        if cancel.load(Ordering::Acquire) {
            return Err(CANCELLED.into());
        }
        let id = state.next;
        state.next = state
            .next
            .checked_add(1)
            .expect("Git reservation sequence exhausted");
        state.entries.push_back(Entry {
            id,
            keys: requested.clone(),
        });
        loop {
            if cancel.load(Ordering::Acquire) {
                state.entries.retain(|entry| entry.id != id);
                self.changed.notify_all();
                return Err(CANCELLED.into());
            }
            if !state
                .entries
                .iter()
                .take_while(|entry| entry.id != id)
                .any(|entry| !entry.keys.is_disjoint(&requested))
            {
                return Ok(Lease {
                    coordinator: self,
                    id,
                });
            }
            state = self
                .changed
                .wait_timeout(state, Duration::from_millis(20))
                .unwrap()
                .0;
        }
    }
    /// Background work never gets ahead of an active or already queued owner.
    pub fn try_acquire(&self, requested: &[Key]) -> Result<Option<Lease<'_>>, String> {
        let requested = keys(requested)?;
        let mut state = self.state.lock().unwrap();
        if state
            .entries
            .iter()
            .any(|entry| !entry.keys.is_disjoint(&requested))
        {
            return Ok(None);
        }
        let id = state.next;
        state.next = state
            .next
            .checked_add(1)
            .expect("Git reservation sequence exhausted");
        state.entries.push_back(Entry {
            id,
            keys: requested,
        });
        Ok(Some(Lease {
            coordinator: self,
            id,
        }))
    }
    /// Like the TS tail snapshot: wait for every owner present when this read
    /// arrives. Later mutations retain their own publication/generation fence.
    pub fn wait_idle(&self, requested: &[Key], cancel: &AtomicBool) -> Result<(), String> {
        let requested = keys(requested)?;
        let mut state = self.state.lock().unwrap();
        let pending: BTreeSet<_> = state
            .entries
            .iter()
            .filter(|entry| !entry.keys.is_disjoint(&requested))
            .map(|entry| entry.id)
            .collect();
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err(CANCELLED.into());
            }
            if !state
                .entries
                .iter()
                .any(|entry| pending.contains(&entry.id))
            {
                return Ok(());
            }
            state = self
                .changed
                .wait_timeout(state, Duration::from_millis(20))
                .unwrap()
                .0;
        }
    }
    pub fn is_idle(&self, requested: &[Key]) -> Result<bool, String> {
        let requested = keys(requested)?;
        Ok(self
            .state
            .lock()
            .unwrap()
            .entries
            .iter()
            .all(|entry| entry.keys.is_disjoint(&requested)))
    }
}
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        let mut state = self.coordinator.state.lock().unwrap();
        state.entries.retain(|entry| entry.id != self.id);
        self.coordinator.changed.notify_all();
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Domains {
    pub worktree: Key,
    pub repository: Key,
}
impl Domains {
    pub fn both(&self) -> [Key; 2] {
        [self.worktree.clone(), self.repository.clone()]
    }
    /// Canonical Git identities collapse aliases and opened subfolders, while
    /// linked worktrees keep separate indexes and share the common ref domain.
    pub fn resolve(root: &Path, cancel: &AtomicBool) -> Result<Self, String> {
        let read = |arg: &str| -> Result<PathBuf, String> {
            let output = super::git_read(
                root,
                &["rev-parse", "--path-format=absolute", arg],
                None,
                cancel,
            )?;
            let text =
                std::str::from_utf8(&output).map_err(|_| "Git repository path is not UTF-8")?;
            let text = text.strip_suffix('\n').unwrap_or(text);
            Path::new(text).canonicalize().map_err(|e| e.to_string())
        };
        Ok(Self {
            worktree: Key::Worktree(read("--show-toplevel")?),
            repository: Key::Repository(read("--git-common-dir")?),
        })
    }
    pub fn uninitialized(root: &Path) -> Result<Self, String> {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        Ok(Self {
            worktree: Key::Worktree(root.clone()),
            repository: Key::Repository(root),
        })
    }
}

pub(crate) fn wait_for_reads(root: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let domains = Domains::resolve(root, cancel).or_else(|_| Domains::uninitialized(root))?;
    GLOBAL.wait_idle(&domains.both(), cancel)
}

#[cfg(test)]
mod tests;
