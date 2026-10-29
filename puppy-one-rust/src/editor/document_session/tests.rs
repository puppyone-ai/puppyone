use super::{document_editing_session::DocumentEditingSession, types::*};
fn session() -> DocumentEditingSession {
    DocumentEditingSession::new("doc".into(), "base".into(), 0)
}
fn edit(s: &mut DocumentEditingSession, revision: u64, text: &str) {
    s.local_edit(revision, text != s.baseline);
    s.enqueue(Snapshot {
        revision,
        text: text.into(),
    });
}
#[test]
fn one_active_write_coalesces_pending_input_and_closes_only_after_last_receipt() {
    let mut s = session();
    edit(&mut s, 1, "one");
    let first = s.next_commit().unwrap();
    edit(&mut s, 2, "two");
    edit(&mut s, 3, "three");
    assert!(s.next_commit().is_none());
    assert!(!s.drained());
    assert_eq!(
        s.complete(first.sequence, Ok(("one".into(), false))),
        Completion::Saved
    );
    let next = s.next_commit().unwrap();
    assert_eq!(next.snapshot.text, "three");
    assert!(!s.drained());
    s.complete(next.sequence, Ok(("three".into(), false)));
    assert!(s.drained());
}
#[test]
fn external_disk_retires_pending_and_old_success_error_and_conflict() {
    for result in [
        Ok(("old".into(), false)),
        Ok(("older disk".into(), true)),
        Err("old error".into()),
    ] {
        let mut s = session();
        edit(&mut s, 1, "old");
        let active = s.next_commit().unwrap();
        edit(&mut s, 2, "pending");
        assert_eq!(s.observe("agent edit"), StorageObservation::Adopted);
        assert!(!s.drained()); // Explicit close still waits for the dispatched call.
        assert_eq!(s.complete(active.sequence, result), Completion::Retired);
        assert_eq!(s.baseline, "agent edit");
        assert!(s.drained());
        assert!(s.next_commit().is_none());
        assert!(s.error.is_none());
    }
}
#[test]
fn own_echo_and_duplicate_baseline_preserve_newer_typing() {
    let mut s = session();
    edit(&mut s, 1, "first");
    let first = s.next_commit().unwrap();
    edit(&mut s, 2, "newer");
    assert_eq!(s.observe("base"), StorageObservation::Baseline);
    assert_eq!(s.observe("first"), StorageObservation::OwnWrite);
    assert_eq!(s.revision, 2);
    s.complete(first.sequence, Ok(("first".into(), false)));
    assert_eq!(s.next_commit().unwrap().snapshot.text, "newer");
}
#[test]
fn undo_to_old_baseline_during_write_is_saved_after_that_write() {
    let mut s = session();
    edit(&mut s, 1, "temporary");
    let first = s.next_commit().unwrap();
    edit(&mut s, 2, "base");
    s.complete(first.sequence, Ok(("temporary".into(), false)));
    let undo = s.next_commit().unwrap();
    assert_eq!(undo.snapshot.text, "base");
    s.complete(undo.sequence, Ok(("base".into(), false)));
    assert!(s.drained());
}
#[test]
fn new_revision_with_same_inflight_bytes_does_not_replace_file_twice() {
    let mut s = session();
    edit(&mut s, 1, "same");
    let first = s.next_commit().unwrap();
    edit(&mut s, 3, "same");
    s.complete(first.sequence, Ok(("same".into(), false)));
    assert!(s.next_commit().is_none());
    assert!(s.drained());
    assert_eq!(s.take_receipt().unwrap().revision, 3);
}
#[test]
fn new_edits_after_external_adoption_wait_for_retired_call() {
    let mut s = session();
    edit(&mut s, 1, "old");
    let old = s.next_commit().unwrap();
    s.observe("external");
    edit(&mut s, 3, "external plus new");
    assert!(s.next_commit().is_none());
    s.complete(old.sequence, Ok(("old".into(), false)));
    assert_eq!(s.baseline, "external");
    assert_eq!(s.next_commit().unwrap().snapshot.text, "external plus new");
}
#[test]
fn conditional_rejection_adopts_disk_and_does_not_offer_conflict_choice() {
    let mut s = session();
    edit(&mut s, 1, "mine");
    let c = s.next_commit().unwrap();
    assert_eq!(
        s.complete(c.sequence, Ok(("disk".into(), true))),
        Completion::Adopted
    );
    assert!(s.drained());
    assert_eq!(s.baseline, "disk");
    assert!(s.error.is_none());
}
#[test]
fn true_io_failure_retains_dirty_state_and_retries_only_on_explicit_input_or_save() {
    let mut s = session();
    edit(&mut s, 1, "mine");
    let c = s.next_commit().unwrap();
    assert_eq!(
        s.complete(c.sequence, Err("permission denied".into())),
        Completion::Failed("permission denied".into())
    );
    assert!(!s.drained());
    assert!(!s.needs_snapshot);
    assert!(s.next_commit().is_none());
    edit(&mut s, 1, "mine");
    assert!(s.next_commit().is_some());
}
#[test]
fn real_return_to_historical_disk_bytes_is_an_external_update() {
    let mut s = session();
    edit(&mut s, 1, "new");
    let c = s.next_commit().unwrap();
    s.complete(c.sequence, Ok(("new".into(), false)));
    assert_eq!(s.observe("base"), StorageObservation::Adopted);
    assert_eq!(s.baseline, "base");
    assert!(s.drained());
}

