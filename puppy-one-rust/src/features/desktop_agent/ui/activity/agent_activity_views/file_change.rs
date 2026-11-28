//! `AgentFileChangeActivity`: the files a step changed, with their diffs.
use super::*;

/// `AgentFileChangeActivity`: nothing when it names no file and has no
/// output.
pub(super) fn file_change_shell(activity: &Part) -> Option<ActivityShell> {
    let status = status_of(activity);
    let changes = file_changes_for_activity(activity);
    let tool = agent_activity_tool_id(activity);
    let totals = file_change_totals(&changes);
    let path = path_for_activity(activity);
    let output = output_for_activity(activity);
    if changes.is_empty() && path.is_empty() && output.is_empty() {
        return None;
    }
    let files: Vec<ChangedFile> = if !changes.is_empty() {
        changes
            .iter()
            .map(|change| {
                (
                    change.path.clone(),
                    change.blocks.clone(),
                    change.diff.clone(),
                    change.truncated,
                )
            })
            .collect()
    } else if !path.is_empty() {
        vec![(path, Vec::new(), String::new(), false)]
    } else {
        Vec::new()
    };
    let step_kind = if agent_tool_step_kind(activity) == AgentToolStepKind::Write {
        "write"
    } else {
        "edit"
    };
    let subject = match files.len() {
        0 => None,
        1 => Some(StepSubject::path(&files[0].0)),
        count => Some(StepSubject::text(&tf(
            "agent.activity.fileCount",
            &[("count", Arg::Number(count as i64))],
        ))),
    };
    let mut evidence = Vec::new();
    for (path, blocks, diff, truncated) in &files {
        evidence.push(EvidenceNode {
            marker: None,
            tone: None,
            content: EvidenceContent::FilePath(path.clone()),
        });
        for (removed, added) in blocks {
            if let Some(removed) = removed {
                evidence.push(EvidenceNode {
                    marker: Some("−"),
                    tone: Some(EvidenceTone::Deletion),
                    content: EvidenceContent::Text(removed.clone()),
                });
            }
            if let Some(added) = added {
                evidence.push(EvidenceNode {
                    marker: Some("+"),
                    tone: Some(EvidenceTone::Addition),
                    content: EvidenceContent::Text(added.clone()),
                });
            }
        }
        if blocks.is_empty() && !diff.is_empty() {
            evidence.push(EvidenceNode::text(diff.clone()));
        }
        if *truncated {
            evidence.push(EvidenceNode {
                marker: None,
                tone: None,
                content: EvidenceContent::Empty(t("agent.activity.diffPartial").into()),
            });
        }
    }
    if !output.is_empty() {
        evidence.push(EvidenceNode::text(output));
    }
    Some(ActivityShell {
        title: step_verb(step_kind, &status),
        subject,
        summary: None,
        metadata: totals.map(|(additions, deletions)| StepMetadata::DiffStats {
            additions: format!("+{}", format_number(additions)),
            deletions: format!("−{}", format_number(deletions)),
        }),
        icon: glyph(&tool, &status),
        status,
        detail: ShellDetail::Evidence(evidence),
        default_expanded: false,
    })
}
