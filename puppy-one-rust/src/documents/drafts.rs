//! Unflushable draft journal coordinator (`DP-10`, `DP-11`).
//!
//! Wires [`WorkingCopy`](super::working_copy::WorkingCopy) onto
//! [`crate::platform::draft_journal::DraftJournal`] without ever writing during
//! normal clean or `800ms`/`2s` autosave cycles:
//! - Schedules writing a [`DraftEntry`] within `1s` whenever a working copy
//!   enters an unflushable state (`SaveFailed`, `ConflictPending`,
//!   `OutcomeUnknown`, `Offline`, `StaleLease`) and debounces subsequent edits.
//! - Deletes the [`DraftEntry`] immediately when save succeeds or the user
//!   explicitly discards the draft.
//! - Recovers any persisted draft on resource open (`DP-11`), reconciling when
//!   storage content moved while closed, and never blocking open on journal errors.

use crate::{
    editor::document_session::document_editing_session::DocumentEditingSession,
    platform::draft_journal::{DraftEntry, DraftJournal, DraftReason},
    workspace::{Document, ErrorKind},
};
use std::{
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

/// Delay before persisting a newly unflushable draft (`DP-10`: within `1s`).
pub const JOURNAL_WRITE_DELAY: Duration = Duration::from_secs(1);
/// Upper bound during continuous typing while unflushable.
pub const JOURNAL_MAX_WAIT: Duration = Duration::from_secs(2);

/// Canonical workspace + resource keys for [`DraftJournal`].
pub fn journal_keys(doc: &Document) -> (String, String) {
    let workspace_key = doc.identity.storage.as_str().to_owned();
    let resource_key = canonical_path(&doc.relative);
    (workspace_key, resource_key)
}

pub fn canonical_path(relative: &Path) -> String {
    relative.to_string_lossy().replace('\\', "/")
}

/// Classifies whether `session` is currently in an unflushable state (`DP-10`).
/// Returns `None` for clean documents and normal `800ms`/`2s` autosave cycles.
pub fn classify_unflushable(session: &DocumentEditingSession) -> Option<DraftReason> {
    if session.conflicted() {
        return Some(DraftReason::ConflictPending);
    }
    let error = session.error.as_ref()?;
    Some(match error.kind {
        ErrorKind::OutcomeUnknown => DraftReason::OutcomeUnknown,
        ErrorKind::StaleLease => DraftReason::StaleLease,
        ErrorKind::Io if session.cloud => DraftReason::Offline,
        _ => DraftReason::SaveFailed,
    })
}

/// Result of inspecting [`DraftJournal`] when opening a [`Document`] (`DP-11`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecoveryPlan {
    /// No journal entry existed (or journal read failed gracefully).
    None,
    /// Journal entry matched current storage text (`draft_text == doc.text`);
    /// clean up the stale entry and open normally.
    AlreadyConverged,
    /// Storage `blake3` hash still matches `entry.baseline_hash`: restore
    /// `draft_text` as unsaved working copy with a recovery notice.
    RestoreMatchingBaseline {
        draft_text: String,
        reason: DraftReason,
    },
    /// Storage changed while closed (`blake3(doc.text) != entry.baseline_hash`):
    /// reconcile `draft_text` (`ours`) against `doc.text` (`theirs`) per `DP-04`/`DP-05`.
    StorageDiverged {
        draft_text: String,
        reason: DraftReason,
    },
}

/// Evaluates `entry` against newly read `doc` (`DP-11`).
pub fn plan_recovery(doc: &Document, entry: Option<DraftEntry>) -> RecoveryPlan {
    let Some(entry) = entry else {
        return RecoveryPlan::None;
    };
    if entry.draft_text == doc.text {
        return RecoveryPlan::AlreadyConverged;
    }
    let disk_hash = blake3::hash(doc.text.as_bytes()).to_hex().to_string();
    if disk_hash == entry.baseline_hash {
        RecoveryPlan::RestoreMatchingBaseline {
            draft_text: entry.draft_text,
            reason: entry.reason,
        }
    } else {
        RecoveryPlan::StorageDiverged {
            draft_text: entry.draft_text,
            reason: entry.reason,
        }
    }
}

pub fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
pub struct DraftCoordinator {
    pub journal: Option<DraftJournal>,
    first: Option<Instant>,
    due: Option<Instant>,
    last_persisted: Option<(String, String, blake3::Hash, String, DraftReason)>,
    pub has_entry_on_disk: bool,
    pub inflight: usize,
}

