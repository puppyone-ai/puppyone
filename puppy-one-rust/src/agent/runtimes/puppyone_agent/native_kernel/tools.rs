//! The kernel's managed tools (`managedTools`: read, bash, edit, write,
//! grep, find, ls) with Pi's argument names, run by the native workspace
//! tools, and `createPuppyOnePolicyExtension`: project-bound paths and an
//! approval before commands, file mutations or other non-read tools.
use super::super::puppyone_agent_kernel::PUPPYONE_AGENT_APPROVAL_PROTOCOL;
use super::super::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use super::super::tools as workspace;
use crate::text;
use serde_json::{Map, Value, json};
use sha2::Digest as _;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::AtomicBool;

const READ_TOOLS: [&str; 4] = ["read", "grep", "find", "ls"];
const WRITE_TOOLS: [&str; 2] = ["edit", "write"];

/// The tool definitions the model sees.
pub fn schema() -> Value {
    let path = json!({ "type": "string", "description": "Path relative to the project, or absolute inside it." });
    json!([
        { "type": "function", "function": { "name": "read", "description": "Read a UTF-8 file inside the project. Use offset and limit (1-based lines) for large files.",
            "parameters": { "type": "object", "properties": { "path": path, "offset": { "type": "number" }, "limit": { "type": "number" } }, "required": ["path"], "additionalProperties": false } } },
        { "type": "function", "function": { "name": "bash", "description": "Run a shell command with the project as its working directory. Requires the user's approval.",
            "parameters": { "type": "object", "properties": { "command": { "type": "string" }, "timeout": { "type": "number" } }, "required": ["command"], "additionalProperties": false } } },
        { "type": "function", "function": { "name": "edit", "description": "Replace exactly one occurrence of oldText with newText in a project file. Requires the user's approval.",
            "parameters": { "type": "object", "properties": { "path": path, "oldText": { "type": "string" }, "newText": { "type": "string" } }, "required": ["path", "oldText", "newText"], "additionalProperties": false } } },
        { "type": "function", "function": { "name": "write", "description": "Create or overwrite a UTF-8 project file. Requires the user's approval.",
            "parameters": { "type": "object", "properties": { "path": path, "content": { "type": "string" } }, "required": ["path", "content"], "additionalProperties": false } } },
        { "type": "function", "function": { "name": "grep", "description": "Search project files for a literal pattern; results carry line numbers.",
            "parameters": { "type": "object", "properties": { "pattern": { "type": "string" }, "path": path }, "required": ["pattern"], "additionalProperties": false } } },
        { "type": "function", "function": { "name": "find", "description": "Find project paths containing a literal name fragment.",
            "parameters": { "type": "object", "properties": { "pattern": { "type": "string" }, "path": path }, "required": ["pattern"], "additionalProperties": false } } },
        { "type": "function", "function": { "name": "ls", "description": "List one project directory.",
            "parameters": { "type": "object", "properties": { "path": path }, "additionalProperties": false } } },
    ])
}

/// `canonicalToolName(value)`.
pub fn canonical_tool_name(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .collect()
}

/// `toolPath(value)`.
fn tool_path(input: &Value) -> Option<String> {
    ["path", "filePath", "file_path"]
        .iter()
        .filter_map(|key| input.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|path| !path.is_empty())
        .map(str::to_string)
}

/// `isAuthorizedWorkspacePath(root, requested)`: the project-relative path,
/// or `None` outside the project.
pub fn project_relative(root: &Path, requested: &str) -> Option<PathBuf> {
    let candidate = Path::new(requested);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let mut normalized = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    let canonical_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let canonical = canonical_potential_path(&normalized);
    let relative = canonical
        .strip_prefix(&canonical_root)
        .or_else(|_| normalized.strip_prefix(root))
        .ok()?;
    Some(if relative.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        relative.to_path_buf()
    })
}

