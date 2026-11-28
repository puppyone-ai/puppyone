//! `AgentReasoningActivity`: the thinking a turn shows.
use super::*;

/// `AgentReasoningActivity`: the live tail is the single authority for
/// in-progress feedback; a settled public summary alone becomes a row.
pub(super) fn reasoning_view(activity: &Part) -> ActivityView {
    let status = status_of(activity);
    let reasoning = match activity.detail.text("delta") {
        Some(delta) => delta.to_string(),
        None => output_for_activity(activity),
    };
    if matches!(status.as_str(), "running" | "pending" | "in-progress")
        || text::trim(&reasoning).is_empty()
    {
        return ActivityView::Hidden;
    }
    let duration = command_metadata(activity).1.map(format_agent_duration);
    ActivityView::Shell(Box::new(ActivityShell {
        title: match duration {
            Some(duration) => tf(
                "agent.activity.thoughtFor",
                &[("duration", Arg::Text(duration))],
            ),
            None => t("agent.activity.thoughtBriefly").into(),
        },
        subject: None,
        summary: None,
        metadata: None,
        status,
        icon: StepIcon::Brain,
        detail: ShellDetail::Prose {
            text: Some(reasoning),
            plan: Vec::new(),
        },
        default_expanded: false,
    }))
}
