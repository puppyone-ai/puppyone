//! Rust counterpart of `DocumentEditingSession.ts`, extended with 3-way text
//! reconciliation (`DP-01`, `DP-04`, `DP-05`), typed outcomes/errors (`DP-43`),
//! and `$O(1)$`-shared rope `Buffer` snapshots with summary + `blake3` fast-path
//! comparison (`DP-44`). Pure state machine: zero UI or I/O dependencies.

use super::types::{
    Commit, Completion, ConflictState, IntoBuffer, SessionError, Snapshot, StorageObservation,
    WriteOutcome,
};
use crate::{
    documents::reconcile::{WorkspaceReconcile, reconcile_workspace},
    editor::text::buffer::Buffer,
};

/// Streams a `Buffer`'s rope leaves through `blake3` without materialising a
/// contiguous flat `String` (`DP-44`).
pub fn hash_buffer(buffer: &Buffer) -> blake3::Hash {
    let mut hasher = blake3::Hasher::new();
    for chunk in buffer.chunks_in(0..buffer.len()) {
        hasher.update(chunk.as_bytes());
    }
    hasher.finalize()
}

/// Fast equality check (`DP-44`): checks `$O(1)$` rope `TextSummary`
/// (`bytes`, `utf16`, `lines`) before `Rope` pointer/chunk comparison.
#[inline]
pub fn fast_buffer_eq(a: &Buffer, b: &Buffer) -> bool {
    a.summary() == b.summary() && a == b
}

pub struct DocumentEditingSession {
    pub id: String,
    pub baseline: Buffer,
    baseline_hash: blake3::Hash,
    pub revision: u64,
    pub epoch: u64,
    pub dirty: bool,
    pub needs_snapshot: bool,
    pub error: Option<SessionError>,
    active: Option<Commit>,
    pending: Option<Snapshot>,
    live_ours: Option<(u64, Buffer)>,
    sequence: u64,
    receipt: Option<Snapshot>,
    /// Hosted persistence keeps overlapping unsaved input deferred (`DP-05`).
    pub cloud: bool,
    /// Structured hosted conflict state (`DP-05`, `DP-43`).
    pub conflict: Option<ConflictState>,
    /// Forces the next snapshot to write even if text matches `baseline`
    /// (for example after explicit `DP-31` line-ending normalization).
    pub force_write_baseline: bool,
}

impl DocumentEditingSession {
    pub fn new(id: String, baseline: impl IntoBuffer, revision: u64) -> Self {
        let baseline = baseline.into_buffer();
        let baseline_hash = hash_buffer(&baseline);
        Self {
            id,
            baseline,
            baseline_hash,
            revision,
            epoch: 0,
            dirty: false,
            needs_snapshot: false,
            error: None,
            active: None,
            pending: None,
            live_ours: None,
            sequence: 0,
            receipt: None,
            cloud: false,
            conflict: None,
            force_write_baseline: false,
        }
    }

    pub fn baseline_hash(&self) -> blake3::Hash {
        self.baseline_hash
    }

    fn set_baseline(&mut self, baseline: Buffer) {
        self.baseline_hash = hash_buffer(&baseline);
        self.baseline = baseline;
    }

    #[inline]
    fn matches_baseline(&self, candidate: &Buffer) -> bool {
        if candidate.summary() != self.baseline.summary() {
            return false;
        }
        if candidate == &self.baseline {
            return true;
        }
        hash_buffer(candidate) == self.baseline_hash
    }

    /// True while a hosted conflict is awaiting one of the 4 resolution exits (`DP-05`).
    pub fn conflicted(&self) -> bool {
        self.conflict.is_some()
    }

    /// Current deferred remote text when conflicted.
    pub fn external_text(&self) -> Option<&Buffer> {
        self.conflict.as_ref().map(|c| &c.theirs)
    }

    /// Latest known local draft text (`ours`) for journaling (`DP-10`) or
    /// conflict exits (`DP-05`).
    pub fn latest_draft_buffer(&self) -> Buffer {
        if let Some(conflict) = &self.conflict {
            return conflict.ours.clone();
        }
        let (ours, _) = self.resolve_ours(None);
        ours
    }

