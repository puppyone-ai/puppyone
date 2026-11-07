//! `shared/agent-contract/reference-input.mjs`: what kind of attachment a
//! file is, and whether a runtime accepts it.
use super::js;
use serde_json::Value;

pub const AGENT_ATTACHMENT_KINDS: &[&str] = &["image", "text", "audio", "video", "binary"];

const TEXT_EXTENSIONS: &[&str] = &[
    ".bash", ".c", ".cc", ".cfg", ".conf", ".cpp", ".cs", ".css", ".csv", ".env", ".gql", ".go",
    ".graphql", ".h", ".hpp", ".htm", ".html", ".ini", ".java", ".js", ".json", ".jsonl", ".jsx",
    ".kt", ".md", ".mdx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".sh", ".sql", ".svg", ".swift",
    ".toml", ".ts", ".tsv", ".tsx", ".txt", ".xml", ".yaml", ".yml", ".zsh",
];
const IMAGE_EXTENSIONS: &[&str] = &[".gif", ".jpeg", ".jpg", ".png", ".webp"];
const AUDIO_EXTENSIONS: &[&str] = &[".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"];
const VIDEO_EXTENSIONS: &[&str] = &[".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"];

/// `classifyAgentAttachment({ mime, name })`.
pub fn classify_agent_attachment(mime: &str, name: &str) -> &'static str {
    let mime = normalize_mime(mime);
    let extension = file_extension(name);
    let extension = extension.as_str();
    if mime == "image/svg+xml" || is_text_mime(&mime) || TEXT_EXTENSIONS.contains(&extension) {
        "text"
    } else if mime.starts_with("image/") || IMAGE_EXTENSIONS.contains(&extension) {
        "image"
    } else if mime.starts_with("audio/") || AUDIO_EXTENSIONS.contains(&extension) {
        "audio"
    } else if mime.starts_with("video/") || VIDEO_EXTENSIONS.contains(&extension) {
        "video"
    } else {
        "binary"
    }
}

fn attachment_input<'a>(capabilities: &'a Value, kind: &str) -> Option<&'a Value> {
    js::get(capabilities, "attachments").and_then(|a| js::get(a, kind))
}

fn accepted(input: Option<&Value>) -> bool {
    input.and_then(|i| js::get(i, "accepted")) == Some(&Value::Bool(true))
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|entries| entries.iter().map(js_string).collect())
        .unwrap_or_default()
}

/// `String(value)` of a JSON value.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

/// `acceptsAgentAttachment(capabilities, attachment)`.
pub fn accepts_agent_attachment(capabilities: &Value, mime: &str, name: &str) -> bool {
    let kind = classify_agent_attachment(mime, name);
    let input = attachment_input(capabilities, kind);
    if !accepted(input) {
        return false;
    }
    let input = input.expect("accepted input");
    let mime = normalize_mime(mime);
    let extension = file_extension(name);
    let mime_types: Vec<String> = strings(js::get(input, "mimeTypes"))
        .iter()
        .map(|m| normalize_mime(m))
        .filter(|m| !m.is_empty())
        .collect();
    let extensions: Vec<String> = strings(js::get(input, "extensions"))
        .iter()
        .map(|e| normalize_extension(e))
        .filter(|e| !e.is_empty())
        .collect();
    if mime_types.is_empty() && extensions.is_empty() {
        return true;
    }
    (!mime.is_empty()
        && mime_types
            .iter()
            .any(|pattern| mime_matches(pattern, &mime)))
        || (!extension.is_empty() && extensions.contains(&extension))
}

/// `hasAgentAttachmentSupport(capabilities)`.
pub fn has_agent_attachment_support(capabilities: &Value) -> bool {
    AGENT_ATTACHMENT_KINDS
        .iter()
        .any(|kind| accepted(attachment_input(capabilities, kind)))
}

