//! `domain/agent-prompt-mentions.ts`.
use crate::agent::contract::js;
use crate::agent::contract::reference_identity::agent_reference_mention_text;
use crate::agent::contract::reference_input::classify_agent_attachment;
use serde_json::Value;
use std::collections::HashSet;

/// `isAgentMediaReference(reference)`: images are native media inputs.
/// Every other reference is an inline path mention.
pub fn is_agent_media_reference(reference: &Value) -> bool {
    if reference["kind"] == "workspace-directory" || reference["entryType"] == "directory" {
        return false;
    }
    classify_agent_attachment(
        reference["mime"].as_str().unwrap_or_default(),
        reference["displayName"].as_str().unwrap_or_default(),
    ) == "image"
}

/// `agentPromptMentionText(reference)`.
pub fn agent_prompt_mention_text(reference: &Value) -> String {
    agent_reference_mention_text(reference)
}

/// `normalizeAgentPromptMentions(prompt, mentions, referenceIds)`.
pub fn normalize_agent_prompt_mentions(
    prompt: &str,
    mentions: &[Value],
    reference_ids: Option<&HashSet<String>>,
) -> Vec<Value> {
    let length = js::len16(prompt) as i64;
    let boundary = 0i64;
    let mut candidates: Vec<(i64, i64, &Value)> = mentions
        .iter()
        .filter_map(|mention| {
            let reference_id = mention["referenceId"].as_str()?;
            let start = js::safe_integer(&mention["start"])?;
            let end = js::safe_integer(&mention["end"])?;
            let valid = start >= boundary
                && end > start
                && end <= length
                && reference_ids.is_none_or(|ids| ids.contains(reference_id));
            valid.then_some((start, end, mention))
        })
        .collect();
    candidates.sort_by_key(|(start, _, _)| *start);
    let mut boundary = 0i64;
    candidates
        .into_iter()
        .filter(|(start, end, _)| {
            if *start < boundary {
                return false;
            }
            boundary = *end;
            true
        })
        .map(|(_, _, mention)| mention.clone())
        .collect()
}

/// One `splitAgentPromptMentions` part.
#[derive(Clone, Debug, PartialEq)]
pub enum PromptPart {
    Text(String),
    Mention { text: String, mention: Value },
}

/// `splitAgentPromptMentions(prompt, mentions)`.
pub fn split_agent_prompt_mentions(prompt: &str, mentions: &[Value]) -> Vec<PromptPart> {
    let normalized = normalize_agent_prompt_mentions(prompt, mentions, None);
    let mut parts = Vec::new();
    let mut cursor = 0usize;
    for mention in normalized {
        let start = mention["start"].as_u64().unwrap_or(0) as usize;
        let end = mention["end"].as_u64().unwrap_or(0) as usize;
        if start > cursor {
            parts.push(PromptPart::Text(
                js::slice16(prompt, cursor, start).to_string(),
            ));
        }
        parts.push(PromptPart::Mention {
            text: js::slice16(prompt, start, end).to_string(),
            mention,
        });
        cursor = end;
    }
    if cursor < js::len16(prompt) {
        parts.push(PromptPart::Text(js::tail16(prompt, cursor).to_string()));
    }
    parts
}
