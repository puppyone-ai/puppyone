//! `application/agent-input-policy.mjs`: normalizing and checking what a
//! request asks of a session.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::reference_identity::{
    agent_reference_mention_text, normalize_agent_workspace_relative_path,
};
use crate::agent::contract::reference_input::{
    accepts_agent_attachment, classify_agent_attachment,
};
use crate::agent::domain::agent_reference_error::{agent_reference_error, codes};
use crate::agent::sender::Sender;
use crate::text;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;

static OPAQUE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("opaque id"));
static RUNTIME_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]{1,39}$").expect("runtime id"));
const MAX_REFERENCE_SNAPSHOT_URL_LENGTH: usize = (512 * 1024 * 4usize).div_ceil(3) + 256;

fn reference_error(code: &'static str, message: &str) -> AgentError {
    let error = agent_reference_error(code, message);
    AgentError::coded(error.code, error.message).with_name("AgentReferenceError")
}

/// `readinessWithAccountState(readiness, accountState, runtimeName)`.
pub fn readiness_with_account_state(
    readiness: &Value,
    account_state: &Value,
    runtime_name: &str,
) -> Value {
    if readiness["status"] == "ready" && requires_runtime_setup(account_state) {
        let code = if account_state["setupReason"] == "authentication-expired" {
            "AUTHENTICATION_EXPIRED"
        } else if js::truthy_opt(account_state.get("requiresOpenaiAuth"))
            || account_state["setupReason"] == "authentication-required"
        {
            "AUTHENTICATION_REQUIRED"
        } else {
            "RUNTIME_SETUP_REQUIRED"
        };
        let ready_message = format!("{runtime_name} is ready.");
        let message = account_state["error"]
            .as_str()
            .filter(|e| !e.is_empty())
            .map(str::to_string)
            .or_else(|| {
                readiness["message"]
                    .as_str()
                    .filter(|m| !m.is_empty() && *m != ready_message)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("{runtime_name} requires authentication or model setup."));
        return Obj::from(readiness)
            .set("status", "installed-not-authenticated")
            .set("code", code)
            .set("selectable", false)
            .set("message", message)
            .build();
    }
    readiness.clone()
}

/// `assertAuthenticated(accountState, runtimeName)`.
pub fn assert_authenticated(account_state: &Value, runtime_name: &str) -> AgentResult<()> {
    if requires_runtime_setup(account_state) {
        let message = account_state["error"]
            .as_str()
            .filter(|e| !e.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{runtime_name} requires authentication or model setup."));
        return Err(AgentError::new(message));
    }
    Ok(())
}

/// `requiresRuntimeSetup(accountState)`.
pub fn requires_runtime_setup(account_state: &Value) -> bool {
    !js::truthy_opt(account_state.get("account"))
        && (js::truthy_opt(account_state.get("requiresOpenaiAuth"))
            || js::truthy_opt(account_state.get("requiresRuntimeSetup")))
}

/// `requireWorkspaceRoot(value)`.
pub fn require_workspace_root(value: Option<&str>) -> AgentResult<()> {
    if value.is_none_or(|root| text::trim(root).is_empty()) {
        return Err(AgentError::new(
            "No authorized local workspace is assigned to this Agent session.",
        ));
    }
    Ok(())
}

/// `requireMatchingWorkspace(session, workspaceRoot)`: trusted IPC always
/// supplies a canonical root; direct service-level callers may omit it,
/// but a supplied proof must match exactly.
pub fn require_matching_workspace(
    session_root: &str,
    workspace_root: Option<&str>,
) -> AgentResult<()> {
    let Some(root) = workspace_root else {
        return Ok(());
    };
    require_workspace_root(Some(root))?;
    if session_root != root {
        return Err(AgentError::new(
            "Agent session does not belong to the assigned workspace.",
        ));
    }
    Ok(())
}

/// `requireSenderId(sender)`.
pub fn require_sender_id(sender: &Sender) -> AgentResult<u64> {
    let id = sender.id();
    if id == 0 || id > js::MAX_SAFE_INTEGER as u64 {
        return Err(AgentError::new("Agent IPC sender is invalid."));
    }
    Ok(id)
}

/// `normalizePrompt(value, { allowEmpty })`.
pub fn normalize_prompt(value: Option<&Value>, allow_empty: bool) -> AgentResult<String> {
    let Some(text) = value
        .and_then(Value::as_str)
        .filter(|t| allow_empty || !text::trim(t).is_empty())
    else {
        return Err(AgentError::new("Enter a message for the Agent."));
    };
    if text::len16(text) > 128 * 1024 {
        return Err(AgentError::new("The Agent message is too large."));
    }
    Ok(text.to_string())
}

/// `normalizeRequiredId(value, label)`.
pub fn normalize_required_id(value: Option<&Value>, label: &str) -> AgentResult<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| OPAQUE_ID.is_match(id))
        .map(str::to_string)
        .ok_or_else(|| AgentError::new(format!("{label} is invalid.")))
}

