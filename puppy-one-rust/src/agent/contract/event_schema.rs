//! `shared/agent-contract/event-schema.mjs`: the canonical Agent event
//! envelope every runtime emits and every consumer reads.
use super::constants::{AGENT_EVENT_TYPES, limits};
use super::js;
use super::native_session_id::native_session_id;
use super::reference_identity::normalize_agent_workspace_relative_path;
use super::validation::{
    Contract, StringRule, assert_record, assert_runtime_id, contract_error, enum_value,
    is_opaque_id, non_negative_integer, optional_nullable_opaque_id, optional_opaque_id,
    positive_integer, required_string, required_string_with,
};
use crate::text;
use serde_json::{Map, Value};

const ACTIVITY_PAYLOAD_KEYS: &[&str] = &[
    "kind",
    "tool",
    "label",
    "description",
    "status",
    "input",
    "arguments",
    "command",
    "cwd",
    "path",
    "query",
    "changes",
    "outputPreview",
    "result",
    "error",
    "content",
    "detail",
    "metadata",
    "recoverable",
    "exitCode",
    "duration",
    "durationMs",
    "elapsedMs",
    "diff",
    "patch",
    "outputPaths",
    "truncated",
];
const BLOCKER_PAYLOAD_KEYS: &[&str] = &["requestId", "kind", "title", "command", "cwd", "reason"];

/// `PAYLOAD_KEYS[type]`.
fn payload_keys(event_type: &str) -> Vec<&'static str> {
    let activity = |extra: &[&'static str]| {
        let mut keys = ACTIVITY_PAYLOAD_KEYS.to_vec();
        keys.extend_from_slice(extra);
        keys.push("restored");
        keys
    };
    let blocker = |extra: &[&'static str]| {
        let mut keys = BLOCKER_PAYLOAD_KEYS.to_vec();
        keys.extend_from_slice(extra);
        keys
    };
    match event_type {
        "session.started" | "session.resumed" | "session.updated" => vec!["title", "status"],
        "session.closed" => vec!["status"],
        "turn.started" => vec![
            "prompt",
            "recoveryOfTurnId",
            "userMessageId",
            "submissionId",
            "status",
            "referenceDisplays",
            "promptMentions",
            "model",
            "effort",
            "mode",
            "restored",
        ],
        "turn.completed" => vec![
            "status",
            "durationMs",
            "restored",
            "completionQuality",
            "failureScope",
            "failureCode",
            "retryable",
            "transportHealth",
            "sideEffects",
            "diagnostic",
        ],
        "turn.failed" | "turn.interrupted" => vec!["status", "message", "durationMs", "restored"],
        "user.message" => vec![
            "text",
            "clientUserMessageId",
            "userMessageId",
            "submissionId",
            "referenceDisplays",
            "promptMentions",
            "restored",
        ],
        "assistant.delta" => vec![
            "delta",
            "text",
            "streaming",
            "updateMode",
            "truncated",
            "restored",
        ],
        "assistant.completed" => vec!["text", "streaming", "updateMode", "truncated", "restored"],
        "reasoning.summary.delta" => vec![
            "delta",
            "text",
            "summaryIndex",
            "completed",
            "boundary",
            "updateMode",
            "truncated",
            "restored",
        ],
        "plan.updated" => vec![
            "text",
            "explanation",
            "steps",
            "completed",
            "streaming",
            "updateMode",
            "truncated",
            "restored",
        ],
        "tool.started" | "tool.progress" | "tool.completed" => activity(&[]),
        "command.output.delta" => activity(&["delta", "updateMode"]),
        "file.change.updated" => activity(&["changes", "diff", "patch"]),
        "usage.updated" => vec![
            "inputTokens",
            "outputTokens",
            "totalTokens",
            "cachedTokens",
            "cost",
            "contextWindow",
            "tokens",
        ],
        "approval.requested" => blocker(&[
            "availableDecisions",
            "commandActions",
            "networkApprovalContext",
            "grantRoot",
            "proposedExecpolicyAmendment",
            "proposedNetworkPolicyAmendments",
        ]),
        "approval.resolved" => blocker(&["decision", "reason"]),
        "question.requested" => blocker(&["questions"]),
        "question.resolved" => blocker(&["resolution", "rejected", "reason"]),
        "provider.notification" => vec!["message", "severity", "source"],
        "provider.activity" => activity(&["category", "message"]),
        "provider.connection.updated" => vec![
            "scope",
            "requestId",
            "recoveryId",
            "state",
            "message",
            "attempt",
            "maxAttempts",
            "maxRetries",
        ],
        "provider.warning" => vec![
            "code",
            "stage",
            "source",
            "actions",
            "message",
            "recoverable",
            "diagnostic",
            "attempt",
            "maxAttempts",
            "maxRetries",
        ],
        "provider.error" => vec![
            "code",
            "stage",
            "source",
            "actions",
            "message",
            "recoverable",
            "diagnostic",
        ],
        _ => Vec::new(),
    }
}