    /// True when `local_edit` reported a newer revision than any received
    /// `LiveBuffer` or `Snapshot`.
    pub fn has_unsnapshotted_edits(&self) -> bool {
        let (_, untracked) = self.resolve_ours(None);
        untracked
    }

    /// Records the editor's live `$O(1)$` rope snapshot on keystrokes so
    /// asynchronous observations can 3-way merge immediately even before the
    /// `800ms` autosave timer fires (`DP-01`, `DP-44`).
    pub fn record_live_buffer(&mut self, revision: u64, buffer: Buffer) {
        if revision < self.revision {
            return;
        }
        self.revision = revision;
        self.live_ours = Some((revision, buffer.clone()));
        if let Some(conflict) = &mut self.conflict {
            conflict.ours = buffer;
        }
    }

    /// Exit 3 (`Accept Remote` / `reloadExternalBaseline`): adopts the deferred
    /// remote baseline and clears the conflict (`DP-05`).
    pub fn reload_external(&mut self) -> Option<Buffer> {
        let state = self.conflict.take()?;
        let theirs = state.theirs;
        self.adopt_clean(theirs.clone());
        Some(theirs)
    }

    /// Exit 2 (`Keep Mine` / `Command::KeepLocalCloudDraft`): rebases `ours`
    /// onto the deferred remote baseline and queues a conditional write (`DP-05`).
    pub fn keep_local(&mut self) -> Option<Buffer> {
        let state = self.conflict.take()?;
        let ours = self
            .live_ours
            .as_ref()
            .filter(|(rev, _)| *rev >= self.revision)
            .map(|(_, b)| b.clone())
            .unwrap_or(state.ours);
        let theirs = state.theirs;

        self.epoch += 1;
        self.set_baseline(theirs);
        self.error = None;
        self.dirty = true;
        self.force_write_baseline = self.matches_baseline(&ours);

        let untracked = self
            .live_ours
            .as_ref()
            .is_some_and(|(rev, _)| *rev < self.revision);
        if untracked {
            self.pending = None;
            self.needs_snapshot = true;
        } else {
            self.revision = self.revision.max(1);
            self.live_ours = Some((self.revision, ours.clone()));
            self.needs_snapshot = false;
            self.pending = Some(Snapshot {
                revision: self.revision,
                text: ours.clone(),
            });
        }
        Some(ours)
    }

    /// Enters deferred conflict state explicitly (including `DP-11` crash recovery
    /// when hosted storage changed while closed).
    pub fn enter_conflict(
        &mut self,
        base: impl IntoBuffer,
        ours: impl IntoBuffer,
        theirs: impl IntoBuffer,
        remote_revision: Option<String>,
    ) -> ConflictState {
        let base = base.into_buffer();
        let ours = ours.into_buffer();
        let theirs = theirs.into_buffer();
        self.set_baseline(base.clone());
        self.epoch += 1;
        self.pending = None;
        self.dirty = true;
        self.needs_snapshot = false;
        self.error = None;
        self.live_ours = Some((self.revision, ours.clone()));
        let state = ConflictState {
            base,
            ours,
            theirs,
            remote_revision,
        };
        self.conflict = Some(state.clone());
        state
    }

    fn defer(
        &mut self,
        ours: Buffer,
        theirs: Buffer,
        remote_revision: Option<String>,
    ) -> ConflictState {
        let base = self
            .conflict
            .as_ref()
            .map(|c| c.base.clone())
            .unwrap_or_else(|| self.baseline.clone());
        self.epoch += 1;
        self.pending = None;
        self.dirty = true;
        self.needs_snapshot = false;
        self.error = None;
        let state = ConflictState {
            base,
            ours,
            theirs,
            remote_revision,
        };
        self.conflict = Some(state.clone());
        state
    }

