//! `cloudOpeningFailure.ts`: one classification for project and workspace
//! opening failures, shared by the project menu, Homepage and Header.
//!
//! Copy describes the observed boundary and never guesses a network root
//! cause. A server's explicit access decision (401/403/404) always wins over
//! a dependency hint; project authorization and runtime availability are
//! independent facts. Only allowlisted reason codes and numeric statuses
//! survive as diagnostics; server prose never becomes copy.
use crate::cloud::auth::{Error as AuthError, ServiceCode, model::RequestId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    /// Repository-context / project authorization.
    Project,
    /// Workbench opening and file readiness after authorization.
    Workspace,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Retry,
    Account,
    None,
}
/// A product message (`cloud.message.{code}`) with its action and the
/// allowlisted diagnostics shown beside it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Described {
    pub code: &'static str,
    pub action: Action,
    pub status: Option<u16>,
    pub reason: Option<&'static str>,
    /// The workspace moved while it was opening (replaced, paused, fenced,
    /// or its authorization revision changed): opening it again is the
    /// remedy, so the window does that once by itself before saying anything.
    pub reopen: bool,
}
/// What a broker error says about a failed request: status, allowlisted
/// reason, the server's retry decision and its request id.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Cause {
    pub status: Option<u16>,
    pub reason: Option<&'static str>,
    pub retryable: Option<bool>,
    pub request_id: Option<RequestId>,
}

/// Reason codes the client may show (`connectionReasons` + `openingReasons`).
pub const REASONS: &[&str] = &[
    "CLOUD_TRANSPORT_UNAVAILABLE",
    "CLOUD_REQUEST_TIMEOUT",
    "project_authorization_unreachable",
    "project_authorization_timeout",
    "project_authorization_unavailable",
    "database_schema_outdated",
    "workbench_connection_unavailable",
    "workbench_plan_required",
    "repository_target_mismatch",
    "workbench_provider_not_configured",
    "workbench_provider_authentication",
    "workbench_protocol_mismatch",
    "workbench_access_denied",
    "workbench_requires_recovery",
    "workbench_preparing",
    "workbench_start_timeout",
    "workbench_connection_timeout",
    "workbench_disk_lost",
    "workbench_unavailable",
    "workbench_not_ready",
    "workbench_operation_replaced",
    "workbench_context_changed",
    // First publication (`mapCloudMutationError`, cleanup refusal).
    "initialization_not_abandonable",
    "organization_required",
    "schema_migration_required",
    "service_upgrade_required",
];
/// The allowlisted spelling of `code`, if any.
pub fn allowlisted(code: &str) -> Option<&'static str> {
    REASONS.iter().copied().find(|r| *r == code)
}
/// The codes a diagnostic may name: the allowlist and the workspace's own
/// refusals.
fn diagnostic_code(code: &str) -> Option<&'static str> {
    allowlisted(code).or_else(|| {
        [ServiceCode::GenerationChanged, ServiceCode::NotRunning]
            .into_iter()
            .filter_map(service_reason)
            .find(|r| *r == code)
    })
}
/// The workspace's own refusals the file provider tells apart
/// (`ServiceCode`), as the opening reads them.
fn service_reason(code: ServiceCode) -> Option<&'static str> {
    match code {
        ServiceCode::GenerationChanged => Some("workbench_generation_changed"),
        ServiceCode::NotRunning => Some("workbench_not_running"),
        _ => None,
    }
}

