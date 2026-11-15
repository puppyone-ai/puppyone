//! Local Agent setup: official setup guides, suggestions from installed
//! companion apps, and activation (installing an Agent's CLI where the
//! product has a reviewed recipe).
//!
//! Ports `electron/main/local-agent-catalog` (the trusted declarations),
//! `local-agent-installation/setup` (registry, advisor, companion presence)
//! and `local-agent-activation` (recipes, service, journal, installer).
pub mod activation;
pub mod companion;
pub mod installer;

/// `strategy` of a setup capability.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strategy {
    ExternalCli,
    AppBundledRuntime,
    CompanionManagedRuntime,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Surface {
    Chat,
    Terminal,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Algorithm {
    Sha256,
    Sha512,
}
/// A reviewed, platform-qualified CLI artifact (`recipes/*.mjs`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recipe {
    pub setup_id: &'static str,
    pub version: &'static str,
    /// The stable entry point under `current/` (`codex`, `cursor-agent`).
    pub entry: &'static str,
    /// The executable inside the unpacked archive.
    pub binary: String,
    pub url: String,
    pub algorithm: Algorithm,
    /// The digest, base64 as in the product.
    pub digest: &'static str,
}

/// One setup route (`createSetupRegistry` over `defaultLocalAgentCatalog`).
#[derive(Debug)]
pub struct Route {
    /// The setup id, which is also the installation id.
    pub id: &'static str,
    pub display_name: &'static str,
    pub publisher: &'static str,
    pub guide_url: &'static str,
    pub platforms: &'static [&'static str],
    pub strategy: Strategy,
    /// A Chat runtime exists (`runtimeId`).
    pub chat: bool,
    /// A terminal recipe exists (`terminalRecipeId`).
    pub terminal: bool,
    /// The companion app's bundle identifier.
    pub companion: Option<&'static str>,
    recipe: fn(&str, &str) -> Option<Recipe>,
}
impl Route {
    /// `supportsSetupSurface`.
    pub fn supports(&self, surface: Surface) -> bool {
        match surface {
            Surface::Chat => self.chat,
            Surface::Terminal => self.terminal,
        }
    }
    /// `localAgentCapabilities(...).recipe`.
    pub fn recipe(&self, platform: &str, arch: &str) -> Option<Recipe> {
        self.platforms
            .contains(&platform)
            .then(|| (self.recipe)(platform, arch))
            .flatten()
    }
}
fn guided(_: &str, _: &str) -> Option<Recipe> {
    None
}
/// `codexActivationRecipe`: official npm platform artifacts, integrity
/// reviewed 2026-09-20.
fn codex_recipe(platform: &str, arch: &str) -> Option<Recipe> {
    let digest = match (platform, arch) {
        ("darwin", "arm64") => {
            "cYxzGcRRoBrncyHlR8ed4yXwcoVJZC1pipGULSyJkGFKXJw/Uu57BklvzayuAptjJIipamnOk32CfUkk1F0bLw=="
        }
        ("darwin", "x64") => {
            "FDpc+PdELYlyDnhd76Ckm6jNLF+1n3x34Ygd4QLQger810Vkxx/InQ5LY5jwkecJYKcbvyhMmuxTspaj1dLZrA=="
        }
        _ => return None,
    };
    let triple = if arch == "arm64" { "aarch64" } else { "x86_64" };
    Some(Recipe {
        setup_id: "codex",
        version: "0.155.1",
        entry: "codex",
        binary: format!("vendor/{triple}-apple-darwin/bin/codex"),
        url: format!("https://registry.npmjs.org/@openai/codex/-/codex-0.155.1-darwin-{arch}.tgz"),
        algorithm: Algorithm::Sha512,
        digest,
    })
}
/// `cursorActivationRecipe`: the official cursor.com/install archives,
/// downloaded and hashed 2026-09-20 (the product's hex digests, as base64).
fn cursor_recipe(platform: &str, arch: &str) -> Option<Recipe> {
    let digest = match (platform, arch) {
        ("darwin", "arm64") => "Tme5rIDMSlbgqRs7Q3iU4LpInvfsN/Eg2AhNK/0CCV0=",
        ("darwin", "x64") => "9CmK9xFKV84xfdwTpJwnPhETsCfj5regdpuO81ZeaJc=",
        _ => return None,
    };
    Some(Recipe {
        setup_id: "cursor",
        version: "2026.09.18-9a7762b",
        entry: "cursor-agent",
        binary: "cursor-agent".into(),
        url: format!(
            "https://downloads.cursor.com/lab/2026.09.18-9a7762b/darwin/{arch}/agent-cli-package.tar.gz"
        ),
        algorithm: Algorithm::Sha256,
        digest,
    })
}
const ALL: &[&str] = &["darwin", "linux", "win32"];
/// `setupRegistry`, sorted by display name.
pub const ROUTES: [Route; 8] = [
    Route {
        id: "claude",
        display_name: "Claude Code",
        publisher: "Claude Code",
        guide_url: "https://code.claude.com/docs/en/setup",
        platforms: ALL,
        strategy: Strategy::ExternalCli,
        chat: true,
        terminal: true,
        companion: None,
        recipe: guided,
    },
    Route {
        id: "codex",
        display_name: "Codex",
        publisher: "OpenAI",
        guide_url: "https://developers.openai.com/codex/cli",
        platforms: ALL,
        strategy: Strategy::ExternalCli,
        chat: true,
        terminal: true,
        companion: Some("com.openai.codex"),
        recipe: codex_recipe,
    },
    Route {
        id: "cursor",
        display_name: "Cursor Agent",
        publisher: "Cursor",
        guide_url: "https://cursor.com/docs/cli/installation",
        platforms: &["darwin", "linux"],
        strategy: Strategy::ExternalCli,
        chat: true,
        terminal: true,
        companion: Some("com.todesktop.230313mzl4w4u92"),
        recipe: cursor_recipe,
    },
    Route {
        id: "hermes",
        display_name: "Hermes Agent",
        publisher: "Hermes Agent",
        guide_url: "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/README.md",
        platforms: &["darwin", "linux"],
        strategy: Strategy::CompanionManagedRuntime,
        chat: true,
        terminal: true,
        companion: None,
        recipe: guided,
    },
    Route {
        id: "opencode",
        display_name: "OpenCode",
        publisher: "OpenCode",
        guide_url: "https://opencode.ai/docs",
        platforms: ALL,
        strategy: Strategy::ExternalCli,
        chat: true,
        terminal: true,
        companion: None,
        recipe: guided,
    },
    Route {
        id: "pi",
        display_name: "Pi Agent",
        publisher: "Pi Agent",
        guide_url: "https://github.com/earendil-works/pi/tree/main/packages/coding-agent",
        platforms: ALL,
        strategy: Strategy::ExternalCli,
        chat: true,
        terminal: true,
        companion: None,
        recipe: guided,
    },
    Route {
        id: "workbuddy-china",
        display_name: "WorkBuddy (China)",
        publisher: "WorkBuddy (China)",
        guide_url: "https://www.codebuddy.cn/docs/workbuddy/FirstTask",
        platforms: &["darwin", "win32"],
        strategy: Strategy::AppBundledRuntime,
        chat: true,
        terminal: false,
        companion: None,
        recipe: guided,
    },
    Route {
        id: "workbuddy-international",
        display_name: "WorkBuddy (International)",
        publisher: "WorkBuddy (International)",
        guide_url: "https://www.codebuddy.ai/docs/workbuddy",
        platforms: &["darwin", "win32"],
        strategy: Strategy::AppBundledRuntime,
        chat: true,
        terminal: false,
        companion: None,
        recipe: guided,
    },
];
pub fn route(id: &str) -> Option<&'static Route> {
    ROUTES.iter().find(|r| r.id == id)
}
/// Node's `process.platform` for this build.
pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    }
}
/// Node's `process.arch` for this build.
pub fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}
/// `LOCAL_AGENT_CHAT_IDS` (Chat launcher) and the terminal launchers'
/// local Agents (`DESKTOP_TERMINAL_LAUNCHERS` without the shell).
pub const CHAT_IDS: [&str; 8] = [
    "claude",
    "codex",
    "cursor",
    "hermes",
    "opencode",
    "pi",
    "workbuddy-china",
    "workbuddy-international",
];
pub const TERMINAL_IDS: [&str; 6] = ["codex", "claude", "cursor", "opencode", "pi", "hermes"];