    /// Marks the session dirty to flush normalized line endings (`DP-31`).
    pub fn mark_line_ending_normalized(&mut self) {
        self.force_write_baseline = true;
        self.dirty = true;
        self.error = None;
        if self.pending.is_none() && self.active.is_none() {
            self.needs_snapshot = true;
        }
    }

    /// Lifecycle/appearance events never call this. A revision notification is
    /// cheap; serialization is deferred to the next foreground event turn.
    pub fn local_edit(&mut self, revision: u64, dirty: bool) {
        if revision < self.revision {
            return;
        }
        if self.conflict.is_some() {
            // Edits continue on the preserved draft; nothing is written until resolved.
            self.revision = revision;
            self.dirty = true;
            return;
        }
        if revision > self.revision {
            self.error = None;
        }
        self.revision = revision;
        self.dirty =
            dirty || self.force_write_baseline || self.active.is_some() || self.pending.is_some();
        if !dirty && !self.force_write_baseline {
            self.live_ours = Some((revision, self.baseline.clone()));
        }
        if self.dirty && self.error.is_none() {
            self.needs_snapshot = true;
        }
    }

    pub fn enqueue(&mut self, snapshot: Snapshot) {
        if let Some(conflict) = &mut self.conflict {
            if snapshot.revision >= self.revision {
                self.revision = snapshot.revision;
                self.live_ours = Some((snapshot.revision, snapshot.text.clone()));
                conflict.ours = snapshot.text;
            }
            self.needs_snapshot = false;
            return;
        }
        if snapshot.revision < self.revision {
            self.needs_snapshot = true;
            return;
        }
        self.revision = snapshot.revision;
        self.live_ours = Some((snapshot.revision, snapshot.text.clone()));
        self.needs_snapshot = false;
        self.error = None;
        // An external observation retired the active write. Its exit is still
        // awaited, but adopted disk bytes must never become a compensating save.
        if !self.force_write_baseline
            && self.matches_baseline(&snapshot.text)
            && self.active.as_ref().is_none_or(|c| c.epoch != self.epoch)
        {
            self.pending = None;
            self.dirty = false;
            self.live_ours = None;
            self.receipt = Some(snapshot);
            return;
        }
        self.dirty = true;
        self.pending = Some(snapshot);
    }

