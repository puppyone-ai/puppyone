//! Port of `bridge/payload-projector.mjs`. Runs in the hook process: only
//! the event, identifiers, the tool name, the working directory and
//! path-like fields leave it.
use super::{bounded_path, identifier, limits, shell_intent};
use serde_json::{Map, Value};

const PATH_KEYS: [&str; 12] = [
    "file_path",
    "filepath",
    "path",
    "paths",
    "directory",
    "root",
    "target_path",
    "source_path",
    "old_path",
    "new_path",
    "from",
    "to",
];

/// The projected payload a frame carries.
#[derive(Clone, Debug, PartialEq)]
pub struct Projected {
    pub event_name: String,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub tool_call_id: String,
    pub tool_name: String,
    pub cwd: String,
    /// Path fields: a string or an array of strings per key.
    pub input: Map<String, Value>,
}
impl Projected {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "eventName": self.event_name,
            "sessionId": self.session_id,
            "turnId": self.turn_id,
            "toolCallId": self.tool_call_id,
            "toolName": self.tool_name,
            "cwd": self.cwd,
            "input": self.input,
        })
    }
    /// `isProjectedPayload` (`activity-frame-policy.mjs`).
    pub fn from_json(value: &Value) -> Option<Self> {
        let text = |key: &str, max: usize| {
            value
                .get(key)
                .and_then(Value::as_str)
                .filter(|v| identifier(v, max))
                .map(str::to_owned)
        };
        let nullable = |key: &str| match value.get(key) {
            Some(Value::Null) => Some(None),
            Some(Value::String(v)) if identifier(v, 160) => Some(Some(v.clone())),
            _ => None,
        };
        let input = value.get("input")?.as_object()?;
        let key_ok = |key: &str| {
            let mut chars = key.chars();
            key.len() <= 64
                && chars.next().is_some_and(|c| c.is_ascii_lowercase())
                && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        };
        let item_ok = |item: &Value| match item {
            Value::String(path) => bounded_path(path),
            Value::Array(items) => {
                items.len() <= limits::TARGETS_PER_ACTIVITY
                    && items.iter().all(|i| i.as_str().is_some_and(bounded_path))
            }
            _ => false,
        };
        if input.len() > 16 || !input.iter().all(|(k, v)| key_ok(k) && item_ok(v)) {
            return None;
        }
        Some(Self {
            event_name: text("eventName", 96)?,
            session_id: nullable("sessionId")?,
            turn_id: nullable("turnId")?,
            tool_call_id: text("toolCallId", 160)?,
            tool_name: text("toolName", limits::STRING_LENGTH)?,
            cwd: text("cwd", limits::PATH_LENGTH)?,
            input: input.clone(),
        })
    }
}

/// `projectAgentHookPayload`. `cwd` stands in when the payload names none
/// (the hook process's working directory).
pub fn project(raw: &Value, cwd: &str) -> Option<Projected> {
    let raw = raw.as_object()?;
    let at = |key: &str| raw.get(key);
    let nested = |outer: &str, key: &str| raw.get(outer).and_then(|v| v.get(key));
    let event_name = first_string([at("hook_event_name"), at("event_name"), at("event")])?;
    let tool_name = first_string([at("tool_name"), nested("tool", "name"), at("name")])
        .unwrap_or_else(|| "unknown".into());
    let cwd = first_string([at("cwd"), at("working_directory")])
        .or_else(|| (!cwd.is_empty()).then(|| cwd.to_owned()))?;
    let empty = Map::new();
    let native = [at("tool_input"), at("input"), at("args")]
        .into_iter()
        .flatten()
        .find_map(Value::as_object)
        .unwrap_or(&empty);
    let mut input = project_path_input(native, &tool_name);
    let read_paths = shell_intent::project_read_paths(&tool_name, &Value::Object(native.clone()));
    if !read_paths.is_empty() {
        input.insert("read_paths".into(), read_paths.into());
    }
    let session_id = first_string([at("session_id"), at("conversation_id"), at("task_id")]);
    let turn_id = first_string([at("turn_id"), nested("extra", "turn_id")]);
    let tool_call_id = first_string([
        at("tool_use_id"),
        at("tool_call_id"),
        at("call_id"),
        nested("extra", "tool_call_id"),
    ])
    .unwrap_or_else(|| fallback_tool_call_id(&session_id, &turn_id, &tool_name, &input));
    Some(Projected {
        event_name: bounded(&event_name, 96),
        session_id: session_id.map(|v| bounded(&v, 160)),
        turn_id: turn_id.map(|v| bounded(&v, 160)),
        tool_call_id: bounded(&tool_call_id, 160),
        tool_name: bounded(&tool_name, limits::STRING_LENGTH),
        cwd: bounded(&cwd, limits::PATH_LENGTH),
        input,
    })
}

