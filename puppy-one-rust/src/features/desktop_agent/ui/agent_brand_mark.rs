//! Port of `AgentBrandMark`: official local product assets shared by the
//! launcher, workbench tabs and the empty state.
use crate::agent::runtime::agent_runtime_registry::Runtime;
use gpui::{prelude::*, *};
fn asset(runtime: Runtime, dark: bool) -> &'static str {
    match runtime {
        Runtime::PuppyOne => {
            if dark {
                "built-in-agent-dark.svg"
            } else {
                "built-in-agent.svg"
            }
        }
        Runtime::Codex => {
            if dark {
                "codex-dark.png"
            } else {
                "codex-light.png"
            }
        }
        Runtime::Claude => "claude-code.svg",
        Runtime::Cursor => {
            if dark {
                "cursor-dark.svg"
            } else {
                "cursor.svg"
            }
        }
        Runtime::OpenCode => "opencode.svg",
        Runtime::Pi => {
            if dark {
                "pi-dark.svg"
            } else {
                "pi.svg"
            }
        }
        Runtime::Hermes => "hermes.png",
        Runtime::WorkBuddy => "workbuddy.png",
    }
}
/// The ChatGPT mark Codex uses (`agentBrandCatalog`), drawn as an alpha mask
/// in the surrounding colour like `AgentMonochromeBrandImage`.
const CHATGPT_MARK: &str = "agents/chatgpt-mark.svg";
/// `AgentBrandMark appearance="brand"`: Codex is always monochrome (in `color`);
/// other runtimes show their official asset.
pub fn brand(runtime: Runtime, dark: bool, size: f32, color: Rgba) -> AnyElement {
    if runtime == Runtime::Codex {
        return svg()
            .path(CHATGPT_MARK)
            .size(px(size))
            .flex_shrink_0()
            .text_color(color)
            .into_any_element();
    }
    brand_image(runtime, dark, size).into_any_element()
}
pub fn brand_image(runtime: Runtime, dark: bool, size: f32) -> Img {
    img(SharedString::from(format!(
        "agents/{}",
        asset(runtime, dark)
    )))
    .size(px(size))
    .object_fit(ObjectFit::Contain)
}
/// SVG mark path for monochrome presentation (`appearance="monochrome"`);
/// raster marks have no monochrome form.
pub fn svg_path(runtime: Runtime, dark: bool) -> Option<&'static str> {
    if runtime == Runtime::Codex {
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

/// What `AgentLauncherIcon` draws: an Agent brand or the shell. (Native chats
/// always know their runtime, so the product's chat fallback glyph is unused.)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LauncherIdentity {
    Runtime(Runtime),
    Shell,
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
        LauncherIdentity::Runtime(Runtime::Codex) => {
            radius = 4.;
            opacity = 0.9;
            svg()
                .path(CHATGPT_MARK)
                .size(px(size))
                .text_color(color)
                .into_any_element()
        }
        LauncherIdentity::Runtime(runtime) => {
            let scale = match runtime {
                Runtime::Claude | Runtime::Cursor => 0.84,
                Runtime::Hermes if compact => 0.94,
                Runtime::Hermes => 0.82,
                Runtime::OpenCode => 1.3,
                Runtime::Pi => 1.28,
                _ => 1.,
            };
            match runtime {
                Runtime::Pi => radius = 3.,
                Runtime::Hermes => radius = 4.,
                Runtime::OpenCode => backing = Some(crate::theme::opencode_mark_surface()),
                Runtime::PuppyOne => {
                    radius = 5.;
                    opacity = 1.;
                }
                _ => {}
            }
            brand_image(runtime, dark, size * scale)
                .flex_shrink_0()
                .into_any_element()
        }
        LauncherIdentity::Shell => crate::ui::icon_stroke(
            "square-terminal",
            if compact { 14. } else { 16. },
            1.6,
            color,
        )
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
