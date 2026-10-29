//! Explicit user opening is the only owner allowed to wake compute. File
//! reads, watches, readiness checks and status polling never allocate/resume.
use super::{Prepared, Target, model, prepare_verified};
use crate::{
    cloud_auth::{
        Broker, Cancellation, Error as AuthError,
        model::{ApiRequest, Binding},
    },
    workspace::contracts::{Error, ErrorKind},
};
use reqwest::Method;
use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Checking,
    Connecting,
    Files,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Recovery {
    Retry,
    Account,
    None,
}
#[derive(Clone, Debug)]
pub struct Failure {
    /// A product cloudPresentation code, never untrusted server prose.
    pub code: &'static str,
    pub recovery: Recovery,
    pub status: Option<u16>,
    /// The allowlisted server reason code, for collapsed Details.
    pub reason: Option<&'static str>,
}
impl Failure {
    pub fn new(code: &'static str, recovery: Recovery) -> Self {
        Self {
            code,
            recovery,
            status: None,
            reason: None,
        }
    }
    /// `describeCloudOpeningFailure(cause, "workspace")`.
    fn auth(error: AuthError) -> Self {
        Self::staged(error, super::failure::Stage::Workspace)
    }
    /// The exact-target authorization (`getCloudRepositoryContext`) fails at
    /// the project stage: a 5xx there is the service, not the workspace.
    fn project(refusal: super::Refusal) -> Self {
        match refusal {
            super::Refusal::Auth(error) => Self::staged(error, super::failure::Stage::Project),
            super::Refusal::Invalid => Self::new("project-response-mismatch", Recovery::None),
            super::Refusal::Unreadable => Self::new("project-access-denied", Recovery::None),
        }
    }
    fn staged(error: AuthError, stage: super::failure::Stage) -> Self {
        use super::failure::{Action, describe, from_auth};
        let (status, reason, retryable) = from_auth(&error);
        let described = describe(status, reason, retryable, stage);
        Self {
            code: described.code,
            recovery: match described.action {
                Action::Retry => Recovery::Retry,
                Action::Account => Recovery::Account,
                Action::None => Recovery::None,
            },
            status: described.status,
            reason: described.reason,
        }
    }
    fn provider(error: Error) -> Self {
        Self::new(
            match error.kind {
                ErrorKind::PermissionDenied => "workspace-access-denied",
                ErrorKind::StaleLease | ErrorKind::ForeignResource => "project-response-mismatch",
                _ => "workspace-open-failed",
            },
            if matches!(
                error.kind,
                ErrorKind::PermissionDenied | ErrorKind::StaleLease | ErrorKind::ForeignResource
            ) {
                Recovery::None
            } else {
                Recovery::Retry
            },
        )
    }
}

fn request(
    broker: &Broker,
    binding: &Binding,
    cancel: &Cancellation,
    project: &str,
    method: Method,
    wait: bool,
) -> Result<serde_json::Value, Failure> {
    broker
        .request_scoped(
            binding,
            &ApiRequest {
                method,
                path: format!("/projects/{project}/workbench"),
                query: if wait {
                    vec![("wait_seconds".into(), "20".into())]
                } else {
                    Vec::new()
                },
                body: None,
            },
            cancel,
        )
        .map_err(Failure::auth)
}
fn decode(value: serde_json::Value, project: &str) -> Result<model::Runtime, Failure> {
    let row: model::Runtime = serde_json::from_value(value)
        .map_err(|_| Failure::new("project-response-mismatch", Recovery::None))?;
    if row.project_id != project
        || row.id.is_empty()
        || uuid::Uuid::parse_str(&row.generation).is_err()
    {
        return Err(Failure::new("project-response-mismatch", Recovery::None));
    }
    Ok(row)
}
fn state(row: &model::Runtime) -> Result<bool, Failure> {
    if let Some(operation) = &row.operation
        && operation.error.is_some()
    {
        return Err(Failure::new(
            "workspace-open-failed",
            if operation.retryable {
                Recovery::Retry
            } else {
                Recovery::None
            },
        ));
    }
    if matches!(row.state.as_str(), "retained" | "cleanup_pending") {
        return Err(Failure::new("workspace-recovery-required", Recovery::None));
    }
    Ok(row.state == "running" && row.operation.as_ref().is_none_or(|op| !op.pending))
}
fn deadline(row: &model::Runtime) -> Result<Instant, Failure> {
    let mut duration = Duration::from_secs(620);
    if let Some(operation) = &row.operation
        && operation.pending
        && let Some(value) = &operation.deadline
    {
        let date = chrono::DateTime::parse_from_rfc3339(value)
            .map_err(|_| Failure::new("workspace-open-failed", Recovery::Retry))?;
        let millis = u64::try_from(date.timestamp_millis())
            .map_err(|_| Failure::new("workspace-open-failed", Recovery::Retry))?;
        duration = duration.min(
            (UNIX_EPOCH + Duration::from_millis(millis))
                .duration_since(SystemTime::now())
                .unwrap_or_default(),
        );
    }
    Ok(Instant::now() + duration)
}

