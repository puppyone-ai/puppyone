//! `shared/agent-contract/reference-identity.mjs`.
use super::js;
use crate::text;
use serde_json::Value;

const MAX_WORKSPACE_RELATIVE_PATH_LENGTH: usize = 4_096;
const MAX_REFERENCE_LABEL_LENGTH: usize = 4_096;

fn is_control(c: char) -> bool {
    c <= '\u{1f}' || c == '\u{7f}'
}

/// Normalize the portable identity of a workspace reference.
///
/// Paths are POSIX-style and relative to the resource's owning root (the Agent
/// session root for legacy references). Absolute paths, traversal and control
/// characters are rejected instead of being silently repaired.
pub fn normalize_agent_workspace_relative_path(value: Option<&Value>) -> Option<String> {
    let value = value?.as_str()?;
    if value.is_empty() || text::len16(value) > MAX_WORKSPACE_RELATIVE_PATH_LENGTH {
        return None;
    }
    let bytes = value.as_bytes();
    let drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    if value.chars().any(is_control) || value.starts_with(['/', '\\']) || drive {
        return None;
    }
    let normalized = value.replace('\\', "/");
    let segments: Vec<&str> = normalized.split('/').collect();
    if segments.contains(&"..") {
        return None;
    }
    let joined = segments
        .iter()
        .filter(|s| !s.is_empty() && **s != ".")
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    Some(if joined.is_empty() {
        ".".into()
    } else {
        joined
    })
}

/// Human-readable, portable label used by both Composer and Main validation.
pub fn agent_reference_mention_label(reference: &Value) -> String {
    let field = |key: &str| js::get(reference, key);
    let display_name = || field("displayName").or_else(|| field("name"));
    if js::str_or_empty(field("kind")) == "workspace-entry"
        && let Some(relative_path) = normalize_agent_workspace_relative_path(field("relativePath"))
    {
        let label = if relative_path != "." {
            text::head16(&relative_path, MAX_REFERENCE_LABEL_LENGTH).to_string()
        } else {
            safe_reference_display_name(display_name())
        };
        return match field("workspaceName") {
            Some(name) if js::truthy(name) => {
                format!("{label} · {}", safe_reference_display_name(Some(name)))
            }
            _ => label,
        };
    }
    safe_reference_display_name(display_name())
}

pub fn agent_reference_mention_text(reference: &Value) -> String {
    format!("@{}", agent_reference_mention_label(reference))
}

/// [`agent_reference_mention_text`] of a draft reference.
pub fn mention_text(reference: &super::dto::DraftReference) -> String {
    agent_reference_mention_text(&serde_json::to_value(reference).unwrap_or_default())
}

fn safe_reference_display_name(value: Option<&Value>) -> String {
    let label = value
        .and_then(Value::as_str)
        .map(|text| {
            let spaced: String = text
                .chars()
                .map(|c| if is_control(c) { ' ' } else { c })
                .collect();
            text::head16(text::trim(&spaced), MAX_REFERENCE_LABEL_LENGTH).to_string()
        })
        .unwrap_or_default();
    if label.is_empty() {
        "file".into()
    } else {
        label
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn workspace_paths_stay_relative() {
        let norm = |v: &str| normalize_agent_workspace_relative_path(Some(&json!(v)));
        assert_eq!(norm("docs/./a.md").as_deref(), Some("docs/a.md"));
        assert_eq!(norm("docs\\a.md").as_deref(), Some("docs/a.md"));
        assert_eq!(norm("./").as_deref(), Some("."));
        assert_eq!(norm("../a"), None);
        assert_eq!(norm("/a"), None);
        assert_eq!(norm("C:a"), None);
        assert_eq!(norm("a\u{1}b"), None);
    }

    #[test]
    fn mention_labels_name_the_entry() {
        let reference = json!({"kind": "workspace-entry", "relativePath": "docs/a.md", "displayName": "a.md", "workspaceName": "Other"});
        assert_eq!(
            agent_reference_mention_text(&reference),
            "@docs/a.md · Other"
        );
        let root =
            json!({"kind": "workspace-entry", "relativePath": ".", "displayName": "Project"});
        assert_eq!(agent_reference_mention_label(&root), "Project");
        assert_eq!(
            agent_reference_mention_label(&json!({"name": " \u{1}"})),
            "file"
        );
    }
}
