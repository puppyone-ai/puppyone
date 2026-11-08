//! Explicit user opening is the only owner allowed to wake compute. File
//! reads, watches, readiness checks and status polling never allocate/resume.
use super::{Prepared, Target, model, prepare_verified};
use crate::{
    cloud::auth::{
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
    /// The server's allowlisted code, shown beside the message.
    pub reason: Option<&'static str>,
    /// The id the server's log knows the failed request by.
    pub request_id: Option<crate::cloud::auth::model::RequestId>,
    /// The workspace moved while opening; opened again once by itself.
    pub reopen: bool,
}
impl Failure {
    pub fn new(code: &'static str, recovery: Recovery) -> Self {
        Self {
            code,
            recovery,
            status: None,
            reason: None,
            request_id: None,
            reopen: false,
        }
    }
    /// `formatCloudDiagnostic`: the server's code (or HTTP status) and the
    /// request id, for a report; none when there is nothing beyond the
    /// message.
    pub fn diagnostic(&self) -> Option<(Option<String>, Option<String>)> {
        let code = self
            .reason
            .map(str::to_owned)
            .or_else(|| self.status.map(|s| format!("HTTP {s}")));
        let request = self.request_id.map(|r| r.as_str().to_owned());
        (code.is_some() || request.is_some()).then_some((code, request))
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
    /// `describeCloudOpeningFailure` of the opening's own failure, at the
    /// workspace stage.
    fn described(status: Option<u16>, reason: Option<&str>, retryable: Option<bool>) -> Self {
        let cause = super::failure::Cause {
            status,
            reason: reason.and_then(super::failure::allowlisted),
            retryable,
            request_id: None,
        };
        Self::of(cause, reason, super::failure::Stage::Workspace)
    }
    fn staged(error: AuthError, stage: super::failure::Stage) -> Self {
        let cause = super::failure::from_auth(&error);
        Self::of(cause, cause.reason, stage)
    }
    fn of(
        cause: super::failure::Cause,
        reason: Option<&str>,
        stage: super::failure::Stage,
    ) -> Self {
        use super::failure::{Action, describe};
        let described = describe(cause.status, reason, cause.retryable, stage);
        Self {
            code: described.code,
            recovery: match described.action {
                Action::Retry => Recovery::Retry,
                Action::Account => Recovery::Account,
                Action::None => Recovery::None,
            },
            status: described.status,
            reason: described.reason,
            request_id: cause.request_id,
            reopen: described.reopen,
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
    let started = Instant::now();
    let stage = if method == Method::GET {
        "status"
    } else {
        "open"
    };
    broker
        .request_scoped(
            binding,
            &ApiRequest {
                idempotency_key: None,
                method: method.clone(),
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
        .map_err(|error| {
            record_failure(stage, &method, &error, started);
            Failure::auth(error)
        })
}
/// One local line per failed opening request (`recordOpeningFailure`), so
/// a report can be matched to the server's log by request id. It names no
/// project, path, file or credential and is never sent anywhere; cancelled
/// requests are not recorded.
fn record_failure(stage: &str, method: &Method, error: &AuthError, started: Instant) {
    if matches!(error, AuthError::Cancelled | AuthError::SessionChanged) {
        return;
    }
    let cause = super::failure::from_auth(error);
    crate::platform::diagnostics::warn(
        "[cloud-opening] request failed",
        serde_json::json!({
            "stage": stage,
            "method": method.as_str(),
            "status": cause.status,
            "code": cause.reason,
            "retryable": cause.retryable,
            "request_id": cause.request_id.map(|r| r.as_str().to_owned()),
            "duration_ms": started.elapsed().as_millis() as u64,
        }),
    );
}
fn decode(value: serde_json::Value, project: &str) -> Result<model::Runtime, Failure> {
    let row: model::Runtime = serde_json::from_value(value)
        .map_err(|_| Failure::new("project-response-mismatch", Recovery::None))?;
    if row.project_id != project || row.id.is_empty() || !model::generation(&row.generation) {
        return Err(Failure::new("project-response-mismatch", Recovery::None));
    }
    Ok(row)
}
/// `cloudWorkspaceOpeningPhase`: compute comes up first; these server
/// phases mean the wait is now for the files.
fn phase(row: &model::Runtime) -> Phase {
    match row.operation.as_ref().and_then(|op| op.phase.as_deref()) {
        Some("initializing" | "checking_files") => Phase::Files,
        _ => Phase::Connecting,
    }
}
fn state(row: &model::Runtime) -> Result<bool, Failure> {
    // `failure("…", 503, operation.error, operation.retryable)`: the
    // server's reason decides the copy and the action.
    if let Some(operation) = &row.operation
        && let Some(error) = &operation.error
    {
        return Err(Failure::described(
            Some(503),
            Some(error),
            Some(operation.retryable),
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
/// A workspace that moved while it was opening is opened again once before
/// the user hears about it; a second move is reported, never looped.
pub fn prepare(
    broker: Arc<Broker>,
    binding: Binding,
    target: Target,
    cancel: &Cancellation,
    force: bool,
    mut report: impl FnMut(Phase),
) -> Result<Prepared, Failure> {
    // `progress.set`: a stage is reported once, when it changes.
    let mut last = None;
    let mut progress = |phase: Phase| {
        if last != Some(phase) {
            last = Some(phase);
            report(phase);
        }
    };
    match attempt(
        broker.clone(),
        binding.clone(),
        target.clone(),
        cancel,
        force,
        &mut progress,
    ) {
        Err(failure) if failure.reopen && cancel.check().is_ok() => {
            attempt(broker, binding, target, cancel, force, &mut progress)
        }
        result => result,
    }
}
fn attempt(
    broker: Arc<Broker>,
    binding: Binding,
    target: Target,
    cancel: &Cancellation,
    force: bool,
    progress: &mut impl FnMut(Phase),
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
                progress(phase(&row));
                if Instant::now() >= deadline {
                    // `504 workbench_start_timeout`: a connection timeout.
                    return Err(Failure::described(
                        Some(504),
                        Some("workbench_start_timeout"),
                        None,
                    ));
                }
                let started = Instant::now();
                let mut next = request(&broker, &binding, &scope, project, Method::GET, true)?;
                let next = decode(next["workspace"].take(), project)?;
                if row.id != next.id || row.generation != next.generation {
                    // Replaced while it was opening: open it again.
                    return Err(Failure::described(
                        Some(409),
                        Some("workbench_generation_changed"),
                        None,
                    ));
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
    use crate::cloud::auth::Error;

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
