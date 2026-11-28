//! `runtimes/workbuddy/workbuddy-runtime-definition.mjs`.
use super::workbuddy_acp_adapter::work_buddy_acp_adapter;
use super::workbuddy_channels::WorkBuddyChannel;
use super::workbuddy_discovery::{WorkBuddyDiscoveryOptions, create_work_buddy_discovery};
use super::workbuddy_identity::work_buddy_runtime_identity;
use crate::agent::protocols::acp::acp_runtime_adapter::Logger;
use crate::agent::protocols::acp::acp_standby::AcpStandbyPool;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use crate::agent::runtimes::cursor::cursor_runtime_definition::{
    acp_adapter_options, acp_standby_dispose,
};
use std::rc::Rc;

/// `createWorkBuddyRuntimeDefinition(channel, { discovery, logger, appVersion })`.
pub fn create_work_buddy_runtime_definition(
    channel: WorkBuddyChannel,
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
) -> RuntimeDefinition {
    create_work_buddy_runtime_definition_with_standby(channel, discovery, logger, app_version, None)
}

/// Variant of [`create_work_buddy_runtime_definition`] attaching a shared
/// [`AcpStandbyPool`] for exclusive post-inspection handover (ADR-024).
pub fn create_work_buddy_runtime_definition_with_standby(
    channel: WorkBuddyChannel,
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
    standby: Option<AcpStandbyPool>,
) -> RuntimeDefinition {
    let (manifest, descriptor) = work_buddy_runtime_identity(&channel);
    let app_version = app_version.unwrap_or("0.0.0").to_string();
    let standby_for_adapter = standby.clone();
    RuntimeDefinition {
        manifest,
        discovery: discovery.unwrap_or_else(|| {
            Rc::new(create_work_buddy_discovery(
                channel,
                WorkBuddyDiscoveryOptions::default(),
                None,
            ))
        }),
        create_adapter: Rc::new(move |options| {
            let mut acp = acp_adapter_options(&options, &descriptor, &app_version, logger.clone());
            acp.standby = standby_for_adapter.clone();
            Ok(Rc::new(work_buddy_acp_adapter(channel, acp)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: acp_standby_dispose(standby),
    }
}
