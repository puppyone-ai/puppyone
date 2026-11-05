//! `domain/agent-chat-history-target.ts`.
use serde_json::{Value, json};

/// `AgentChatHistoryPayload`.
#[derive(Clone, Debug, PartialEq, Eq)]
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
    pub payload: Value,
}

/// `createAgentChatHistoryTarget(session)`.
pub fn create_agent_chat_history_target(session: &Value) -> AuxiliaryWorkbenchHistoryTarget {
    let non_empty = |value: &Value| value.as_str().filter(|v| !v.is_empty()).map(str::to_string);
    let runtime_id = non_empty(&session["runtimeId"])
        .or_else(|| non_empty(&session["runtime"]["id"]))
        .unwrap_or_default();
    let id = session["id"].as_str().unwrap_or_default().to_string();
    AuxiliaryWorkbenchHistoryTarget {
        id: id.clone(),
        title: session["title"].as_str().unwrap_or_default().to_string(),
        icon_key: non_empty(&session["runtime"]["iconKey"])
            .or_else(|| Some(runtime_id.clone()).filter(|r| !r.is_empty())),
        payload: json!({ "kind": "agent-session", "runtimeId": runtime_id, "sessionId": id }),
    }
}

/// `parseAgentChatHistoryTarget(target)`.
pub fn parse_agent_chat_history_target(
    target: &AuxiliaryWorkbenchHistoryTarget,
) -> Option<AgentChatHistoryPayload> {
    let payload = target.payload.as_object()?;
    if payload.get("kind").and_then(Value::as_str) != Some("agent-session") {
        return None;
    }
    let runtime_id = payload
        .get("runtimeId")?
        .as_str()
        .filter(|r| !r.is_empty())?;
    let session_id = payload
        .get("sessionId")?
        .as_str()
        .filter(|s| !s.is_empty())?;
    Some(AgentChatHistoryPayload {
        runtime_id: runtime_id.to_string(),
        session_id: session_id.to_string(),
    })
}
