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
pub(super) fn response_error(status: u16, value: &serde_json::Value) -> Error {
    let code = value
        .get("error_code")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if status == 401
        || (status == 400
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
    if status >= 500 || matches!(status, 408 | 429) {
        return Error::Unavailable;
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
