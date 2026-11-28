//! Local CLI inventory; availability is not a claim of Chat adapter support.
//! Identities and labels mirror `local-agents/setup/localAgentCatalog.ts`
//! and `electron/main/local-agent-installation/definitions/*`.
use crate::platform::local_agent_setup::{Observation, ObservationFailure, ObservationStatus};
use crate::{
    agent::connections::legacy_runtime_registry::Runtime, platform::environment::search_dirs,
};
use std::path::{Path, PathBuf};
#[derive(Clone, Debug)]
pub struct Installation {
    pub runtime: Runtime,
    /// Local agent id (`claude`, `workbuddy-china`, …) or `puppyone-agent`.
    pub id: &'static str,
    pub label: String,
    pub executable: PathBuf,
    pub chat: bool,
}
impl Installation {
    pub fn bundled(&self) -> bool {
        self.runtime == Runtime::PuppyOne
    }
}
pub const BUILT_IN_AGENT_ID: &str = "puppyone-agent";
/// `BUILT_IN_AGENT_CREATION_RECIPE.label`.
pub const BUILT_IN_AGENT_LABEL: &str = "Built-in Agent";

enum Locator {
    /// Executable names searched on the user's PATH and known install dirs.
    Path(&'static [&'static str]),
    /// macOS app bundles with an embedded CLI, plus an explicit override.
    AppBundle {
        app: &'static str,
        cli: &'static [&'static str],
        override_env: &'static str,
    },
}
pub struct LocalAgent {
    pub id: &'static str,
    pub label: &'static str,
    pub runtime: Runtime,
    locator: Locator,
}
const WORKBUDDY_CLI: &[&str] = &[
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "cli",
    "bin",
    "codebuddy",
];
/// User-installed chat products, sorted by English label (`LOCAL_AGENT_CHAT_RECIPES`).
pub const LOCAL_AGENTS: &[LocalAgent] = &[
    LocalAgent {
        id: "claude",
        label: "Claude Code",
        runtime: Runtime::Claude,
        locator: Locator::Path(&["claude"]),
    },
    LocalAgent {
        id: "codex",
        label: "Codex",
        runtime: Runtime::Codex,
        locator: Locator::Path(&["codex"]),
    },
    LocalAgent {
        id: "cursor",
        label: "Cursor",
        runtime: Runtime::Cursor,
        locator: Locator::Path(&["cursor-agent", "agent"]),
    },
    LocalAgent {
        id: "hermes",
        label: "Hermes Agent",
        runtime: Runtime::Hermes,
        locator: Locator::Path(&["hermes"]),
    },
    LocalAgent {
        id: "opencode",
        label: "OpenCode",
        runtime: Runtime::OpenCode,
        locator: Locator::Path(&["opencode"]),
    },
    LocalAgent {
        id: "pi",
        label: "Pi",
        runtime: Runtime::Pi,
        locator: Locator::Path(&["pi"]),
    },
    LocalAgent {
        id: "workbuddy-china",
        label: "WorkBuddy (China)",
        runtime: Runtime::WorkBuddy,
        locator: Locator::AppBundle {
            app: "WorkBuddy.app",
            cli: WORKBUDDY_CLI,
            override_env: "WORKBUDDY_CHINA_CODE_PATH",
        },
    },
    LocalAgent {
        id: "workbuddy-international",
        label: "WorkBuddy (International)",
        runtime: Runtime::WorkBuddy,
        locator: Locator::AppBundle {
            app: "WorkBuddy AI.app",
            cli: WORKBUDDY_CLI,
            override_env: "WORKBUDDY_INTERNATIONAL_CODE_PATH",
        },
    },
];

/// The runtime of a local Agent id (`claude`, `opencode`, …).
pub fn runtime_for(id: &str) -> Option<Runtime> {
    LOCAL_AGENTS.iter().find(|a| a.id == id).map(|a| a.runtime)
}
fn locate(agent: &LocalAgent, dirs: &[PathBuf]) -> std::io::Result<Option<PathBuf>> {
    let mut failed = None;
    let mut probe = |path: &Path| match executable(path) {
        Ok(found) => found,
        Err(error) => {
            failed = Some(error);
            false
        }
    };
    let found = locate_with(agent, dirs, &mut probe);
    if found.is_some() {
        Ok(found)
    } else if let Some(error) = failed {
        Err(error)
    } else {
        Ok(None)
    }
}
fn locate_with(
    agent: &LocalAgent,
    dirs: &[PathBuf],
    probe: &mut dyn FnMut(&Path) -> bool,
) -> Option<PathBuf> {
    match &agent.locator {
        // The PATH and known directories, then the product's own managed
        // installation (`managedInstallationCandidate`, macOS only).
        Locator::Path(names) => names
            .iter()
            .find_map(|name| dirs.iter().map(|dir| dir.join(name)).find(|p| probe(p)))
            .or_else(|| {
                let home = std::env::var_os("HOME").map(PathBuf::from)?;
                crate::platform::local_agent_setup::installer::managed_entry(&home, agent.id)
                    .filter(|p| {
                        crate::platform::conventions::Conventions::current()
                            .supports_managed_agent_installs
                            && probe(p)
                    })
            }),
        Locator::AppBundle {
            app,
            cli,
            override_env,
        } => {
            if let Some(path) = std::env::var_os(override_env).map(PathBuf::from)
                && probe(&path)
            {
                return Some(path);
            }
            let home = std::env::var_os("HOME").map(PathBuf::from);
            [
                Some(PathBuf::from("/Applications")),
                home.map(|h| h.join("Applications")),
            ]
            .into_iter()
            .flatten()
            .map(|root| cli.iter().fold(root.join(app), |p, part| p.join(part)))
            .find(|p| probe(p))
        }
    }
}

