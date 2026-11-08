//! The app's own log file (`electron-log`'s `main.log`): one JSON line per
//! diagnostic event, kept on this computer and never sent anywhere. Writing
//! it can never change the outcome of what it records.
use std::io::Write;
use std::path::PathBuf;

/// The log rolls over to `main.old.log` past this size.
const MAX_BYTES: u64 = 1024 * 1024;

/// `<data dir>/logs/main.log`.
pub fn path() -> PathBuf {
    super::data_dir().join("logs/main.log")
}

/// Appends `event` with `fields` and the time it happened.
pub fn warn(event: &str, fields: serde_json::Value) {
    let line = serde_json::json!({
        "at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "level": "warn",
        "event": event,
        "fields": fields,
    });
    #[cfg(any(test, feature = "test-support"))]
    {
        RECORDED.lock().unwrap().push(line);
    }
    #[cfg(not(any(test, feature = "test-support")))]
    {
        let _ = append(&line.to_string());
    }
}

#[cfg_attr(any(test, feature = "test-support"), allow(dead_code))]
fn append(line: &str) -> std::io::Result<()> {
    let path = path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::rename(&path, path.with_file_name("main.old.log"));
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    writeln!(file, "{line}")
}

/// What tests record instead of the file.
#[cfg(any(test, feature = "test-support"))]
static RECORDED: std::sync::Mutex<Vec<serde_json::Value>> = std::sync::Mutex::new(Vec::new());
/// The lines recorded so far whose event is `event`.
#[cfg(any(test, feature = "test-support"))]
pub fn recorded(event: &str) -> Vec<serde_json::Value> {
    RECORDED
        .lock()
        .unwrap()
        .iter()
        .filter(|l| l["event"] == event)
        .cloned()
        .collect()
}
