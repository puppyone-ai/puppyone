use super::super::contracts::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Target {
    ProjectRoot {
        project_id: String,
    },
    Scope {
        project_id: String,
        scope_id: String,
    },
}
impl Target {
    pub(super) fn project(&self) -> Result<&str> {
        let Self::ProjectRoot { project_id } = self else {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                "Live Cloud files require project-root access",
            ));
        };
        if !identifier(project_id) {
            return Err(Error::from("Invalid Cloud project identity"));
        }
        Ok(project_id)
    }
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || v == b'-')
}
pub(super) fn invalid() -> Error {
    Error::new(
        ErrorKind::Io,
        "The live Cloud response could not be verified",
    )
}
pub(super) fn stale() -> Error {
    Error::new(
        ErrorKind::StaleLease,
        "Cloud access changed; reopen this workspace",
    )
}
pub(super) fn path(value: &RelativePath, root: bool) -> Result<&str> {
    let value = value
        .as_path()
        .to_str()
        .ok_or_else(|| Error::from("Cloud names must be UTF-8"))?;
    if value.len() > 4096
        || (!root && value.is_empty())
        || value.contains(['\\', '\0'])
        || value.as_bytes().get(1) == Some(&b':')
        || (!value.is_empty()
            && value
                .split('/')
                .any(|v| matches!(v, "" | "." | ".." | ".git")))
    {
        return Err(Error::from("Invalid Cloud resource path"));
    }
    Ok(value)
}
pub(super) fn child(parent: &RelativePath, name: &str) -> Result<RelativePath> {
    if name.is_empty() || name.trim() != name || name.contains(['/', '\\', '\0']) {
        return Err(Error::from("A single Cloud entry name is required"));
    }
    let result = RelativePath::new(&parent.as_path().join(name))?;
    path(&result, false)?;
    Ok(result)
}
#[derive(Deserialize)]
pub(super) struct Context {
    pub target: Target,
    pub project: Project,
    pub scope_path: Option<String>,
}
#[derive(Deserialize)]
pub(super) struct Project {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<String>,
}
#[derive(Clone, Deserialize)]
pub(super) struct Runtime {
    pub id: String,
    pub project_id: String,
    pub generation: String,
    pub state: String,
    pub operation: Option<Operation>,
}
#[derive(Clone, Deserialize)]
pub(super) struct Operation {
    pub pending: bool,
    pub error: Option<String>,
}
impl Runtime {
    pub fn ready(&self, project: &str) -> Result<()> {
        if self.project_id != project
            || !identifier(&self.id)
            || uuid::Uuid::parse_str(&self.generation).is_err()
        {
            return Err(invalid());
        }
        if self.state != "running"
            || self
                .operation
                .as_ref()
                .is_some_and(|v| v.pending || v.error.is_some())
        {
            return Err(Error::new(
                ErrorKind::Io,
                "Cloud workspace is not ready; explicit opening or recovery is required",
            ));
        }
        Ok(())
    }
}
#[derive(Deserialize)]
struct Listed {
    name: String,
    kind: String,
    size: u64,
}
pub(super) fn entries(value: serde_json::Value, parent: &RelativePath) -> Result<Vec<Entry>> {
    let values = value
        .get("entries")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(invalid)?;
    if values.len() > Limits::CLOUD.directory_entries {
        return Err(invalid());
    }
    let mut names = std::collections::HashSet::new();
    values
        .iter()
        .map(|value| {
            let row: Listed = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
            if !matches!(
                row.kind.as_str(),
                "file" | "directory" | "symlink" | "special"
            ) || !names.insert(row.name.clone())
            {
                return Err(invalid());
            }
            let _ = row.size;
            Ok(Entry {
                path: child(parent, &row.name)?,
                name: row.name,
                folder: row.kind == "directory",
            })
        })
        .collect()
}
#[derive(Clone)]
pub(super) struct File {
    pub bytes: Arc<[u8]>,
    pub digest: String,
}
pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
impl File {
    pub fn decode(value: serde_json::Value, name: &RelativePath) -> Result<Self> {
        let encoded = value["content_base64"].as_str().ok_or_else(invalid)?;
        if encoded.len() > Limits::CLOUD.text_bytes.div_ceil(3) * 4 {
            return Err(invalid());
        }
        let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
        let revision = value["revision"].as_str().ok_or_else(invalid)?;
        if bytes.len() > Limits::CLOUD.text_bytes
            || value["size"].as_u64() != Some(bytes.len() as u64)
            || value["name"].as_str() != name.as_path().file_name().and_then(|v| v.to_str())
            || value["kind"].as_str() != Some("file")
            || !hex(revision)
            || digest(&bytes) != revision
        {
            return Err(invalid());
        }
        Ok(Self {
            bytes: bytes.into(),
            digest: revision.into(),
        })
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Version {
    pub storage: String,
    pub workspace: String,
    pub generation: String,
    pub path: String,
    pub revision: String,
    pub bom: bool,
    pub crlf: bool,
}
impl Version {
    pub fn parse(
        revision: &Revision,
        storage: &StorageId,
        runtime: &Runtime,
        relative: &RelativePath,
    ) -> Result<Self> {
        let raw = revision
            .0
            .strip_prefix("cloud-live-v1:")
            .filter(|v| v.len() <= 16384)
            .ok_or_else(stale)?;
        let value: Self = serde_json::from_str(raw).map_err(|_| stale())?;
        if value.storage != storage.as_str()
            || value.workspace != runtime.id
            || value.generation != runtime.generation
            || value.path != path(relative, false)?
            || !hex(&value.revision)
        {
            return Err(stale());
        }
        Ok(value)
    }
    pub fn snapshot(
        file: &File,
        storage: &StorageId,
        runtime: &Runtime,
        relative: &RelativePath,
    ) -> Result<TextSnapshot> {
        let bom = file.bytes.starts_with(b"\xef\xbb\xbf");
        let text = std::str::from_utf8(if bom { &file.bytes[3..] } else { &file.bytes })
            .map_err(|_| Error::from("This Cloud file is not UTF-8 text"))?;
        let crlf = text.contains("\r\n");
        let normalized = text.replace("\r\n", "\n");
        if text.contains('\0')
            || normalized.contains('\r')
            || (crlf && text.replace("\r\n", "").contains('\n'))
        {
            return Err(Error::from(
                "Unsupported Cloud text encoding or mixed line endings",
            ));
        }
        let version = Self {
            storage: storage.as_str().into(),
            workspace: runtime.id.clone(),
            generation: runtime.generation.clone(),
            path: path(relative, false)?.into(),
            revision: file.digest.clone(),
            bom,
            crlf,
        };
        Ok(TextSnapshot {
            text: normalized,
            revision: version.revision()?,
        })
    }
    pub fn revision(&self) -> Result<Revision> {
        Ok(Revision(format!(
            "cloud-live-v1:{}",
            serde_json::to_string(self).map_err(|_| invalid())?
        )))
    }
    pub fn encode(&self, text: &str) -> Result<Vec<u8>> {
        if text.len() > Limits::CLOUD.text_bytes || text.contains(['\0', '\r']) {
            return Err(Error::from("Invalid Cloud text"));
        }
        let mut bytes = if self.bom {
            b"\xef\xbb\xbf".to_vec()
        } else {
            Vec::new()
        };
        if self.crlf {
            bytes.extend_from_slice(text.replace('\n', "\r\n").as_bytes());
        } else {
            bytes.extend_from_slice(text.as_bytes());
        }
        if bytes.len() > Limits::CLOUD.text_bytes {
            return Err(Error::from("Cloud files are limited to 8 MiB"));
        }
        Ok(bytes)
    }
}
