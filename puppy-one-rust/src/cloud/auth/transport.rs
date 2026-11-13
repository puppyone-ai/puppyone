//! Request-local cancellation and bounded streaming, without credential exposure.
use super::model::{Error, Result};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Clone)]
pub struct Cancellation(Arc<Cancelled>);
struct Cancelled {
    value: AtomicBool,
    changed: tokio::sync::watch::Sender<()>,
    parent: Option<Cancellation>,
}
impl Default for Cancellation {
    fn default() -> Self {
        Self(Arc::new(Cancelled {
            value: AtomicBool::new(false),
            changed: tokio::sync::watch::channel(()).0,
            parent: None,
        }))
    }
}
impl Cancellation {
    pub fn cancel(&self) {
        self.0.value.store(true, Ordering::Release);
        self.0.changed.send_replace(());
    }
    pub fn child(&self) -> Self {
        Self(Arc::new(Cancelled {
            value: AtomicBool::new(false),
            changed: tokio::sync::watch::channel(()).0,
            parent: Some(self.clone()),
        }))
    }
    pub fn check(&self) -> Result<()> {
        if self.0.value.load(Ordering::Acquire) {
            return Err(Error::Cancelled);
        }
        if let Some(parent) = &self.0.parent {
            parent.check()?;
        }
        Ok(())
    }
    pub(super) fn cancelled(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let mut changes = self.0.changed.subscribe();
            while self.check().is_ok() {
                tokio::select! {
                    _ = changes.changed() => {},
                    _ = async { if let Some(parent) = &self.0.parent { parent.cancelled().await; } else { std::future::pending::<()>().await; } } => {},
                }
            }
        })
    }
}
pub enum StreamEvent<'a> {
    Connected,
    Data(&'a [u8]),
}
pub type StreamSink<'a> = dyn FnMut(StreamEvent<'_>) -> Result<()> + Send + 'a;

/// Only reviewed public service codes survive the HTTP boundary. Never carry
/// an arbitrary server message (which may contain database/credential details).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServiceCode {
    FileConflict,
    FileNotFound,
    GenerationChanged,
    NotRunning,
    WorkbenchNotFound,
    OperationRejected,
}
/// A folder's byte tunnel (`openHostTunnelSocket`).
pub type HostTunnel =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
pub(super) fn response_error(status: u16, value: &serde_json::Value) -> Error {
    grant_error(status, value, true)
}
/// A refresh's refusal (`isRefreshCredentialInvalid`): only a 401 means the
/// credential is gone; a 400 leaves it in place, and the account offline.
pub(super) fn refresh_error(status: u16, value: &serde_json::Value) -> Error {
    grant_error(status, value, false)
}
fn grant_error(status: u16, value: &serde_json::Value, grants: bool) -> Error {
    let code = value
        .get("error_code")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    // A rejected sign-in grant (PKCE exchange) is a refused credential too.
    if status == 401
        || (grants
            && status == 400
            && matches!(
                code,
                "refresh_token_not_found"
                    | "refresh_token_already_used"
                    | "invalid_grant"
                    | "session_not_found"
            ))
    {
        return Error::InvalidCredentials;
    }
    // The status-level denial wins over any misleading allowlisted body code.
    if status == 403 {
        return Error::Http(403);
    }
    if status == 404 && billing_disabled(value) {
        return Error::Response(404, Some(BILLING_DISABLED), Default::default());
    }
    // Allowlisted reason codes survive for recovery copy (`cloudOpeningFailure`).
    let reason = [
        "/detail/code",
        "/data/code",
        "/error/code",
        "/code",
        "/error_code",
    ]
    .iter()
    .find_map(|pointer| value.pointer(pointer).and_then(serde_json::Value::as_str))
    .and_then(crate::workspace::cloud::failure::allowlisted);
    if status >= 500 || matches!(status, 408 | 429) || reason.is_some() {
        return Error::Response(status, reason, Default::default());
    }
    let code = value
        .pointer("/data/code")
        .or_else(|| value.pointer("/detail/code"))
        .and_then(serde_json::Value::as_str);
    let code = match code {
        Some("file_conflict") => ServiceCode::FileConflict,
        Some("file_not_found") => ServiceCode::FileNotFound,
        Some("workbench_generation_changed") => ServiceCode::GenerationChanged,
        Some("workbench_not_running") => ServiceCode::NotRunning,
        Some("workbench_not_found") => ServiceCode::WorkbenchNotFound,
        Some("file_operation_rejected") => ServiceCode::OperationRejected,
        _ => return Error::Http(status),
    };
    Error::Service(status, code)
}

/// `billingUnavailable` (`CloudPlans.tsx`): hosted subscriptions switched off
/// answer 404 with this code, or with one of two fixed messages (the BFF's
/// "Billing is not enabled", PuppyPay's "Hosting subscriptions are not
/// available"). It is a product state, not a fault; only the fixed reason
/// travels on, never the server's prose.
pub const BILLING_DISABLED: &str = "hosting_billing_disabled";
fn billing_disabled(value: &serde_json::Value) -> bool {
    let code = [
        "/detail/code",
        "/data/code",
        "/error/code",
        "/code",
        "/error_code",
    ]
    .iter()
    .any(|pointer| {
        value.pointer(pointer).and_then(serde_json::Value::as_str) == Some(BILLING_DISABLED)
    });
    let message = ["/message", "/detail", "/detail/message", "/error/message"]
        .iter()
        .filter_map(|pointer| value.pointer(pointer).and_then(serde_json::Value::as_str))
        .any(|m| {
            let m = m.to_ascii_lowercase();
            m.contains("hosting subscriptions are not available")
                || m.contains("billing is not enabled")
        });
    code || message
}

#[cfg(test)]
mod refusal_tests {
    use super::*;

    /// N-17: a rejected grant ends a sign-in, but a refresh's credential is
    /// gone only on a 401.
    #[test]
    fn only_a_401_invalidates_a_refresh() {
        let grant = serde_json::json!({"error_code": "invalid_grant"});
        assert_eq!(response_error(400, &grant), Error::InvalidCredentials);
        assert_eq!(refresh_error(400, &grant), Error::Http(400));
        assert_eq!(refresh_error(401, &grant), Error::InvalidCredentials);
    }
    /// PL-3: switched-off billing is told apart from any other 404, by its
    /// code or the two fixed messages, and nothing else of the body survives.
    #[test]
    fn switched_off_billing_is_a_fixed_reason() {
        let disabled = Error::Response(404, Some(BILLING_DISABLED), Default::default());
        for body in [
            serde_json::json!({"code": 1004, "message": "Billing is not enabled", "data": null}),
            serde_json::json!({"detail": "Hosting subscriptions are not available."}),
            serde_json::json!({"detail": {"code": "hosting_billing_disabled"}}),
        ] {
            assert_eq!(response_error(404, &body), disabled);
        }
        let other = serde_json::json!({"code": 1004, "message": "Organization not found"});
        assert_eq!(response_error(404, &other), Error::Http(404));
        let wrong_status = serde_json::json!({"message": "Billing is not enabled"});
        assert_ne!(response_error(500, &wrong_status), disabled);
    }
}
