//! Layout restoration is untrusted metadata. Every candidate is read through
//! the admitted Provider before publication. Interaction wins over late restore.
use super::*;
use crate::platform::editor_state_storage::{Event, Storage};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

impl Runtime {
    pub fn native() -> Self {
        Self {
            storage: Some(Storage::native()),
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
                        let mut files = Documents::in_workspace(ws.clone());
                        files.begin(Intent::OpenFile(path), wake);
                        host.slots.insert(
                            self.serial,
                            Slot {
                                key,
                                files,
                                admitted: false,
                                opening: 0,
                                closing: false,
                                reported_error: None,
                                restoring: true,
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
                for slot in host.slots.values_mut() {
                    slot.restoring = false;
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
                    let slot = host
                        .slots
                        .values()
                        .find(|s| s.admitted && s.key == input.id)?;
                    let path = slot.files.opened()?.1.to_str()?;
                    Some(json!({"id":input.id,"resource":path,"label":input.label}))
                })
                .collect();
            let value = json!({"version":1,"group":{"editors":editors,"activeEditorId":host.state.catalog.active,"mostRecentlyUsed":host.state.catalog.mru},"layout":host.state.layout});
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
