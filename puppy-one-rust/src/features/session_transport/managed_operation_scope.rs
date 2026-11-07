//! `session-transport/ManagedOperationScope.ts`: operations owned by one
//! scope are released together, and a scoped wait ends with the scope.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::tasks::{CancelSignal, Canceller};
use crate::features::desktop_agent::application::ui_runtime::UiRuntime;
use std::cell::RefCell;
use std::future::Future;
use std::rc::Rc;

type Release = Rc<dyn Fn()>;

/// `new ManagedOperationScope()`.
#[derive(Clone, Default)]
pub struct ManagedOperationScope {
    controller: Canceller,
    operations: Rc<RefCell<Vec<(String, Release)>>>,
}

impl ManagedOperationScope {
    pub fn new() -> Self {
        Self::default()
    }

    /// `scope.signal`.
    pub fn signal(&self) -> CancelSignal {
        self.controller.signal()
    }

    /// `scope.size`.
    pub fn size(&self) -> usize {
        self.operations.borrow().len()
    }

    /// `scope.own(id, release)`: the returned closure disowns it.
    pub fn own(&self, id: &str, release: Rc<dyn Fn()>) -> Box<dyn Fn()> {
        if self.signal().is_cancelled() {
            release();
            return Box::new(|| {});
        }
        let previous = self
            .operations
            .borrow()
            .iter()
            .find(|(owned, _)| owned == id)
            .map(|(_, previous)| previous.clone());
        if let Some(previous) = previous {
            previous();
        }
        {
            let mut operations = self.operations.borrow_mut();
            match operations.iter_mut().find(|(owned, _)| owned == id) {
                Some(entry) => entry.1 = release.clone(),
                None => operations.push((id.to_string(), release.clone())),
            }
        }
        let operations = self.operations.clone();
        let id = id.to_string();
        Box::new(move || {
            operations.borrow_mut().retain(|(owned, owned_release)| {
                !(owned == &id && Rc::ptr_eq(owned_release, &release))
            });
        })
    }

    /// `scope.cancel()`.
    pub fn cancel(&self) {
        if self.signal().is_cancelled() {
            return;
        }
        self.controller
            .cancel(AgentError::new("The operation scope was cancelled."));
        let releases: Vec<Release> = self
            .operations
            .borrow_mut()
            .drain(..)
            .map(|(_, r)| r)
            .collect();
        for release in releases {
            release();
        }
    }
}

/// `ScopedOperationTimeoutError`.
pub fn scoped_operation_timeout_error(timeout_ms: u64) -> AgentError {
    let mut error = AgentError::new(format!("The operation timed out after {timeout_ms}ms."))
        .with_name("ScopedOperationTimeoutError");
    error.extra = Some(serde_json::json!({ "timeoutMs": timeout_ms }));
    error
}

/// Whether `error` is a `ScopedOperationTimeoutError` (and its timeout).
pub fn scoped_timeout_ms(error: &AgentError) -> Option<u64> {
    (error.name.as_deref() == Some("ScopedOperationTimeoutError"))
        .then(|| error.extra.as_ref().and_then(|e| e["timeoutMs"].as_u64()))
        .flatten()
}

/// `waitForScopedOperation(promise, signal, timeoutMs)`.
pub async fn wait_for_scoped_operation<T>(
    runtime: &Rc<dyn UiRuntime>,
    operation: impl Future<Output = AgentResult<T>>,
    signal: &CancelSignal,
    timeout_ms: u64,
) -> AgentResult<T> {
    let cancelled = || AgentError::new("The operation scope was cancelled.");
    if signal.is_cancelled() {
        return Err(cancelled());
    }
    let timer = runtime.sleep(timeout_ms);
    tokio::select! {
        biased;
        _ = signal.cancelled() => Err(cancelled()),
        result = operation => result,
        () = timer => Err(scoped_operation_timeout_error(timeout_ms)),
    }
}
