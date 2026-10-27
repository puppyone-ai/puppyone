//! Native Editor metadata namespace, independent of terminal layout and document
//! durability. Bounded asynchronous commands, using the shared atomic JSON store.
use crate::wake::Wake;
use serde_json::Value;
use std::{path::PathBuf, sync::mpsc};

enum Command {
    Load(String, Wake),
    Save(String, Value, Wake),
}
pub enum Event {
    Loaded(String, Option<Value>),
    Saved,
}
pub struct Storage {
    tx: mpsc::SyncSender<Command>,
    rx: mpsc::Receiver<Event>,
}
impl Storage {
    pub fn native() -> Self {
        let base = std::env::var_os("PUPPYONE_RUST_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                    .join("Library/Application Support/PuppyOne GPUI")
            });
        Self::at(base.join("editor-workbench"))
    }
    pub fn at(base: PathBuf) -> Self {
        let (tx, commands) = mpsc::sync_channel(64);
        let (events, rx) = mpsc::channel();
        std::thread::spawn(move || {
            while let Ok(command) = commands.recv() {
                let (key, wake) = match &command {
                    Command::Load(key, wake) | Command::Save(key, _, wake) => (key, wake),
                };
                let path = base.join(format!("{}.json", blake3::hash(key.as_bytes()).to_hex()));
                let event = match &command {
                    Command::Load(key, _) => Event::Loaded(
                        key.clone(),
                        super::ui_state_store::read(&path).ok().flatten(),
                    ),
                    Command::Save(_, value, _) => {
                        let _ = super::ui_state_store::write(&path, value);
                        Event::Saved
                    }
                };
                if events.send(event).is_err() {
                    break;
                }
                wake.notify();
            }
        });
        Self { tx, rx }
    }
    pub fn load(&self, key: String, wake: &Wake) -> bool {
        self.tx.try_send(Command::Load(key, wake.clone())).is_ok()
    }
    pub fn save(&self, key: String, value: Value, wake: &Wake) -> bool {
        self.tx
            .try_send(Command::Save(key, value, wake.clone()))
            .is_ok()
    }
    pub fn next(&self) -> Option<Event> {
        self.rx.try_recv().ok()
    }
}
