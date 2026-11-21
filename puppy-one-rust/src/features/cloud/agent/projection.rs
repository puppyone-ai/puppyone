//! `cloudAgentProjection.ts`: hosted runs as the shared Agent display, so
//! the hosted chat renders through the same transcript, approval dock and
//! composer as a local one.
use crate::agent::contract::display_types::AgentDisplay;
use crate::agent::contract::dto::AgentProjection;
use crate::workspace::cloud::agent::{Run, Tool};
use serde_json::{Value, json};

/// `terminalState(run)`.
fn terminal_state(run: &Run) -> Option<&'static str> {
    match run.state.as_str() {
        "succeeded" => Some("completed"),
        "stopped" => Some("interrupted"),
        "failed" => Some("failed"),
        _ => None,
    }
}

/// `runPhase(run)`.
fn run_phase(run: Option<&Run>) -> &'static str {
    match run {
        Some(run) if run.state == "waiting_approval" => "waiting",
        Some(run) if run.active() => "running",
        _ => "ready",
    }
}

/// `presentationState(run)`.
fn presentation_state(run: Option<&Run>) -> &'static str {
    let Some(run) = run else {
        return "idle";
    };
    if run.state == "outcome_unknown" {
        return "outcome-unknown";
    }
    if run.active() {
        return "running";
    }
    terminal_state(run).unwrap_or("idle")
}

/// `toolKind(tool)`.
fn tool_kind(tool: &Tool) -> &'static str {
    match tool.name.as_str() {
        "bash" => "command",
        "write" | "edit" => "file-change",
        _ => "tool",
    }
}

/// `toolOutput(tool)`.
fn tool_output(tool: &Tool) -> String {
    let text: Vec<&str> = tool
        .result
        .iter()
        .flat_map(|result| result.content.iter())
        .filter(|part| part["type"] == "text")
        .map(|part| part["text"].as_str().unwrap_or_default())
        .collect();
    let text = text.join("\n");
    if text.is_empty() && tool.state == "rejected" {
        return "You declined this tool call. The Agent can continue with another approach.".into();
    }
    text
}

/// `toolStatus(tool)`.
fn tool_status(tool: &Tool) -> &'static str {
    match tool.state.as_str() {
        "completed" => match &tool.result {
            Some(result) if result.is_error => {
                let code = result
                    .details
                    .as_ref()
                    .and_then(|d| d["code"].as_str())
                    .unwrap_or_default();
                if matches!(
                    code,
                    "tool_permission_denied" | "tool_approval_denied" | "tool_unavailable"
                ) {
                    "blocked"
                } else {
                    "failed"
                }
            }
            _ => "completed",
        },
        "rejected" => "cancelled",
        "waiting" => "waiting-for-user",
        _ => "running",
    }
}

