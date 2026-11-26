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

impl Runtime {
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
        if let Some(path) = starting_file(&host.rows) {
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
            let value = json!({
                "version": 1,
                "group": {
                    "editors": editors,
                    "activeEditorId": host.state.catalog.active,
                    "mostRecentlyUsed": host.state.catalog.mru
                },
                "layout": host.state.layout,
                "viewStates": view_states
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
        let Some(editors) = value["group"]["editors"]
            .as_array()
            .filter(|v| v.len() <= 128)
        else {
            return false;
        };
        let Some(ws) = self.empty.workspace.clone() else {
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

/// The README at the project's root, else its first file, in the order the
/// Explorer lists them (`workbench.startupEditor: "readme"`). Hidden files
/// never start a project.
fn starting_file(rows: &[Node]) -> Option<PathBuf> {
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
}
