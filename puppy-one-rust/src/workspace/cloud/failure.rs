//! `cloudOpeningFailure.ts`: one classification for project and workspace
//! opening failures, shared by the project menu, Homepage and Header.
//!
//! Copy describes the observed boundary and never guesses a network root
//! cause. A server's explicit access decision (401/403/404) always wins over
//! a dependency hint; project authorization and runtime availability are
//! independent facts. Only allowlisted reason codes and numeric statuses
//! survive as diagnostics; server prose never becomes copy.
use crate::cloud_auth::Error as AuthError;

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
/// allowlisted diagnostics shown in collapsed Details.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Described {
    pub code: &'static str,
    pub action: Action,
    pub status: Option<u16>,
    pub reason: Option<&'static str>,
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
fn opening_reason(code: &str) -> Option<(&'static str, Action)> {
    Some(match code {
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
    })
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
    let reason_code = reason.and_then(allowlisted);
    let make = |code, action| Described {
        code,
        action,
        status,
        reason: reason_code,
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
    if let Some((code, action)) = reason.and_then(opening_reason) {
        return make(code, action);
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

/// The status, allowlisted reason and retryability a broker error carries.
pub fn from_auth(error: &AuthError) -> (Option<u16>, Option<&'static str>, Option<bool>) {
    match error {
        AuthError::InvalidCredentials | AuthError::Expired => (Some(401), None, None),
        AuthError::Http(status) | AuthError::Service(status, _) => (Some(*status), None, None),
        AuthError::Response(status, reason) => (Some(*status), *reason, None),
        AuthError::Unavailable => (None, Some("CLOUD_TRANSPORT_UNAVAILABLE"), None),
        AuthError::SessionChanged | AuthError::Cancelled => (None, None, Some(false)),
        AuthError::Configuration | AuthError::Unsupported | AuthError::NoProviders => {
            (None, None, Some(false))
        }
        _ => (None, None, None),
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
