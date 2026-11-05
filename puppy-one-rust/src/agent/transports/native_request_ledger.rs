//! `transports/native-request-ledger.mjs`: request deadlines end a wait,
//! never the lifetime of the native process. Bounded late-receipt handlers
//! are retained; issued ids outside that window are still recognized so an
//! old reply cannot poison an otherwise healthy stream.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::event_loop::AbortSignal;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::rc::Rc;
use std::time::Duration;
use tokio::sync::oneshot;

/// Called with a reply that arrived after its request was abandoned.
pub type LateResponse = Rc<dyn Fn(Result<Value, AgentError>)>;

struct Pending {
    method: String,
    reply: oneshot::Sender<AgentResult<Value>>,
}

struct Late {
    method: String,
    on_late_response: Option<LateResponse>,
}

/// What a received response id resolves to.
pub enum Taken {
    /// A pending request, which now receives the reply.
    Pending(oneshot::Sender<AgentResult<Value>>, String),
    /// An abandoned request's late-receipt handler.
    Late(Option<LateResponse>, String),
    /// An issued request whose late-receipt window expired.
    Expired,
    Duplicate,
    Unknown,
}

struct State {
    pending: HashMap<String, Pending>,
    late: HashMap<String, Late>,
    late_order: VecDeque<String>,
    seen: HashSet<String>,
    seen_order: VecDeque<String>,
    limit: usize,
}

#[derive(Clone)]
pub struct NativeRequestLedger {
    state: Rc<RefCell<State>>,
    was_issued: Rc<dyn Fn(&str) -> bool>,
}

impl NativeRequestLedger {
    pub fn new(limit: usize, was_issued: Rc<dyn Fn(&str) -> bool>) -> Self {
        Self {
            state: Rc::new(RefCell::new(State {
                pending: HashMap::new(),
                late: HashMap::new(),
                late_order: VecDeque::new(),
                seen: HashSet::new(),
                seen_order: VecDeque::new(),
                limit,
            })),
            was_issued,
        }
    }

    pub fn pending_count(&self) -> usize {
        self.state.borrow().pending.len()
    }

    /// `ledger.request({ id, method, timeoutMs, signal, timeoutError, abortError, write, onLateResponse })`.
    #[allow(clippy::too_many_arguments)]
    pub async fn request(
        &self,
        id: &str,
        method: &str,
        timeout_ms: u64,
        signal: Option<&AbortSignal>,
        timeout_error: impl FnOnce() -> AgentError,
        abort_error: impl FnOnce() -> AgentError,
        write: impl FnOnce() -> AgentResult<()>,
        on_late_response: Option<LateResponse>,
    ) -> AgentResult<Value> {
        let (reply, receipt) = oneshot::channel();
        self.state.borrow_mut().pending.insert(
            id.to_string(),
            Pending {
                method: method.to_string(),
                reply,
            },
        );
        if let Err(error) = write() {
            self.abandon(id, on_late_response);
            return Err(error);
        }
        let deadline = async {
            if timeout_ms > 0 {
                tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        let aborted = async {
            match signal {
                Some(signal) => {
                    signal.aborted_reason().await;
                }
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            biased;
            result = receipt => result.unwrap_or_else(|_| Err(AgentError::new("The native request was abandoned."))),
            _ = deadline => {
                self.abandon(id, on_late_response);
                Err(timeout_error())
            }
            _ = aborted => {
                self.abandon(id, on_late_response);
                Err(abort_error())
            }
        }
    }

    fn abandon(&self, id: &str, on_late_response: Option<LateResponse>) {
        let mut state = self.state.borrow_mut();
        let Some(pending) = state.pending.remove(id) else {
            return;
        };
        state.late.insert(
            id.to_string(),
            Late {
                method: pending.method,
                on_late_response,
            },
        );
        state.late_order.push_back(id.to_string());
        if state.late_order.len() > state.limit
            && let Some(oldest) = state.late_order.pop_front()
        {
            state.late.remove(&oldest);
        }
    }

    /// `ledger.take(id)`.
    pub fn take(&self, id: &str) -> Taken {
        let mut state = self.state.borrow_mut();
        if state.seen.contains(id) {
            return Taken::Duplicate;
        }
        let taken = if let Some(pending) = state.pending.remove(id) {
            Taken::Pending(pending.reply, pending.method)
        } else if let Some(late) = state.late.remove(id) {
            state.late_order.retain(|entry| entry != id);
            Taken::Late(late.on_late_response, late.method)
        } else {
            drop(state);
            return if (self.was_issued)(id) {
                Taken::Expired
            } else {
                Taken::Unknown
            };
        };
        state.seen.insert(id.to_string());
        state.seen_order.push_back(id.to_string());
        if state.seen_order.len() > state.limit
            && let Some(oldest) = state.seen_order.pop_front()
        {
            state.seen.remove(&oldest);
        }
        taken
    }

    /// `ledger.close(errorFor)`.
    pub fn close(&self, error_for: impl Fn(&str) -> AgentError) {
        let pending: Vec<Pending> = {
            let mut state = self.state.borrow_mut();
            state.late.clear();
            state.late_order.clear();
            state.seen.clear();
            state.seen_order.clear();
            state.pending.drain().map(|(_, p)| p).collect()
        };
        for request in pending {
            let _ = request.reply.send(Err(error_for(&request.method)));
        }
    }
}
