//! One linearization point decides whether cancellation or publication wins.
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU8, Ordering},
};
const ACTIVE: u8 = 0;
const PUBLISHING: u8 = 1;
const FINISHED: u8 = 2;
const CANCELLED: u8 = 3;

pub struct Publication {
    cancelled: Arc<AtomicBool>,
    phase: AtomicU8,
    changed: async_channel::Sender<()>,
}
impl Publication {
    pub fn new(cancelled: Arc<AtomicBool>) -> (Self, async_channel::Receiver<()>) {
        let (changed, events) = async_channel::bounded(1);
        (
            Self {
                cancelled,
                phase: AtomicU8::new(ACTIVE),
                changed,
            },
            events,
        )
    }
    pub fn publishing(&self) -> bool {
        self.phase.load(Ordering::Acquire) == PUBLISHING
    }
    pub(super) fn cancellation(&self) -> &AtomicBool {
        &self.cancelled
    }
    /// False means publication already owns the boundary; callers must keep
    /// the dialog and wait for its result instead of claiming cancellation.
    pub fn cancel(&self) -> bool {
        loop {
            let phase = self.phase.load(Ordering::Acquire);
            if phase == PUBLISHING {
                return false;
            }
            if phase == CANCELLED
                || self
                    .phase
                    .compare_exchange(phase, CANCELLED, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                self.cancelled.store(true, Ordering::Release);
                let _ = self.changed.try_send(());
                return true;
            }
        }
    }
    /// Run the indivisible publication step after winning against cancellation.
    /// The guard also restores the phase and notifies the UI on an error/panic.
    pub fn commit<T>(&self, operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        if self.cancelled.load(Ordering::Acquire)
            || self
                .phase
                .compare_exchange(ACTIVE, PUBLISHING, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return Err("Repository cloning was cancelled.".into());
        }
        struct Finish<'a>(&'a Publication);
        impl Drop for Finish<'_> {
            fn drop(&mut self) {
                self.0.phase.store(FINISHED, Ordering::Release);
                let _ = self.0.changed.try_send(());
            }
        }
        let _finish = Finish(self);
        let _ = self.changed.try_send(());
        operation()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Barrier, mpsc};
    #[test]
    fn cancellation_and_real_directory_publication_have_one_winner() {
        for _ in 0..32 {
            let directory = tempfile::tempdir().unwrap();
            let staging = directory.path().join("staging");
            let destination = directory.path().join("published");
            std::fs::create_dir(&staging).unwrap();
            std::fs::write(staging.join("note.md"), "complete").unwrap();
            let (control, _events) = Publication::new(Arc::new(AtomicBool::new(false)));
            let control = Arc::new(control);
            let barrier = Arc::new(Barrier::new(3));
            let (answered, answer) = mpsc::channel();
            let cancel = {
                let control = control.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let accepted = control.cancel();
                    let _ = answered.send(accepted);
                    accepted
                })
            };
            let publish = {
                let control = control.clone();
                let barrier = barrier.clone();
                let staging = staging.clone();
                let destination = destination.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    control.commit(|| {
                        // Keep the publication boundary owned until the competing
                        // cancellation responds, without a timing assumption.
                        assert!(
                            !answer
                                .recv_timeout(std::time::Duration::from_secs(5))
                                .unwrap()
                        );
                        crate::platform::templates::publish(&staging, &destination)
                            .map_err(|e| e.to_string())
                    })
                })
            };
            barrier.wait();
            let cancelled = cancel.join().unwrap();
            let result = publish.join().unwrap();
            if cancelled {
                assert!(result.is_err());
                assert!(!destination.exists());
                assert!(staging.join("note.md").exists());
            } else {
                result.unwrap();
                assert!(!staging.exists());
                assert_eq!(
                    std::fs::read_to_string(destination.join("note.md")).unwrap(),
                    "complete"
                );
            }
            assert!(!control.publishing());
        }
    }
    #[test]
    fn publication_errors_restore_cancellation_and_precancellation_never_runs_the_operation() {
        let (control, events) = Publication::new(Arc::new(AtomicBool::new(false)));
        assert_eq!(
            control.commit::<()>(|| Err("destination occupied".into())),
            Err("destination occupied".into())
        );
        assert!(!control.publishing());
        assert!(events.try_recv().is_ok());
        assert!(control.cancel());
        assert!(
            control
                .commit::<()>(|| panic!("retired publication ran twice"))
                .is_err()
        );
        let cancelled = Arc::new(AtomicBool::new(true));
        let (control, _) = Publication::new(cancelled);
        assert!(
            control
                .commit::<()>(|| panic!("pre-cancelled publication ran"))
                .is_err()
        );
    }
}
