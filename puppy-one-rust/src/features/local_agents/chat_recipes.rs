//! The Agent Chat recipes of local Agents (`localAgentCatalog.ts`'s
//! `localAgentIdForAgentChatRuntime` and `agentChatCreationRecipes.ts`): which
//! chat runtime a detected installation starts, and which runtimes hiding a
//! local Agent hides.
use crate::agent::connections::legacy_local_agent_inventory::Installation;

/// `BUILT_IN_AGENT_RUNTIME_ID`.
const BUILT_IN_AGENT_RUNTIME_ID: &str = "puppyone-agent";

/// `LOCAL_AGENT_CHAT_RECIPES`' runtime ids.
const LOCAL_AGENT_CHAT_RUNTIME_IDS: [&str; 8] = [
    "claude",
    "codex",
    "cursor",
    "hermes",
    "opencode-native",
    "pi",
    "workbuddy-china",
    "workbuddy-international",
];

/// `localAgentIdForAgentChatRuntime(runtimeId)`.
fn local_agent_id_for_agent_chat_runtime(runtime_id: &str) -> &str {
    match runtime_id {
        "opencode-native" => "opencode",
        id => id,
    }
}

/// The Chat recipe (runtime id) of a detected installation.
pub fn agent_chat_runtime_id(installation: &Installation) -> String {
    if installation.bundled() {
        return BUILT_IN_AGENT_RUNTIME_ID.into();
    }
    LOCAL_AGENT_CHAT_RUNTIME_IDS
        .into_iter()
        .find(|id| local_agent_id_for_agent_chat_runtime(id) == installation.id)
        .unwrap_or(installation.id)
        .into()
}

/// `resolveAgentChatRuntimeVisibility(...).hiddenRuntimeIds`: the Built-in
/// Agent is never hidden.
pub fn hidden_agent_chat_runtime_ids(hidden_local_agent_ids: &[String]) -> Vec<String> {
    LOCAL_AGENT_CHAT_RUNTIME_IDS
        .into_iter()
        .filter(|id| {
            hidden_local_agent_ids
                .iter()
                .any(|hidden| hidden == local_agent_id_for_agent_chat_runtime(id))
        })
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        BUILT_IN_AGENT_RUNTIME_ID, hidden_agent_chat_runtime_ids,
        local_agent_id_for_agent_chat_runtime,
    };

    #[test]
    fn hidden_local_agents_hide_their_chat_runtimes_but_never_the_built_in() {
        assert_eq!(
            hidden_agent_chat_runtime_ids(&[
                "opencode".into(),
                "codex".into(),
                BUILT_IN_AGENT_RUNTIME_ID.into()
            ]),
            ["codex", "opencode-native"]
        );
        assert!(hidden_agent_chat_runtime_ids(&[]).is_empty());
        assert_eq!(
            local_agent_id_for_agent_chat_runtime("workbuddy-china"),
            "workbuddy-china"
        );
    }
}
