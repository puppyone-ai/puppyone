//! `protocols/acp/acp-prompt-input.mjs`: a turn's prompt and references as
//! ACP prompt content blocks.
use super::acp_limits::ACP_INLINE_IMAGE_MAX_BYTES;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::reference_input::classify_agent_attachment;
use crate::agent::domain::agent_reference_error::{agent_reference_error, codes};
use crate::agent::node_path;
use crate::agent::security::authorized_workspace_reference_prompt::authorized_workspace_reference_path;
use base64::Engine;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `ACP_NATIVE_IMAGE_MIME_TYPES`.
pub const ACP_NATIVE_IMAGE_MIME_TYPES: &[&str] =
    &["image/png", "image/jpeg", "image/gif", "image/webp"];

static DATA_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^data:([^;,]{1,160});base64,([A-Za-z0-9+/=]+)$").expect("data url pattern")
});
static UNSAFE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^A-Za-z0-9:._-]").expect("pattern"));

/// The negotiated native profile (`{ image, embeddedText }`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AcpReferenceProfile {
    pub image: bool,
    pub embedded_text: bool,
}

/// `text(value, limit)`: trimmed, at most `limit` UTF-16 units.
fn text(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(|s| js::head16(js::trim(s), limit).to_string())
        .unwrap_or_default()
}

/// `reference.displayName ?? reference.name`.
fn display_name(reference: &Value) -> Option<&Value> {
    reference
        .get("displayName")
        .filter(|v| !v.is_null())
        .or_else(|| reference.get("name"))
}

fn attachment_kind(reference: &Value) -> &'static str {
    classify_agent_attachment(
        js::str_or_empty(reference.get("mime")),
        display_name(reference)
            .and_then(Value::as_str)
            .unwrap_or(""),
    )
}

fn unsupported_attachment_error(kind: &str) -> AgentError {
    agent_reference_error(
        codes::MISSING_RUNTIME_CAPABILITY,
        format!("The ACP runtime does not accept {kind} attachments through its negotiated prompt capabilities."),
    )
    .into()
}

fn materialization_error(kind: &str) -> AgentError {
    agent_reference_error(
        codes::MATERIALIZATION_FAILED,
        format!("ACP could not safely materialize the staged {kind} attachment."),
    )
    .into()
}

fn native_image(mime: Option<&Value>) -> bool {
    mime.and_then(Value::as_str)
        .is_some_and(|mime| ACP_NATIVE_IMAGE_MIME_TYPES.contains(&mime))
}

/// `materializeAcpReferences(references, profile)`.
pub fn materialize_acp_references(
    references: &[Value],
    profile: AcpReferenceProfile,
) -> AgentResult<Vec<Value>> {
    references
        .iter()
        .map(|reference| {
            if reference.get("kind").and_then(Value::as_str) != Some("staged-attachment") {
                return Ok(reference.clone());
            }
            let kind = attachment_kind(reference);
            if kind == "image" && js::truthy_opt(reference.get("snapshotUrl")) {
                return Ok(reference.clone());
            }
            if kind == "image" && (!profile.image || !native_image(reference.get("mime"))) {
                return Err(unsupported_attachment_error(kind));
            }
            let path = reference
                .get("path")
                .and_then(Value::as_str)
                .filter(|path| node_path::is_absolute(path));
            let (Some(path), true) = (path, ["image", "text", "binary"].contains(&kind)) else {
                return Err(unsupported_attachment_error(kind));
            };
            let metadata = std::fs::symlink_metadata(path).ok();
            let Some(metadata) = metadata.filter(|m| m.is_file() && !m.file_type().is_symlink())
            else {
                return Err(materialization_error(kind));
            };
            if kind == "image" {
                if metadata.len() > ACP_INLINE_IMAGE_MAX_BYTES {
                    return Err(materialization_error(kind));
                }
                let bytes = std::fs::read(path).map_err(|_| materialization_error(kind))?;
                let url = format!(
                    "data:{};base64,{}",
                    js::str_or_empty(reference.get("mime")),
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                );
                return Ok(js::with(reference, "snapshotUrl", url));
            }
            if !profile.embedded_text
                || kind != "text"
                || metadata.len() > ACP_INLINE_IMAGE_MAX_BYTES
            {
                return Ok(reference.clone());
            }
            let bytes = std::fs::read(path)?;
            // The ACP baseline still accepts a resource link. Invalid UTF-8
            // should not turn a valid local path reference into a rejected
            // attachment.
            Ok(match String::from_utf8(bytes) {
                Ok(snapshot) => js::with(reference, "snapshotText", snapshot),
                Err(_) => reference.clone(),
            })
        })
        .collect()
}

