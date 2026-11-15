//! Keep capacity until an uninterruptible filesystem call actually finishes,
//! even when its caller already timed out or released the last view.
use super::{Presence, session::Values};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

#[derive(Default)]
pub(super) struct Port {
    pending: Arc<AtomicUsize>,
}
struct Permit(Arc<AtomicUsize>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
impl Port {
    pub(super) fn inspect(
        &self,
        platform: &str,
        identities: &[(&'static str, &'static str)],
        cancel: &AtomicBool,
        timeout: Duration,
        work: impl FnOnce(Arc<AtomicBool>) -> Values + Send + 'static,
    ) -> Values {
        let observations = |presence| identities.iter().map(|(id, _)| (*id, presence)).collect();
        if platform != "darwin" {
            return observations(Presence::Unsupported);
        }
        if cancel.load(Ordering::Relaxed)
            || self
                .pending
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |pending| {
                    (pending < 2).then_some(pending + 1)
                })
                .is_err()
        {
            return observations(Presence::Unknown);
        }
        let permit = Permit(self.pending.clone());
        let signal = Arc::new(AtomicBool::new(false));
        let worker_signal = signal.clone();
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("companion-metadata".into())
            .spawn(move || {
                let values = work(worker_signal);
                drop(permit);
                let _ = tx.send(values);
            });
        if worker.is_err() {
            return observations(Presence::Unknown);
        }
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
                signal.store(true, Ordering::Relaxed);
                return observations(Presence::Unknown);
            }
            match rx.recv_timeout(
                deadline
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_millis(10)),
            ) {
                Ok(values) => {
                    return if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
                        observations(Presence::Unknown)
                    } else {
                        values
                    };
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return observations(Presence::Unknown);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn unsupported_and_precancelled_scans_never_start_filesystem_work() {
        let port = Port::default();
        let identities = super::super::identities();
        for platform in ["linux", "win32", "unsupported"] {
            let results = port.inspect(
                platform,
                &identities,
                &AtomicBool::new(false),
                Duration::from_secs(3),
                |_| panic!("no filesystem access"),
            );
            assert_eq!(results.len(), identities.len());
            assert!(
                results
                    .iter()
                    .all(|(_, status)| *status == Presence::Unsupported)
            );
        }
        let results = port.inspect(
            "darwin",
            &identities,
            &AtomicBool::new(true),
            Duration::from_secs(3),
            |_| panic!("cancelled before IO"),
        );
        assert!(
            results
                .iter()
                .all(|(_, status)| *status == Presence::Unknown)
        );
        assert_eq!(port.pending.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn timed_out_io_retains_both_slots_until_underlying_calls_finish() {
        let port = Port::default();
        let identities = super::super::identities();
        let mut releases = vec![];
        let calls = Arc::new(AtomicUsize::new(0));
        for _ in 0..2 {
            let (tx, rx) = mpsc::channel();
            releases.push(tx);
            let calls = calls.clone();
            let result = port.inspect(
                "darwin",
                &identities,
                &AtomicBool::new(false),
                Duration::from_millis(5),
                move |signal| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    rx.recv().unwrap();
                    assert!(signal.load(Ordering::Relaxed));
                    vec![("codex", Presence::Present)]
                },
            );
            assert!(
                result
                    .iter()
                    .all(|(_, status)| *status == Presence::Unknown)
            );
        }
        assert_eq!(port.pending.load(Ordering::SeqCst), 2);
        let result = port.inspect(
            "darwin",
            &identities,
            &AtomicBool::new(false),
            Duration::from_secs(3),
            |_| panic!("timed-out work still occupies capacity"),
        );
        assert!(
            result
                .iter()
                .all(|(_, status)| *status == Presence::Unknown)
        );
        for tx in releases {
            tx.send(()).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while port.pending.load(Ordering::SeqCst) != 0 {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            port.inspect(
                "darwin",
                &identities,
                &AtomicBool::new(false),
                Duration::from_secs(3),
                |_| vec![("codex", Presence::Present)]
            ),
            vec![("codex", Presence::Present)]
        );
    }
    #[test]
    fn cancelling_an_active_call_returns_unknown_without_releasing_its_io_slot_early() {
        let port = Arc::new(Port::default());
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_port = port.clone();
        let worker_cancel = cancel.clone();
        let (entered, ready) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let caller = std::thread::spawn(move || {
            worker_port.inspect(
                "darwin",
                &super::super::identities(),
                &worker_cancel,
                Duration::from_secs(10),
                move |signal| {
                    entered.send(signal).unwrap();
                    gate.recv().unwrap();
                    vec![("codex", Presence::Present)]
                },
            )
        });
        let signal = ready.recv_timeout(Duration::from_secs(3)).unwrap();
        cancel.store(true, Ordering::SeqCst);
        assert!(
            caller
                .join()
                .unwrap()
                .iter()
                .all(|(_, status)| *status == Presence::Unknown)
        );
        assert!(signal.load(Ordering::Relaxed));
        assert_eq!(port.pending.load(Ordering::SeqCst), 1);
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while port.pending.load(Ordering::SeqCst) != 0 {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
