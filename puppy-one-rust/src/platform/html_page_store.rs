//! What an HTML page that uses its folder keeps between runs
//! (`htmlFolderAccess.ts`): the person's allowance, which belongs to the
//! exact page text they saw (at most 200, the most recent kept), and the
//! page's own `localStorage`, which the host keeps because the page runs
//! without an origin (at most 256 K characters per page). Pages are named by
//! their absolute path. Calls read and write files: run them off the main
//! thread.
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const MAX_GRANTS: usize = 200;
pub const MAX_PAGE_STORAGE_CHARACTERS: usize = 256 * 1024;

/// The store's folder: `html-pages/` in the app's data.
pub fn native() -> PathBuf {
    super::data_dir().join("html-pages")
}

fn grants_path(base: &Path) -> PathBuf {
    base.join("folder-access.v1.json")
}
fn storage_path(base: &Path, page: &Path) -> PathBuf {
    let key = blake3::hash(page.to_string_lossy().as_bytes()).to_hex();
    base.join("storage").join(format!("{key}.json"))
}
fn grants(base: &Path) -> Map<String, Value> {
    let Ok(Some(Value::Object(grants))) = super::ui_state_store::read(&grants_path(base)) else {
        return Map::new();
    };
    grants
        .into_iter()
        .filter(|(_, g)| g["digest"].is_string() && g["updatedAt"].is_u64())
        .collect()
}

/// The digest of the page text the person allowed, if any.
pub fn grant(base: &Path, page: &Path) -> Option<String> {
    grants(base)
        .get(&page.to_string_lossy().into_owned())
        .and_then(|g| g["digest"].as_str())
        .map(str::to_owned)
}
/// Allow `page` as it reads now (its `digest`), or withdraw (`None`).
pub fn set_grant(base: &Path, page: &Path, digest: Option<&str>, now_ms: u64) {
    let mut all = grants(base);
    let key = page.to_string_lossy().into_owned();
    match digest {
        Some(digest) => {
            all.insert(
                key,
                serde_json::json!({ "digest": digest, "updatedAt": now_ms }),
            );
        }
        None => {
            all.remove(&key);
        }
    }
    let mut kept: Vec<(String, Value)> = all.into_iter().collect();
    kept.sort_by_key(|(_, g)| std::cmp::Reverse(g["updatedAt"].as_u64().unwrap_or(0)));
    kept.truncate(MAX_GRANTS);
    let _ = super::ui_state_store::write(
        &grants_path(base),
        &Value::Object(kept.into_iter().collect()),
    );
}

/// `readPageStorageEntries`: string values only, and within the limit.
pub fn page_entries(value: &Value) -> Option<Map<String, Value>> {
    let entries = value.as_object()?;
    let mut size = 0;
    for (key, item) in entries {
        size += key.chars().count() + item.as_str()?.chars().count();
    }
    (size <= MAX_PAGE_STORAGE_CHARACTERS).then(|| entries.clone())
}
pub fn page_storage(base: &Path, page: &Path) -> Map<String, Value> {
    super::ui_state_store::read(&storage_path(base, page))
        .ok()
        .flatten()
        .as_ref()
        .and_then(page_entries)
        .unwrap_or_default()
}
/// Keeps the page's entries; refused when they are not a valid store.
pub fn set_page_storage(base: &Path, page: &Path, entries: &Value) -> bool {
    let Some(entries) = page_entries(entries) else {
        return false;
    };
    super::ui_state_store::write(&storage_path(base, page), &Value::Object(entries)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_allowance_is_per_page_text_and_the_most_recent_200_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let page = Path::new("/p/tracker.html");
        assert_eq!(grant(base, page), None);
        set_grant(base, page, Some("abc"), 1);
        assert_eq!(grant(base, page).as_deref(), Some("abc"));
        set_grant(base, page, None, 2);
        assert_eq!(grant(base, page), None);
        for i in 0..205u64 {
            set_grant(base, Path::new(&format!("/p/{i}.html")), Some("d"), i + 10);
        }
        assert_eq!(grants(base).len(), MAX_GRANTS);
        assert_eq!(grant(base, Path::new("/p/0.html")), None, "the oldest went");
        assert!(grant(base, Path::new("/p/204.html")).is_some());
    }

    #[test]
    fn page_storage_keeps_strings_within_its_limit() {
        let dir = tempfile::tempdir().unwrap();
        let (base, page) = (dir.path(), Path::new("/p/notes.html"));
        assert!(set_page_storage(
            base,
            page,
            &serde_json::json!({ "theme": "dark" })
        ));
        assert_eq!(page_storage(base, page)["theme"], "dark");
        assert!(!set_page_storage(
            base,
            page,
            &serde_json::json!({ "n": 1 })
        ));
        let big = "x".repeat(MAX_PAGE_STORAGE_CHARACTERS);
        assert!(!set_page_storage(
            base,
            page,
            &serde_json::json!({ "k": big })
        ));
        assert_eq!(page_storage(base, page)["theme"], "dark", "unchanged");
        assert!(page_storage(base, Path::new("/p/other.html")).is_empty());
    }
}