/// `canonicalPotentialPath(candidate)`: the nearest existing ancestor,
/// resolved, with the missing tail appended.
fn canonical_potential_path(candidate: &Path) -> PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(candidate) {
        return canonical;
    }
    match (candidate.parent(), candidate.file_name()) {
        (Some(parent), Some(name)) if parent != candidate => {
            canonical_potential_path(parent).join(name)
        }
        _ => candidate.to_path_buf(),
    }
}

/// What the policy decides before a tool runs.
pub enum Policy {
    Run,
    /// `{ block: true, terminate: true, reason }`.
    Terminate(String),
    /// The user must confirm `request` first.
    Confirm(Value),
}

/// `pi.on("tool_call")` in `createPuppyOnePolicyExtension`.
pub fn policy(root: &Path, tool_call_id: &str, name: &str, input: &Value) -> Policy {
    let tool = canonical_tool_name(name);
    let target = tool_path(input);
    if (READ_TOOLS.contains(&tool.as_str()) || WRITE_TOOLS.contains(&tool.as_str()))
        && let Some(target) = target.as_deref()
        && project_relative(root, target).is_none()
    {
        return Policy::Terminate(
            "PuppyOne blocked a tool path outside the assigned project.".into(),
        );
    }
    if READ_TOOLS.contains(&tool.as_str()) {
        return Policy::Run;
    }
    Policy::Confirm(approval_request(tool_call_id, &tool, input))
}

fn bounded_value(value: &Value, depth: usize) -> Value {
    if depth > 4 {
        return Value::from("[nested]");
    }
    match value {
        Value::String(text) => Value::from(text::head16(text, 8_192)),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .take(32)
                .map(|entry| bounded_value(entry, depth + 1))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .take(64)
                .map(|(key, entry)| {
                    (
                        text::head16(key, 120).to_string(),
                        bounded_value(entry, depth + 1),
                    )
                })
                .collect::<Map<_, _>>(),
        ),
        other => other.clone(),
    }
}

