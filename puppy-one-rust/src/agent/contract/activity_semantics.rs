//! `shared/agent-contract/activity-semantics.mjs`: semantic routing shared by
//! projection and rendering; never infer from prose.
use super::js;
use serde_json::Value;

fn kind(part: &Value) -> &str {
    js::str_or_empty(js::get(part, "kind"))
}

pub fn is_agent_tool_activity(part: &Value) -> bool {
    matches!(kind(part), "tool" | "command" | "file-change")
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
