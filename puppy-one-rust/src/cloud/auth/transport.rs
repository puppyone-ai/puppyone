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
    pub fn is_cancelled(&self) -> bool {
        self.check().is_err()
    }
    pub fn cancelled(
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
    /// A managed inference's reservation (`x-puppyone-reservation-id`), as
    /// sent: its receipt is read later.
    Reservation(&'a str),
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

/// Binary WebSocket channel for a Cloud Computer screen session (`VncScreenViewer`).
/// Bridged inside the transport runtime so callers never depend on a specific async reactor.
pub struct ScreenSocket {
    tx: async_channel::Sender<Vec<u8>>,
    rx: async_channel::Receiver<Vec<u8>>,
}
#[derive(Clone)]
pub struct ScreenSender(async_channel::Sender<Vec<u8>>);
pub struct ScreenReceiver(async_channel::Receiver<Vec<u8>>);

impl ScreenSocket {
    pub(super) fn from_channels(
        tx: async_channel::Sender<Vec<u8>>,
        rx: async_channel::Receiver<Vec<u8>>,
    ) -> Self {
        Self { tx, rx }
    }
    #[cfg(any(test, feature = "test-support", feature = "dev-capture"))]
    pub fn pair() -> (Self, Self) {
        let (a_tx, a_rx) = async_channel::bounded(128);
        let (b_tx, b_rx) = async_channel::bounded(128);
        (
            Self::from_channels(a_tx, b_rx),
            Self::from_channels(b_tx, a_rx),
        )
    }
    /// The same channel over a plain TCP stream: an on-device computer's
    /// VNC display on a loopback port. A reader and a writer thread carry
    /// the bytes; closing either side ends both.
    pub fn tcp(stream: std::net::TcpStream) -> std::io::Result<Self> {
        use std::io::{Read, Write};
        let (out_tx, out_rx) = async_channel::bounded::<Vec<u8>>(128);
        let (in_tx, in_rx) = async_channel::bounded::<Vec<u8>>(128);
        let mut reader = stream.try_clone()?;
        let mut writer = stream;
        std::thread::spawn(move || {
            let mut buf = vec![0; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if in_tx.send_blocking(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
            in_tx.close();
            let _ = reader.shutdown(std::net::Shutdown::Both);
        });
        std::thread::spawn(move || {
            while let Ok(bytes) = out_rx.recv_blocking() {
                if writer.write_all(&bytes).is_err() {
                    break;
                }
            }
            let _ = writer.shutdown(std::net::Shutdown::Both);
        });
        Ok(Self::from_channels(out_tx, in_rx))
    }
    pub async fn send(&self, bytes: Vec<u8>) -> Result<()> {
        self.tx.send(bytes).await.map_err(|_| Error::Unavailable)
    }
    pub async fn recv(&self) -> Option<Vec<u8>> {
        self.rx.recv().await.ok()
    }
    pub fn into_split(self) -> (ScreenSender, ScreenReceiver) {
        (ScreenSender(self.tx), ScreenReceiver(self.rx))
    }
}
impl ScreenSender {
    pub async fn send(&self, bytes: Vec<u8>) -> Result<()> {
        self.0.send(bytes).await.map_err(|_| Error::Unavailable)
    }
    pub fn close(&self) {
        self.0.close();
    }
}
impl ScreenReceiver {
    pub async fn recv(&self) -> Option<Vec<u8>> {
        self.0.recv().await.ok()
    }
    pub fn close(&self) {
        self.0.close();
    }
}
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
    let raw_code = [
        "/detail/code",
        "/data/code",
        "/error/code",
        "/code",
        "/error_code",
    ]
    .iter()
    .find_map(|pointer| value.pointer(pointer).and_then(serde_json::Value::as_str));
    let reason = raw_code.and_then(crate::workspace::cloud::failure::allowlisted);
    if status >= 500 || matches!(status, 408 | 429) || reason.is_some() {
        let reason = reason
            .or_else(|| raw_code.and_then(crate::workspace::cloud::failure::workbench_code))
            .or_else(|| raw_code.and_then(crate::workspace::cloud::failure::agent_code));
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
        _ => {
            if let Some(reason) =
                raw_code.and_then(crate::workspace::cloud::failure::workbench_code)
            {
                return Error::Response(status, Some(reason), Default::default());
            }
            if let Some(reason) = raw_code
                .and_then(crate::workspace::cloud::failure::agent_code)
                .or_else(|| {
                    (status == 409)
                        .then(|| legacy_agent_conflict(value))
                        .flatten()
                })
            {
                return Error::Response(status, Some(reason), Default::default());
            }
            return Error::Http(status);
        }
    };
    Error::Service(status, code)
}

/// Fixed legacy 409 strings from `POST /agents/runs` before structured
/// `{"code": "agent_*"}` responses rolled out everywhere. Only fixed
/// allowlisted reason codes survive; free-form server prose never does.
fn legacy_agent_conflict(value: &serde_json::Value) -> Option<&'static str> {
    ["/detail", "/message", "/detail/message", "/error/message"]
        .iter()
        .filter_map(|pointer| value.pointer(pointer).and_then(serde_json::Value::as_str))
        .find_map(
            |message| match message.trim().to_ascii_lowercase().as_str() {
                "configure an agent model before submitting" => Some("agent_model_unconfigured"),
                "agent is paused or unavailable" => Some("agent_unavailable"),
                "request identity was reused with different input" => {
                    Some("agent_request_conflict")
                }
                "native agent git requires an unrestricted project-root view" => {
                    Some("agent_scope_not_supported")
                }
                "agent has an invalid repository path" => Some("agent_repository_path_invalid"),
                "agent configuration changed during execution" => {
                    Some("agent_configuration_changed")
                }
                _ => None,
            },
        )
}

/// The managed inference service's reviewed refusal codes
/// (`ai_*`, `openAgentStream`).
const AI_CODES: [&str; 16] = [
    "ai_access_denied",
    "ai_authentication_required",
    "ai_balance_insufficient",
    "ai_context_limit",
    "ai_generation_invalid",
    "ai_generation_mismatch",
    "ai_model_unavailable",
    "ai_provider_unavailable",
    "ai_provider_unconfigured",
    "ai_rate_limited",
    "ai_request_already_started",
    "ai_request_invalid",
    "ai_request_too_large",
    "ai_route_unavailable",
    "ai_unavailable",
    "ai_usage_pending",
];
/// A refused managed inference: the service's reviewed `ai_*` code and its
/// request id (the `X-Request-Id` header, else the body's) survive, as the
/// product's proxy keeps them; its prose never does.
pub(super) fn completion_error(
    status: u16,
    value: &serde_json::Value,
    request_id: Option<&str>,
) -> Error {
    let code = value
        .pointer("/error/code")
        .and_then(serde_json::Value::as_str)
        .and_then(|code| AI_CODES.iter().find(|known| **known == code).copied());
    match code {
        Some(code) => {
            let request_id = request_id.or_else(|| {
                value
                    .pointer("/error/request_id")
                    .and_then(serde_json::Value::as_str)
            });
            Error::Response(
                status,
                Some(code),
                super::model::Diagnostic::read(value, request_id),
            )
        }
        None => response_error(status, value),
    }
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

    #[test]
    fn cloud_agent_refusals_keep_only_allowlisted_codes() {
        for (status, body, expected) in [
            (
                409,
                serde_json::json!({"detail": {"code": "agent_session_busy"}}),
                "agent_session_busy",
            ),
            (
                409,
                serde_json::json!({"detail": {"code": "project_agent_not_ready"}}),
                "project_agent_not_ready",
            ),
            (
                409,
                serde_json::json!({"detail": {"code": "interactive_workspace_required"}}),
                "interactive_workspace_required",
            ),
            (
                409,
                serde_json::json!({"detail": "Configure an Agent model before submitting"}),
                "agent_model_unconfigured",
            ),
            (
                409,
                serde_json::json!({"detail": "Agent is paused or unavailable"}),
                "agent_unavailable",
            ),
            (
                409,
                serde_json::json!({"detail": "Request identity was reused with different input"}),
                "agent_request_conflict",
            ),
        ] {
            assert_eq!(
                response_error(status, &body),
                Error::Response(status, Some(expected), Default::default())
            );
        }
        assert_eq!(
            response_error(
                503,
                &serde_json::json!({"detail": {"code": "managed_agent_inference_disabled"}})
            ),
            Error::Response(
                503,
                Some("managed_agent_inference_disabled"),
                Default::default()
            )
        );
        // Arbitrary unreviewed prose never survives into Error::Response.
        let unreviewed = serde_json::json!({"detail": "Arbitrary database text"});
        assert_eq!(response_error(409, &unreviewed), Error::Http(409));
    }
}
