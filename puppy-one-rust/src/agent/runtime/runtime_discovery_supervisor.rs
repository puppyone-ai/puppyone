//! `runtime/runtime-discovery-supervisor.mjs`: host-owned deadline and one
//! outstanding native probe per runtime.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::tasks::{CancelSignal, Canceller, SharedTask, shared};
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;
use tokio::task::spawn_local;

pub const DEFAULT_RUNTIME_DISCOVERY_TIMEOUT_MS: u64 = 15_000;

struct Flight {
    controller: Canceller,
    result: SharedTask<AgentResult<Value>>,
}

#[derive(Clone)]
pub struct RuntimeDiscoverySupervisor(Rc<State>);

struct State {
    timeout_ms: u64,
    flights: RefCell<HashMap<String, Rc<Flight>>>,
    disposed: Cell<bool>,
}

impl RuntimeDiscoverySupervisor {
    pub fn new(timeout_ms: Option<u64>) -> Self {
        Self(Rc::new(State {
            timeout_ms: timeout_ms
                .filter(|t| *t > 0)
                .unwrap_or(DEFAULT_RUNTIME_DISCOVERY_TIMEOUT_MS),
            flights: RefCell::default(),
            disposed: Cell::new(false),
        }))
    }

    /// `supervisor.run(runtimeId, discover)`.
    pub fn run(
        &self,
        runtime_id: &str,
        discover: impl FnOnce(CancelSignal) -> LocalBoxFuture<'static, AgentResult<Value>>,
    ) -> SharedTask<AgentResult<Value>> {
        if self.0.disposed.get() {
            return shared(async { Err(AgentError::new("Agent runtime discovery has closed.")) });
        }
        if let Some(existing) = self.0.flights.borrow().get(runtime_id) {
            return existing.result.clone();
        }
        let controller = Canceller::new();
        let signal = controller.signal();
        // A deadline ends observation, not necessarily native work. Retain the
        // flight until native settlement, so Refresh cannot multiply a stuck probe.
        let native = shared(discover(signal.clone()));
        let timeout_ms = self.0.timeout_ms;
        let id = runtime_id.to_string();
        let observed = {
            let native = native.clone();
            let signal = signal.clone();
            let timer_controller = controller.clone();
            let id = id.clone();
            shared(async move {
                let deadline = async {
                    tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
                    timer_controller.cancel(AgentError::new(format!(
                        "Agent runtime {id} discovery timed out after {timeout_ms} ms."
                    )));
                };
                tokio::select! {
                    result = native => result,
                    reason = signal.cancelled() => Err(reason),
                    _ = deadline => Err(signal.reason().unwrap_or_else(|| AgentError::new("Agent runtime discovery was cancelled."))),
                }
            })
        };
        let flight = Rc::new(Flight {
            controller,
            result: observed.clone(),
        });
        self.0
            .flights
            .borrow_mut()
            .insert(id.clone(), flight.clone());
        let state = self.0.clone();
        spawn_local(async move {
            let _ = native.await;
            let mut flights = state.flights.borrow_mut();
            if flights
                .get(&id)
                .is_some_and(|current| Rc::ptr_eq(current, &flight))
            {
                flights.remove(&id);
            }
        });
        observed
    }

    pub fn has_active_resources(&self) -> bool {
        !self.0.flights.borrow().is_empty()
    }

    pub fn dispose(&self) {
        self.0.disposed.set(true);
        let flights: Vec<Rc<Flight>> = self.0.flights.borrow().values().cloned().collect();
        for flight in flights {
            flight
                .controller
                .cancel(AgentError::new("Agent runtime discovery has closed."));
        }
    }
}
