//! Disk-backed static executable probe cache keyed by canonical path, file
//! size, mtime and probe arguments (ADR-024).
//!
//! Caches ONLY static binary facts (`--version`, `--help`, `acp --help`,
//! `acp --check`). Never caches authentication or account status probes.
use crate::agent::discovery::bounded_process_probe::ProbeResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

const CACHE_SCHEMA_VERSION: u32 = 1;
const MAX_ENTRIES: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Fingerprint {
    mtime_ms: u128,
    size: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CachedProbeEntry {
    fingerprint: Fingerprint,
    stdout: String,
    stderr: String,
    code: Option<i32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct PersistedCache {
    schema_version: u32,
    entries: HashMap<String, CachedProbeEntry>,
}

/// Process-wide cache configured once by `AgentHostHandle::start_production`.
static GLOBAL_CACHE: OnceLock<Mutex<Option<ExecutableFingerprintCache>>> = OnceLock::new();

/// Configure the process-wide static probe cache backed by `path`.
pub fn configure_global_fingerprint_cache(path: PathBuf) {
    let slot = GLOBAL_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = slot.lock() {
        *guard = Some(ExecutableFingerprintCache::new(Some(path)));
    }
}

/// Looks up a cached static probe in the process-wide cache if configured.
pub fn lookup_global_static_probe(file: &str, args: &[String]) -> Option<ProbeResult> {
    if !is_cacheable_static_probe(args) {
        return None;
    }
    let slot = GLOBAL_CACHE.get()?;
    let guard = slot.lock().ok()?;
    guard.as_ref()?.get(file, args)
}

/// Stores a successful static probe result in the process-wide cache if configured.
pub fn store_global_static_probe(file: &str, args: &[String], result: &ProbeResult) {
    if !is_cacheable_static_probe(args) {
        return;
    }
    let Some(slot) = GLOBAL_CACHE.get() else {
        return;
    };
    if let Ok(mut guard) = slot.lock()
        && let Some(cache) = guard.as_mut()
    {
        cache.insert(file, args, result);
    }
}

/// Returns true only for static version / CLI-capability probes whose output
/// depends solely on the installed executable binary (never auth/status).
pub fn is_cacheable_static_probe(args: &[String]) -> bool {
    let tail: Vec<&str> = args.iter().map(String::as_str).collect();
    matches!(
        tail.as_slice(),
        ["--version"]
            | ["--help"]
            | ["acp", "--help"]
            | ["acp", "--check"]
            | [_, "--version"]
            | [_, "--help"]
            | [_, "acp", "--help"]
            | [_, "acp", "--check"]
    )
}

fn cache_key(canonical: &Path, args: &[String]) -> String {
    format!("{}\0{}", canonical.to_string_lossy(), args.join("\u{1f}"))
}

fn fingerprint_of(file: &str) -> Option<(PathBuf, Fingerprint)> {
    let canonical = std::fs::canonicalize(file).ok()?;
    let meta = std::fs::metadata(&canonical).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mtime_ms = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some((
        canonical,
        Fingerprint {
            mtime_ms,
            size: meta.len(),
        },
    ))
}

/// Fingerprint-keyed cache for static CLI probes (`--version`, `--help`).
pub struct ExecutableFingerprintCache {
    path: Option<PathBuf>,
    entries: HashMap<String, CachedProbeEntry>,
}

impl ExecutableFingerprintCache {
    pub fn new(path: Option<PathBuf>) -> Self {
        let entries = path.as_deref().and_then(load_persisted).unwrap_or_default();
        Self { path, entries }
    }

    pub fn get(&self, file: &str, args: &[String]) -> Option<ProbeResult> {
        if !is_cacheable_static_probe(args) {
            return None;
        }
        let (canonical, fp) = fingerprint_of(file)?;
        let entry = self.entries.get(&cache_key(&canonical, args))?;
        if entry.fingerprint != fp {
            return None;
        }
        Some(ProbeResult {
            stdout: entry.stdout.clone(),
            stderr: entry.stderr.clone(),
            code: entry.code,
            signal: None,
        })
    }

    pub fn insert(&mut self, file: &str, args: &[String], result: &ProbeResult) {
        if !is_cacheable_static_probe(args) || result.code != Some(0) || result.signal.is_some() {
            return;
        }
        let Some((canonical, fp)) = fingerprint_of(file) else {
            return;
        };
        if self.entries.len() >= MAX_ENTRIES {
            self.entries.clear();
        }
        self.entries.insert(
            cache_key(&canonical, args),
            CachedProbeEntry {
                fingerprint: fp,
                stdout: result.stdout.clone(),
                stderr: result.stderr.clone(),
                code: result.code,
            },
        );
        if let Some(path) = self.path.as_deref() {
            let _ = save_persisted(path, &self.entries);
        }
    }
}

fn load_persisted(path: &Path) -> Option<HashMap<String, CachedProbeEntry>> {
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: PersistedCache = serde_json::from_str(&raw).ok()?;
    if parsed.schema_version != CACHE_SCHEMA_VERSION {
        return None;
    }
    Some(parsed.entries)
}

fn save_persisted(path: &Path, entries: &HashMap<String, CachedProbeEntry>) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let payload = PersistedCache {
        schema_version: CACHE_SCHEMA_VERSION,
        entries: entries.clone(),
    };
    let bytes = serde_json::to_vec(&payload).map_err(std::io::Error::other)?;
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn ok_result(stdout: &str) -> ProbeResult {
        ProbeResult {
            stdout: stdout.into(),
            stderr: String::new(),
            code: Some(0),
            signal: None,
        }
    }

    #[test]
    fn caches_probe_result_by_canonical_path_mtime_and_size_and_persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-cli");
        std::fs::write(&bin, b"#!/bin/sh\necho 1.0.0\n").unwrap();
        let cache_path = dir.path().join("probe-cache.json");
        let args = vec!["--version".to_string()];

        let mut cache = ExecutableFingerprintCache::new(Some(cache_path.clone()));
        assert!(cache.get(bin.to_str().unwrap(), &args).is_none());
        cache.insert(
            bin.to_str().unwrap(),
            &args,
            &ok_result("codex-cli 0.169.0\n"),
        );

        let hit = cache.get(bin.to_str().unwrap(), &args).unwrap();
        assert_eq!(hit.stdout, "codex-cli 0.169.0\n");
        assert_eq!(hit.code, Some(0));

        // Reload from disk simulates an application restart.
        let reloaded = ExecutableFingerprintCache::new(Some(cache_path));
        let persisted_hit = reloaded.get(bin.to_str().unwrap(), &args).unwrap();
        assert_eq!(persisted_hit.stdout, "codex-cli 0.169.0\n");
    }

    #[test]
    fn invalidates_automatically_when_executable_contents_change() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-cli");
        std::fs::write(&bin, b"v1").unwrap();
        let args = vec!["--help".to_string()];

        let mut cache = ExecutableFingerprintCache::new(None);
        cache.insert(bin.to_str().unwrap(), &args, &ok_result("help v1"));
        assert!(cache.get(bin.to_str().unwrap(), &args).is_some());

        // Change file size to simulate an upgraded binary.
        std::fs::write(&bin, b"v2-upgraded-binary").unwrap();
        assert!(cache.get(bin.to_str().unwrap(), &args).is_none());
    }

    #[test]
    fn never_caches_nonzero_or_auth_status_probes() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-cli");
        std::fs::write(&bin, b"bin").unwrap();
        let mut cache = ExecutableFingerprintCache::new(None);

        let version_args = vec!["--version".to_string()];
        cache.insert(
            bin.to_str().unwrap(),
            &version_args,
            &ProbeResult {
                stdout: String::new(),
                stderr: "boom".into(),
                code: Some(1),
                signal: None,
            },
        );
        assert!(cache.get(bin.to_str().unwrap(), &version_args).is_none());

        let auth_args = vec!["status".to_string()];
        assert!(!is_cacheable_static_probe(&auth_args));
        cache.insert(bin.to_str().unwrap(), &auth_args, &ok_result("signed in"));
        assert!(cache.get(bin.to_str().unwrap(), &auth_args).is_none());
    }
}
