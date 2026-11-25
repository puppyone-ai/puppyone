//! `runtimes/cursor/cursor-runtime-definition.mjs`.
use super::cursor_acp_adapter::cursor_acp_adapter;
use super::cursor_discovery::{CursorDiscoveryOptions, create_cursor_discovery};
use super::cursor_identity::{CURSOR_RUNTIME_DESCRIPTOR, CURSOR_RUNTIME_MANIFEST};
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::acp::acp_runtime_adapter::{AcpAdapterOptions, Logger};
use crate::agent::protocols::acp::acp_standby::AcpStandbyPool;
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

/// Helper converting an optional [`AcpStandbyPool`] into a registry disposal hook.
pub(crate) fn acp_standby_dispose(
    standby: Option<AcpStandbyPool>,
) -> Option<Rc<dyn Fn() -> futures_util::future::LocalBoxFuture<'static, AgentResult<()>>>> {
    standby.map(|pool| {
        Rc::new(move || {
            let pool = pool.clone();
            Box::pin(async move { pool.dispose_all().await })
                as futures_util::future::LocalBoxFuture<'static, AgentResult<()>>
        }) as Rc<dyn Fn() -> futures_util::future::LocalBoxFuture<'static, AgentResult<()>>>
    })
}

/// `createCursorRuntimeDefinition({ discovery, logger, appVersion })`.
pub fn create_cursor_runtime_definition(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
) -> RuntimeDefinition {
    create_cursor_runtime_definition_with_standby(discovery, logger, app_version, None)
}

/// Variant of [`create_cursor_runtime_definition`] attaching a shared
/// [`AcpStandbyPool`] for exclusive post-inspection handover (ADR-024).
pub fn create_cursor_runtime_definition_with_standby(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
    standby: Option<AcpStandbyPool>,
) -> RuntimeDefinition {
    let app_version = app_version.unwrap_or("0.0.0").to_string();
    let standby_for_adapter = standby.clone();
    RuntimeDefinition {
        manifest: CURSOR_RUNTIME_MANIFEST.clone(),
        discovery: discovery.unwrap_or_else(|| {
            Rc::new(create_cursor_discovery(
                CursorDiscoveryOptions::default(),
                None,
            ))
        }),
        create_adapter: Rc::new(move |options| {
            let mut acp = acp_adapter_options(
                &options,
                &CURSOR_RUNTIME_DESCRIPTOR,
                &app_version,
                logger.clone(),
            );
            acp.standby = standby_for_adapter.clone();
            Ok(Rc::new(cursor_acp_adapter(acp)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: acp_standby_dispose(standby),
    }
}
