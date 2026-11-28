//! `runtimes/claude/claude-history-reader.mjs`.
use super::claude_agent_sdk::{ClaudeSdk, SessionMessagesOptions};
use super::claude_events::normalize_claude_history;
use crate::agent::agent_error::AgentResult;
use crate::agent::runtime::agent_history_read_result::agent_history_read_result;
use serde_json::json;

/// `readClaudeHistory({ sdk, workspaceRoot, providerSessionId })`.
pub async fn read_claude_history(
    sdk: &dyn ClaudeSdk,
    workspace_root: &str,
    provider_session_id: Option<&str>,
) -> AgentResult<serde_json::Value> {
    let session_id = provider_session_id.unwrap_or("");
    let messages = sdk
        .get_session_messages(
            session_id,
            SessionMessagesOptions {
                dir: Some(workspace_root.to_string()),
                limit: Some(1_000),
                offset: None,
                include_system_messages: false,
            },
        )
        .await?;
    let partial = messages.len() >= 1_000;
    agent_history_read_result(&json!({
        "providerSessionId": provider_session_id,
        "events": normalize_claude_history(&messages, session_id),
        "coverage": if partial { "partial" } else { "complete" },
        "reason": if partial { Some("read-limit") } else { None },
    }))
}
