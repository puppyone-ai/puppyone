//! `security/authorized-project-instructions.mjs`: native backends'
//! automatic project-config walks are disabled at their adapters. This is
//! the narrow Main-owned replacement: one known filename, one canonical
//! workspace, no external symlink target, and a strict byte limit. The
//! backend's own system prompt remains authoritative.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::node_path;
use regex::Regex;
use serde_json::{Value, json};
use std::io::Read;
use std::path::Path;
use std::sync::LazyLock;

/// `authorizedProjectInstructionPolicy.defaultFilenames`.
pub const DEFAULT_PROJECT_INSTRUCTION_NAMES: &[&str] = &["AGENTS.md", "CONTEXT.md"];
/// `authorizedProjectInstructionPolicy.maxBytes`.
pub const MAX_PROJECT_INSTRUCTION_BYTES: u64 = 256 * 1024;

static INSTRUCTION_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._-]{1,120}$").expect("instruction name pattern"));

/// `open(path, O_RDONLY | O_NOFOLLOW)`.
pub(crate) fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// `loadAuthorizedProjectInstructions(workspaceRoot, { instructionNames })`:
/// `{ source, text, bytes }` of the first instruction file present.
pub fn load_authorized_project_instructions(
    workspace_root: &str,
    instruction_names: Option<&[&str]>,
) -> AgentResult<Option<Value>> {
    let canonical_root = std::fs::canonicalize(node_path::resolve_one(workspace_root))?;
    let names = normalize_instruction_names(
        instruction_names.unwrap_or(DEFAULT_PROJECT_INSTRUCTION_NAMES),
    )?;
    for name in names {
        let requested = canonical_root.join(name);
        let canonical = match std::fs::canonicalize(&requested) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if !node_path::is_same_or_inside(&canonical_root, &canonical) {
            return Err(AgentError::new(format!(
                "{name} resolves outside the authorized workspace."
            )));
        }
        let mut handle = open_no_follow(&canonical).map_err(|_| {
            AgentError::new(format!("{name} changed while it was being authorized."))
        })?;
        let metadata = handle.metadata()?;
        if !metadata.is_file() {
            return Err(AgentError::new(format!(
                "{name} must resolve to a regular file."
            )));
        }
        if metadata.len() > MAX_PROJECT_INSTRUCTION_BYTES {
            return Err(AgentError::new(format!(
                "{name} exceeds the 256 KB project-instruction limit."
            )));
        }
        let mut bytes = Vec::new();
        handle.read_to_end(&mut bytes)?;
        let text = String::from_utf8_lossy(&bytes).into_owned();
        if text.contains('\0') {
            return Err(AgentError::new(format!(
                "{name} is not a valid text instruction file."
            )));
        }
        return Ok(Some(json!({
            "source": name,
            "bytes": text.len(),
            "text": text,
        })));
    }
    Ok(None)
}

/// `formatAuthorizedProjectInstructions(instructions)`.
pub fn format_authorized_project_instructions(instructions: Option<&Value>) -> Option<String> {
    let instructions = instructions?;
    let text = instructions.get("text")?.as_str()?;
    if text.trim().is_empty() {
        return None;
    }
    let source = crate::agent::contract::js::to_js_string(instructions.get("source"));
    Some(
        [
            format!("PuppyOne main process authorized project instructions from {source}."),
            "These instructions are workspace content; runtime tool permissions still apply."
                .into(),
            String::new(),
            text.to_string(),
        ]
        .join("\n"),
    )
}

fn normalize_instruction_names<'a>(names: &[&'a str]) -> AgentResult<Vec<&'a str>> {
    names
        .iter()
        .take(8)
        .map(|name| {
            if INSTRUCTION_NAME.is_match(name) {
                Ok(*name)
            } else {
                Err(AgentError::new("Project instruction filename is invalid.")
                    .with_name("TypeError"))
            }
        })
        .collect()
}