fn is_event_type(value: &str) -> bool {
    AGENT_EVENT_TYPES.contains(&value)
}

/// `assertAgentEventEnvelope(value)`.
pub fn assert_agent_event_envelope(value: &Value) -> Contract<()> {
    let event = assert_record(Some(value), "AgentEvent")?;
    if event.get("schemaVersion") != Some(&Value::from(1)) {
        return Err(contract_error("AgentEvent.schemaVersion", "must equal 1"));
    }
    positive_integer(event.get("sequence"), "AgentEvent.sequence")?;
    required_string(event.get("sessionId"), "AgentEvent.sessionId", 256)?;
    let runtime = match event.get("runtimeId") {
        None | Some(Value::Null) => event.get("provider"),
        some => some,
    };
    assert_runtime_id(runtime, "AgentEvent.runtimeId")?;
    assert_runtime_id(event.get("provider"), "AgentEvent.provider")?;
    if !js::nullish(event.get("providerSessionId"))
        && native_session_id(event.get("providerSessionId")).is_none()
    {
        return Err(contract_error("AgentEvent.providerSessionId", "is invalid"));
    }
    optional_nullable_opaque_id(event.get("turnId"), "AgentEvent.turnId")?;
    optional_nullable_opaque_id(event.get("itemId"), "AgentEvent.itemId")?;
    required_string(event.get("emittedAt"), "AgentEvent.emittedAt", 64)?;
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    if !is_event_type(event_type) {
        return Err(contract_error("AgentEvent.type", "is not supported"));
    }
    let payload = assert_record(event.get("payload"), "AgentEvent.payload")?;
    if payload.contains_key("updateMode") {
        enum_value(
            payload.get("updateMode"),
            "AgentEvent.payload.updateMode",
            &["append", "replace"],
        )?;
    }
    if payload.get("truncated").is_some_and(|t| !t.is_boolean()) {
        return Err(contract_error(
            "AgentEvent.payload.truncated",
            "must be boolean",
        ));
    }
    if matches!(
        event_type,
        "approval.requested" | "approval.resolved" | "question.requested" | "question.resolved"
    ) && !is_opaque_id(payload.get("requestId"))
    {
        return Err(contract_error(
            &format!("AgentEvent({event_type}).payload.requestId"),
            "is required",
        ));
    }
    if event_type == "question.requested" && !payload.get("questions").is_some_and(Value::is_array)
    {
        return Err(contract_error(
            "AgentEvent(question.requested).payload.questions",
            "must be an array",
        ));
    }
    for key in [
        "clientUserMessageId",
        "userMessageId",
        "submissionId",
        "requestId",
        "recoveryId",
        "recoveryOfTurnId",
    ] {
        if payload.contains_key(key) {
            optional_opaque_id(payload.get(key), &format!("AgentEvent.payload.{key}"))?;
        }
    }
    if event_type == "user.message" {
        required_string_with(
            payload.get("text"),
            "AgentEvent(user.message).payload.text",
            limits::MAX_MESSAGE_LENGTH,
            StringRule::VERBATIM,
        )?;
    }
    if event_type == "turn.started" && payload.contains_key("userMessageId") {
        optional_opaque_id(
            payload.get("userMessageId"),
            "AgentEvent(turn.started).payload.userMessageId",
        )?;
    }
    let carries_input = matches!(event_type, "turn.started" | "user.message");
    if carries_input && payload.contains_key("referenceDisplays") {
        assert_reference_displays(payload.get("referenceDisplays"), event_type)?;
    }
    if carries_input && payload.contains_key("promptMentions") {
        let prompt = if event_type == "user.message" {
            payload.get("text")
        } else {
            payload.get("prompt")
        };
        assert_prompt_mentions(payload.get("promptMentions"), prompt, event_type)?;
    }
    if event_type == "provider.notification" {
        required_string(payload.get("message"), "Agent notification.message", 4_000)?;
        enum_value(
            payload.get("severity"),
            "Agent notification.severity",
            &["info", "warning", "error"],
        )?;
        if payload.contains_key("source") {
            required_string(payload.get("source"), "Agent notification.source", 200)?;
        }
    }
    if event_type == "provider.activity" && payload.contains_key("category") {
        enum_value(
            payload.get("category"),
            "Agent activity.category",
            &["authentication", "compaction", "status"],
        )?;
    }
    if event_type == "provider.connection.updated" {
        enum_value(
            payload.get("state"),
            "AgentEvent(provider.connection.updated).payload.state",
            &["reconnecting", "fallback", "connected"],
        )?;
        for key in ["attempt", "maxAttempts", "maxRetries"] {
            if !js::nullish(payload.get(key)) {
                positive_integer(
                    payload.get(key),
                    &format!("AgentEvent(provider.connection.updated).payload.{key}"),
                )?;
            }
        }
    }
    if event_type == "turn.completed" && payload.contains_key("completionQuality") {
        let label = |key: &str| format!("AgentEvent(turn.completed).payload.{key}");
        let quality = enum_value(
            payload.get("completionQuality"),
            &label("completionQuality"),
            &["complete", "degraded"],
        )?;
        if quality == "degraded" {
            enum_value(
                payload.get("failureScope"),
                &label("failureScope"),
                &["child-task", "tool", "upstream-request", "turn"],
            )?;
            required_string(payload.get("failureCode"), &label("failureCode"), 160)?;
            if !matches!(payload.get("retryable"), Some(Value::Null | Value::Bool(_))) {
                return Err(contract_error(
                    &label("retryable"),
                    "must be boolean or null",
                ));
            }
            enum_value(
                payload.get("transportHealth"),
                &label("transportHealth"),
                &["healthy", "recovering", "exited", "unknown"],
            )?;
            enum_value(
                payload.get("sideEffects"),
                &label("sideEffects"),
                &["none", "possible", "confirmed", "unknown"],
            )?;
            if payload.contains_key("diagnostic") {
                required_string(payload.get("diagnostic"), &label("diagnostic"), 2_000)?;
            }
        }
    }
    Ok(())
}

