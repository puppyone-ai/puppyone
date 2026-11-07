//! `application/processes/agent-process-supervisor.mjs`: a small fair
//! semaphore for expensive native Agent process starts.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::tasks::CancelSignal;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::future::Future;
use std::rc::Rc;
use tokio::sync::oneshot;

const DEFAULT_MAX_CONCURRENT_STARTS: usize = 2;

struct Waiter {
    id: u64,
    ready: oneshot::Sender<()>,
}

#[derive(Default)]
struct State {
    limit: usize,
    in_use: usize,
    queue: VecDeque<Waiter>,
    next: u64,
}

#[derive(Clone)]
pub struct AgentProcessSupervisor(Rc<RefCell<State>>);

fn abort_error() -> AgentError {
    AgentError::new("Agent process start was aborted.").with_name("AbortError")
}

struct Permit(Rc<RefCell<State>>);

impl Drop for Permit {
    fn drop(&mut self) {
        let mut state = self.0.borrow_mut();
        state.in_use -= 1;
        drain(&mut state);
    }
}

fn drain(state: &mut State) {
    while state.in_use < state.limit {
        let Some(waiter) = state.queue.pop_front() else {
            break;
        };
        if waiter.ready.send(()).is_ok() {
            state.in_use += 1;
        }
    }
}

impl AgentProcessSupervisor {
    /// `createAgentProcessSupervisor({ maxConcurrentStarts })`.
    pub fn new(max_concurrent_starts: Option<usize>) -> Self {
        let limit = max_concurrent_starts
            .filter(|n| *n > 0)
            .map_or(DEFAULT_MAX_CONCURRENT_STARTS, |n| n.min(8));
        Self(Rc::new(RefCell::new(State {
            limit,
            ..Default::default()
        })))
    }

    /// `supervisor.runStart({ signal }, operation)`.
    pub async fn run_start<T, F: Future<Output = AgentResult<T>>>(
        &self,
        signal: Option<&CancelSignal>,
        operation: impl FnOnce() -> F,
    ) -> AgentResult<T> {
        if signal.is_some_and(CancelSignal::is_cancelled) {
            return Err(abort_error());
        }
        let (ready, admitted) = oneshot::channel();
        let id = {
            let mut state = self.0.borrow_mut();
            state.next += 1;
            let id = state.next;
            state.queue.push_back(Waiter { id, ready });
            drain(&mut state);
            id
        };
        let wait = async { admitted.await.map_err(|_| abort_error()) };
        let admission = match signal {
            Some(signal) => {
                tokio::select! {
                    result = wait => result,
                    _ = signal.cancelled() => {
                        let mut state = self.0.borrow_mut();
                        if state.queue.iter().any(|waiter| waiter.id == id) {
                            state.queue.retain(|waiter| waiter.id != id);
                        } else {
                            // Admitted as the signal fired: return the slot.
                            state.in_use -= 1;
                            drain(&mut state);
                        }
                        Err(abort_error())
                    }
                }
            }
            None => wait.await,
        };
        admission?;
        let _permit = Permit(self.0.clone());
        if signal.is_some_and(CancelSignal::is_cancelled) {
            return Err(abort_error());
        }
        operation().await
    }
}

impl Default for AgentProcessSupervisor {
    fn default() -> Self {
        Self::new(None)
    }
}
