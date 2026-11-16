//! Layout restoration is untrusted metadata. Every candidate is read through
//! the admitted Provider before publication. Interaction wins over late restore.
use super::*;
use crate::platform::editor_state_storage::{Event, Storage};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

impl Runtime {
    pub fn native() -> Self {
        let journal = crate::platform::draft_journal::DraftJournal::native();
        let mut scratch = Documents::default();
        scratch.set_draft_journal(Some(journal.clone()));
        Self {
            scratch,
            storage: Some(Storage::native()),
            draft_journal: Some(journal),
            ..Default::default()
        }
    }
    pub(super) fn poll_metadata(&mut self, wake: &Wake) {
        while let Some(event) = self.storage.as_ref().and_then(Storage::next) {
            match event {
                Event::Saved => self.metadata_inflight = self.metadata_inflight.saturating_sub(1),
                Event::Loaded(key, value) => {
                    let Some(host) = self.hosts.get_mut(&key) else {
                        continue;
                    };
                    host.metadata_loaded = true;
                    if host.interacted || self.quitting {
                        continue;
                    }
                    let Some(value) = value.filter(|v| v["version"] == 1) else {
                        continue;
                    };
                    if let Ok(entries) = serde_json::from_value::<
                        Vec<super::super::view_state::PersistedViewStateEntry>,
                    >(value["viewStates"].clone())
                    {
                        host.view_states =
                            super::super::view_state::ViewStateStore::from_persisted(entries);
                    }
                    let Some(editors) = value["group"]["editors"]
                        .as_array()
                        .filter(|v| v.len() <= 128)
                    else {
                        continue;
                    };
                    let ws = host.empty.workspace.clone().unwrap();
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
                            || host.slots.values().any(|s| s.key == key)
                        {
                            continue;
                        }
                        self.serial += 1;
                        let mut files = Documents::in_workspace_with_journal(
                            ws.clone(),
                            self.draft_journal.clone(),
                        );
                        files.task_scope = self.scratch.task_scope.clone();
                        files.begin(Intent::OpenFile(path), wake);
                        host.slots.insert(
                            self.serial,
                            Slot {
                                drop_target: None,
                                key,
                                files,
                                admitted: false,
                                opening: 0,
                                closing: false,
                                reported_error: None,
                                restoring: true,
                                rehydrating: None,
                            },
                        );
                    }
                    host.restore = Some(value);
                }
            }
        }
        for host in self.hosts.values_mut() {
            if host.restore.is_some() && host.slots.values().all(|s| s.admitted) {
                let value = host.restore.take().unwrap();
                if host.interacted {
                    continue;
                }
                let mut catalog = super::super::catalog::Catalog::default();
                if let Some(editors) = value["group"]["editors"].as_array() {
                    for input in editors {
                        let Some(key) = input["id"].as_str() else {
                            continue;
                        };
                        if catalog.editors.iter().any(|e| e.id == key) {
                            continue;
                        }
                        if let Some(slot) = host.slots.values().find(|s| s.admitted && s.key == key)
                        {
                            let path = slot.files.opened().unwrap().1;
                            catalog.editors.push(Input {
                                id: key.into(),
                                label: path
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .into_owned(),
                            });
                        }
                    }
                }
                let valid: std::collections::HashSet<_> =
                    catalog.editors.iter().map(|i| i.id.clone()).collect();
                let active = value["group"]["activeEditorId"]
                    .as_str()
                    .filter(|id| valid.contains(*id))
                    .map(str::to_owned)
                    .or_else(|| catalog.editors.first().map(|i| i.id.clone()));
                if let Some(mru) = value["group"]["mostRecentlyUsed"].as_array() {
                    for id in mru.iter().filter_map(Value::as_str) {
                        if valid.contains(id) && !catalog.mru.iter().any(|v| v == id) {
                            catalog.mru.push(id.into());
                        }
                    }
                }
                if let Some(id) = &active {
                    catalog.activate(id);
                }
                let layout = super::super::layout::Layout::parse(&value["layout"], &valid, active);
                if let Some(id) = layout.active_editor() {
                    catalog.activate(id);
                }
                host.state = Workbench { catalog, layout };
                for (slot_id, slot) in &mut host.slots {
                    slot.restoring = false;
                    if let Some(vs) = host.view_states.get(&slot.key).cloned() {
                        self.pending_view_restores.insert(*slot_id, vs);
                    }
                }
                self.generation += 1;
            }
        }
    }
    /// Coalesce only non-document metadata, off the UI thread. Also called when
    /// chrome changes without a storage notification. Quit waits for accepted
    /// writes, but metadata failure never blocks editing or fabricates a save.
    pub fn persist_metadata(&mut self, wake: &Wake, flush: bool) {
        if self.metadata_suspended {
            return;
        }
        let Some(storage) = &self.storage else {
            return;
        };
        let now = Instant::now();
        for (key, host) in &mut self.hosts {
            if !host.metadata_loaded || host.restore.is_some() {
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