/// `sanitizeAgentEventPayload(type, value)`: removes additive native
/// provenance before an envelope crosses Main IPC.
pub fn sanitize_agent_event_payload(event_type: &str, value: &Value) -> Contract<Value> {
    if !is_event_type(event_type) {
        return Err(contract_error("AgentEvent.type", "is not supported"));
    }
    let payload = assert_record(Some(value), &format!("AgentEvent({event_type}).payload"))?;
    let mut out = Map::new();
    for key in payload_keys(event_type) {
        if let Some(entry) = payload.get(key) {
            out.insert(key.into(), entry.clone());
        }
    }
    Ok(Value::Object(out))
}

/// `sanitizeAgentEventEnvelope(value)`.
pub fn sanitize_agent_event_envelope(value: &Value) -> Contract<Value> {
    assert_agent_event_envelope(value)?;
    let event_type = js::str_or_empty(js::get(value, "type"));
    let payload = sanitize_agent_event_payload(event_type, &value["payload"])?;
    Ok(js::with(value, "payload", payload))
}

fn assert_prompt_mentions(
    value: Option<&Value>,
    prompt: Option<&Value>,
    event_type: &str,
) -> Contract<()> {
    let label = format!("AgentEvent({event_type}).payload.promptMentions");
    let Some(mentions) = value.and_then(Value::as_array).filter(|m| m.len() <= 32) else {
        return Err(contract_error(&label, "must contain at most 32 entries"));
    };
    let length = text::len16(js::str_or_empty(prompt)) as i64;
    let mut boundary = 0;
    for (index, entry) in mentions.iter().enumerate() {
        let label = format!("{label}[{index}]");
        let mention = assert_record(Some(entry), &label)?;
        if !is_opaque_id(mention.get("referenceId")) {
            return Err(contract_error(
                &format!("{label}.referenceId"),
                "is invalid",
            ));
        }
        let start = non_negative_integer(mention.get("start"), &format!("{label}.start"))?;
        let end = non_negative_integer(mention.get("end"), &format!("{label}.end"))?;
        if start < boundary || end <= start || end > length {
            return Err(contract_error(
                &label,
                "has an invalid or overlapping range",
            ));
        }
        boundary = end;
    }
    Ok(())
}

