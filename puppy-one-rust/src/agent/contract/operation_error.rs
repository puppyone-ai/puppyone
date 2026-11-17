//! `shared/agent-contract/operation-error.mjs`.
use super::validation::{
    Contract, assert_record, enum_value, optional_string, required_string, type_error,
};
use serde_json::Value;

const ACTIONS: &[&str] = &["sign-in", "refresh", "learn-more", "update"];

/// Failures cross IPC as plain data; Electron does not preserve Error properties.
pub fn read_agent_operation_failure(value: &Value) -> Contract<Option<Value>> {
    let Some(failure) = value.as_object().and_then(|v| v.get("agentFailure")) else {
        return Ok(None);
    };
    let record = assert_record(Some(failure), "Agent operation failure")?;
    if record.get("schemaVersion") != Some(&Value::from(1)) {
        return Err(type_error("Unsupported Agent failure version."));
    }
    required_string(record.get("message"), "Agent failure.message", 4_000)?;
    required_string(record.get("code"), "Agent failure.code", 160)?;
    for key in ["runtimeId", "operation", "stage", "status"] {
        if !matches!(record.get(key), None | Some(Value::Null)) {
            optional_string(record.get(key), &format!("Agent failure.{key}"), 160)?;
        }
    }
    if !record.get("retryable").is_some_and(Value::is_boolean) {
        return Err(type_error("Invalid Agent failure retry policy."));
    }
    let Some(actions) = record
        .get("actions")
        .and_then(Value::as_array)
        .filter(|a| a.len() <= 4)
    else {
        return Err(type_error("Invalid Agent failure actions."));
    };
    for action in actions {
        enum_value(Some(action), "Agent failure action", ACTIONS)?;
    }
    Ok(Some(failure.clone()))
}
