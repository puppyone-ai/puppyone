//! `transcript/message-identity.mjs`.
use crate::agent::contract::display_types::Entry;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::types::AgentEventView;
use serde_json::Value;

/// `associateAgentUserMessage(event, control)`: bind protocol identities to
/// a Main-owned submission before content is materialized.
pub fn associate_agent_user_message(event: &Value, control: &Value) -> Value {
    let event_type = event.event_type();
    if !matches!(event_type, "turn.started" | "user.message")
        || js::truthy_opt(event.field("restored"))
    {
        return event.clone();
    }
    let client_id = [
        event.field("clientUserMessageId"),
        event.field("userMessageId"),
    ]
    .into_iter()
    .flatten()
    .find(|v| !v.is_null());
    let commands = control
        .get("commands")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut command = client_id.filter(|id| js::truthy(id)).and_then(|id| {
        commands.iter().find(|entry| {
            entry.get("kind") == Some(&Value::from("start"))
                && entry.get("userMessageId") == Some(id)
        })
    });
    if command.is_none()
        && event_type == "turn.started"
        && let Some(pending) = control.get("pendingSubmission").filter(|p| js::truthy(p))
    {
        command = commands
            .iter()
            .find(|entry| entry.get("commandId") == pending.get("commandId"));
    }
    let Some(command) = command else {
        return event.clone();
    };
    let mut payload = Obj::from(event.payload())
        .set(
            "userMessageId",
            command.get("userMessageId").cloned().unwrap_or(Value::Null),
        )
        .set(
            "submissionId",
            command.get("commandId").cloned().unwrap_or(Value::Null),
        );
    if let Some(intent) = command.get("intent").filter(|i| js::truthy(i)) {
        let prompt = intent.get("prompt").cloned().unwrap_or(Value::Null);
        if event_type == "turn.started" {
            payload.insert("prompt", prompt);
            if let Some(recovery) = intent.get("recoveryOfTurnId").filter(|r| js::truthy(r)) {
                payload.insert("recoveryOfTurnId", recovery.clone());
            }
        } else {
            payload.insert("text", prompt);
        }
        payload.insert(
            "referenceDisplays",
            intent
                .get("referenceDisplays")
                .cloned()
                .unwrap_or(Value::Null),
        );
        payload.insert(
            "promptMentions",
            intent.get("promptMentions").cloned().unwrap_or(Value::Null),
        );
    }
    js::with(event, "payload", payload.build())
}

/// `findAgentUserMessage(messages, event)`: a client id confirms a
/// submission; a native item id identifies the echoed object.
pub fn find_agent_user_message(messages: &[Entry], event: &Value) -> Option<usize> {
    let client_id = [
        event.field("userMessageId"),
        event.field("clientUserMessageId"),
    ]
    .into_iter()
    .flatten()
    .find(|v| !v.is_null())
    .filter(|id| js::truthy(id));
    let submission_id = event.field("submissionId").filter(|id| js::truthy(id));
    let item_id = event.get("itemId").filter(|id| js::truthy(id));
    messages.iter().position(|message| {
        message.get("role") == Some(&Value::from("user"))
            && (submission_id.is_some_and(|id| message.get("submissionId") == Some(id))
                || client_id.is_some_and(|id| {
                    message.get("clientUserMessageId") == Some(id)
                        || id.as_str().is_some_and(|id| {
                            message.get("id").and_then(Value::as_str) == Some(&format!("user:{id}"))
                        })
                })
                || item_id.is_some_and(|id| message.get("itemId") == Some(id)))
    })
}
