//! The Electron product's user data, read once for a first launch (PL-3):
//! the main process's `desktop-workspace-state.json` (recent Projects, the
//! last active one) and `desktop-locale-preference.json`, and the
//! renderer's `localStorage` — Chromium's LevelDB, read from a private copy
//! because the running app holds its lock. Credentials (Keychain items,
//! cookies, session storage) are never read; the two apps keep separate
//! data directories and Keychain services, so both can run side by side.
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

/// One remembered Project (`recentWorkspaces`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recent {
    pub path: PathBuf,
    pub name: String,
    /// Seconds since the Unix epoch.
    pub opened_at: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ElectronData {
    /// Most recent first, the last active Project leading.
    pub recent: Vec<Recent>,
    /// `desktop-locale-preference.json` `language` (`system` or a locale).
    pub language: Option<String>,
    /// The app origin's `localStorage`, key → value.
    pub storage: BTreeMap<String, String>,
}
impl ElectronData {
    pub fn is_empty(&self) -> bool {
        self.recent.is_empty() && self.language.is_none() && self.storage.is_empty()
    }
}

/// The stable product's data directory, or `PUPPYONE_ELECTRON_DATA_DIR`.
pub fn default_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("PUPPYONE_ELECTRON_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Application Support/PuppyOne"))
}

/// Everything importable under `dir`; `None` when it holds no product data.
pub fn read(dir: &Path) -> Option<ElectronData> {
    if !dir.is_dir() {
        return None;
    }
    let data = ElectronData {
        recent: workspace_state(&dir.join("desktop-workspace-state.json")),
        language: json(&dir.join("desktop-locale-preference.json"))
            .and_then(|v| v.get("language")?.as_str().map(str::to_owned)),
        storage: local_storage(&dir.join("Local Storage/leveldb")),
    };
    (!data.is_empty()).then_some(data)
}

/// Small JSON files only (the product's own state is a few kilobytes).
fn json(path: &Path) -> Option<serde_json::Value> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 1024 * 1024 {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

/// `recentWorkspaces` in their order, the last active Project first.
fn workspace_state(path: &Path) -> Vec<Recent> {
    let Some(state) = json(path) else {
        return vec![];
    };
    let mut recent: Vec<Recent> = state
        .get("recentWorkspaces")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let path = PathBuf::from(entry.get("path")?.as_str()?);
            let name = entry
                .get("name")
                .and_then(|n| n.as_str())
                .map(str::to_owned)
                .or_else(|| path.file_name().map(|n| n.to_string_lossy().into_owned()))?;
            let opened_at = entry
                .get("lastOpenedAt")
                .and_then(|d| d.as_str())
                .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
                .map_or(0, |d| d.timestamp().max(0) as u64);
            Some(Recent {
                path,
                name,
                opened_at,
            })
        })
        .collect();
    // Older state files carry only the path list.
    if recent.is_empty() {
        recent = state
            .get("recentWorkspacePaths")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|p| p.as_str())
            .map(|p| {
                let path = PathBuf::from(p);
                Recent {
                    name: path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    path,
                    opened_at: 0,
                }
            })
            .collect();
    }
    if let Some(last) = state
        .get("lastActiveWorkspacePath")
        .and_then(|v| v.as_str())
        && let Some(index) = recent.iter().position(|r| r.path == Path::new(last))
    {
        let last = recent.remove(index);
        recent.insert(0, last);
    }
    recent
}

