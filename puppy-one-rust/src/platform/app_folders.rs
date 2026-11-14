//! `createAppFolderDiscovery` (`project-import/app-folders.mjs`): folders
//! other apps already know about. Each app is asked only through the file
//! where it records its own vaults or recent folders; nothing is scanned. A
//! folder is offered only while it still exists, at most 50 per app.
use std::path::{Path, PathBuf};

const MAX_FOLDERS_PER_APP: usize = 50;
/// The apps whose recorded folders can be listed on the Homepage in place.
pub const APPS: [&str; 4] = ["obsidian", "vscode", "cursor", "typora"];

/// `WorkspaceAppFolder`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppFolder {
    pub path: PathBuf,
    pub name: String,
    /// When the app last used it (milliseconds), where it records that.
    pub last_used_at: Option<u64>,
}

/// Where the apps keep their records.
#[derive(Clone, Debug)]
pub struct Places {
    pub home: PathBuf,
    /// The platform's per-user application data folder.
    pub app_data: PathBuf,
}
impl Places {
    pub fn native() -> Self {
        let home = super::paths::home_dir();
        let app_data = if cfg!(target_os = "macos") {
            home.join("Library/Application Support")
        } else if cfg!(target_os = "windows") {
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData/Roaming"))
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
        };
        Self { home, app_data }
    }
}

/// `list(app)`: the app's recorded folders that are still folders, newest
/// first where the app says. An app that is not installed, or has never
/// opened a folder, has nothing to offer; a record that cannot be read is
/// an error, so it can be told apart and tried again.
pub fn list(app: &str, places: &Places) -> Result<Vec<AppFolder>, String> {
    let candidates = match app {
        "obsidian" => obsidian(places),
        "vscode" => vscode_history(&places.app_data.join("Code")),
        "cursor" => vscode_history(&places.app_data.join("Cursor")),
        "typora" => typora(places),
        _ => return Err("This app is not a known folder source.".into()),
    };
    let candidates = match candidates {
        Err(Read::Missing) => return Ok(vec![]),
        Err(Read::Failed(error)) => return Err(error),
        Ok(candidates) => candidates,
    };
    let mut folders = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (path, last_used_at) in candidates {
        if folders.len() >= MAX_FOLDERS_PER_APP {
            break;
        }
        if path.contains('\0') || !Path::new(&path).is_absolute() {
            continue;
        }
        let path = super::paths::normalize(Path::new(&path));
        if !seen.insert(path.clone()) || !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        folders.push(AppFolder {
            path,
            name,
            last_used_at,
        });
    }
    Ok(folders)
}

/// Why a record gave nothing.
enum Read {
    /// The app is not installed or has no record (`ENOENT`, `ENOTDIR`).
    Missing,
    Failed(String),
}
type Candidates = Result<Vec<(String, Option<u64>)>, Read>;

fn read_file(path: &Path) -> Result<String, Read> {
    std::fs::read_to_string(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => Read::Missing,
        _ => Read::Failed(e.to_string()),
    })
}
fn json(text: &str) -> Result<serde_json::Value, Read> {
    serde_json::from_str(text).map_err(|e| Read::Failed(e.to_string()))
}

/// `obsidian/obsidian.json`: every vault, most recently opened first.
fn obsidian(places: &Places) -> Candidates {
    let registry = json(&read_file(&places.app_data.join("obsidian/obsidian.json"))?)?;
    let mut vaults: Vec<(String, Option<u64>)> = registry["vaults"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, vault)| {
            let path = vault["path"].as_str()?.to_owned();
            Some((path, vault["ts"].as_u64()))
        })
        .collect();
    vaults.sort_by_key(|(_, ts)| std::cmp::Reverse(ts.unwrap_or(0)));
    Ok(vaults)
}

/// VS Code and Cursor: `history.recentlyOpenedPathsList` in their state
/// database, newest first. Remote folders and single files are not local
/// projects.
fn vscode_history(product: &Path) -> Candidates {
    let database = product.join("User/globalStorage/state.vscdb");
    if !database.is_file() {
        return Err(Read::Missing);
    }
    let connection = rusqlite::Connection::open_with_flags(
        &database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| Read::Failed(e.to_string()))?;
    let value: Option<String> = connection
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?",
            ["history.recentlyOpenedPathsList"],
            |row| {
                // Some versions store the JSON as text, others as a blob.
                match row.get_ref(0)? {
                    rusqlite::types::ValueRef::Text(t) | rusqlite::types::ValueRef::Blob(t) => {
                        Ok(String::from_utf8_lossy(t).into_owned())
                    }
                    _ => Ok(String::new()),
                }
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            e => Err(Read::Failed(e.to_string())),
        })?;
    let history = json(value.as_deref().unwrap_or("{}"))?;
    Ok(history["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["remoteAuthority"].is_null())
        .filter_map(|entry| entry["folderUri"].as_str())
        .filter(|uri| uri.starts_with("file:"))
        // One malformed URI must not hide the app's other folders.
        .filter_map(|uri| url::Url::parse(uri).ok()?.to_file_path().ok())
        .map(|path| (path.to_string_lossy().into_owned(), None))
        .collect())
}

