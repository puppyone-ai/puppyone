//! `local-agent-installation/definitions/claude.mjs`.
use super::{executable_name, join};
use crate::agent::installation::installation_definition::{CandidateSpec, InstallationDefinition};

/// `claudeInstallationDefinition`.
pub fn claude_installation_definition() -> InstallationDefinition {
    InstallationDefinition::named("claude", "Claude Code", &["claude"]).with_candidates(|context| {
        let executable = executable_name("claude", context.platform);
        let mut candidates = Vec::new();
        if let Some(path) = context.var("CLAUDE_CODE_PATH") {
            candidates.push(CandidateSpec::new(path, "environment-override"));
        }
        candidates.push(CandidateSpec::new(
            join(context.homedir, &[".local", "bin", &executable]),
            "product-fallback",
        ));
        candidates.push(CandidateSpec::new(
            join(context.homedir, &[".claude", "local", &executable]),
            "product-fallback",
        ));
        Ok(candidates)
    })
}
