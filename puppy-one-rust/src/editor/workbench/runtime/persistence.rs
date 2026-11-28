//! Layout restoration is untrusted metadata. The saved tabs and panes show
//! at once, each tab hibernated: its file is read through the admitted
//! Provider only when its pane shows it, and a tab whose file is gone or is
//! not a file closes quietly. Nothing a person does races the restore: what
//! they open before the saved layout arrives stays, and the saved tabs join it.
use super::*;
use crate::platform::editor_state_storage::{Event, Storage};
use serde_json::{Value, json};
use std::{
    path::Path,
    time::{Duration, Instant},
};

/// Maximum number of recently opened file paths persisted per workspace.
pub(super) const MAX_RECENT_FILES: usize = 10;

impl Host {
    /// Records `path` as the most recently opened file in this workspace.
    pub(super) fn record_recent(&mut self, path: PathBuf) {
        if path.as_os_str().is_empty() {
            return;
        }
        self.recent_files.retain(|p| p != &path);
        self.recent_files.insert(0, path);
        self.recent_files.truncate(MAX_RECENT_FILES);
    }

    /// Reconciles `recent_files` against deleted or moved paths.
    pub(super) fn reconcile_recent(&mut self, removed: &[PathBuf], moved: &[(PathBuf, PathBuf)]) {
        if self.recent_files.is_empty() {
            return;
        }
        let mut next = Vec::with_capacity(self.recent_files.len());
        for path in std::mem::take(&mut self.recent_files) {
            if removed.iter().any(|rem| path.starts_with(rem)) {
                continue;
            }
            let updated = if let Some((from, to)) =
                moved.iter().find(|(from, _)| path.starts_with(from))
                && let Ok(rest) = path.strip_prefix(from)
            {
                if rest.as_os_str().is_empty() {
                    to.clone()
                } else {
                    to.join(rest)
                }
            } else {
                path
            };
            if !next.contains(&updated) {
                next.push(updated);
            }
        }
        next.truncate(MAX_RECENT_FILES);
        self.recent_files = next;
    }
}

/// Whether `path` still exists in the active workspace: on local roots we check
/// the real file on disk (works inside unexpanded folders too); on remote/Cloud
/// workspaces we verify against the root listing.
pub(super) fn recent_path_exists(
    path: &Path,
    rows: &[Node],
    workspace: Option<&crate::workspace::Workspace>,
) -> bool {
    if path.as_os_str().is_empty() {
        return false;
    }
    if let Some(root) = workspace.and_then(|ws| ws.local_root()) {
        return root.join(path).is_file();
    }
    let mut components = path.components();
    let Some(std::path::Component::Normal(first)) = components.next() else {
        return false;
    };
    if components.next().is_none() {
        rows.iter().any(|n| !n.folder && n.path == path)
    } else {
        rows.iter().any(|n| n.folder && n.path == Path::new(first))
    }
}

impl Runtime {
    /// Recently opened files in the active workspace (newest first), with any
    /// files that no longer exist filtered out.
    pub fn recent_files(&self) -> Vec<PathBuf> {
        let Some(host) = self.active.as_ref().and_then(|key| self.hosts.get(key)) else {
            return Vec::new();
        };
        let ws = host.empty.workspace.as_deref();
        host.recent_files
            .iter()
            .filter(|p| recent_path_exists(p, &host.rows, ws))
            .cloned()
            .collect()
    }

    /// True while a newly entered project is still waiting for its saved
    /// layout / starting file decision before showing an empty editor state.
    pub fn awaiting_initial_open(&self) -> bool {
        let Some(host) = self.active.as_ref().and_then(|key| self.hosts.get(key)) else {
            return false;
        };
        host.starting && !host.metadata_loaded
    }