/// `approvalRequest(event, toolName)`.
fn approval_request(tool_call_id: &str, tool: &str, input: &Value) -> Value {
    let input = bounded_value(input, 0);
    let command_tool = tool == "bash";
    let command = if command_tool {
        input["command"].as_str().map(str::to_string)
    } else {
        None
    };
    let kind = if command_tool {
        "command"
    } else if WRITE_TOOLS.contains(&tool) {
        "file-change"
    } else {
        "tool"
    };
    let target = tool_path(&input);
    let subject = command.clone().or(target.clone());
    let title = match kind {
        "command" => "Run command".to_string(),
        "file-change" => "Change project files".to_string(),
        _ => format!("Use {tool}"),
    };
    let scope_subject = if command_tool {
        input.get("command").cloned()
    } else {
        target.map(Value::from)
    };
    let scope = sha2::Sha256::digest(
        serde_json::to_string(&scope_subject.unwrap_or_else(|| input.clone()))
            .unwrap_or_default()
            .as_bytes(),
    );
    let safe_id = (!tool_call_id.is_empty()
        && tool_call_id.len() <= 256
        && tool_call_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'.' | b'_' | b'-')))
    .then_some(tool_call_id);
    json!({
        "schema": PUPPYONE_AGENT_APPROVAL_PROTOCOL,
        "toolCallId": safe_id,
        "toolName": tool,
        "kind": kind,
        "title": title,
        "description": subject
            .map(|s| text::head16(&s, 2_000).to_string())
            .unwrap_or_else(|| format!("{BUILT_IN_AGENT_DISPLAY_NAME} requested a tool action.")),
        "reason": format!("{BUILT_IN_AGENT_DISPLAY_NAME} requires approval before commands, file mutations, or non-read-only tools."),
        "command": command,
        "arguments": input,
        "scopeKey": format!("{tool}:{}", hex(&scope)),
        "allowSession": true,
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A tool's result text and `details` (`{ patch }` for file changes).
pub struct ToolOutcome {
    pub text: String,
    pub is_error: bool,
    pub details: Value,
}

fn relative_input(root: &Path, input: &Value, default_dot: bool) -> Result<String, String> {
    match tool_path(input) {
        Some(path) => project_relative(root, &path)
            .map(|p| p.to_string_lossy().into_owned())
            .ok_or_else(|| "PuppyOne blocked a tool path outside the assigned project.".into()),
        None if default_dot => Ok(".".into()),
        None => Err("A path is required.".into()),
    }
}

fn read_text(root: &Path, relative: &str) -> Option<String> {
    std::fs::read_to_string(root.join(relative)).ok()
}

fn unified_patch(path: &str, before: &str, after: &str) -> String {
    similar::TextDiff::from_lines(before, after)
        .unified_diff()
        .context_radius(3)
        .header(path, path)
        .to_string()
}

/// Runs one tool (blocking).
pub fn execute(root: &Path, name: &str, input: &Value, cancel: &AtomicBool) -> ToolOutcome {
    let tool = canonical_tool_name(name);
    let result = (|| -> Result<(String, Value), String> {
        match tool.as_str() {
            "read" => {
                let path = relative_input(root, input, false)?;
                let text = workspace::execute(root, "read", &json!({ "path": path }), cancel)?;
                let offset = input["offset"].as_u64().unwrap_or(1).max(1) as usize;
                let limit = input["limit"].as_u64().map(|l| l as usize);
                let text = if offset > 1 || limit.is_some() {
                    text.lines()
                        .skip(offset - 1)
                        .take(limit.unwrap_or(usize::MAX))
                        .collect::<Vec<_>>()
                        .join("\n")
                } else {
                    text
                };
                Ok((text, json!({})))
            }
            "ls" => {
                let path = relative_input(root, input, true)?;
                Ok((
                    workspace::execute(root, "ls", &json!({ "path": path }), cancel)?,
                    json!({}),
                ))
            }
            "grep" | "find" => {
                let path = relative_input(root, input, true)?;
                let pattern = input["pattern"].as_str().unwrap_or_default();
                Ok((
                    workspace::execute(
                        root,
                        &tool,
                        &json!({ "path": path, "query": pattern }),
                        cancel,
                    )?,
                    json!({}),
                ))
            }
            "bash" => Ok((
                workspace::execute(
                    root,
                    "bash",
                    &json!({ "command": input["command"] }),
                    cancel,
                )?,
                json!({}),
            )),
            "write" => {
                let path = relative_input(root, input, false)?;
                let before = read_text(root, &path).unwrap_or_default();
                let content = input["content"].as_str().ok_or("Content is required.")?;
                let text = workspace::execute(
                    root,
                    "write",
                    &json!({ "path": path, "content": content }),
                    cancel,
                )?;
                Ok((
                    text,
                    json!({ "patch": unified_patch(&path, &before, content) }),
                ))
            }
            "edit" => {
                let path = relative_input(root, input, false)?;
                let before = read_text(root, &path).ok_or("The file could not be read.")?;
                let edits: Vec<(String, String)> = match input["edits"].as_array() {
                    Some(edits) => edits
                        .iter()
                        .map(|edit| {
                            (
                                edit["oldText"].as_str().unwrap_or_default().to_string(),
                                edit["newText"].as_str().unwrap_or_default().to_string(),
                            )
                        })
                        .collect(),
                    None => vec![(
                        input["oldText"].as_str().unwrap_or_default().to_string(),
                        input["newText"].as_str().unwrap_or_default().to_string(),
                    )],
                };
                let mut text = String::new();
                for (old, new) in edits {
                    text = workspace::execute(
                        root,
                        "edit",
                        &json!({ "path": path, "old_text": old, "new_text": new }),
                        cancel,
                    )?;
                }
                let after = read_text(root, &path).unwrap_or_default();
                Ok((
                    text,
                    json!({ "patch": unified_patch(&path, &before, &after) }),
                ))
            }
            _ => Err(format!("Unsupported tool: {name}")),
        }
    })();
    match result {
        Ok((text, details)) => ToolOutcome {
            text,
            is_error: false,
            details,
        },
        Err(error) => ToolOutcome {
            text: error,
            is_error: true,
            details: json!({}),
        },
    }
}
