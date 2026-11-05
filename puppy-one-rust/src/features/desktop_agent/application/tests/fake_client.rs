//! A scripted [`AgentClientPort`] (the tests' `vi.fn()` bridge objects).
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, Cleanup, ClientFuture,
};
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
}

impl FakeClient {
    pub fn new() -> Rc<Self> {
        let client = Rc::new(Self::default());
        client.listens.set(true);
        client
    }

    /// `bridge.method = vi.fn(handler)` / `mockImplementation(handler)`.
    pub fn handle(&self, method: &str, handler: impl Fn(Value) -> ClientFuture + 'static) {
        self.methods
            .borrow_mut()
            .insert(method.into(), Rc::new(handler));
    }

    /// `mockImplementationOnce(handler)`.
    pub fn handle_once(&self, method: &str, handler: impl Fn(Value) -> ClientFuture + 'static) {
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

impl AgentClientPort for FakeClient {
    fn implements(&self, method: &str) -> bool {
        match method {
            "onAgentSessionFrame" | "onAgentSessionFailure" => self.listens.get(),
            method => self.methods.borrow().contains_key(method),
        }
    }

    fn call(&self, method: &str, request: Value) -> ClientFuture {
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
        match interceptor {
            Some(interceptor) => interceptor(method, request, &invoke),
            None => invoke(request),
        }
    }

    fn on_agent_session_frame(&self, listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        self.frame_subscriptions.borrow_mut().push(listener.clone());
        *self.frame_listener.borrow_mut() = Some(listener);
        let slot = self.frame_listener.clone();
        Some(Box::new(move || *slot.borrow_mut() = None))
    }

    fn on_agent_session_failure(&self, listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        *self.failure_listener.borrow_mut() = Some(listener);
        let slot = self.failure_listener.clone();
        Some(Box::new(move || *slot.borrow_mut() = None))
    }
}
