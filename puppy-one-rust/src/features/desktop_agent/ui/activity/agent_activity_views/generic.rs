//! `AgentGenericActivity`: any other tool, with its input and output.
use super::*;

/// `AgentGenericActivity`.
pub(super) fn generic_view(activity: &Part) -> ActivityView {
    if is_context_compaction_activity(activity) {
        return ActivityView::ContextDivider(t("agent.activity.contextCompacted").into());
    }
    let status = status_of(activity);
    let tool = agent_activity_tool_id(activity);
    let output = output_for_activity(activity);
    let input = structured_input_for_activity(activity);
    let step_kind = agent_tool_step_kind(activity);
    let detail = &activity.detail;
    let structured = detail.record("input").unwrap_or_else(RecordRef::empty);
    let target = [
        structured.text("url"),
        structured.text("uri"),
        detail.text("url"),
        structured.text("query"),
        detail.text("query"),
    ]
    .into_iter()
    .flatten()
    .find(|v| !text::trim(v).is_empty())
    .map(str::to_string);
    let title = if matches!(
        step_kind,
        AgentToolStepKind::Fetch | AgentToolStepKind::Search
    ) {
        step_verb(kind_key(step_kind), &status)
    } else {
        format_agent_tool_name(&tool)
    };
    // A provider label that only repeats the tool name adds nothing.
    let summary = agent_activity_summary(activity);
    let repeated = [
        Some(title.as_str()),
        Some(tool.as_str()),
        detail.text("tool"),
    ]
    .into_iter()
    .flatten()
    .any(|value| text::trim(value).to_lowercase() == text::trim(&summary).to_lowercase());
    let informative = !summary.is_empty() && !repeated;
    let subject = match target {
        Some(target) => Some(StepSubject::code(&target, None)),
        None if informative => Some(StepSubject::text(&summary)),
        None => None,
    };
    let mut evidence = Vec::new();
    if !output.is_empty() || input.is_some() {
        if let Some(input) = input {
            evidence.push(EvidenceNode::text(input));
        }
        if !output.is_empty() {
            evidence.push(EvidenceNode::text(output));
        }
    }
    ActivityView::Shell(Box::new(ActivityShell {
        title,
        subject,
        summary: None,
        metadata: None,
        icon: glyph(&tool, &status),
        status,
        detail: ShellDetail::Evidence(evidence),
        default_expanded: false,
    }))
}
