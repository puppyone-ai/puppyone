//! `runtimes/codex/codex-reference-input.mjs`: a turn's prompt and
//! references as Codex `UserInput` items.
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js;
use crate::agent::domain::agent_reference_error::{agent_reference_error, codes};
use crate::agent::security::authorized_workspace_reference_prompt::{
    authorized_workspace_reference_path, format_authorized_workspace_reference_prompt,
};
use serde_json::{Value, json};

/// `CODEX_NATIVE_IMAGE_MIME_TYPES`.
pub const CODEX_NATIVE_IMAGE_MIME_TYPES: &[&str] =
    &["image/png", "image/jpeg", "image/gif", "image/webp"];

/// `buildCodexTurnInput(prompt, references, workspaceRoot)`.
pub fn build_codex_turn_input(
    prompt: &str,
    references: &[Value],
    workspace_root: Option<&str>,
) -> AgentResult<Vec<Value>> {
    let mut workspace_references = Vec::new();
    let mut native_images = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for reference in references {
        if !reference
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|path| !path.is_empty())
        {
            return Err(agent_reference_error(
                codes::INVALID_INPUT,
                "Codex received an invalid reference input.",
            )
            .into());
        }
        let authorized = authorize_workspace_reference(reference, workspace_root)?;
        let path = js::str_or_empty(authorized.get("path")).to_string();
        if seen.contains(&path) {
            continue;
        }
        seen.push(path.clone());
        if is_native_image_reference(&authorized) {
            native_images.push(json!({ "type": "localImage", "path": path }));
            continue;
        }
        let kind = js::str_or_empty(authorized.get("kind"));
        if kind == "workspace-entry"
            || (kind == "staged-attachment"
                && authorized.get("inlineMentioned") == Some(&Value::Bool(true))
                && authorized.get("mentionDelivery").and_then(Value::as_str) == Some("path"))
        {
            workspace_references.push(authorized);
            continue;
        }
        return Err(agent_reference_error(
            codes::UNSUPPORTED_KIND,
            "Codex does not support this reference input type.",
        )
        .into());
    }
    let text = format_authorized_workspace_reference_prompt(
        prompt,
        &workspace_references,
        Some(workspace_root.unwrap_or(".")),
    );
    let mut input = vec![json!({ "type": "text", "text": text, "text_elements": [] })];
    input.extend(native_images);
    Ok(input)
}

fn authorize_workspace_reference(
    reference: &Value,
    workspace_root: Option<&str>,
) -> AgentResult<Value> {
    if reference.get("kind").and_then(Value::as_str) != Some("workspace-entry") {
        return Ok(reference.clone());
    }
    let Some(workspace_root) = workspace_root else {
        return Err(agent_reference_error(
            codes::UNAUTHORIZED,
            "Codex workspace references require an assigned workspace root.",
        )
        .into());
    };
    let Some(authorized_path) =
        authorized_workspace_reference_path(reference, Some(workspace_root))
    else {
        return Err(agent_reference_error(
            codes::UNAUTHORIZED,
            "Codex workspace reference is outside the assigned workspace root.",
        )
        .into());
    };
    Ok(js::with(reference, "path", authorized_path))
}

fn is_native_image_reference(reference: &Value) -> bool {
    matches!(
        reference.get("kind").and_then(Value::as_str),
        Some("workspace-entry" | "staged-attachment")
    ) && reference
        .get("mime")
        .and_then(Value::as_str)
        .is_some_and(|mime| CODEX_NATIVE_IMAGE_MIME_TYPES.contains(&mime))
}
