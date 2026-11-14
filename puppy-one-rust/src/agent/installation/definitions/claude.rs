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
        // Homebrew, which a launch from the Dock does not have on PATH.
        if context.platform == "darwin" {
            for prefix in ["/opt/homebrew", "/usr/local"] {
                candidates.push(CandidateSpec::new(
                    join(prefix, &["bin", &executable]),
                    "product-fallback",
                ));
            }
        }
        Ok(candidates)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::installation::installation_definition::CandidateContext;

    /// v0.4.4 `9c136437f`: on macOS, Homebrew's Claude Code is found even
    /// when the app was not launched from a shell with it on PATH.
    #[test]
    fn homebrew_claude_code_is_a_candidate_on_macos_only() {
        let definition = claude_installation_definition();
        let candidates = |platform: &str| {
            let env = Default::default();
            let context = CandidateContext {
                env: &env,
                homedir: std::path::Path::new("/Users/me"),
                platform,
                registered_applications: &[],
            };
            (definition.candidate_paths.as_ref().unwrap())(&context)
                .unwrap()
                .into_iter()
                .map(|c| c.path)
                .collect::<Vec<_>>()
        };
        let mac = candidates("darwin");
        assert!(mac.ends_with(&[
            "/opt/homebrew/bin/claude".into(),
            "/usr/local/bin/claude".into()
        ]));
        assert!(!candidates("linux").iter().any(|p| p.contains("homebrew")));
    }
}