/// `projectPathInput`: path-named fields up to three levels deep. A field
/// with one path keeps its key; the rest (and patch headers of patch tools)
/// collect under `paths`.
pub fn project_path_input(value: &Map<String, Value>, tool_name: &str) -> Map<String, Value> {
    let mut projected = Map::new();
    let mut collected = Vec::new();
    collect(value, &mut projected, &mut collected, 0);
    if tool_name.to_lowercase().contains("patch")
        && let Some(command) = value.get("command").and_then(Value::as_str)
    {
        collected.extend(extract_patch_paths(command));
    }
    let paths = dedupe(collected);
    if !paths.is_empty() {
        projected.insert("paths".into(), paths.into());
    }
    projected
}

/// `extractPatchPaths`: `*** Add/Update/Delete File:`, `*** Move to:` and
/// unified-diff `---`/`+++` headers.
pub fn extract_patch_paths(command: &str) -> Vec<String> {
    use std::sync::OnceLock;
    static MARKERS: OnceLock<[regex::Regex; 3]> = OnceLock::new();
    let markers = MARKERS.get_or_init(|| {
        [
            regex::Regex::new(r"^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$").unwrap(),
            regex::Regex::new(r"^\*\*\* Move to:\s+(.+)$").unwrap(),
            regex::Regex::new(r"^(?:---|\+\+\+)\s+(?:[ab]/)?([^\t]+)(?:\t.*)?$").unwrap(),
        ]
    });
    if command.len() > limits::FRAME_BYTES * 4 {
        return vec![];
    }
    let mut paths = Vec::new();
    for line in command.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let Some(found) = markers
            .iter()
            .find_map(|m| m.captures(line))
            .and_then(|c| c.get(1))
        else {
            continue;
        };
        if found.as_str() == "/dev/null" {
            continue;
        }
        if let Some(path) = sanitize(&Value::String(found.as_str().into())) {
            paths.push(path);
        }
        if paths.len() >= limits::TARGETS_PER_ACTIVITY {
            break;
        }
    }
    dedupe(paths)
}

fn collect(
    value: &Map<String, Value>,
    projected: &mut Map<String, Value>,
    collected: &mut Vec<String>,
    depth: usize,
) {
    if depth > 3 {
        return;
    }
    for (raw_key, item) in value {
        let key = raw_key.to_lowercase();
        if PATH_KEYS.contains(&key.as_str()) {
            let paths: Vec<String> = match item {
                Value::Array(items) => items.iter().filter_map(sanitize).collect(),
                other => sanitize(other).into_iter().collect(),
            };
            if paths.len() == 1 && key != "paths" {
                projected.insert(key, paths[0].clone().into());
            } else {
                collected.extend(paths);
            }
            continue;
        }
        match item {
            Value::Object(map) => collect(map, projected, collected, depth + 1),
            Value::Array(items) => {
                for entry in items.iter().take(limits::TARGETS_PER_ACTIVITY) {
                    if let Value::Object(map) = entry {
                        collect(map, projected, collected, depth + 1);
                    }
                }
            }
            _ => {}
        }
    }
}

fn sanitize(value: &Value) -> Option<String> {
    let candidate = value.as_str()?.trim();
    bounded_path(candidate).then(|| candidate.to_owned())
}

fn dedupe(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .filter(|v| !v.is_empty() && seen.insert(v.clone()))
        .take(limits::TARGETS_PER_ACTIVITY)
        .collect()
}

