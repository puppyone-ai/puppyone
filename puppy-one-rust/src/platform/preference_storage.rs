//! Native storage adapter: ordered writes, atomic replacement, no feature imports.
use serde_json::Value;
use std::{path::PathBuf, sync::mpsc};
pub enum Event {
    Loaded(Result<Option<Value>, String>),
    Saved(u64, Result<(), String>),
}
pub struct Write {
    pub revision: u64,
    pub value: Value,
}
pub fn start() -> (mpsc::Sender<Write>, async_channel::Receiver<Event>) {
    let (tx, rx) = mpsc::channel::<Write>();
    let (events, out) = async_channel::unbounded();
    std::thread::spawn(move || {
        let base = std::env::var_os("PUPPYONE_RUST_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                    .join("Library/Application Support/PuppyOne GPUI")
            });
        let path = base.join("preferences.json");
        if events
            .send_blocking(Event::Loaded(super::ui_state_store::read(&path)))
            .is_err()
        {
            return;
        }
        while let Ok(write) = rx.recv() {
            let result = super::ui_state_store::write(&path, &write.value);
            if events
                .send_blocking(Event::Saved(write.revision, result))
                .is_err()
            {
                return;
            }
        }
    });
    (tx, out)
}
