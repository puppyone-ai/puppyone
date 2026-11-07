//! `runtimes/cursor/cursor-runtime-definition.mjs`.
use super::cursor_acp_adapter::cursor_acp_adapter;
use super::cursor_discovery::{CursorDiscoveryOptions, create_cursor_discovery};
use super::cursor_identity::{CURSOR_RUNTIME_DESCRIPTOR, CURSOR_RUNTIME_MANIFEST};
use crate::agent::protocols::acp::acp_runtime_adapter::{AcpAdapterOptions, Logger};
use crate::agent::runtime::agent_runtime_port::{AdapterOptions, AgentRuntimeAdapter};
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use std::rc::Rc;

/// The shared ACP options a runtime definition creates its adapter with.
pub fn acp_adapter_options(
    options: &AdapterOptions,
    descriptor: &serde_json::Value,
    app_version: &str,
    logger: Option<Logger>,
) -> AcpAdapterOptions {
    let mut acp = AcpAdapterOptions::new(
        options.readiness.clone(),
        &options.workspace_root,
        descriptor.clone(),
    );
    acp.app_version = app_version.to_string();
    acp.logger = logger;
    acp.on_event = options.on_event.clone();
    acp.on_exit = options.on_exit.clone();
    acp.on_session_persisted = options.on_session_persisted.clone();
    acp
}

/// `createCursorRuntimeDefinition({ discovery, logger, appVersion })`.
pub fn create_cursor_runtime_definition(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
) -> RuntimeDefinition {
    let app_version = app_version.unwrap_or("0.0.0").to_string();
    RuntimeDefinition {
        manifest: CURSOR_RUNTIME_MANIFEST.clone(),
        discovery: discovery.unwrap_or_else(|| {
            Rc::new(create_cursor_discovery(
                CursorDiscoveryOptions::default(),
                None,
            ))
        }),
        create_adapter: Rc::new(move |options| {
            let acp = acp_adapter_options(
                &options,
                &CURSOR_RUNTIME_DESCRIPTOR,
                &app_version,
                logger.clone(),
            );
            Ok(Rc::new(cursor_acp_adapter(acp)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: None,
    }
}