/// `normalizeOptionalString(value)`.
pub fn normalize_optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(text::trim)
        .filter(|t| !t.is_empty())
        .map(|t| text::head16(t, 200).to_string())
}

/// `normalizeRuntimeId(value)`.
pub fn normalize_runtime_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| RUNTIME_ID.is_match(id))
        .map(str::to_string)
}

/// `normalizeOptionalId(value)`.
pub fn normalize_optional_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| OPAQUE_ID.is_match(id))
        .map(str::to_string)
}

/// `normalizeAuthorizedReferences(value)`.
pub fn normalize_authorized_references(value: &[Value]) -> AgentResult<Vec<Value>> {
    if value.len() > 32 {
        return Err(AgentError::new(
            "Agent references exceed the 32-file safety limit.",
        ));
    }
    value
        .iter()
        .map(|entry| {
            if !entry.is_object() || entry["authorized"] != true {
                return Err(reference_error(
                    codes::UNAUTHORIZED,
                    "Agent references must be authorized by the main process.",
                ));
            }
            let kind = entry["kind"].as_str().unwrap_or("");
            if kind != "workspace-entry" && kind != "staged-attachment" {
                return Err(AgentError::new("Agent reference kind is not supported."));
            }
            let path = entry["path"]
                .as_str()
                .filter(|p| !p.is_empty() && text::len16(p) <= 4_096);
            let Some(path) = path else {
                return Err(AgentError::new("Agent reference path is invalid."));
            };
            let entry_type = if entry["entryType"] == "directory" {
                "directory"
            } else {
                "file"
            };
            let relative_path = if kind == "workspace-entry" {
                normalize_agent_workspace_relative_path(entry.get("relativePath"))
            } else {
                None
            };
            if kind == "workspace-entry" && relative_path.is_none() {
                return Err(AgentError::new(
                    "Agent workspace reference identity is invalid.",
                ));
            }
            let name_source = entry
                .get("name")
                .filter(|v| !v.is_null())
                .or(entry.get("displayName"));
            let display_source = entry
                .get("displayName")
                .filter(|v| !v.is_null())
                .or(entry.get("name"));
            let mut out = Obj::new()
                .set("authorized", true)
                .set("id", normalize_reference_id(entry.get("id"), path))
                .set("kind", kind);
            if kind == "workspace-entry" {
                out.insert("entryType", entry_type);
            }
            out = out
                .set("path", path)
                .set("name", normalize_reference_display_name(name_source))
                .set(
                    "displayName",
                    normalize_reference_display_name(display_source)
                        .unwrap_or_else(|| "reference".into()),
                );
            if kind == "workspace-entry" {
                out = out.set("relativePath", relative_path);
                if js::truthy_opt(entry.get("resourceUri")) {
                    out = out.set("resourceUri", entry["resourceUri"].clone()).set(
                        "workspaceFolderId",
                        entry
                            .get("workspaceFolderId")
                            .cloned()
                            .unwrap_or(Value::Null),
                    );
                }
                if js::truthy_opt(entry.get("authorizedWorkspaceRoot")) {
                    out = out.set(
                        "authorizedWorkspaceRoot",
                        entry["authorizedWorkspaceRoot"].clone(),
                    );
                }
                if js::truthy_opt(entry.get("workspaceName")) {
                    out = out.set(
                        "workspaceName",
                        normalize_reference_display_name(entry.get("workspaceName")),
                    );
                }
            }
            out = out
                .set("mime", normalize_optional_string(entry.get("mime")))
                .set(
                    "size",
                    entry
                        .get("size")
                        .and_then(js::safe_integer)
                        .filter(|s| *s >= 0)
                        .unwrap_or(0),
                );
            if is_bounded_data_url(entry.get("snapshotUrl")) {
                out = out.set("snapshotUrl", entry["snapshotUrl"].clone());
            }
            Ok(out.build())
        })
        .collect()
}

