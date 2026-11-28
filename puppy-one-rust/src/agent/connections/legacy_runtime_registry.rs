//! Product runtimes retain separate identities even when they share a protocol core.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Runtime {
    PuppyOne,
    Codex,
    Claude,
    Cursor,
    Hermes,
    OpenCode,
    Pi,
    WorkBuddy,
}
impl Runtime {
    /// The runtime whose product mark `key` names (`agentBrandCatalog`).
    pub fn from_icon_key(key: &str) -> Option<Self> {
        Some(match key {
            "built-in-agent" | "puppyone-agent" => Self::PuppyOne,
            "codex" => Self::Codex,
            "claude" => Self::Claude,
            "cursor" => Self::Cursor,
            "opencode" => Self::OpenCode,
            "pi" => Self::Pi,
            "hermes" => Self::Hermes,
            "workbuddy" => Self::WorkBuddy,
            _ => return None,
        })
    }
    /// The product mark's `iconKey` (`agentBrandCatalog`).
    pub fn icon_key(self) -> &'static str {
        match self {
            Self::PuppyOne => "built-in-agent",
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Cursor => "cursor",
            Self::Hermes => "hermes",
            Self::OpenCode => "opencode",
            Self::Pi => "pi",
            Self::WorkBuddy => "workbuddy",
        }
    }
}
