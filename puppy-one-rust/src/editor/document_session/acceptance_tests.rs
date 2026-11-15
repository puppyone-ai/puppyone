//! Acceptance edges from the product DocumentEditingSession, exercising the
//! session boundary independently of timer and view implementation details.
use super::{document_editing_session::DocumentEditingSession, types::*};

fn session(cloud: bool) -> DocumentEditingSession {
    let mut session = DocumentEditingSession::new("note.md".into(), "base".into(), 0);
    session.cloud = cloud;
    session
}
fn edit(session: &mut DocumentEditingSession, revision: u64, text: &str) {
    session.local_edit(revision, text != session.baseline);
    session.enqueue(Snapshot {
        revision,
        text: text.into(),
    });
}

#[test]
fn cloud_converged_old_write_preserves_and_saves_the_newer_draft() {
    for snapshot_already_queued in [false, true] {
        let mut s = session(true);
        edit(&mut s, 1, "first draft");
        let first = s.next_commit().unwrap();
        s.local_edit(2, true);
        if snapshot_already_queued {
            s.enqueue(Snapshot {
                revision: 2,
                text: "latest draft".into(),
            });
        }
        // A previous uncertain write landed. This acknowledges only its
        // candidate, not the newer input typed while it was in flight.
        assert_eq!(
            s.complete(first.sequence, Ok(("first draft".into(), true))),
            Completion::Saved
        );
        assert_eq!(s.baseline, "first draft");
        assert_eq!(s.revision, 2);
        assert!(s.dirty && !s.drained() && !s.conflicted());
        assert_eq!(
            s.take_receipt(),
            Some(Snapshot {
                revision: 1,
                text: "first draft".into()
            })
        );
        if !snapshot_already_queued {
            assert!(s.needs_snapshot);
            s.enqueue(Snapshot {
                revision: 2,
                text: "latest draft".into(),
            });
        }
        let next = s.next_commit().expect("newer draft must still be saved");
        assert_eq!(next.snapshot.text, "latest draft");
        assert!(next.sequence > first.sequence);
        assert_eq!(
            s.complete(next.sequence, Ok(("latest draft".into(), false))),
            Completion::Saved
        );
        assert!(s.drained());
    }
}

#[test]
fn cloud_publication_fences_every_old_write_outcome_until_explicit_reload() {
    for result in [
        Ok(("old draft".into(), false)),
        Ok(("old draft".into(), true)),
        Err("obsolete failure".into()),
    ] {
        let mut s = session(true);
        edit(&mut s, 1, "old draft");
        let old = s.next_commit().unwrap();
        assert_eq!(s.observe("agent publication"), StorageObservation::Deferred);
        edit(&mut s, 2, "newer human draft");
        assert_eq!(s.complete(old.sequence, result), Completion::Retired);
        assert_eq!(s.baseline, "base");
        assert_eq!(s.revision, 2);
        assert!(s.dirty && s.conflicted() && !s.drained());
        assert_eq!(s.error.as_deref(), Some("external-conflict"));
        assert!(s.take_receipt().is_none());
        assert!(s.next_commit().is_none());
        assert!(!s.retry());
        assert_eq!(s.reload_external().as_deref(), Some("agent publication"));
        assert!(s.drained());
        assert_eq!(s.baseline, "agent publication");
        assert!(s.error.is_none());
    }
}

#[test]
fn disk_adoption_is_byte_exact_and_never_queues_writeback() {
    let samples = [
        String::new(),
        "你好，外部 Agent 👋\n第二行".into(),
        "first\r\nsecond\r\n".into(),
        "value  \n\n".into(),
        format!("{}\n", "0123456789abcdef".repeat(16_384)),
    ];
    for content in samples {
        let mut s = session(false);
        edit(&mut s, 1, "discarded local input");
        assert_eq!(s.observe(&content), StorageObservation::Adopted);
        assert_eq!(s.baseline.as_bytes(), content.as_bytes());
        assert!(s.drained());
        assert!(s.next_commit().is_none());
        assert!(s.take_receipt().is_none());
        assert!(s.error.is_none());
    }
}

#[test]
fn local_rejected_old_write_adopts_the_latest_disk_snapshot_and_settles_pending() {
    let mut s = session(false);
    edit(&mut s, 1, "first");
    let old = s.next_commit().unwrap();
    edit(&mut s, 2, "latest");
    assert_eq!(
        s.complete(old.sequence, Ok(("latest".into(), true))),
        Completion::Adopted
    );
    assert_eq!(s.baseline, "latest");
    assert!(s.drained());
    assert!(s.next_commit().is_none());
    assert!(s.error.is_none());
}

#[test]
fn new_input_after_disk_adoption_waits_for_old_success_failure_or_conflict() {
    for result in [
        Ok(("old".into(), false)),
        Ok(("old disk".into(), true)),
        Err("old failure".into()),
    ] {
        let mut s = session(false);
        edit(&mut s, 1, "old");
        let old = s.next_commit().unwrap();
        s.observe("adopted disk");
        edit(&mut s, 3, "adopted disk plus new typing");
        assert!(s.next_commit().is_none());
        assert_eq!(s.complete(old.sequence, result), Completion::Retired);
        assert_eq!(s.baseline, "adopted disk");
        assert!(s.error.is_none());
        assert!(s.take_receipt().is_none());
        let current = s.next_commit().unwrap();
        assert_eq!(current.snapshot.text, "adopted disk plus new typing");
        s.complete(current.sequence, Ok((current.snapshot.text, false)));
        assert!(s.drained());
    }
}

#[test]
fn persistence_errors_keep_input_retryable_and_do_not_busy_loop() {
    for error in [
        "The file was removed",
        "The file is read-only",
        "The disk is unavailable",
        "Desktop bridge unavailable",
    ] {
        let mut s = session(false);
        edit(&mut s, 1, "human input");
        let old = s.next_commit().unwrap();
        assert_eq!(
            s.complete(old.sequence, Err(error.into())),
            Completion::Failed(error.into())
        );
        assert_eq!(s.error.as_deref(), Some(error));
        assert_eq!(s.baseline, "base");
        assert!(s.dirty && !s.drained());
        assert!(!s.needs_snapshot);
        assert!(s.next_commit().is_none());
        assert!(s.retry());
        assert!(s.needs_snapshot);
        s.enqueue(Snapshot {
            revision: 1,
            text: "human input".into(),
        });
        let retried = s.next_commit().unwrap();
        assert_eq!(retried.snapshot.text, "human input");
        s.complete(retried.sequence, Ok((retried.snapshot.text, false)));
        assert!(s.drained());
    }
}
