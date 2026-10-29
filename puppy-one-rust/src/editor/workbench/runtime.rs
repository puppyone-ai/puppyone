//! Retained workspace/document runtimes. Reuses Documents' save coordinator for
//! every Working Copy; focus/layout operations never run its read/save barriers.
//! A document host is retained until an explicit, successfully drained close.
use super::catalog::{Input, Workbench, resource_key};
use crate::{
    documents::{ClientMessage, Documents, HostMessage, Intent},
    model::Node,
    wake::Wake,
    workspace,
};
use std::{
    collections::BTreeMap,
    ops::{Deref, DerefMut},
    path::PathBuf,
};

mod drops;
mod operations;
mod persistence;
pub use drops::StateMut;
#[cfg(test)]
mod tests;
pub type SlotId = u64;
struct Slot {
    key: String,
    files: Documents,
    admitted: bool,
    opening: u64,
    closing: bool,
    reported_error: Option<String>,
    restoring: bool,
    drop_target: Option<drops::Target>,
}
struct Host {
    empty: Documents,
    state: Workbench,
    slots: BTreeMap<SlotId, Slot>,
    rows: Vec<Node>,
    interacted: bool,
    restore: Option<serde_json::Value>,
    metadata_loaded: bool,
    metadata_value: Option<serde_json::Value>,
    metadata_due: Option<std::time::Instant>,
    pane_lifetimes: BTreeMap<String, u64>,
    pane_serial: u64,
}
impl Host {
    fn interact(&mut self) {
        self.interacted = true;
        self.restore = None;
        // Restore-only copies have never owned input. Retire their channels and
        // watches before accepting an interaction; late completions are dropped.
        self.slots.retain(|_, slot| !slot.restoring);
    }
}
#[derive(Default)]
pub struct Runtime {
    /// Running and unreconciled file operations, and those waiting for an
    /// overlapping one (`ResourceOperationQueue`).
    mutations: Vec<operations::Mutation>,
    queued: std::collections::VecDeque<operations::Queued>,
    pub operation_results: Vec<(String, super::resource_operations::Outcome)>,
    scratch: Documents,
    hosts: BTreeMap<String, Host>,
    active: Option<String>,
    preparing: Option<Documents>,
    last_cloud_failure: Option<crate::workspace::cloud::opening::Failure>,
    /// A host was activated: subscribe its hosted documents on next poll.
    resume_cloud: bool,
    serial: u64,
    navigation: u64,
    quitting: bool,
    storage: Option<crate::platform::editor_state_storage::Storage>,
    metadata_inflight: usize,
    pub metadata_suspended: bool,
    pub allow_quit: bool,
    pub error: Option<String>,
    pub tree_update: Option<Vec<Node>>,
    pub children_update: Option<(PathBuf, workspace::Result<Vec<Node>>)>,
    /// Changes outside the focused document also invalidate tabs/layout once.
    pub generation: u64,
}
impl Deref for Runtime {
    type Target = Documents;
    fn deref(&self) -> &Documents {
        if let Some(host) = self.active.as_ref().and_then(|id| self.hosts.get(id)) {
            if let Some(key) = host.state.layout.active_editor()
                && let Some(slot) = host.slots.values().find(|s| s.admitted && s.key == key)
            {
                return &slot.files;
            }
            return &host.empty;
        }
        &self.scratch
    }
}
impl DerefMut for Runtime {
    fn deref_mut(&mut self) -> &mut Documents {
        if let Some(host) = self.active.as_ref().and_then(|id| self.hosts.get_mut(id)) {
            if let Some(key) = host.state.layout.active_editor()
                && let Some(id) = host
                    .slots
                    .iter()
                    .find(|(_, s)| s.admitted && s.key == key)
                    .map(|(id, _)| *id)
            {
                return &mut host.slots.get_mut(&id).unwrap().files;
            }
            return &mut host.empty;
        }
        &mut self.scratch
    }
}
impl Runtime {
    pub fn workspace_key(&self) -> Option<&str> {
        self.active.as_deref()
    }
    pub fn cancel_resize(&mut self, workspace: &str, split: &str, ratio: f64) {
        if let Some(host) = self.hosts.get_mut(workspace) {
            host.state.layout.resize(split, ratio);
        }
    }
    pub fn state(&self) -> Option<&Workbench> {
        self.active
            .as_ref()
            .and_then(|id| self.hosts.get(id))
            .map(|h| &h.state)
    }
    pub fn state_mut(&mut self) -> Option<StateMut<'_>> {
        self.active
            .as_ref()
            .and_then(|id| self.hosts.get_mut(id))
            .map(|h| {
                h.interact();
                h.sync_panes();
                StateMut(h)
            })
    }
    pub fn active_slot(&self) -> SlotId {
        self.state()
            .and_then(|s| s.layout.active_editor())
            .and_then(|key| self.slot_for_key(key))
            .unwrap_or(0)
    }
    pub fn slot_for_key(&self, key: &str) -> Option<SlotId> {
        self.active
            .as_ref()
            .and_then(|id| self.hosts.get(id))
            .and_then(|h| {
                h.slots
                    .iter()
                    .find(|(_, s)| s.admitted && s.key == key)
                    .map(|(id, _)| *id)
            })
    }
    pub fn visible_slots(&self) -> Vec<SlotId> {
        self.state()
            .map(|s| {
                s.layout
                    .root
                    .panes()
                    .into_iter()
                    .filter_map(|(_, key)| key.and_then(|k| self.slot_for_key(k)))
                    .collect()
            })
            .unwrap_or_else(|| vec![0])
    }
    pub fn slot(&self, id: SlotId) -> Option<&Documents> {
        if id == 0 {
            return Some(&self.scratch);
        }
        self.hosts
            .values()
            .find_map(|h| h.slots.get(&id).map(|s| &s.files))
    }
    /// The Save failed chip of one pane's document.
    pub fn retry_slot_save(&mut self, id: SlotId, wake: &Wake) {
        if let Some(files) = self.slot_mut(id) {
            files.retry_save(wake);
        }
    }
    fn slot_mut(&mut self, id: SlotId) -> Option<&mut Documents> {
        if id == 0 {
            return Some(&mut self.scratch);
        }
        self.hosts
            .values_mut()
            .find_map(|h| h.slots.get_mut(&id).map(|s| &mut s.files))
    }
    pub fn retained_slots(&self) -> Vec<SlotId> {
        std::iter::once(0)
            .chain(self.hosts.values().flat_map(|h| h.slots.keys().copied()))
            .collect()
    }
    pub fn busy(&self) -> bool {
        // A held resource barrier blocks its own paths and editor input, not
        // unrelated Explorer navigation or another retained project.
        let transitioning = |files: &Documents| files.busy() && !files.operation_ready();
        self.quitting
            || self.preparing.is_some()
            || transitioning(self.deref())
            || self
                .active
                .as_ref()
                .and_then(|key| self.hosts.get(key))
                .is_some_and(|host| host.slots.values().any(|s| transitioning(&s.files)))
    }
    pub fn open_paths(&self) -> Vec<PathBuf> {
        match self.active.as_ref().and_then(|key| self.hosts.get(key)) {
            Some(host) => host
                .slots
                .values()
                .filter_map(|s| s.files.opened().map(|(_, p)| p.to_owned()))
                .collect(),
            None => self
                .scratch
                .opened()
                .map(|(_, p)| vec![p.to_owned()])
                .unwrap_or_default(),
        }
    }
    /// Explicit Cloud opening in this window (`useCloudWorkspaceSwitch`):
    /// prepared beside the visible host, which stays retained and keeps its
    /// drafts; only a read root replaces what the window shows.
    pub fn open_cloud(
        &mut self,
        broker: std::sync::Arc<crate::cloud_auth::Broker>,
        binding: crate::cloud_auth::model::Binding,
        project: String,
        wake: &Wake,
    ) {
        if self.quitting {
            return;
        }
        self.navigation += 1;
        self.revoke_preparing();
        let mut preparing = Documents::default();
        preparing.open_cloud(broker, binding, project, wake);
        self.preparing = Some(preparing);
        self.generation += 1;
        wake.notify();
    }
    /// A newer selection replaces the one being prepared: a Cloud opening in
    /// flight is cancelled, never left to finish unobserved.
    fn revoke_preparing(&mut self) {
        if let Some(mut previous) = self.preparing.take() {
            previous.cancel_cloud();
        }
    }
    /// The visible phase of a Cloud opening in progress.
    pub fn cloud_opening(&self) -> Option<crate::workspace::cloud::opening::Phase> {
        self.preparing
            .as_ref()
            .and_then(|p| *p.cloud_phase.lock().unwrap())
            .or(*self.scratch.cloud_phase.lock().unwrap())
    }
    /// Why the last Cloud opening failed, taken once.
    pub fn take_cloud_failure(&mut self) -> Option<crate::workspace::cloud::opening::Failure> {
        self.last_cloud_failure.take()
    }
    /// Cancel a Cloud opening: the current host stays as it was.
    pub fn cancel_cloud(&mut self) {
        if let Some(preparing) = &mut self.preparing
            && preparing.cloud_phase.lock().unwrap().is_some()
        {
            preparing.cancel_cloud();
            self.preparing = None;
        }
        self.scratch.cancel_cloud();
        self.generation += 1;
    }
    /// Show a retained host again, without I/O (`returnToLocalWorkspace`,
    /// a kept-alive Cloud host). `false` when it is not retained.
    pub fn activate_host(&mut self, key: &str) -> bool {
        if self.quitting || !self.hosts.contains_key(key) {
            return false;
        }
        self.navigation += 1;
        self.revoke_preparing();
        self.activate_workspace(key.to_owned());
        true
    }
    /// Show no host (the Homepage covers the workspace chrome): a revoked
    /// Cloud selection. Retained hosts keep their drafts; nothing is closed
    /// or saved here.
    pub fn deactivate(&mut self) {
        self.navigation += 1;
        self.revoke_preparing();
        self.pause_hidden_cloud();
        self.active = None;
        self.generation += 1;
    }
    pub fn begin(&mut self, intent: Intent, wake: &Wake) {
        if self.quitting {
            return;
        }
        match intent {
            Intent::OpenFolder(path) => {
                self.navigation += 1;
                // Reuse only an already-admitted local root. No I/O on a hit.
                if let Some(key) = self
                    .hosts
                    .iter()
                    .find(|(_, h)| {
                        h.empty
                            .workspace
                            .as_ref()
                            .is_some_and(|ws| ws.local_root() == Some(path.as_path()))
                    })
                    .map(|(key, _)| key.clone())
                {
                    self.revoke_preparing();
                    self.activate_workspace(key);
                    wake.notify();
                    return;
                }
                self.revoke_preparing();
                let mut preparing = Documents::default();
                preparing.begin(Intent::OpenFolder(path), wake);
                self.preparing = Some(preparing);
            }
            Intent::OpenFile(path) => {
                if self.mutation_blocks(&path) {
                    self.error = Some("This resource has a pending file operation".into());
                    return;
                }
                let Some(ws) = self.workspace.clone() else {
                    self.scratch.begin(Intent::OpenFile(path), wake);
                    return;
                };
                if self.active.is_none() {
                    self.scratch.begin(Intent::OpenFile(path), wake);
                    return;
                }
                let key = match ws.resource_id(&path) {
                    Ok(id) if !id.path.is_root() => resource_key(&id),
                    _ => return,
                };
                self.navigation += 1;
                if self.slot_for_key(&key).is_some() {
                    self.activate(&key);
                    wake.notify();
                    return;
                }
                let host = self.hosts.get_mut(self.active.as_ref().unwrap()).unwrap();
                host.interact();
                if let Some(slot) = host.slots.values_mut().find(|s| s.key == key) {
                    slot.opening = self.navigation;
                    slot.restoring = false;
                    slot.drop_target = None;
                    return;
                }
                self.serial += 1;
                let mut files = Documents::in_workspace(ws);
                files.begin(Intent::OpenFile(path), wake);
                host.slots.insert(
                    self.serial,
                    Slot {
                        key,
                        files,
                        admitted: false,
                        opening: self.navigation,
                        closing: false,
                        reported_error: None,
                        restoring: false,
                        drop_target: None,
                    },
                );
            }
            Intent::CloseFile => {
                let id = self.active_slot();
                self.close_slot(id, wake);
            }
            Intent::Quit => {
                if !self.operations_idle() {
                    self.error = Some(
                        "Finish or reconcile the pending file operation before closing".into(),
                    );
                    return;
                }
                self.revoke_preparing();
                self.quitting = true;
                self.allow_quit = false;
                for id in self.retained_slots() {
                    if let Some(files) = self.slot_mut(id) {
                        files.begin(Intent::Quit, wake);
                    }
                }
            }
            other => self.deref_mut().begin(other, wake),
        }
        self.generation += 1;
        wake.notify();
    }
    pub fn activate(&mut self, key: &str) {
        if self.quitting {
            return;
        }
        self.navigation += 1;
        if let Some(mut state) = self.state_mut() {
            state.activate(key);
        }
        self.generation += 1;
    }
    pub fn focus(&mut self, pane: &str) {
        if self.quitting {
            return;
        }
        self.navigation += 1;
        if let Some(mut state) = self.state_mut() {
            state.focus(pane);
        }
        self.generation += 1;
    }
    pub fn close_slot(&mut self, id: SlotId, wake: &Wake) {
        if self.quitting {
            return;
        }
        if self.mutation_owns_slot(id) {
            self.error = Some(
                "Finish or reconcile the pending file operation before closing this document"
                    .into(),
            );
            return;
        }
        if id == 0 {
            self.scratch.begin(Intent::CloseFile, wake);
            return;
        }
        for host in self.hosts.values_mut() {
            if let Some(slot) = host.slots.get_mut(&id)
                && !slot.closing
                && !slot.files.busy()
            {
                slot.closing = true;
                slot.files.begin(Intent::CloseFile, wake);
            }
        }
        self.generation += 1;
    }
    fn activate_workspace(&mut self, key: String) {
        self.pause_hidden_cloud();
        let host = &self.hosts[&key];
        self.tree_update = Some(host.rows.clone());
        self.active = Some(key);
        self.resume_cloud = true;
        self.generation += 1;
    }
    /// The visible host leaves the screen: a hosted one releases its
    /// document subscriptions (Agent runs are not this host's to stop).
    fn pause_hidden_cloud(&mut self) {
        if let Some(host) = self.active.as_ref().and_then(|key| self.hosts.get_mut(key))
            && host
                .empty
                .workspace
                .as_ref()
                .is_some_and(|ws| ws.local_root().is_none())
        {
            for slot in host.slots.values_mut() {
                slot.files.pause_watch();
            }
        }
    }
    /// A hosted host shows again: subscribe and revalidate its documents.
    fn resume_visible_cloud(&mut self, wake: &Wake) {
        if let Some(host) = self.active.as_ref().and_then(|key| self.hosts.get_mut(key))
            && host
                .empty
                .workspace
                .as_ref()
                .is_some_and(|ws| ws.local_root().is_none())
        {
            for slot in host.slots.values_mut() {
                slot.files.resume_watch(wake);
            }
        }
    }
    pub fn client_for(&mut self, slot: SlotId, message: ClientMessage, wake: &Wake) {
        // Hidden slots may acknowledge snapshots and save, but cannot navigate.
        if let ClientMessage::OpenPaths { paths } = message {
            if slot == self.active_slot()
                && let Some(path) = paths.first()
            {
                self.begin(
                    Intent::OpenFile(PathBuf::from(path.trim_start_matches('/'))),
                    wake,
                );
            }
            return;
        }
        if let Some(files) = self.slot_mut(slot) {
            files.client(message, wake);
        }
    }
    pub fn take_outgoing(&mut self) -> Vec<(SlotId, HostMessage)> {
        let mut messages: Vec<_> = std::mem::take(&mut self.scratch.outgoing)
            .into_iter()
            .map(|m| (0, m))
            .collect();
        for host in self.hosts.values_mut() {
            for (id, slot) in &mut host.slots {
                messages.extend(
                    std::mem::take(&mut slot.files.outgoing)
                        .into_iter()
                        .map(|m| (*id, m)),
                );
            }
        }
        messages
    }
    pub fn load_children(&mut self, path: PathBuf, wake: &Wake) {
        if let Some(host) = self.active.as_ref().and_then(|id| self.hosts.get_mut(id)) {
            host.empty.load_children(path, wake);
        } else {
            self.scratch.load_children(path, wake);
        }
    }
    pub fn cancel_quit(&mut self, wake: &Wake) {
        self.quitting = false;
        self.allow_quit = false;
        for id in self.retained_slots() {
            if let Some(files) = self.slot_mut(id) {
                files.cancel_quit(wake);
            }
        }
    }
    pub fn poll(&mut self, wake: &Wake) {
        if std::mem::take(&mut self.resume_cloud) {
            self.resume_visible_cloud(wake);
        }
        self.poll_metadata(wake);
        self.scratch.poll(wake);
        if self.active.is_none() {
            self.tree_update = self.scratch.tree_update.take().or(self.tree_update.take());
            self.children_update = self.scratch.children_update.take();
        }
        if let Some(preparing) = &mut self.preparing {
            preparing.poll(wake);
            if let Some(error) = preparing.error.take() {
                let failure = preparing.cloud_failure.lock().unwrap().take();
                // A Header switch shows its own recovery; other openings
                // report through the error dialog.
                match failure {
                    Some(failure) => self.last_cloud_failure = Some(failure),
                    None => self.error = Some(error),
                }
                self.preparing = None;
            } else if let Some(rows) = preparing.tree_update.take() {
                let ws = preparing.workspace.clone().unwrap();
                let key = resource_key(&ws.resource_id(std::path::Path::new("")).unwrap());
                // The same storage reopened under a new lease (the same
                // account's Project root): its retained Working Copies are
                // rebound, never replaced, and keep their drafts.
                if let Some(host) = self.hosts.get_mut(&key)
                    && host
                        .empty
                        .workspace
                        .as_ref()
                        .is_none_or(|current| !std::sync::Arc::ptr_eq(current, &ws))
                {
                    if let Some(previous) = host.empty.workspace.take() {
                        previous.revoke();
                    }
                    host.empty = Documents::in_workspace(ws.clone());
                    host.rows = rows.clone();
                    for slot in host.slots.values_mut() {
                        slot.files.rebind_workspace(ws.clone(), wake);
                    }
                }
                if !self.hosts.contains_key(&key) {
                    self.hosts.insert(
                        key.clone(),
                        Host {
                            empty: Documents::in_workspace(ws),
                            state: Workbench::default(),
                            slots: BTreeMap::new(),
                            rows,
                            interacted: false,
                            restore: None,
                            metadata_loaded: self
                                .storage
                                .as_ref()
                                .is_none_or(|store| !store.load(key.clone(), wake)),
                            metadata_value: None,
                            metadata_due: None,
                            pane_lifetimes: BTreeMap::new(),
                            pane_serial: 0,
                        },
                    );
                }
                self.preparing = None;
                self.activate_workspace(key);
            }
        }
        let mut quit_failed = false;
        for (key, host) in &mut self.hosts {
            host.empty.poll(wake);
            if self.active.as_ref() == Some(key) {
                self.children_update = host
                    .empty
                    .children_update
                    .take()
                    .or(self.children_update.take());
            }
            let mut remove = Vec::new();
            for (id, slot) in &mut host.slots {
                let before = slot.files.status_key();
                slot.files.poll(wake);
                if before != slot.files.status_key() {
                    self.generation += 1;
                }
                if let Some(error) = &slot.files.error {
                    if !slot.restoring && slot.reported_error.as_ref() != Some(error) {
                        self.error = Some(error.clone());
                        slot.reported_error = Some(error.clone());
                    }
                    if !slot.admitted {
                        remove.push(*id);
                    }
                    if !slot.files.busy() && slot.files.opened().is_some() {
                        slot.closing = false;
                        quit_failed |= self.quitting;
                    }
                }
                if !slot.admitted
                    && let Some((_, path)) = slot.files.opened()
                {
                    let input = Input {
                        id: slot.key.clone(),
                        label: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                    };
                    if let Some(target) = slot.drop_target.take() {
                        if host.pane_lifetimes.get(&target.pane) == Some(&target.lifetime) {
                            host.state.open_at_edge(
                                input,
                                &target.pane,
                                target.direction,
                                target.placement,
                            );
                        } else {
                            remove.push(*id);
                        }
                    } else if slot.restoring {
                        if host.restore.is_none() {
                            remove.push(*id);
                        }
                    } else if slot.opening == self.navigation && self.active.as_ref() == Some(key) {
                        host.state.open(input);
                    } else {
                        host.state.catalog.editors.push(input);
                    }
                    slot.admitted = true;
                    self.generation += 1;
                }
                if slot.closing && !slot.files.busy() && slot.files.opened().is_none() {
                    host.state.close(&slot.key);
                    remove.push(*id);
                    self.generation += 1;
                }
                if self.quitting
                    && !slot.files.allow_quit
                    && !slot.files.busy()
                    && slot.files.error.is_none()
                {
                    slot.files.begin(Intent::Quit, wake);
                }
            }
            for id in remove {
                host.slots.remove(&id);
            }
            host.sync_panes();
        }
        if let Some(error) = self.scratch.error.take() {
            self.error = Some(error);
            quit_failed |= self.quitting;
        }
        if quit_failed {
            self.cancel_quit(wake);
        }
        self.poll_mutations(wake);
        self.poll_metadata(wake);
        self.persist_metadata(wake, self.quitting);
        if self.quitting {
            self.allow_quit = self.metadata_inflight == 0
                && self.hosts.values().all(|h| h.metadata_due.is_none())
                && self
                    .retained_slots()
                    .into_iter()
                    .all(|id| self.slot(id).is_some_and(|f| f.allow_quit));
        }
    }
}
