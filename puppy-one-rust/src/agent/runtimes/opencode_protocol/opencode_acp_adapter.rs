//! `runtimes/opencode-protocol/opencode-acp-adapter.mjs`: OpenCode policy
//! and profile around the shared ACP runtime core.
use super::opencode_history_source::open_code_history_source;
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::acp::acp_runtime_adapter::{AcpAdapterOptions, AcpRuntimeAdapter};
use crate::agent::runtimes::hermes::hermes_acp_adapter::readiness_environment;
use serde_json::json;
use std::rc::Rc;

/// `new OpenCodeAcpAdapter(options)`.
pub fn open_code_acp_adapter(mut options: AcpAdapterOptions) -> AgentResult<AcpRuntimeAdapter> {
    options.source_scope_id = Some(open_code_history_source(&readiness_environment(
        &options.readiness,
    )));
    options.account_type = Some("opencode-native".into());
    options.created_title = Some("New OpenCode session".into());
    options.resumed_title = Some("OpenCode session".into());
    options.process_args = Some(Rc::new(|_, root, _| {
        vec!["acp".into(), format!("--cwd={root}")]
    }));
    options.environment_overlay = Some(Rc::new(|_, mode, _, _| {
        if mode == "metadata" {
            json!({ "OPENCODE_DB": ":memory:" })
        } else {
            json!({})
        }
    }));
    options.event_source = Some("opencode-acp".into());
    options.embedded_text = true;
    AcpRuntimeAdapter::new(options)
}
