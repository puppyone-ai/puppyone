//! `local-agent-installation/installation-registry.mjs`: installation
//! discovery consumes a projection, never setup or runtime work.
use super::definitions::{claude, codex, cursor, hermes, opencode, pi, workbuddy};
use super::installation_definition::{InstallationDefinition, define_local_agent_installation};
use crate::agent::agent_error::{AgentError, AgentResult};
use std::sync::{Arc, LazyLock};

/// A validated registry.
pub type InstallationRegistry = Arc<Vec<InstallationDefinition>>;

/// `createLocalAgentInstallationRegistry(definitions)`.
pub fn create_local_agent_installation_registry(
    definitions: Vec<InstallationDefinition>,
) -> AgentResult<InstallationRegistry> {
    let mut registry: Vec<InstallationDefinition> = Vec::new();
    for definition in definitions {
        let installation = define_local_agent_installation(definition)?;
        if registry.iter().any(|entry| entry.id == installation.id) {
            return Err(AgentError::new(format!(
                "Duplicate Local Agent installation id: {}",
                installation.id
            )));
        }
        registry.push(installation);
    }
    Ok(Arc::new(registry))
}

/// The catalog's installation projection, in `defaultLocalAgentCatalog` order.
pub fn default_installation_definitions() -> Vec<InstallationDefinition> {
    vec![
        codex::codex_installation_definition(),
        claude::claude_installation_definition(),
        cursor::cursor_installation_definition(),
        opencode::opencode_installation_definition(),
        pi::pi_installation_definition(),
        workbuddy::work_buddy_china_installation_definition(),
        workbuddy::work_buddy_international_installation_definition(),
        hermes::hermes_installation_definition(),
    ]
}

/// `defaultLocalAgentInstallationRegistry`.
pub static DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY: LazyLock<InstallationRegistry> =
    LazyLock::new(|| {
        create_local_agent_installation_registry(default_installation_definitions())
            .expect("the product installation definitions are valid")
    });

/// `getLocalAgentInstallationDefinition(agentId, registry)`.
pub fn get_local_agent_installation_definition<'a>(
    agent_id: &str,
    registry: &'a [InstallationDefinition],
) -> Option<&'a InstallationDefinition> {
    registry.iter().find(|definition| definition.id == agent_id)
}
