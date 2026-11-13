//! `SpaceMark` and `SpacePlanBadge` (`features/cloud/spaces/SpaceMark.tsx`,
//! `space-mark.css`): a Space is a rounded square everywhere it appears (the
//! Header, the project menu, the Homepage and Settings); a person is a circle
//! and a computer a line icon, so the shape alone says which kind of thing is
//! named. Beside a Space's name, its plan says who pays for the projects there.
//! The features layer turns a Space into a tone, a letter and a plan label.
use crate::theme;
use crate::ui::appearance::ActiveAppearance as _;
use gpui::{prelude::*, *};

/// `data-size`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SpaceMarkSize {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(IntoElement)]
pub struct SpaceMark {
    tone: usize,
    initial: SharedString,
    size: SpaceMarkSize,
}
impl SpaceMark {
    /// `tone` is the Space's (`spaceMarkTone`), `initial` its letter.
    pub fn new(tone: usize, initial: impl Into<SharedString>) -> Self {
        Self {
            tone,
            initial: initial.into(),
            size: SpaceMarkSize::Medium,
        }
    }
    pub fn size(mut self, size: SpaceMarkSize) -> Self {
        self.size = size;
        self
    }
}
impl RenderOnce for SpaceMark {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let ui = &theme::ty().ui;
        // Side, corner radius and letter size by `data-size`.
        let (side, radius, text) = match self.size {
            SpaceMarkSize::Small => (12., 3., ui.glyph),
            SpaceMarkSize::Medium => (16., 4., ui.micro),
            SpaceMarkSize::Large => (22., 6., ui.meta),
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(side))
            .rounded(px(radius))
            .bg(theme::space_mark(self.tone, cx.is_dark()))
            .text_color(theme::space_mark_letter())
            .text_size(px(text))
            .line_height(px(text))
            .font_weight(FontWeight::SEMIBOLD)
            .child(self.initial)
    }
}

/// `SpacePlanBadge`: the plan's name, accent-tinted unless it is Free.
#[derive(IntoElement)]
pub struct SpacePlanBadge {
    label: SharedString,
    paid: bool,
}
impl SpacePlanBadge {
    pub fn new(label: impl Into<SharedString>, paid: bool) -> Self {
        Self {
            label: label.into(),
            paid,
        }
    }
}
impl RenderOnce for SpacePlanBadge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.palette();
        let size = theme::ty().ui.micro;
        // `.po-space-plan:not([data-plan="free"])`: an accent tint.
        let (border, color) = if self.paid {
            (
                theme::fade(p.accent, 0.32),
                theme::mix(p.accent, p.text, 0.78),
            )
        } else {
            (p.divider, p.subtle)
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .min_h(px(17.))
            .px(px(6.))
            .border_1()
            .border_color(border)
            .rounded_full()
            .text_color(color)
            .font_family(theme::MONO)
            .text_size(px(size))
            .line_height(px(size))
            .whitespace_nowrap()
            .child(self.label.to_uppercase())
    }
}
