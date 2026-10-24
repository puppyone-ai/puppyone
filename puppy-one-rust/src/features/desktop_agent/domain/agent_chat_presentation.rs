//! Presentation decisions independent of GPUI layout and provider transport.
//! Labels are product catalog keys (`locales/renderer/*/agent.json`).
use crate::agent::domain::agent_session_model::Decision;
pub fn decision_label(decision: Decision) -> &'static str {
    match decision {
        Decision::Accept => "agent.approval.allowOnce",
        Decision::Decline => "agent.approval.deny",
        Decision::Cancel => "common.action.cancel",
    }
}
pub fn message_preview(text: &str) -> String {
    if text.chars().count() > 32_768 {
        format!("{}\n\n…", text.chars().take(32_768).collect::<String>())
    } else {
        text.into()
    }
}
