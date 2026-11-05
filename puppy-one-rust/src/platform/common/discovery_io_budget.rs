//! `platform/common/discovery-io-budget.mjs`: installation file-system
//! checks run off the host thread (libuv's pool in the product) under one
//! shared budget. A timed-out request still occupies a slot until it really
//! ends.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::event_loop::AbortSignal;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

/// `discoveryIoPolicy`.
pub mod policy {
    pub const MAX_PENDING_TASKS: usize = 16;
    pub const TIMEOUT_MS: u64 = 1_500;
}

static PENDING_TASKS: AtomicUsize = AtomicUsize::new(0);

fn io_error(code: &str) -> AgentError {
    AgentError::coded(code, "Installation filesystem check is incomplete.")
}

/// `runDiscoveryIo(task, { signal, timeoutMs })`.
pub async fn run_discovery_io<T: Send + 'static>(
    task: impl FnOnce() -> AgentResult<T> + Send + 'static,
    signal: Option<&AbortSignal>,
    timeout_ms: Option<u64>,
) -> AgentResult<T> {
    if let Some(signal) = signal {
        signal.throw_if_aborted()?;
    }
    let admitted = PENDING_TASKS.fetch_update(Ordering::AcqRel, Ordering::Acquire, |pending| {
        (pending < policy::MAX_PENDING_TASKS).then_some(pending + 1)
    });
    if admitted.is_err() {
        return Err(io_error("filesystem-busy"));
    }
    let work = tokio::task::spawn_blocking(move || {
        let result = task();
        PENDING_TASKS.fetch_sub(1, Ordering::AcqRel);
        result
    });
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(policy::TIMEOUT_MS));
    let cancelled = async {
        match signal {
            Some(signal) => signal.aborted_reason().await,
            None => futures_util::future::pending().await,
        }
    };
    tokio::select! {
        result = work => result.unwrap_or_else(|error| Err(AgentError::new(error.to_string()))),
        _ = tokio::time::sleep(timeout) => Err(io_error("filesystem-timeout")),
        reason = cancelled => Err(reason),
    }
}

/// The slots currently held (`pendingTasks`).
pub fn pending_tasks() -> usize {
    PENDING_TASKS.load(Ordering::Acquire)
}
