//! The Node event-loop facilities the product's Main process is written
//! against, on the Agent host's single-threaded runtime: `setTimeout`,
//! `queueMicrotask`, `AbortController` and promises shared by several
//! awaiters.
use crate::agent::agent_error::AgentError;
use futures_util::FutureExt;
use futures_util::future::{LocalBoxFuture, Shared};
use std::cell::RefCell;
use std::future::Future;
use std::rc::Rc;
use std::time::Duration;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

/// `queueMicrotask(task)` / an unawaited `void promise`: runs on the host's
/// local task set.
pub fn spawn<F: Future<Output = ()> + 'static>(task: F) -> JoinHandle<()> {
    tokio::task::spawn_local(task)
}

/// A `setTimeout` handle; `clearTimeout` is [`Timer::clear`], and dropping
/// the handle leaves the timer running (as an unreferenced Node timer).
pub struct Timer(JoinHandle<()>);

impl Timer {
    /// `clearTimeout(timer)`.
    pub fn clear(self) {
        self.0.abort();
    }
}

/// `setTimeout(callback, ms)`.
pub fn set_timeout(ms: u64, callback: impl FnOnce() + 'static) -> Timer {
    Timer(spawn(async move {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        callback();
    }))
}

/// `new AbortController()`.
#[derive(Clone, Default)]
pub struct AbortController {
    signal: AbortSignal,
}

impl AbortController {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn signal(&self) -> AbortSignal {
        self.signal.clone()
    }
    /// `controller.abort(reason)`: the first reason wins.
    pub fn abort(&self, reason: AgentError) {
        let inner = &self.signal.0;
        if inner.reason.borrow().is_some() {
            return;
        }
        *inner.reason.borrow_mut() = Some(reason);
        inner.notify.notify_waiters();
        let listeners: Vec<Rc<dyn Fn()>> = inner
            .listeners
            .borrow_mut()
            .drain(..)
            .map(|(_, l)| l)
            .collect();
        for listener in listeners {
            listener();
        }
    }
}

type Listeners = RefCell<Vec<(u64, Rc<dyn Fn()>)>>;

#[derive(Default)]
struct SignalState {
    reason: RefCell<Option<AgentError>>,
    notify: Notify,
    listeners: Listeners,
    next: std::cell::Cell<u64>,
}

/// `AbortSignal`.
#[derive(Clone, Default)]
pub struct AbortSignal(Rc<SignalState>);

impl AbortSignal {
    pub fn aborted(&self) -> bool {
        self.0.reason.borrow().is_some()
    }
    /// `signal.reason`.
    pub fn reason(&self) -> Option<AgentError> {
        self.0.reason.borrow().clone()
    }
    /// `signal.throwIfAborted()`.
    pub fn throw_if_aborted(&self) -> Result<(), AgentError> {
        match self.reason() {
            Some(reason) => Err(reason),
            None => Ok(()),
        }
    }
    /// Resolves with the reason once the signal aborts.
    pub async fn aborted_reason(&self) -> AgentError {
        loop {
            let notified = self.0.notify.notified();
            if let Some(reason) = self.reason() {
                return reason;
            }
            notified.await;
        }
    }
    /// `signal.addEventListener("abort", listener, { once: true })`: the id
    /// [`Self::remove_listener`] takes.
    pub fn add_listener(&self, listener: impl Fn() + 'static) -> u64 {
        let id = self.0.next.get() + 1;
        self.0.next.set(id);
        self.0.listeners.borrow_mut().push((id, Rc::new(listener)));
        id
    }
    pub fn remove_listener(&self, id: u64) {
        self.0
            .listeners
            .borrow_mut()
            .retain(|(listener, _)| *listener != id);
    }
}

/// `Promise.race([operation, abort])`: the operation, unless the signal
/// aborts first (its reason is the error).
pub async fn race_abort<T>(
    signal: &AbortSignal,
    operation: impl Future<Output = Result<T, AgentError>>,
) -> Result<T, AgentError> {
    if let Some(reason) = signal.reason() {
        return Err(reason);
    }
    tokio::select! {
        biased;
        reason = signal.aborted_reason() => Err(reason),
        result = operation => result,
    }
}

/// A promise several callers await (`session.closePromise`).
pub type SharedTask<T> = Shared<LocalBoxFuture<'static, T>>;

/// `promise` held so several callers can await one settlement.
pub fn shared<T: Clone + 'static>(future: impl Future<Output = T> + 'static) -> SharedTask<T> {
    future.boxed_local().shared()
}
