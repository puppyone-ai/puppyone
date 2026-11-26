//! The Agent views' drawing vocabulary (`styles/activities.css`,
//! `styles/transcript.css`): `AgentToolGlyph`, `AgentActivityShell`'s row and
//! status icon, `AgentToolStepText`, the evidence tree
//! (`AgentToolEvidenceTree/Node`, `AgentToolTextEvidence`, search results),
//! `AgentPlanItem`, the context divider and `AgentRunFeedback`.
use super::agent_theme::AgentTheme;
use crate::localization::t;
use crate::theme::{self};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;
use gpui_kit::component::Sizable as _;

/// Opens a workspace path from a transcript row.
pub type OpenFile = std::rc::Rc<dyn Fn(String, &mut Window, &mut App)>;

/// `--agent-evidence-*` geometry: `INSET` (6) + group `mx` (4) + `ROW_PADDING`
/// (6) places every tool glyph flush on the sidebar's 16pt left edge.
pub const EVIDENCE_ROW: f32 = 26.;
pub const TOOL_ICON: f32 = 14.5;
pub const ROW_PADDING: f32 = 6.;
/// `--agent-evidence-rail-inline`: row padding + half the icon.
pub const EVIDENCE_RAIL_INLINE: f32 = ROW_PADDING + TOOL_ICON / 2.;

mod evidence;
mod tool;

pub use evidence::*;
pub use tool::*;

pub fn mono_size() -> f32 {
    theme::ty().right.code
}

/// `.desktop-agent-context-divider`: a rule on both sides of a small label.
pub fn context_divider(label: SharedString, a: &AgentTheme) -> AnyElement {
    let rule = || div().flex_1().min_w(px(18.)).h(px(1.)).bg(a.border_subtle);
    h_flex()
        .mt(px(5.))
        .mx(px(4.))
        .mb(px(8.))
        .gap(px(10.))
        .text_color(a.text_subtle)
        .child(rule())
        .child(
            div()
                .text_size(px(theme::ty().left.meta))
                .line_height(px(theme::ty().right.meta_line_height))
                .font_weight(FontWeight::NORMAL)
                .child(label),
        )
        .child(rule())
        .into_any_element()
}

/// The same `LoadingMark size="xs"` as `AgentRunFeedback` in the product.
pub fn dots(id: impl Into<SharedString>, color: Rgba) -> crate::ui::loading::LoadingMark {
    crate::ui::loading::LoadingMark::new(ElementId::Name(id.into()))
        .size(crate::ui::loading::LoaderSize::Xs)
        .color(color)
}

/// `AgentRunFeedback`: meta label (and dots while busy) at the content inset.
pub fn run_feedback(label: SharedString, busy: Option<SharedString>, a: &AgentTheme) -> Div {
    h_flex()
        .min_h(px(theme::ty().right.meta_line_height))
        .gap(px(7.))
        .px(px(10.))
        .text_size(px(theme::ty().left.meta))
        .line_height(px(theme::ty().right.meta_line_height))
        .text_color(a.text_subtle)
        .whitespace_nowrap()
        .child(div().min_w_0().truncate().child(label.clone()))
        .children(busy.map(|id| dots(id, a.loader).beside(label)))
}

/// `.desktop-agent-prompt-mention` (and the resolving placeholder).
pub fn mention_chip(a: &AgentTheme, label: String, resolving: bool) -> Div {
    let selector = format!("agent-mention:{label}");
    div()
        .debug_selector(move || selector)
        .min_w_0()
        .max_w_full()
        .truncate()
        .flex_shrink_0()
        .mt(px(0.5))
        .px(px(4.))
        .rounded(px(4.))
        .border_1()
        .border_color(theme::mix(a.accent, a.border_subtle, 0.36))
        .bg(theme::alpha(a.accent, 0.16 * 0.58))
        .text_color(theme::mix(a.accent, a.text, 0.78))
        .text_size(px(14.))
        .line_height(px(18.))
        .font_weight(FontWeight::NORMAL)
        .when(resolving, |d| d.opacity(0.68))
        .child(label)
}

/// `agent.effort.*` label for a reasoning effort id.
pub fn effort_label(id: &str) -> String {
    let key = match id {
        "low" | "minimal" => "agent.effort.low",
        "medium" => "agent.effort.medium",
        "high" => "agent.effort.high",
        "xhigh" => "agent.effort.xhigh",
        "max" => "agent.effort.max",
        _ => return id.to_owned(),
    };
    t(key).to_owned()
}

/// `.desktop-agent-button` tones.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ButtonTone {
    Quiet,
    Secondary,
    Primary,
}

/// `.desktop-agent-button`.
pub fn agent_button(
    id: impl Into<ElementId>,
    label: SharedString,
    tone: ButtonTone,
    disabled: bool,
    a: &AgentTheme,
) -> gpui_kit::base::Button {
    let a = *a;
    let (border, bg, fg, hover_bg, hover_border) = match tone {
        ButtonTone::Quiet => (
            theme::alpha(a.border_subtle, 0.),
            None,
            a.text_subtle,
            Some(a.row_hover),
            None,
        ),
        ButtonTone::Secondary => (
            a.border_subtle,
            None,
            a.text_muted,
            Some(a.row_hover),
            Some(a.border),
        ),
        ButtonTone::Primary => (
            a.text,
            Some(a.text),
            a.canvas,
            Some(a.primary_hover),
            Some(a.primary_hover),
        ),
    };
    gpui_kit::base::Button::new(id)
        .accessibility_label(label.clone())
        .h(px(theme::control()))
        .px(px(10.))
        .rounded(px(6.))
        .border_1()
        .border_color(border)
        .when_some(bg, |b, bg| b.bg(bg))
        .text_size(px(theme::ty().left.content))
        .line_height(relative(1.))
        .font_weight(if tone == ButtonTone::Primary {
            FontWeight::MEDIUM
        } else {
            FontWeight::NORMAL
        })
        .text_color(fg)
        .whitespace_nowrap()
        .when(disabled, |b| b.opacity(0.45))
        .when(!disabled, |b| {
            b.cursor(theme::clickable_cursor()).hover(move |s| {
                let s = if let Some(bg) = hover_bg { s.bg(bg) } else { s };
                let s = if let Some(border) = hover_border {
                    s.border_color(border)
                } else {
                    s
                };
                if tone == ButtonTone::Primary {
                    s
                } else {
                    s.text_color(a.text)
                }
            })
        })
        .disabled(disabled)
        .child(label)
}
