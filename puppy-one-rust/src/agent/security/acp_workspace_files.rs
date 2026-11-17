//! `security/acp-workspace-files.mjs`: the Main-process ACP file delegate
//! with a canonical workspace boundary.
//!
//! Some ACP agents ask the client to perform text reads/writes. Absolute
//! paths, symlinks and newly-created parent directories all remain
//! constrained to the workspace selected by trusted IPC. Reads may
//! additionally use exact files or directory scopes explicitly referenced in
//! the current turn; writes may not.
use super::authorized_project_instructions::open_no_follow;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::platform::paths;
use crate::text;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::io::{Read, Seek, Write};
use std::path::{MAIN_SEPARATOR_STR, Path, PathBuf};
use std::rc::Rc;

/// `acpWorkspaceFilePolicy.maxTextFileBytes`.
pub const MAX_TEXT_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// `acpWorkspaceFilePolicy.maxLineWindow`.
pub const MAX_LINE_WINDOW: f64 = 100_000.0;

/// `createAcpWorkspaceFileSystem({ workspaceRoot, getReadReferences })`.
pub struct AcpWorkspaceFileSystem {
    workspace_root: String,
    canonical_root: RefCell<Option<AgentResult<PathBuf>>>,
    get_read_references: Rc<dyn Fn() -> Vec<Value>>,
}

impl AcpWorkspaceFileSystem {
    pub fn new(
        workspace_root: &str,
        get_read_references: Option<Rc<dyn Fn() -> Vec<Value>>>,
    ) -> Self {
        Self {
            workspace_root: workspace_root.to_string(),
            canonical_root: RefCell::default(),
            get_read_references: get_read_references.unwrap_or_else(|| Rc::new(Vec::new)),
        }
    }

    fn canonical_root(&self) -> AgentResult<PathBuf> {
        self.canonical_root
            .borrow_mut()
            .get_or_insert_with(|| {
                std::fs::canonicalize(paths::absolute(&self.workspace_root))
                    .map_err(AgentError::from)
            })
            .clone()
    }

    /// `readTextFile({ path, line, limit })`.
    pub fn read_text_file(&self, request: &Value) -> AgentResult<Value> {
        let root = self.canonical_root()?;
        let target =
            canonical_existing_file(&root, request.get("path"), &(self.get_read_references)())?;
        let mut handle = open_no_follow(&target)?;
        let metadata = handle.metadata()?;
        if !metadata.is_file() {
            return Err(AgentError::new(
                "ACP can only read regular workspace files.",
            ));
        }
        if metadata.len() > MAX_TEXT_FILE_BYTES {
            return Err(AgentError::new(
                "ACP text file exceeds the 4 MB safety limit.",
            ));
        }
        let mut bytes = Vec::new();
        handle.read_to_end(&mut bytes)?;
        let content = String::from_utf8_lossy(&bytes).into_owned();
        if content.contains('\0') {
            return Err(AgentError::new(
                "ACP cannot read a binary file through the text-file delegate.",
            ));
        }
        let start = bounded_integer(request.get("line"), 1.0, js::MAX_SAFE_INTEGER as f64, 1.0) - 1;
        let limit = bounded_integer(request.get("limit"), 0.0, MAX_LINE_WINDOW, 0.0);
        if request.get("line").is_none() && request.get("limit").is_none() {
            return Ok(json!({ "content": content }));
        }
        let lines = split_lines(&content);
        let start = (start as usize).min(lines.len());
        let end = if limit > 0 {
            (start + limit as usize).min(lines.len())
        } else {
            lines.len()
        };
        Ok(json!({ "content": lines[start..end].join("\n") }))
    }

    /// `writeTextFile({ path, content })`.
    pub fn write_text_file(&self, request: &Value) -> AgentResult<Value> {
        let Some(content) = request.get("content").and_then(Value::as_str) else {
            return Err(AgentError::new(
                "ACP text-file writes require text content.",
            ));
        };
        if content.len() as u64 > MAX_TEXT_FILE_BYTES {
            return Err(AgentError::new(
                "ACP text-file write exceeds the 4 MB safety limit.",
            ));
        }
        let root = self.canonical_root()?;
        let target = resolve_workspace_path(&root, request.get("path"))?;
        ensure_canonical_parent(&root, target.parent().unwrap_or(&root))?;
        let target_metadata = match std::fs::symlink_metadata(&target) {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        if target_metadata
            .as_ref()
            .is_some_and(|m| m.file_type().is_symlink())
        {
            return Err(AgentError::new("ACP cannot write through a symbolic link."));
        }
        if target_metadata.as_ref().is_some_and(|m| !m.is_file()) {
            return Err(AgentError::new(
                "ACP can only write regular workspace files.",
            ));
        }
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW).mode(0o600);
        }
        let mut handle = options.open(&target)?;
        let metadata = handle.metadata()?;
        let changed = || AgentError::new("ACP write target changed during authorization.");
        if !metadata.is_file() {
            return Err(changed());
        }
        if let Some(expected) = target_metadata.as_ref()
            && !same_file_identity(expected, &metadata)
        {
            return Err(changed());
        }
        let canonical_target = std::fs::canonicalize(&target)?;
        assert_inside(&root, &canonical_target)?;
        // Do not truncate until the opened descriptor has been verified. This
        // prevents a parent/symlink swap from destroying an external file on
        // platforms where O_NOFOLLOW is unavailable or incomplete.
        handle.set_len(0)?;
        handle.rewind()?;
        handle.write_all(content.as_bytes())?;
        Ok(json!({}))
    }
}

