//! `cloud-initialization/state-derivation.mjs`: the pure projection from a
//! durable first-publication record plus observed facts to independent state
//! axes and the actions the UI may offer (`initialization-and-first-push.md`
//! §7). The UI renders `actions`; it never infers recovery from a generic
//! "can resume" flag. Cleanup never depends on local HEAD; a published
//! Project never offers deletion as push compensation.
#![cfg_attr(not(test), allow(dead_code))]

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Project {
    Absent,
    Creating,
    Empty,
    Published,
    Deleting,
    Deleted,
    Unavailable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Push {
    Idle,
    Preparing,
    Uploading,
    Confirming,
    Accepted,
    Failed,
    Uncertain,
    Conflict,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Local {
    Clean,
    Dirty,
    SourceAdvanced,
    SourceMissing,
    BranchSwitched,
    RemoteConflict,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cleanup {
    None,
    Requested,
    Deleting,
    Failed,
    Completed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    RetryPush,
    PushLatest,
    ChooseSource,
    Reconcile,
    DeleteEmptyProject,
    FinishCleanup,
}
/// Journal (schema v2) spellings of the state axes.
impl Project {
    pub fn from_journal(value: &str) -> Option<Self> {
        Some(match value {
            "absent" => Self::Absent,
            "creating" => Self::Creating,
            "empty" => Self::Empty,
            "published" => Self::Published,
            "deleting" => Self::Deleting,
            "deleted" => Self::Deleted,
            "unavailable" => Self::Unavailable,
            _ => return None,
        })
    }
}
impl Push {
    pub fn from_journal(value: &str) -> Option<Self> {
        Some(match value {
            "idle" => Self::Idle,
            "preparing" => Self::Preparing,
            "uploading" => Self::Uploading,
            "confirming" => Self::Confirming,
            "accepted" => Self::Accepted,
            "failed" => Self::Failed,
            "uncertain" => Self::Uncertain,
            "conflict" => Self::Conflict,
            _ => return None,
        })
    }
}
impl Cleanup {
    pub fn from_journal(value: &str) -> Option<Self> {
        Some(match value {
            "none" => Self::None,
            "requested" => Self::Requested,
            "deleting" => Self::Deleting,
            "failed" => Self::Failed,
            "completed" => Self::Completed,
            _ => return None,
        })
    }
}
/// The durable journal record (fields the projection reads).
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub project: Project,
    pub push: Push,
    pub cleanup: Cleanup,
    pub selected_source_branch: String,
    pub attempt_commit: Option<String>,
    /// States of earlier physical attempts.
    pub attempt_history: Vec<Push>,
    pub last_error: Option<String>,
}
/// Observed facts (remote ref/receipt, local status).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Facts {
    pub remote_accepted: bool,
    pub remote_conflict: bool,
    pub local_remote_conflict: bool,
    pub source_missing: bool,
    pub source_tip: Option<String>,
    pub current_branch: Option<String>,
    pub dirty: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub project: Project,
    pub push: Push,
    pub local: Local,
    pub cleanup: Cleanup,
    pub actions: Vec<Action>,
}

/// `requiresSameCommitRetry`: a lost response may still publish, so the
/// retry keeps its exact candidate.
pub fn requires_same_commit_retry(record: &Record) -> bool {
    let unresolved = |p: &Push| matches!(p, Push::Uploading | Push::Confirming | Push::Uncertain);
    unresolved(&record.push) || record.attempt_history.iter().any(unresolved)
}
fn normalize_branch(branch: Option<&str>) -> Option<&str> {
    branch.map(str::trim).filter(|b| {
        !b.is_empty() && !b.eq_ignore_ascii_case("head") && !b.eq_ignore_ascii_case("detached")
    })
}

/// `deriveCloudInitializationState`.
pub fn derive(record: &Record, facts: &Facts) -> State {
    let deleting = matches!(
        record.cleanup,
        Cleanup::Requested | Cleanup::Deleting | Cleanup::Failed
    );
    let project = if record.push == Push::Accepted || facts.remote_accepted {
        Project::Published
    } else if record.cleanup == Cleanup::Completed {
        Project::Deleted
    } else if deleting {
        Project::Deleting
    } else {
        record.project
    };
    let push = if facts.remote_accepted {
        Push::Accepted
    } else if facts.remote_conflict {
        Push::Conflict
    } else {
        record.push
    };
    let advanced = facts
        .source_tip
        .as_ref()
        .zip(record.attempt_commit.as_ref())
        .is_some_and(|(tip, attempt)| tip != attempt);
    let local = if facts.local_remote_conflict {
        Local::RemoteConflict
    } else if facts.source_missing {
        Local::SourceMissing
    } else if normalize_branch(facts.current_branch.as_deref())
        .is_some_and(|b| b != record.selected_source_branch)
    {
        Local::BranchSwitched
    } else if advanced {
        Local::SourceAdvanced
    } else if facts.dirty {
        Local::Dirty
    } else {
        Local::Clean
    };
    let actions = if deleting {
        vec![Action::FinishCleanup]
    } else if matches!(project, Project::Published | Project::Deleted) || push == Push::Accepted {
        vec![]
    } else if project == Project::Unavailable {
        vec![Action::FinishCleanup]
    } else if matches!(push, Push::Uploading | Push::Confirming) {
        vec![]
    } else {
        let mut actions = vec![];
        if requires_same_commit_retry(record) && local != Local::RemoteConflict {
            actions.push(Action::RetryPush);
        } else if local == Local::SourceMissing {
            actions.push(Action::ChooseSource);
        } else if push != Push::Conflict && local != Local::RemoteConflict {
            actions.push(if advanced {
                Action::PushLatest
            } else {
                Action::RetryPush
            });
        }
        if project == Project::Empty && record.last_error.as_deref() != Some("CLEANUP_NOT_ALLOWED")
        {
            actions.push(Action::DeleteEmptyProject);
        }
        actions
    };
    State {
        project,
        push,
        local,
        cleanup: record.cleanup,
        actions,
    }
}

/// The single-push ceiling: 2 GiB of compressed pack data (inclusive).
pub const PUSH_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> Record {
        Record {
            project: Project::Empty,
            push: Push::Failed,
            cleanup: Cleanup::None,
            selected_source_branch: "main".into(),
            attempt_commit: Some("a1".into()),
            attempt_history: vec![],
            last_error: None,
        }
    }

    #[test]
    fn journal_spellings_decode_every_state() {
        let projects = [
            "absent",
            "creating",
            "empty",
            "published",
            "deleting",
            "deleted",
            "unavailable",
        ];
        assert!(projects.iter().all(|p| Project::from_journal(p).is_some()));
        let pushes = [
            "idle",
            "preparing",
            "uploading",
            "confirming",
            "accepted",
            "failed",
            "uncertain",
            "conflict",
        ];
        assert!(pushes.iter().all(|p| Push::from_journal(p).is_some()));
        assert!(
            ["none", "requested", "deleting", "failed", "completed"]
                .iter()
                .all(|c| Cleanup::from_journal(c).is_some())
        );
        assert_eq!(Push::from_journal("unknown"), None);
        assert_eq!(Action::Reconcile, Action::Reconcile);
    }

    #[test]
    fn empty_project_after_a_failed_push_offers_retry_and_explicit_deletion() {
        let s = derive(&record(), &Facts::default());
        assert_eq!(
            (s.project, s.push, s.local),
            (Project::Empty, Push::Failed, Local::Clean)
        );
        assert_eq!(
            s.actions,
            vec![Action::RetryPush, Action::DeleteEmptyProject]
        );
        // Refused cleanup returns to the send workflow without Discard.
        let refused = Record {
            last_error: Some("CLEANUP_NOT_ALLOWED".into()),
            ..record()
        };
        assert_eq!(
            derive(&refused, &Facts::default()).actions,
            vec![Action::RetryPush]
        );
    }

    #[test]
    fn uncertain_attempts_retry_the_same_commit_even_when_head_moved() {
        let r = Record {
            push: Push::Uncertain,
            ..record()
        };
        let facts = Facts {
            source_tip: Some("b2".into()),
            ..Facts::default()
        };
        let s = derive(&r, &facts);
        assert_eq!(s.local, Local::SourceAdvanced);
        assert_eq!(
            s.actions,
            vec![Action::RetryPush, Action::DeleteEmptyProject]
        );
        // A resolved failure after HEAD moved offers the newer commit.
        assert_eq!(
            derive(&record(), &facts).actions,
            vec![Action::PushLatest, Action::DeleteEmptyProject]
        );
    }

    #[test]
    fn cleanup_published_running_and_conflict_states() {
        let cleaning = Record {
            cleanup: Cleanup::Failed,
            ..record()
        };
        let s = derive(
            &cleaning,
            &Facts {
                dirty: true,
                current_branch: Some("other".into()),
                ..Facts::default()
            },
        );
        assert_eq!(
            (s.project, s.actions.clone()),
            (Project::Deleting, vec![Action::FinishCleanup])
        );
        let published = derive(
            &record(),
            &Facts {
                remote_accepted: true,
                ..Facts::default()
            },
        );
        assert_eq!(
            (published.project, published.push),
            (Project::Published, Push::Accepted)
        );
        assert!(published.actions.is_empty());
        let running = Record {
            push: Push::Uploading,
            ..record()
        };
        assert!(derive(&running, &Facts::default()).actions.is_empty());
        let conflict = derive(
            &record(),
            &Facts {
                remote_conflict: true,
                ..Facts::default()
            },
        );
        assert_eq!(conflict.actions, vec![Action::DeleteEmptyProject]);
        let missing = derive(
            &record(),
            &Facts {
                source_missing: true,
                ..Facts::default()
            },
        );
        assert_eq!(missing.actions[0], Action::ChooseSource);
        let switched = derive(
            &record(),
            &Facts {
                current_branch: Some("feature".into()),
                ..Facts::default()
            },
        );
        assert_eq!(switched.local, Local::BranchSwitched);
        assert_eq!(
            derive(
                &record(),
                &Facts {
                    current_branch: Some("HEAD".into()),
                    ..Facts::default()
                }
            )
            .local,
            Local::Clean
        );
        assert_eq!(PUSH_LIMIT_BYTES, 2_147_483_648);
    }
}