/// `normalizePromptReferenceMentions(value, prompt, references)`.
pub fn normalize_prompt_reference_mentions(
    value: Option<&Value>,
    prompt: &str,
    references: &[Value],
) -> AgentResult<Vec<Value>> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(Vec::new());
    };
    let Some(entries) = value.as_array().filter(|e| e.len() <= 32) else {
        return Err(AgentError::new(
            "Agent prompt reference mentions are invalid.",
        ));
    };
    let by_id: HashMap<&str, &Value> = references
        .iter()
        .filter_map(|r| Some((r["id"].as_str()?, r)))
        .collect();
    let length = text::len16(prompt) as i64;
    let mut boundary = 0;
    entries
        .iter()
        .map(|entry| {
            if !entry.is_object() {
                return Err(AgentError::new(
                    "Agent prompt reference mention is invalid.",
                ));
            }
            let reference_id =
                normalize_required_id(entry.get("referenceId"), "Reference mention id")?;
            let Some(reference) = by_id.get(reference_id.as_str()) else {
                return Err(AgentError::new(
                    "Agent prompt reference mention is not backed by an authorized reference.",
                ));
            };
            let directory =
                reference["kind"] == "workspace-entry" && reference["entryType"] == "directory";
            let name = reference["displayName"]
                .as_str()
                .or(reference["name"].as_str())
                .unwrap_or("");
            if !directory
                && classify_agent_attachment(reference["mime"].as_str().unwrap_or(""), name)
                    == "image"
            {
                return Err(AgentError::new(
                    "Image references must use the native media input channel.",
                ));
            }
            let start = entry.get("start").and_then(js::safe_integer).unwrap_or(-1);
            let end = entry.get("end").and_then(js::safe_integer).unwrap_or(-1);
            if start < boundary || end <= start || end > length {
                return Err(AgentError::new(
                    "Agent prompt reference mention range is invalid.",
                ));
            }
            if text::slice16(prompt, start as usize, end as usize)
                != agent_reference_mention_text(reference)
            {
                return Err(AgentError::new(
                    "Agent prompt reference mention text does not match its authorized reference.",
                ));
            }
            boundary = end;
            Ok(serde_json::json!({ "referenceId": reference_id, "start": start, "end": end }))
        })
        .collect()
}

/// `bindPromptReferenceMentionDelivery(references, mentions, deliveryForReference)`.
pub fn bind_prompt_reference_mention_delivery(
    references: &[Value],
    mentions: &[Value],
    delivery_for_reference: &dyn Fn(&Value) -> Option<&'static str>,
) -> Vec<Value> {
    references
        .iter()
        .map(|reference| {
            if !mentions.iter().any(|m| m["referenceId"] == reference["id"]) {
                return reference.clone();
            }
            let delivery = if delivery_for_reference(reference).unwrap_or("resource") == "path" {
                "path"
            } else {
                "resource"
            };
            Obj::from(reference)
                .set("inlineMentioned", true)
                .set("mentionDelivery", delivery)
                .build()
        })
        .collect()
}

/// `compileAgentPromptReferenceMentions(prompt, mentions, references)`.
pub fn compile_agent_prompt_reference_mentions(
    prompt: &str,
    mentions: &[Value],
    references: &[Value],
) -> AgentResult<String> {
    let mut compiled = prompt.to_string();
    for mention in mentions.iter().rev() {
        let Some(reference) = references
            .iter()
            .find(|r| r["id"] == mention["referenceId"])
        else {
            return Err(AgentError::new(
                "Agent prompt reference mention lost its authorized reference.",
            ));
        };
        if reference["mentionDelivery"] == "path" {
            let start = mention["start"].as_u64().unwrap_or(0) as usize;
            let end = mention["end"].as_u64().unwrap_or(0) as usize;
            let path = reference["path"].as_str().unwrap_or("");
            compiled = format!(
                "{}{}{}",
                text::head16(&compiled, start),
                quote_native_path(path),
                text::tail16(&compiled, end)
            );
        }
    }
    Ok(compiled)
}

