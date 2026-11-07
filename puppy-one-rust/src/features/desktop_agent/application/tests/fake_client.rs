//! A scripted [`AgentClientPort`] (the tests' `vi.fn()` bridge objects).
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::dto::{SessionFailure, SessionFrame};
use crate::agent::contract::protocol::{AgentOperation, AgentRequest};
use crate::features::desktop_agent::application::agent_client_port::{AgentClientPort, Cleanup};
use crate::features::desktop_agent::fixtures::{JsonAnswer as ClientFuture, read_answer};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;

pub type Handler = Rc<dyn Fn(Value) -> ClientFuture>;
type Listener = Rc<dyn Fn(Value)>;
/// Wraps every call (`new Proxy(bridge, { get })`).
pub type Interceptor = Rc<dyn Fn(&str, Value, &dyn Fn(Value) -> ClientFuture) -> ClientFuture>;

#[derive(Default)]
pub struct FakeClient {
    methods: RefCell<HashMap<String, Handler>>,
    once: RefCell<HashMap<String, VecDeque<Handler>>>,
    calls: RefCell<Vec<(String, Value)>>,
    frame_listener: Rc<RefCell<Option<Listener>>>,
    failure_listener: Rc<RefCell<Option<Listener>>>,
    frame_subscriptions: RefCell<Vec<Listener>>,
    listens: Cell<bool>,
    interceptor: RefCell<Option<Interceptor>>,
    /// Methods the bridge defines (`vi.fn()` exists even once its queued
    /// implementations are spent).
    defined: RefCell<std::collections::HashSet<String>>,
}

impl FakeClient {
    pub fn new() -> Rc<Self> {
        let client = Rc::new(Self::default());
        client.listens.set(true);
        client
    }

    /// `bridge.method = vi.fn(handler)` / `mockImplementation(handler)`.
    pub fn handle(&self, method: &str, handler: impl Fn(Value) -> ClientFuture + 'static) {
        self.defined.borrow_mut().insert(method.into());
        self.methods
            .borrow_mut()
            .insert(method.into(), Rc::new(handler));
    }

    /// `mockImplementationOnce(handler)`.
    pub fn handle_once(&self, method: &str, handler: impl Fn(Value) -> ClientFuture + 'static) {
        self.defined.borrow_mut().insert(method.into());
        self.once
            .borrow_mut()
            .entry(method.into())
            .or_default()
            .push_back(Rc::new(handler));
    }

    /// `mockRejectedValue(error)`.
    pub fn reject(&self, method: &str, error: AgentError) {
        self.handle(method, move |_| {
            let error = error.clone();
            Box::pin(async move { Err(error) })
        });
    }

    /// `mockRejectedValueOnce(error)`.
    pub fn reject_once(&self, method: &str, error: AgentError) {
        self.handle_once(method, move |_| {
            let error = error.clone();
            Box::pin(async move { Err(error) })
        });
    }

    /// `mockResolvedValue(value)`.
    pub fn resolve(&self, method: &str, value: Value) {
        self.handle(method, move |_| {
            let value = value.clone();
            Box::pin(async move { Ok(value) })
        });
    }

    /// `mockResolvedValueOnce(value)`.
    pub fn resolve_once(&self, method: &str, value: Value) {
        self.handle_once(method, move |_| {
            let value = value.clone();
            Box::pin(async move { Ok(value) })
        });
    }

    /// `mockClear()`.
    pub fn clear(&self, method: &str) {
        self.calls.borrow_mut().retain(|(name, _)| name != method);
    }

    /// The last request of `method` (`toHaveBeenLastCalledWith`).
    pub fn last_call(&self, method: &str) -> Option<Value> {
        self.calls(method).pop()
    }

    /// Wraps every later call.
    pub fn intercept(
        &self,
        interceptor: impl Fn(&str, Value, &dyn Fn(Value) -> ClientFuture) -> ClientFuture + 'static,
    ) {
        *self.interceptor.borrow_mut() = Some(Rc::new(interceptor));
    }

    /// `getMockImplementation()`.
    pub fn implementation(&self, method: &str) -> Handler {
        self.methods.borrow()[method].clone()
    }

    /// `delete bridge.method`.
    pub fn remove(&self, method: &str) {
        self.defined.borrow_mut().remove(method);
        self.methods.borrow_mut().remove(method);
    }

