//! Bounded, read-only projection of Claude's project-scoped native JSONL store.
use crate::agent::domain::agent_session_model::HistoryEntry;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};
fn base() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude")))
        .map(|p| p.join("projects"))
}
fn files(root: &Path) -> Vec<PathBuf> {
    let Some(base) = base() else {
        return vec![];
    };
    let slug = root
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let direct = base.join(slug);
    let folders = if direct.is_dir() {
        vec![direct]
    } else {
        std::fs::read_dir(base)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .take(2000)
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.path())
            .collect()
    };
    folders
        .into_iter()
        .flat_map(|d| {
            std::fs::read_dir(d)
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
        })
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .take(5000)
        .collect()
}
fn records(path: &Path, root: &Path) -> Result<Vec<Value>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Native history exceeds the 16 MiB read budget".into());
    }
    let mut reader = BufReader::new(file.take(16 * 1024 * 1024));
    let mut line = String::new();
    let mut records = vec![];
    let mut authorized = false;
    loop {
        line.clear();
        let count = reader
            .by_ref()
            .take(1024 * 1024 + 1)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if count > 1024 * 1024 {
            return Err("Native history record exceeds 1 MiB".into());
        }
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            if v["cwd"].as_str().is_some_and(|cwd| Path::new(cwd) == root) {
                authorized = true;
            }
            records.push(v);
        }
        if records.len() > 20000 {
            return Err("Native history exceeds its record budget".into());
        }
    }
    if !authorized {
        return Err("Native history belongs to a different workspace".into());
    }
    Ok(records)
}
pub fn list(root: &Path) -> Vec<HistoryEntry> {
    let mut rows = vec![];
    let mut candidates = files(root);
    candidates.sort_by_key(|p| std::cmp::Reverse(p.metadata().and_then(|m| m.modified()).ok()));
    let mut budget = 64 * 1024 * 1024u64;
    for file in candidates {
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        if size > budget {
            continue;
        }
        budget -= size;
        let Some(id) = file
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| uuid::Uuid::parse_str(s).is_ok())
        else {
            continue;
        };
        if let Ok(values) = records(&file, root) {
            let title = values
                .iter()
                .rev()
                .find_map(|v| v["customTitle"].as_str())
                .or_else(|| {
                    values.iter().find_map(|v| {
                        if v["type"] == "user" {
                            v["message"]["content"].as_str()
                        } else {
                            None
                        }
                    })
                })
                .unwrap_or("Claude conversation")
                .chars()
                .take(120)
                .collect();
            let modified = file.metadata().and_then(|m| m.modified()).ok();
            rows.push((
                modified,
                HistoryEntry {
                    id: id.into(),
                    title,
                },
            ));
        }
    }
    rows.sort_by_key(|e| std::cmp::Reverse(e.0));
    rows.into_iter().take(1000).map(|(_, e)| e).collect()
}
pub fn load(root: &Path, id: &str) -> Result<Vec<Value>, String> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("Invalid Claude session identity".into());
    }
    let file = files(root)
        .into_iter()
        .find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(id))
        .ok_or("Native conversation is unavailable")?;
    let records = records(&file, root)?;
    let by_id = records
        .iter()
        .filter_map(|v| Some((v["uuid"].as_str()?, v)))
        .collect::<std::collections::HashMap<_, _>>();
    let mut cursor = records
        .iter()
        .rev()
        .find(|v| matches!(v["type"].as_str(), Some("user" | "assistant")))
        .and_then(|v| v["uuid"].as_str());
    let mut out = vec![];
    let mut seen = std::collections::HashSet::new();
    while let Some(id) = cursor {
        if !seen.insert(id) {
            break;
        }
        let Some(v) = by_id.get(id) else {
            break;
        };
        if matches!(v["type"].as_str(), Some("user" | "assistant")) {
            out.push((*v).clone());
        }
        cursor = v["parentUuid"].as_str();
        if out.len() >= 1000 {
            break;
        }
    }
    out.reverse();
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_foreign_workspace_and_bounds_records() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        std::fs::write(&path, "{\"cwd\":\"/foreign\",\"type\":\"user\"}\n").unwrap();
        assert!(records(&path, dir.path()).is_err());
    }
}
