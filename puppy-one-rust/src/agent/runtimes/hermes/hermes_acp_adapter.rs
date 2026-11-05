//! `runtimes/hermes/hermes-acp-adapter.mjs`: Hermes product policy around
//! the shared first-party ACP runtime core.
use super::hermes_history_source::hermes_history_source;
use super::hermes_identity::HERMES_RUNTIME_DESCRIPTOR;
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::acp::acp_runtime_adapter::{AcpAdapterOptions, AcpRuntimeAdapter};
use serde_json::Value;
use std::rc::Rc;

/// `hermesAuthenticationMethod(authMethods)`: configured Agent-managed
/// credentials, never a terminal setup method.
pub fn hermes_authentication_method(auth_methods: &[Value]) -> Option<String> {
    auth_methods
        .iter()
        .find(|method| {
            method
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty())
                && method.get("type").and_then(Value::as_str) != Some("terminal")
        })
        .and_then(|method| method.get("id").and_then(Value::as_str).map(str::to_string))
}

/// The readiness `environment`, or the host environment when absent.
pub(crate) fn readiness_environment(readiness: &Value) -> impl Fn(&str) -> Option<String> + use<> {
    let environment = readiness
        .get("environment")
        .filter(|e| e.is_object())
        .cloned();
    move |key: &str| match environment.as_ref() {
        Some(environment) => environment
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string),
        None => std::env::var(key).ok(),
    }
}

/// `readiness.argsPrefix`.
pub(crate) fn readiness_args_prefix(readiness: &Value) -> Vec<String> {
    readiness
        .get("argsPrefix")
        .and_then(Value::as_array)
        .map(|args| {
            args.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// `new HermesAcpAdapter(options)`.
pub fn hermes_acp_adapter(mut options: AcpAdapterOptions) -> AgentResult<AcpRuntimeAdapter> {
    if !options.runtime_descriptor.is_object() {
        options.runtime_descriptor = HERMES_RUNTIME_DESCRIPTOR.clone();
    }
    options.source_scope_id = Some(hermes_history_source(&readiness_environment(
        &options.readiness,
    )));
    options.account_type = Some("hermes".into());
    options.created_title = Some("New Hermes session".into());
    options.resumed_title = Some("Hermes session".into());
    options.authentication_method_selector = Some(Rc::new(hermes_authentication_method));
    let args_prefix = readiness_args_prefix(&options.readiness);
    options.process_args = Some(Rc::new(move |_, _, _| {
        let mut args = args_prefix.clone();
        args.push("acp".into());
        args
    }));
    options.event_source = Some("hermes-acp".into());
    AcpRuntimeAdapter::new(options)
}
