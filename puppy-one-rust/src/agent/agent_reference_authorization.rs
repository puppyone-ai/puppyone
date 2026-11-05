//! `agent-reference-authorization.mjs`: untrusted Renderer path hints as
//! Main-authorized live workspace references. Files and directories are
//! re-canonicalized for every turn.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::reference_identity::normalize_agent_workspace_relative_path;
use crate::agent::contract::workspace_resource_reference::{
    is_workspace_resource_reference, parse_workspace_resource_reference,
};
use crate::agent::node_path;
use base64::Engine;
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use std::rc::Rc;
use std::sync::LazyLock;

const MAX_REFERENCES: usize = 32;
const MAX_REFERENCE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES: u64 = 25 * 1024 * 1024;

/// `agentReferenceLimits`.
pub mod limits {
    pub const MAX_REFERENCES: usize = super::MAX_REFERENCES;
    pub const MAX_REFERENCE_BYTES: u64 = super::MAX_REFERENCE_BYTES;
    pub const MAX_TOTAL_REFERENCE_BYTES: u64 = super::MAX_TOTAL_REFERENCE_BYTES;
}

static CONTROL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\x00-\x1f\x7f]").expect("pattern"));

/// `createAgentReferenceBudget()`: one byte and file-count budget shared by
/// attachments and context.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReferenceBudget {
    pub remaining_bytes: u64,
    pub remaining_references: usize,
}

impl Default for ReferenceBudget {
    fn default() -> Self {
        Self {
            remaining_bytes: MAX_TOTAL_REFERENCE_BYTES,
            remaining_references: MAX_REFERENCES,
        }
    }
}

/// `resolveResource(requestPath)`: `{ workspaceRoot, absolutePath,
/// resourceUri, folderId, workspaceName }` of a multi-root workspace entry.
pub type ResolveResource = Rc<dyn Fn(String) -> LocalBoxFuture<'static, AgentResult<Value>>>;

fn error(message: &str) -> AgentError {
    AgentError::new(message)
}

