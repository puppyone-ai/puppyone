//! `domain/agent-prompt-mentions.ts`.
use crate::agent::contract::dto::{
    DraftReference, EntryType, PromptMention, ReferenceDisplay, ReferenceDisplayKind,
};
use crate::agent::contract::reference_identity::mention_text;
use crate::agent::contract::reference_input::classify_agent_attachment;
use crate::text;
use std::collections::HashSet;

/// `isAgentMediaReference(reference)` of a draft reference: images are
/// native media inputs. Every other reference is an inline path mention.
pub fn is_agent_media_reference(reference: &DraftReference) -> bool {
    if reference.entry_type == Some(EntryType::Directory) {
        return false;
    }
    classify_agent_attachment(
        reference.mime.as_deref().unwrap_or_default(),
        &reference.display_name,
    ) == "image"
}

/// `isAgentMediaReference(reference)` of a transcript's reference.
pub fn is_agent_media_display(reference: &ReferenceDisplay) -> bool {
    if reference.kind == ReferenceDisplayKind::WorkspaceDirectory {
        return false;
    }
    classify_agent_attachment(
        reference.mime.as_deref().unwrap_or_default(),
        &reference.display_name,
    ) == "image"
}

/// `agentPromptMentionText(reference)`.
pub fn agent_prompt_mention_text(reference: &DraftReference) -> String {
    mention_text(reference)
}

/// `normalizeAgentPromptMentions(prompt, mentions, referenceIds)`.
pub fn normalize_agent_prompt_mentions(
    prompt: &str,
    mentions: &[PromptMention],
    reference_ids: Option<&HashSet<String>>,
) -> Vec<PromptMention> {
    let length = text::len16(prompt);
    let mut candidates: Vec<&PromptMention> = mentions
        .iter()
        .filter(|mention| {
            mention.end > mention.start
                && mention.end <= length
                && reference_ids.is_none_or(|ids| ids.contains(&mention.reference_id))
        })
        .collect();
    candidates.sort_by_key(|mention| mention.start);
    let mut boundary = 0usize;
    candidates
        .into_iter()
        .filter(|mention| {
            if mention.start < boundary {
                return false;
            }
            boundary = mention.end;
            true
        })
        .cloned()
        .collect()
}

/// One `splitAgentPromptMentions` part.
#[derive(Clone, Debug, PartialEq)]
pub enum PromptPart {
    Text(String),
    Mention {
        text: String,
        mention: PromptMention,
    },
}

/// `splitAgentPromptMentions(prompt, mentions)`.
pub fn split_agent_prompt_mentions(prompt: &str, mentions: &[PromptMention]) -> Vec<PromptPart> {
    let normalized = normalize_agent_prompt_mentions(prompt, mentions, None);
    let mut parts = Vec::new();
    let mut cursor = 0usize;
    for mention in normalized {
        let (start, end) = (mention.start, mention.end);
        if start > cursor {
            parts.push(PromptPart::Text(
                text::slice16(prompt, cursor, start).to_string(),
            ));
        }
        parts.push(PromptPart::Mention {
            text: text::slice16(prompt, start, end).to_string(),
            mention,
        });
        cursor = end;
    }
    if cursor < text::len16(prompt) {
        parts.push(PromptPart::Text(text::tail16(prompt, cursor).to_string()));
    }
    parts
}