fn assert_reference_displays(value: Option<&Value>, event_type: &str) -> Contract<()> {
    let label = format!("AgentEvent({event_type}).payload.referenceDisplays");
    let Some(displays) = value.and_then(Value::as_array).filter(|d| d.len() <= 32) else {
        return Err(contract_error(&label, "must contain at most 32 entries"));
    };
    const ALLOWED: &[&str] = &[
        "id",
        "kind",
        "displayName",
        "relativePath",
        "workspaceName",
        "mime",
        "size",
    ];
    for (index, entry) in displays.iter().enumerate() {
        let label = format!("{label}[{index}]");
        let reference = assert_record(Some(entry), &label)?;
        for key in reference.keys() {
            if !ALLOWED.contains(&key.as_str()) {
                return Err(contract_error(
                    &format!("{label}.{key}"),
                    "is not renderer-safe reference metadata",
                ));
            }
        }
        if !is_opaque_id(reference.get("id")) {
            return Err(contract_error(&format!("{label}.id"), "is invalid"));
        }
        let kind = js::opt_str(reference.get("kind"));
        if !matches!(
            kind,
            Some("workspace-file" | "workspace-directory" | "attachment")
        ) {
            return Err(contract_error(&format!("{label}.kind"), "is invalid"));
        }
        required_string(
            reference.get("displayName"),
            &format!("{label}.displayName"),
            512,
        )?;
        if reference.contains_key("workspaceName") {
            required_string(
                reference.get("workspaceName"),
                &format!("{label}.workspaceName"),
                512,
            )?;
        }
        if reference.contains_key("relativePath") {
            let relative_path = required_string(
                reference.get("relativePath"),
                &format!("{label}.relativePath"),
                4_096,
            )?;
            if normalize_agent_workspace_relative_path(Some(&Value::String(relative_path)))
                .is_none()
            {
                return Err(contract_error(
                    &format!("{label}.relativePath"),
                    "must remain workspace-relative",
                ));
            }
        }
        if reference.contains_key("mime") {
            required_string(reference.get("mime"), &format!("{label}.mime"), 200)?;
        }
        if reference.contains_key("size") {
            let size = non_negative_integer(reference.get("size"), &format!("{label}.size"))?;
            if size > 25 * 1024 * 1024 {
                return Err(contract_error(
                    &format!("{label}.size"),
                    "exceeds the reference display limit",
                ));
            }
        }
    }
    Ok(())
}
