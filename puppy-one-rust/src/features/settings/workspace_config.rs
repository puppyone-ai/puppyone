//! Port of `local-api/workspace-config.mjs` and the Settings draft rules of
//! `PuppyoneWorkspaceConfigSettings.tsx`: `<project>/.puppyone/config.json`
//! (version 3) is normalized on read and written atomically, keeping any keys
//! this version does not know.
use serde_json::{Map, Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const DIR: &str = ".puppyone";
const FILE: &str = "config.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Service {
    Puppyone,
    Github,
    Custom,
}
impl Service {
    fn parse(value: Option<&Value>) -> Self {
        match value.and_then(Value::as_str) {
            Some("puppyone") => Self::Puppyone,
            Some("custom") => Self::Custom,
            _ => Self::Github,
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Puppyone => "puppyone",
            Self::Github => "github",
            Self::Custom => "custom",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Puppyone => "Puppyone Cloud",
            Self::Github => "GitHub",
            Self::Custom => "Custom",
        }
    }
}

/// The fields Settings edits; `extra` keeps the rest of the document.
#[derive(Clone, Debug, PartialEq)]
pub struct WorkspaceConfig {
    pub source_service: Service,
    pub source_remote: Option<String>,
    pub source_branch: Option<String>,
    pub primary_remote: Option<String>,
    pub watched_branch: Option<String>,
    pub backup_enabled: bool,
    pub backup_service: Service,
    pub backup_remote: Option<String>,
    pub backup_branch: Option<String>,
    pub updated_at: Option<String>,
    extra: Value,
}
impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self::normalize(&Value::Null).expect("default config")
    }
}

fn text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}
fn object(value: Option<&Value>) -> Option<&Map<String, Value>> {
    value.and_then(Value::as_object)
}

