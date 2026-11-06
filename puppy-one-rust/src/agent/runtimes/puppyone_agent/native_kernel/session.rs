//! The kernel's sessions (`resolvePuppyOneSession`): Pi-shaped messages
//! under the managed profile's `sessions` folder, one file per session and
//! project. `--no-session` keeps the session in memory.
use super::super::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// A session file's size budget.
const MAX_SESSION_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub version: u8,
    pub id: String,
    pub cwd: PathBuf,
    pub name: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<Value>,
    #[serde(skip)]
    pub in_memory: bool,
}

/// `validSessionId(value)`.
pub fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn folder(profile: &Path, cwd: &Path) -> PathBuf {
    let scope = blake3::hash(cwd.to_string_lossy().as_bytes()).to_hex();
    profile.join("sessions").join(&scope.as_str()[..32])
}

fn file(profile: &Path, cwd: &Path, id: &str) -> PathBuf {
    folder(profile, cwd).join(format!("{id}.json"))
}

impl Session {
    /// `SessionManager.create(cwd, sessionDir)` or `.inMemory(cwd)`.
    pub fn create(cwd: &Path, in_memory: bool) -> Self {
        let now = crate::agent::contract::js::now_ms();
        Self {
            version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            cwd: cwd.to_path_buf(),
            name: None,
            created_at: now,
            updated_at: now,
            messages: Vec::new(),
            in_memory,
        }
    }

    /// `SessionManager.open(match.path, sessionDir, cwd)` for `id`.
    pub fn open(profile: &Path, cwd: &Path, id: &str) -> Result<Self, String> {
        let not_found = || format!("{BUILT_IN_AGENT_DISPLAY_NAME} session not found: {id}");
        if !valid_session_id(id) {
            return Err(format!(
                "{BUILT_IN_AGENT_DISPLAY_NAME} session id is invalid."
            ));
        }
        let path = file(profile, cwd, id);
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| not_found())?;
        if !metadata.is_file() || metadata.len() > MAX_SESSION_BYTES {
            return Err(not_found());
        }
        let bytes = std::fs::read(&path).map_err(|_| not_found())?;
        let session: Session = serde_json::from_slice(&bytes).map_err(|_| not_found())?;
        if session.id != id || session.cwd != cwd {
            return Err(not_found());
        }
        Ok(session)
    }

    /// Persists the session (atomically, owner-only).
    pub fn save(&mut self, profile: &Path) -> Result<(), String> {
        if self.in_memory {
            return Ok(());
        }
        self.updated_at = crate::agent::contract::js::now_ms();
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_SESSION_BYTES {
            return Err(format!(
                "This {BUILT_IN_AGENT_DISPLAY_NAME} session exceeded its storage budget; compact it or start a new chat."
            ));
        }
        let path = file(profile, &self.cwd, &self.id);
        let parent = path.parent().ok_or("The session folder is unavailable.")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
        let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
        let written = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut handle = options.open(&temp)?;
            handle.write_all(&bytes)?;
            handle.sync_all()?;
            std::fs::rename(&temp, &path)
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        written.map_err(|e| e.to_string())
    }
}
