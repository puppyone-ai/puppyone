//! Assertion and promise helpers of the product's Vitest suites.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::features::desktop_agent::application::agent_client_port::ClientFuture;
use futures_util::FutureExt;
use futures_util::future::Shared;
use serde_json::Value;
use std::cell::RefCell;
use std::rc::Rc;
use tokio::sync::oneshot;

/// `toMatchObject` / `expect.objectContaining`: every expected property
/// matches; arrays match element-wise with the same length.
pub fn matches(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => {
            expected.iter().all(|(key, expected)| {
                actual
                    .get(key)
                    .is_some_and(|actual| matches(actual, expected))
            })
        }
        (Value::Array(actual), Value::Array(expected)) => {
            actual.len() == expected.len()
                && actual.iter().zip(expected).all(|(a, e)| matches(a, e))
        }
        (actual, expected) => actual == expected,
    }
}

#[track_caller]
pub fn assert_match(actual: &Value, expected: &Value) {
    assert!(
        matches(actual, expected),
        "expected\n{}\nto match\n{}",
        serde_json::to_string_pretty(actual).unwrap_or_default(),
        serde_json::to_string_pretty(expected).unwrap_or_default()
    );
}

/// `Promise.withResolvers()` behind a bridge method.
pub struct Deferred {
    sender: RefCell<Option<oneshot::Sender<AgentResult<Value>>>>,
    receiver: Shared<oneshot::Receiver<AgentResult<Value>>>,
}

impl Deferred {
    pub fn new() -> Rc<Self> {
        let (sender, receiver) = oneshot::channel();
        Rc::new(Self {
            sender: RefCell::new(Some(sender)),
            receiver: receiver.shared(),
        })
    }

    /// The pending promise a handler returns.
    pub fn promise(&self) -> ClientFuture {
        let receiver = self.receiver.clone();
        Box::pin(async move {
            receiver
                .await
                .unwrap_or_else(|_| Err(AgentError::new("The deferred promise was dropped.")))
        })
    }

    /// `() => promise`.
    pub fn handler(self: &Rc<Self>) -> impl Fn(Value) -> ClientFuture + 'static {
        let deferred = self.clone();
        move |_| deferred.promise()
    }

    pub fn resolve(&self, value: Value) {
        if let Some(sender) = self.sender.borrow_mut().take() {
            let _ = sender.send(Ok(value));
        }
    }

    pub fn reject(&self, error: AgentError) {
        if let Some(sender) = self.sender.borrow_mut().take() {
            let _ = sender.send(Err(error));
        }
    }
}

/// Collects one [`Deferred`] per call (`new Promise(resolve => resolvers.push(resolve))`).
#[derive(Clone, Default)]
pub struct Deferreds(Rc<RefCell<Vec<Rc<Deferred>>>>);

impl Deferreds {
    pub fn handler(&self) -> impl Fn(Value) -> ClientFuture + 'static {
        let all = self.0.clone();
        move |_| {
            let deferred = Deferred::new();
            all.borrow_mut().push(deferred.clone());
            deferred.promise()
        }
    }

    pub fn get(&self, index: usize) -> Rc<Deferred> {
        self.0.borrow()[index].clone()
    }

    pub fn len(&self) -> usize {
        self.0.borrow().len()
    }

    pub fn all(&self) -> Vec<Rc<Deferred>> {
        self.0.borrow().clone()
    }
}
