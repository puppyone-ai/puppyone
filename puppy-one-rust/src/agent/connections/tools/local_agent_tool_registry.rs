//! `connections/tools/local-agent-tool-registry.mjs`: validated local
//! Agent tool descriptors over the installation definitions.
use super::claude_tool::claude_local_tool;
use super::codex_tool::codex_local_tool;
use super::cursor_tool::cursor_local_tool;
use super::opencode_tool::opencode_local_tool;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::event_loop::AbortSignal;
use crate::agent::installation::executable_resolver::ResolvedCandidate;
use crate::agent::installation::installation_definition::NameSpec;
use crate::agent::installation::installation_registry::{
    DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY, get_local_agent_installation_definition,
};
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::LazyLock;

static TOOL_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9._-]{0,79}$").expect("pattern"));

/// `probe({ candidate, appVersion, workspaceRoot, env, signal })`.
pub struct LocalToolProbeRequest {
    pub candidate: Option<ResolvedCandidate>,
    pub app_version: String,
    pub workspace_root: Option<String>,
    pub env: EnvMap,
    pub signal: AbortSignal,
}

/// A tool's probe: its evidence for `deriveLocalConnection`.
pub type LocalToolProbe =
    Rc<dyn Fn(LocalToolProbeRequest) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// A local Agent tool descriptor.
#[derive(Clone)]
pub struct LocalAgentToolDescriptor {
    pub id: String,
    pub installation_id: Option<String>,
    pub display_name: String,
    /// A custom installation's executable names (no installation definition).
    pub executable_names: Option<Vec<String>>,
    pub probe: Option<LocalToolProbe>,
    pub unavailable_message: String,
}

/// A registered tool.
#[derive(Clone)]
pub struct LocalAgentTool {
    pub id: String,
    pub installation_id: String,
    pub display_name: String,
    pub executable_names: Vec<String>,
    pub probe: LocalToolProbe,
    pub unavailable_message: String,
}

/// `DEFAULT_LOCAL_AGENT_TOOLS`.
pub fn local_agent_tool_registry_defaults() -> Vec<LocalAgentToolDescriptor> {
    vec![
        codex_local_tool(),
        claude_local_tool(),
        cursor_local_tool(),
        opencode_local_tool(),
    ]
}

fn name_of(spec: &NameSpec) -> String {
    let NameSpec::Text(name) = spec;
    name.clone()
}

/// `createLocalAgentToolRegistry(descriptors)`.
pub fn create_local_agent_tool_registry(
    descriptors: Option<Vec<LocalAgentToolDescriptor>>,
) -> AgentResult<Vec<LocalAgentTool>> {
    let descriptors = descriptors.unwrap_or_else(local_agent_tool_registry_defaults);
    let mut seen = HashSet::new();
    descriptors
        .into_iter()
        .map(|descriptor| {
            let probe = validate_descriptor(&descriptor)?;
            if !seen.insert(descriptor.id.clone()) {
                return Err(AgentError::new(format!(
                    "Duplicate local Agent tool descriptor: {}",
                    descriptor.id
                )));
            }
            let installation_id = descriptor.installation_id.clone().unwrap_or_else(|| {
                if descriptor.id == "cursor-agent" {
                    "cursor".into()
                } else {
                    descriptor.id.clone()
                }
            });
            let executable_names = match get_local_agent_installation_definition(
                &installation_id,
                &DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY,
            ) {
                Some(definition) => definition.executable_names.iter().map(name_of).collect(),
                None => descriptor
                    .executable_names
                    .clone()
                    .filter(|names| !names.is_empty())
                    .ok_or_else(|| {
                        AgentError::new(format!(
                            "Unknown Local Agent installation definition: {installation_id}"
                        ))
                    })?,
            };
            Ok(LocalAgentTool {
                id: descriptor.id,
                installation_id,
                display_name: descriptor.display_name,
                executable_names,
                probe,
                unavailable_message: descriptor.unavailable_message,
            })
        })
        .collect()
}

fn validate_descriptor(descriptor: &LocalAgentToolDescriptor) -> AgentResult<LocalToolProbe> {
    let type_error = |message: String| AgentError::new(message).with_name("TypeError");
    if !TOOL_ID.is_match(&descriptor.id) {
        return Err(type_error(
            "Local Agent tool descriptor id is invalid.".into(),
        ));
    }
    if descriptor.display_name.trim().is_empty() {
        return Err(type_error(format!(
            "Local Agent tool {} requires a display name.",
            descriptor.id
        )));
    }
    let Some(probe) = descriptor.probe.clone() else {
        return Err(type_error(format!(
            "Local Agent tool {} requires a probe.",
            descriptor.id
        )));
    };
    if descriptor.unavailable_message.trim().is_empty() {
        return Err(type_error(format!(
            "Local Agent tool {} requires an unavailable-state message.",
            descriptor.id
        )));
    }
    Ok(probe)
}
