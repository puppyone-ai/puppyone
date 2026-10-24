//! Bounded, coalesced notifications from workers to the GPUI foreground task.
//! The document controller does not own a window or depend on a UI framework.
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

#[derive(Clone)]
pub struct Wake {
    tx: async_channel::Sender<()>,
    timer: Arc<AtomicBool>,
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
                timer: Arc::new(AtomicBool::new(false)),
            },
            rx,
        )
    }
    pub fn notify(&self) {
        let _ = self.tx.try_send(());
    }
    pub fn after(&self, delay: Duration) {
        if self.tx.is_closed() || self.timer.swap(true, Ordering::AcqRel) {
            return;
        }
        let wake = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            wake.timer.store(false, Ordering::Release);
            wake.notify();
        });
    }
}