    pub fn next_commit(&mut self) -> Option<Commit> {
        if self.active.is_some() || self.conflict.is_some() {
            return None;
        }
        let snapshot = self.pending.take()?;
        if !self.force_write_baseline && self.matches_baseline(&snapshot.text) {
            self.dirty = snapshot.revision != self.revision;
            if !self.dirty {
                self.live_ours = None;
            }
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

    fn resolve_ours(&self, fallback_commit: Option<&Snapshot>) -> (Buffer, bool) {
        if let Some(conflict) = &self.conflict {
            let tracked_rev = self.live_ours.as_ref().map(|(r, _)| *r);
            let untracked = tracked_rev.is_none_or(|r| self.revision > r);
            return (conflict.ours.clone(), untracked);
        }
        if !self.dirty && self.active.is_none() && self.pending.is_none() {
            return (self.baseline.clone(), false);
        }

        let mut best: Option<(u64, &Buffer)> = None;

        if let Some((rev, buf)) = &self.live_ours {
            best = Some((*rev, buf));
        }
        if let Some(pending) = &self.pending
            && best.is_none_or(|(r, _)| pending.revision >= r)
        {
            best = Some((pending.revision, &pending.text));
        }
        if let Some(active) = &self.active
            && active.epoch == self.epoch
            && best.is_none_or(|(r, _)| active.snapshot.revision >= r)
        {
            best = Some((active.snapshot.revision, &active.snapshot.text));
        }
        if let Some(commit) = fallback_commit
            && best.is_none_or(|(r, _)| commit.revision >= r)
        {
            best = Some((commit.revision, &commit.text));
        }

        match best {
            Some((rev, buf)) => (buf.clone(), self.revision > rev),
            None => (self.baseline.clone(), self.dirty),
        }
    }

    pub fn observe(&mut self, text: &str) -> StorageObservation {
        self.observe_with_revision(Buffer::new(text), None)
    }

    pub fn observe_with_revision(
        &mut self,
        theirs: Buffer,
        remote_revision: Option<String>,
    ) -> StorageObservation {
        if self.matches_baseline(&theirs) && self.conflict.is_none() {
            return StorageObservation::Baseline;
        }
        if let Some(existing) = &mut self.conflict
            && fast_buffer_eq(&existing.theirs, &theirs)
        {
            if remote_revision.is_some() {
                existing.remote_revision = remote_revision;
            }
            return StorageObservation::Deferred(existing.clone());
        }
        if self
            .active
            .as_ref()
            .is_some_and(|c| c.epoch == self.epoch && fast_buffer_eq(&c.snapshot.text, &theirs))
        {
            return StorageObservation::OwnWrite;
        }

        let (ours, has_untracked_dirty) = self.resolve_ours(None);
        if self.cloud && has_untracked_dirty {
            let state = self.defer(ours, theirs, remote_revision);
            return StorageObservation::Deferred(state);
        }
        if !self.cloud && has_untracked_dirty && self.matches_baseline(&ours) {
            self.adopt_clean(theirs.clone());
            return StorageObservation::Adopted {
                text: theirs,
                had_local_unmerged: false,
                overwrote_local_overlap: true,
            };
        }

        let base_buf = self
            .conflict
            .as_ref()
            .map(|c| c.base.clone())
            .unwrap_or_else(|| self.baseline.clone());

        match reconcile_workspace(
            base_buf.as_str(),
            ours.as_str(),
            theirs.as_str(),
            self.cloud,
            remote_revision,
        ) {
            WorkspaceReconcile::CleanTheirs { text } => {
                let buf = Buffer::new(text);
                self.adopt_clean(buf.clone());
                StorageObservation::Adopted {
                    text: buf,
                    had_local_unmerged: false,
                    overwrote_local_overlap: false,
                }
            }
            WorkspaceReconcile::MergedClean {
                text,
                had_local_unmerged,
            } => {
                let merged = Buffer::new(text);
                self.adopt_merged(theirs, merged.clone(), had_local_unmerged);
                StorageObservation::Adopted {
                    text: merged,
                    had_local_unmerged,
                    overwrote_local_overlap: false,
                }
            }
            WorkspaceReconcile::MergedLocalOverwritten {
                text,
                had_local_unmerged,
            } => {
                let merged = Buffer::new(text);
                self.adopt_merged(theirs, merged.clone(), had_local_unmerged);
                StorageObservation::Adopted {
                    text: merged,
                    had_local_unmerged,
                    overwrote_local_overlap: true,
                }
            }
            WorkspaceReconcile::ConflictPending { remote_version, .. } => {
                let state = self.defer(ours, theirs, remote_version);
                StorageObservation::Deferred(state)
            }
        }
    }

    fn adopt_clean(&mut self, text: Buffer) {
        self.epoch += 1;
        self.revision += 1;
        self.set_baseline(text);
        self.pending = None;
        self.receipt = None;
        self.live_ours = None;
        self.needs_snapshot = false;
        self.dirty = false;
        self.error = None;
        self.conflict = None;
        self.force_write_baseline = false;
    }

    fn adopt_merged(&mut self, theirs_baseline: Buffer, merged: Buffer, had_local_unmerged: bool) {
        if !had_local_unmerged {
            self.adopt_clean(theirs_baseline);
            return;
        }
        self.epoch += 1;
        self.revision += 1;
        self.set_baseline(theirs_baseline);
        self.pending = None;
        self.receipt = None;
        self.live_ours = Some((self.revision, merged));
        self.dirty = true;
        self.needs_snapshot = true;
        self.error = None;
        self.conflict = None;
        self.force_write_baseline = false;
    }

    /// Completes an in-flight conditional write with a typed [`WriteOutcome`]
    /// or [`SessionError`] (`DP-43`).
    pub fn complete(
        &mut self,
        sequence: u64,
        result: Result<WriteOutcome, SessionError>,
    ) -> Completion {
        if self.active.as_ref().is_none_or(|c| c.sequence != sequence) {
            return Completion::Retired;
        }
        let commit = self.active.take().unwrap();
        if commit.epoch != self.epoch {
            return Completion::Retired;
        }
        match result {
            Ok(WriteOutcome::Written { text, .. }) => {
                self.set_baseline(text.clone());
                self.force_write_baseline = false;
                self.receipt = Some(Snapshot {
                    revision: commit.snapshot.revision,
                    text,
                });
                self.error = None;
                self.dirty = self.revision != commit.snapshot.revision;
                if !self.dirty {
                    self.live_ours = None;
                }
                if self.dirty && self.pending.is_none() {
                    self.needs_snapshot = true;
                }
                Completion::Saved
            }
            Ok(WriteOutcome::Conflict {
                remote_text,
                remote_revision,
            }) => {
                let (ours, has_untracked_dirty) = self.resolve_ours(Some(&commit.snapshot));
                if self.cloud && has_untracked_dirty {
                    let state = self.defer(ours, remote_text, remote_revision);
                    return Completion::Deferred(state);
                }
                match reconcile_workspace(
                    self.baseline.as_str(),
                    ours.as_str(),
                    remote_text.as_str(),
                    self.cloud,
                    remote_revision,
                ) {
                    WorkspaceReconcile::CleanTheirs { text } => {
                        let buf = Buffer::new(text);
                        self.adopt_clean(buf.clone());
                        Completion::Adopted {
                            text: buf,
                            had_local_unmerged: false,
                            overwrote_local_overlap: false,
                        }
                    }
                    WorkspaceReconcile::MergedClean {
                        text,
                        had_local_unmerged,
                    } => {
                        let merged = Buffer::new(text);
                        self.adopt_merged(remote_text, merged.clone(), had_local_unmerged);
                        Completion::Adopted {
                            text: merged,
                            had_local_unmerged,
                            overwrote_local_overlap: false,
                        }
                    }
                    WorkspaceReconcile::MergedLocalOverwritten {
                        text,
                        had_local_unmerged,
                    } => {
                        let merged = Buffer::new(text);
                        self.adopt_merged(remote_text, merged.clone(), had_local_unmerged);
                        Completion::Adopted {
                            text: merged,
                            had_local_unmerged,
                            overwrote_local_overlap: true,
                        }
                    }
                    WorkspaceReconcile::ConflictPending { remote_version, .. } => {
                        let state = self.defer(ours, remote_text, remote_version);
                        Completion::Deferred(state)
                    }
                }
            }
            Err(error) => {
                self.error = Some(error.clone());
                if self.live_ours.is_none() {
                    self.live_ours = Some((commit.snapshot.revision, commit.snapshot.text));
                }
                self.dirty = true;
                self.needs_snapshot = false;
                Completion::Failed(error)
            }
        }
    }

    /// `requestSave` after a failed write: snapshot and write again. A held
    /// Cloud conflict is not retried (`retryable` is false for it).
    pub fn retry(&mut self) -> bool {
        if self.error.is_none() || self.conflict.is_some() || self.active.is_some() {
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
    use crate::workspace::ErrorKind;

    #[test]
    fn a_failed_write_can_be_retried_but_a_held_conflict_cannot() {
        let mut session = DocumentEditingSession::new("a".into(), "old", 0);
        session.enqueue(Snapshot::new(1, "new"));
        let commit = session.next_commit().unwrap();
        assert!(!session.retry(), "nothing failed while writing");
        session.complete(
            commit.sequence,
            Err(SessionError::new(ErrorKind::Io, "disk full")),
        );
        assert!(!session.needs_snapshot);
        assert!(session.retry());
        assert!(session.needs_snapshot && session.error.is_none());

        let mut cloud = DocumentEditingSession::new("b".into(), "old", 0);
        cloud.cloud = true;
        cloud.local_edit(1, true);
        cloud.observe("remote");
        assert!(cloud.conflicted());
        assert!(
            cloud.error.is_none(),
            "conflict is typed state, not error string"
        );
        assert!(!cloud.retry());
    }
}
