//! `application/history/history-operation.mjs`.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::tasks::{CancelSignal, until_cancelled};
use std::future::Future;

/// `historyFailure(message, code, retryable)`.
pub fn history_failure(message: &str, code: Option<&str>, retryable: Option<bool>) -> AgentError {
    AgentError::coded(code.unwrap_or("HISTORY_QUERY_FAILED"), message)
        .with_retryable(retryable.unwrap_or(true))
}

/// `observeHistoryOperation(operation, signal)`: stop observing a query;
/// each caller still owns and releases its native resources.
pub async fn observe_history_operation<T>(
    operation: impl Future<Output = AgentResult<T>>,
    signal: &CancelSignal,
) -> AgentResult<T> {
    until_cancelled(signal, operation).await
}
