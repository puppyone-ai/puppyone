//! Port of `AgentBrandMark`: official local product assets shared by the
//! launcher, workbench tabs and the empty state.
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
/// The Agent product a mark draws (`AgentLauncherIcon`'s `iconKey`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentMark {
    PuppyOne,
    Codex,
    Claude,
    Cursor,
    Hermes,
    OpenCode,
    Pi,
    WorkBuddy,
}
impl AgentMark {
    /// The mark an `iconKey` names (`agentBrandCatalog`).
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
}
fn asset(runtime: AgentMark, dark: bool) -> &'static str {
    match runtime {
        AgentMark::PuppyOne => {
            if dark {
                "built-in-agent-dark.svg"
            } else {
                "built-in-agent.svg"
            }
        }
        AgentMark::Codex => {
            if dark {
                "codex-dark.png"
            } else {
                "codex-light.png"
            }
        }
        AgentMark::Claude => "claude-code.svg",
        AgentMark::Cursor => {
            if dark {
                "cursor-dark.svg"
            } else {
                "cursor.svg"
            }
        }
        AgentMark::OpenCode => "opencode.svg",
        AgentMark::Pi => {
            if dark {
                "pi-dark.svg"
            } else {
                "pi.svg"
            }
        }
        AgentMark::Hermes => "hermes.png",
        AgentMark::WorkBuddy => "workbuddy.png",
    }
}
/// The ChatGPT mark Codex uses (`agentBrandCatalog`), drawn as an alpha mask
/// in the surrounding colour like `AgentMonochromeBrandImage`.
const CHATGPT_MARK: &str = "agents/chatgpt-mark.svg";
pub fn brand_image(runtime: AgentMark, dark: bool, size: f32) -> Img {
    img(SharedString::from(format!(
        "agents/{}",
        asset(runtime, dark)
    )))
    .size(px(size))
    .object_fit(ObjectFit::Contain)
}
/// SVG mark path for monochrome presentation (`appearance="monochrome"`);
/// raster marks have no monochrome form.
pub fn svg_path(runtime: AgentMark, dark: bool) -> Option<&'static str> {
    if runtime == AgentMark::Codex {
        return Some(CHATGPT_MARK);
    }
    let path = asset(runtime, dark);
    path.ends_with(".svg").then_some(match path {
        "built-in-agent-dark.svg" => "agents/built-in-agent-dark.svg",
        "built-in-agent.svg" => "agents/built-in-agent.svg",
        "claude-code.svg" => "agents/claude-code.svg",
        "cursor-dark.svg" => "agents/cursor-dark.svg",
        "cursor.svg" => "agents/cursor.svg",
        "opencode.svg" => "agents/opencode.svg",
        "pi-dark.svg" => "agents/pi-dark.svg",
        _ => "agents/pi.svg",
    })
}

/// `AgentBrandMark appearance="monochrome"` inside `.desktop-agent-history-option`:
/// a 14px slot (radius 3, `--desktop-agent-brand-mark-scale: 1`, overflow
/// visible). ChatGPT/Codex, Claude, Cursor and Pi have single-colour marks in
/// `color`; other brands keep their image at its `assetOpticalScale`, and
/// OpenCode sits on `--po-canvas`.
pub fn monochrome_mark(
    runtime: AgentMark,
    dark: bool,
    size: f32,
    color: Rgba,
    canvas: Rgba,
) -> Div {
    let slot = div()
        .size(px(size))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(3.));
    let mark = match runtime {
        AgentMark::Codex => Some(CHATGPT_MARK),
        AgentMark::Claude => Some("agents/claude-code.svg"),
        AgentMark::Cursor => Some("agents/cursor-monochrome.svg"),
        AgentMark::Pi => Some("agents/pi-monochrome.svg"),
        _ => None,
    };
    if let Some(path) = mark {
        return slot.child(
            svg()
                .path(path)
                .size(px(size))
                .flex_shrink_0()
                .text_color(color),
        );
    }
    let scale = match runtime {
        AgentMark::Hermes => 0.82,
        AgentMark::OpenCode => 1.3,
        _ => 1.,
    };
    slot.when(runtime == AgentMark::OpenCode, |d| d.bg(canvas))
        .child(brand_image(runtime, dark, size * scale).flex_shrink_0())
}
/// What `AgentLauncherIcon` draws: an Agent brand or the shell. (Native chats
/// always know their runtime, so the product's chat fallback glyph is unused.)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LauncherIdentity {
    Brand(AgentMark),
    Shell,
}
impl LauncherIdentity {
    /// The brand `icon_key` names, or the shell's glyph for none.
    pub fn brand(icon_key: &str) -> Self {
        AgentMark::from_icon_key(icon_key).map_or(Self::Shell, Self::Brand)
    }
}
/// `AgentLauncherIcon` with `src/components/brand/agent-launcher-icon.css`:
/// an 18px (14px compact) clipped slot in `--po-text-muted`, the brand's
/// optical scale (`agentBrandCatalog` `assetOpticalScale`) and its resting
/// opacity. Hover owners raise the opacity to 1.
pub fn launcher_icon(identity: LauncherIdentity, compact: bool, dark: bool, color: Rgba) -> Div {
    let size = if compact { 14. } else { 18. };
    let mut radius = if compact { 3. } else { 4. };
    let mut opacity = if compact { 0.78 } else { 0.72 };
    let mut backing = None;
    let inner: AnyElement = match identity {
        LauncherIdentity::Brand(AgentMark::Codex) => {
            radius = 4.;
            opacity = 0.9;
            svg()
                .path(CHATGPT_MARK)
                .size(px(size))
                .text_color(color)
                .into_any_element()
        }
        LauncherIdentity::Brand(runtime) => {
            let scale = match runtime {
                AgentMark::Claude | AgentMark::Cursor => 0.84,
                AgentMark::Hermes if compact => 0.94,
                AgentMark::Hermes => 0.82,
                AgentMark::OpenCode => 1.3,
                AgentMark::Pi => 1.28,
                _ => 1.,
            };
            match runtime {
                AgentMark::Pi => radius = 3.,
                AgentMark::Hermes => radius = 4.,
                AgentMark::OpenCode => backing = Some(crate::theme::opencode_mark_surface()),
                AgentMark::PuppyOne => {
                    radius = 5.;
                    opacity = 1.;
                }
                _ => {}
            }
            brand_image(runtime, dark, size * scale)
                .flex_shrink_0()
                .into_any_element()
        }
        LauncherIdentity::Shell => Icon::new("square-terminal")
            .with_size(px(if compact { 14. } else { 16. }))
            .stroke(1.6)
            .color(color)
            .into_any_element(),
    };
    div()
        .size(px(size))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .overflow_hidden()
        .rounded(px(radius))
        .opacity(opacity)
        .when_some(backing, |d, bg| d.bg(bg))
        .child(inner)
}
