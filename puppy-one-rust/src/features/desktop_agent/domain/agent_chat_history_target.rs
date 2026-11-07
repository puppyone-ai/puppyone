//! `domain/agent-chat-history-target.ts`.
use crate::agent::contract::dto::SessionMetadata;

/// `AgentChatHistoryPayload`: an `agent-session` history target's payload.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentChatHistoryPayload {
    pub runtime_id: String,
    pub session_id: String,
}

/// `AuxiliaryWorkbenchHistoryTarget`.
#[derive(Clone, Debug, PartialEq)]
pub struct AuxiliaryWorkbenchHistoryTarget {
    pub id: String,
    pub title: String,
    pub icon_key: Option<String>,
    pub payload: AgentChatHistoryPayload,
}

/// `createAgentChatHistoryTarget(session)`.
pub fn create_agent_chat_history_target(
    session: &SessionMetadata,
) -> AuxiliaryWorkbenchHistoryTarget {
    let non_empty = |value: Option<&str>| value.filter(|v| !v.is_empty()).map(str::to_string);
    let runtime = session.runtime.as_ref();
    let runtime_id = non_empty(session.runtime_id.as_deref())
        .or_else(|| non_empty(runtime.map(|r| r.id.as_str())))
        .unwrap_or_default();
    AuxiliaryWorkbenchHistoryTarget {
        id: session.id.clone(),
        title: session.title.clone(),
        icon_key: non_empty(runtime.and_then(|r| r.icon_key.as_deref()))
            .or_else(|| Some(runtime_id.clone()).filter(|r| !r.is_empty())),
        payload: AgentChatHistoryPayload {
            runtime_id,
            session_id: session.id.clone(),
        },
    }
}

/// `parseAgentChatHistoryTarget(target)`: the conversation a target opens,
/// when it names one.
pub fn parse_agent_chat_history_target(
    target: &AuxiliaryWorkbenchHistoryTarget,
) -> Option<AgentChatHistoryPayload> {
    let payload = &target.payload;
    (!payload.runtime_id.is_empty() && !payload.session_id.is_empty()).then(|| payload.clone())
}