/// Typora records recent folders only in its macOS preferences. (The
/// product converts the whole file, which fails on the dates and data it
/// also keeps; this reads the one key.)
fn typora(places: &Places) -> Candidates {
    if !cfg!(target_os = "macos") {
        return Ok(vec![]);
    }
    let plist = places
        .home
        .join("Library/Preferences/abnerworks.Typora.plist");
    if !plist.is_file() {
        return Err(Read::Missing);
    }
    // Only the one key: the whole file holds values JSON cannot carry
    // (dates, data), which a whole-file conversion refuses.
    let output = std::process::Command::new("/usr/bin/plutil")
        .args(["-extract", "recentFolder", "json", "-o", "-"])
        .arg(&plist)
        .output()
        .map_err(|e| Read::Failed(e.to_string()))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).into_owned()
            + &String::from_utf8_lossy(&output.stdout);
        // Typora has not recorded a folder yet.
        if error.contains("No value at that key path") {
            return Ok(vec![]);
        }
        return Err(Read::Failed(error));
    }
    let folders = json(&String::from_utf8_lossy(&output.stdout))?;
    Ok(folders
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|folder| folder.as_str().map(|p| (p.to_owned(), None)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn places(dir: &Path) -> Places {
        Places {
            home: dir.join("home"),
            app_data: dir.join("data"),
        }
    }

    #[test]
    fn obsidian_offers_its_vaults_that_still_exist_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let (old, new) = (dir.path().join("Old"), dir.path().join("New"));
        std::fs::create_dir(&old).unwrap();
        std::fs::create_dir(&new).unwrap();
        std::fs::create_dir_all(dir.path().join("data/obsidian")).unwrap();
        let registry = serde_json::json!({ "vaults": {
            "a": { "path": old, "ts": 1 },
            "b": { "path": new, "ts": 9 },
            "c": { "path": dir.path().join("Gone"), "ts": 5 },
            "d": { "path": "relative/vault", "ts": 7 },
        }});
        std::fs::write(
            dir.path().join("data/obsidian/obsidian.json"),
            registry.to_string(),
        )
        .unwrap();
        let folders = list("obsidian", &places(dir.path())).unwrap();
        let names: Vec<_> = folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["New", "Old"]);
        assert_eq!(folders[0].last_used_at, Some(9));
    }

    #[test]
    fn vs_code_and_cursor_offer_local_folders_from_their_history() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let storage = dir.path().join("data/Cursor/User/globalStorage");
        std::fs::create_dir_all(&storage).unwrap();
        let connection = rusqlite::Connection::open(storage.join("state.vscdb")).unwrap();
        connection
            .execute(
                "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)",
                [],
            )
            .unwrap();
        let history = serde_json::json!({ "entries": [
            { "folderUri": url::Url::from_file_path(&project).unwrap().to_string() },
            { "folderUri": "vscode-remote://ssh-remote+box/home/x", "remoteAuthority": "ssh-remote+box" },
            { "fileUri": "file:///tmp/a.md" },
            { "folderUri": "file:///%E0%A4%A" },
        ]});
        connection
            .execute(
                "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
                ["history.recentlyOpenedPathsList", &history.to_string()],
            )
            .unwrap();
        drop(connection);
        let folders = list("cursor", &places(dir.path())).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "project");
        // VS Code is not installed here: nothing to offer, not a failure.
        assert_eq!(list("vscode", &places(dir.path())), Ok(vec![]));
    }

    /// Typora's preferences also keep dates and data, which a whole-file
    /// JSON conversion refuses; its recent folders are still read.
    #[cfg(target_os = "macos")]
    #[test]
    fn typora_offers_its_recent_folders_beside_values_json_cannot_carry() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes");
        std::fs::create_dir(&notes).unwrap();
        let prefs = dir.path().join("home/Library/Preferences");
        std::fs::create_dir_all(&prefs).unwrap();
        let plist = prefs.join("abnerworks.Typora.plist");
        let plutil = |args: &[&str]| {
            let status = std::process::Command::new("/usr/bin/plutil")
                .args(args)
                .arg(&plist)
                .status()
                .unwrap();
            assert!(status.success(), "{args:?}");
        };
        plutil(&["-create", "xml1"]);
        plutil(&["-insert", "lastLaunch", "-date", "2026-11-14T00:00:00Z"]);
        assert_eq!(
            list("typora", &places(dir.path())),
            Ok(vec![]),
            "no folder yet"
        );
        plutil(&["-insert", "recentFolder", "-array"]);
        plutil(&[
            "-insert",
            "recentFolder.0",
            "-string",
            &notes.to_string_lossy(),
        ]);
        let folders = list("typora", &places(dir.path())).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "notes");
    }

    #[test]
    fn a_record_that_cannot_be_read_is_an_error_and_unknown_apps_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("data/obsidian")).unwrap();
        std::fs::write(dir.path().join("data/obsidian/obsidian.json"), "{not json").unwrap();
        assert!(list("obsidian", &places(dir.path())).is_err());
        assert!(list("notion", &places(dir.path())).is_err());
        assert_eq!(list("typora", &places(dir.path())), Ok(vec![]));
    }
}
