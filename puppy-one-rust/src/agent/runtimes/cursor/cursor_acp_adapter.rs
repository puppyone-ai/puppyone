//! `runtimes/cursor/cursor-acp-adapter.mjs`: Cursor-specific
//! authentication and extension metadata around the shared ACP core.
use super::cursor_completion_inspector::CursorCompletionInspector;
use super::cursor_history_source::cursor_history_source;
use super::cursor_identity::CURSOR_RUNTIME_DESCRIPTOR;
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::acp::acp_runtime_adapter::{
    AcpAdapterOptions, AcpRuntimeAdapter, CompletionInspector,
};
use serde_json::{Value, json};
use std::rc::Rc;

/// `new CursorAcpAdapter(options)`.
pub fn cursor_acp_adapter(mut options: AcpAdapterOptions) -> AgentResult<AcpRuntimeAdapter> {
    let environment = options.readiness.get("environment").cloned();
    let read = move |key: &str| match environment.as_ref() {
        Some(environment) => environment
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string),
        None => std::env::var(key).ok(),
    };
    options.source_scope_id = Some(cursor_history_source(&read));
    if !options.runtime_descriptor.is_object() {
        options.runtime_descriptor = CURSOR_RUNTIME_DESCRIPTOR.clone();
    }
    options.account_type = Some("cursor".into());
    options.created_title = Some("New Cursor Agent session".into());
    options.resumed_title = Some("Cursor Agent session".into());
    options.authentication_method_id = Some("cursor_login".into());
    let args_prefix: Vec<String> = options
        .readiness
        .get("argsPrefix")
        .and_then(Value::as_array)
        .map(|args| {
            args.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    options.process_args = Some(Rc::new(move |_, _, _| {
        let mut args = args_prefix.clone();
        args.push("acp".into());
        args
    }));
    options.question_methods = vec!["cursor/ask_question".into()];
    options.completion_inspector_factory = Some(Rc::new(|_, _| {
        Some(Rc::new(CursorCompletionInspector::default()) as Rc<dyn CompletionInspector>)
    }));
    options.capability_overrides = json!({ "structuredQuestions": true, "manualApprovals": true });
    options.event_source = Some("cursor-acp".into());
    AcpRuntimeAdapter::new(options)
}
