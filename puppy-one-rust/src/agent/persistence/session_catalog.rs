//! The application stores native identities, never credentials or a second transcript authority.
use crate::{agent::domain::agent_session_model::HistoryEntry, wake::Wake};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        mpsc::{self, Receiver, SyncSender},
    },
};
#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    id: String,
    title: String,
    updated: u64,
}
struct Command {
    path: PathBuf,
    entry: Option<Entry>,
    reply: SyncSender<Result<Vec<HistoryEntry>, String>>,
    wake: Wake,
}
static WORKER: OnceLock<SyncSender<Command>> = OnceLock::new();
fn worker() -> &'static SyncSender<Command> {
    WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::sync_channel::<Command>(128);
        std::thread::spawn(move || {
            while let Ok(command) = rx.recv() {
                let result = access(&command.path, command.entry);
                let _ = command.reply.try_send(result);
                command.wake.notify();
            }
        });
        tx
    })
}
pub struct Catalog {
    path: PathBuf,
    tx: SyncSender<Result<Vec<HistoryEntry>, String>>,
    rx: Receiver<Result<Vec<HistoryEntry>, String>>,
    wake: Wake,
    last: Option<(String, String)>,
}
impl Catalog {
    pub fn new(root: &Path, runtime: &str, wake: Wake) -> Self {
        let key = blake3::hash(format!("{}\0{runtime}", root.display()).as_bytes()).to_hex();
        let base = std::env::var_os("PUPPYONE_RUST_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(std::env::temp_dir)
                    .join("Library/Application Support/PuppyOne GPUI")
            });
        let (tx, rx) = mpsc::sync_channel(16);
        Self {
            path: base.join("agent-catalog").join(format!("{key}.json")),
            tx,
            rx,
            wake,
            last: None,
        }
    }
    pub fn list(&self) {
        let _ = worker().try_send(Command {
            path: self.path.clone(),
            entry: None,
            reply: self.tx.clone(),
            wake: self.wake.clone(),
        });
    }
    pub fn remember(&mut self, id: &str, title: &str) {
        let key = (id.to_owned(), title.to_owned());
        if self.last.as_ref() == Some(&key) {
            return;
        }
        let updated = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if worker()
            .try_send(Command {
                path: self.path.clone(),
                entry: Some(Entry {
                    id: id.into(),
                    title: title.chars().take(160).collect(),
                    updated,
                }),
                reply: self.tx.clone(),
                wake: self.wake.clone(),
            })
            .is_ok()
        {
            self.last = Some(key);
        }
    }
    pub fn poll(&self) -> Option<Result<Vec<HistoryEntry>, String>> {
        let mut result = None;
        while let Ok(value) = self.rx.try_recv() {
            result = Some(value);
        }
        result
    }
}
fn access(path: &Path, entry: Option<Entry>) -> Result<Vec<HistoryEntry>, String> {
    let mut entries: Vec<Entry> = match std::fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 2 * 1024 * 1024 {
                return Err("Session catalog exceeds its limit".into());
            }
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
        Err(e) => return Err(e.to_string()),
    };
    if let Some(entry) = entry {
        entries.retain(|e| e.id != entry.id);
        entries.insert(0, entry);
        entries.truncate(2000);
        let parent = path.parent().unwrap();
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp)?;
            file.write_all(&serde_json::to_vec(&entries)?)?;
            file.sync_all()?;
            std::fs::rename(&temp, path)
        })()
        .map_err(|e: std::io::Error| e.to_string());
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        }
        result?;
    }
    entries.sort_by_key(|e| std::cmp::Reverse(e.updated));
    Ok(entries
        .into_iter()
        .map(|e| HistoryEntry {
            id: e.id,
            title: e.title,
        })
        .collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_updates_one_identity_without_a_transcript() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("catalog.json");
        access(
            &file,
            Some(Entry {
                id: "native".into(),
                title: "first".into(),
                updated: 1,
            }),
        )
        .unwrap();
        let entries = access(
            &file,
            Some(Entry {
                id: "native".into(),
                title: "renamed".into(),
                updated: 2,
            }),
        )
        .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "renamed");
        assert!(!std::fs::read_to_string(file).unwrap().contains("messages"));
    }
}
