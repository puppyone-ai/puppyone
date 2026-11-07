//! Assertion and promise helpers of the product's Vitest suites.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::features::desktop_agent::fixtures::JsonAnswer as ClientFuture;
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

/// The controller state as the product's plain object (`getSnapshot()`),
/// for `toMatchObject` assertions.
pub trait StateJson {
    fn to_value(&self) -> Value;
}

/// An error descriptor as the product's plain object.
pub fn error_json(
    error: &crate::features::desktop_agent::application::agent_error::ErrorDescriptor,
) -> Value {
    let mut value = serde_json::json!({ "code": error.code });
    if !error.params.is_empty() {
        value["params"] = Value::Object(
            error
                .params
                .iter()
                .map(|(key, param)| (key.clone(), Value::from(param.as_str())))
                .collect(),
        );
    }
    if let Some(detail) = &error.detail {
        value["detail"] = Value::from(detail.as_str());
    }
    if let Some(operation) = &error.operation {
        value["operation"] = serde_json::to_value(operation).unwrap_or_default();
    }
    value
}

impl StateJson
    for crate::features::desktop_agent::application::agent_controller_state::AgentControllerState
{
    fn to_value(&self) -> Value {
        let text = |value: &Option<String>| value.clone().map_or(Value::Null, Value::from);
        let json = |value: &dyn erased::Json| value.json();
        let mut value = serde_json::json!({
            "phase": self.phase.as_str(),
            "inspection": json(&self.inspection),
            "session": json(&self.session),
            "control": json(&self.control),
            "replicaStatus": self.replica_status.as_str(),
            "projection": serde_json::from_str::<Value>(&self.projection.to_json_string()).unwrap_or_default(),
            "selectedRuntimeId": text(&self.selected_runtime_id),
            "selectedProviderId": text(&self.selected_provider_id),
            "selectedModel": text(&self.selected_model),
            "selectedEffort": text(&self.selected_effort),
            "selectedMode": text(&self.selected_mode),
            "localConnections": json(&self.local_connections),
            "localConnectionsPhase": self.local_connections_phase.as_str(),
            "localConnectionsScannedAt": text(&self.local_connections_scanned_at),
            "localConnectionsError": self.local_connections_error.as_ref().map_or(Value::Null, error_json),
            "draft": self.draft,
            "draftMentions": json(&self.draft_mentions),
            "pendingPrompt": text(&self.pending_prompt),
            "pendingIntent": json(&self.pending_intent),
            "sessionPreparation": self.session_preparation.as_str(),
            "references": json(&self.references),
            "error": self.error.as_ref().map_or(Value::Null, error_json),
            "submitting": self.submitting,
            "stopping": self.stopping,
            "initialized": self.initialized,
        });
        if let Some(request) = &self.stop_request {
            value["stopRequest"] = serde_json::json!({
                "commandId": request.command_id,
                "sessionId": request.session_id,
                "instanceId": request.instance_id,
                "turnId": request.turn_id,
                "status": request.status.as_str(),
            });
        }
        if let Some(recovery) = &self.display_recovery {
            value["displayRecovery"] = serde_json::json!({
                "policy": recovery.policy.as_str(),
                "stage": recovery.stage.as_str(),
                "cause": recovery.cause.as_str(),
                "attempt": recovery.attempt,
                "maxAttempts": recovery.max_attempts,
            });
        }
        value
    }
}

mod erased {
    /// Any serializable value as JSON.
    pub trait Json {
        fn json(&self) -> serde_json::Value;
    }
    impl<T: serde::Serialize> Json for T {
        fn json(&self) -> serde_json::Value {
            serde_json::to_value(self).unwrap_or_default()
        }
    }
}

/// A contract type from its transport form.
pub fn typed<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("a well-formed fixture")
}

/// A contract type in its transport form.
pub fn j<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("a serializable value")
}
