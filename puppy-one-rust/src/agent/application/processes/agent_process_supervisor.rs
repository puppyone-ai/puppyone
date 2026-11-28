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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::application::tests_support::run_local;
    use crate::agent::tasks::Canceller;
    use core::prelude::v1::test;
    use std::cell::Cell;
    use std::time::{Duration, Instant};

    async fn wait_until(ready: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !ready() {
            assert!(
                Instant::now() < deadline,
                "process admission did not settle"
            );
            tokio::task::yield_now().await;
        }
    }

    #[test]
    fn native_start_capacity_is_bounded_and_waiters_are_admitted_in_order() {
        run_local(async {
            let supervisor = AgentProcessSupervisor::new(Some(2));
            let active = Rc::new(Cell::new(0));
            let peak = Rc::new(Cell::new(0));
            let entered = Rc::new(RefCell::new(Vec::new()));
            let releases = Rc::new(RefCell::new(VecDeque::new()));
            let mut tasks = Vec::new();
            for label in ["one", "two", "three"] {
                let (supervisor, active, peak, entered, releases) = (
                    supervisor.clone(),
                    active.clone(),
                    peak.clone(),
                    entered.clone(),
                    releases.clone(),
                );
                tasks.push(tokio::task::spawn_local(async move {
                    supervisor
                        .run_start(None, || async move {
                            active.set(active.get() + 1);
                            peak.set(peak.get().max(active.get()));
                            entered.borrow_mut().push(label);
                            let (reply, pending) = oneshot::channel();
                            releases.borrow_mut().push_back(reply);
                            pending.await.unwrap();
                            active.set(active.get() - 1);
                            Ok(label)
                        })
                        .await
                }));
            }
            wait_until(|| supervisor.0.borrow().queue.len() == 1).await;
            {
                let state = supervisor.0.borrow();
                assert_eq!((state.in_use, state.queue.len(), state.limit), (2, 1, 2));
            }
            assert_eq!(peak.get(), 2);
            assert_eq!(*entered.borrow(), ["one", "two"]);
            releases.borrow_mut().pop_front().unwrap().send(()).unwrap();
            wait_until(|| entered.borrow().len() == 3).await;
            {
                let state = supervisor.0.borrow();
                assert_eq!((state.in_use, state.queue.len()), (2, 0));
            }
            assert_eq!(peak.get(), 2);
            assert_eq!(*entered.borrow(), ["one", "two", "three"]);
            for release in releases.borrow_mut().drain(..) {
                release.send(()).unwrap();
            }
            let mut results = Vec::new();
            for task in tasks {
                results.push(task.await.unwrap().unwrap());
            }
            assert_eq!(results, ["one", "two", "three"]);
            let state = supervisor.0.borrow();
            assert_eq!((state.in_use, state.queue.len()), (0, 0));
        });
    }

    #[test]
    fn cancelling_a_queued_start_removes_it_without_consuming_a_slot() {
        run_local(async {
            let supervisor = AgentProcessSupervisor::new(Some(1));
            let (release, pending) = oneshot::channel();
            let running = {
                let supervisor = supervisor.clone();
                tokio::task::spawn_local(async move {
                    supervisor
                        .run_start(None, || async move {
                            pending.await.unwrap();
                            Ok("done")
                        })
                        .await
                })
            };
            wait_until(|| supervisor.0.borrow().in_use == 1).await;
            let controller = Canceller::new();
            let signal = controller.signal();
            let queued = {
                let supervisor = supervisor.clone();
                tokio::task::spawn_local(async move {
                    supervisor
                        .run_start(Some(&signal), || async {
                            panic!("cancelled queued start was dispatched");
                            #[allow(unreachable_code)]
                            Ok(())
                        })
                        .await
                })
            };
            wait_until(|| supervisor.0.borrow().queue.len() == 1).await;
            controller.cancel(AgentError::new("cancelled"));
            assert_eq!(
                queued.await.unwrap().unwrap_err().name.as_deref(),
                Some("AbortError")
            );
            {
                let state = supervisor.0.borrow();
                assert_eq!((state.in_use, state.queue.len()), (1, 0));
            }
            release.send(()).unwrap();
            assert_eq!(running.await.unwrap().unwrap(), "done");
            assert_eq!(
                supervisor
                    .run_start(None, || async { Ok("next") })
                    .await
                    .unwrap(),
                "next"
            );
            let state = supervisor.0.borrow();
            assert_eq!((state.in_use, state.queue.len()), (0, 0));
        });
    }
}
