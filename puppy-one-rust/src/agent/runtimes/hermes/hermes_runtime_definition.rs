//! `runtimes/hermes/hermes-runtime-definition.mjs`.
use super::hermes_acp_adapter::hermes_acp_adapter;
use super::hermes_discovery::{HermesDiscoveryOptions, create_hermes_discovery};
use super::hermes_identity::{HERMES_RUNTIME_DESCRIPTOR, HERMES_RUNTIME_MANIFEST};
use crate::agent::protocols::acp::acp_runtime_adapter::Logger;
use crate::agent::protocols::acp::acp_standby::AcpStandbyPool;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use crate::agent::runtimes::cursor::cursor_runtime_definition::{
    acp_adapter_options, acp_standby_dispose,
};
use std::rc::Rc;

/// `createHermesRuntimeDefinition({ discovery, logger, appVersion })`.
pub fn create_hermes_runtime_definition(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
) -> RuntimeDefinition {
    create_hermes_runtime_definition_with_standby(discovery, logger, app_version, None)
}

/// Variant of [`create_hermes_runtime_definition`] attaching a shared
/// [`AcpStandbyPool`] for exclusive post-inspection handover (ADR-024).
pub fn create_hermes_runtime_definition_with_standby(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
    standby: Option<AcpStandbyPool>,
) -> RuntimeDefinition {
    let app_version = app_version.unwrap_or("0.0.0").to_string();
    let standby_for_adapter = standby.clone();
    RuntimeDefinition {
        manifest: HERMES_RUNTIME_MANIFEST.clone(),
        discovery: discovery.unwrap_or_else(|| {
            Rc::new(create_hermes_discovery(
                HermesDiscoveryOptions::default(),
                None,
            ))
        }),
        create_adapter: Rc::new(move |options| {
            let mut acp = acp_adapter_options(
                &options,
                &HERMES_RUNTIME_DESCRIPTOR,
                &app_version,
                logger.clone(),
            );
            acp.standby = standby_for_adapter.clone();
            Ok(Rc::new(hermes_acp_adapter(acp)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: acp_standby_dispose(standby),
    }
}
