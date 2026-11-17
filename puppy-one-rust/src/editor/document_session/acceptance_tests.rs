//! Acceptance edges from the product DocumentEditingSession, exercising the
//! session boundary independently of timer and view implementation details.
use super::{document_editing_session::DocumentEditingSession, types::*};

fn session(cloud: bool) -> DocumentEditingSession {
    let mut session = DocumentEditingSession::new("note.md".into(), "base", 0);
    session.cloud = cloud;
    session
}
fn edit(session: &mut DocumentEditingSession, revision: u64, text: &str) {
    session.local_edit(revision, !session.baseline.eq_str(text));
    session.enqueue(Snapshot {
        revision,
        text: text.into_buffer(),
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
                text: "latest draft".into_buffer(),
            });
        }
        // A previous uncertain write landed. This acknowledges only its
        // candidate, not the newer input typed while it was in flight.
        assert_eq!(
            s.complete(
                first.sequence,
                Ok(WriteOutcome::Conflict {
                    remote_text: "first draft".into_buffer(),
                    remote_revision: None
                })
            ),
            Completion::Saved
        );
        assert_eq!(s.baseline.as_str(), "first draft");
        assert_eq!(s.revision, 2);
        assert!(s.dirty && !s.drained() && !s.conflicted());
        assert_eq!(
            s.take_receipt(),
            Some(Snapshot {
                revision: 1,
                text: "first draft".into_buffer()
            })
        );
        if !snapshot_already_queued {
            assert!(s.needs_snapshot);
            s.enqueue(Snapshot {
                revision: 2,
                text: "latest draft".into_buffer(),
            });
        }
        let next = s.next_commit().expect("newer draft must still be saved");
        assert_eq!(next.snapshot.text.as_str(), "latest draft");
        assert!(next.sequence > first.sequence);
        assert_eq!(
            s.complete(
                next.sequence,
                Ok(WriteOutcome::Written {
                    text: "latest draft".into_buffer(),
                    revision: None
                })
            ),
            Completion::Saved
        );
        assert!(s.drained());
    }
}

#[test]
fn cloud_publication_fences_every_old_write_outcome_until_explicit_reload() {
    for result in [
        Ok(WriteOutcome::Written {
            text: "old draft".into_buffer(),
            revision: None,
        }),
        Ok(WriteOutcome::Conflict {
            remote_text: "old draft".into_buffer(),
            remote_revision: None,
        }),
        Err(SessionError::new(ErrorKind::Io, "obsolete failure")),
    ] {
        let mut s = session(true);
        edit(&mut s, 1, "old draft");
        let old = s.next_commit().unwrap();
        assert!(matches!(
            s.observe("agent publication"),
            StorageObservation::Deferred(_)
        ));
        edit(&mut s, 2, "newer human draft");
        assert_eq!(s.complete(old.sequence, result), Completion::Retired);
        assert_eq!(s.baseline.as_str(), "base");
        assert_eq!(s.revision, 2);
        assert!(s.dirty && s.conflicted() && !s.drained());
        assert_eq!(
            s.conflict.as_ref().unwrap().theirs.as_str(),
            "agent publication"
        );
        assert!(s.take_receipt().is_none());
        assert!(s.next_commit().is_none());
        assert!(!s.retry());
        assert_eq!(
            s.reload_external().as_ref().map(|b| b.as_str()),
            Some("agent publication")
        );
        assert!(s.drained());
        assert_eq!(s.baseline.as_str(), "agent publication");
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
        assert!(matches!(
            s.observe(&content),
            StorageObservation::Adopted { .. }
        ));
        assert_eq!(s.baseline.as_str().as_bytes(), content.as_bytes());
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
    assert!(matches!(
        s.complete(
            old.sequence,
            Ok(WriteOutcome::Conflict {
                remote_text: "latest".into_buffer(),
                remote_revision: None
            })
        ),
        Completion::Adopted { .. }
    ));
    assert_eq!(s.baseline.as_str(), "latest");
    assert!(s.drained());
    assert!(s.next_commit().is_none());
    assert!(s.error.is_none());
}

#[test]
fn new_input_after_disk_adoption_waits_for_old_success_failure_or_conflict() {
    for result in [
        Ok(WriteOutcome::Written {
            text: "old".into_buffer(),
            revision: None,
        }),
        Ok(WriteOutcome::Conflict {
            remote_text: "old disk".into_buffer(),
            remote_revision: None,
        }),
        Err(SessionError::new(ErrorKind::Io, "old failure")),
    ] {
        let mut s = session(false);
        edit(&mut s, 1, "old");
        let old = s.next_commit().unwrap();
        s.observe("adopted disk");
        edit(&mut s, 3, "adopted disk plus new typing");
        assert!(s.next_commit().is_none());
        assert_eq!(s.complete(old.sequence, result), Completion::Retired);
        assert_eq!(s.baseline.as_str(), "adopted disk");
        assert!(s.error.is_none());
        assert!(s.take_receipt().is_none());
        let current = s.next_commit().unwrap();
        assert_eq!(
            current.snapshot.text.as_str(),
            "adopted disk plus new typing"
        );
        s.complete(
            current.sequence,
            Ok(WriteOutcome::Written {
                text: current.snapshot.text.into_buffer(),
                revision: None,
            }),
        );
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
            s.complete(old.sequence, Err(SessionError::new(ErrorKind::Io, error))),
            Completion::Failed(SessionError::new(ErrorKind::Io, error))
        );
        assert_eq!(s.error.as_ref().map(|e| e.message.as_str()), Some(error));
        assert_eq!(s.baseline.as_str(), "base");
        assert!(s.dirty && !s.drained());
        assert!(!s.needs_snapshot);
        assert!(s.next_commit().is_none());
        assert!(s.retry());
        assert!(s.needs_snapshot);
        s.enqueue(Snapshot {
            revision: 1,
            text: "human input".into_buffer(),
        });
        let retried = s.next_commit().unwrap();
        assert_eq!(retried.snapshot.text.as_str(), "human input");
        s.complete(
            retried.sequence,
            Ok(WriteOutcome::Written {
                text: retried.snapshot.text.into_buffer(),
                revision: None,
            }),
        );
        assert!(s.drained());
    }
}
