//! `local-agent-installation/definitions/opencode.mjs`.
use super::{executable_name, join};
use crate::agent::installation::installation_definition::{CandidateSpec, InstallationDefinition};

/// `opencodeInstallationDefinition`.
pub fn opencode_installation_definition() -> InstallationDefinition {
    InstallationDefinition::named("opencode", "OpenCode", &["opencode"]).with_candidates(
        |context| {
            Ok(vec![CandidateSpec::new(
                join(
                    context.homedir,
                    &[
                        ".opencode",
                        "bin",
                        &executable_name("opencode", context.platform),
                    ],
                ),
                "product-fallback",
            )])
        },
    )
}
