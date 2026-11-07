//! `protocols/acp/acp-history-discovery.mjs`: shared ACP list semantics.
//! Connection ownership remains with the querying adapter.
use super::acp_client::AcpClient;
use super::acp_native_values::normalize_date;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::history_schema::{
    history_cursor, history_locators, history_native_id, limits,
};
use crate::agent::contract::js::{self, Obj};
use crate::agent::tasks::CancelSignal;
use crate::clock;
use crate::platform::paths;
use serde_json::{Value, json};

/// `discoverAcpHistory({ client, workspaceRoot, fallbackTitle }, { cursor, signal })`.
pub async fn discover_acp_history(
    client: &AcpClient,
    workspace_root: &str,
    fallback_title: &str,
    cursor: Option<&str>,
    signal: Option<&CancelSignal>,
) -> AgentResult<Value> {
    if let Some(signal) = signal {
        signal.check()?;
    }
    let capabilities = client.agent_capabilities().unwrap_or_else(|| json!({}));
    let list = capabilities
        .get("sessionCapabilities")
        .and_then(|c| c.get("list"));
    if js::nullish(list) && capabilities.get("listSessions") != Some(&Value::Bool(true)) {
        return Ok(json!({ "supported": false, "sessions": [], "nextCursor": null }));
    }
    // ACP chooses page size; the UI limit is only a hint for protocols that support it.
    let page_size = limits::NATIVE_PAGE;
    let token = history_cursor(cursor.map(Value::from).as_ref())?;
    let page = client
        .list_sessions(
            Obj::new()
                .set("cwd", workspace_root)
                .opt("cursor", token)
                .build(),
        )
        .await?;
    if let Some(signal) = signal {
        signal.check()?;
    }
    let invalid =
        || AgentError::new("ACP history returned an invalid session page.").with_name("TypeError");
    let sessions = page
        .get("sessions")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if sessions.len() > page_size
        || sessions
            .iter()
            .any(|entry| history_native_id(entry.get("sessionId")).is_none())
    {
        return Err(invalid());
    }
    let workspace = paths::absolute(workspace_root);
    let locators: Vec<Value> = sessions
        .iter()
        .filter(|entry| match entry.get("cwd").filter(|cwd| js::truthy(cwd)) {
            None => true,
            Some(cwd) => cwd
                .as_str()
                .is_some_and(|cwd| paths::absolute(cwd) == workspace),
        })
        .map(|entry| {
            let updated = entry.get("updatedAt").filter(|v| !v.is_null());
            let title = entry
                .get("title")
                .filter(|t| js::truthy(t))
                .cloned()
                .unwrap_or_else(|| Value::from(fallback_title));
            json!({
                "providerSessionId": entry["sessionId"],
                "title": title,
                "createdAt": normalize_date(entry.get("createdAt").filter(|v| !v.is_null()).or(updated)),
                "updatedAt": match updated {
                    None => Some(clock::iso_string(0)),
                    Some(updated) => normalize_date(Some(updated)),
                },
                "updatedAtKnown": updated.is_some(),
            })
        })
        .collect();
    Ok(json!({
        "supported": true,
        "sessions": history_locators(Some(&Value::Array(locators)), Some(page_size))?,
        "nextCursor": history_cursor(page.get("nextCursor"))?,
        "coverage": { "scopeComplete": false, "snapshotId": null },
    }))
}
