//! `ui/transcript/transcript-rows.ts`: arranges Main-authored display data
//! into visible transcript rows. Non-visual state, such as token usage,
//! must not occupy virtual-list geometry.
use crate::agent::contract::activity_semantics::is_transcript_activity;
pub use crate::agent::contract::dto::TimelineRow;
use crate::agent::contract::dto::{
    AgentProjection, DraftReference, EntryType, Part, PromptMention, ReferenceDisplay,
    ReferenceDisplayKind, ReferenceKind,
};
use crate::features::desktop_agent::domain::agent_activity_presentation::output_for_activity;
use crate::text;
use std::collections::HashMap;
use std::sync::Arc;

/// `STANDARD_CONTROL_SIZE`.
pub const STANDARD_CONTROL_SIZE: f64 = 32.;

/// `Number.MAX_SAFE_INTEGER`: a pending submission sorts last.
const LAST_SEQUENCE: i64 = (1 << 53) - 1;

/// `AgentTimeline`.
#[derive(Clone, Debug, Default)]
pub struct AgentTimeline {
    pub rows: Vec<TimelineRow>,
    pub parts: HashMap<String, Arc<Part>>,
}

/// `PendingTranscriptSubmission`.
#[derive(Clone, Debug, PartialEq)]
pub struct PendingTranscriptSubmission {
    pub id: String,
    pub prompt: String,
    pub references: Vec<DraftReference>,
    pub prompt_mentions: Vec<PromptMention>,
}

/// `buildAgentTimeline(projection, compactRowHeight, pending)`.
pub fn build_agent_timeline(
    projection: &AgentProjection,
    compact_row_height: f64,
    pending: Option<&PendingTranscriptSubmission>,
) -> AgentTimeline {
    let (parts, mut rows): (Vec<Arc<Part>>, Vec<TimelineRow>) =
        if !projection.rows.is_empty() && !projection.parts.is_empty() {
            let rows = projection
                .rows
                .iter()
                .map(|row| {
                    let mut row = (**row).clone();
                    if row.kind == "turn-summary" {
                        row.estimated_height = compact_row_height;
                    }
                    row
                })
                .collect();
            (projection.parts.clone(), rows)
        } else {
            // Compatibility for consumers constructing the original
            // projection shape.
            let mut parts: Vec<Arc<Part>> = projection
                .messages
                .iter()
                .map(|message| Arc::new(Part::of_message(message)))
                .chain(
                    projection
                        .activities
                        .iter()
                        .map(|activity| Arc::new(Part::of_activity(activity))),
                )
                .collect();
            parts.sort_by_key(|part| part.sequence);
            let rows = parts
                .iter()
                .map(|part| TimelineRow {
                    id: format!("row:{}", part.id),
                    part_id: part.id.clone(),
                    turn_id: part.turn_id.clone(),
                    kind: part.kind.clone(),
                    sequence: part.sequence,
                    updated_sequence: Some(part.updated_sequence.unwrap_or(part.sequence)),
                    estimated_height: estimate_legacy_part_height(part),
                })
                .collect();
            (parts, rows)
        };
    // Main owns message correlation. The view only uses its opaque submission
    // identity so an admitted row continues the same mounted preview.
    let mut part_map: HashMap<String, Arc<Part>> = parts
        .into_iter()
        .map(|part| (part.id.clone(), part))
        .collect();
    for row in &mut rows {
        if let Some(part) = part_map.get(&row.part_id)
            && part.kind == "user"
            && let Some(submission) = part.submission_id.as_deref().filter(|s| !s.is_empty())
        {
            row.id = submission_row_id(submission);
        }
    }
    if let Some(pending) = pending
        && !part_map.values().any(|part| {
            part.kind == "user" && part.submission_id.as_deref() == Some(pending.id.as_str())
        })
    {
        let id = format!("pending:{}", pending.id);
        let part = Part {
            id: id.clone(),
            kind: "user".into(),
            submission_id: Some(pending.id.clone()),
            text: pending.prompt.clone(),
            references: Some(
                pending
                    .references
                    .iter()
                    .map(draft_reference_display)
                    .collect(),
            ),
            prompt_mentions: Some(pending.prompt_mentions.clone()),
            sequence: LAST_SEQUENCE,
            ..Part::default()
        };
        part_map.insert(id.clone(), Arc::new(part));
        rows.push(TimelineRow {
            id: submission_row_id(&pending.id),
            part_id: id,
            turn_id: None,
            kind: "user".into(),
            sequence: LAST_SEQUENCE,
            updated_sequence: None,
            estimated_height: 64.,
        });
    }
    let rows = rows
        .into_iter()
        .filter(|row| is_visible_agent_timeline_part(part_map.get(&row.part_id).map(|p| &**p)))
        .collect();
    AgentTimeline {
        rows,
        parts: part_map,
    }
}

/// `isVisibleAgentTimelinePart(part)`: interaction state belongs to the
/// actionable docks, not a second transcript label.
pub fn is_visible_agent_timeline_part(part: Option<&Part>) -> bool {
    let Some(part) = part else {
        return false;
    };
    let kind = part.kind.as_str();
    if !is_transcript_activity(part) || matches!(kind, "usage" | "permission" | "question") {
        return false;
    }
    if kind != "reasoning" {
        return true;
    }
    if [
        "queued",
        "running",
        "pending",
        "in-progress",
        "waiting-for-user",
    ]
    .contains(&part.status.as_str())
    {
        return false;
    }
    let summary = match part.detail.text("delta") {
        Some(delta) => delta.to_string(),
        None => output_for_activity(part),
    };
    !text::trim(&summary).is_empty()
}

fn estimate_legacy_part_height(part: &Part) -> f64 {
    match part.kind.as_str() {
        "assistant" => {
            let length = text::len16(&part.text) as f64;
            640f64.min(50. + (length / 64.).ceil() * 20.)
        }
        "user" => 64.,
        _ => 34.,
    }
}

fn submission_row_id(id: &str) -> String {
    format!("row:submission:{id}")
}

/// `draftReferenceDisplay(reference)`.
fn draft_reference_display(reference: &DraftReference) -> ReferenceDisplay {
    let staged = reference.kind == ReferenceKind::StagedAttachment;
    let workspace = reference.kind == ReferenceKind::WorkspaceEntry;
    let kind = if staged {
        ReferenceDisplayKind::Attachment
    } else if reference.entry_type == Some(EntryType::Directory) {
        ReferenceDisplayKind::WorkspaceDirectory
    } else {
        ReferenceDisplayKind::WorkspaceFile
    };
    ReferenceDisplay {
        id: reference.id.clone(),
        kind,
        display_name: reference.display_name.clone(),
        relative_path: workspace.then(|| reference.relative_path.clone()).flatten(),
        workspace_name: workspace
            .then(|| reference.workspace_name.clone().filter(|n| !n.is_empty()))
            .flatten(),
        mime: staged.then(|| reference.mime.clone()).flatten(),
        size: staged.then_some(reference.size).flatten(),
    }
}
