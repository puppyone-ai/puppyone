//! `runtimes/workbuddy/workbuddy-runtime-definition.mjs`.
use super::workbuddy_acp_adapter::work_buddy_acp_adapter;
use super::workbuddy_channels::{
    WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL, WorkBuddyChannel,
};
use super::workbuddy_discovery::{WorkBuddyDiscoveryOptions, create_work_buddy_discovery};
use super::workbuddy_identity::work_buddy_runtime_identity;
use crate::agent::protocols::acp::acp_runtime_adapter::Logger;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use crate::agent::runtimes::cursor::cursor_runtime_definition::acp_adapter_options;
use std::rc::Rc;

/// `createWorkBuddyRuntimeDefinition(channel, { discovery, logger, appVersion })`.
pub fn create_work_buddy_runtime_definition(
    channel: WorkBuddyChannel,
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
) -> RuntimeDefinition {
    let (manifest, descriptor) = work_buddy_runtime_identity(&channel);
    let app_version = app_version.unwrap_or("0.0.0").to_string();
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
            let acp = acp_adapter_options(&options, &descriptor, &app_version, logger.clone());
            Ok(Rc::new(work_buddy_acp_adapter(channel, acp)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: None,
    }
}

/// `createWorkBuddyChinaRuntimeDefinition(options)`.
pub fn create_work_buddy_china_runtime_definition(app_version: Option<&str>) -> RuntimeDefinition {
    create_work_buddy_runtime_definition(WORKBUDDY_CHINA_CHANNEL, None, None, app_version)
}

/// `createWorkBuddyInternationalRuntimeDefinition(options)`.
pub fn create_work_buddy_international_runtime_definition(
    app_version: Option<&str>,
) -> RuntimeDefinition {
    create_work_buddy_runtime_definition(WORKBUDDY_INTERNATIONAL_CHANNEL, None, None, app_version)
}
