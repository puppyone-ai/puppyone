use super::configuration::{data_dir, read_json, write_json};
use crate::agent::domain::agent_session_model::{HistoryEntry, Message};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
#[derive(Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub root: PathBuf,
    pub title: String,
    pub route: Option<String>,
    pub generation: Option<String>,
    pub messages: Vec<Message>,
    pub context: Vec<Value>,
    pub interrupted: bool,
    pub archived: bool,
    pub updated: u64,
}
impl Conversation {
    pub fn new(root: PathBuf) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            root,
            title: "PuppyOne Agent".into(),
            route: None,
            generation: None,
            messages: vec![],
            context: vec![],
            interrupted: false,
            archived: false,
            updated: 0,
        }
    }
}
fn folder(root: &Path) -> PathBuf {
    data_dir().join("puppyone-agent/sessions").join(
        blake3::hash(root.to_string_lossy().as_bytes())
            .to_hex()
            .as_str(),
    )
}
pub fn save(c: &mut Conversation) -> Result<(), String> {
    c.updated = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if serde_json::to_vec(c).map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 {
        return Err(
            "Conversation exceeded its 32 MiB storage budget; fork or start a new conversation"
                .into(),
        );
    }
    write_json(&folder(&c.root).join(format!("{}.json", c.id)), c)
}
pub fn load(root: &Path, id: &str) -> Result<Conversation, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid conversation identity")?;
    let c: Conversation = read_json(&folder(root).join(format!("{id}.json")), 32 * 1024 * 1024)?;
    if c.id != id || c.root != root {
        return Err("Conversation ownership mismatch".into());
    }
    Ok(c)
}
pub fn history(root: &Path) -> Vec<HistoryEntry> {
    let mut files = std::fs::read_dir(folder(root))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|e| e == "json"))
        .take(2000)
        .collect::<Vec<_>>();
    files.sort_by_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).ok()));
    let mut budget = 64 * 1024 * 1024u64;
    files
        .into_iter()
        .filter_map(|e| {
            let size = e.metadata().ok()?.len();
            if size > budget {
                return None;
            }
            budget -= size;
            let id = e.path().file_stem()?.to_str()?.to_owned();
            let c = load(root, &id).ok()?;
            (!c.archived).then_some(HistoryEntry {
                id: c.id,
                title: c.title,
            })
        })
        .take(500)
        .collect()
}
