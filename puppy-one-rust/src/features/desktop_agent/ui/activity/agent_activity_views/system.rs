//! `AgentSystemActivity` and `AgentNoticeActivity`: provider and system
//! notices in the transcript.
use super::*;

/// `AgentSystemActivity`: only context compaction belongs in the
/// transcript.
pub(super) fn system_view(activity: &Part) -> ActivityView {
    if activity.detail.text("category") != Some("compaction") {
        return ActivityView::Hidden;
    }
    let status = status_of(activity);
    let label = match status.as_str() {
        "completed" | "succeeded" => t("agent.activity.contextCompacted").to_string(),
        "running" | "queued" | "pending" | "in-progress" => {
            t("agent.activity.compactingContext").to_string()
        }
        other => {
            let state = match other {
                "failed" => "failed",
                "cancelled" | "interrupted" => "stopped",
                _ => "unknown",
            };
            format!(
                "{}: {}",
                t("agent.header.compactContext"),
                t(&format!("agent.status.{state}"))
            )
        }
    };
    ActivityView::ContextDivider(label)
}
