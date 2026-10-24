//! Presentation decisions independent of GPUI layout and provider transport.
//! Labels are product catalog keys (`locales/renderer/*/agent.json`).
use crate::agent::domain::agent_session_model::Decision;
pub fn decision_label(decision: Decision) -> &'static str {
    match decision {
        Decision::Accept => "agent.approval.allowOnce",
        Decision::Decline => "agent.approval.deny",
        Decision::Cancel => "common.action.cancel",
    }
}
/// `agentToolGlyphKind`: provider-neutral tool families.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolKind {
    Command,
    Edit,
    Write,
    Fetch,
    List,
    Read,
    Search,
    Generic,
}
impl ToolKind {
    pub fn of(tool: &str) -> Self {
        let n: String = tool
            .trim()
            .to_lowercase()
            .chars()
            .filter(|c| !matches!(c, ' ' | '_' | '-'))
            .collect();
        let has = |words: &[&str]| words.iter().any(|w| n.contains(w));
        if has(&["bash", "shell", "command", "exec", "terminal", "run"]) {
            Self::Command
        } else if has(&["edit", "patch", "replace", "multiedit", "apply"]) {
            Self::Edit
        } else if has(&["write", "create"]) {
            Self::Write
        } else if has(&["fetch", "web", "http", "url"]) {
            Self::Fetch
        } else if has(&["grep", "search", "find", "glob"]) {
            Self::Search
        } else if has(&["list", "ls", "tree"]) {
            Self::List
        } else if has(&["read", "view", "open", "cat"]) {
            Self::Read
        } else {
            Self::Generic
        }
    }
    /// Lucide glyph used by `AgentToolGlyph`.
    pub fn icon(self) -> &'static str {
        match self {
            Self::Command => "square-terminal",
            Self::Edit | Self::Write => "file-pen-line",
            Self::Fetch => "globe-2",
            Self::List => "list-tree",
            Self::Read => "file-search",
            Self::Search => "search-code",
            Self::Generic => "wrench",
        }
    }
}
pub fn message_preview(text: &str) -> String {
    if text.chars().count() > 32_768 {
        format!("{}\n\n…", text.chars().take(32_768).collect::<String>())
    } else {
        text.into()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_families_match_the_product_glyph_kinds() {
        assert_eq!(ToolKind::of("Bash"), ToolKind::Command);
        assert_eq!(ToolKind::of("MultiEdit"), ToolKind::Edit);
        assert_eq!(ToolKind::of("Write"), ToolKind::Write);
        assert_eq!(ToolKind::of("WebFetch"), ToolKind::Fetch);
        assert_eq!(ToolKind::of("Grep"), ToolKind::Search);
        assert_eq!(ToolKind::of("Read"), ToolKind::Read);
        assert_eq!(ToolKind::of("mcp__thing"), ToolKind::Generic);
    }
}
