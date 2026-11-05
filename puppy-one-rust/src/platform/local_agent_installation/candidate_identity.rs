//! `local-agent-installation/candidate-identity.mjs`: verify ambiguous
//! executable names with bounded, read-only evidence.
use super::executable_resolver::{ResolvedCandidate, safe_absolute_path};
use super::installation_definition::{IdentityPolicy, InstallationDefinition, ManifestPolicy};
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};

/// `localAgentCandidateIdentityPolicy`.
pub mod policy {
    pub const MAX_IDENTITY_VALUES: usize = 8;
    pub const MAX_PARENT_DEPTH: usize = 6;
    pub const MAX_PACKAGE_BYTES: u64 = 128 * 1024;
    pub const MAX_EXECUTABLE_PREFIX_BYTES: usize = 16 * 1024;
    pub const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
}

/// `verifyLocalAgentCandidateIdentity(definition, candidate)`.
pub fn verify_local_agent_candidate_identity(
    definition: &InstallationDefinition,
    candidate: &ResolvedCandidate,
) -> bool {
    let Some(policy) = definition.identity_policy.as_ref() else {
        return true;
    };
    verify_candidate_identity(policy, candidate)
}

/// The policy half of [`verify_local_agent_candidate_identity`].
pub fn verify_candidate_identity(policy: &IdentityPolicy, candidate: &ResolvedCandidate) -> bool {
    if matches!(
        candidate.source.as_str(),
        "configured" | "environment-override" | "explicit-configuration"
    ) {
        return true;
    }
    if !policy
        .required_for_invocations
        .contains(&candidate.invoked_as)
    {
        return true;
    }
    let identity_path = candidate
        .entrypoint_canonical_identity
        .clone()
        .or_else(|| candidate.entrypoint_path.clone())
        .unwrap_or_else(|| candidate.canonical_identity.clone());
    if candidate.requires_manifest_identity
        && !policy
            .manifest
            .as_ref()
            .is_some_and(|manifest| has_manifest_identity(candidate, &identity_path, manifest))
    {
        return false;
    }
    let normalized_path = normalize_path(&identity_path);
    if policy
        .path_fragments
        .iter()
        .any(|fragment| normalized_path.contains(&normalize_path(fragment)))
    {
        return true;
    }
    if has_package_identity(&identity_path, &policy.package_names) {
        return true;
    }
    has_executable_marker(&identity_path, &policy.file_markers)
}

fn parent(path: &Path) -> PathBuf {
    path.parent()
        .map_or_else(|| path.to_path_buf(), Path::to_path_buf)
}

fn has_manifest_identity(
    candidate: &ResolvedCandidate,
    executable_path: &str,
    policy: &ManifestPolicy,
) -> bool {
    if !safe_absolute_path(executable_path) {
        return false;
    }
    let manifest_path = match candidate
        .identity_file_canonical_identity
        .clone()
        .or_else(|| candidate.identity_file_path.clone())
    {
        Some(path) => path,
        None => {
            let mut directory = parent(Path::new(executable_path));
            for _ in 0..policy.parent_depth {
                directory = parent(&directory);
            }
            directory
                .join(&policy.file_name)
                .to_string_lossy()
                .into_owned()
        }
    };
    if !safe_absolute_path(&manifest_path) {
        return false;
    }
    let Ok(metadata) = std::fs::metadata(&manifest_path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() > policy::MAX_MANIFEST_BYTES {
        return false;
    }
    let Ok(manifest) = std::fs::read_to_string(&manifest_path)
        .map_err(|_| ())
        .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|_| ()))
    else {
        return false;
    };
    manifest
        .get(&policy.property)
        .and_then(Value::as_str)
        .is_some_and(|value| policy.values.iter().any(|expected| expected == value))
}

fn has_package_identity(executable_path: &str, package_names: &[String]) -> bool {
    let expected = normalize_evidence_values(package_names);
    if !safe_absolute_path(executable_path) || expected.is_empty() {
        return false;
    }
    let mut directory = parent(Path::new(executable_path));
    for _ in 0..policy::MAX_PARENT_DEPTH {
        // Standalone binaries and wrappers usually have no adjacent manifest.
        let manifest_path = directory.join("package.json");
        if let Ok(metadata) = std::fs::metadata(&manifest_path)
            && metadata.is_file()
            && metadata.len() <= policy::MAX_PACKAGE_BYTES
            && let Ok(manifest) = std::fs::read_to_string(&manifest_path)
            && let Ok(manifest) = serde_json::from_str::<Value>(&manifest)
        {
            let name = manifest
                .get("name")
                .filter(|n| crate::agent::contract::js::truthy(n))
                .map(|n| crate::agent::contract::js::to_js_string(Some(n)))
                .unwrap_or_default()
                .to_lowercase();
            if expected.contains(&name) {
                return true;
            }
        }
        let next = parent(&directory);
        if next == directory {
            break;
        }
        directory = next;
    }
    false
}

fn has_executable_marker(executable_path: &str, markers: &[String]) -> bool {
    let expected = normalize_evidence_values(markers);
    if !safe_absolute_path(executable_path) || expected.is_empty() {
        return false;
    }
    let Ok(file) = std::fs::File::open(executable_path) else {
        return false;
    };
    let mut prefix = Vec::with_capacity(policy::MAX_EXECUTABLE_PREFIX_BYTES);
    if file
        .take(policy::MAX_EXECUTABLE_PREFIX_BYTES as u64)
        .read_to_end(&mut prefix)
        .is_err()
    {
        return false;
    }
    let prefix = String::from_utf8_lossy(&prefix).to_lowercase();
    expected
        .iter()
        .any(|marker| prefix.contains(marker.as_str()))
}

fn normalize_evidence_values(values: &[String]) -> Vec<String> {
    values
        .iter()
        .take(policy::MAX_IDENTITY_VALUES)
        .filter(|value| !value.is_empty() && crate::agent::contract::js::len16(value) <= 160)
        .map(|value| value.to_lowercase())
        .collect()
}

fn normalize_path(value: &str) -> String {
    value.replace('\\', "/").to_lowercase()
}