/// `authorizeAgentReferences({ workspaceRoot, references, budget, resolveResource })`.
pub async fn authorize_agent_references(
    workspace_root: &str,
    references: &[Value],
    budget: &mut ReferenceBudget,
    resolve_resource: Option<ResolveResource>,
) -> AgentResult<Vec<Value>> {
    if references.is_empty() {
        return Ok(Vec::new());
    }
    if budget.remaining_bytes > MAX_TOTAL_REFERENCE_BYTES
        || budget.remaining_references > MAX_REFERENCES
    {
        return Err(error("Agent file reference budget is invalid."));
    }
    let canonical_root = std::fs::canonicalize(node_path::resolve_one(workspace_root))?;
    let mut authorized = Vec::new();
    let mut seen: HashSet<std::path::PathBuf> = HashSet::new();
    for reference in references.iter().take(MAX_REFERENCES) {
        let has_relative = reference.is_object() && reference.get("relativePath").is_some();
        let portable_path = if has_relative {
            normalize_agent_workspace_relative_path(reference.get("relativePath"))
        } else {
            None
        };
        if has_relative && portable_path.is_none() {
            return Err(error(
                "Agent workspace references require a valid workspace-relative identity.",
            ));
        }
        let requested = match reference {
            Value::String(path) => Some(path.clone()),
            _ => reference
                .get("resourceUri")
                .filter(|v| !v.is_null())
                .map(|v| js::to_js_string(Some(v)))
                .or_else(|| portable_path.clone())
                .or_else(|| {
                    reference
                        .get("path")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                }),
        };
        let Some(requested) = requested.filter(|p| !js::trim(p).is_empty()) else {
            return Err(error("Agent workspace references require a valid path."));
        };
        let resource_uri = is_workspace_resource_reference(&requested).then(|| requested.clone());
        if resource_uri.is_some() && resolve_resource.is_none() {
            return Err(error("Workspace resource resolution is unavailable."));
        }
        if let (Some(uri), Some(portable)) = (resource_uri.as_ref(), portable_path.as_ref())
            && parse_workspace_resource_reference(uri)
                .map(|resource| resource.relative_path != *portable)
                .unwrap_or(true)
        {
            return Err(error(
                "Agent reference path does not match its resource identity.",
            ));
        }
        let resource = match resolve_resource.as_ref() {
            Some(resolve) => {
                let request = if node_path::is_absolute(&requested) {
                    let relative = node_path::relative(&canonical_root, &requested);
                    if relative.is_empty() {
                        ".".to_string()
                    } else {
                        relative
                    }
                } else {
                    requested.clone()
                };
                Some(resolve(request).await?)
            }
            None => None,
        };
        let owning_root = resource
            .as_ref()
            .and_then(|r| r.get("workspaceRoot").and_then(Value::as_str))
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| canonical_root.clone());
        let resolved = resource
            .as_ref()
            .and_then(|r| r.get("absolutePath").and_then(Value::as_str))
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                if node_path::is_absolute(&requested) {
                    node_path::resolve_one(&requested)
                } else {
                    node_path::resolve(&canonical_root, &requested)
                }
            });
        let canonical = std::fs::canonicalize(&resolved)
            .map_err(|_| error("An Agent file reference no longer exists."))?;
        if !node_path::is_same_or_inside(&owning_root, &canonical) {
            return Err(error(
                "Agent file references must stay inside the assigned workspace.",
            ));
        }
        if seen.contains(&canonical) {
            continue;
        }
        if budget.remaining_references == 0 {
            return Err(error(
                "Agent file references exceed the 32-file safety limit.",
            ));
        }
        let metadata = std::fs::metadata(&canonical).map_err(|_| {
            error("An Agent workspace reference changed while it was being authorized.")
        })?;
        let entry_type = if metadata.is_dir() {
            "directory"
        } else if metadata.is_file() {
            "file"
        } else {
            return Err(error(
                "Agent workspace references must be regular files or directories.",
            ));
        };
        if let Some(expected) = reference.get("entryType").filter(|v| js::truthy(v))
            && expected != entry_type
        {
            return Err(error("An Agent workspace reference changed type."));
        }
        if entry_type == "file" {
            if metadata.len() > MAX_REFERENCE_BYTES {
                return Err(error(
                    "An Agent file reference exceeds the 25 MB safety limit.",
                ));
            }
            if metadata.len() > budget.remaining_bytes {
                return Err(error(
                    "Agent file references exceed the 25 MB total safety limit.",
                ));
            }
            let changed =
                || error("An Agent file reference changed while it was being authorized.");
            let handle =
                crate::agent::security::authorized_project_instructions::open_no_follow(&canonical)
                    .map_err(|_| changed())?;
            let opened = handle.metadata().map_err(|_| changed())?;
            if !opened.is_file() || opened.len() != metadata.len() {
                return Err(changed());
            }
            budget.remaining_bytes -= metadata.len();
        }
        budget.remaining_references -= 1;
        seen.insert(canonical.clone());
        let request_path = {
            let relative = node_path::relative(&owning_root, &canonical);
            if relative.is_empty() {
                ".".to_string()
            } else {
                relative
            }
        };
        let Some(relative_path) =
            normalize_agent_workspace_relative_path(Some(&Value::from(request_path)))
        else {
            return Err(error(
                "Agent workspace reference identity could not be normalized.",
            ));
        };
        let basename = |path: &Path| {
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        let name = safe_display_name(
            [reference.get("displayName"), reference.get("name")]
                .into_iter()
                .flatten()
                .find(|v| js::truthy(v))
                .map(|v| js::to_js_string(Some(v)))
                .or_else(|| Some(basename(&canonical)).filter(|n| !n.is_empty()))
                .or_else(|| Some(basename(&canonical_root)).filter(|n| !n.is_empty())),
        );
        let identity = if portable_path.is_some() && resource_uri.is_none() {
            relative_path.clone()
        } else {
            resource
                .as_ref()
                .and_then(|r| r.get("resourceUri").and_then(Value::as_str))
                .map(str::to_string)
                .unwrap_or_else(|| relative_path.clone())
        };
        let mut record = Obj::new()
            .set("authorized", true)
            // Keep pre-upgrade draft mentions valid; new acquisitions always
            // receive root-qualified ids.
            .set("id", workspace_reference_id(&identity, entry_type))
            .set("kind", "workspace-entry")
            .set("entryType", entry_type)
            .set("path", canonical.to_string_lossy().into_owned())
            .set("relativePath", relative_path);
        if let Some(resource) = resource.as_ref() {
            record = record
                .set(
                    "resourceUri",
                    resource.get("resourceUri").cloned().unwrap_or(Value::Null),
                )
                .set(
                    "workspaceFolderId",
                    resource.get("folderId").cloned().unwrap_or(Value::Null),
                )
                .set(
                    "authorizedWorkspaceRoot",
                    owning_root.to_string_lossy().into_owned(),
                );
            if owning_root != canonical_root {
                record = record.set(
                    "workspaceName",
                    safe_display_name(
                        resource
                            .get("workspaceName")
                            .map(|v| js::to_js_string(Some(v))),
                    ),
                );
            }
        }
        authorized.push(
            record
                .set("displayName", name.as_str())
                .set("name", name.as_str())
                .set(
                    "mime",
                    if entry_type == "file" {
                        infer_mime_type(&canonical)
                    } else {
                        "inode/directory"
                    },
                )
                .set(
                    "size",
                    if entry_type == "file" {
                        metadata.len()
                    } else {
                        0
                    },
                )
                .set("status", "ready")
                .build(),
        );
    }
    Ok(authorized)
}

