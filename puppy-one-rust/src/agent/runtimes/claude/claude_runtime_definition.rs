//! `runtimes/claude/claude-runtime-definition.mjs`.
use super::claude_agent_sdk_adapter::{ClaudeAdapterOptions, ClaudeAgentSdkAdapter, Logger};
use super::claude_discovery::{
    ClaudeDiscoveryOptions, SdkLoader, create_claude_discovery, default_sdk_loader,
};
use super::claude_identity::CLAUDE_RUNTIME_MANIFEST;
use crate::agent::agent_error::AgentResult;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use std::rc::Rc;

/// `adapterFactory(options)`.
pub type ClaudeAdapterFactory =
    Rc<dyn Fn(ClaudeAdapterOptions) -> AgentResult<Rc<dyn AgentRuntimeAdapter>>>;

/// `createClaudeRuntimeDefinition({ appVersion, sdkLoader, discovery, adapterFactory, logger })`.
#[derive(Clone, Default)]
pub struct ClaudeRuntimeDefinitionOptions {
    pub app_version: Option<String>,
    pub sdk_loader: Option<SdkLoader>,
    pub discovery: Option<Rc<dyn RuntimeDiscovery>>,
    pub adapter_factory: Option<ClaudeAdapterFactory>,
    pub logger: Option<Logger>,
}

/// `createClaudeRuntimeDefinition(options)`.
pub fn create_claude_runtime_definition(
    options: ClaudeRuntimeDefinitionOptions,
) -> RuntimeDefinition {
    let app_version = options.app_version.unwrap_or_else(|| "0.0.0".into());
    let sdk_loader = options.sdk_loader.unwrap_or_else(default_sdk_loader);
    let discovery = options.discovery.unwrap_or_else(|| {
        Rc::new(create_claude_discovery(
            ClaudeDiscoveryOptions {
                sdk_loader: Some(sdk_loader.clone()),
                ..Default::default()
            },
            None,
        ))
    });
    let factory = options.adapter_factory.unwrap_or_else(|| {
        Rc::new(|options| {
            Ok(Rc::new(ClaudeAgentSdkAdapter::new(options)) as Rc<dyn AgentRuntimeAdapter>)
        })
    });
    let logger = options.logger;
    RuntimeDefinition {
        manifest: CLAUDE_RUNTIME_MANIFEST.clone(),
        discovery,
        create_adapter: Rc::new(move |options| {
            let mut claude =
                ClaudeAdapterOptions::new(options.readiness.clone(), &options.workspace_root);
            claude.on_event = options.on_event.clone();
            claude.on_exit = options.on_exit.clone();
            claude.on_session_persisted = options.on_session_persisted.clone();
            claude.app_version = app_version.clone();
            claude.sdk_loader = Some(sdk_loader.clone());
            claude.logger = logger.clone();
            factory(claude)
        }),
        dispose: None,
        has_active_resources: None,
    }
}