impl DraftCoordinator {
    pub fn new(journal: Option<DraftJournal>) -> Self {
        Self {
            journal,
            ..Default::default()
        }
    }

    pub fn due(&self) -> Option<Instant> {
        self.due
    }

    pub fn delay(&self, now: Instant) -> Option<Duration> {
        self.due.map(|due| due.saturating_duration_since(now))
    }

    pub fn reset(&mut self) {
        self.first = None;
        self.due = None;
        self.last_persisted = None;
        self.has_entry_on_disk = false;
    }

    /// Schedules or cancels the `1s` debounced journal timer according to
    /// `session`'s current unflushable status (`DP-10`).
    pub fn sync_schedule(
        &mut self,
        doc: Option<&Document>,
        session: Option<&DocumentEditingSession>,
        now: Instant,
    ) {
        if self.journal.is_none() {
            self.first = None;
            self.due = None;
            return;
        }
        let (Some(doc), Some(session)) = (doc, session) else {
            self.reset();
            return;
        };
        let Some(reason) = classify_unflushable(session) else {
            self.first = None;
            self.due = None;
            return;
        };

        let (ws_key, res_key) = journal_keys(doc);
        let draft_buf = session.latest_draft_buffer();
        let draft_hash =
            crate::editor::document_session::document_editing_session::hash_buffer(&draft_buf);
        let baseline_hex = session.baseline_hash().to_hex().to_string();

        if self
            .last_persisted
            .as_ref()
            .is_some_and(|(w, r, dh, bh, rsn)| {
                w == &ws_key
                    && r == &res_key
                    && *dh == draft_hash
                    && bh == &baseline_hex
                    && *rsn == reason
            })
            && !session.has_unsnapshotted_edits()
        {
            self.first = None;
            self.due = None;
            return;
        }

        let first = *self.first.get_or_insert(now);
        self.due = Some((now + JOURNAL_WRITE_DELAY).min(first + JOURNAL_MAX_WAIT));
    }

    /// Builds a [`DraftEntry`] when `due` has arrived (or `force` is true on
    /// close/abandon) and marks it persisted so idle polls do not repeat writes.
    pub fn take_due_entry(
        &mut self,
        doc: &Document,
        session: &DocumentEditingSession,
        now: Instant,
        force: bool,
    ) -> Option<(DraftJournal, DraftEntry)> {
        let journal = self.journal.clone()?;
        let reason = classify_unflushable(session)?;
        if !force && !self.due.is_some_and(|due| now >= due) {
            return None;
        }
        self.first = None;
        self.due = None;

        let (workspace_key, resource_key) = journal_keys(doc);
        let draft_buf = session.latest_draft_buffer();
        let draft_hash =
            crate::editor::document_session::document_editing_session::hash_buffer(&draft_buf);
        let baseline_hash = session.baseline_hash().to_hex().to_string();

        if self
            .last_persisted
            .as_ref()
            .is_some_and(|(w, r, dh, bh, rsn)| {
                w == &workspace_key
                    && r == &resource_key
                    && *dh == draft_hash
                    && bh == &baseline_hash
                    && *rsn == reason
            })
        {
            return None;
        }

        self.has_entry_on_disk = true;
        self.last_persisted = Some((
            workspace_key.clone(),
            resource_key.clone(),
            draft_hash,
            baseline_hash.clone(),
            reason,
        ));

        let entry = DraftEntry {
            workspace_key,
            resource_key,
            path: doc.relative.clone(),
            baseline_hash,
            draft_text: draft_buf.as_str().to_owned(),
            reason,
            updated_at_ms: now_unix_ms(),
        };
        Some((journal, entry))
    }

    /// Prepares a deletion request for `(workspace_key, resource_key)` after
    /// save succeeds or the user discards edits (`DP-10`).
    pub fn take_removal(&mut self, doc: &Document) -> Option<(DraftJournal, String, String)> {
        let had_entry = self.has_entry_on_disk || self.last_persisted.is_some();
        self.first = None;
        self.due = None;
        self.last_persisted = None;
        self.has_entry_on_disk = false;
        if !had_entry {
            return None;
        }
        let journal = self.journal.clone()?;
        let (ws_key, res_key) = journal_keys(doc);
        Some((journal, ws_key, res_key))
    }

    /// Clears hosted draft entries on Cloud sign-out while preserving `file://`
    /// local entries (`DP-10`).
    pub fn clear_hosted_entries(&self) -> usize {
        let journal = self.journal.clone().unwrap_or_else(DraftJournal::native);
        journal.clear_hosted_entries().unwrap_or(0)
    }
}
