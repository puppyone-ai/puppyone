//! `runtimes/claude/claude-history-discovery.mjs`: pages of the Agent SDK's
//! native session metadata for the workspace.
use super::claude_agent_sdk::{ClaudeSdk, ListSessionsOptions};
use super::claude_native_values::normalize_date;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::history_schema::{
    history_cursor, history_locators, history_native_id, history_page_size,
};
use crate::agent::contract::js;
use crate::agent::tasks::CancelSignal;
use crate::platform::paths;
use serde_json::{Value, json};

/// `discoverClaudeHistory({ sdk, workspaceRoot }, { cursor, limit, signal })`.
pub async fn discover_claude_history(
    sdk: &dyn ClaudeSdk,
    workspace_root: &str,
    cursor: Option<&str>,
    limit: Option<&Value>,
    signal: Option<&CancelSignal>,
) -> AgentResult<Value> {
    if let Some(signal) = signal {
        signal.check()?;
    }
    if !sdk.implements("listSessions") {
        return Ok(json!({ "supported": false, "sessions": [], "nextCursor": null }));
    }
    let token = history_cursor(cursor.map(Value::from).as_ref())?;
    let offset = match token.as_deref() {
        None => 0,
        Some(token) => match token.parse::<u64>() {
            Ok(offset)
                if token.bytes().all(|b| b.is_ascii_digit())
                    && offset <= js::MAX_SAFE_INTEGER as u64 =>
            {
                offset as usize
            }
            _ => {
                return Err(AgentError::new(
                    "Claude history continuation is invalid. Refresh history.",
                )
                .with_name("TypeError")
                .with_retryable(false));
            }
        },
    };
    let page_size = history_page_size(limit);
    let page = sdk
        .list_sessions(ListSessionsOptions {
            dir: Some(workspace_root.to_string()),
            limit: Some(page_size),
            offset: Some(offset),
            include_worktrees: None,
        })
        .await?;
    if let Some(signal) = signal {
        signal.check()?;
    }
    if page.len() > page_size
        || page
            .iter()
            .any(|entry| history_native_id(entry.get("sessionId")).is_none())
    {
        return Err(
            AgentError::new("Claude history returned an invalid session page.")
                .with_name("TypeError"),
        );
    }
    let root = paths::absolute(workspace_root);
    let locators: Vec<Value> = page
        .iter()
        .filter(|entry| {
            entry
                .get("cwd")
                .filter(|cwd| js::truthy(cwd))
                .is_none_or(|cwd| paths::absolute(js::to_js_string(Some(cwd))) == root)
        })
        .map(|entry| {
            let title = ["customTitle", "summary", "firstPrompt"]
                .iter()
                .find_map(|key| entry.get(*key).filter(|v| js::truthy(v)).cloned())
                .unwrap_or_else(|| Value::from("Claude Code session"));
            let created = entry
                .get("createdAt")
                .filter(|v| !v.is_null())
                .or(entry.get("lastModified"));
            json!({
                "providerSessionId": entry["sessionId"],
                "title": title,
                "createdAt": normalize_date(created),
                "updatedAt": normalize_date(entry.get("lastModified")),
            })
        })
        .collect();
    Ok(json!({
        "supported": true,
        "sessions": history_locators(Some(&Value::Array(locators)), Some(page_size))?,
        // Advance by the raw SDK page, even if workspace filtering removed
        // every entry.
        "nextCursor": (page.len() == page_size).then(|| (offset + page.len()).to_string()),
        "coverage": { "scopeComplete": false, "snapshotId": null },
    }))
}
