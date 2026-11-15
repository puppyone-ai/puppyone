//! Bounded, coalesced notifications from workers to the GPUI foreground task.
//! The document controller does not own a window or depend on a UI framework.
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Timer {
    due: Option<Instant>,
    running: bool,
}

#[derive(Clone)]
pub struct Wake {
    tx: async_channel::Sender<()>,
    timer: Arc<(Mutex<Timer>, Condvar)>,
}
impl Default for Wake {
    fn default() -> Self {
        Self::channel().0
    }
}
impl Wake {
    pub fn channel() -> (Self, async_channel::Receiver<()>) {
        let (tx, rx) = async_channel::bounded(1);
        (
            Self {
                tx,
                timer: Default::default(),
            },
            rx,
        )
    }
    pub fn notify(&self) {
        let _ = self.tx.try_send(());
    }
    pub fn after(&self, delay: Duration) {
        if self.tx.is_closed() {
            return;
        }
        let mut timer = self.timer.0.lock().unwrap();
        let due = Instant::now() + delay;
        if timer.due.is_some_and(|current| current <= due) {
            return;
        }
        timer.due = Some(due);
        if timer.running {
            self.timer.1.notify_one();
            return;
        }
        timer.running = true;
        drop(timer);
        let wake = self.clone();
        std::thread::spawn(move || {
            let mut timer = wake.timer.0.lock().unwrap();
            while let Some(due) = timer.due {
                let delay = due.saturating_duration_since(Instant::now());
                if delay.is_zero() || wake.tx.is_closed() {
                    break;
                }
                timer = wake.timer.1.wait_timeout(timer, delay).unwrap().0;
            }
            timer.due = None;
            timer.running = false;
            drop(timer);
            wake.notify();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_earlier_document_deadline_preempts_a_later_window_timer() {
        let (wake, rx) = Wake::channel();
        wake.after(Duration::from_secs(10));
        let start = Instant::now();
        wake.after(Duration::from_millis(5));
        wake.after(Duration::from_secs(10));
        let deadline = start + Duration::from_secs(2);
        while rx.try_recv().is_err() {
            assert!(Instant::now() < deadline, "an earlier deadline was lost");
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}
