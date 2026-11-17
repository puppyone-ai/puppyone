//! `domain/agent-event-workspace-paths.mjs`: runtime harnesses may report
//! absolute host paths while the public Agent event contract is
//! workspace-relative. Normalize that protocol difference at the Main-owned
//! session boundary so Renderer projections and persisted replay records
//! never need to infer filesystem identity.
use crate::agent::contract::js;
use crate::agent::contract::types::AgentEventView;
use crate::text;
use serde_json::{Map, Value};
use std::path::{Component, Path, PathBuf};

const ACTIVITY_EVENT_TYPES: &[&str] = &[
    "tool.started",
    "tool.progress",
    "tool.completed",
    "file.change.updated",
    "provider.activity",
];
const PATH_KEYS: &[&str] = &["path", "file", "filepath", "file_path", "filePath"];

/// `normalizeAgentEventWorkspacePaths(event, workspaceRoot)`.
pub fn normalize_agent_event_workspace_paths(event: &Value, workspace_root: &str) -> Value {
    if !ACTIVITY_EVENT_TYPES.contains(&event.event_type()) {
        return event.clone();
    }
    let Some(payload) = event.get("payload").filter(|p| p.is_object()) else {
        return event.clone();
    };
    if !Path::new(workspace_root).is_absolute() {
        return event.clone();
    }
    let mut replacements: Vec<(String, String)> = Vec::new();
    let mut payload = normalize_activity_payload(payload, workspace_root, &mut replacements);
    for key in ["label", "title", "summary"] {
        if let Some(Value::String(text)) = payload.get(key) {
            let replaced = replace_path_mentions(text, &replacements);
            payload[key] = Value::String(replaced);
        }
    }
    js::with(event, "payload", payload)
}

/// `path.resolve` without touching the filesystem.
fn resolve(base: &Path, candidate: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base.join(candidate)
    };
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// `normalizeAgentWorkspaceEventPath(workspaceRoot, candidate)`.
pub fn normalize_agent_workspace_event_path(
    workspace_root: &str,
    candidate: &str,
) -> Option<String> {
    let root_path = Path::new(workspace_root);
    if !root_path.is_absolute() || text::trim(candidate).is_empty() || candidate.contains("://") {
        return None;
    }
    let root = resolve(Path::new("/"), root_path);
    let resolved = resolve(&root, Path::new(candidate));
    let relative = resolved.strip_prefix(&root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    Some(
        relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

fn normalize_activity_payload(
    payload: &Value,
    root: &str,
    replacements: &mut Vec<(String, String)>,
) -> Value {
    let mut next = normalize_path_fields(payload, root, replacements);
    if let Some(input) = next.get("input").filter(|v| v.is_object()).cloned() {
        let mut input = normalize_path_fields(&input, root, replacements);
        if let Some(changes) = input.get("changes").and_then(Value::as_array).cloned() {
            input["changes"] = Value::Array(normalize_changes(&changes, root, replacements));
        }
        next["input"] = input;
    }
    if let Some(changes) = next.get("changes").and_then(Value::as_array).cloned() {
        next["changes"] = Value::Array(normalize_changes(&changes, root, replacements));
    }
    if let Some(locations) = next.get("locations").and_then(Value::as_array).cloned() {
        next["locations"] = Value::Array(
            locations
                .iter()
                .filter(|l| l.is_object())
                .map(|location| normalize_path_fields(location, root, replacements))
                .filter(|normalized| normalized.get("path").is_some_and(Value::is_string))
                .collect(),
        );
    }
    next
}

fn normalize_changes(
    changes: &[Value],
    root: &str,
    replacements: &mut Vec<(String, String)>,
) -> Vec<Value> {
    changes
        .iter()
        .take(100)
        .filter(|c| c.is_object())
        .map(|change| normalize_path_fields(change, root, replacements))
        .filter(|normalized| {
            PATH_KEYS
                .iter()
                .any(|key| normalized.get(*key).is_some_and(Value::is_string))
        })
        .collect()
}

fn normalize_path_fields(
    value: &Value,
    root: &str,
    replacements: &mut Vec<(String, String)>,
) -> Value {
    let mut next: Map<String, Value> = value.as_object().cloned().unwrap_or_default();
    for key in PATH_KEYS {
        let Some(original) = next.get(*key).and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        match normalize_agent_workspace_event_path(root, &original) {
            None => {
                next.shift_remove(*key);
                let base = Path::new(&original)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| "file".into());
                set_replacement(replacements, original, base);
            }
            Some(normalized) => {
                next.insert((*key).into(), Value::from(normalized.as_str()));
                if original != normalized {
                    set_replacement(replacements, original, normalized);
                }
            }
        }
    }
    Value::Object(next)
}

/// `replacements.set(original, normalized)` on an insertion-ordered map.
fn set_replacement(replacements: &mut Vec<(String, String)>, original: String, normalized: String) {
    match replacements.iter_mut().find(|(key, _)| *key == original) {
        Some(entry) => entry.1 = normalized,
        None => replacements.push((original, normalized)),
    }
}

fn replace_path_mentions(value: &str, replacements: &[(String, String)]) -> String {
    let mut next = value.to_string();
    for (original, normalized) in replacements {
        if !original.is_empty() {
            next = next.replace(original.as_str(), normalized);
        }
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn absolute_paths_become_workspace_relative() {
        assert_eq!(
            normalize_agent_workspace_event_path("/w", "/w/a/b.md").as_deref(),
            Some("a/b.md")
        );
        assert_eq!(
            normalize_agent_workspace_event_path("/w", "a/../b.md").as_deref(),
            Some("b.md")
        );
        assert_eq!(
            normalize_agent_workspace_event_path("/w", "/other/b.md"),
            None
        );
        assert_eq!(normalize_agent_workspace_event_path("/w", "/w"), None);
        let event = json!({"type": "tool.completed", "payload": {
            "path": "/w/a.md", "label": "Edit /w/a.md and /etc/passwd", "input": {"file_path": "/etc/passwd"},
        }});
        let normalized = normalize_agent_event_workspace_paths(&event, "/w");
        assert_eq!(normalized["payload"]["path"], "a.md");
        assert_eq!(normalized["payload"]["label"], "Edit a.md and passwd");
        assert!(normalized["payload"]["input"].get("file_path").is_none());
    }
}