/// `workspaceDraftReferences(references)`: the metadata-only Renderer
/// draft DTO; absolute paths are withheld.
pub fn workspace_draft_references(references: &[Value]) -> Vec<Value> {
    references
        .iter()
        .map(|reference| {
            let mut draft = Obj::new()
                .set("id", reference["id"].clone())
                .set("kind", "workspace-entry")
                .set("entryType", reference["entryType"].clone())
                .set("relativePath", reference["relativePath"].clone());
            if reference.get("resourceUri").is_some_and(js::truthy) {
                draft = draft
                    .set("resourceUri", reference["resourceUri"].clone())
                    .set("workspaceFolderId", reference["workspaceFolderId"].clone());
            }
            if reference.get("workspaceName").is_some_and(js::truthy) {
                draft = draft.set("workspaceName", reference["workspaceName"].clone());
            }
            draft
                .set("displayName", reference["displayName"].clone())
                .set("mime", reference["mime"].clone())
                .set("size", reference["size"].clone())
                .set("status", "ready")
                .build()
        })
        .collect()
}

fn workspace_reference_id(relative_path: &str, entry_type: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(entry_type.as_bytes());
    hash.update(b"\0");
    hash.update(relative_path.as_bytes());
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash.finalize());
    format!("workspace-{}", &encoded[..32])
}

fn safe_display_name(value: Option<String>) -> String {
    let raw = value
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "workspace item".into());
    let cleaned = CONTROL.replace_all(&raw, "");
    let name = js::head16(js::trim(&cleaned), 512);
    if name.is_empty() {
        "workspace item".into()
    } else {
        name.to_string()
    }
}

fn infer_mime_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    match extension.as_str() {
        ".md" | ".mdx" => "text/markdown",
        ".txt" => "text/plain",
        ".json" => "application/json",
        ".js" | ".mjs" | ".cjs" | ".jsx" => "text/javascript",
        ".ts" | ".tsx" => "text/typescript",
        ".css" => "text/css",
        ".html" => "text/html",
        ".xml" => "application/xml",
        ".yaml" | ".yml" => "application/yaml",
        ".csv" => "text/csv",
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        ".pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}
