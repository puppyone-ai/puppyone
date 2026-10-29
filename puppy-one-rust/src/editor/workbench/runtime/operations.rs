use super::*;
use crate::editor::workbench::resource_operations::{
    self as operations, Binding, Completed, Operation, Outcome, Receipt, Update,
};
use std::sync::{Arc, mpsc};

/// `ResourceOperationQueue`'s pending limit.
const MAX_QUEUED: usize = 256;

/// An operation waiting for an overlapping one to finish.
pub(super) struct Queued {
    owner: String,
    operation: Operation,
}

/// Every path an operation reserves (sources and destinations).
fn scopes(operation: &Operation) -> Vec<std::path::PathBuf> {
    let mut out = operation.sources();
    out.extend(operation.destinations());
    out
}
/// `overlaps`: the same resource, or one inside the other (the root
/// contains everything).
fn overlaps(left: &[std::path::PathBuf], right: &[std::path::PathBuf]) -> bool {
    left.iter()
        .any(|a| right.iter().any(|b| a.starts_with(b) || b.starts_with(a)))
}

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
    /// Its outcome is unknown and it waits for reconciliation.
    fn uncertain(&self) -> bool {
        self.held && self.receipt.is_some()
    }
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
        self.mutations.iter().any(|m| m.slots.contains(&slot))
    }
    /// No file operation is running, waiting or unreconciled.
    pub(super) fn operations_idle(&self) -> bool {
        self.mutations.is_empty() && self.queued.is_empty()
    }
    pub fn can_retry_operation(&self) -> bool {
        self.mutations.iter().any(Mutation::uncertain)
    }
    /// Reconcile every operation whose outcome is unknown (never repeating it).
    pub fn retry_operation(&mut self, wake: &Wake) {
        for mutation in self.mutations.iter_mut().filter(|m| m.uncertain()) {
            mutation.launch(&self.hosts[&mutation.owner], wake);
        }
    }

    /// `documentOperationQueue.run`: operations on disjoint resources run
    /// at once; one overlapping a running or waiting operation waits for it
    /// (at most 256 wait); one overlapping an unreconciled operation is
    /// refused, except the same operation, which reconciles it.
    pub fn resource_operation(&mut self, operation: Operation, wake: &Wake) -> Result<(), String> {
        if self.quitting {
            return Err("Wait for the window close operation to finish".into());
        }
        let operation = operation.normalized();
        let owner = self.active.clone().ok_or("Open a workspace first")?;
        if let Some(pending) = self
            .mutations
            .iter_mut()
            .find(|m| m.owner == owner && m.operation == operation && m.uncertain())
        {
            pending.launch(&self.hosts[&owner], wake);
            return Ok(());
        }
        let reserved = scopes(&operation);
        if self.mutations.iter().any(|m| {
            m.owner == owner && m.uncertain() && overlaps(&scopes(&m.operation), &reserved)
        }) {
            return Err("A previous operation on this resource must be reconciled first".into());
        }
        let busy = self
            .mutations
            .iter()
            .map(|m| (&m.owner, &m.operation))
            .chain(self.queued.iter().map(|q| (&q.owner, &q.operation)))
            .any(|(o, op)| *o == owner && overlaps(&scopes(op), &reserved));
        if busy {
            if self.queued.len() >= MAX_QUEUED {
                return Err("Too many pending document operations".into());
            }
            self.queued.push_back(Queued { owner, operation });
            wake.notify();
            return Ok(());
        }
        self.start_operation(owner, operation, wake)
    }

    /// Prepare the affected documents and reserve the operation's scopes.
    fn start_operation(
        &mut self,
        owner: String,
        operation: Operation,
        wake: &Wake,
    ) -> Result<(), String> {
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
        self.mutations.push(Mutation {
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
    /// `isBlocked`: a running, waiting or unreconciled operation reserves `path`.
    pub(super) fn mutation_blocks(&self, path: &std::path::Path) -> bool {
        let path = [path.to_path_buf()];
        self.mutations
            .iter()
            .map(|m| (&m.owner, &m.operation))
            .chain(self.queued.iter().map(|q| (&q.owner, &q.operation)))
            .any(|(owner, operation)| {
                self.active.as_ref() == Some(owner) && overlaps(&scopes(operation), &path)
            })
    }
    pub(super) fn poll_mutations(&mut self, wake: &Wake) {
        for mutation in std::mem::take(&mut self.mutations) {
            if let Some(pending) = self.poll_mutation(mutation, wake) {
                self.mutations.push(pending);
            }
        }
        self.pump_operations(wake);
    }
    /// Start waiting operations in order once nothing they overlap remains
    /// ahead of them; refuse those an unreconciled operation now covers.
    fn pump_operations(&mut self, wake: &Wake) {
        let mut waiting: std::collections::VecDeque<Queued> = Default::default();
        while let Some(queued) = self.queued.pop_front() {
            let reserved = scopes(&queued.operation);
            let same = |owner: &String| *owner == queued.owner;
            let refusal = if self.mutations.iter().any(|m| {
                same(&m.owner) && m.uncertain() && overlaps(&scopes(&m.operation), &reserved)
            }) {
                Some("A previous operation on this resource must be reconciled first".to_owned())
            } else if self
                .mutations
                .iter()
                .map(|m| (&m.owner, &m.operation))
                .chain(waiting.iter().map(|q| (&q.owner, &q.operation)))
                .any(|(o, op)| same(o) && overlaps(&scopes(op), &reserved))
            {
                waiting.push_back(queued);
                continue;
            } else {
                self.start_operation(queued.owner.clone(), queued.operation, wake)
                    .err()
            };
            if let Some(error) = refusal {
                self.operation_results.push((
                    queued.owner,
                    Outcome {
                        listings: vec![],
                        moved: vec![],
                        removed: vec![],
                        select: None,
                        error: Some(error),
                    },
                ));
            }
        }
        self.queued = waiting;
    }
    /// Advance one operation; `Some` while it is still pending.
    fn poll_mutation(&mut self, mut mutation: Mutation, wake: &Wake) -> Option<Mutation> {
        let host = self
            .hosts
            .get_mut(&mutation.owner)
            .expect("mutation retains workspace");
        if mutation.held {
            return Some(mutation);
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
                return None;
            }
            if mutation
                .slots
                .iter()
                .all(|id| host.slots[id].files.operation_ready())
            {
                mutation.launch(host, wake);
            }
            return Some(mutation);
        }
        let completed = match mutation.rx.as_ref().unwrap().try_recv() {
            Ok(completed) => completed,
            Err(mpsc::TryRecvError::Empty) => return Some(mutation),
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
                return Some(mutation);
            }
        };
        mutation.rx = None;
        if completed.uncertain {
            mutation.receipt = Some(completed.receipt);
            mutation.held = true;
            self.operation_results
                .push((mutation.owner.clone(), completed.outcome));
            return Some(mutation);
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
        None
    }
}