    pub fn native() -> Self {
        let journal = crate::platform::draft_journal::DraftJournal::native();
        let mut scratch = Documents::default();
        scratch.set_draft_journal(Some(journal.clone()));
        Self {
            scratch,
            storage: Some(Storage::native()),
            draft_journal: Some(journal),
            starting_file: true,
            ..Default::default()
        }
    }
    pub(super) fn poll_metadata(&mut self) {
        while let Some(event) = self.storage.as_ref().and_then(Storage::next) {
            match event {
                Event::Saved => self.metadata_inflight = self.metadata_inflight.saturating_sub(1),
                Event::Loaded(key, value) => {
                    if self.file_window {
                        continue;
                    }
                    let Some(host) = self.hosts.get_mut(&key) else {
                        continue;
                    };
                    host.metadata_loaded = true;
                    if self.quitting {
                        continue;
                    }
                    if let Some(value) = value.filter(|v| v["version"] == 1)
                        && host.restore(&value)
                    {
                        self.generation += 1;
                    }
                }
            }
        }
    }
    /// A project just entered with no tab to show opens its starting file,
    /// once its saved layout is in.
    pub(super) fn open_starting_file(&mut self, wake: &Wake) {
        let Some(host) = self.active.as_ref().and_then(|key| self.hosts.get_mut(key)) else {
            return;
        };
        if !host.starting || !host.metadata_loaded {
            return;
        }
        host.starting = false;
        if !self.starting_file
            || self.file_window
            || self.quitting
            || !host.state.catalog.editors.is_empty()
            || !host.slots.is_empty()
        {
            return;
        }
        if let Some(path) = starting_file(
            &host.rows,
            &host.recent_files,
            host.empty.workspace.as_deref(),
        ) {
            self.begin(Intent::OpenFile(path), wake);
        }
    }
    /// Coalesce only non-document metadata, off the UI thread. Also called when
    /// chrome changes without a storage notification. Quit waits for accepted
    /// writes, but metadata failure never blocks editing or fabricates a save.
    pub fn persist_metadata(&mut self, wake: &Wake, flush: bool) {
        if self.metadata_suspended || self.file_window {
            return;
        }
        let Some(storage) = &self.storage else {
            return;
        };
        let now = Instant::now();
        for (key, host) in &mut self.hosts {
            if !host.metadata_loaded {
                continue;
            }
            let editors: Vec<_> = host
                .state
                .catalog
                .editors
                .iter()
                .filter_map(|input| {
                    let path = if let Some(slot) = host
                        .slots
                        .values()
                        .find(|s| s.admitted && s.key == input.id)
                    {
                        slot.files.opened()?.1.to_str()?.to_owned()
                    } else {
                        let hib = host.hibernated.get(&input.id)?;
                        hib.path.to_str()?.to_owned()
                    };
                    Some(json!({"id":input.id,"resource":path,"label":input.label}))
                })
                .collect();
            let view_states = host.view_states.to_persisted();
            let recent_files: Vec<_> = host
                .recent_files
                .iter()
                .filter_map(|p| p.to_str())
                .collect();
            let value = json!({
                "version": 1,
                "group": {
                    "editors": editors,
                    "activeEditorId": host.state.catalog.active,
                    "mostRecentlyUsed": host.state.catalog.mru
                },
                "layout": host.state.layout,
                "viewStates": view_states,
                "recentFiles": recent_files
            });
            if host.metadata_value.as_ref() != Some(&value) {
                host.metadata_value = Some(value.clone());
                host.metadata_due = Some(now + Duration::from_millis(200));
                wake.after(Duration::from_millis(200));
            }
            if host
                .metadata_due
                .is_some_and(|deadline| flush || now >= deadline)
            {
                if storage.save(key.clone(), value, wake) {
                    host.metadata_due = None;
                    self.metadata_inflight += 1;
                } else {
                    wake.after(Duration::from_millis(200));
                }
            }
        }
    }
}