/// Chromium's DOM Storage keys: `_<origin>\0<key>`, values and keys
/// prefixed by their encoding (1 = Latin-1, 0 = UTF-16LE).
fn local_storage(dir: &Path) -> BTreeMap<String, String> {
    let Ok(copy) = tempfile::tempdir() else {
        return BTreeMap::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return BTreeMap::new();
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        // The running app's lock stays with it.
        if name == "LOCK" || !entry.path().is_file() {
            continue;
        }
        if std::fs::copy(entry.path(), copy.path().join(&name)).is_err() {
            return BTreeMap::new();
        }
    }
    let options = rusty_leveldb::Options {
        create_if_missing: false,
        ..Default::default()
    };
    let Ok(mut db) = rusty_leveldb::DB::open(copy.path(), options) else {
        return BTreeMap::new();
    };
    let Ok(mut iter) = db.new_iter() else {
        return BTreeMap::new();
    };
    let mut out = BTreeMap::new();
    use rusty_leveldb::LdbIterator as _;
    while let Some((key, value)) = iter.next() {
        if let (Some(key), Some(value)) = (storage_key(&key), decode(&value)) {
            out.insert(key, value);
        }
    }
    out
}

/// The app's own origin (`file://`); other origins' storage is not ours.
fn storage_key(raw: &[u8]) -> Option<String> {
    let rest = raw.strip_prefix(b"_file://\0")?;
    decode(rest)
}

fn decode(raw: &[u8]) -> Option<String> {
    match raw.split_first()? {
        (1, latin1) => Some(latin1.iter().map(|b| *b as char).collect()),
        (0, utf16) if utf16.len() % 2 == 0 => {
            let units: Vec<u16> = utf16
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16(&units).ok()
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn dom_storage_keys_and_values_decode_both_encodings() {
        assert_eq!(
            storage_key(b"_file://\0\x01puppyone.desktop.explorerWidth").as_deref(),
            Some("puppyone.desktop.explorerWidth")
        );
        assert_eq!(storage_key(b"_https://example.com\0\x01x"), None);
        assert_eq!(storage_key(b"META:file://"), None);
        assert_eq!(decode(b"\x01true").as_deref(), Some("true"));
        let utf16: Vec<u8> = std::iter::once(0)
            .chain("中文".encode_utf16().flat_map(|u| u.to_le_bytes()))
            .collect();
        assert_eq!(decode(&utf16).as_deref(), Some("中文"));
        assert_eq!(decode(b"\x00\x01"), None);
    }

    #[test]
    fn the_product_data_directory_is_read_without_its_lock() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("desktop-workspace-state.json"),
            r#"{"version":7,"lastActiveWorkspacePath":"/p/b",
               "recentWorkspaces":[
                 {"path":"/p/a","name":"A","lastOpenedAt":"2026-10-29T13:08:51.265Z"},
                 {"path":"/p/b","name":"B","lastOpenedAt":"2026-10-28T00:00:00Z"}]}"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("desktop-locale-preference.json"),
            r#"{"version":1,"language":"zh-Hans"}"#,
        )
        .unwrap();
        // A real Chromium-format LevelDB with the product's keys.
        let ldb = dir.path().join("Local Storage/leveldb");
        std::fs::create_dir_all(&ldb).unwrap();
        {
            let mut db = rusty_leveldb::DB::open(&ldb, rusty_leveldb::Options::default()).unwrap();
            db.put(
                b"_file://\0\x01puppyone.desktop.sidebarCollapsed",
                b"\x01true",
            )
            .unwrap();
            db.put(b"_https://other\0\x01secret", b"\x01no").unwrap();
            db.flush().unwrap();
        }
        // The running app's lock does not stop the import.
        std::fs::write(ldb.join("LOCK"), b"").unwrap();
        let data = read(dir.path()).unwrap();
        assert_eq!(
            data.recent
                .iter()
                .map(|r| r.name.as_str())
                .collect::<Vec<_>>(),
            ["B", "A"]
        );
        assert_eq!(data.recent[1].opened_at, 1_793_279_331);
        assert_eq!(data.language.as_deref(), Some("zh-Hans"));
        assert_eq!(
            data.storage
                .get("puppyone.desktop.sidebarCollapsed")
                .map(String::as_str),
            Some("true")
        );
        assert_eq!(data.storage.len(), 1);
        assert!(read(&dir.path().join("absent")).is_none());
    }
}
