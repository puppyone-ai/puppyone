//! `local-agent-installation/definitions/codex.mjs`.
use super::{executable_name, join};
use crate::platform::local_agent_installation::installation_definition::{
    CandidateSpec, InstallationDefinition,
};
use crate::platform::local_agent_installation::managed_installation_layout::managed_installation_candidate;

/// `codexInstallationDefinition`.
pub fn codex_installation_definition() -> InstallationDefinition {
    InstallationDefinition::named("codex", "Codex", &["codex"]).with_candidates(|context| {
        let executable = executable_name("codex", context.platform);
        let mut candidates = Vec::new();
        if let Some(path) = context.var("CODEX_PATH") {
            candidates.push(CandidateSpec::new(path, "environment-override"));
        }
        if let Some(directory) = context.var("CODEX_INSTALL_DIR") {
            candidates.push(CandidateSpec::new(
                join(directory, &[&executable]),
                "product-fallback",
            ));
        }
        if context.platform == "win32"
            && let Some(local) = context.var("LOCALAPPDATA")
        {
            candidates.push(CandidateSpec::new(
                join(local, &["Programs", "OpenAI", "Codex", "bin", &executable]),
                "product-fallback",
            ));
        }
        candidates.push(CandidateSpec::new(
            join(context.homedir, &[".local", "bin", &executable]),
            "product-fallback",
        ));
        candidates.extend(managed_installation_candidate(
            context.homedir,
            context.platform,
            "codex",
        ));
        Ok(candidates)
    })
}
