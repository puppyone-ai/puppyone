//! `host-recents.mjs`: folders on the owner's other computers that this
//! computer opened recently, and the one each account last had open (window
//! restore). Public IDs and display names only; access is decided again by
//! the Cloud on every request.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::Path;

const FILE: &str = "host-recent-folders.json";
const MAX_RECENTS: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub deployment: String,
    pub account_id: String,
    pub device_id: String,
    pub folder_id: String,
    pub name: String,
    pub host_name: String,
    pub writable: bool,
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok() && value.len() == 36
}
impl Recent {
    /// `normalizeEntry`: three UUIDs, a name, display text cut to 120.
    fn normal(mut self) -> Option<Self> {
        self.name = self.name.trim().chars().take(120).collect();
        self.host_name = self.host_name.trim().chars().take(120).collect();
        if self.name.is_empty()
            || ![&self.account_id, &self.device_id, &self.folder_id]
                .iter()
                .all(|id| uuid(id))
        {
            return None;
        }
        for id in [
            &mut self.account_id,
            &mut self.device_id,
            &mut self.folder_id,
        ] {
            *id = id.to_lowercase();
        }
        Some(self)
    }
    fn same(&self, other: &Self) -> bool {
        self.deployment == other.deployment
            && self.account_id == other.account_id
            && self.folder_id == other.folder_id
    }
}
fn account_key(deployment: &str, account: &str) -> String {
    format!("{deployment}|{}", account.to_lowercase())
}
fn load(dir: &Path) -> (Vec<Recent>, serde_json::Map<String, Value>) {
    let value: Value = std::fs::read(dir.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let recents = value["recents"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| serde_json::from_value::<Recent>(v.clone()).ok())
                .filter_map(Recent::normal)
                .collect()
        })
        .unwrap_or_default();
    let last = value["lastActive"].as_object().cloned().unwrap_or_default();
    (recents, last)
}
fn save(dir: &Path, recents: &[Recent], last: &serde_json::Map<String, Value>) {
    let _ = std::fs::create_dir_all(dir);
    let bytes = serde_json::to_vec(&json!({"recents": recents, "lastActive": last}));
    if let Ok(bytes) = bytes {
        let temp = dir.join(format!("{FILE}.{}.tmp", uuid::Uuid::new_v4()));
        if std::fs::write(&temp, bytes).is_ok() {
            let _ = std::fs::rename(&temp, dir.join(FILE));
        }
        let _ = std::fs::remove_file(temp);
    }
}
/// Records `entry` first and as its account's last open folder.
pub fn record(dir: &Path, entry: Recent) {
    let Some(entry) = entry.normal() else {
        return;
    };
    let (mut recents, mut last) = load(dir);
    recents.retain(|r| !r.same(&entry));
    recents.insert(0, entry.clone());
    recents.truncate(MAX_RECENTS);
    last.insert(
        account_key(&entry.deployment, &entry.account_id),
        Value::String(entry.folder_id.clone()),
    );
    save(dir, &recents, &last);
}
/// The account's last open remote folder, or none after it closed it.
pub fn last_active(dir: &Path, deployment: &str, account: &str) -> Option<Recent> {
    let (recents, last) = load(dir);
    let folder = last.get(&account_key(deployment, account))?.as_str()?;
    recents.into_iter().find(|r| {
        r.folder_id == folder
            && r.deployment == deployment
            && r.account_id == account.to_lowercase()
    })
}
/// The account left its remote folder (for the Homepage or another project).
pub fn clear_last_active(dir: &Path, deployment: &str, account: &str) {
    let (recents, mut last) = load(dir);
    if last.remove(&account_key(deployment, account)).is_some() {
        save(dir, &recents, &last);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_remote_folder_is_remembered_per_account_until_left() {
        let temp = tempfile::tempdir().unwrap();
        let entry = Recent {
            deployment: "https://api.puppyone.ai/api/v1".into(),
            account_id: "1E8A6C52-2222-4B3A-9C3F-6B5A4C3D2E1F".into(),
            device_id: "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f".into(),
            folder_id: "6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f".into(),
            name: " notes ".into(),
            host_name: "Studio Mac".into(),
            writable: true,
        };
        record(temp.path(), entry.clone());
        let account = "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f";
        let last = last_active(temp.path(), &entry.deployment, account).unwrap();
        assert_eq!(
            (last.name.as_str(), last.account_id.as_str()),
            ("notes", account)
        );
        assert!(last_active(temp.path(), "https://other/api/v1", account).is_none());
        clear_last_active(temp.path(), &entry.deployment, account);
        assert!(last_active(temp.path(), &entry.deployment, account).is_none());
        // Not three ids: never kept.
        record(
            temp.path(),
            Recent {
                folder_id: "../x".into(),
                ..entry
            },
        );
        assert!(load(temp.path()).0.iter().all(|r| r.folder_id != "../x"));
    }
}
