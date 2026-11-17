//! Per-document CSV view preferences (viewers/csv/csvViewPreferences.ts):
//! header record, row numbers and column widths, keyed by document id, the
//! 200 most recently updated kept. Best effort: a missing or broken store
//! reads as empty and a failed write never blocks editing. Loaded once per
//! process; writes are ordered on a background thread with atomic
//! replacement.
use super::document::Delimiter;
use serde_json::{Map, Value, json};
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock, mpsc},
};

const MAX_ENTRIES: usize = 200;

/// One document's stored view state (`CsvViewPreferenceEntry`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Entry {
    pub first_record_as_header: Option<bool>,
    pub show_row_numbers: Option<bool>,
    pub column_layout: Option<(Delimiter, Vec<f32>)>,
    pub updated_at: f64,
}

fn path() -> PathBuf {
    std::env::var_os("PUPPYONE_RUST_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Library/Application Support/PuppyOne GPUI")
        })
        .join("editor/csv-view-preferences.v1.json")
}

fn delimiter_str(d: Delimiter) -> &'static str {
    match d {
        Delimiter::Comma => ",",
        Delimiter::Tab => "\t",
    }
}

/// `parseStoredColumnLayout`.
fn parse_layout(value: &Value) -> Option<(Delimiter, Vec<f32>)> {
    let delimiter = match value.get("delimiter")?.as_str()? {
        "," => Delimiter::Comma,
        "\t" => Delimiter::Tab,
        _ => return None,
    };
    let widths = value.get("widths")?.as_array()?;
    if widths.is_empty() {
        return None;
    }
    let parsed: Vec<f32> = widths
        .iter()
        .filter_map(Value::as_f64)
        .filter(|w| w.is_finite() && *w > 0.)
        .map(|w| w as f32)
        .collect();
    (parsed.len() == widths.len()).then_some((delimiter, parsed))
}

/// `readPreferenceStore`: keeps only well-formed entries.
pub fn parse(value: &Value) -> Vec<(String, Entry)> {
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    object
        .iter()
        .filter_map(|(key, value)| {
            let value = value.as_object()?;
            let entry = Entry {
                first_record_as_header: value.get("firstRecordAsHeader").and_then(Value::as_bool),
                show_row_numbers: value.get("showRowNumbers").and_then(Value::as_bool),
                column_layout: value.get("columnLayout").and_then(parse_layout),
                updated_at: value
                    .get("updatedAt")
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite())
                    .unwrap_or(0.),
            };
            (entry.first_record_as_header.is_some()
                || entry.show_row_numbers.is_some()
                || entry.column_layout.is_some())
            .then(|| (key.clone(), entry))
        })
        .collect()
}

pub fn serialize(entries: &[(String, Entry)]) -> Value {
    let mut object = Map::new();
    for (key, entry) in entries {
        let mut value = Map::new();
        if let Some((delimiter, widths)) = &entry.column_layout {
            value.insert(
                "columnLayout".into(),
                json!({ "delimiter": delimiter_str(*delimiter), "widths": widths }),
            );
        }
        if let Some(v) = entry.first_record_as_header {
            value.insert("firstRecordAsHeader".into(), json!(v));
        }
        if let Some(v) = entry.show_row_numbers {
            value.insert("showRowNumbers".into(), json!(v));
        }
        value.insert("updatedAt".into(), json!(entry.updated_at));
        object.insert(key.clone(), Value::Object(value));
    }
    Value::Object(object)
}

/// `writeCsvViewPreference`: merge the patch, stamp it, keep the most recent.
pub fn merge(
    entries: &mut Vec<(String, Entry)>,
    key: &str,
    patch: impl FnOnce(&mut Entry),
    now: f64,
) {
    let index = entries
        .iter()
        .position(|(k, _)| k == key)
        .unwrap_or_else(|| {
            entries.push((key.to_owned(), Entry::default()));
            entries.len() - 1
        });
    patch(&mut entries[index].1);
    entries[index].1.updated_at = now;
    entries.sort_by(|a, b| {
        b.1.updated_at
            .partial_cmp(&a.1.updated_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    entries.truncate(MAX_ENTRIES);
}

struct Store {
    entries: Vec<(String, Entry)>,
    writer: mpsc::Sender<Value>,
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| {
        let path = path();
        let entries = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .map(|v| parse(&v))
            .unwrap_or_default();
        let (writer, rx) = mpsc::channel::<Value>();
        std::thread::spawn(move || {
            while let Ok(mut value) = rx.recv() {
                // Only the latest state matters.
                while let Ok(next) = rx.try_recv() {
                    value = next;
                }
                let _ = write(&path, &value);
            }
        });
        Mutex::new(Store { entries, writer })
    })
}

fn write(path: &std::path::Path, value: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec(value)?)?;
    std::fs::rename(temp, path)
}

fn normalize(id: &str) -> Option<&str> {
    let id = id.trim();
    (!id.is_empty()).then_some(id)
}

pub fn read(id: &str) -> Entry {
    let Some(key) = normalize(id) else {
        return Entry::default();
    };
    let store = store().lock().unwrap_or_else(|e| e.into_inner());
    store
        .entries
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, e)| e.clone())
        .unwrap_or_default()
}

pub fn update(id: &str, patch: impl FnOnce(&mut Entry)) {
    // The CSV editor has no document id in tests; never touch the real store.
    if cfg!(test) {
        return;
    }
    let Some(key) = normalize(id) else { return };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0., |d| d.as_millis() as f64);
    let mut store = store().lock().unwrap_or_else(|e| e.into_inner());
    merge(&mut store.entries, key, patch, now);
    let value = serialize(&store.entries);
    let _ = store.writer.send(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_store_round_trips_and_drops_malformed_entries() {
        let value = json!({
            "a": { "firstRecordAsHeader": false, "updatedAt": 2 },
            "b": { "columnLayout": { "delimiter": "\t", "widths": [120, 96] }, "showRowNumbers": true, "updatedAt": 1 },
            "c": { "columnLayout": { "delimiter": ";", "widths": [120] }, "updatedAt": 3 },
            "d": { "columnLayout": { "delimiter": ",", "widths": [120, -1] }, "showRowNumbers": "yes" },
            "e": []
        });
        let mut entries = parse(&value);
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(
            entries.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(
            entries[1].1.column_layout,
            Some((Delimiter::Tab, vec![120., 96.]))
        );
        assert_eq!(parse(&serialize(&entries)), entries);
    }

    #[test]
    fn merging_stamps_the_entry_and_keeps_the_most_recent() {
        let mut entries: Vec<(String, Entry)> = (0..MAX_ENTRIES)
            .map(|i| {
                (
                    format!("doc{i}"),
                    Entry {
                        show_row_numbers: Some(true),
                        updated_at: i as f64,
                        ..Entry::default()
                    },
                )
            })
            .collect();
        merge(
            &mut entries,
            "new",
            |e| e.first_record_as_header = Some(true),
            1e9,
        );
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].0, "new");
        assert!(!entries.iter().any(|(k, _)| k == "doc0"));
        merge(
            &mut entries,
            "doc5",
            |e| e.show_row_numbers = Some(false),
            2e9,
        );
        assert_eq!(
            entries[0].1,
            Entry {
                show_row_numbers: Some(false),
                updated_at: 2e9,
                ..Entry::default()
            }
        );
    }
}