/// Installation observations preserve failures and missing evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservationStatus {
    Found,
    NotFound,
    Failed,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservationFailure {
    EnvironmentUnavailable,
    ContextError,
    Product,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    pub id: String,
    pub status: ObservationStatus,
    pub failure: Option<ObservationFailure>,
}
impl Observation {
    pub fn new(id: &str, status: ObservationStatus) -> Self {
        Self {
            id: id.into(),
            status,
            failure: None,
        }
    }
}
/// A setup row never claims absence from failed or absent evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Found {
    Found,
    NotFound,
    Unknown,
}
/// Completed fixture/legacy evidence; omitted IDs in an unfinished scan must
/// use an empty observation list instead of this helper.
pub fn completed_observations(found: &[&str]) -> Vec<Observation> {
    ROUTES
        .iter()
        .map(|r| {
            Observation::new(
                r.id,
                if found.contains(&r.id) {
                    ObservationStatus::Found
                } else {
                    ObservationStatus::NotFound
                },
            )
        })
        .collect()
}
/// `LocalAgentSetupEntry`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub setup_id: &'static str,
    pub display_name: &'static str,
    pub strategy: Strategy,
    pub status: Found,
    pub companion_present: bool,
    pub recommended: bool,
}
/// The renderer's narrowing of a setup inspection (`LocalAgentSetupRequest`).
pub struct Request<'a> {
    pub surface: Surface,
    pub eligible: &'a [&'a str],
    pub hidden: &'a [String],
    pub enabled: bool,
    pub dismissed: &'a [String],
    pub snoozed_until: &'a std::collections::BTreeMap<String, u64>,
}
/// `adviseSetup`: a pure projection. Missing evidence never becomes an
/// installation claim; a recommendation needs a missing CLI next to its
/// installed companion app.
pub fn advise(
    request: &Request,
    platform: &str,
    observations: &[Observation],
    companions: &[(&'static str, companion::Presence)],
    now: u64,
    suppressed: &std::collections::HashSet<String>,
) -> Vec<Entry> {
    let environment_healthy = !observations.iter().any(|o| {
        matches!(
            o.failure,
            Some(ObservationFailure::EnvironmentUnavailable | ObservationFailure::ContextError)
        )
    });
    ROUTES
        .iter()
        .filter(|r| {
            r.platforms.contains(&platform)
                && r.supports(request.surface)
                && request.eligible.contains(&r.id)
        })
        .map(|r| {
            let status = match observations.iter().find(|o| o.id == r.id).map(|o| o.status) {
                Some(ObservationStatus::Found) => Found::Found,
                Some(ObservationStatus::NotFound) if environment_healthy => Found::NotFound,
                _ => Found::Unknown,
            };
            let companion_present = r.companion.is_some()
                && companions
                    .iter()
                    .any(|(id, p)| *id == r.id && *p == companion::Presence::Present);
            let recommended = status == Found::NotFound
                && companion_present
                && request.enabled
                && !request.hidden.iter().any(|h| h == r.id)
                && !request.dismissed.iter().any(|d| d == r.id)
                && request
                    .snoozed_until
                    .get(r.id)
                    .is_none_or(|until| *until <= now)
                && !suppressed.contains(r.id);
            Entry {
                setup_id: r.id,
                display_name: r.display_name,
                strategy: r.strategy,
                status,
                companion_present,
                recommended,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests;
