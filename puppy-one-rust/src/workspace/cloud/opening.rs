//! Explicit user opening is the only owner allowed to wake compute. File
//! reads, watches, readiness checks and status polling never allocate/resume.
use super::{Prepared, Target, VerifyError, model, prepare_verified_opening};
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
            super::Refusal::Invalid => Self::described_stage(
                None,
                Some("repository_target_mismatch"),
                Some(false),
                super::failure::Stage::Project,
            ),
            super::Refusal::Unreadable => {
                Self::described_stage(Some(403), None, Some(false), super::failure::Stage::Project)
            }
        }
    }
    /// `describeCloudOpeningFailure` of the opening's own failure, at the
    /// workspace stage.
    fn described(status: Option<u16>, reason: Option<&str>, retryable: Option<bool>) -> Self {
        Self::described_stage(status, reason, retryable, super::failure::Stage::Workspace)
    }
    fn described_stage(
        status: Option<u16>,
        reason: Option<&str>,
        retryable: Option<bool>,
        stage: super::failure::Stage,
    ) -> Self {
        let cause = super::failure::Cause {
            status,
            reason: reason.and_then(super::failure::diagnostic_code),
            retryable,
            request_id: None,
        };
        Self::of(cause, reason, stage)
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
        match error.kind {
            ErrorKind::PermissionDenied => {
                Self::described(Some(403), Some("workbench_access_denied"), Some(false))
            }
            ErrorKind::StaleLease | ErrorKind::ForeignResource => {
                Self::described(None, Some("repository_target_mismatch"), Some(false))
            }
            _ => Self::described(None, Some("CLOUD_INVALID_RESPONSE"), None),
        }
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
    record_failure_elapsed(stage, method, error, started.elapsed());
}
fn record_failure_elapsed(stage: &str, method: &Method, error: &AuthError, elapsed: Duration) {
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
            "duration_ms": elapsed.as_millis() as u64,
        }),
    );
}
fn decode(value: serde_json::Value, project: &str) -> Result<model::Runtime, Failure> {
    let mismatch = || Failure::described(None, Some("repository_target_mismatch"), Some(false));
    let row: model::Runtime = serde_json::from_value(value).map_err(|_| mismatch())?;
    if row.project_id != project || row.id.is_empty() || !model::generation(&row.generation) {
        return Err(mismatch());
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
        return Err(Failure::described(
            Some(409),
            Some("workbench_requires_recovery"),
            Some(false),
        ));
    }
    Ok(row.state == "running" && row.operation.as_ref().is_none_or(|op| !op.pending))
}
fn parse_deadline_millis(value: &str) -> Option<i64> {
    let trimmed = value.trim();
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Some(date.timestamp_millis());
    }
    let normalized = trimmed
        .strip_suffix(['Z', 'z'])
        .map(|prefix| format!("{prefix}+00:00"));
    let candidate = normalized.as_deref().unwrap_or(trimmed);
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f%#z", "%Y-%m-%d %H:%M:%S%.f%#z"] {
        if let Ok(date) = chrono::DateTime::parse_from_str(candidate, fmt) {
            return Some(date.timestamp_millis());
        }
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Some(naive.and_utc().timestamp_millis());
        }
    }
    None
}
fn deadline(row: &model::Runtime) -> Result<Instant, Failure> {
    let mut duration = Duration::from_secs(620);
    if let Some(operation) = &row.operation
        && operation.pending
        && let Some(value) = &operation.deadline
    {
        let timeout = || Failure::described(Some(504), Some("workbench_start_timeout"), None);
        let millis = parse_deadline_millis(value)
            .and_then(|ms| u64::try_from(ms).ok())
            .ok_or_else(timeout)?;
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
fn take_entries(value: &mut serde_json::Value) -> Option<serde_json::Value> {
    value
        .get_mut("entries")
        .and_then(|entries| entries.is_array().then(|| entries.take()))
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
    let status_entries = take_entries(&mut status);
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
        return Err(Failure::described(
            Some(409),
            Some("workbench_requires_recovery"),
            Some(false),
        ));
    }
    let (row, opening_root) = match current {
        Some(row) if !force && state(&row).unwrap_or(false) => (row, status_entries),
        _ => {
            progress(Phase::Connecting);
            // Exactly one POST. Retries begin with GET so a running server is
            // not woken a second time.
            let mut row = decode(
                request(&broker, &binding, &scope, project, Method::POST, false)?,
                project,
            )?;
            let mut entries = None;
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
                if next["workspace"].is_null() {
                    return Err(Failure::described(Some(404), None, Some(false)));
                }
                let next_entries = take_entries(&mut next);
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
                entries = next_entries;
                if !state(&row)? {
                    // Older servers may ignore wait_seconds. Poll at most once
                    // per second and remain responsive to cancellation.
                    while started.elapsed() < Duration::from_secs(1) && Instant::now() < deadline {
                        scope.check().map_err(Failure::auth)?;
                        std::thread::sleep(Duration::from_millis(20));
                    }
                }
            }
            (row, entries)
        }
    };
    progress(Phase::Files);
    prepare_verified_opening(broker, binding, context, scope, row, opening_root).map_err(|error| {
        match error {
            VerifyError::Auth(failure) => {
                if failure.dispatched {
                    record_failure_elapsed("files", &Method::GET, &failure.error, failure.elapsed);
                }
                Failure::auth(failure.error)
            }
            VerifyError::Contract(error) => Failure::provider(error),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{Failure, Recovery};
    use crate::cloud::auth::Error;

    /// `electron.cloud-ipc.test.mjs` (opening diagnostics): a failed opening
    /// request is one local line naming its stage, method, status, code,
    /// retry decision, request id and duration — never the project or a
    /// path; a cancelled or superseded request writes nothing.
    #[test]
    fn an_opening_failure_is_one_private_line_and_a_cancellation_is_none() {
        use crate::cloud::auth::model::Diagnostic;
        use reqwest::Method;
        use std::time::Duration;
        let ours = |id: &str| {
            crate::platform::diagnostics::recorded("[cloud-opening] request failed")
                .into_iter()
                .filter(|l| l["fields"]["request_id"] == id)
                .collect::<Vec<_>>()
        };
        let diagnostic = Diagnostic::read(
            &serde_json::json!({"data": {"retryable": true}}),
            Some("req-opening-log-9"),
        );
        super::record_failure_elapsed(
            "open",
            &Method::POST,
            &Error::Response(503, Some("workbench_connection_unavailable"), diagnostic),
            Duration::from_millis(5),
        );
        let lines = ours("req-opening-log-9");
        assert_eq!(lines.len(), 1);
        let fields = lines[0]["fields"].as_object().unwrap();
        assert_eq!(
            serde_json::Value::Object(fields.clone()),
            serde_json::json!({"stage": "open", "method": "POST", "status": 503,
                "code": "workbench_connection_unavailable", "retryable": true,
                "request_id": "req-opening-log-9", "duration_ms": 5})
        );
        let quiet = Diagnostic::read(&serde_json::json!({}), Some("req-opening-quiet"));
        for error in [Error::Cancelled, Error::SessionChanged] {
            super::record_failure_elapsed("status", &Method::GET, &error, Duration::ZERO);
        }
        super::record_failure_elapsed(
            "status",
            &Method::GET,
            &Error::Response(500, None, quiet),
            Duration::ZERO,
        );
        assert_eq!(ours("req-opening-quiet").len(), 1, "only the real failure");
    }

    /// `cloudOpeningFailureClassification`: what "Couldn't open Cloud
    /// Computer" says, decided by what the person can do next, and the
    /// server's code and request id shown beside it.
    #[test]
    fn workspace_opening_failures_say_what_to_do_next_and_carry_their_diagnostics() {
        use crate::cloud::auth::model::Diagnostic;
        use Recovery::{Account, None as Nothing, Retry};
        for (label, status, reason, code, recovery, reopen) in [
            (
                "server start deadline",
                503,
                Some("workbench_start_timeout"),
                "workspace-start-timeout",
                Retry,
                false,
            ),
            (
                "client start deadline",
                504,
                Some("workbench_start_timeout"),
                "workspace-start-timeout",
                Retry,
                false,
            ),
            (
                "readiness timeout",
                503,
                Some("workbench_connection_timeout"),
                "workspace-start-timeout",
                Retry,
                false,
            ),
            (
                "still starting",
                503,
                Some("workbench_preparing"),
                "workspace-preparing",
                Retry,
                false,
            ),
            (
                "connection lost",
                503,
                Some("workbench_connection_unavailable"),
                "workspace-connection-unavailable",
                Retry,
                false,
            ),
            (
                "unclassified server error",
                500,
                None,
                "workspace-open-failed",
                Retry,
                false,
            ),
            (
                "gateway error",
                502,
                None,
                "workspace-open-failed",
                Retry,
                false,
            ),
            (
                "observer capacity",
                503,
                Some("workbench_observer_capacity"),
                "workspace-open-failed",
                Retry,
                false,
            ),
            (
                "generation replaced",
                409,
                Some("workbench_generation_changed"),
                "workspace-changed",
                Retry,
                true,
            ),
            (
                "paused during handoff",
                409,
                Some("workbench_not_running"),
                "workspace-changed",
                Retry,
                true,
            ),
            (
                "not ready",
                409,
                Some("workbench_not_ready"),
                "workspace-changed",
                Retry,
                true,
            ),
            (
                "operation fenced",
                409,
                Some("workbench_operation_replaced"),
                "workspace-changed",
                Retry,
                true,
            ),
            (
                "authorization revision moved",
                409,
                Some("workbench_context_changed"),
                "workspace-changed",
                Retry,
                true,
            ),
            (
                "disk lost",
                503,
                Some("workbench_disk_lost"),
                "workspace-disk-lost",
                Retry,
                false,
            ),
            (
                "needs recovery",
                409,
                Some("workbench_requires_recovery"),
                "workspace-recovery-required",
                Nothing,
                false,
            ),
            (
                "plan required",
                402,
                None,
                "workspace-plan-required",
                Account,
                false,
            ),
            (
                "access denied",
                403,
                Some("workbench_access_denied"),
                "workspace-access-denied",
                Nothing,
                false,
            ),
            (
                "project not ready",
                409,
                Some("workbench_unavailable"),
                "project-unavailable",
                Nothing,
                false,
            ),
            (
                "provider not configured",
                503,
                Some("workbench_provider_not_configured"),
                "workspace-not-configured",
                Nothing,
                false,
            ),
        ] {
            let failure = Failure::described(Some(status), reason, None);
            assert_eq!(
                (failure.code, failure.recovery, failure.reopen),
                (code, recovery, reopen),
                "{label}"
            );
        }
        // The server's code and request id beside the message.
        let failure = Failure::auth(Error::Response(
            503,
            Some("workbench_start_timeout"),
            Diagnostic::read(&serde_json::json!({}), Some("req-7f3a")),
        ));
        assert_eq!(
            failure.diagnostic(),
            Some((
                Some("workbench_start_timeout".to_owned()),
                Some("req-7f3a".to_owned())
            ))
        );
        // The HTTP status when the server named no code.
        assert_eq!(
            Failure::auth(Error::Http(500)).diagnostic(),
            Some((Some("HTTP 500".to_owned()), None))
        );
        // No server string outside the workspace namespace, no malformed
        // request id.
        let private = Failure::auth(Error::Response(
            503,
            None,
            Diagnostic::read(&serde_json::json!({}), Some("id with spaces")),
        ));
        assert_eq!(
            private.diagnostic(),
            Some((Some("HTTP 503".to_owned()), None))
        );
        assert_eq!(
            Failure::described(Some(503), Some("private_customer_key"), None).diagnostic(),
            Some((Some("HTTP 503".to_owned()), None))
        );
        // Nothing to report without a server answer.
        assert_eq!(Failure::auth(Error::Cancelled).diagnostic(), None);
    }

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

    #[test]
    fn stale_running_workspace_and_open_post_failures_preserve_codes_reopen_and_reuse_entries() {
        use crate::cloud::auth::{
            Cancellation, ServiceCode, model::Diagnostic, responding_account_fixture,
        };
        use serde_json::json;
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };

        let context_ok = || {
            json!({
                "code": 0,
                "data": {
                    "target": {"kind": "project_root", "project_id": "project-a"},
                    "project": {
                        "id": "project-a",
                        "name": "My project 0813",
                        "capabilities": ["content.read", "content.write"]
                    },
                    "scope_path": null
                }
            })
        };
        let generation = "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859";

        // 1. POST /workbench (`stage: "open"`) returning 503 `workbench_preparing`
        // keeps its product code, retry action, and request id.
        let open_diag = Diagnostic::read(
            &json!({"data": {"code": "workbench_preparing", "retryable": true}}),
            Some("req-open-503"),
        );
        let (broker, _rx) = responding_account_fixture(Arc::new(move |req| {
            if req.path.ends_with("/repository-context") {
                return Ok(context_ok());
            }
            if req.path.ends_with("/workbench") && req.method == reqwest::Method::GET {
                return Ok(json!({
                    "workspace": {
                        "id": "ws-1",
                        "project_id": "project-a",
                        "generation": generation,
                        "state": "paused",
                        "operation": null
                    }
                }));
            }
            if req.path.ends_with("/workbench") && req.method == reqwest::Method::POST {
                return Err(Error::Response(503, Some("workbench_preparing"), open_diag));
            }
            panic!("unexpected request {} {}", req.method, req.path);
        }));
        let binding = broker.signed_in_binding().unwrap();
        let failure = super::prepare(
            broker,
            binding,
            super::Target::ProjectRoot {
                project_id: "project-a".into(),
            },
            &Cancellation::default(),
            false,
            |_| {},
        )
        .err()
        .unwrap();
        assert_eq!(failure.code, "workspace-preparing");
        assert_eq!(failure.recovery, Recovery::Retry);
        assert_eq!(
            failure.diagnostic(),
            Some((
                Some("workbench_preparing".into()),
                Some("req-open-503".into())
            ))
        );
        let logged = crate::platform::diagnostics::recorded("[cloud-opening] request failed");
        let open_log = logged
            .iter()
            .find(|l| l["fields"]["request_id"] == "req-open-503")
            .expect("open stage log");
        assert_eq!(open_log["fields"]["stage"], "open");
        assert_eq!(open_log["fields"]["code"], "workbench_preparing");

        // 2. GET /workbench/files (`stage: "files"`, e.g. WorkerLost on a 2-day-old
        // workspace whose DB row still says `running`) preserves `workbench_preparing`
        // and its request id instead of collapsing into a blank `workspace-open-failed`.
        let files_diag = Diagnostic::read(
            &json!({"data": {"code": "workbench_preparing", "retryable": true}}),
            Some("req-files-503"),
        );
        let (broker, _rx) = responding_account_fixture(Arc::new(move |req| {
            if req.path.ends_with("/repository-context") {
                return Ok(context_ok());
            }
            if req.path.ends_with("/workbench") && req.method == reqwest::Method::GET {
                return Ok(json!({
                    "workspace": {
                        "id": "ws-1",
                        "project_id": "project-a",
                        "generation": generation,
                        "state": "running",
                        "operation": null
                    }
                }));
            }
            if req.path.ends_with("/workbench/files") {
                return Err(Error::Response(
                    503,
                    Some("workbench_preparing"),
                    files_diag,
                ));
            }
            panic!("unexpected request {} {}", req.method, req.path);
        }));
        let binding = broker.signed_in_binding().unwrap();
        let failure = super::prepare(
            broker,
            binding,
            super::Target::ProjectRoot {
                project_id: "project-a".into(),
            },
            &Cancellation::default(),
            false,
            |_| {},
        )
        .err()
        .unwrap();
        assert_eq!(failure.code, "workspace-preparing");
        assert_eq!(failure.recovery, Recovery::Retry);
        assert_eq!(
            failure.diagnostic(),
            Some((
                Some("workbench_preparing".into()),
                Some("req-files-503".into())
            ))
        );
        let logged = crate::platform::diagnostics::recorded("[cloud-opening] request failed");
        let files_log = logged
            .iter()
            .find(|l| l["fields"]["request_id"] == "req-files-503")
            .expect("files stage log");
        assert_eq!(files_log["fields"]["stage"], "files");
        assert_eq!(files_log["fields"]["code"], "workbench_preparing");

        // 3. Stale `running` row whose `/files` answers `409 workbench_not_running`
        // reopens automatically once, accepts Postgres timestamp offsets in
        // `operation.deadline`, and reuses `entries` from `?wait_seconds=20`
        // without a redundant `/files` round-trip.
        let status_calls = Arc::new(AtomicUsize::new(0));
        let files_calls = Arc::new(AtomicUsize::new(0));
        let post_calls = Arc::new(AtomicUsize::new(0));
        let sc = status_calls.clone();
        let fc = files_calls.clone();
        let pc = post_calls.clone();
        let (broker, _rx) = responding_account_fixture(Arc::new(move |req| {
            if req.path.ends_with("/repository-context") {
                return Ok(context_ok());
            }
            if req.path.ends_with("/workbench") && req.method == reqwest::Method::GET {
                let wait = req
                    .query
                    .iter()
                    .any(|(k, v)| k == "wait_seconds" && v == "20");
                if wait {
                    return Ok(json!({
                        "workspace": {
                            "id": "ws-1",
                            "project_id": "project-a",
                            "generation": generation,
                            "state": "running",
                            "operation": {"pending": false, "deadline": null, "error": null, "retryable": false}
                        },
                        "entries": [
                            {"name": "README.md", "kind": "file", "size": 5}
                        ]
                    }));
                }
                let n = sc.fetch_add(1, Ordering::SeqCst);
                let state = if n == 0 { "running" } else { "paused" };
                return Ok(json!({
                    "workspace": {
                        "id": "ws-1",
                        "project_id": "project-a",
                        "generation": generation,
                        "state": state,
                        "operation": null
                    }
                }));
            }
            if req.path.ends_with("/workbench") && req.method == reqwest::Method::POST {
                pc.fetch_add(1, Ordering::SeqCst);
                return Ok(json!({
                    "id": "ws-1",
                    "project_id": "project-a",
                    "generation": generation,
                    "state": "resuming",
                    "operation": {
                        "pending": true,
                        "phase": "checking_files",
                        "deadline": "2099-01-01 00:00:00.123456+00",
                        "error": null,
                        "retryable": true
                    }
                }));
            }
            if req.path.ends_with("/workbench/files") {
                fc.fetch_add(1, Ordering::SeqCst);
                return Err(Error::Service(409, ServiceCode::NotRunning));
            }
            panic!("unexpected request {} {}", req.method, req.path);
        }));
        let binding = broker.signed_in_binding().unwrap();
        let prepared = super::prepare(
            broker,
            binding,
            super::Target::ProjectRoot {
                project_id: "project-a".into(),
            },
            &Cancellation::default(),
            false,
            |_| {},
        )
        .expect("reopened workspace");
        let (_ws, root) = prepared.into_parts().unwrap();
        assert_eq!(root.len(), 1);
        assert_eq!(root[0].name, "README.md");
        assert_eq!(post_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            files_calls.load(Ordering::SeqCst),
            1,
            "handoff entries from wait_seconds=20 should be reused without a second /files call"
        );
    }
}
