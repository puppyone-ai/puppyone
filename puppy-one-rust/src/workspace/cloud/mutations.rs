//! Resource-scoped write ordering (`cloudWriteQueue`): ancestors conflict,
//! siblings do not. Waiting operations keep their order on overlapping paths.
use crate::workspace::contracts::{RelativePath, Result};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

#[derive(Default)]
pub(super) struct Mutations {
    state: Mutex<State>,
    changed: Condvar,
}
#[derive(Default)]
struct State {
    next: u64,
    queue: Vec<(u64, Vec<RelativePath>)>,
}
pub(super) struct Lease<'a> {
    owner: &'a Mutations,
    id: u64,
}
fn overlaps(a: &[RelativePath], b: &[RelativePath]) -> bool {
    a.iter().any(|a| {
        b.iter()
            .any(|b| a.as_path().starts_with(b.as_path()) || b.as_path().starts_with(a.as_path()))
    })
}
impl Mutations {
    pub fn acquire(
        &self,
        paths: &[&RelativePath],
        mut authorized: impl FnMut() -> Result<()>,
    ) -> Result<Lease<'_>> {
        authorized()?;
        let paths = paths.iter().map(|p| (*p).clone()).collect::<Vec<_>>();
        let mut state = self.state.lock().unwrap();
        state.next += 1;
        let id = state.next;
        state.queue.push((id, paths.clone()));
        loop {
            if let Err(error) = authorized() {
                state.queue.retain(|(ticket, _)| *ticket != id);
                self.changed.notify_all();
                return Err(error);
            }
            if !state
                .queue
                .iter()
                .take_while(|(ticket, _)| *ticket != id)
                .any(|(_, earlier)| overlaps(earlier, &paths))
            {
                return Ok(Lease { owner: self, id });
            }
            // Authority can be revoked without a write completing.
            state = self
                .changed
                .wait_timeout(state, Duration::from_millis(50))
                .unwrap()
                .0;
        }
    }
}
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        self.owner
            .state
            .lock()
            .unwrap()
            .queue
            .retain(|(id, _)| *id != self.id);
        self.owner.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::contracts::{Error, ErrorKind};
    use std::{
        path::Path,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
    };
    fn path(p: &str) -> RelativePath {
        RelativePath::new(Path::new(p)).unwrap()
    }

    #[test]
    fn a_slow_save_does_not_block_creating_an_unrelated_file() {
        let q = Arc::new(Mutations::default());
        let a = path("notes.md");
        let b = path("docs/new.md");
        let saving = q.acquire(&[&a], || Ok(())).unwrap();
        let next = q.clone();
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let _creating = next.acquire(&[&b], || Ok(())).unwrap();
            let _ = tx.send(());
        });
        let completed = rx.recv_timeout(Duration::from_secs(2));
        drop(saving);
        thread.join().unwrap();
        completed.expect("an unrelated creation waited for the slow save");
    }

    #[test]
    fn file_folder_and_move_destination_scopes_overlap_only_at_path_boundaries() {
        for (a, b, expected) in [
            ("docs", "docs/a.md", true),
            ("a.md", "a.md", true),
            ("", "docs/a.md", true),
            ("docs", "docs2/a.md", false),
            ("docs/a.md", "docs/b.md", false),
        ] {
            assert_eq!(overlaps(&[path(a)], &[path(b)]), expected, "{a} / {b}");
        }
        assert!(overlaps(
            &[path("a.md"), path("other/b.md")],
            &[path("other")]
        ));
    }

    #[test]
    fn a_rename_waits_for_its_save_and_a_folder_delete_waits_for_its_child() {
        for (first, second) in [("a.md", "a.md"), ("docs/a.md", "docs")] {
            let q = Arc::new(Mutations::default());
            let saving = q.acquire(&[&path(first)], || Ok(())).unwrap();
            let (tx, rx) = mpsc::channel();
            let next = q.clone();
            let thread = std::thread::spawn(move || {
                let _lease = next.acquire(&[&path(second)], || Ok(())).unwrap();
                tx.send(()).unwrap();
            });
            assert!(rx.recv_timeout(Duration::from_millis(80)).is_err());
            drop(saving);
            rx.recv_timeout(Duration::from_secs(2)).unwrap();
            thread.join().unwrap();
        }
    }

    #[test]
    fn revoked_waiters_leave_the_queue_without_dispatching_or_blocking_followers() {
        let q = Arc::new(Mutations::default());
        let saving = q.acquire(&[&path("a.md")], || Ok(())).unwrap();
        let revoked = Arc::new(AtomicBool::new(false));
        let next = q.clone();
        let flag = revoked.clone();
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let result = next.acquire(&[&path("a.md")], || {
                if flag.load(Ordering::Acquire) {
                    Err(Error::new(ErrorKind::StaleLease, "revoked"))
                } else {
                    Ok(())
                }
            });
            tx.send(result.err().map(|e| e.kind)).unwrap();
        });
        revoked.store(true, Ordering::Release);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            Some(ErrorKind::StaleLease)
        );
        thread.join().unwrap();
        drop(saving);
        let _later = q.acquire(&[&path("a.md")], || Ok(())).unwrap();
    }
}