impl WorkspaceConfig {
    /// `normalizePuppyoneWorkspaceConfig`.
    pub fn normalize(value: &Value) -> Result<Self, String> {
        let empty = Map::new();
        let source = value.as_object().unwrap_or(&empty);
        let version = source.get("version").map_or(Some(1), Value::as_i64);
        if !matches!(version, Some(1..=3)) {
            return Err(format!(
                "Unsupported PuppyOne config version: {}",
                source
                    .get("version")
                    .map(Value::to_string)
                    .unwrap_or_default()
            ));
        }
        let sync = object(source.get("sync"));
        let truth = object(sync.and_then(|s| s.get("sourceOfTruth")));
        let git = object(source.get("git"));
        let backup = object(source.get("backup"));
        let primary_remote = text(git.and_then(|g| g.get("primaryRemote")));
        let watched_branch = text(git.and_then(|g| g.get("watchedBranch")));
        let source_service = Service::parse(
            truth
                .and_then(|t| t.get("service"))
                .or(backup.and_then(|b| b.get("service"))),
        );
        let puppyone = source_service == Service::Puppyone;
        let source_remote = text(truth.and_then(|t| t.get("remote")))
            .or(primary_remote.clone())
            .or(text(backup.and_then(|b| b.get("remote"))));
        let source_branch = if puppyone {
            None
        } else {
            text(truth.and_then(|t| t.get("branch")))
                .or(watched_branch.clone())
                .or(text(backup.and_then(|b| b.get("branch"))))
        };
        Ok(Self {
            source_service,
            primary_remote: primary_remote.or(source_remote.clone()),
            watched_branch: if puppyone {
                None
            } else {
                watched_branch.or(source_branch.clone())
            },
            backup_enabled: backup.and_then(|b| b.get("enabled")) == Some(&Value::Bool(true)),
            backup_service: Service::parse(
                backup
                    .and_then(|b| b.get("service"))
                    .or(Some(&Value::String(source_service.key().into()))),
            ),
            backup_remote: text(backup.and_then(|b| b.get("remote"))).or(source_remote.clone()),
            backup_branch: text(backup.and_then(|b| b.get("branch"))).or(if puppyone {
                None
            } else {
                source_branch.clone()
            }),
            source_remote,
            source_branch,
            updated_at: text(source.get("updatedAt")),
            extra: value.clone(),
        })
    }
    /// `normalizePuppyoneConfigDraft`: without Cloud, a Puppyone choice
    /// falls back to GitHub; derived fields follow the source of truth.
    pub fn draft(&self, cloud_enabled: bool) -> Self {
        let mut next = Self::normalize(&self.to_json()).unwrap_or_default();
        if !cloud_enabled {
            if next.source_service == Service::Puppyone {
                next.source_service = Service::Github;
            }
            if next.backup_service == Service::Puppyone {
                next.backup_service = Service::Github;
            }
        }
        if next.source_service == Service::Custom {
            next.source_service = Service::Github;
        }
        if next.backup_service == Service::Custom {
            next.backup_service = Service::Github;
        }
        next
    }
    /// `samePuppyoneConfig`.
    pub fn same(&self, other: &Self) -> bool {
        self.source_service == other.source_service
            && self.source_remote == other.source_remote
            && self.source_branch == other.source_branch
            && self.primary_remote == other.primary_remote
            && self.watched_branch == other.watched_branch
            && self.backup_enabled == other.backup_enabled
            && self.backup_service == other.backup_service
            && self.backup_remote == other.backup_remote
            && self.backup_branch == other.backup_branch
    }
    /// `updateSourceOfTruthConfig`: remote/branch also move the git hints.
    pub fn set_source(&mut self, service: Service, remote: Option<String>, branch: Option<String>) {
        self.source_service = service;
        self.source_remote = remote.clone();
        self.primary_remote = remote;
        self.source_branch = branch.clone();
        self.watched_branch = branch;
    }
    /// The document as written, unknown keys preserved.
    pub fn to_json(&self) -> Value {
        let mut out = self.extra.as_object().cloned().unwrap_or_default();
        let merge = |out: &mut Map<String, Value>, key: &str, fields: Value| {
            let mut section = out
                .get(key)
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            for (k, v) in fields.as_object().into_iter().flatten() {
                section.insert(k.clone(), v.clone());
            }
            out.insert(key.into(), Value::Object(section));
        };
        out.insert("version".into(), json!(3));
        let mut sync = out
            .get("sync")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut truth = sync
            .get("sourceOfTruth")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        truth.insert("service".into(), json!(self.source_service.key()));
        truth.insert("remote".into(), json!(self.source_remote));
        truth.insert("branch".into(), json!(self.source_branch));
        sync.insert("sourceOfTruth".into(), Value::Object(truth));
        out.insert("sync".into(), Value::Object(sync));
        merge(
            &mut out,
            "git",
            json!({"primaryRemote": self.primary_remote, "watchedBranch": self.watched_branch}),
        );
        merge(
            &mut out,
            "backup",
            json!({
                "enabled": self.backup_enabled,
                "service": self.backup_service.key(),
                "remote": self.backup_remote,
                "branch": self.backup_branch,
            }),
        );
        match &self.updated_at {
            Some(at) => {
                out.insert("updatedAt".into(), json!(at));
            }
            None => {
                out.remove("updatedAt");
            }
        }
        // Key order of the product file: version, sync, git, backup, updatedAt.
        let mut ordered = Map::new();
        for key in ["version", "sync", "git", "backup"] {
            if let Some(v) = out.remove(key) {
                ordered.insert(key.into(), v);
            }
        }
        let updated = out.remove("updatedAt");
        ordered.extend(out);
        if let Some(v) = updated {
            ordered.insert("updatedAt".into(), v);
        }
        Value::Object(ordered)
    }
}

fn real_dir(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            Err("PuppyOne config directory must be a real directory inside the workspace.".into())
        }
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Unable to inspect PuppyOne config directory: {e}")),
    }
}

