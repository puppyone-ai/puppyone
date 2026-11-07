//! `protocols/pi-rpc/pi-prompt-input.mjs`: authorized semantic references
//! as Pi's native prompt + images command.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::agent::domain::agent_reference_error::{agent_reference_error, codes};
use crate::agent::security::authorized_workspace_reference_prompt::{
    authorized_workspace_reference_path, format_authorized_workspace_reference_prompt,
};
use crate::platform::paths;
use crate::text;
use base64::Engine;
use serde_json::{Value, json};

/// `PI_NATIVE_IMAGE_MIME_TYPES`.
pub const PI_NATIVE_IMAGE_MIME_TYPES: &[&str] =
    &["image/png", "image/jpeg", "image/gif", "image/webp"];
pub const PI_NATIVE_IMAGE_MAX_BYTES: u64 = 5 * 1024 * 1024;
pub const PI_NATIVE_IMAGE_MAX_TOTAL_BYTES: u64 = 5 * 1024 * 1024;

/// `{ message, images }`.
#[derive(Clone, Debug, PartialEq)]
pub struct PiTurnInput {
    pub message: String,
    pub images: Vec<Value>,
}

fn reference_error(code: &'static str, message: impl Into<String>) -> AgentError {
    agent_reference_error(code, message).into()
}

/// `buildPiTurnInput({ prompt, references, workspaceRoot, runtimeLabel })`.
pub fn build_pi_turn_input(
    prompt: &str,
    references: &[Value],
    workspace_root: Option<&str>,
    runtime_label: Option<&str>,
) -> AgentResult<PiTurnInput> {
    let label = runtime_label
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| text::head16(l, 80).to_string())
        .unwrap_or_else(|| "Pi".into());
    let mut path_references = Vec::new();
    let mut images = Vec::new();
    let mut image_bytes = 0u64;
    let mut seen: Vec<String> = Vec::new();
    for reference in references {
        let filename = resolve_reference_path(reference, workspace_root)?;
        if seen.contains(&filename) {
            continue;
        }
        seen.push(filename.clone());
        let kind = reference.get("kind").and_then(Value::as_str);
        if kind == Some("workspace-entry")
            && authorized_workspace_reference_path(reference, workspace_root).is_none()
        {
            return Err(reference_error(
                codes::UNAUTHORIZED,
                format!("{label} received a workspace reference outside the assigned workspace."),
            ));
        }
        let mime = reference.get("mime").and_then(Value::as_str);
        if let Some(mime) = mime.filter(|mime| PI_NATIVE_IMAGE_MIME_TYPES.contains(mime)) {
            let (length, image) = materialize_image(mime, &filename)?;
            image_bytes += length;
            if image_bytes > PI_NATIVE_IMAGE_MAX_TOTAL_BYTES {
                return Err(reference_error(
                    codes::LIMIT_EXCEEDED,
                    format!("{label} image attachments exceed the native RPC frame limit."),
                ));
            }
            images.push(image);
            continue;
        }
        if kind == Some("workspace-entry")
            || (kind == Some("staged-attachment")
                && reference.get("inlineMentioned") == Some(&Value::Bool(true))
                && reference.get("mentionDelivery").and_then(Value::as_str) == Some("path"))
        {
            path_references.push(js::with(reference, "path", filename));
            continue;
        }
        return Err(reference_error(
            codes::UNSUPPORTED_KIND,
            format!("{label} accepts non-image file attachments only as native path mentions."),
        ));
    }
    Ok(PiTurnInput {
        message: format_authorized_workspace_reference_prompt(
            prompt,
            &path_references,
            workspace_root,
        ),
        images,
    })
}

fn materialize_image(mime: &str, filename: &str) -> AgentResult<(u64, Value)> {
    let metadata = std::fs::symlink_metadata(filename).ok();
    if !metadata.is_some_and(|m| {
        m.is_file() && !m.file_type().is_symlink() && m.len() <= PI_NATIVE_IMAGE_MAX_BYTES
    }) {
        return Err(reference_error(
            codes::MATERIALIZATION_FAILED,
            "The Pi RPC runtime could not safely materialize the image attachment.",
        ));
    }
    let bytes = std::fs::read(filename).map_err(|_| {
        reference_error(
            codes::MATERIALIZATION_FAILED,
            "The Pi RPC runtime could not read the image attachment.",
        )
    })?;
    Ok((
        bytes.len() as u64,
        json!({
            "type": "image",
            "data": base64::engine::general_purpose::STANDARD.encode(&bytes),
            "mimeType": mime,
        }),
    ))
}

fn resolve_reference_path(reference: &Value, workspace_root: Option<&str>) -> AgentResult<String> {
    let Some(path) = reference
        .get("path")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
    else {
        return Err(reference_error(
            codes::INVALID_INPUT,
            "Pi received an invalid reference input.",
        ));
    };
    if paths::is_absolute(path) {
        return Ok(paths::absolute(path).to_string_lossy().into_owned());
    }
    match workspace_root.filter(|root| paths::is_absolute(root)) {
        Some(root) => Ok(paths::resolve(root, path).to_string_lossy().into_owned()),
        None => Err(reference_error(
            codes::UNAUTHORIZED,
            "Pi requires an assigned workspace root.",
        )),
    }
}
