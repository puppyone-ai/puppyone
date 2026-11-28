//! Shared native directory handles. In particular, linked worktrees retain
//! one common-dir/refs stream, and a failed stream is never reused on rearm.
use super::{CHANGED, Handle, Identity, REARM, Wake, WatchHandle};
use notify::Watcher;
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{
        Arc, LazyLock, Mutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Target {
    path: PathBuf,
    recursive: bool,
}
static WATCHES: LazyLock<Mutex<HashMap<Target, Weak<Native>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT: AtomicU64 = AtomicU64::new(1);
#[derive(Clone)]
struct Listener {
    wake: Wake,
    noise: fn(&str) -> bool,
    pending: bool,
}
#[derive(Default)]
struct Listeners {
    closing: bool,
    entries: BTreeMap<u64, Listener>,
}
struct Native {
    target: Target,
    failed: AtomicBool,
    listeners: Mutex<Listeners>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}
struct Lease {
    id: u64,
    native: Arc<Native>,
}
impl WatchHandle for Vec<Lease> {
    fn retire(&self) {
        for lease in self {
            lease.native.retire();
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let close = {
            let mut listeners = self
                .native
                .listeners
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            listeners.entries.remove(&self.id);
            if listeners.entries.is_empty() {
                listeners.closing = true;
                true
            } else {
                false
            }
        };
        if close {
            // Dispose on the owning worker, never on notify's callback thread
            // just because an in-flight weak upgrade held the final Arc.
            let watcher = self
                .native
                .watcher
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            drop(watcher);
        }
    }
}
impl Native {
    fn retire(&self) {
        if !self.failed.swap(true, Ordering::AcqRel) {
            for listener in self.listeners.lock().unwrap().entries.values() {
                listener.wake.notify(CHANGED | REARM);
            }
        }
    }
    fn add(self: &Arc<Self>, listener: Listener) -> Option<Lease> {
        let mut listeners = self.listeners.lock().unwrap();
        if listeners.closing || self.failed.load(Ordering::Acquire) {
            return None;
        }
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        listeners.entries.insert(id, listener);
        Some(Lease {
            id,
            native: self.clone(),
        })
    }
    fn event(&self, result: notify::Result<notify::Event>) {
        let Ok(event) = result else {
            self.retire();
            return;
        };
        // Read/open/close access notifications (e.g. Linux inotify when `git status`
        // reads `.git/HEAD`) are not metadata mutations and must not wake listeners.
        if matches!(event.kind, notify::EventKind::Access(_)) && !event.need_rescan() {
            return;
        }
        let listeners: Vec<_> = self
            .listeners
            .lock()
            .unwrap()
            .entries
            .values()
            .cloned()
            .collect();
        for listener in listeners {
            let relevant = event.paths.is_empty()
                || event.paths.iter().any(|path| {
                    path.strip_prefix(&self.target.path).is_ok_and(|rel| {
                        let rel = rel.to_string_lossy().replace('\\', "/");
                        if listener.pending {
                            rel.is_empty() || rel == ".git" || rel.starts_with(".git/")
                        } else {
                            !(listener.noise)(&rel)
                        }
                    })
                });
            if relevant {
                let rearm = listener.pending
                    || event.paths.is_empty()
                    || matches!(
                        event.kind,
                        notify::EventKind::Create(_)
                            | notify::EventKind::Remove(_)
                            | notify::EventKind::Modify(notify::event::ModifyKind::Name(_))
                    );
                listener
                    .wake
                    .notify(CHANGED | if rearm { REARM } else { 0 });
            }
        }
    }
}

fn subscribe(target: Target, listener: Listener) -> Result<Lease, String> {
    let mut watches = WATCHES.lock().unwrap();
    watches.retain(|_, native| native.strong_count() > 0);
    if let Some(native) = watches.get(&target).and_then(Weak::upgrade)
        && let Some(lease) = native.add(listener.clone())
    {
        return Ok(lease);
    }
    let native = Arc::new(Native {
        target: target.clone(),
        failed: AtomicBool::new(false),
        listeners: Mutex::new(Listeners::default()),
        watcher: Mutex::new(None),
    });
    let lease = native.add(listener).expect("new native handle is open");
    let weak = Arc::downgrade(&native);
    let mut watcher = notify::recommended_watcher(move |result| {
        if let Some(native) = weak.upgrade() {
            native.event(result);
        }
    })
    .map_err(|error| error.to_string())?;
    watcher
        .watch(
            &target.path,
            if target.recursive {
                notify::RecursiveMode::Recursive
            } else {
                notify::RecursiveMode::NonRecursive
            },
        )
        .map_err(|error| error.to_string())?;
    *native.watcher.lock().unwrap() = Some(watcher);
    watches.insert(target, Arc::downgrade(&native));
    Ok(lease)
}

pub(super) fn arm(
    root: &Path,
    identity: Option<&Identity>,
    noise: fn(&str) -> bool,
    wake: Wake,
) -> Result<Handle, String> {
    let mut paths = match identity {
        Some(i) => vec![i.git_dir.clone(), i.common_dir.clone()],
        None => vec![root.to_path_buf()],
    };
    paths.sort();
    paths.dedup();
    let mut targets: Vec<_> = paths
        .into_iter()
        .map(|path| Target {
            path,
            recursive: false,
        })
        .collect();
    if let Some(i) = identity {
        let refs = i.common_dir.join("refs");
        if refs.is_dir() {
            targets.push(Target {
                path: refs,
                recursive: true,
            });
        }
    }
    let mut leases = Vec::new();
    for target in targets {
        leases.push(subscribe(
            target,
            Listener {
                wake: wake.clone(),
                noise,
                pending: identity.is_none(),
            },
        )?);
    }
    Ok(Box::new(leases))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicU8, mpsc};
    fn listener(generation: u64) -> (Listener, mpsc::Receiver<super::super::Signal>) {
        let (sender, receiver) = mpsc::channel();
        (
            Listener {
                wake: Wake {
                    generation,
                    pending: Arc::new(AtomicU8::new(0)),
                    sender,
                },
                noise: |p| p.ends_with(".lock"),
                pending: false,
            },
            receiver,
        )
    }
    #[test]
    fn native_directory_leases_share_a_handle_and_last_drop_closes_it_before_arc_retirement() {
        let root = tempfile::tempdir().unwrap();
        let target = Target {
            path: root.path().canonicalize().unwrap(),
            recursive: false,
        };
        let first = subscribe(target.clone(), listener(1).0).unwrap();
        let second = subscribe(target.clone(), listener(2).0).unwrap();
        assert!(Arc::ptr_eq(&first.native, &second.native));
        let observed = first.native.clone();
        drop(first);
        assert!(observed.watcher.lock().unwrap().is_some());
        assert_eq!(observed.listeners.lock().unwrap().entries.len(), 1);
        drop(second);
        assert!(
            observed.watcher.lock().unwrap().is_none(),
            "do not defer OS cleanup to the callback thread's last Arc"
        );
        let next = subscribe(target, listener(3).0).unwrap();
        assert!(!Arc::ptr_eq(&observed, &next.native));
        assert!(next.native.watcher.lock().unwrap().is_some());
    }
    #[test]
    fn a_failed_shared_handle_wakes_all_owners_and_is_never_reused_or_removed_by_old_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let target = Target {
            path: root.path().canonicalize().unwrap(),
            recursive: false,
        };
        let (a, events_a) = listener(1);
        let (b, events_b) = listener(2);
        let first = subscribe(target.clone(), a).unwrap();
        let second = subscribe(target.clone(), b).unwrap();
        first
            .native
            .event(Err(notify::Error::generic("injected watcher failure")));
        for events in [events_a, events_b] {
            let super::super::Signal::Wake(_, pending) = events
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
            else {
                panic!("expected a rearm wake")
            };
            assert_ne!(pending.load(Ordering::Acquire) & REARM, 0);
        }
        let replacement = subscribe(target.clone(), listener(3).0).unwrap();
        assert!(!Arc::ptr_eq(&first.native, &replacement.native));
        drop(first);
        drop(second);
        let later = subscribe(target, listener(4).0).unwrap();
        assert!(
            Arc::ptr_eq(&replacement.native, &later.native),
            "old cleanup removed the replacement"
        );
    }

    #[test]
    fn reconciliation_replaces_a_silent_shared_handle_while_other_owners_still_hold_it() {
        use super::super::{RECONCILE, Worker, identity};
        use std::time::Instant;
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        crate::platform::git::git(
            &root,
            &["init", "-q", "-b", "main"],
            None,
            &AtomicBool::new(false),
        )
        .unwrap();
        let target = Target {
            path: root.join(".git"),
            recursive: false,
        };
        let (other, events) = listener(99);
        let retained = subscribe(target.clone(), other).unwrap();
        let (sender, _receiver) = mpsc::channel();
        let now = Instant::now();
        let mut worker = Worker::new(
            root.clone(),
            |_| false,
            sender,
            Arc::new(arm),
            Arc::new(identity),
            now,
        );
        worker.install(now);
        worker.last = worker.read();
        let count = retained.native.listeners.lock().unwrap().entries.len();
        assert_eq!(count, 2);
        // No queued OS notification is consumed: this path must repair a
        // silently dead shared stream through metadata reconciliation alone.
        std::fs::write(root.join(".git/HEAD"), "ref: refs/heads/renamed\n").unwrap();
        worker.tick(now + RECONCILE, &|| {});
        assert!(retained.native.failed.load(Ordering::Acquire));
        assert!(
            events
                .recv_timeout(std::time::Duration::from_secs(5))
                .is_ok()
        );
        let replacement = subscribe(target, listener(100).0).unwrap();
        assert!(!Arc::ptr_eq(&retained.native, &replacement.native));
        assert_eq!(
            replacement.native.listeners.lock().unwrap().entries.len(),
            2
        );
        drop(retained);
        assert!(replacement.native.watcher.lock().unwrap().is_some());
    }

    #[test]
    fn access_only_notifications_do_not_wake_metadata_listeners() {
        let root = tempfile::tempdir().unwrap();
        let target = Target {
            path: root.path().canonicalize().unwrap(),
            recursive: false,
        };
        let (sub, events) = listener(1);
        let lease = subscribe(target.clone(), sub).unwrap();
        lease.native.event(Ok(notify::Event {
            kind: notify::EventKind::Access(notify::event::AccessKind::Open(
                notify::event::AccessMode::Any,
            )),
            paths: vec![target.path.join("HEAD")],
            attrs: Default::default(),
        }));
        assert!(events.try_recv().is_err());
        lease.native.event(Ok(notify::Event {
            kind: notify::EventKind::Modify(notify::event::ModifyKind::Data(
                notify::event::DataChange::Content,
            )),
            paths: vec![target.path.join("HEAD")],
            attrs: Default::default(),
        }));
        assert!(
            events
                .recv_timeout(std::time::Duration::from_secs(5))
                .is_ok()
        );
    }
}