/// `projectCloudAgentRuns(runs)`.
pub fn project_cloud_agent_runs(runs: &[Run]) -> AgentProjection {
    let mut messages = Vec::new();
    let mut activities = Vec::new();
    let mut approvals = Vec::new();
    let current = runs.last();
    let active = current.is_some_and(Run::active);
    for (index, run) in runs.iter().enumerate() {
        let sequence = index as u64 * 1000;
        let updated = sequence + run.sequence;
        messages.push(json!({
            "turnId": run.id, "itemId": null, "updatedSequence": updated,
            "id": format!("{}:user", run.id), "role": "user", "submissionId": run.request_id,
            "text": run.prompt, "streaming": false, "terminalState": null, "sequence": sequence + 1,
        }));
        for (tool_index, tool) in run.tools.iter().flatten().enumerate() {
            let mut detail = if tool.input.is_object() {
                tool.input.clone()
            } else {
                json!({})
            };
            detail["tool"] = Value::from(tool.name.as_str());
            let at = sequence + 2 + tool_index as u64;
            activities.push(json!({
                "turnId": run.id, "itemId": null, "updatedSequence": updated,
                "id": format!("{}:{}", run.id, tool.call_id), "kind": tool_kind(tool),
                "label": tool.name, "status": tool_status(tool), "detail": detail,
                "output": tool_output(tool), "sequence": at,
            }));
            if Some(&run.id) == current.map(|c| &c.id) && run.active() && tool.state == "waiting" {
                approvals.push(json!({
                    "requestId": tool.call_id, "turnId": run.id, "itemId": tool.call_id,
                    "kind": if tool.name == "bash" { "command" } else { "file-change" },
                    "title": tool.name,
                    "command": tool.input["command"].as_str(),
                    "cwd": null, "commandActions": [], "networkApprovalContext": null,
                    "grantRoot": tool.input["path"].as_str(),
                    "policyChangeRequested": false, "reason": null,
                    "availableDecisions": ["accept", "decline"], "sequence": at,
                }));
            }
        }
        // `addReply`.
        if let Some(text) = run.snapshot.text.as_deref().filter(|t| !t.is_empty()) {
            messages.push(json!({
                "turnId": run.id, "itemId": null, "updatedSequence": updated,
                "id": format!("{}:assistant", run.id), "role": "assistant", "text": text,
                "streaming": run.active(), "terminalState": terminal_state(run),
                "sequence": sequence + 999,
            }));
        }
    }
    let full = runs.len() == 100;
    let value = json!({
        "schemaVersion": 1,
        "sessionState": if current.is_some() { "active" } else { "empty" },
        "lastSequence": runs.iter().map(|run| run.sequence).sum::<u64>(),
        "history": { "coverage": if full { "partial" } else { "complete" }, "reason": if full { Value::from("read-limit") } else { Value::Null } },
        "displayWindow": { "truncated": full },
        "missingRanges": [],
        "messages": messages,
        "activities": activities,
        "approvals": approvals,
        "questions": [], "turns": [], "parts": [], "rows": [],
        "connectionStatus": null,
        "runningTurnId": if active { current.map(|run| Value::from(run.id.as_str())).unwrap_or(Value::Null) } else { Value::Null },
        "terminalState": current.and_then(terminal_state),
        "usage": null,
        "presentation": {
            "phase": run_phase(current),
            "terminalState": presentation_state(current),
            "pendingPrompt": null,
            "submitting": false,
            "stopping": current.is_some_and(|run| run.stop_requested),
        },
    });
    let display =
        AgentDisplay::from_value(&value).expect("the hosted projection has every collection");
    AgentProjection::project(&display, None).expect("the hosted projection reads as a display")
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `cloudAgentProjection`: a tool's own error is the tool's status, never
    /// the Run's: denied tools read as blocked, failed ones as failed, declined
    /// ones as cancelled, whether the Run still runs or has succeeded.
    #[test]
    fn tool_errors_stay_on_their_tools_while_the_run_runs_or_succeeds() {
        for state in ["running", "succeeded"] {
            let run: Run = serde_json::from_value(json!({
                "id": "run", "project_id": "p", "agent_id": "a", "session_id": "s", "request_id": "r",
                "prompt": "Read files", "state": state, "sequence": 1, "stop_requested": false,
                "snapshot": {"text": "Continuing"}, "publication": null,
                "created_at": "2026-10-10T00:00:00Z", "updated_at": "2026-10-10T00:00:00Z",
                "tools": [
                    {"call_id": "denied", "name": "write", "input": {"path": "/recovery/test"}, "state": "completed",
                     "result": {"isError": true, "details": {"code": "tool_permission_denied", "recoverable": true},
                                "content": [{"type": "text", "text": "Permission denied"}]}},
                    {"call_id": "failed", "name": "bash", "input": {"command": "false"}, "state": "completed",
                     "result": {"isError": true, "content": [{"type": "text", "text": "Exit code 1"}]}},
                    {"call_id": "declined", "name": "bash", "input": {"command": "touch nope"}, "state": "rejected"},
                    {"call_id": "good", "name": "read", "input": {"path": "file.md"}, "state": "completed",
                     "result": {"content": []}}
                ]
            }))
            .unwrap();
            let projection = project_cloud_agent_runs(&[run]);
            let statuses: Vec<&str> = projection
                .activities
                .iter()
                .map(|a| a.status.as_str())
                .collect();
            assert_eq!(
                statuses,
                ["blocked", "failed", "cancelled", "completed"],
                "{state}"
            );
            assert_eq!(projection.activities[0].output, "Permission denied");
            assert!(projection.activities[2].output.contains("declined"));
            let presentation = projection.presentation.as_ref().unwrap();
            if state == "succeeded" {
                assert_eq!(presentation.terminal_state, "completed");
                assert_eq!(projection.running_turn_id, None);
            } else {
                assert_eq!(presentation.terminal_state, "running");
                assert_eq!(projection.running_turn_id.as_deref(), Some("run"));
            }
        }
    }
}
