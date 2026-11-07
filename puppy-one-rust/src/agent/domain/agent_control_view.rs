//! `domain/agent-control-view.mjs`: IPC control metadata. Input bodies and
//! native blocker payloads belong to Main.
use crate::agent::contract::js::{self, Obj};
use crate::text;
use serde_json::Value;

/// `projectAgentControlView(control)`.
pub fn project_agent_control_view(control: &Value) -> Value {
    let blocker = |entry: &Value| {
        let mut identity = entry.clone();
        js::delete(&mut identity, "event");
        js::delete(&mut identity, "questions");
        identity
    };
    let blockers = |key: &str| -> Vec<Value> {
        control["interaction"][key]
            .as_array()
            .into_iter()
            .flatten()
            .map(blocker)
            .collect()
    };
    let commands: Vec<Value> = control["commands"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|command| {
            let mut record = command.clone();
            js::delete(&mut record, "intent");
            let error = record
                .get("error")
                .and_then(Value::as_str)
                .map_or(Value::Null, |e| Value::from(text::head16(e, 1024)));
            js::with(&record, "error", error)
        })
        .collect();
    let pending = match control.get("pendingSubmission").filter(|p| js::truthy(p)) {
        Some(submission) => {
            let mut pending = submission.clone();
            for key in ["prompt", "promptMentions", "referenceDisplays"] {
                js::delete(&mut pending, key);
            }
            pending
        }
        None => Value::Null,
    };
    let field = |key: &str| control.get(key).cloned().unwrap_or(Value::Null);
    Obj::new()
        .set("schemaVersion", field("schemaVersion"))
        .set("streamId", field("streamId"))
        .set("revision", field("revision"))
        .set("sessionEpoch", field("sessionEpoch"))
        .set("adapterGeneration", field("adapterGeneration"))
        .set("runGeneration", field("runGeneration"))
        .set("connection", field("connection"))
        .set("execution", field("execution"))
        .set("recoveries", field("recoveries"))
        .set("queue", field("queue"))
        .set("terminalTurns", field("terminalTurns"))
        .set("commands", commands)
        .set(
            "interaction",
            Obj::new()
                .set("approvals", blockers("approvals"))
                .set("questions", blockers("questions"))
                .build(),
        )
        .set("pendingSubmission", pending)
        .build()
}
