use super::{document_editing_session::DocumentEditingSession, types::*};

fn session() -> DocumentEditingSession {
    DocumentEditingSession::new("doc".into(), "base", 0)
}

fn edit(s: &mut DocumentEditingSession, revision: u64, text: &str) {
    s.local_edit(revision, !s.baseline.eq_str(text));
    s.enqueue(Snapshot::new(revision, text));
}

fn written(text: &str) -> Result<WriteOutcome, SessionError> {
    Ok(WriteOutcome::Written {
        text: text.into_buffer(),
        revision: Some(format!("rev-{text}")),
    })
}

fn conflict(text: &str) -> Result<WriteOutcome, SessionError> {
    Ok(WriteOutcome::Conflict {
        remote_text: text.into_buffer(),
        remote_revision: Some(format!("rev-{text}")),
    })
}

fn io_err(msg: &str) -> Result<WriteOutcome, SessionError> {
    Err(SessionError::new(ErrorKind::Io, msg))
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
        s.complete(first.sequence, written("one")),
        Completion::Saved
    );
    let next = s.next_commit().unwrap();
    assert_eq!(next.snapshot.text.as_str(), "three");
    assert!(!s.drained());
    s.complete(next.sequence, written("three"));
    assert!(s.drained());
}

#[test]
fn external_disk_retires_pending_and_old_success_error_and_conflict() {
    for result in [written("old"), conflict("older disk"), io_err("old error")] {
        let mut s = session();
        edit(&mut s, 1, "old");
        let active = s.next_commit().unwrap();
        edit(&mut s, 2, "pending");
        assert!(matches!(
            s.observe("agent edit"),
            StorageObservation::Adopted {
                overwrote_local_overlap: true,
                ..
            }
        ));
        assert!(!s.drained()); // Explicit close still waits for the dispatched call.
        assert_eq!(s.complete(active.sequence, result), Completion::Retired);
        assert_eq!(s.baseline.as_str(), "agent edit");
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
    s.complete(first.sequence, written("first"));
    assert_eq!(s.next_commit().unwrap().snapshot.text.as_str(), "newer");
}

#[test]
fn undo_to_old_baseline_during_write_is_saved_after_that_write() {
    let mut s = session();
    edit(&mut s, 1, "temporary");
    let first = s.next_commit().unwrap();
    edit(&mut s, 2, "base");
    s.complete(first.sequence, written("temporary"));
    let undo = s.next_commit().unwrap();
    assert_eq!(undo.snapshot.text.as_str(), "base");
    s.complete(undo.sequence, written("base"));
    assert!(s.drained());
}

#[test]
fn new_revision_with_same_inflight_bytes_does_not_replace_file_twice() {
    let mut s = session();
    edit(&mut s, 1, "same");
    let first = s.next_commit().unwrap();
    edit(&mut s, 3, "same");
    s.complete(first.sequence, written("same"));
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
    s.complete(old.sequence, written("old"));
    assert_eq!(s.baseline.as_str(), "external");
    assert_eq!(
        s.next_commit().unwrap().snapshot.text.as_str(),
        "external plus new"
    );
}

#[test]
fn conditional_rejection_adopts_disk_and_does_not_offer_conflict_choice() {
    let mut s = session();
    edit(&mut s, 1, "mine");
    let c = s.next_commit().unwrap();
    assert_eq!(
        s.complete(c.sequence, conflict("disk")),
        Completion::Adopted {
            text: "disk".into_buffer(),
            had_local_unmerged: false,
            overwrote_local_overlap: true,
        }
    );
    assert!(s.drained());
    assert_eq!(s.baseline.as_str(), "disk");
    assert!(s.error.is_none());
}

#[test]
fn true_io_failure_retains_dirty_state_and_retries_only_on_explicit_input_or_save() {
    let mut s = session();
    edit(&mut s, 1, "mine");
    let c = s.next_commit().unwrap();
    let expected_err = SessionError::new(ErrorKind::PermissionDenied, "permission denied");
    assert_eq!(
        s.complete(c.sequence, Err(expected_err.clone())),
        Completion::Failed(expected_err)
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
    s.complete(c.sequence, written("new"));
    assert!(matches!(
        s.observe("base"),
        StorageObservation::Adopted { .. }
    ));
    assert_eq!(s.baseline.as_str(), "base");
    assert!(s.drained());
}

#[test]
fn cloud_conflicts_preserve_the_draft_until_discard_and_reload() {
    let mut s = DocumentEditingSession::new("d".into(), "base", 0);
    s.cloud = true;
    s.local_edit(1, true);
    s.enqueue(Snapshot::new(1, "mine"));
    let commit = s.next_commit().unwrap();
    // The conditional write is rejected with newer overlapping remote content.
    let completion = s.complete(commit.sequence, conflict("theirs"));
    assert!(matches!(completion, Completion::Deferred(_)));
    assert!(s.conflicted() && s.dirty);
    assert!(s.error.is_none());
    assert_eq!(s.baseline.as_str(), "base");
    // Further edits are kept on the conflict state and never written until resolved.
    s.local_edit(2, true);
    s.enqueue(Snapshot::new(2, "mine 2"));
    assert!(s.next_commit().is_none());
    assert_eq!(s.conflict.as_ref().unwrap().ours.as_str(), "mine 2");
    // Accept Remote adopts the remote text.
    assert_eq!(
        s.reload_external().as_ref().map(|b| b.as_str()),
        Some("theirs")
    );
    assert!(!s.conflicted() && !s.dirty);
    assert_eq!(s.baseline.as_str(), "theirs");
}

#[test]
fn cloud_observations_defer_under_unsaved_input_and_converged_writes_adopt() {
    let mut s = DocumentEditingSession::new("d".into(), "base", 0);
    s.cloud = true;
    // Clean documents follow the remote like local ones.
    assert!(matches!(
        s.observe("remote 1"),
        StorageObservation::Adopted { .. }
    ));
    s.local_edit(2, true);
    assert!(matches!(
        s.observe("remote 2"),
        StorageObservation::Deferred(_)
    ));
    assert!(s.conflicted());
    // A retried uncertain write that had landed converges instead.
    let mut t = DocumentEditingSession::new("e".into(), "base", 0);
    t.cloud = true;
    t.local_edit(1, true);
    t.enqueue(Snapshot::new(1, "mine"));
    let commit = t.next_commit().unwrap();
    assert_eq!(
        t.complete(commit.sequence, conflict("mine")),
        Completion::Adopted {
            text: "mine".into_buffer(),
            had_local_unmerged: false,
            overwrote_local_overlap: false,
        }
    );
    // Local documents remain disk-first.
    let mut l = DocumentEditingSession::new("f".into(), "base", 0);
    l.local_edit(1, true);
    assert!(matches!(
        l.observe("disk"),
        StorageObservation::Adopted { .. }
    ));
}

#[test]
fn non_overlapping_edits_merge_cleanly_on_both_local_and_cloud_and_queue_autosave() {
    for cloud in [false, true] {
        let base = "Title\n\nMiddle\n\nFooter\n";
        let mut s = DocumentEditingSession::new("m".into(), base, 0);
        s.cloud = cloud;
        s.local_edit(1, true);
        s.record_live_buffer(1, "Title (Ours)\n\nMiddle\n\nFooter\n".into_buffer());

        let obs = s.observe_with_revision(
            "Title\n\nMiddle\n\nFooter (Theirs)\n".into_buffer(),
            Some("rev-theirs".into()),
        );
        assert_eq!(
            obs,
            StorageObservation::Adopted {
                text: "Title (Ours)\n\nMiddle\n\nFooter (Theirs)\n".into_buffer(),
                had_local_unmerged: true,
                overwrote_local_overlap: false,
            }
        );
        assert!(!s.conflicted());
        assert!(s.dirty && s.needs_snapshot);
        assert_eq!(s.baseline.as_str(), "Title\n\nMiddle\n\nFooter (Theirs)\n");
    }
}

#[test]
fn keep_local_rebases_cloud_draft_onto_remote_baseline_and_enqueues_write() {
    let mut s = DocumentEditingSession::new("c".into(), "base\n", 0);
    s.cloud = true;
    edit(&mut s, 1, "my draft\n");
    let first = s.next_commit().unwrap();
    assert!(matches!(
        s.complete(first.sequence, conflict("remote v2\n")),
        Completion::Deferred(_)
    ));
    assert!(s.conflicted());

    let rebased = s.keep_local().expect("rebased draft");
    assert_eq!(rebased.as_str(), "my draft\n");
    assert!(!s.conflicted());
    assert_eq!(s.baseline.as_str(), "remote v2\n");
    let next = s.next_commit().expect("rebased commit queued");
    assert_eq!(next.snapshot.text.as_str(), "my draft\n");
    assert_eq!(
        s.complete(next.sequence, written("my draft\n")),
        Completion::Saved
    );
    assert!(s.drained());
}
