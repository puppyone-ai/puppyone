use super::*;
use crate::editor::workbench::resource_operations::{
    self as operations, Binding, Completed, Operation, Outcome, Receipt, Update,
};
use std::sync::{Arc, mpsc};

pub(super) struct Mutation {
    owner: String,
    workspace: Arc<workspace::Workspace>,
    operation: Operation,
    slots: Vec<SlotId>,
    rx: Option<mpsc::Receiver<Completed>>,
    receipt: Option<Receipt>,
    held: bool,
}
impl Mutation {
    fn launch(&mut self, host: &Host, wake: &Wake) {
        let bindings = self
            .slots
            .iter()
            .filter_map(|id| {
                let files = &host.slots.get(id)?.files;
                Some(Binding {
                    slot: *id,
                    path: files.opened()?.1.into(),
                    document: files.document.clone(),
                })
            })
            .collect::<Vec<_>>();
        let (tx, rx) = mpsc::sync_channel(1);
        let (workspace, operation, previous, wake) = (
            self.workspace.clone(),
            self.operation.clone(),
            self.receipt.take(),
            wake.clone(),
        );
        self.held = false;
        self.rx = Some(rx);
        crate::localization::spawn(move || {
            let _ = tx.send(operations::execute(
                workspace, &operation, &bindings, previous,
            ));
            wake.notify();
        });
    }
}
impl Runtime {
    pub(super) fn mutation_owns_slot(&self, slot: SlotId) -> bool {
        self.mutation
            .as_ref()
            .is_some_and(|m| m.slots.contains(&slot))
    }
    pub fn can_retry_operation(&self) -> bool {
        self.mutation
            .as_ref()
            .is_some_and(|m| m.held && m.receipt.is_some())
    }
    pub fn retry_operation(&mut self, wake: &Wake) {
        if let Some(mutation) = &mut self.mutation
            && mutation.held
            && mutation.receipt.is_some()
        {
            mutation.launch(&self.hosts[&mutation.owner], wake);
        }
    }

