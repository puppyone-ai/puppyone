//! `runtimes/puppyone-agent/puppyone-agent-approval.mjs`: decode only the
//! private, versioned approval request the bundled worker emits.
use super::puppyone_agent_kernel::PUPPYONE_AGENT_APPROVAL_PROTOCOL;
use crate::agent::contract::js;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

static SAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("pattern"));

fn bounded(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|text| js::head16(js::trim(text), limit).to_string())
        .unwrap_or_default()
}

/// `parsePuppyOneAgentApprovalRequest(message)`.
pub fn parse_puppyone_agent_approval_request(message: &Value) -> Option<Value> {
    if message.get("method").and_then(Value::as_str) != Some("confirm")
        || message.get("title").and_then(Value::as_str) != Some(PUPPYONE_AGENT_APPROVAL_PROTOCOL)
    {
        return None;
    }
    let encoded = message
        .get("message")
        .and_then(Value::as_str)
        .filter(|m| js::len16(m) <= 32 * 1024)?;
    let value: Value = serde_json::from_str(encoded).ok()?;
    if value.get("schema").and_then(Value::as_str) != Some(PUPPYONE_AGENT_APPROVAL_PROTOCOL) {
        return None;
    }
    let tool_name = Some(bounded(value.get("toolName"), 160)).filter(|t| !t.is_empty())?;
    let title = Some(bounded(value.get("title"), 300))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| format!("Allow {tool_name}"));
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .filter(|kind| matches!(*kind, "command" | "file-change" | "tool"))
        .unwrap_or("tool");
    Some(json!({
        "itemId": value.get("toolCallId").and_then(Value::as_str).filter(|id| SAFE_ID.is_match(id)),
        "title": title,
        "description": bounded(value.get("description"), 2_000),
        "reason": bounded(value.get("reason"), 2_000),
        "kind": kind,
        "toolName": tool_name,
        "command": bounded(value.get("command"), 8_192),
        "arguments": value.get("arguments").filter(|a| a.is_object()).cloned().unwrap_or_else(|| json!({})),
        "scopeKey": bounded(value.get("scopeKey"), 200),
        "allowSession": value.get("allowSession") != Some(&Value::Bool(false)),
    }))
}