fn quote_native_path(filename: &str) -> String {
    format!("`{}`", filename.replace('`', "\\`"))
}

/// `requireSupportedAgentReferences(capabilities, references)`.
pub fn require_supported_agent_references(
    capabilities: Option<&Value>,
    references: &[Value],
) -> AgentResult<()> {
    let input = capabilities
        .and_then(|c| c.get("referenceInputs"))
        .filter(|i| js::truthy(i));
    let Some(input) = input else {
        if !references.is_empty() {
            return Err(reference_error(
                codes::MISSING_RUNTIME_CAPABILITY,
                "The selected Agent has not reported reference input support.",
            ));
        }
        return Ok(());
    };
    let size = |reference: &Value| {
        reference
            .get("size")
            .and_then(js::safe_integer)
            .unwrap_or(0)
    };
    let total: i64 = references.iter().map(size).sum();
    let limit = |key: &str| input["limits"][key].as_i64().unwrap_or(i64::MAX);
    if references.len() as i64 > limit("maxCount") {
        return Err(reference_error(
            codes::LIMIT_EXCEEDED,
            "This Agent accepts fewer reference inputs.",
        ));
    }
    if total > limit("maxTotalBytes") {
        return Err(reference_error(
            codes::LIMIT_EXCEEDED,
            "Reference inputs exceed this Agent's total size limit.",
        ));
    }
    for reference in references {
        if size(reference) > limit("maxBytesPerReference") {
            return Err(reference_error(
                codes::LIMIT_EXCEEDED,
                "A reference exceeds this Agent's per-file size limit.",
            ));
        }
        if reference["kind"] == "workspace-entry" {
            if js::truthy_opt(reference.get("workspaceName"))
                && input["workspace"]["crossRoots"] != true
            {
                return Err(reference_error(
                    codes::UNSUPPORTED_KIND,
                    "The selected Agent does not accept references from another project.",
                ));
            }
            if reference["entryType"] == "directory" && input["workspace"]["directories"] != true {
                return Err(reference_error(
                    codes::UNSUPPORTED_KIND,
                    "The selected Agent does not accept workspace directories.",
                ));
            }
            if reference["entryType"] != "directory" && input["workspace"]["files"] != true {
                return Err(reference_error(
                    codes::UNSUPPORTED_KIND,
                    "The selected Agent does not accept workspace files.",
                ));
            }
            continue;
        }
        let mime = reference["mime"].as_str().unwrap_or("");
        let name = reference["displayName"]
            .as_str()
            .or(reference["name"].as_str())
            .unwrap_or("");
        let kind = classify_agent_attachment(mime, name);
        if let Some(kind_limit) = input["attachments"][kind]["maxBytes"].as_i64()
            && kind_limit > 0
            && size(reference) > kind_limit
        {
            return Err(reference_error(
                codes::LIMIT_EXCEEDED,
                &format!("The {kind} attachment exceeds this Agent's native input size limit."),
            ));
        }
        if !accepts_agent_attachment(input, mime, name) {
            let message = if kind == "image" {
                "The selected Agent does not accept image attachments.".to_string()
            } else {
                format!("The selected Agent does not accept {kind} file attachments.")
            };
            return Err(reference_error(codes::UNSUPPORTED_KIND, &message));
        }
    }
    Ok(())
}

/// `normalizeReferenceDisplays(references)`.
pub fn normalize_reference_displays(references: &[Value]) -> Vec<Value> {
    references
        .iter()
        .take(32)
        .map(|reference| {
            let kind = reference["kind"].as_str().unwrap_or("");
            let fallback = format!(
                "{kind}:{}",
                reference["path"].as_str().unwrap_or("undefined")
            );
            let display_source = reference
                .get("displayName")
                .filter(|v| !v.is_null())
                .or(reference.get("name"));
            let staged = kind == "staged-attachment";
            Obj::new()
                .set("id", normalize_reference_id(reference.get("id"), &fallback))
                .set(
                    "kind",
                    if staged {
                        "attachment"
                    } else if reference["entryType"] == "directory" {
                        "workspace-directory"
                    } else {
                        "workspace-file"
                    },
                )
                .set(
                    "displayName",
                    normalize_reference_display_name(display_source)
                        .unwrap_or_else(|| "reference".into()),
                )
                .opt(
                    "workspaceName",
                    js::truthy_opt(reference.get("workspaceName"))
                        .then(|| normalize_reference_display_name(reference.get("workspaceName")))
                        .flatten(),
                )
                .opt(
                    "relativePath",
                    (kind == "workspace-entry")
                        .then(|| {
                            reference["relativePath"]
                                .as_str()
                                .map(|p| text::head16(p, 4_096).to_string())
                        })
                        .flatten(),
                )
                .opt(
                    "mime",
                    staged
                        .then(|| reference.get("mime").filter(|m| js::truthy(m)).cloned())
                        .flatten(),
                )
                .opt(
                    "size",
                    staged
                        .then(|| reference.get("size").and_then(js::safe_integer))
                        .flatten(),
                )
                .build()
        })
        .collect()
}

