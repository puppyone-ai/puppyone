//! `local-agent-installation/definitions/hermes.mjs`.
use super::{executable_name, join};
use crate::agent::installation::installation_definition::{CandidateSpec, InstallationDefinition};

/// `hermesInstallationDefinition`.
pub fn hermes_installation_definition() -> InstallationDefinition {
    InstallationDefinition::named("hermes", "Hermes Agent", &["hermes"]).with_candidates(
        |context| {
            Ok(vec![CandidateSpec::new(
                join(
                    context.homedir,
                    &[
                        ".hermes",
                        "bin",
                        &executable_name("hermes", context.platform),
                    ],
                ),
                "product-fallback",
            )])
        },
    )
}