/// `fallbackToolCallId`: a stable id for providers that name no call, so the
/// started and finished events of one call correlate.
fn fallback_tool_call_id(
    session: &Option<String>,
    turn: &Option<String>,
    tool: &str,
    input: &Map<String, Value>,
) -> String {
    use sha2::Digest as _;
    let key =
        serde_json::to_string(&serde_json::json!([session, turn, tool, input])).unwrap_or_default();
    let digest = sha2::Sha256::digest(key.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("derived-{}", &hex[..24])
}

fn first_string<const N: usize>(values: [Option<&Value>; N]) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .find_map(|v| v.as_str().filter(|s| !s.is_empty()).map(str::to_owned))
}

/// `bounded`: at most `max` characters, NUL/CR/LF as spaces.
fn bounded(value: &str, max: usize) -> String {
    value
        .chars()
        .take(max)
        .map(|c| {
            if matches!(c, '\0' | '\r' | '\n') {
                ' '
            } else {
                c
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;
    #[test]
    fn a_claude_tool_event_keeps_only_paths_and_identity() {
        let raw = json!({
            "hook_event_name": "PreToolUse",
            "session_id": "s-1",
            "tool_name": "Edit",
            "tool_use_id": "toolu_1",
            "cwd": "/repo",
            "transcript_path": "/secret/transcript.jsonl",
            "tool_input": { "file_path": "src/a.rs", "old_string": "secret", "new_string": "x" }
        });
        let p = project(&raw, "/elsewhere").unwrap();
        assert_eq!(p.event_name, "PreToolUse");
        assert_eq!(p.session_id.as_deref(), Some("s-1"));
        assert_eq!(p.tool_call_id, "toolu_1");
        assert_eq!(p.cwd, "/repo");
        assert_eq!(
            Value::Object(p.input.clone()),
            json!({ "file_path": "src/a.rs" })
        );
        assert_eq!(Projected::from_json(&p.to_json()), Some(p));
    }
    #[test]
    fn patches_shell_reads_and_nested_fields_project_paths() {
        let patch = "*** Begin Patch\n*** Update File: src/a.rs\n*** Add File: b.md\n--- a/c.txt\n+++ b/c.txt\n--- /dev/null\n*** End Patch";
        let p = project(
            &json!({ "event": "PreToolUse", "tool_name": "apply_patch", "tool_input": { "command": patch } }),
            "/repo",
        )
        .unwrap();
        assert_eq!(p.cwd, "/repo");
        assert_eq!(p.input["paths"], json!(["src/a.rs", "b.md", "c.txt"]));
        // No provider id: a derived, deterministic one.
        assert!(p.tool_call_id.starts_with("derived-"));
        assert_eq!(p.tool_call_id.len(), "derived-".len() + 24);
        let shell = project(
            &json!({ "hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": { "command": "cat a.txt b.txt" } }),
            "/repo",
        )
        .unwrap();
        assert_eq!(shell.input["read_paths"], json!(["a.txt", "b.txt"]));
        let nested = project_path_input(
            json!({ "edits": [{ "path": "x.rs" }, { "path": "y.rs" }], "paths": ["p", " ", "q\u{1}"], "deep": { "a": { "b": { "c": { "path": "too-deep" } } } } })
                .as_object()
                .unwrap(),
            "MultiEdit",
        );
        // The second nested `path` replaces the first, as in the product.
        assert_eq!(
            Value::Object(nested),
            json!({ "path": "y.rs", "paths": ["p"] })
        );
    }
    #[test]
    fn frames_with_unsafe_input_are_rejected() {
        let ok = json!({ "eventName": "e", "sessionId": null, "turnId": null, "toolCallId": "t", "toolName": "Read", "cwd": "/", "input": { "path": "a" } });
        assert!(Projected::from_json(&ok).is_some());
        for bad in [
            json!({ "Path": "a" }),
            json!({ "path": 1 }),
            json!({ "path": "a\u{0}" }),
            json!({ "path": "" }),
        ] {
            let mut frame = ok.clone();
            frame["input"] = bad;
            assert!(Projected::from_json(&frame).is_none());
        }
        let mut missing = ok.clone();
        missing.as_object_mut().unwrap().remove("turnId");
        assert!(Projected::from_json(&missing).is_none());
        assert!(project(&json!({ "tool_name": "Read" }), "/").is_none());
    }
}