/// `content.split(/\r?\n/u)`.
fn split_lines(content: &str) -> Vec<&str> {
    let pieces: Vec<&str> = content.split('\n').collect();
    let last = pieces.len() - 1;
    pieces
        .into_iter()
        .enumerate()
        .map(|(index, piece)| {
            if index < last {
                piece.strip_suffix('\r').unwrap_or(piece)
            } else {
                piece
            }
        })
        .collect()
}

#[cfg(unix)]
fn same_file_identity(expected: &std::fs::Metadata, actual: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    expected.dev() == actual.dev() && expected.ino() == actual.ino()
}

#[cfg(not(unix))]
fn same_file_identity(expected: &std::fs::Metadata, actual: &std::fs::Metadata) -> bool {
    let millis = |m: &std::fs::Metadata| {
        m.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
    };
    expected.len() == actual.len() && millis(expected) == millis(actual)
}

fn workspace_path(raw_path: Option<&Value>) -> AgentResult<&str> {
    match raw_path.and_then(Value::as_str) {
        Some(path) if !path.is_empty() && text::len16(path) <= 4_096 => Ok(path),
        _ => Err(AgentError::new("ACP workspace path is invalid.")),
    }
}

fn canonical_existing_file(
    root: &Path,
    raw_path: Option<&Value>,
    references: &[Value],
) -> AgentResult<PathBuf> {
    let raw_path = workspace_path(raw_path)?;
    let target = paths::resolve(root, raw_path);
    let canonical = std::fs::canonicalize(&target)
        .map_err(|_| AgentError::new("ACP workspace file does not exist."))?;
    if !is_inside(root, &canonical) {
        let granted = references.iter().any(|reference| {
            let field = |key: &str| reference.get(key).and_then(Value::as_str);
            let (Some(owning_root), Some(path)) = (field("authorizedWorkspaceRoot"), field("path"))
            else {
                return false;
            };
            if reference.get("authorized") != Some(&Value::Bool(true))
                || field("kind") != Some("workspace-entry")
                || !is_inside(Path::new(owning_root), &canonical)
            {
                return false;
            }
            if field("entryType") == Some("directory") {
                is_inside(Path::new(path), &canonical)
            } else {
                Path::new(path) == canonical
            }
        });
        if !granted {
            return Err(AgentError::new(
                "ACP file access must stay inside the authorized workspace or a referenced read scope.",
            ));
        }
    }
    Ok(canonical)
}

fn is_inside(root: &Path, target: &Path) -> bool {
    let relative = paths::relative(root, target);
    relative != ".."
        && !relative.starts_with(&format!("..{MAIN_SEPARATOR_STR}"))
        && !paths::is_absolute(&relative)
}

fn ensure_canonical_parent(root: &Path, parent: &Path) -> AgentResult<()> {
    assert_inside(root, parent)?;
    let relative = paths::relative(root, parent);
    let mut current = root.to_path_buf();
    for segment in relative.split(MAIN_SEPARATOR_STR).filter(|s| !s.is_empty()) {
        current.push(segment);
        let metadata = match std::fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut builder = std::fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(&current)?;
                std::fs::symlink_metadata(&current)?
            }
            Err(error) => return Err(error.into()),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(AgentError::new(
                "ACP write parent must remain a real workspace directory.",
            ));
        }
        let canonical = std::fs::canonicalize(&current)?;
        assert_inside(root, &canonical)?;
    }
    Ok(())
}

fn resolve_workspace_path(root: &Path, raw_path: Option<&Value>) -> AgentResult<PathBuf> {
    let raw_path = workspace_path(raw_path)?;
    let target = paths::resolve(root, raw_path);
    assert_inside(root, &target)?;
    Ok(target)
}

fn assert_inside(root: &Path, target: &Path) -> AgentResult<()> {
    let relative = paths::relative(root, target);
    if relative.starts_with("..") || paths::is_absolute(&relative) {
        return Err(AgentError::new(
            "ACP file access must stay inside the authorized workspace.",
        ));
    }
    Ok(())
}

fn bounded_integer(value: Option<&Value>, minimum: f64, maximum: f64, fallback: f64) -> i64 {
    let parsed = js::to_number(value);
    let safe =
        parsed.is_finite() && parsed.fract() == 0.0 && parsed.abs() <= js::MAX_SAFE_INTEGER as f64;
    (if safe {
        parsed.max(minimum).min(maximum)
    } else {
        fallback
    }) as i64
}
