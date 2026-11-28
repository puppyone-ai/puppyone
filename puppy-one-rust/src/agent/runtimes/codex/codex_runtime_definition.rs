//! `runtimes/codex/codex-runtime-definition.mjs`.
use super::codex_app_server_adapter::{CodexAdapterOptions, CodexAppServerAdapter};
use super::codex_discovery::{CodexDiscoveryOptions, create_codex_discovery};
use super::codex_identity::CODEX_RUNTIME_MANIFEST;
use super::codex_standby::CodexStandbyPool;
use crate::agent::agent_error::AgentResult;
use crate::agent::runtime::agent_runtime_port::{AdapterOptions, AgentRuntimeAdapter};
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use serde_json::Value;
use std::rc::Rc;

/// `adapterFactory(options)`.
pub type CodexAdapterFactory =
    Rc<dyn Fn(CodexAdapterOptions) -> AgentResult<Rc<dyn AgentRuntimeAdapter>>>;

/// `createCodexRuntimeDefinition({ appVersion, discovery, adapterFactory })`.
pub fn create_codex_runtime_definition(
    app_version: Option<&str>,
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    adapter_factory: Option<CodexAdapterFactory>,
) -> RuntimeDefinition {
    create_codex_runtime_definition_with_standby(app_version, discovery, adapter_factory, None)
}

/// Variant of [`create_codex_runtime_definition`] that attaches a shared
/// per-workspace [`CodexStandbyPool`] and disposes it when the runtime registry
/// shuts down (ADR-024).
pub fn create_codex_runtime_definition_with_standby(
    app_version: Option<&str>,
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    adapter_factory: Option<CodexAdapterFactory>,
    standby: Option<CodexStandbyPool>,
) -> RuntimeDefinition {
    let app_version = app_version.unwrap_or("0.0.0").to_string();
    let discovery = discovery.unwrap_or_else(|| {
        Rc::new(create_codex_discovery(
            CodexDiscoveryOptions::default(),
            None,
        ))
    });
    let adapter_factory = adapter_factory.unwrap_or_else(|| {
        Rc::new(|options| {
            Ok(Rc::new(CodexAppServerAdapter::new(options)) as Rc<dyn AgentRuntimeAdapter>)
        })
    });
    let standby_for_adapter = standby.clone();
    let dispose = standby.map(|pool| {
        Rc::new(move || {
            let pool = pool.clone();
            Box::pin(async move { pool.dispose_all().await })
                as futures_util::future::LocalBoxFuture<'static, AgentResult<()>>
        }) as Rc<dyn Fn() -> futures_util::future::LocalBoxFuture<'static, AgentResult<()>>>
    });
    RuntimeDefinition {
        manifest: CODEX_RUNTIME_MANIFEST.clone(),
        discovery,
        create_adapter: Rc::new(move |options: AdapterOptions| {
            let readiness = &options.readiness;
            adapter_factory(CodexAdapterOptions {
                executable_path: readiness
                    .get("executablePath")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                environment: readiness
                    .get("environment")
                    .filter(|e| !e.is_null())
                    .cloned(),
                workspace_root: options.workspace_root.clone(),
                app_version: app_version.clone(),
                spawner: None,
                connection_factory: None,
                on_event: options.on_event.clone(),
                on_exit: options.on_exit.clone(),
                on_session_persisted: options.on_session_persisted.clone(),
                standby: standby_for_adapter.clone(),
                fast_model_list_timeout_ms: None,
            })
        }),
        dispose,
    }
}