fn normalize_reference_display_name(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(text::trim)
        .filter(|t| !t.is_empty())
        .map(|t| text::head16(t, 512).to_string())
}

/// `normalizeQuestionAnswers(value, questions)`: one row of answers per
/// question; `None` for a rejection.
pub fn normalize_question_answers(
    value: Option<&Value>,
    questions: &Value,
) -> AgentResult<Option<Vec<Vec<String>>>> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let rows: Vec<Vec<Value>> = match value {
        Value::String(text) => vec![vec![Value::from(text.as_str())]],
        Value::Array(entries) if entries.iter().all(Value::is_array) => entries
            .iter()
            .map(|row| row.as_array().cloned().unwrap_or_default())
            .collect(),
        Value::Array(entries) if entries.iter().all(Value::is_string) => {
            if questions.as_array().is_some_and(|q| q.len() > 1) {
                entries.iter().map(|entry| vec![entry.clone()]).collect()
            } else {
                vec![entries.clone()]
            }
        }
        _ => return Err(AgentError::new("Question answers are invalid.")),
    };
    Ok(Some(
        rows.into_iter()
            .take(8)
            .map(|row| {
                row.iter()
                    .filter_map(Value::as_str)
                    .map(|entry| text::head16(text::trim(entry), 4_000).to_string())
                    .filter(|entry| !entry.is_empty())
                    .take(20)
                    .collect()
            })
            .collect(),
    ))
}

/// `unavailableReadiness(message)`.
pub fn unavailable_readiness(message: &str) -> Value {
    serde_json::json!({
        "runtimeId": "unknown", "provider": "unknown", "status": "error", "code": "RUNTIME_DISCOVERY_FAILED",
        "version": null, "minimumVersion": null, "message": message, "source": "missing",
        "compatibility": "unavailable", "selectable": false,
    })
}

/// `normalizeApprovalDecision(value)`.
pub fn normalize_approval_decision(value: Option<&Value>) -> AgentResult<String> {
    match value.and_then(Value::as_str) {
        Some(decision @ ("accept" | "acceptForSession" | "decline" | "cancel")) => {
            Ok(decision.to_string())
        }
        _ => Err(AgentError::new("Approval decision is invalid.")),
    }
}

/// `normalizeSequence(value)`.
pub fn normalize_sequence(value: Option<&Value>) -> i64 {
    let sequence = match value {
        Some(Value::String(s)) => s.trim().parse::<f64>().ok().map(js::number),
        Some(other) => Some(other.clone()),
        None => None,
    };
    sequence
        .as_ref()
        .and_then(js::safe_integer)
        .filter(|n| *n >= 0)
        .unwrap_or(0)
}

fn is_bounded_data_url(value: Option<&Value>) -> bool {
    let Some(text) = value.and_then(Value::as_str) else {
        return false;
    };
    if text::len16(text) > MAX_REFERENCE_SNAPSHOT_URL_LENGTH {
        return false;
    }
    let Some(marker) = text.find(";base64,") else {
        return false;
    };
    text.starts_with("data:") && marker > 5 && marker < 200 && !text[..marker].contains('\n')
}

/// `normalizeReferenceId(value, fallback)`.
pub fn normalize_reference_id(value: Option<&Value>, fallback: &str) -> String {
    if let Some(id) = value
        .and_then(Value::as_str)
        .filter(|id| OPAQUE_ID.is_match(id))
    {
        return id.to_string();
    }
    let mut hash: u32 = 2_166_136_261;
    for character in fallback.chars() {
        hash ^= character as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("reference-{hash:x}")
}
