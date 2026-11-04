//! `agentBrandCatalog`: the stable visual identity of Agent products — ids,
//! names, the aliases a connection's own name is matched by, and the
//! product's marks (`assets/agents`, imported by
//! `tools/import-agent-marks.py`) with their optical scale.
use gpui::{prelude::*, *};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Brand {
    pub id: &'static str,
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    /// Compensates for the transparent safety area in the source asset.
    pub scale: f32,
    pub light: &'static str,
    pub dark: Option<&'static str>,
}
const fn brand(
    id: &'static str,
    name: &'static str,
    aliases: &'static [&'static str],
    light: &'static str,
    dark: Option<&'static str>,
    scale: f32,
) -> Brand {
    Brand {
        id,
        name,
        aliases,
        scale,
        light,
        dark,
    }
}
/// `AGENT_BRAND_IDS` order, which `resolveAgentBrand` searches in.
pub const BRANDS: [Brand; 18] = [
    brand("chatgpt", "ChatGPT", &["chatgpt"], "chatgpt.png", None, 1.),
    brand(
        "claude",
        "Claude Code",
        &["claude", "anthropic"],
        "claude-code.svg",
        None,
        0.84,
    ),
    brand(
        "codex",
        "Codex",
        &["codex", "openai"],
        "chatgpt.png",
        None,
        1.,
    ),
    brand(
        "cursor",
        "Cursor",
        &["cursor"],
        "cursor.svg",
        Some("cursor-dark.svg"),
        0.84,
    ),
    brand(
        "hermes",
        "Hermes Agent",
        &["hermes"],
        "hermes.png",
        None,
        0.82,
    ),
    brand("manus", "Manus", &["manus"], "manus.svg", None, 1.),
    brand(
        "opencode",
        "OpenCode",
        &["opencode"],
        "opencode.svg",
        None,
        1.3,
    ),
    brand(
        "pi",
        "Pi Agent",
        &["pi"],
        "pi.svg",
        Some("pi-dark.svg"),
        1.28,
    ),
    brand(
        "workbuddy",
        "WorkBuddy",
        &["workbuddy", "codebuddy"],
        "workbuddy.png",
        None,
        1.,
    ),
    brand(
        "built-in-agent",
        "Built-in Agent",
        &["built-in-agent", "built-in"],
        "built-in-agent.svg",
        Some("built-in-agent-dark.svg"),
        1.,
    ),
    brand("viktor", "Viktor", &["viktor"], "viktor.png", None, 1.),
    brand("grok-bot", "Grok Bot", &["grok"], "grok-bot.webp", None, 1.),
    brand(
        "replit",
        "Replit Agent",
        &["replit"],
        "replit.svg",
        None,
        1.,
    ),
    brand("gemini", "Gemini", &["gemini"], "gemini.svg", None, 1.),
    brand(
        "github-copilot",
        "GitHub Copilot",
        &["github-copilot"],
        "github-copilot.svg",
        Some("github-copilot-dark.svg"),
        1.,
    ),
    brand("devin", "Devin", &["devin"], "devin.svg", None, 1.),
    brand(
        "copilot-studio",
        "Microsoft Copilot Studio",
        &["copilot-studio"],
        "copilot-studio.svg",
        None,
        1.,
    ),
    brand("jules", "Jules", &["jules"], "jules.svg", None, 1.),
];
/// `LEGACY_AGENT_BRAND_IDS`.
const LEGACY: [(&str, &str); 4] = [
    ("puppyone-agent", "built-in-agent"),
    ("workspace-agent", "built-in-agent"),
    ("workbuddy-china", "workbuddy"),
    ("workbuddy-international", "workbuddy"),
];

/// `getAgentBrand`: a brand id, current or retired.
pub fn get(id: &str) -> Option<&'static Brand> {
    let id = id.to_lowercase();
    let id = LEGACY
        .iter()
        .find(|(legacy, _)| *legacy == id)
        .map_or(id.as_str(), |(_, current)| current);
    BRANDS.iter().find(|b| b.id == id)
}
/// `nameWords`: a name as whole words, so "Grok Bot", "grok-bot" and
/// "GROK_BOT" are one name and "Groq" is not "Grok".
fn name_words(value: &str) -> String {
    let words: Vec<String> = value
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect();
    format!(" {} ", words.join(" "))
}
/// `resolveAgentBrand`: an exact id or icon key, else the first brand one
/// of whose aliases appears in the identity as whole words.
pub fn resolve(
    id: Option<&str>,
    icon_key: Option<&str>,
    label: Option<&str>,
) -> Option<&'static Brand> {
    if let Some(found) = id.and_then(get).or_else(|| icon_key.and_then(get)) {
        return Some(found);
    }
    let words = name_words(
        &[id, icon_key, label]
            .into_iter()
            .flatten()
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
    );
    BRANDS.iter().find(|b| {
        b.aliases
            .iter()
            .any(|alias| words.contains(&name_words(alias)))
    })
}
/// `AgentBrandImage`: the theme's mark at its optical scale in a `size` slot.
pub fn image(brand: &Brand, dark: bool, size: f32) -> Div {
    div()
        .size(px(size))
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .child(artwork(brand, dark, size * brand.scale))
}
/// The theme's artwork alone, `size` square.
pub fn artwork(brand: &Brand, dark: bool, size: f32) -> Img {
    let file = if dark {
        brand.dark.unwrap_or(brand.light)
    } else {
        brand.light
    };
    img(SharedString::from(format!("agents/{file}")))
        .size(px(size))
        .flex_none()
        .object_fit(ObjectFit::Contain)
}
/// Square tiles whose ground runs to the asset's edge: in a round mark the
/// tile becomes the mark (`.desktop-project-reach-mark:is([data-reach-brand=…])`).
pub fn tile(brand: &Brand) -> bool {
    matches!(brand.id, "grok-bot" | "hermes" | "manus" | "opencode")
}
/// `MONOCHROME_AGENT_BRAND_IDS`: single-colour marks drawn in the surface's
/// text colour (the ChatGPT artwork exists only in white).
pub fn monochrome(brand: &Brand) -> Option<&'static str> {
    Some(match brand.id {
        "chatgpt" | "codex" => "agents/chatgpt-mark.svg",
        "claude" => "agents/claude-code.svg",
        "cursor" => "agents/cursor-monochrome.svg",
        "pi" => "agents/pi-monochrome.svg",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// O-9: whole words, and several of them.
    #[test]
    fn brands_are_recognized_by_whole_words() {
        let id = |label: &str| resolve(None, None, Some(label)).map(|b| b.id);
        assert_eq!(id("Grok Bot"), Some("grok-bot"));
        assert_eq!(id("GROK_BOT"), Some("grok-bot"));
        assert_eq!(id("Groq"), None);
        assert_eq!(id("My Claude helper"), Some("claude"));
        assert_eq!(id("GitHub Copilot agent"), Some("github-copilot"));
        assert_eq!(id("github-copilot"), Some("github-copilot"));
        assert_eq!(
            resolve(Some("workspace-agent"), None, None).map(|b| b.id),
            Some("built-in-agent")
        );
        assert_eq!(
            resolve(None, Some("Cursor"), None).map(|b| b.id),
            Some("cursor")
        );
        assert_eq!(id("pipeline"), None);
    }
}
