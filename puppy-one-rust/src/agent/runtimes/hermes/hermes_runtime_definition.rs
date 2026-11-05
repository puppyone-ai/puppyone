//! `runtimes/hermes/hermes-runtime-definition.mjs`.
use super::hermes_acp_adapter::hermes_acp_adapter;
use super::hermes_discovery::{HermesDiscoveryOptions, create_hermes_discovery};
use super::hermes_identity::{HERMES_RUNTIME_DESCRIPTOR, HERMES_RUNTIME_MANIFEST};
use crate::agent::protocols::acp::acp_runtime_adapter::Logger;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use crate::agent::runtimes::cursor::cursor_runtime_definition::acp_adapter_options;
use std::rc::Rc;

/// `createHermesRuntimeDefinition({ discovery, logger, appVersion })`.
pub fn create_hermes_runtime_definition(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
) -> RuntimeDefinition {
    let app_version = app_version.unwrap_or("0.0.0").to_string();
    RuntimeDefinition {
        manifest: HERMES_RUNTIME_MANIFEST.clone(),
        discovery: discovery.unwrap_or_else(|| {
            Rc::new(create_hermes_discovery(
                HermesDiscoveryOptions::default(),
                None,
            ))
        }),
        create_adapter: Rc::new(move |options| {
            let acp = acp_adapter_options(
                &options,
                &HERMES_RUNTIME_DESCRIPTOR,
                &app_version,
                logger.clone(),
            );
            Ok(Rc::new(hermes_acp_adapter(acp)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: None,
        has_active_resources: None,
    }
}
