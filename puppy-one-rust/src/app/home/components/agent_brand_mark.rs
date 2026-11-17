//! `HomepageAgentBrandMark` (`HomepageAgentStrip.tsx`): a Local Agent's mark
//! in the New project menu and in `AgentProjectStartDialog`.
use crate::{
    theme,
    ui::{agent_brands, appearance::ActiveAppearance as _},
};
use gpui::{prelude::*, *};

/// `HomepageAgentBrandMark`: compact optical brand mark (`18×18` by default,
/// `20×20` / `28×28` / `16×16` in `AgentProjectStartDialog`). Only `chatgpt`
/// and `codex` draw monochrome in `ink`; every other brand renders through
/// [`agent_brands::image`] so its optical scale (`0.84` Claude/Cursor, `1.28`
/// Pi, `1.3` OpenCode, `0.82` Hermes) matches `<AgentBrandImage />` 1:1.
#[derive(IntoElement)]
pub(in crate::app::home) struct HomepageAgentBrandMark {
    icon_key: Option<SharedString>,
    label: SharedString,
    size: f32,
    radius: f32,
    ink: Option<Rgba>,
}

impl HomepageAgentBrandMark {
    pub fn new(icon_key: Option<&str>, label: impl Into<SharedString>) -> Self {
        Self {
            icon_key: icon_key.map(|k| SharedString::from(k.to_owned())),
            label: label.into(),
            size: 18.,
            radius: 4.,
            ink: None,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = radius;
        self
    }

    pub fn ink(mut self, ink: Rgba) -> Self {
        self.ink = Some(ink);
        self
    }
}

impl RenderOnce for HomepageAgentBrandMark {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let ink = self.ink.unwrap_or(t.text);
        let brand = self
            .icon_key
            .as_deref()
            .and_then(agent_brands::get)
            .or_else(|| {
                agent_brands::resolve(None, self.icon_key.as_deref(), Some(self.label.as_ref()))
            });
        if let Some(brand) = brand {
            let monochrome_path = matches!(brand.id, "chatgpt" | "codex")
                .then(|| agent_brands::monochrome(brand))
                .flatten();
            let artwork: AnyElement = match monochrome_path {
                Some(path) => svg()
                    .path(path)
                    .size(px(self.size))
                    .text_color(ink)
                    .into_any_element(),
                None => agent_brands::image(brand, t.dark, self.size).into_any_element(),
            };
            return div()
                .size(px(self.size))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .overflow_hidden()
                .rounded(px(self.radius))
                .text_color(ink)
                .child(artwork);
        }
        let initials: String = self
            .label
            .split_whitespace()
            .take(2)
            .filter_map(|word| word.chars().next())
            .flat_map(char::to_uppercase)
            .collect();
        let initials = if initials.is_empty() {
            "A".to_owned()
        } else {
            initials
        };
        div()
            .size(px(self.size))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .rounded(px(self.radius))
            .bg(theme::alpha(ink, 0.12))
            .text_color(ink)
            .text_size(px(theme::ty().ui.caption))
            .font_weight(FontWeight::SEMIBOLD)
            .line_height(px(self.size))
            .child(initials)
    }
}
