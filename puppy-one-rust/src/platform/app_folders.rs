//! `createAppFolderDiscovery` (`project-import/app-folders.mjs`): folders
//! other apps already know about. Each app is asked only through the file
//! where it records its own vaults or recent folders; nothing is scanned. A
//! folder is offered only while it still exists, at most 50 per app.
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Duration,
};

const PLIST_TIMEOUT: Duration = Duration::from_secs(5);
const PLIST_OUTPUT_LIMIT: usize = 1024 * 1024;

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
        Self::for_platform(super::paths::home_dir(), std::env::consts::OS, |name| {
            std::env::var_os(name)
        })
    }
    fn for_platform(
        home: PathBuf,
        platform: &str,
        env: impl Fn(&str) -> Option<std::ffi::OsString>,
    ) -> Self {
        let app_data = match platform {
            "macos" => home.join("Library/Application Support"),
            "windows" => env("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData/Roaming")),
            _ => env("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config")),
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
        if !seen.insert(path.clone()) {
            continue;
        }
        match std::fs::metadata(&path).map_err(Read::from) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) | Err(Read::Missing) => continue,
            Err(Read::Failed(error)) => return Err(error),
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

impl From<std::io::Error> for Read {
    fn from(error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => Self::Missing,
            _ => Self::Failed(error.to_string()),
        }
    }
}
fn read_file(path: &Path) -> Result<String, Read> {
    std::fs::read_to_string(path).map_err(Read::from)
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
    std::fs::metadata(&database).map_err(Read::from)?;
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
        .filter(|entry| match &entry["remoteAuthority"] {
            serde_json::Value::Null | serde_json::Value::Bool(false) => true,
            serde_json::Value::String(value) => value.is_empty(),
            serde_json::Value::Number(value) => value.as_f64() == Some(0.),
            _ => false,
        })
        .filter_map(|entry| entry["folderUri"].as_str())
        .filter(|uri| uri.starts_with("file:"))
        // One malformed URI must not hide the app's other folders.
        .filter_map(local_folder_uri)
        .map(|path| (path.to_string_lossy().into_owned(), None))
        .collect())
}

// Node's fileURLToPath rejects malformed escapes, invalid UTF-8 and encoded
// path separators. A permissive URL parser alone does not reject all of these.
fn local_folder_uri(uri: &str) -> Option<PathBuf> {
    let url = url::Url::parse(uri).ok()?;
    let mut bytes = url.path().as_bytes().iter().copied();
    while let Some(byte) = bytes.next() {
        if byte != b'%' {
            continue;
        }
        let high = (bytes.next()? as char).to_digit(16)?;
        let low = (bytes.next()? as char).to_digit(16)?;
        let decoded = high * 16 + low;
        if decoded == 0
            || decoded == u32::from(b'/')
            || cfg!(windows) && decoded == u32::from(b'\\')
        {
            return None;
        }
    }
    let path = url.to_file_path().ok()?;
    path.to_str()?;
    Some(path)
}

/// Typora records recent folders only in its macOS preferences. (The
/// product converts the whole file, which fails on the dates and data it
/// also keeps; this reads the one key.)
fn typora(places: &Places) -> Candidates {
    typora_with(
        places,
        cfg!(target_os = "macos"),
        Path::new("/usr/bin/plutil"),
        PLIST_TIMEOUT,
    )
}
fn typora_with(places: &Places, macos: bool, executable: &Path, timeout: Duration) -> Candidates {
    if !macos {
        return Ok(vec![]);
    }
    let plist = places
        .home
        .join("Library/Preferences/abnerworks.Typora.plist");
    std::fs::metadata(&plist).map_err(Read::from)?;
    let path = plist
        .to_str()
        .ok_or_else(|| Read::Failed("Invalid preferences path.".into()))?;
    // Extract one key as XML plist: on macOS 15, `plutil -extract <key> json`
    // rejects plists containing unrelated `<date>`/`<data>` values when the
    // requested key is absent ("invalid object in plist for destination format").
    let output = super::process::run_output(
        executable,
        &["-extract", "recentFolder", "xml1", "-o", "-", path],
        plist.parent().unwrap(),
        None,
        timeout,
        &AtomicBool::new(false),
        super::process::OutputLimits {
            stdout: PLIST_OUTPUT_LIMIT,
            stderr: PLIST_OUTPUT_LIMIT,
        },
    );
    let output = match output {
        Ok(output) => output,
        Err(error) if error.contains("No value at that key path") => return Ok(vec![]),
        Err(error) => return Err(Read::Failed(error)),
    };
    parse_plist_recent_folders(&String::from_utf8_lossy(&output.stdout))
}

fn parse_plist_recent_folders(xml: &str) -> Candidates {
    let options = roxmltree::ParsingOptions {
        allow_dtd: true,
        nodes_limit: 65_536,
        ..Default::default()
    };
    let document = roxmltree::Document::parse_with_options(xml, options)
        .map_err(|error| Read::Failed(format!("Invalid plist XML: {error}")))?;
    let plist = document.root_element();
    if !plist.has_tag_name("plist") {
        return Err(Read::Failed("Unexpected plist root element.".into()));
    }
    let Some(value) = plist.children().find(|node| node.is_element()) else {
        return Ok(vec![]);
    };
    if !value.has_tag_name("array") {
        return Ok(vec![]);
    }
    Ok(value
        .children()
        .filter(|node| node.is_element() && node.has_tag_name("string"))
        .map(|node| (node.text().unwrap_or_default().to_owned(), None))
        .collect())
}

#[cfg(test)]
mod tests;