    pub fn resource_operation(&mut self, operation: Operation, wake: &Wake) -> Result<(), String> {
        if self.quitting {
            return Err("Wait for the window close operation to finish".into());
        }
        let operation = operation.normalized();
        let owner = self.active.clone().ok_or("Open a workspace first")?;
        if let Some(pending) = &mut self.mutation {
            if pending.owner == owner
                && pending.operation == operation
                && pending.held
                && pending.receipt.is_some()
            {
                pending.launch(&self.hosts[&owner], wake);
                return Ok(());
            }
            return Err("Finish or reconcile the pending file operation first".into());
        }
        let host = self
            .hosts
            .get_mut(&owner)
            .ok_or("Workspace is unavailable")?;
        let workspace = host
            .empty
            .workspace
            .clone()
            .ok_or("Workspace is unavailable")?;
        if !operation.allowed(workspace.capabilities()) {
            return Err(workspace::Error::unsupported().to_string());
        }
        let sources = operation.sources();
        let destinations = operation.destinations();
        let affected = |path: &std::path::Path| sources.iter().any(|p| path.starts_with(p));
        if host.slots.values().any(|slot| !slot.admitted) {
            return Err("Wait for the opening documents to finish loading".into());
        }
        if operation.changes_identity()
            && host.slots.values().any(|slot| {
                slot.files.opened().is_some_and(|(_, path)| {
                    !affected(path) && destinations.iter().any(|p| path.starts_with(p))
                })
            })
        {
            return Err("The destination already has an open document".into());
        }
        let slots: Vec<_> = host
            .slots
            .iter()
            .filter(|(_, slot)| slot.files.opened().is_some_and(|(_, p)| affected(p)))
            .map(|(id, _)| *id)
            .collect();
        if slots
            .iter()
            .any(|id| !host.slots[id].files.can_prepare_operation() || host.slots[id].closing)
        {
            return Err("Wait for the affected documents to finish their current operation".into());
        }
        for id in &slots {
            host.slots
                .get_mut(id)
                .unwrap()
                .files
                .begin(Intent::PrepareOperation, wake);
        }
        self.mutation = Some(Mutation {
            owner,
            workspace,
            operation,
            slots,
            rx: None,
            receipt: None,
            held: false,
        });
        wake.notify();
        Ok(())
    }
    pub(super) fn mutation_blocks(&self, path: &std::path::Path) -> bool {
        self.mutation.as_ref().is_some_and(|m| {
            self.active.as_ref() == Some(&m.owner)
                && m.operation
                    .sources()
                    .into_iter()
                    .chain(m.operation.destinations())
                    .any(|p| path.starts_with(p))
        })
    }
    pub(super) fn poll_mutation(&mut self, wake: &Wake) {
        let Some(mut mutation) = self.mutation.take() else {
            return;
        };
        let host = self
            .hosts
            .get_mut(&mutation.owner)
            .expect("mutation retains workspace");
        if mutation.held {
            self.mutation = Some(mutation);
            return;
        }
        if mutation.rx.is_none() {
            let failure = mutation
                .slots
                .iter()
                .filter_map(|id| host.slots.get(id))
                .find_map(|slot| {
                    (!slot.files.busy())
                        .then(|| slot.files.error.clone())
                        .flatten()
                });
            if let Some(error) = failure {
                for id in &mutation.slots {
                    host.slots
                        .get_mut(id)
                        .unwrap()
                        .files
                        .release_operation(wake);
                }
                self.operation_results.push((
                    mutation.owner,
                    Outcome {
                        listings: vec![],
                        moved: vec![],
                        removed: vec![],
                        select: None,
                        error: Some(error),
                    },
                ));
                return;
            }
            if mutation
                .slots
                .iter()
                .all(|id| host.slots[id].files.operation_ready())
            {
                mutation.launch(host, wake);
            }
            self.mutation = Some(mutation);
            return;
        }
        let completed = match mutation.rx.as_ref().unwrap().try_recv() {
            Ok(completed) => completed,
            Err(mpsc::TryRecvError::Empty) => {
                self.mutation = Some(mutation);
                return;
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                mutation.held = true;
                // Worker loss cannot establish whether the provider mutated.
                self.operation_results.push((
                    mutation.owner.clone(),
                    Outcome {
                        listings: vec![],
                        moved: vec![],
                        removed: vec![],
                        select: None,
                        error: Some(
                            "File operation interrupted; the affected documents remain protected"
                                .into(),
                        ),
                    },
                ));
                self.mutation = Some(mutation);
                return;
            }
        };
        mutation.rx = None;
        if completed.uncertain {
            mutation.receipt = Some(completed.receipt);
            mutation.held = true;
            self.operation_results
                .push((mutation.owner.clone(), completed.outcome));
            self.mutation = Some(mutation);
            return;
        }
        for update in completed.updates {
            let (id, path) = match update {
                Update::Document(id, document) => {
                    let path = document.relative.clone();
                    host.slots
                        .get_mut(&id)
                        .unwrap()
                        .files
                        .rebind_document(document);
                    (id, Some(path))
                }
                Update::Resource(id, path, preview) => {
                    host.slots
                        .get_mut(&id)
                        .unwrap()
                        .files
                        .rebind_resource(path.clone(), preview);
                    (id, Some(path))
                }
                Update::Removed(id) => (id, None),
            };
            let slot = host.slots.get_mut(&id).unwrap();
            if let Some(path) = path {
                let key = resource_key(
                    &mutation
                        .workspace
                        .resource_id(&path)
                        .expect("admitted path"),
                );
                host.state.rebind(
                    &slot.key,
                    Input {
                        id: key.clone(),
                        label: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                    },
                );
                slot.key = key;
            } else {
                slot.files.remove_after_operation(wake);
                host.state.close(&slot.key);
                host.slots.remove(&id);
            }
        }
        for id in &mutation.slots {
            if let Some(slot) = host.slots.get_mut(id) {
                slot.files.release_operation(wake);
            }
        }
        self.operation_results
            .push((mutation.owner, completed.outcome));
        self.generation += 1;
    }
}
