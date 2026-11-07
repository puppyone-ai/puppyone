//! `local-agent-installation/definitions/cursor.mjs`.
use super::join;
use crate::agent::installation::installation_definition::{
    CandidateSpec, IdentityPolicy, InstallationDefinition,
};
use crate::agent::installation::managed_installation_layout::managed_installation_candidate;

/// `cursorInstallationDefinition`.
pub fn cursor_installation_definition() -> InstallationDefinition {
    let mut definition = InstallationDefinition::named(
        "cursor",
        "Cursor Agent",
        &["cursor-agent", "agent", "cursor agent"],
    )
    .with_candidates(|context| {
        if context.platform == "win32" {
            return Ok(Vec::new());
        }
        let mut candidates: Vec<CandidateSpec> = ["cursor-agent", "agent"]
            .iter()
            .map(|name| {
                CandidateSpec::new(
                    join(context.homedir, &[".local", "bin", name]),
                    "product-fallback",
                )
            })
            .collect();
        candidates.extend(managed_installation_candidate(
            context.homedir,
            context.platform,
            "cursor",
        ));
        Ok(candidates)
    });
    definition.identity_policy = Some(IdentityPolicy::new(
        &["agent"],
        &[],
        &["cursor-agent", "/cursor/"],
        &["cursor-agent", "cursor_invoked_as"],
    ));
    definition
}
