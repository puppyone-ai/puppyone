//! `runtime/agent-history-read-result.mjs`: a native read describes content
//! coverage; it never invents an execution outcome.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::Obj;
use crate::agent::contract::native_session_id::native_session_id;
use serde_json::Value;

fn type_error(message: &str) -> AgentError {
    AgentError::new(message).with_name("TypeError")
}

/// `agentHistoryReadResult({ providerSessionId, events, coverage, reason })`.
pub fn agent_history_read_result(value: &Value) -> AgentResult<Value> {
    let provider_session_id = native_session_id(value.get("providerSessionId"));
    let events = value.get("events").and_then(Value::as_array);
    let coverage = value.get("coverage").and_then(Value::as_str).unwrap_or(
        if value.get("coverage").is_none() {
            "unknown"
        } else {
            ""
        },
    );
    let (Some(provider_session_id), Some(events)) = (provider_session_id, events) else {
        return Err(type_error(
            "Native history returned an invalid read result.",
        ));
    };
    if events.len() > 10_000 || !matches!(coverage, "complete" | "partial" | "unknown") {
        return Err(type_error(
            "Native history returned an invalid read result.",
        ));
    }
    let reason = value.get("reason").filter(|r| !r.is_null());
    if let Some(reason) = reason
        && !matches!(
            reason.as_str(),
            Some("read-limit" | "replay-unverified" | "unsupported" | "unverified")
        )
    {
        return Err(type_error(
            "Native history returned an invalid coverage reason.",
        ));
    }
    if coverage == "complete" && reason.is_some() {
        return Err(type_error(
            "Complete history cannot have a missing-content reason.",
        ));
    }
    for event in events {
        let conversation = event.get("providerSessionId").filter(|v| !v.is_null());
        if !event.get("type").is_some_and(Value::is_string)
            || conversation.is_some_and(|id| id.as_str() != Some(provider_session_id.as_str()))
        {
            return Err(type_error(
                "Native history returned content for a different conversation.",
            ));
        }
    }
    Ok(Obj::new()
        .set("providerSessionId", provider_session_id)
        .set("events", events.clone())
        .set("coverage", coverage)
        .set(
            "reason",
            if coverage == "complete" {
                Value::Null
            } else {
                reason.cloned().unwrap_or(Value::from("unverified"))
            },
        )
        .build())
}

/// `assertAgentHistoryReadResult(value, providerSessionId)`.
pub fn assert_agent_history_read_result(
    value: &Value,
    provider_session_id: Option<&str>,
) -> AgentResult<Value> {
    let result = agent_history_read_result(value)?;
    if result["providerSessionId"].as_str() != provider_session_id {
        return Err(type_error(
            "Native history does not match the opened conversation.",
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    /// `rejects contradictory or invalid native coverage reasons`
    /// (electron.agent-history-display-status.test.mjs).
    #[test]
    fn rejects_contradictory_or_invalid_native_coverage_reasons() {
        let result = json!({"providerSessionId": "native", "events": []});
        let with = |extra: Value| {
            let mut value = result.clone();
            for (key, entry) in extra.as_object().unwrap() {
                value[key] = entry.clone();
            }
            agent_history_read_result(&value)
        };
        assert!(
            with(json!({"coverage": "complete", "reason": "read-limit"}))
                .unwrap_err()
                .message
                .contains("Complete history")
        );
        assert!(
            with(json!({"coverage": "partial", "reason": "anything"}))
                .unwrap_err()
                .message
                .contains("coverage reason")
        );
        assert_eq!(
            with(json!({"coverage": "unknown"})).unwrap()["reason"],
            "unverified"
        );
    }
}
