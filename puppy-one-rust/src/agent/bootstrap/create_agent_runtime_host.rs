//! `bootstrap/create-agent-runtime-host.mjs`: the only production
//! composition root that imports concrete Agent runtimes.
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::acp::acp_runtime_adapter::Logger;
use crate::agent::runtime::agent_runtime_registry::{
    AgentRuntimeHost, AgentRuntimeRegistry, RuntimeDiscovery,
};
use crate::agent::runtimes::claude::claude_runtime_definition::{
    ClaudeRuntimeDefinitionOptions, create_claude_runtime_definition,
};
use crate::agent::runtimes::codex::codex_runtime_definition::create_codex_runtime_definition;
use crate::agent::runtimes::cursor::cursor_runtime_definition::create_cursor_runtime_definition;
use crate::agent::runtimes::hermes::hermes_runtime_definition::create_hermes_runtime_definition;
use crate::agent::runtimes::opencode_native::opencode_native_runtime_definition::create_open_code_native_runtime_definition;
use crate::agent::runtimes::pi::pi_runtime_definition::create_pi_runtime_definition;
use crate::agent::runtimes::puppyone_agent::model_connection_binding::ModelConnectionPort;
use crate::agent::runtimes::puppyone_agent::puppyone_agent_runtime_definition::{
    PuppyOneRuntimeDefinitionOptions, create_puppyone_agent_runtime_definition,
};
use crate::agent::runtimes::workbuddy::workbuddy_channels::{
    WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL,
};
use crate::agent::runtimes::workbuddy::workbuddy_runtime_definition::create_work_buddy_runtime_definition;
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
    let definitions = vec![
        create_codex_runtime_definition(app_version, options.codex.clone(), None),
        create_claude_runtime_definition(ClaudeRuntimeDefinitionOptions {
            app_version: options.app_version.clone(),
            discovery: options.claude.clone(),
            logger: logger.clone(),
            ..Default::default()
        }),
        create_open_code_native_runtime_definition(
            options.open_code_native.clone(),
            logger.clone(),
            app_version,
        ),
        create_pi_runtime_definition(options.pi.clone()),
        create_cursor_runtime_definition(options.cursor.clone(), None, None),
        create_work_buddy_runtime_definition(
            WORKBUDDY_CHINA_CHANNEL,
            options.work_buddy_china.clone(),
            logger.clone(),
            app_version,
        ),
        create_work_buddy_runtime_definition(
            WORKBUDDY_INTERNATIONAL_CHANNEL,
            options.work_buddy_international.clone(),
            logger.clone(),
            app_version,
        ),
        create_hermes_runtime_definition(options.hermes.clone(), logger.clone(), app_version),
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
    AgentRuntimeRegistry::new(definitions, Some(DEFAULT_AGENT_RUNTIME_ID), None)
}

#[cfg(test)]
mod tests;
