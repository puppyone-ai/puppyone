//! `runtimes/pi/pi-rpc-adapter.mjs`: the user-owned Pi CLI route. Its
//! profile, extensions and sessions remain Pi-owned.
use super::pi_history_source::pi_history_source;
use super::pi_identity::PI_RUNTIME_DESCRIPTOR;
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::{
    PI_CAPABILITIES, PiAdapterOptions, PiRpcRuntimeAdapter,
};
use crate::agent::runtimes::hermes::hermes_acp_adapter::readiness_environment;

/// `new PiRpcAdapter(options)`.
pub fn pi_rpc_adapter(mut options: PiAdapterOptions) -> AgentResult<PiRpcRuntimeAdapter> {
    if !options.runtime_descriptor.is_object() {
        options.runtime_descriptor = PI_RUNTIME_DESCRIPTOR.clone();
    }
    if options.source_scope_id.is_empty() {
        options.source_scope_id = pi_history_source(&readiness_environment(&options.readiness)).0;
    }
    options.runtime_label = Some("Pi".into());
    options.runtime_namespace = Some("pi".into());
    options.provider_source = Some("pi".into());
    options.account_type = Some("pi".into());
    options.capabilities = Some(PI_CAPABILITIES.clone());
    options.runtime_setup_message =
        Some("Pi has no authenticated model providers. Configure one in Pi, then refresh.".into());
    PiRpcRuntimeAdapter::new(options)
}
