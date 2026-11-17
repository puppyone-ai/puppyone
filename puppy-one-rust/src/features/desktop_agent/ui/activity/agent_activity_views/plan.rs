//! `AgentPlanActivity`: the plan's steps and their states.
use super::*;

/// `AgentPlanActivity`.
pub(super) fn plan_shell(activity: &Part) -> ActivityShell {
    let status = status_of(activity);
    let steps: Vec<PlanStep> = activity
        .detail
        .records("steps")
        .into_iter()
        .take(100)
        .map(|step| {
            let text = step.display("step").unwrap_or_default();
            let status = step.display("status").unwrap_or_else(|| "pending".into());
            PlanStep {
                step: text::head16(&text, 2_000).to_string(),
                status_label: plan_status_label(&status),
                status,
            }
        })
        .filter(|step| !step.step.is_empty())
        .collect();
    let detail = &activity.detail;
    let text = detail
        .text("text")
        .or_else(|| detail.text("explanation"))
        .map(|text| text::head16(text, 64 * 1024).to_string())
        .filter(|text| !text.is_empty());
    ActivityShell {
        title: t("agent.tool.plan").into(),
        subject: None,
        summary: None,
        metadata: None,
        default_expanded: status == "running",
        status,
        icon: StepIcon::ListTodo,
        detail: ShellDetail::Prose { text, plan: steps },
    }
}

/// `formatPlanStatus(status, t)`.
fn plan_status_label(status: &str) -> String {
    match status {
        "pending" => t("agent.plan.pending").into(),
        "inProgress" | "in-progress" | "in_progress" => t("agent.plan.inProgress").into(),
        "completed" => t("agent.plan.completed").into(),
        other => other.to_string(),
    }
}