/// Run on a worker. The UI passes a distinct, cancellable navigation intent;
/// it must still validate that intent before consuming the one-use handoff.
pub fn prepare(
    broker: Arc<Broker>,
    binding: Binding,
    target: Target,
    cancel: &Cancellation,
    force: bool,
    mut progress: impl FnMut(Phase),
) -> Result<Prepared, Failure> {
    progress(Phase::Checking);
    let scope = cancel.child();
    let context =
        super::authorize_target(&broker, &binding, &target, &scope).map_err(Failure::project)?;
    let project = target.project().map_err(Failure::provider)?;
    let mut status = request(&broker, &binding, &scope, project, Method::GET, false)?;
    let current = if status["workspace"].is_null() {
        None
    } else {
        Some(decode(status["workspace"].take(), project)?)
    };
    // Retained workspaces require recovery, never an implicit replacement.
    if current
        .as_ref()
        .is_some_and(|r| matches!(r.state.as_str(), "retained" | "cleanup_pending"))
    {
        return Err(Failure::new("workspace-recovery-required", Recovery::None));
    }
    let row = match current {
        Some(row) if !force && state(&row).unwrap_or(false) => row,
        _ => {
            progress(Phase::Connecting);
            // Exactly one POST. A lost receipt is returned as unknown; retries
            // begin with GET so a running server is not woken a second time.
            let mut row = decode(
                request(&broker, &binding, &scope, project, Method::POST, false)?,
                project,
            )?;
            let deadline = deadline(&row)?;
            while !state(&row)? {
                scope.check().map_err(Failure::auth)?;
                if Instant::now() >= deadline {
                    return Err(Failure::new("workspace-open-failed", Recovery::Retry));
                }
                let started = Instant::now();
                let mut next = request(&broker, &binding, &scope, project, Method::GET, true)?;
                let next = decode(next["workspace"].take(), project)?;
                if row.id != next.id || row.generation != next.generation {
                    return Err(Failure::new("project-response-mismatch", Recovery::None));
                }
                row = next;
                if !state(&row)? {
                    // Older servers may ignore wait_seconds. Poll at most once
                    // per second and remain responsive to cancellation.
                    while started.elapsed() < Duration::from_secs(1) && Instant::now() < deadline {
                        scope.check().map_err(Failure::auth)?;
                        std::thread::sleep(Duration::from_millis(20));
                    }
                }
            }
            row
        }
    };
    progress(Phase::Files);
    prepare_verified(broker, binding, context, scope, row).map_err(Failure::provider)
}

#[cfg(test)]
mod tests {
    use super::{Failure, Recovery};
    use crate::cloud_auth::Error;

    #[test]
    fn opening_failures_preserve_status_and_access_recovery() {
        // The presentation must distinguish access/account decisions from a
        // retryable opening, and retain only numeric HTTP diagnostics.
        for (status, code, recovery) in [
            (401, "project-sign-in-required", Recovery::Account),
            (402, "workspace-plan-required", Recovery::Account),
            (403, "workspace-access-denied", Recovery::None),
            (404, "workspace-service-unavailable", Recovery::None),
            (426, "app-update-required", Recovery::None),
            (429, "service-busy", Recovery::Retry),
        ] {
            let failure = Failure::auth(Error::Http(status));
            assert_eq!(
                (failure.status, failure.code, failure.recovery),
                (Some(status), code, recovery)
            );
        }
        assert_eq!(Failure::auth(Error::Cancelled).recovery, Recovery::None);
    }
}