fn connection_reason(code: &str) -> Option<&'static str> {
    Some(match code {
        "CLOUD_TRANSPORT_UNAVAILABLE" => "connection-unreachable",
        "CLOUD_REQUEST_TIMEOUT" => "connection-timeout",
        "project_authorization_unreachable" => "access-check-unreachable",
        "project_authorization_timeout" => "access-check-timeout",
        "project_authorization_unavailable" => "access-check-unavailable",
        "database_schema_outdated" => "service-updating",
        "workbench_connection_unavailable" => "workspace-connection-unavailable",
        _ => return None,
    })
}
fn status_reason(status: u16) -> Option<&'static str> {
    Some(match status {
        408 | 504 => "connection-timeout",
        426 => "app-update-required",
        429 => "service-busy",
        _ => return None,
    })
}
/// `openingReasons`, by the user's next step: wait and retry, open it again
/// (reopened once by itself), a new one, recovery, or the account.
fn opening_reason(code: &str) -> Option<(&'static str, Action, bool)> {
    let (code, action) = match code {
        "workbench_generation_changed"
        | "workbench_not_running"
        | "workbench_not_ready"
        | "workbench_operation_replaced"
        | "workbench_context_changed" => return Some(("workspace-changed", Action::Retry, true)),
        "workbench_start_timeout" | "workbench_connection_timeout" => {
            ("workspace-start-timeout", Action::Retry)
        }
        "workbench_disk_lost" => ("workspace-disk-lost", Action::Retry),
        "workbench_unavailable" => ("project-unavailable", Action::None),
        "workbench_plan_required" => ("workspace-plan-required", Action::Account),
        "repository_target_mismatch" => ("project-response-mismatch", Action::None),
        "workbench_provider_not_configured" | "workbench_provider_authentication" => {
            ("workspace-not-configured", Action::None)
        }
        "workbench_protocol_mismatch" => ("workspace-service-unavailable", Action::None),
        "workbench_access_denied" => ("workspace-access-denied", Action::None),
        "workbench_requires_recovery" => ("workspace-recovery-required", Action::None),
        "workbench_preparing" => ("workspace-preparing", Action::Retry),
        _ => return None,
    };
    Some((code, action, false))
}
fn valid_status(status: Option<u16>) -> Option<u16> {
    status.filter(|s| (400..=599).contains(s))
}

/// `describeCloudConnectionFailure`.
pub fn connection(status: Option<u16>, reason: Option<&str>) -> Option<&'static str> {
    let status = valid_status(status);
    if matches!(status, Some(401 | 403 | 404)) {
        return None;
    }
    reason
        .and_then(connection_reason)
        .or_else(|| status.and_then(status_reason))
        .or_else(|| status.filter(|s| *s >= 500).map(|_| "service-unavailable"))
}
/// `cloudFailureTitle`.
pub fn title(code: &str) -> Option<&'static str> {
    Some(match code {
        "connection-unreachable" => "cloud.recovery.connectionTitle",
        "connection-timeout" => "cloud.recovery.timeoutTitle",
        c if c.starts_with("access-check-") => "cloud.recovery.accessCheckTitle",
        "service-updating" => "cloud.recovery.updatingTitle",
        "app-update-required" => "cloud.recovery.updateAppTitle",
        _ => return None,
    })
}

/// `describeCloudOpeningFailure(cause, stage)`.
pub fn describe(
    status: Option<u16>,
    reason: Option<&str>,
    retryable: Option<bool>,
    stage: Stage,
) -> Described {
    let status = valid_status(status);
    let reason_code = reason.and_then(diagnostic_code);
    let make = |code, action| Described {
        code,
        action,
        status,
        reason: reason_code,
        reopen: false,
    };
    match status {
        Some(401) => return make("project-sign-in-required", Action::Account),
        Some(403) => {
            return make(
                if stage == Stage::Workspace {
                    "workspace-access-denied"
                } else {
                    "project-access-denied"
                },
                Action::None,
            );
        }
        Some(402) => return make("workspace-plan-required", Action::Account),
        _ => {}
    }
    if let Some((code, action, reopen)) = reason.and_then(opening_reason) {
        return Described {
            reopen,
            ..make(code, action)
        };
    }
    if stage == Stage::Workspace && matches!(status, Some(404 | 405 | 501)) {
        return make("workspace-service-unavailable", Action::None);
    }
    if status == Some(404) {
        return make("project-unavailable", Action::None);
    }
    if let Some(code) = connection(status, reason)
        && (stage == Stage::Project || code != "service-unavailable")
    {
        let action = if status == Some(426) || retryable == Some(false) {
            Action::None
        } else {
            Action::Retry
        };
        return make(code, action);
    }
    make(
        if stage == Stage::Workspace {
            "workspace-open-failed"
        } else {
            "project-open-failed"
        },
        if retryable == Some(false) {
            Action::None
        } else {
            Action::Retry
        },
    )
}

