//! Work on the Agent host's single-threaded runtime: callbacks after a
//! delay, results several callers await, and cancellation that carries its
//! reason (a tokio [`CancellationToken`] plus the error the cancelled work
//! fails with). Local tasks themselves are `tokio::task::spawn_local`.
use crate::agent::agent_error::{AgentError, AgentResult};
use futures_util::FutureExt;
use futures_util::future::{LocalBoxFuture, Shared};
use std::cell::{Cell, RefCell};
use std::future::Future;
use std::rc::Rc;
use std::time::Duration;
use tokio::task::{JoinHandle, spawn_local};
use tokio_util::sync::CancellationToken;

/// Runs `callback` after `delay` on the host's local task set. Aborting the
/// handle cancels the callback; dropping it does not.
pub fn spawn_after(delay: Duration, callback: impl FnOnce() + 'static) -> JoinHandle<()> {
    spawn_local(async move {
        tokio::time::sleep(delay).await;
        callback();
    })
}

/// Cancels the work that holds its [`CancelSignal`]; the first reason wins.
#[derive(Clone, Default)]
pub struct Canceller {
    signal: CancelSignal,
}

impl Canceller {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn signal(&self) -> CancelSignal {
        self.signal.clone()
    }

    /// Cancels with `reason`, then runs the registered callbacks in order.
    pub fn cancel(&self, reason: AgentError) {
        let state = &self.signal.0;
        if state.token.is_cancelled() {
            return;
        }
        *state.reason.borrow_mut() = Some(reason);
        state.token.cancel();
        let callbacks: Vec<Rc<dyn Fn()>> = state
            .callbacks
            .borrow_mut()
            .drain(..)
            .map(|(_, callback)| callback)
            .collect();
        for callback in callbacks {
            callback();
        }
    }
}

type Callbacks = RefCell<Vec<(u64, Rc<dyn Fn()>)>>;

#[derive(Default)]
struct SignalState {
    token: CancellationToken,
    reason: RefCell<Option<AgentError>>,
    callbacks: Callbacks,
    next: Cell<u64>,
}

/// The observing side of a [`Canceller`].
#[derive(Clone, Default)]
pub struct CancelSignal(Rc<SignalState>);

impl CancelSignal {
    pub fn is_cancelled(&self) -> bool {
        self.0.token.is_cancelled()
    }

    /// Why the work was cancelled.
    pub fn reason(&self) -> Option<AgentError> {
        self.0.reason.borrow().clone()
    }

    /// The cancellation reason as an error, once cancelled.
    pub fn check(&self) -> AgentResult<()> {
        match self.reason() {
            Some(reason) => Err(reason),
            None => Ok(()),
        }
    }

    /// Resolves with the reason once cancelled.
    pub async fn cancelled(&self) -> AgentError {
        self.0.token.cancelled().await;
        self.reason()
            .unwrap_or_else(|| AgentError::new("The operation was cancelled."))
    }

    /// Runs `callback` once, synchronously, when the work is cancelled; the
    /// id [`Self::forget`] takes.
    pub fn on_cancel(&self, callback: impl Fn() + 'static) -> u64 {
        let id = self.0.next.get() + 1;
        self.0.next.set(id);
        self.0.callbacks.borrow_mut().push((id, Rc::new(callback)));
        id
    }

    /// Drops the callback [`Self::on_cancel`] registered as `id`.
    pub fn forget(&self, id: u64) {
        self.0
            .callbacks
            .borrow_mut()
            .retain(|(entry, _)| *entry != id);
    }

    /// Whether both observe the same [`Canceller`].
    pub fn same(&self, other: &CancelSignal) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

/// `operation`, unless `signal` is cancelled first (its reason is the
/// error).
pub async fn until_cancelled<T>(
    signal: &CancelSignal,
    operation: impl Future<Output = AgentResult<T>>,
) -> AgentResult<T> {
    signal.check()?;
    tokio::select! {
        biased;
        reason = signal.cancelled() => Err(reason),
        result = operation => result,
    }
}

/// A result several callers await (`session.closePromise`).
pub type SharedTask<T> = Shared<LocalBoxFuture<'static, T>>;

/// `future`, held so several callers can await one settlement.
pub fn shared<T: Clone + 'static>(future: impl Future<Output = T> + 'static) -> SharedTask<T> {
    future.boxed_local().shared()
}