/// `readPuppyoneWorkspaceConfig`.
pub fn read(root: &Path) -> Result<WorkspaceConfig, String> {
    let dir = root.join(DIR);
    if !real_dir(&dir)? {
        return Ok(WorkspaceConfig::default());
    }
    let path = dir.join(FILE);
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() => {
            return Err("PuppyOne config must be a regular file inside the workspace.".into());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceConfig::default());
        }
        Err(e) => return Err(format!("Unable to inspect PuppyOne config: {e}")),
    }
    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Unable to read PuppyOne config: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(WorkspaceConfig::default());
    }
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Unable to parse PuppyOne config: {e}"))?;
    WorkspaceConfig::normalize(&value).map_err(|e| format!("Unable to parse PuppyOne config: {e}"))
}

/// `writePuppyoneWorkspaceConfig`: normalize, stamp `updatedAt`, then write
/// a 0600 temporary file in the real config directory and rename it.
pub fn write(root: &Path, config: &WorkspaceConfig) -> Result<WorkspaceConfig, String> {
    let mut config = WorkspaceConfig::normalize(&config.to_json())?;
    config.updated_at = Some(iso_now());
    let dir = root.join(DIR);
    if let Err(e) = fs::create_dir(&dir)
        && e.kind() != std::io::ErrorKind::AlreadyExists
    {
        return Err(format!("Unable to create PuppyOne config directory: {e}"));
    }
    real_dir(&dir)?;
    let canonical = fs::canonicalize(&dir)
        .map_err(|e| format!("Unable to inspect PuppyOne config directory: {e}"))?;
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    if !canonical.starts_with(&root) {
        return Err("PuppyOne config directory resolves outside the workspace.".into());
    }
    let path = canonical.join(FILE);
    if let Ok(meta) = fs::symlink_metadata(&path)
        && (meta.file_type().is_symlink() || !meta.is_file())
    {
        return Err("PuppyOne config must be a regular file inside the workspace.".into());
    }
    let temp: PathBuf = canonical.join(format!(
        ".config.{}.{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        let mut text = serde_json::to_string_pretty(&config.to_json())?;
        text.push('\n');
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temp, &path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    })();
    let _ = fs::remove_file(&temp);
    result.map_err(|e| format!("Unable to write PuppyOne config: {e}"))?;
    Ok(config)
}

/// `new Date().toISOString()`.
fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let ms = now.as_millis() as i64;
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn legacy_documents_normalize_like_the_product() {
        let config = WorkspaceConfig::normalize(&json!({
            "version": 2,
            "git": {"primaryRemote": "origin", "watchedBranch": "main"},
            "backup": {"enabled": true},
            "custom": {"kept": 1}
        }))
        .unwrap();
        assert_eq!(config.source_service, Service::Github);
        assert_eq!(config.source_remote.as_deref(), Some("origin"));
        assert_eq!(config.source_branch.as_deref(), Some("main"));
        assert!(config.backup_enabled);
        assert_eq!(config.backup_remote.as_deref(), Some("origin"));
        let out = config.to_json();
        assert_eq!(out["version"], 3);
        assert_eq!(out["custom"]["kept"], 1);
        assert_eq!(out["sync"]["sourceOfTruth"]["branch"], "main");
        assert!(WorkspaceConfig::normalize(&json!({"version": 9})).is_err());
    }

    #[test]
    fn writes_are_atomic_private_and_round_trip() {
        let root = std::env::temp_dir().join(format!("po-config-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        assert_eq!(read(&root).unwrap(), WorkspaceConfig::default());
        let mut config = WorkspaceConfig::default();
        config.set_source(Service::Github, Some("origin".into()), Some("dev".into()));
        let saved = write(&root, &config).unwrap();
        assert!(
            saved
                .updated_at
                .as_deref()
                .is_some_and(|at| at.ends_with('Z') && at.len() == 24)
        );
        let back = read(&root).unwrap();
        assert!(back.same(&saved));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(root.join(DIR).join(FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(root);
    }
}
