//! `application/AgentReferencePreviewStore.ts`: Renderer-only visual assets
//! for Composer references.
//!
//! Preview URLs deliberately stay outside `AgentDraftReference` so they are
//! never persisted, cloned into queued intents, or sent across the Agent IPC
//! boundary.
use super::agent_client_port::{AgentFile, AgentFileSource};
use std::rc::Rc;

/// `AgentReferenceVisualPreview`.
#[derive(Clone)]
pub struct AgentReferenceVisualPreview {
    pub url: String,
    pub release: Option<Rc<dyn Fn()>>,
}

impl std::fmt::Debug for AgentReferenceVisualPreview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentReferenceVisualPreview")
            .field("url", &self.url)
            .finish()
    }
}

/// `new AgentReferencePreviewStore()`.
#[derive(Default)]
pub struct AgentReferencePreviewStore {
    entries: Vec<(String, AgentReferenceVisualPreview)>,
}

impl AgentReferencePreviewStore {
    pub fn get_url(&self, id: &str) -> Option<String> {
        self.entries
            .iter()
            .find(|(k, _)| k == id)
            .map(|(_, p)| p.url.clone())
    }

    pub fn set(&mut self, id: &str, preview: Option<AgentReferenceVisualPreview>) {
        let Some(preview) = preview.filter(|p| !p.url.is_empty()) else {
            return;
        };
        let previous = self.entries.iter().position(|(k, _)| k == id);
        if let Some(index) = previous {
            if self.entries[index].1.url == preview.url {
                return;
            }
            let previous = std::mem::replace(&mut self.entries[index].1, preview);
            release(Some(previous));
        } else {
            self.entries.push((id.to_string(), preview));
        }
    }

    pub fn move_preview(&mut self, source_id: &str, target_id: &str) {
        let Some(index) = self.entries.iter().position(|(k, _)| k == source_id) else {
            return;
        };
        let (_, preview) = self.entries.remove(index);
        self.set(target_id, Some(preview));
    }

    pub fn delete(&mut self, id: &str) {
        let preview = self
            .entries
            .iter()
            .position(|(k, _)| k == id)
            .map(|index| self.entries.remove(index).1);
        release(preview);
    }

    pub fn delete_many<'a>(&mut self, ids: impl IntoIterator<Item = &'a str>) {
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            if seen.insert(id.to_string()) {
                self.delete(id);
            }
        }
    }

    pub fn clear(&mut self) {
        for (_, preview) in std::mem::take(&mut self.entries) {
            release(Some(preview));
        }
    }
}

/// Preview cleanup is best-effort and must never disrupt draft state.
pub fn release(preview: Option<AgentReferenceVisualPreview>) {
    if let Some(release) = preview.and_then(|p| p.release) {
        release();
    }
}

/// `createAgentFileVisualPreview(file)`: a raster image's local preview. A
/// file without a native path gets an object URL its release revokes.
pub fn create_agent_file_visual_preview(file: &AgentFile) -> Option<AgentReferenceVisualPreview> {
    if !is_previewable_raster_image(file) {
        return None;
    }
    match &file.source {
        AgentFileSource::Path(path) => Some(AgentReferenceVisualPreview {
            url: path.clone(),
            release: None,
        }),
        AgentFileSource::Bytes(bytes) => {
            let url = create_object_url(bytes.clone());
            let revoked = url.clone();
            Some(AgentReferenceVisualPreview {
                url,
                release: Some(Rc::new(move || revoke_object_url(&revoked))),
            })
        }
    }
}

thread_local! {
    static OBJECT_URLS: std::cell::RefCell<std::collections::HashMap<String, Rc<Vec<u8>>>> =
        std::cell::RefCell::default();
}

/// `URL.createObjectURL(file)`: a window-local URL for in-memory bytes.
pub fn create_object_url(bytes: Rc<Vec<u8>>) -> String {
    let url = format!("blob:puppyone/{}", super::ui_runtime::random_uuid());
    OBJECT_URLS.with(|urls| urls.borrow_mut().insert(url.clone(), bytes));
    url
}

/// `URL.revokeObjectURL(url)`.
pub fn revoke_object_url(url: &str) {
    OBJECT_URLS.with(|urls| urls.borrow_mut().remove(url));
}

/// The bytes behind an object URL the view loads.
pub fn object_url_bytes(url: &str) -> Option<Rc<Vec<u8>>> {
    OBJECT_URLS.with(|urls| urls.borrow().get(url).cloned())
}

fn is_previewable_raster_image(file: &AgentFile) -> bool {
    if [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/avif",
    ]
    .contains(&file.mime.as_str())
    {
        return true;
    }
    let name = file.name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]
        .iter()
        .any(|ext| name.ends_with(ext))
}