/// Detected local agents in catalog order, followed by the bundled Built-in Agent
/// (`compareAgentChatCreationRecipesForDisplay`).
pub fn discover() -> Vec<Installation> {
    discover_with_evidence().installations
}
#[derive(Clone, Debug)]
pub struct Inventory {
    pub installations: Vec<Installation>,
    pub observations: Vec<Observation>,
}
pub fn discover_with_evidence() -> Inventory {
    let dirs = search_dirs();
    discover_from(|agent| locate(agent, &dirs))
}
fn discover_from(
    mut locate: impl FnMut(&LocalAgent) -> std::io::Result<Option<PathBuf>>,
) -> Inventory {
    let mut installations = Vec::new();
    let observations = LOCAL_AGENTS
        .iter()
        .map(|agent| match locate(agent) {
            Ok(Some(executable)) => {
                installations.push(Installation {
                    runtime: agent.runtime,
                    id: agent.id,
                    label: agent.label.into(),
                    executable,
                    chat: true,
                });
                Observation::new(agent.id, ObservationStatus::Found)
            }
            Ok(None) => Observation::new(agent.id, ObservationStatus::NotFound),
            Err(_) => Observation {
                id: agent.id.into(),
                status: ObservationStatus::Failed,
                failure: Some(ObservationFailure::Product),
            },
        })
        .collect();
    installations.push(Installation {
        runtime: Runtime::PuppyOne,
        id: BUILT_IN_AGENT_ID,
        label: BUILT_IN_AGENT_LABEL.into(),
        executable: PathBuf::new(),
        chat: true,
    });
    Inventory {
        installations,
        observations,
    }
}
/// Deterministic installations for the dev-capture lab: the reference fixture's
/// detected agents (`tools/reference-workbench-entry.tsx`) plus Built-in Agent.
#[cfg(feature = "dev-capture")]
pub fn lab_installations() -> Vec<Installation> {
    const DETECTED: [&str; 6] = [
        "claude",
        "codex",
        "cursor",
        "opencode",
        "pi",
        "workbuddy-china",
    ];
    let mut result: Vec<Installation> = LOCAL_AGENTS
        .iter()
        .filter(|agent| DETECTED.contains(&agent.id))
        .map(|agent| Installation {
            runtime: agent.runtime,
            id: agent.id,
            label: agent.label.into(),
            executable: PathBuf::new(),
            chat: true,
        })
        .collect();
    result.push(Installation {
        runtime: Runtime::PuppyOne,
        id: BUILT_IN_AGENT_ID,
        label: BUILT_IN_AGENT_LABEL.into(),
        executable: PathBuf::new(),
        chat: true,
    });
    result
}
fn executable(path: &Path) -> std::io::Result<bool> {
    crate::platform::fs::is_executable_file(path)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_is_alphabetical_and_built_in_comes_last() {
        let labels: Vec<_> = LOCAL_AGENTS.iter().map(|a| a.label).collect();
        let mut sorted = labels.clone();
        sorted.sort_by_key(|l| l.to_lowercase());
        assert_eq!(labels, sorted);
        let found = discover_from(|_| Ok(None)).installations;
        assert_eq!(found.last().unwrap().id, BUILT_IN_AGENT_ID);
        assert_eq!(found.last().unwrap().label, "Built-in Agent");
    }
    #[test]
    fn installation_inventory_keeps_failed_probes_distinct_from_absence() {
        let result = discover_from(|agent| match agent.id {
            "claude" => Ok(Some(PathBuf::from("/fixture/claude"))),
            "codex" => Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
            _ => Ok(None),
        });
        assert_eq!(
            result
                .installations
                .iter()
                .map(|a| a.id)
                .collect::<Vec<_>>(),
            vec!["claude", BUILT_IN_AGENT_ID]
        );
        assert_eq!(result.observations.len(), 8);
        assert_eq!(
            result.observations[0],
            Observation::new("claude", ObservationStatus::Found)
        );
        assert_eq!(
            result.observations[1],
            Observation {
                id: "codex".into(),
                status: ObservationStatus::Failed,
                failure: Some(ObservationFailure::Product)
            }
        );
        assert!(
            result.observations[2..]
                .iter()
                .all(|o| o.status == ObservationStatus::NotFound && o.failure.is_none())
        );
        assert!(
            !result
                .observations
                .iter()
                .any(|o| o.id == BUILT_IN_AGENT_ID)
        );
    }
    #[cfg(unix)]
    #[test]
    fn executable_probe_distinguishes_absence_permissions_and_metadata_errors() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("agent");
        assert!(!executable(&file).unwrap());
        assert!(!executable(dir.path()).unwrap());
        std::fs::write(&file, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!executable(&file).unwrap());
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(executable(&file).unwrap());
        let cycle = dir.path().join("cycle");
        symlink(&cycle, &cycle).unwrap();
        assert!(
            executable(&cycle).is_err(),
            "a metadata error is not proof of absence"
        );
    }
}
