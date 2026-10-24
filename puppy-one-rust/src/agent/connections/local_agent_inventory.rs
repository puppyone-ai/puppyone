//! Local CLI inventory; availability is not a claim of Chat adapter support.
//! Identities and labels mirror `local-agents/setup/localAgentCatalog.ts`
//! and `electron/main/local-agent-installation/definitions/*`.
use crate::{agent::runtime::agent_runtime_registry::Runtime, platform::environment::search_dirs};
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

fn locate(agent: &LocalAgent, dirs: &[PathBuf]) -> Option<PathBuf> {
    match &agent.locator {
        Locator::Path(names) => names.iter().find_map(|name| {
            dirs.iter()
                .map(|dir| dir.join(name))
                .find(|p| executable(p))
        }),
        Locator::AppBundle {
            app,
            cli,
            override_env,
        } => {
            if let Some(path) = std::env::var_os(override_env).map(PathBuf::from)
                && executable(&path)
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
            .find(|p| executable(p))
        }
    }
}

/// Detected local agents in catalog order, followed by the bundled Built-in Agent
/// (`compareAgentChatCreationRecipesForDisplay`).
pub fn discover() -> Vec<Installation> {
    let dirs = search_dirs();
    let mut result: Vec<Installation> = LOCAL_AGENTS
        .iter()
        .filter_map(|agent| {
            locate(agent, &dirs).map(|executable| Installation {
                runtime: agent.runtime,
                id: agent.id,
                label: agent.label.into(),
                executable,
                chat: true,
            })
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
fn executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
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
        let found = discover();
        assert_eq!(found.last().unwrap().id, BUILT_IN_AGENT_ID);
        assert_eq!(found.last().unwrap().label, "Built-in Agent");
    }
}