    /// `bridge.method.mock.calls.map(([request]) => request)`.
    pub fn calls(&self, method: &str) -> Vec<Value> {
        self.calls
            .borrow()
            .iter()
            .filter(|(name, _)| name == method)
            .map(|(_, request)| request.clone())
            .collect()
    }

    pub fn count(&self, method: &str) -> usize {
        self.calls
            .borrow()
            .iter()
            .filter(|(name, _)| name == method)
            .count()
    }

    /// Delivers a frame to the registered listener.
    pub fn frame(&self, frame: Value) {
        let listener = self.frame_listener.borrow().clone();
        if let Some(listener) = listener {
            listener(frame);
        }
    }

    /// `bridge.onAgentSessionFrame.mock.calls[index][0]`.
    pub fn frame_subscription(&self, index: usize) -> Listener {
        self.frame_subscriptions.borrow()[index].clone()
    }

    /// Delivers a session runtime failure to the registered listener.
    pub fn fail(&self, failure: Value) {
        let listener = self.failure_listener.borrow().clone();
        if let Some(listener) = listener {
            listener(failure);
        }
    }
}

/// Resolves once the test runtime has taken a turn, however often it is
/// polled before.
pub async fn next_turn() {
    let turn = Rc::new((Cell::new(false), RefCell::new(None::<std::task::Waker>)));
    let taken = turn.clone();
    tokio::task::spawn_local(async move {
        taken.0.set(true);
        if let Some(waker) = taken.1.borrow_mut().take() {
            waker.wake();
        }
    });
    std::future::poll_fn(move |context| {
        if turn.0.get() {
            return std::task::Poll::Ready(());
        }
        *turn.1.borrow_mut() = Some(context.waker().clone());
        std::task::Poll::Pending
    })
    .await;
}

impl AgentClientPort for FakeClient {
    fn supports(&self, operation: AgentOperation) -> bool {
        self.defined.borrow().contains(operation.method())
    }

    fn delivers_frames(&self) -> bool {
        self.listens.get()
    }

    fn request(
        &self,
        request: AgentRequest,
    ) -> crate::features::desktop_agent::application::agent_client_port::ClientFuture {
        let operation = request.operation();
        let call = self.call(operation.method(), request.transport());
        Box::pin(async move { read_answer(operation, &call.await?) })
    }

    fn on_agent_session_frame(&self, listener: Rc<dyn Fn(SessionFrame)>) -> Option<Cleanup> {
        let listener: Listener = Rc::new(move |frame| listener(SessionFrame::read(&frame)));
        self.frame_subscriptions.borrow_mut().push(listener.clone());
        *self.frame_listener.borrow_mut() = Some(listener);
        let slot = self.frame_listener.clone();
        Some(Box::new(move || *slot.borrow_mut() = None))
    }

    fn on_agent_session_failure(&self, listener: Rc<dyn Fn(SessionFailure)>) -> Option<Cleanup> {
        let listener: Listener =
            Rc::new(move |failure| listener(serde_json::from_value(failure).unwrap_or_default()));
        *self.failure_listener.borrow_mut() = Some(listener);
        let slot = self.failure_listener.clone();
        Some(Box::new(move || *slot.borrow_mut() = None))
    }
}

impl FakeClient {
    /// `bridge[method](request)`: the scripted JSON answer.
    pub fn call(&self, method: &str, request: Value) -> ClientFuture {
        self.calls
            .borrow_mut()
            .push((method.into(), request.clone()));
        let once = self
            .once
            .borrow_mut()
            .get_mut(method)
            .and_then(VecDeque::pop_front);
        let handler = once.or_else(|| self.methods.borrow().get(method).cloned());
        let invoke = move |request: Value| -> ClientFuture {
            match &handler {
                Some(handler) => handler(request),
                None => {
                    let error: AgentResult<Value> = Err(AgentError::new(format!(
                        "bridge.{method} is not a function"
                    ))
                    .with_name("TypeError"));
                    Box::pin(async move { error })
                }
            }
        };
        let interceptor = self.interceptor.borrow().clone();
        let pending = match interceptor {
            Some(interceptor) => interceptor(method, request, &invoke),
            None => invoke(request),
        };
        // A JS promise settles its awaiters on a later microtask, even when
        // it is already resolved.
        Box::pin(async move {
            let result = pending.await;
            next_turn().await;
            result
        })
    }
}