impl Host {
    /// Shows the saved tabs and panes, every tab hibernated until its pane
    /// shows it. What was opened before they arrived keeps its pane, and the
    /// saved tabs follow it. `false` when nothing was restored.
    pub(super) fn restore(&mut self, value: &Value) -> bool {
        use super::super::{
            catalog::Catalog,
            layout::Layout,
            retention::HibernatedSlot,
            view_state::{PersistedViewStateEntry, ViewStateStore},
        };
        if let Ok(entries) =
            serde_json::from_value::<Vec<PersistedViewStateEntry>>(value["viewStates"].clone())
        {
            self.view_states = ViewStateStore::from_persisted(entries);
        }
        let Some(ws) = self.empty.workspace.clone() else {
            return false;
        };
        if let Some(recent) = value["recentFiles"].as_array() {
            let mut restored_recent = Vec::new();
            for raw in recent.iter().filter_map(Value::as_str) {
                let path = PathBuf::from(raw);
                if let Ok(resource) = ws.resource_id(&path)
                    && !resource.path.is_root()
                    && !restored_recent.contains(&path)
                {
                    restored_recent.push(path);
                    if restored_recent.len() >= MAX_RECENT_FILES {
                        break;
                    }
                }
            }
            // Keep anything opened before metadata arrived ahead of persisted recent files.
            for path in restored_recent {
                if !self.recent_files.contains(&path) && self.recent_files.len() < MAX_RECENT_FILES
                {
                    self.recent_files.push(path);
                }
            }
        }
        let Some(editors) = value["group"]["editors"]
            .as_array()
            .filter(|v| v.len() <= 128)
        else {
            return false;
        };
        let mut restored: Vec<Input> = Vec::new();
        for editor in editors {
            let Some(path) = editor["resource"].as_str() else {
                continue;
            };
            let path = PathBuf::from(path);
            let Ok(resource) = ws.resource_id(&path) else {
                continue;
            };
            if resource.path.is_root() {
                continue;
            }
            let key = resource_key(&resource);
            if editor["id"].as_str() != Some(&key)
                || restored.iter().any(|input| input.id == key)
                || self.state.catalog.editors.iter().any(|e| e.id == key)
                || self.slots.values().any(|s| s.key == key)
            {
                continue;
            }
            restored.push(Input {
                id: key.clone(),
                label: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            });
            self.hibernated.insert(
                key,
                HibernatedSlot {
                    path,
                    restored: true,
                    ..Default::default()
                },
            );
        }
        if restored.is_empty() {
            return false;
        }
        if !self.state.catalog.editors.is_empty() || !self.slots.is_empty() {
            let catalog = &mut self.state.catalog;
            catalog
                .mru
                .extend(restored.iter().map(|input| input.id.clone()));
            catalog.editors.extend(restored);
            return true;
        }
        let valid: std::collections::HashSet<_> =
            restored.iter().map(|input| input.id.clone()).collect();
        let mut catalog = Catalog {
            editors: restored,
            ..Default::default()
        };
        if let Some(mru) = value["group"]["mostRecentlyUsed"].as_array() {
            for id in mru.iter().filter_map(Value::as_str) {
                if valid.contains(id) && !catalog.mru.iter().any(|v| v == id) {
                    catalog.mru.push(id.into());
                }
            }
        }
        let active = value["group"]["activeEditorId"]
            .as_str()
            .filter(|id| valid.contains(*id))
            .map(str::to_owned)
            .or_else(|| catalog.editors.first().map(|i| i.id.clone()));
        if let Some(id) = &active {
            catalog.activate(id);
        }
        let layout = Layout::parse(&value["layout"], &valid, active);
        if let Some(id) = layout.active_editor() {
            catalog.activate(id);
        }
        self.state = Workbench { catalog, layout };
        self.sync_panes();
        true
    }
}

/// The README at the project's root, else its first root file (in the order
/// the Explorer lists them), else the most recently opened still-existing file
/// in the project (`workbench.startupEditor: "readme"`). Hidden files never
/// start a project.
fn starting_file(
    rows: &[Node],
    recent_files: &[PathBuf],
    workspace: Option<&crate::workspace::Workspace>,
) -> Option<PathBuf> {
    let files = || {
        rows.iter()
            .filter(|n| !n.folder && !n.name.starts_with('.'))
    };
    files()
        .find(|n| {
            Path::new(&n.name)
                .file_stem()
                .is_some_and(|stem| stem.eq_ignore_ascii_case("readme"))
        })
        .or_else(|| files().next())
        .map(|n| n.path.clone())
        .or_else(|| {
            recent_files
                .iter()
                .find(|path| {
                    let hidden = path
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with('.'));
                    !hidden && recent_path_exists(path, rows, workspace)
                })
                .cloned()
        })
}