#[test]
fn cloud_conflicts_preserve_the_draft_until_discard_and_reload() {
    let mut s = DocumentEditingSession::new("d".into(), "base".into(), 0);
    s.cloud = true;
    s.local_edit(1, true);
    s.enqueue(Snapshot {
        revision: 1,
        text: "mine".into(),
    });
    let commit = s.next_commit().unwrap();
    // The conditional write is rejected with newer remote content.
    let completion = s.complete(commit.sequence, Ok(("theirs".into(), true)));
    assert_eq!(completion, Completion::Deferred);
    assert!(s.conflicted() && s.dirty);
    assert_eq!(s.baseline, "base");
    // Further edits are kept but never written while the conflict stands.
    s.local_edit(2, true);
    s.enqueue(Snapshot {
        revision: 2,
        text: "mine 2".into(),
    });
    assert!(s.next_commit().is_none());
    // Discard and reload adopts the remote text.
    assert_eq!(s.reload_external().as_deref(), Some("theirs"));
    assert!(!s.conflicted() && !s.dirty);
    assert_eq!(s.baseline, "theirs");
}

#[test]
fn cloud_observations_defer_under_unsaved_input_and_converged_writes_adopt() {
    let mut s = DocumentEditingSession::new("d".into(), "base".into(), 0);
    s.cloud = true;
    // Clean documents follow the remote like local ones.
    assert_eq!(s.observe("remote 1"), StorageObservation::Adopted);
    s.local_edit(2, true);
    assert_eq!(s.observe("remote 2"), StorageObservation::Deferred);
    assert!(s.conflicted());
    // A retried uncertain write that had landed converges instead.
    let mut t = DocumentEditingSession::new("e".into(), "base".into(), 0);
    t.cloud = true;
    t.local_edit(1, true);
    t.enqueue(Snapshot {
        revision: 1,
        text: "mine".into(),
    });
    let commit = t.next_commit().unwrap();
    assert_eq!(
        t.complete(commit.sequence, Ok(("mine".into(), true))),
        Completion::Adopted
    );
    // Local documents remain disk-first.
    let mut l = DocumentEditingSession::new("f".into(), "base".into(), 0);
    l.local_edit(1, true);
    assert_eq!(l.observe("disk"), StorageObservation::Adopted);
}
