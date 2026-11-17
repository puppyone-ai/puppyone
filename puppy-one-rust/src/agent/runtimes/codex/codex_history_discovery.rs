//! `runtimes/codex/codex-history-discovery.mjs`: Codex's native metadata
//! list; never scans rollout files or mutates a live thread.
use super::codex_history_reader::CodexRequest;
use super::codex_native_values::{string_or_null, to_iso_from_seconds};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::history_schema::{
    history_cursor, history_locators, history_native_id, history_page_size,
};
use crate::agent::tasks::CancelSignal;
use serde_json::{Value, json};

/// `discoverCodexHistory({ request, workspaceRoot }, { cursor, limit, signal })`.
pub async fn discover_codex_history(
    request: &CodexRequest,
    workspace_root: &str,
    cursor: Option<&str>,
    limit: Option<&Value>,
    signal: Option<&CancelSignal>,
) -> AgentResult<Value> {
    if let Some(signal) = signal {
        signal.check()?;
    }
    let page_size = history_page_size(limit);
    let cursor = history_cursor(cursor.map(Value::from).as_ref())?;
    let result = request(
        "thread/list",
        json!({
            "cwd": workspace_root,
            "cursor": cursor,
            "limit": page_size,
            "archived": false,
            "sortKey": "updated_at",
            "sortDirection": "desc",
            "useStateDbOnly": true,
        }),
    )
    .await?;
    if let Some(signal) = signal {
        signal.check()?;
    }
    let invalid = || {
        AgentError::new("Codex history returned an invalid session page.").with_name("TypeError")
    };
    let data = result
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if data.len() > page_size
        || data
            .iter()
            .any(|thread| history_native_id(thread.get("id")).is_none())
    {
        return Err(invalid());
    }
    let locators: Vec<Value> = data
        .iter()
        .filter(|thread| {
            !crate::agent::contract::js::truthy_opt(thread.get("ephemeral"))
                && thread.get("cwd").and_then(Value::as_str) == Some(workspace_root)
        })
        .map(|thread| {
            let title = string_or_null(thread.get("name"))
                .or_else(|| string_or_null(thread.get("preview")))
                .unwrap_or("Codex session");
            json!({
                "providerSessionId": thread["id"],
                "title": title,
                "createdAt": to_iso_from_seconds(thread.get("createdAt")),
                "updatedAt": to_iso_from_seconds(thread.get("updatedAt")),
                "selectedProviderId": string_or_null(thread.get("modelProvider")),
            })
        })
        .collect();
    Ok(json!({
        "supported": true,
        "sessions": history_locators(Some(&Value::Array(locators)), Some(page_size))?,
        "nextCursor": history_cursor(result.get("nextCursor"))?,
        // The metadata index is not a consistent snapshot of every native conversation.
        "coverage": { "scopeComplete": false, "snapshotId": null },
    }))
}
