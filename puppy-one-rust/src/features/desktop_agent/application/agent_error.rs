//! `application/agent-error.ts`: Renderer error codes and their
//! presentation descriptors (`{ code, params?, detail?, operation? }`).
use crate::agent::agent_error::AgentError;
use crate::agent::contract::js;
use serde_json::{Value, json};

/// `new AgentOperationError(failure)`: a structured bridge failure.
pub fn agent_operation_error(failure: Value) -> AgentError {
    let message = failure
        .get("message")
        .map(|m| js::to_js_string(Some(m)))
        .unwrap_or_default();
    let mut error = AgentError::new(message).with_name("AgentOperationError");
    error.extra = Some(json!({ "failure": failure }));
    error
}

/// The operation failure of an `AgentOperationError`.
pub fn operation_failure(error: &AgentError) -> Option<&Value> {
    (error.name.as_deref() == Some("AgentOperationError"))
        .then(|| error.extra.as_ref().map(|extra| &extra["failure"]))
        .flatten()
}

/// `new AgentKnownError(code, params)`.
pub fn agent_known_error(code: &str, params: Option<Value>) -> AgentError {
    let mut error = AgentError::new(code)
        .with_name("AgentKnownError")
        .with_code(code);
    error.extra = params.map(|params| json!({ "params": params }));
    error
}

/// The code of an `AgentKnownError`.
pub fn known_error_code(error: &AgentError) -> Option<&str> {
    (error.name.as_deref() == Some("AgentKnownError"))
        .then_some(error.code.as_deref())
        .flatten()
}

/// `createAgentError(code, params)`.
pub fn create_agent_error(code: &str, params: Option<Value>) -> Value {
    let mut descriptor = json!({ "code": code });
    if let Some(params) = params {
        descriptor["params"] = params;
    }
    descriptor
}

/// `formatAgentError(error)`.
pub fn format_agent_error(error: &AgentError) -> Value {
    if let Some(code) = known_error_code(error) {
        let params = error.extra.as_ref().map(|extra| extra["params"].clone());
        return create_agent_error(code, params);
    }
    if let Some(failure) = operation_failure(error) {
        return json!({ "code": "unknown", "detail": error.message, "operation": failure });
    }
    // Compatibility with bridges that cannot yet return a structured error.
    if error.message.contains("No handler registered for 'agent:")
        || error.message.contains("Desktop Agent bridge unavailable")
    {
        return create_agent_error("native-bridge-unavailable", None);
    }
    json!({ "code": "unknown", "detail": js::head16(&error.message, 32_768) })
}
