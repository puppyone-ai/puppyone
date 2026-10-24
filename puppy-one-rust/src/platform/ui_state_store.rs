//! Asynchronous, bounded UI metadata storage. Never stores executable command lines or credentials.
use crate::wake::Wake;
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        mpsc::{self, SyncSender},
    },
};
pub enum ResultEvent {
    Loaded(PathBuf, Result<Option<Value>, String>),
    Saved(PathBuf, Result<(), String>),
}
struct WriteCommand {
    root: PathBuf,
    value: Value,
    reply: SyncSender<ResultEvent>,
    wake: Wake,
}
static WORKER: OnceLock<SyncSender<WriteCommand>> = OnceLock::new();
fn path(root: &Path) -> PathBuf {
    let base = std::env::var_os("PUPPYONE_RUST_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Library/Application Support/PuppyOne GPUI")
        });
    base.join("workbench").join(format!(
        "{}.json",
        blake3::hash(root.to_string_lossy().as_bytes()).to_hex()
    ))
}
pub fn load(root: PathBuf, reply: SyncSender<ResultEvent>, wake: Wake) {
    std::thread::spawn(move || {
        let result = read(&path(&root));
        let _ = reply.send(ResultEvent::Loaded(root, result));
        wake.notify();
    });
}
pub fn save(root: PathBuf, value: Value, reply: SyncSender<ResultEvent>, wake: Wake) -> bool {
    WORKER
        .get_or_init(|| {
            let (tx, rx) = mpsc::sync_channel::<WriteCommand>(64);
            std::thread::spawn(move || {
                while let Ok(c) = rx.recv() {
                    let result = write(&path(&c.root), &c.value);
                    let _ = c.reply.try_send(ResultEvent::Saved(c.root, result));
                    c.wake.notify();
                }
            });
            tx
        })
        .try_send(WriteCommand {
            root,
            value,
            reply,
            wake,
        })
        .is_ok()
}
pub(super) fn read(path: &Path) -> Result<Option<Value>, String> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut bytes = vec![];
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("Workbench state exceeds its limit".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| e.to_string())
}
pub(super) fn write(path: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("Workbench state exceeds its limit".into());
    }
    let parent = path.parent().ok_or("Missing state directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut f = options.open(&temp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result.map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn state_roundtrip_and_oversize_rejection() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("state.json");
        let value = serde_json::json!({"version":1,"tabs":[]});
        write(&p, &value).unwrap();
        assert_eq!(read(&p).unwrap(), Some(value));
        assert!(write(&p, &Value::String("a".repeat(1024 * 1024))).is_err());
    }
}
