//! `AgentCommandActivity`: a command's step line and its output.
use super::*;

/// `AgentCommandActivity`.
pub(super) fn command_shell(activity: &Part) -> ActivityShell {
    let status = status_of(activity);
    let command = command_for_activity(activity);
    let output = output_for_activity(activity);
    let presentation = command_presentation_for_activity(activity);
    let step_kind = agent_tool_step_kind(activity);
    let visible = visible_command_for_activity(activity);
    let visible = if visible.is_empty() {
        activity.label.clone()
    } else {
        visible
    };
    let (exit_code, duration_ms) = command_metadata(activity);
    // Only facts worth a glance: a non-zero exit, and runs long enough to
    // notice.
    let facts: Vec<String> = if is_active_tool_status(&status) {
        Vec::new()
    } else {
        [
            exit_code.filter(|code| *code != 0.).map(|code| {
                tf(
                    "agent.toolStep.exitCode",
                    &[("code", Arg::Text(format_number(code as i64)))],
                )
            }),
            duration_ms
                .filter(|ms| *ms >= 1_000.)
                .map(format_agent_duration),
        ]
        .into_iter()
        .flatten()
        .collect()
    };
    let mut evidence = Vec::new();
    if !command.is_empty() {
        evidence.push(EvidenceNode {
            marker: Some("$"),
            tone: None,
            content: EvidenceContent::Text(command),
        });
    }
    if !output.is_empty() {
        evidence.push(EvidenceNode::text(output));
    }
    let kind = if step_kind == AgentToolStepKind::Generic {
        "command"
    } else {
        kind_key(step_kind)
    };
    ActivityShell {
        title: step_verb(kind, &status),
        subject: (!visible.is_empty()).then(|| StepSubject::code(&visible, None)),
        summary: None,
        metadata: (!facts.is_empty()).then(|| StepMetadata::Facts(facts.join(" · "))),
        icon: glyph(presentation.tool, &status),
        status,
        detail: ShellDetail::Evidence(evidence),
        default_expanded: false,
    }
}
