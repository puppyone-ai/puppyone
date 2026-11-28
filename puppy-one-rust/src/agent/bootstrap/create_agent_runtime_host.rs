//! `bootstrap/create-agent-runtime-host.mjs`: the only production
//! composition root that imports concrete Agent runtimes.
use crate::agent::agent_error::AgentResult;
use crate::agent::discovery::command_environment::CachedCommandEnvironment;
use crate::agent::protocols::acp::acp_runtime_adapter::Logger;
use crate::agent::protocols::acp::acp_standby::AcpStandbyPool;
use crate::agent::runtime::agent_runtime_registry::{
    AgentRuntimeHost, AgentRuntimeRegistry, RuntimeDiscovery,
};
use crate::agent::runtimes::claude::claude_discovery::{
    ClaudeDiscoveryOptions, create_claude_discovery, default_sdk_loader,
};
use crate::agent::runtimes::claude::claude_runtime_definition::{
    ClaudeRuntimeDefinitionOptions, create_claude_runtime_definition,
};
use crate::agent::runtimes::codex::codex_discovery::{
    CodexDiscoveryOptions, create_codex_discovery,
};
use crate::agent::runtimes::codex::codex_runtime_definition::create_codex_runtime_definition_with_standby;
use crate::agent::runtimes::codex::codex_standby::CodexStandbyPool;
use crate::agent::runtimes::cursor::cursor_discovery::{
    CursorDiscoveryOptions, create_cursor_discovery,
};
use crate::agent::runtimes::cursor::cursor_runtime_definition::create_cursor_runtime_definition_with_standby;
use crate::agent::runtimes::hermes::hermes_discovery::{
    HermesDiscoveryOptions, create_hermes_discovery,
};
use crate::agent::runtimes::hermes::hermes_runtime_definition::create_hermes_runtime_definition_with_standby;
use crate::agent::runtimes::opencode_native::opencode_native_discovery::{
    OpenCodeDiscoveryOptions, create_user_open_code_discovery,
};
use crate::agent::runtimes::opencode_native::opencode_native_runtime_definition::create_open_code_native_runtime_definition;
use crate::agent::runtimes::pi::pi_discovery::{PiDiscoveryOptions, create_pi_discovery};
use crate::agent::runtimes::pi::pi_runtime_definition::create_pi_runtime_definition;
use crate::agent::runtimes::puppyone_agent::model_connection_binding::ModelConnectionPort;
use crate::agent::runtimes::puppyone_agent::puppyone_agent_runtime_definition::{
    PuppyOneRuntimeDefinitionOptions, create_puppyone_agent_runtime_definition,
};
use crate::agent::runtimes::workbuddy::workbuddy_channels::{
    WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL,
};
use crate::agent::runtimes::workbuddy::workbuddy_discovery::{
    WorkBuddyDiscoveryOptions, create_work_buddy_discovery,
};
use crate::agent::runtimes::workbuddy::workbuddy_runtime_definition::create_work_buddy_runtime_definition_with_standby;
use std::rc::Rc;

/// `DEFAULT_AGENT_RUNTIME_ID`.
pub const DEFAULT_AGENT_RUNTIME_ID: &str = "codex";

/// `createDefaultAgentRuntimeHost({ … })`: per-runtime overrides are their
/// discoveries (`codex: { discovery }`, …).
#[derive(Clone, Default)]
pub struct DefaultRuntimeHostOptions {
    pub logger: Option<Logger>,
    pub app_version: Option<String>,
    pub app_path: Option<String>,
    pub user_data_path: Option<String>,
    pub executable_path: Option<String>,
    /// Shared single-flight login-shell environment cache across external CLIs
    /// (ADR-024); invalidated on explicit `discover(true, ..)`.
    pub command_environment: Option<CachedCommandEnvironment>,
    pub codex: Option<Rc<dyn RuntimeDiscovery>>,
    pub claude: Option<Rc<dyn RuntimeDiscovery>>,
    pub cursor: Option<Rc<dyn RuntimeDiscovery>>,
    pub open_code_native: Option<Rc<dyn RuntimeDiscovery>>,
    pub pi: Option<Rc<dyn RuntimeDiscovery>>,
    pub work_buddy_china: Option<Rc<dyn RuntimeDiscovery>>,
    pub work_buddy_international: Option<Rc<dyn RuntimeDiscovery>>,
    pub hermes: Option<Rc<dyn RuntimeDiscovery>>,
    pub puppyone_agent: Option<Rc<dyn RuntimeDiscovery>>,
    pub model_connection_port: Option<Rc<dyn ModelConnectionPort>>,
    /// The Built-in Agent's kernel launcher (the native kernel).
    pub puppyone_agent_spawner: Option<crate::agent::transports::jsonl_rpc_connection::Spawner>,
}

