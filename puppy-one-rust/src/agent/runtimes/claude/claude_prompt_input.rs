//! `runtimes/claude/claude-prompt-input.mjs`: authorized semantic
//! references as Claude Agent SDK `MessageParam` content.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::agent::domain::agent_reference_error::{agent_reference_error, codes};
use crate::agent::node_path;
use crate::agent::security::authorized_workspace_reference_prompt::{
    authorized_workspace_reference_path, format_authorized_workspace_reference_prompt,
};
use base64::Engine;
use serde_json::{Value, json};

/// `CLAUDE_NATIVE_IMAGE_MIME_TYPES`.
pub const CLAUDE_NATIVE_IMAGE_MIME_TYPES: &[&str] =
    &["image/png", "image/jpeg", "image/gif", "image/webp"];
/// `CLAUDE_NATIVE_IMAGE_MAX_BYTES`.
pub const CLAUDE_NATIVE_IMAGE_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn reference_error(code: &'static str, message: &str) -> AgentError {
    agent_reference_error(code, message).into()
}

/// `buildClaudeUserMessageContent({ prompt, references, workspaceRoot })`:
/// prompt text, or text plus native image blocks.
pub fn build_claude_user_message_content(
    prompt: &str,
    references: &[Value],
    workspace_root: &str,
) -> AgentResult<Value> {
    let mut workspace_references = Vec::new();
    let mut image_blocks = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for reference in references {
        let Some(filename) = reference
            .get("path")
            .and_then(Value::as_str)
            .map(|path| node_path::resolve_one(path).to_string_lossy().into_owned())
        else {
            return Err(reference_error(
                codes::INVALID_INPUT,
                "Claude Code received an invalid reference input.",
            ));
        };
        if seen.contains(&filename) {
            continue;
        }
        seen.push(filename.clone());
        let staged = reference.get("kind").and_then(Value::as_str) == Some("staged-attachment");
        if !staged && authorized_workspace_reference_path(reference, Some(workspace_root)).is_none()
        {
            return Err(reference_error(
                codes::UNAUTHORIZED,
                "Claude Code received an unauthorized workspace reference outside the assigned workspace.",
            ));
        }
        if let Some(mime) = reference
            .get("mime")
            .and_then(Value::as_str)
            .filter(|mime| CLAUDE_NATIVE_IMAGE_MIME_TYPES.contains(mime))
        {
            image_blocks.push(materialize_image(mime, &filename)?);
            continue;
        }
        let path_mention = reference.get("inlineMentioned") == Some(&Value::Bool(true))
            && reference.get("mentionDelivery").and_then(Value::as_str) == Some("path");
        if !staged || path_mention {
            let kind = if staged {
                "staged-attachment"
            } else {
                "workspace-entry"
            };
            workspace_references.push(js::with(
                &js::with(reference, "kind", kind),
                "path",
                filename,
            ));
            continue;
        }
        return Err(reference_error(
            codes::UNSUPPORTED_KIND,
            "Claude Code received an unsupported staged attachment type for the native Agent SDK input contract.",
        ));
    }
    let text = format_authorized_workspace_reference_prompt(
        prompt,
        &workspace_references,
        Some(workspace_root),
    );
    if image_blocks.is_empty() {
        return Ok(Value::from(text));
    }
    let mut content = vec![json!({ "type": "text", "text": text })];
    content.extend(image_blocks);
    Ok(Value::Array(content))
}

fn materialize_image(mime: &str, filename: &str) -> AgentResult<Value> {
    let safe = std::fs::symlink_metadata(filename).is_ok_and(|metadata| {
        metadata.is_file()
            && !metadata.file_type().is_symlink()
            && metadata.len() <= CLAUDE_NATIVE_IMAGE_MAX_BYTES
    });
    if !safe {
        return Err(reference_error(
            codes::MATERIALIZATION_FAILED,
            "Claude Code could not safely materialize the staged image attachment.",
        ));
    }
    let bytes = std::fs::read(filename).map_err(|_| {
        reference_error(
            codes::MATERIALIZATION_FAILED,
            "Claude Code could not read the staged image attachment.",
        )
    })?;
    Ok(json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": mime,
            "data": base64::engine::general_purpose::STANDARD.encode(&bytes),
        },
    }))
}