/// `acceptedAgentAttachmentPickerTypes(capabilities)`: empty when any kind
/// accepts every file.
pub fn accepted_agent_attachment_picker_types(capabilities: &Value) -> Vec<String> {
    let inputs: Vec<&Value> = AGENT_ATTACHMENT_KINDS
        .iter()
        .filter_map(|kind| attachment_input(capabilities, kind))
        .filter(|input| accepted(Some(input)))
        .collect();
    let list = |input: &Value, key: &str| strings(js::get(input, key));
    if inputs
        .iter()
        .any(|i| list(i, "mimeTypes").is_empty() && list(i, "extensions").is_empty())
    {
        return Vec::new();
    }
    let mut types: Vec<String> = Vec::new();
    for input in inputs {
        for value in list(input, "mimeTypes")
            .into_iter()
            .chain(list(input, "extensions"))
        {
            let value = js::trim(&value).to_lowercase();
            if !value.is_empty() && !types.contains(&value) {
                types.push(value);
            }
        }
    }
    types
}

/// [`accepts_agent_attachment`] of a runtime's typed reference inputs.
pub fn accepts_attachment(
    capabilities: &super::dto::ReferenceInputCapabilities,
    mime: &str,
    name: &str,
) -> bool {
    accepts_agent_attachment(&typed(capabilities), mime, name)
}

/// [`has_agent_attachment_support`] of a runtime's typed reference inputs.
pub fn has_attachment_support(capabilities: &super::dto::ReferenceInputCapabilities) -> bool {
    has_agent_attachment_support(&typed(capabilities))
}

/// [`accepted_agent_attachment_picker_types`] of a runtime's typed
/// reference inputs.
pub fn attachment_picker_types(
    capabilities: &super::dto::ReferenceInputCapabilities,
) -> Vec<String> {
    accepted_agent_attachment_picker_types(&typed(capabilities))
}

fn typed(capabilities: &super::dto::ReferenceInputCapabilities) -> Value {
    serde_json::to_value(capabilities).unwrap_or_default()
}

/// `isTextMime(value)`.
pub fn is_text_mime(value: &str) -> bool {
    let mime = normalize_mime(value);
    mime.starts_with("text/")
        || mime == "application/json"
        || mime.ends_with("+json")
        || mime == "application/javascript"
        || mime == "application/xml"
        || mime.ends_with("+xml")
        || mime == "application/yaml"
        || mime == "application/toml"
}

fn mime_matches(pattern: &str, mime: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) if pattern.ends_with("/*") => mime.starts_with(prefix),
        _ => pattern == mime,
    }
}

fn normalize_mime(value: &str) -> String {
    js::trim(value.split(';').next().unwrap_or("")).to_lowercase()
}

fn normalize_extension(value: &str) -> String {
    let extension = js::trim(value).to_lowercase();
    if extension.starts_with('.') || extension.is_empty() {
        extension
    } else {
        format!(".{extension}")
    }
}

fn file_extension(value: &str) -> String {
    let name = js::trim(value).to_lowercase();
    name.rfind('.')
        .map(|dot| name[dot..].to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn attachments_are_classified_and_matched() {
        assert_eq!(classify_agent_attachment("image/svg+xml", "a.svg"), "text");
        assert_eq!(classify_agent_attachment("", "a.PNG"), "image");
        assert_eq!(
            classify_agent_attachment("application/zip", "a.zip"),
            "binary"
        );
        let capabilities =
            json!({"attachments": {"image": {"accepted": true, "mimeTypes": ["image/*"]}}});
        assert!(accepts_agent_attachment(
            &capabilities,
            "image/png; q=1",
            "a.png"
        ));
        assert!(!accepts_agent_attachment(&capabilities, "", "a.txt"));
        assert!(has_agent_attachment_support(&capabilities));
        assert_eq!(
            accepted_agent_attachment_picker_types(&capabilities),
            vec!["image/*"]
        );
    }
}
