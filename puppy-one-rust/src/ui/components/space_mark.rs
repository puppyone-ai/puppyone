//! `SpaceMark` and `SpacePlanBadge` (`features/cloud/spaces/SpaceMark.tsx`,
//! `space-mark.css`): a Space is a rounded square everywhere it appears (the
//! Header, the project menu, the Homepage and Settings); a person is a circle
//! and a computer a line icon, so the shape alone says which kind of thing is
//! named. Beside a Space's name, its plan says who pays for the projects there.
use crate::localization::t;
use crate::theme;
use crate::ui::appearance::ActiveAppearance as _;
use crate::workspace::cloud::spaces::{self, PlanKey};
use gpui::{prelude::*, *};

/// `data-size`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SpaceMarkSize {
    Small,
    #[default]
    Medium,
    Large,
}

/// Six quiet tones, never the accent blue, so a Space never reads as a
/// selection or a link; the light theme lifts each one a little.
const LIGHT: [u32; spaces::MARK_TONES as usize] =
    [0x5d7d9c, 0x8c71a8, 0x618f78, 0x9c7c57, 0x9c616e, 0x6e7682];
const DARK: [u32; spaces::MARK_TONES as usize] =
    [0x4b6b8a, 0x7a5f96, 0x4f7d66, 0x8a6a45, 0x8a4f5c, 0x5c6470];

/// The tone of `id` in this colour mode.
pub fn space_mark_color(id: &str, dark: bool) -> Rgba {
    let tone = spaces::mark_tone(id) as usize;
    rgb(if dark { DARK[tone] } else { LIGHT[tone] })
}

#[derive(IntoElement)]
pub struct SpaceMark {
    id: SharedString,
    name: SharedString,
    size: SpaceMarkSize,
}
impl SpaceMark {
    /// The Space's id picks its tone; its own name gives the letter.
    pub fn new(id: impl Into<SharedString>, name: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
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
            .bg(space_mark_color(&self.id, cx.is_dark()))
            .text_color(rgb(0xffffff))
            .text_size(px(text))
            .line_height(px(text))
            .font_weight(FontWeight::SEMIBOLD)
            .child(spaces::mark_initial(&self.name))
    }
}

/// `SpacePlanBadge`: nothing without a published plan.
#[derive(IntoElement)]
pub struct SpacePlanBadge {
    plan: Option<PlanKey>,
}
impl SpacePlanBadge {
    pub fn new(plan_id: Option<&str>) -> Self {
        Self {
            plan: plan_id.map(PlanKey::of),
        }
    }
}
impl RenderOnce for SpacePlanBadge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let Some(plan) = self.plan else {
            return div().into_any_element();
        };
        let p = cx.palette();
        let size = theme::ty().ui.micro;
        let paid = plan != PlanKey::Free;
        let transparent = Rgba {
            r: 0.,
            g: 0.,
            b: 0.,
            a: 0.,
        };
        // `.po-space-plan:not([data-plan="free"])`: an accent tint.
        let (border, color) = if paid {
            (
                theme::mix(p.accent, transparent, 0.32),
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
            .child(t(&format!("onboarding.spaces.plan.{}", plan.key())).to_uppercase())
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn each_tone_has_the_products_colour_in_both_modes() {
        let tone = spaces::mark_tone("b") as usize;
        assert_eq!(space_mark_color("b", false), rgb(LIGHT[tone]));
        assert_eq!(space_mark_color("b", true), rgb(DARK[tone]));
    }
}
