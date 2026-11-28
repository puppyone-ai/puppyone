//! `local-agent-installation/definitions/pi.mjs`.
use super::{executable_name, join};
use crate::agent::installation::installation_definition::{
    CandidateSpec, IdentityPolicy, InstallationDefinition,
};
use std::path::Path;

/// `piInstallationDefinition`.
pub fn pi_installation_definition() -> InstallationDefinition {
    let mut definition =
        InstallationDefinition::named("pi", "Pi Agent", &["pi"]).with_candidates(|context| {
            let executable = executable_name("pi", context.platform);
            let mut candidates = Vec::new();
            if let Some(directory) = context.var("PI_CODING_AGENT_DIR") {
                candidates.push(CandidateSpec::new(
                    join(directory, &["bin", &executable]),
                    "product-fallback",
                ));
            }
            if let Some(root) = context.var("PI_MANAGED_INSTALL_ROOT") {
                let parent = Path::new(root).parent().unwrap_or(Path::new(root));
                candidates.push(CandidateSpec::new(
                    join(parent, &["bin", &executable]),
                    "product-fallback",
                ));
            }
            candidates.push(CandidateSpec::new(
                join(context.homedir, &[".pi", "agent", "bin", &executable]),
                "product-fallback",
            ));
            candidates.push(CandidateSpec::new(
                join(context.homedir, &[".local", "bin", &executable]),
                "product-fallback",
            ));
            Ok(candidates)
        });
    definition.identity_policy = Some(IdentityPolicy::new(
        &["pi"],
        &[
            "@earendil-works/pi-coding-agent",
            "@mariozechner/pi-coding-agent",
        ],
        &["/pi-coding-agent/", "/.pi/agent/bin/"],
        &["pi_coding_agent", "pi-coding-agent"],
    ));
    definition
}
