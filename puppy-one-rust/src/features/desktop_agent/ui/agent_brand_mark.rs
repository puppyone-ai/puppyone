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
