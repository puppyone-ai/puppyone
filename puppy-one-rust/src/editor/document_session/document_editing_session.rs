//! Rust counterpart of DocumentEditingSession.ts: one write, one latest pending
//! candidate, disk-authoritative epochs, and a drain barrier independent of UI.
use super::types::{Commit, Completion, Snapshot, StorageObservation};

pub struct DocumentEditingSession {
    pub id: String,
    pub baseline: String,
    pub revision: u64,
    pub epoch: u64,
    pub dirty: bool,
    pub needs_snapshot: bool,
    pub error: Option<String>,
    active: Option<Commit>,
    pending: Option<Snapshot>,
    sequence: u64,
    receipt: Option<Snapshot>,
    /// Cloud persistence keeps unsaved input over newer remote content.
    pub cloud: bool,
    /// The deferred remote baseline (`externalBaseline`).
    pub external: Option<String>,
}
impl DocumentEditingSession {
    pub fn new(id: String, baseline: String, revision: u64) -> Self {
        Self {
            id,
            baseline,
            revision,
            epoch: 0,
            dirty: false,
            needs_snapshot: false,
            error: None,
            active: None,
            pending: None,
            sequence: 0,
            receipt: None,
            cloud: false,
            external: None,
        }
    }
    /// The draft held while a Cloud baseline is deferred is never written.
    pub fn conflicted(&self) -> bool {
        self.external.is_some()
    }
    /// `reloadExternalBaseline`: the person discards edits for the remote text.
    pub fn reload_external(&mut self) -> Option<String> {
        let text = self.external.take()?;
        self.adopt(text.clone());
        Some(text)
    }
    fn defer(&mut self, text: String) {
        self.epoch += 1;
        self.external = Some(text);
        self.pending = None;
        self.dirty = true;
        self.needs_snapshot = false;
        self.error = Some("external-conflict".into());
    }
    /// Lifecycle/appearance events never call this. A revision notification is
    /// cheap; serialization is deferred to the next foreground event turn.
    pub fn local_edit(&mut self, revision: u64, dirty: bool) {
        if revision < self.revision {
            return;
        }
        if self.external.is_some() {
            // Edits continue on the preserved draft; nothing is written.
            self.revision = revision;
            self.dirty = true;
            return;
        }
        if revision > self.revision {
            self.error = None;
        }
        self.revision = revision;
        self.dirty = dirty || self.active.is_some() || self.pending.is_some();
        if self.dirty && self.error.is_none() {
            self.needs_snapshot = true;
        }
    }
    pub fn enqueue(&mut self, snapshot: Snapshot) {
        if self.external.is_some() {
            self.revision = self.revision.max(snapshot.revision);
            self.needs_snapshot = false;
            return;
        }
        if snapshot.revision < self.revision {
            self.needs_snapshot = true;
            return;
        }
        self.revision = snapshot.revision;
        self.needs_snapshot = false;
        self.error = None;
        // An external observation retired the active write. Its exit is still
        // awaited, but adopted disk bytes must never become a compensating save.
        if snapshot.text == self.baseline
            && self.active.as_ref().is_none_or(|c| c.epoch != self.epoch)
        {
            self.pending = None;
            self.dirty = false;
            self.receipt = Some(snapshot);
            return;
        }
        self.dirty = true;
        self.pending = Some(snapshot);
    }
    pub fn next_commit(&mut self) -> Option<Commit> {
        if self.active.is_some() {
            return None;
        }
        let snapshot = self.pending.take()?;
        if snapshot.text == self.baseline {
            self.dirty = snapshot.revision != self.revision;
            self.needs_snapshot |= self.dirty;
            self.receipt = Some(snapshot);
            return None;
        }
        self.sequence += 1;
        self.error = None;
        let commit = Commit {
            sequence: self.sequence,
            epoch: self.epoch,
            snapshot,
        };
        self.active = Some(commit.clone());
        Some(commit)
    }
    pub fn observe(&mut self, text: &str) -> StorageObservation {
        if text == self.baseline {
            return StorageObservation::Baseline;
        }
        if self.external.as_deref() == Some(text) {
            return StorageObservation::Deferred;
        }
        if self
            .active
            .as_ref()
            .is_some_and(|c| c.epoch == self.epoch && c.snapshot.text == text)
        {
            return StorageObservation::OwnWrite;
        }
        if self.cloud && (self.dirty || self.active.is_some()) {
            self.defer(text.to_owned());
            return StorageObservation::Deferred;
        }
        self.adopt(text.to_owned());
        StorageObservation::Adopted
    }
    fn adopt(&mut self, text: String) {
        self.epoch += 1;
        self.revision += 1;
        self.baseline = text;
        self.pending = None;
        self.receipt = None;
        self.needs_snapshot = false;
        self.dirty = false;
        self.error = None;
        self.external = None;
    }
    /// `updated` is a conditional-write rejection carrying a verified disk
    /// snapshot. It is ordinary storage reconciliation, never a conflict dialog.
    pub fn complete(
        &mut self,
        sequence: u64,
        result: Result<(String, bool), String>,
    ) -> Completion {
        if self.active.as_ref().is_none_or(|c| c.sequence != sequence) {
            return Completion::Retired;
        }
        let commit = self.active.take().unwrap();
        if commit.epoch != self.epoch {
            return Completion::Retired;
        }
        match result {
            // Converged: the remote already holds exactly this draft (a
            // retried uncertain write that had landed).
            Ok((text, true)) if self.cloud && text != commit.snapshot.text => {
                self.defer(text);
                Completion::Deferred
            }
            Ok((text, true)) => {
                self.adopt(text);
                Completion::Adopted
            }
            Ok((text, false)) => {
                self.baseline = text.clone();
                self.receipt = Some(Snapshot {
                    revision: commit.snapshot.revision,
                    text,
                });
                self.error = None;
                self.dirty = self.revision != commit.snapshot.revision;
                if self.dirty && self.pending.is_none() {
                    self.needs_snapshot = true;
                }
                Completion::Saved
            }
            Err(message) => {
                self.error = Some(message.clone());
                self.dirty = true;
                self.needs_snapshot = false;
                Completion::Failed(message)
            }
        }
    }
    /// `requestSave` after a failed write: snapshot and write again. A held
    /// Cloud conflict is not retried (`retryable` is false for it).
    pub fn retry(&mut self) -> bool {
        if self.error.is_none() || self.external.is_some() || self.active.is_some() {
            return false;
        }
        self.error = None;
        self.needs_snapshot = true;
        true
    }
    pub fn take_receipt(&mut self) -> Option<Snapshot> {
        self.receipt.take()
    }
    pub fn has_active_write(&self) -> bool {
        self.active.is_some()
    }
    pub fn drained(&self) -> bool {
        !self.dirty && !self.needs_snapshot && self.active.is_none() && self.pending.is_none()
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;

    #[test]
    fn a_failed_write_can_be_retried_but_a_held_conflict_cannot() {
        let mut session = DocumentEditingSession::new("a".into(), "old".into(), 0);
        session.enqueue(Snapshot {
            revision: 1,
            text: "new".into(),
        });
        let commit = session.next_commit().unwrap();
        assert!(!session.retry(), "nothing failed while writing");
        session.complete(commit.sequence, Err("disk full".into()));
        assert!(!session.needs_snapshot);
        assert!(session.retry());
        assert!(session.needs_snapshot && session.error.is_none());
        let mut cloud = DocumentEditingSession::new("b".into(), "old".into(), 0);
        cloud.cloud = true;
        cloud.local_edit(1, true);
        cloud.observe("remote");
        assert!(cloud.conflicted());
        assert!(!cloud.retry());
    }
}
