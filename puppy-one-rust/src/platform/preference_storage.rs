//! Native storage adapter: ordered writes, atomic replacement, no feature imports.
use serde_json::Value;
use std::{path::PathBuf, sync::mpsc};
pub enum Event {
    Loaded(Result<Option<Value>, String>),
    /// No native preferences yet: what the Electron product left, if this
    /// is the real data directory and it left anything (PL-3).
    Fresh(Option<super::electron_import::ElectronData>),
    Saved(u64, Result<(), String>),
}
pub struct Write {
    pub revision: u64,
    pub value: Value,
}
pub fn start() -> (mpsc::Sender<Write>, async_channel::Receiver<Event>) {
    spawn(None)
}
/// Isolated preferences directory; never imports another application profile.
pub fn start_at(directory: PathBuf) -> (mpsc::Sender<Write>, async_channel::Receiver<Event>) {
    spawn(Some(directory))
}
fn spawn(directory: Option<PathBuf>) -> (mpsc::Sender<Write>, async_channel::Receiver<Event>) {
    let (tx, rx) = mpsc::channel::<Write>();
    let (events, out) = async_channel::unbounded();
    std::thread::spawn(move || {
        let explicit = directory.is_some();
        let isolated =
            directory.or_else(|| std::env::var_os("PUPPYONE_RUST_DATA_DIR").map(PathBuf::from));
        let base = isolated.clone().unwrap_or_else(super::data_dir);
        let path = base.join("preferences.json");
        let loaded = match super::ui_state_store::read(&path) {
            // An isolated data directory (tests, captures) imports only from
            // an explicitly named product directory.
            Ok(None) => Event::Fresh(
                (!explicit
                    && (isolated.is_none()
                        || std::env::var_os("PUPPYONE_ELECTRON_DATA_DIR").is_some()))
                .then(super::electron_import::default_dir)
                .flatten()
                .and_then(|dir| super::electron_import::read(&dir)),
            ),
            Err(error) => {
                quarantine(&path);
                Event::Loaded(Err(error))
            }
            other => Event::Loaded(other),
        };
        if events.send_blocking(loaded).is_err() {
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
/// `quarantineCorruptRegistry`: preferences that cannot be read are kept
/// beside the file, as `preferences.json.corrupt.<time>`, so the next save
/// cannot destroy them.
fn quarantine(path: &std::path::Path) {
    if !std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file()) {
        return;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let mut kept = path.as_os_str().to_owned();
    kept.push(format!(".corrupt.{stamp}"));
    let _ = std::fs::rename(path, kept);
}
