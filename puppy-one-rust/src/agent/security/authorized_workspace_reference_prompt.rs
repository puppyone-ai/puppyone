//! `security/authorized-workspace-reference-prompt.mjs`: render
//! authorized, live workspace references as ordinary prompt text.
//!
//! The caller still owns authorization. This helper only preserves the
//! common delivery contract and refuses paths outside the session or the
//! individual reference's Main-authorized owning root.
use crate::platform::paths;
use serde_json::Value;

const WORKSPACE_REFERENCE_HEADING: &str = "Authorized context files for this turn:";

/// `formatAuthorizedWorkspaceReferencePrompt(prompt, references, workspaceRoot)`.
pub fn format_authorized_workspace_reference_prompt(
    prompt: &str,
    references: &[Value],
    workspace_root: Option<&str>,
) -> String {
    let paths = authorized_workspace_reference_paths(references, workspace_root);
    if paths.is_empty() {
        return prompt.to_string();
    }
    let list = paths
        .iter()
        .map(|filename| format!("- {filename}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{prompt}\n\n{WORKSPACE_REFERENCE_HEADING}\n{list}")
}

/// `authorizedWorkspaceReferencePaths(references, workspaceRoot)`.
pub fn authorized_workspace_reference_paths(
    references: &[Value],
    workspace_root: Option<&str>,
) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for entry in references {
        let staged = entry.get("kind").and_then(Value::as_str) == Some("staged-attachment");
        let inline_path = entry.get("inlineMentioned") == Some(&Value::Bool(true))
            && entry.get("mentionDelivery").and_then(Value::as_str) == Some("path");
        if staged || inline_path {
            continue;
        }
        if let Some(filename) = authorized_workspace_reference_path(entry, workspace_root)
            && !paths.contains(&filename)
        {
            paths.push(filename);
        }
    }
    paths
}

/// `authorizedWorkspaceReferencePath(reference, workspaceRoot)`: validate
/// one workspace reference independently of how it is rendered. Inline
/// mentions are omitted from the prompt appendix, but they still need the
/// same workspace-bound authorization proof.
pub fn authorized_workspace_reference_path(
    reference: &Value,
    workspace_root: Option<&str>,
) -> Option<String> {
    let workspace_root = workspace_root?;
    let path = reference.get("path")?.as_str()?;
    // Only Main-authorized records may carry an additional owning root. A URI
    // or Renderer-supplied absolute path on its own never widens the session
    // boundary.
    let owning_root = match reference.get("authorizedWorkspaceRoot") {
        Some(Value::String(root)) if reference.get("authorized") == Some(&Value::Bool(true)) => {
            root.as_str()
        }
        _ => workspace_root,
    };
    let root = paths::absolute(owning_root);
    let filename = paths::resolve(&root, path);
    paths::is_same_or_inside(&root, &filename).then(|| filename.to_string_lossy().into_owned())
}