/// `createDefaultAgentRuntimeHost(options)`.
pub fn create_default_agent_runtime_host(
    options: DefaultRuntimeHostOptions,
) -> AgentResult<AgentRuntimeHost> {
    let app_version = options.app_version.as_deref();
    let logger = options.logger.clone();
    let env_cache = options
        .command_environment
        .clone()
        .unwrap_or_else(|| CachedCommandEnvironment::new(None, None, None));
    let shared_env = env_cache.as_read_environment();
    let codex_discovery = options.codex.clone().or_else(|| {
        Some(Rc::new(create_codex_discovery(
            CodexDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let claude_discovery = options.claude.clone().or_else(|| {
        Some(Rc::new(create_claude_discovery(
            ClaudeDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                sdk_loader: Some(default_sdk_loader()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let opencode_discovery = options.open_code_native.clone().or_else(|| {
        Some(Rc::new(create_user_open_code_discovery(
            OpenCodeDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let pi_discovery = options.pi.clone().or_else(|| {
        Some(Rc::new(create_pi_discovery(
            PiDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let cursor_discovery = options.cursor.clone().or_else(|| {
        Some(Rc::new(create_cursor_discovery(
            CursorDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let workbuddy_cn_discovery = options.work_buddy_china.clone().or_else(|| {
        Some(Rc::new(create_work_buddy_discovery(
            WORKBUDDY_CHINA_CHANNEL,
            WorkBuddyDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let workbuddy_intl_discovery = options.work_buddy_international.clone().or_else(|| {
        Some(Rc::new(create_work_buddy_discovery(
            WORKBUDDY_INTERNATIONAL_CHANNEL,
            WorkBuddyDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let hermes_discovery = options.hermes.clone().or_else(|| {
        Some(Rc::new(create_hermes_discovery(
            HermesDiscoveryOptions {
                read_environment: Some(shared_env.clone()),
                ..Default::default()
            },
            None,
        )) as Rc<dyn RuntimeDiscovery>)
    });
    let codex_model_cache_path = options.user_data_path.as_deref().map(|root| {
        std::path::PathBuf::from(root)
            .join("agent-runtime")
            .join("codex-models-cache.json")
    });
    let codex_standby = CodexStandbyPool::new(codex_model_cache_path);
    let acp_standby = AcpStandbyPool::new();
    let definitions = vec![
        create_codex_runtime_definition_with_standby(
            app_version,
            codex_discovery,
            None,
            Some(codex_standby.clone()),
        ),
        create_claude_runtime_definition(ClaudeRuntimeDefinitionOptions {
            app_version: options.app_version.clone(),
            discovery: claude_discovery,
            logger: logger.clone(),
            ..Default::default()
        }),
        create_open_code_native_runtime_definition(opencode_discovery, logger.clone(), app_version),
        create_pi_runtime_definition(pi_discovery),
        create_cursor_runtime_definition_with_standby(
            cursor_discovery,
            logger.clone(),
            app_version,
            Some(acp_standby.clone()),
        ),
        create_work_buddy_runtime_definition_with_standby(
            WORKBUDDY_CHINA_CHANNEL,
            workbuddy_cn_discovery,
            logger.clone(),
            app_version,
            Some(acp_standby.clone()),
        ),
        create_work_buddy_runtime_definition_with_standby(
            WORKBUDDY_INTERNATIONAL_CHANNEL,
            workbuddy_intl_discovery,
            logger.clone(),
            app_version,
            Some(acp_standby.clone()),
        ),
        create_hermes_runtime_definition_with_standby(
            hermes_discovery,
            logger.clone(),
            app_version,
            Some(acp_standby.clone()),
        ),
        create_puppyone_agent_runtime_definition(PuppyOneRuntimeDefinitionOptions {
            app_path: options.app_path.clone(),
            user_data_path: options.user_data_path.clone(),
            executable_path: options.executable_path.clone(),
            model_connection_port: options.model_connection_port.clone(),
            discovery: options.puppyone_agent.clone(),
            adapter_factory: None,
            spawner: options.puppyone_agent_spawner.clone(),
        }),
    ];
    let registry = AgentRuntimeRegistry::new(definitions, Some(DEFAULT_AGENT_RUNTIME_ID), None)?;
    registry.set_on_refresh(Rc::new(move || {
        env_cache.invalidate();
        codex_standby.evict_all();
        acp_standby.evict_all();
    }));
    Ok(registry)
}

#[cfg(test)]
mod tests;