/// What a broker error carries for the classification.
pub fn from_auth(error: &AuthError) -> Cause {
    let cause = |status, reason, retryable| Cause {
        status,
        reason,
        retryable,
        request_id: None,
    };
    match error {
        AuthError::InvalidCredentials | AuthError::Expired => cause(Some(401), None, None),
        AuthError::Http(status) => cause(Some(*status), None, None),
        AuthError::Service(status, code) => cause(Some(*status), service_reason(*code), None),
        AuthError::Response(status, reason, diagnostic) => Cause {
            request_id: diagnostic.request_id,
            ..cause(Some(*status), *reason, diagnostic.retryable)
        },
        AuthError::Unavailable => cause(None, Some("CLOUD_TRANSPORT_UNAVAILABLE"), None),
        AuthError::SessionChanged | AuthError::Cancelled => cause(None, None, Some(false)),
        AuthError::Configuration | AuthError::Unsupported | AuthError::NoProviders => {
            cause(None, None, Some(false))
        }
        _ => Cause::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(status: Option<u16>, reason: Option<&str>, stage: Stage) -> (&'static str, Action) {
        let x = describe(status, reason, None, stage);
        (x.code, x.action)
    }

    #[test]
    fn access_decisions_win_and_stages_stay_independent() {
        assert_eq!(
            d(Some(401), None, Stage::Project),
            ("project-sign-in-required", Action::Account)
        );
        assert_eq!(
            d(Some(403), None, Stage::Project),
            ("project-access-denied", Action::None)
        );
        assert_eq!(
            d(Some(403), None, Stage::Workspace),
            ("workspace-access-denied", Action::None)
        );
        assert_eq!(
            d(Some(402), None, Stage::Workspace),
            ("workspace-plan-required", Action::Account)
        );
        // An explicit 403 beats a misleading dependency hint.
        assert_eq!(
            d(
                Some(403),
                Some("project_authorization_unreachable"),
                Stage::Project
            ),
            ("project-access-denied", Action::None)
        );
        assert_eq!(
            d(Some(404), None, Stage::Project),
            ("project-unavailable", Action::None)
        );
        for status in [404, 405, 501] {
            assert_eq!(
                d(Some(status), None, Stage::Workspace),
                ("workspace-service-unavailable", Action::None)
            );
        }
    }

    #[test]
    fn opening_reasons_map_to_their_product_messages() {
        for (reason, code, action) in [
            (
                "workbench_plan_required",
                "workspace-plan-required",
                Action::Account,
            ),
            (
                "repository_target_mismatch",
                "project-response-mismatch",
                Action::None,
            ),
            (
                "workbench_provider_not_configured",
                "workspace-not-configured",
                Action::None,
            ),
            (
                "workbench_provider_authentication",
                "workspace-not-configured",
                Action::None,
            ),
            (
                "workbench_protocol_mismatch",
                "workspace-service-unavailable",
                Action::None,
            ),
            (
                "workbench_access_denied",
                "workspace-access-denied",
                Action::None,
            ),
            (
                "workbench_requires_recovery",
                "workspace-recovery-required",
                Action::None,
            ),
            ("workbench_preparing", "workspace-preparing", Action::Retry),
        ] {
            assert_eq!(
                d(Some(409), Some(reason), Stage::Workspace),
                (code, action),
                "{reason}"
            );
        }
    }

    /// `cloudOpeningFailureClassification`: by the next step, and a moved
    /// workspace is opened again.
    #[test]
    fn workspace_failures_say_what_to_do_next() {
        for (reason, code, action, reopen) in [
            (
                "workbench_start_timeout",
                "workspace-start-timeout",
                Action::Retry,
                false,
            ),
            (
                "workbench_connection_timeout",
                "workspace-start-timeout",
                Action::Retry,
                false,
            ),
            (
                "workbench_disk_lost",
                "workspace-disk-lost",
                Action::Retry,
                false,
            ),
            (
                "workbench_unavailable",
                "project-unavailable",
                Action::None,
                false,
            ),
            (
                "workbench_generation_changed",
                "workspace-changed",
                Action::Retry,
                true,
            ),
            (
                "workbench_not_running",
                "workspace-changed",
                Action::Retry,
                true,
            ),
            (
                "workbench_not_ready",
                "workspace-changed",
                Action::Retry,
                true,
            ),
            (
                "workbench_operation_replaced",
                "workspace-changed",
                Action::Retry,
                true,
            ),
            (
                "workbench_context_changed",
                "workspace-changed",
                Action::Retry,
                true,
            ),
        ] {
            let x = describe(Some(409), Some(reason), None, Stage::Workspace);
            assert_eq!(
                (x.code, x.action, x.reopen),
                (code, action, reopen),
                "{reason}"
            );
            assert_eq!(x.reason, Some(reason), "{reason}");
        }
        // The provider's own refusals carry their codes.
        let cause = from_auth(&AuthError::Service(409, ServiceCode::GenerationChanged));
        assert_eq!(cause.reason, Some("workbench_generation_changed"));
        let diagnostic = crate::cloud::auth::model::Diagnostic::read(
            &serde_json::json!({"data": {"code": "workbench_disk_lost", "retryable": false}}),
            Some("req-1:a.b"),
        );
        let cause = from_auth(&AuthError::Response(
            503,
            Some("workbench_disk_lost"),
            diagnostic,
        ));
        assert_eq!(cause.retryable, Some(false));
        assert_eq!(
            cause.request_id.map(|r| r.as_str().to_owned()).as_deref(),
            Some("req-1:a.b")
        );
        // A request id is a plain token or nothing.
        assert!(RequestId::parse("bad id").is_none());
        assert!(RequestId::parse(&"x".repeat(129)).is_none());
        assert!(RequestId::parse(&"x".repeat(128)).is_some());
    }

    #[test]
    fn connection_failures_describe_the_boundary_not_a_cause() {
        assert_eq!(
            d(None, Some("CLOUD_TRANSPORT_UNAVAILABLE"), Stage::Project),
            ("connection-unreachable", Action::Retry)
        );
        assert_eq!(
            d(Some(504), None, Stage::Project),
            ("connection-timeout", Action::Retry)
        );
        assert_eq!(
            d(Some(408), None, Stage::Project),
            ("connection-timeout", Action::Retry)
        );
        assert_eq!(
            d(Some(429), None, Stage::Project),
            ("service-busy", Action::Retry)
        );
        assert_eq!(
            d(Some(426), None, Stage::Project),
            ("app-update-required", Action::None)
        );
        assert_eq!(
            d(Some(503), Some("database_schema_outdated"), Stage::Project),
            ("service-updating", Action::Retry)
        );
        assert_eq!(
            d(
                Some(503),
                Some("project_authorization_timeout"),
                Stage::Project
            ),
            ("access-check-timeout", Action::Retry)
        );
        assert_eq!(
            d(Some(500), None, Stage::Project),
            ("service-unavailable", Action::Retry)
        );
        // A bare 5xx after authorization is an opening failure, not a guess.
        assert_eq!(
            d(Some(500), None, Stage::Workspace),
            ("workspace-open-failed", Action::Retry)
        );
        assert_eq!(
            describe(None, None, Some(false), Stage::Project).action,
            Action::None
        );
        assert_eq!(
            title("access-check-timeout"),
            Some("cloud.recovery.accessCheckTitle")
        );
        assert_eq!(title("workspace-open-failed"), None);
        // Unknown server codes never become diagnostics.
        assert_eq!(
            describe(Some(500), Some("ECONNRESET at db"), None, Stage::Project).reason,
            None
        );
    }
}
