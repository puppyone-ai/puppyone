//! `local-agent-installation/managed-installation-layout.mjs`: shared by
//! discovery and the installer. Only our own stable public entrypoints are
//! registered here; vendor artifact internals stay in activation recipes.
use super::installation_definition::CandidateSpec;
use std::path::{Path, PathBuf};

const ENTRIES: &[(&str, &str)] = &[("codex", "codex"), ("cursor", "cursor-agent")];

/// `managedInstallationRoot(homedir, installationId)`.
pub fn managed_installation_root(homedir: &Path, installation_id: &str) -> Option<PathBuf> {
    ENTRIES
        .iter()
        .any(|(id, _)| *id == installation_id)
        .then(|| {
            homedir
                .join(".puppyone")
                .join("agent-runtimes")
                .join(installation_id)
        })
}

/// `managedInstallationCandidate({ homedir, platform }, installationId)`.
pub fn managed_installation_candidate(
    homedir: &Path,
    platform: &str,
    installation_id: &str,
) -> Vec<CandidateSpec> {
    let entry = ENTRIES
        .iter()
        .find(|(id, _)| *id == installation_id)
        .map(|(_, entry)| *entry);
    match (managed_installation_root(homedir, installation_id), entry) {
        (Some(root), Some(entry)) if platform == "darwin" => vec![CandidateSpec::new(
            root.join("current").join(entry).to_string_lossy(),
            "product-fallback",
        )],
        _ => Vec::new(),
    }
}
