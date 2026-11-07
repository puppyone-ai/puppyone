//! Agent clients scripted in the contract's transport form, for the pixel
//! lab's recorded conversations and the tests' fake bridges: a request is
//! handed over as JSON and the JSON answer read back as the operation's
//! typed response, exactly as a recorded product exchange reads.
use crate::agent::agent_error::{AgentError, AgentResult};
#[cfg(feature = "dev-capture")]
use crate::agent::contract::dto::{SessionFailure, SessionFrame};
#[cfg(feature = "dev-capture")]
use crate::agent::contract::protocol::AgentRequest;
use crate::agent::contract::protocol::{AgentOperation, AgentResponse};
#[cfg(feature = "dev-capture")]
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, Cleanup, ClientFuture,
};
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
#[cfg(feature = "dev-capture")]
use std::rc::Rc;

/// An answer in transport form.
pub type JsonAnswer = LocalBoxFuture<'static, AgentResult<Value>>;

/// A client that answers in JSON.
#[cfg(feature = "dev-capture")]
pub trait JsonAgent {
    /// Whether it offers `operation`.
    fn supports(&self, operation: AgentOperation) -> bool;
    /// Whether it delivers session frames.
    fn delivers_frames(&self) -> bool {
        false
    }
    /// `operation`'s answer to `request` (the request's transport form).
    fn answer(&self, operation: AgentOperation, request: Value) -> JsonAnswer;
    /// Registers the listener frames in transport form are handed to.
    fn on_frame(&self, _listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        None
    }
    /// Registers the listener failures in transport form are handed to.
    fn on_failure(&self, _listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        None
    }
}

/// A [`JsonAgent`] as the client port.
#[cfg(feature = "dev-capture")]
pub struct JsonPort<T>(pub T);

/// Reads a JSON answer as `operation`'s typed response.
pub fn read_answer(operation: AgentOperation, value: &Value) -> AgentResult<AgentResponse> {
    AgentResponse::from_transport(operation, value)
        .map_err(|error| AgentError::new(error).with_name("TypeError"))
}

#[cfg(feature = "dev-capture")]
impl<T: JsonAgent> AgentClientPort for JsonPort<T> {
    fn supports(&self, operation: AgentOperation) -> bool {
        self.0.supports(operation)
    }

    fn delivers_frames(&self) -> bool {
        self.0.delivers_frames()
    }

    fn request(&self, request: AgentRequest) -> ClientFuture {
        let operation = request.operation();
        let call = self.0.answer(operation, request.transport());
        Box::pin(async move { read_answer(operation, &call.await?) })
    }

    fn on_agent_session_frame(&self, listener: Rc<dyn Fn(SessionFrame)>) -> Option<Cleanup> {
        self.0
            .on_frame(Rc::new(move |frame| listener(SessionFrame::read(&frame))))
    }

    fn on_agent_session_failure(&self, listener: Rc<dyn Fn(SessionFailure)>) -> Option<Cleanup> {
        self.0.on_failure(Rc::new(move |failure| {
            listener(serde_json::from_value(failure).unwrap_or_default())
        }))
    }
}

/// Tests: a contract value edited in its transport form, written back when
/// the edit ends (`state.inspection.capabilities.x = …` in the product's
/// suites).
#[cfg(test)]
pub struct JsonEdit<'a, T: serde::Serialize + serde::de::DeserializeOwned> {
    target: &'a mut T,
    json: Value,
}

#[cfg(test)]
impl<'a, T: serde::Serialize + serde::de::DeserializeOwned> JsonEdit<'a, T> {
    pub fn new(target: &'a mut T) -> Self {
        let json = serde_json::to_value(&*target).expect("serializable");
        Self { target, json }
    }
}

#[cfg(test)]
impl<T: serde::Serialize + serde::de::DeserializeOwned> std::ops::Deref for JsonEdit<'_, T> {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.json
    }
}

#[cfg(test)]
impl<T: serde::Serialize + serde::de::DeserializeOwned> std::ops::DerefMut for JsonEdit<'_, T> {
    fn deref_mut(&mut self) -> &mut Value {
        &mut self.json
    }
}

#[cfg(test)]
impl<T: serde::Serialize + serde::de::DeserializeOwned> Drop for JsonEdit<'_, T> {
    fn drop(&mut self) {
        *self.target =
            serde_json::from_value(std::mem::take(&mut self.json)).expect("a well-formed edit");
    }
}

/// Tests: the typed display of a display in transport form.
#[cfg(test)]
pub fn projection_of(display: &Value) -> crate::agent::contract::dto::AgentProjection {
    let display = crate::agent::contract::display_types::AgentDisplay::from_value(display)
        .expect("a well-formed display");
    crate::agent::contract::dto::AgentProjection::project(&display, None).expect("a typed display")
}

/// Tests: a projection in transport form.
#[cfg(test)]
pub fn projection_json(projection: &crate::agent::contract::dto::AgentProjection) -> Value {
    serde_json::from_str(&projection.to_json_string()).expect("display JSON")
}

/// Tests: edits a projection in its transport form.
#[cfg(test)]
pub fn edit_projection(
    projection: &mut crate::agent::contract::dto::AgentProjection,
    edit: impl FnOnce(&mut Value),
) {
    let mut display = projection_json(projection);
    edit(&mut display);
    *projection = projection_of(&display);
}

/// Tests: a contract type from its transport form.
#[cfg(test)]
pub fn typed<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("a well-formed fixture")
}

/// Tests: a contract type in its transport form.
#[cfg(test)]
pub fn json_of<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("a serializable value")
}
