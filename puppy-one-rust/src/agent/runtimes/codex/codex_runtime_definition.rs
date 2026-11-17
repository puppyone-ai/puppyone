//! `runtimes/codex/codex-runtime-definition.mjs`.
use super::codex_app_server_adapter::{CodexAdapterOptions, CodexAppServerAdapter};
use super::codex_discovery::{CodexDiscoveryOptions, create_codex_discovery};
use super::codex_identity::CODEX_RUNTIME_MANIFEST;
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
            })
        }),
        dispose: None,
    }
}