/// `buildAcpPromptBlocks({ prompt, instructions, references, workspaceRoot, profile })`.
pub fn build_acp_prompt_blocks(
    prompt: &str,
    instructions: Option<&str>,
    references: &[Value],
    workspace_root: &str,
    profile: AcpReferenceProfile,
) -> AgentResult<Vec<Value>> {
    let content = match instructions.filter(|i| !i.is_empty()) {
        Some(instructions) => format!("{instructions}\n\nUser request:\n{prompt}"),
        None => prompt.to_string(),
    };
    let mut blocks = vec![json!({ "type": "text", "text": content })];
    let mut seen: Vec<String> = Vec::new();
    for reference in references {
        if reference.get("kind").and_then(Value::as_str) == Some("staged-attachment") {
            let kind = attachment_kind(reference);
            if kind == "image" {
                let image = data_url_parts(reference.get("snapshotUrl"));
                let mime = reference.get("mime").and_then(Value::as_str);
                let Some((image_mime, data)) = image.filter(|(image_mime, _)| {
                    profile.image
                        && native_image(reference.get("mime"))
                        && Some(image_mime.as_str()) == mime
                }) else {
                    return Err(materialization_error(kind));
                };
                blocks.push(json!({ "type": "image", "data": data, "mimeType": image_mime }));
                continue;
            }
            if kind == "text"
                && profile.embedded_text
                && let Some(snapshot) = reference.get("snapshotText").and_then(Value::as_str)
            {
                let mime = reference
                    .get("mime")
                    .filter(|m| js::truthy(m))
                    .cloned()
                    .unwrap_or_else(|| Value::from("text/plain"));
                blocks.push(json!({
                    "type": "resource",
                    "resource": { "uri": attachment_uri(reference), "mimeType": mime, "text": snapshot },
                }));
                continue;
            }
            if let Some(path) = reference
                .get("path")
                .and_then(Value::as_str)
                .filter(|path| ["text", "binary"].contains(&kind) && node_path::is_absolute(path))
            {
                blocks.push(resource_link(path, reference));
                continue;
            }
            return Err(unsupported_attachment_error(kind));
        }
        let filename = reference
            .get("path")
            .and_then(Value::as_str)
            .map(|path| node_path::resolve_one(path).to_string_lossy().into_owned());
        let Some(filename) = filename.filter(|_| {
            authorized_workspace_reference_path(reference, Some(workspace_root)).is_some()
        }) else {
            return Err(AgentError::new(
                "ACP received an invalid workspace reference.",
            ));
        };
        if seen.contains(&filename) {
            continue;
        }
        seen.push(filename.clone());
        blocks.push(resource_link(&filename, reference));
    }
    Ok(blocks)
}

/// `pathToFileURL(filename).href`.
pub fn path_to_file_url(filename: &str) -> String {
    url::Url::from_file_path(filename)
        .map(|url| url.to_string())
        .unwrap_or_else(|_| format!("file://{filename}"))
}

fn resource_link(filename: &str, reference: &Value) -> Value {
    let name = text(display_name(reference), 300);
    let name = if name.is_empty() {
        node_path::basename(filename)
    } else {
        name
    };
    let mime = text(reference.get("mime"), 160);
    Obj::new()
        .set("type", "resource_link")
        .set("uri", path_to_file_url(filename))
        .set("name", name.as_str())
        .set("title", name.as_str())
        .opt("mimeType", (!mime.is_empty()).then_some(mime))
        .opt(
            "size",
            reference
                .get("size")
                .and_then(js::safe_integer)
                .filter(|size| *size >= 0),
        )
        .build()
}

fn data_url_parts(value: Option<&Value>) -> Option<(String, String)> {
    let value = value?.as_str()?;
    let limit = (ACP_INLINE_IMAGE_MAX_BYTES as usize * 4).div_ceil(3) + 256;
    if js::len16(value) > limit {
        return None;
    }
    let captures = DATA_URL.captures(value)?;
    Some((captures[1].to_string(), captures[2].to_string()))
}

fn attachment_uri(reference: &Value) -> String {
    let id = UNSAFE_ID
        .replace_all(&text(reference.get("id"), 256), "-")
        .into_owned();
    let id = if id.is_empty() {
        "attachment".into()
    } else {
        id
    };
    let name = text(display_name(reference), 512);
    let name = js::encode_uri_component(if name.is_empty() { "attachment" } else { &name });
    format!(
        "puppyone-attachment://local/{}/{name}",
        js::encode_uri_component(&id)
    )
}
