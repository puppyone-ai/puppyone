//! `shared/agent-contract/activity-semantics.mjs`: semantic routing shared by
//! projection and rendering; never infer from prose.
use super::js;
use serde_json::Value;

fn kind(part: &Value) -> &str {
    js::str_or_empty(js::get(part, "kind"))
}

pub fn is_agent_transcript_activity(part: &Value) -> bool {
    match kind(part) {
        "notification" => false,
        "system" => {
            js::get(part, "detail").and_then(|d| js::get(d, "category"))
                == Some(&Value::from("compaction"))
        }
        _ => true,
    }
}

/// [`is_agent_tool_activity`] of a typed activity or part.
pub fn is_tool_activity<A: super::dto::ActivityFields + ?Sized>(part: &A) -> bool {
    matches!(part.kind(), "tool" | "command" | "file-change")
}

/// [`is_agent_transcript_activity`] of a typed activity or part.
pub fn is_transcript_activity<A: super::dto::ActivityFields + ?Sized>(part: &A) -> bool {
    match part.kind() {
        "notification" => false,
        "system" => part.detail().text("category") == Some("compaction"),
        _ => true,
    }
}
