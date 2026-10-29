//! `FloatingNotice` / `FloatingNoticeStack` / `FloatingNoticeAction`
//! (`packages/shared-ui/src/primitives/FloatingNotice.tsx`,
//! `styles/floating-notice.css`): transient, non-modal feedback floating over
//! a product surface. The stack owns the position and never takes input
//! itself; each notice carries its tone glyph, the message, inline commands
//! and an optional dismiss control.
use super::{Icon, tooltip};
use crate::{
    theme::{self, Theme, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
use std::rc::Rc;

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

/// The product's five tones; every surface picks the one it means.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NoticeTone {
    #[default]
    Neutral,
    Info,
    Success,
    Warning,
    Danger,
}
impl NoticeTone {
    fn color(self, t: Theme) -> Rgba {
        match self {
            Self::Neutral => t.muted,
            Self::Info => t.info,
            Self::Success => t.success,
            Self::Warning => t.warning,
            Self::Danger => t.danger,
        }
    }
    /// `CircleAlert` / `CircleCheck` / `Info` / `TriangleAlert` at 15px.
    fn glyph(self) -> Option<&'static str> {
        match self {
            Self::Neutral => None,
            Self::Info => Some("info"),
            Self::Success => Some("circle-check"),
            Self::Warning => Some("triangle-alert"),
            Self::Danger => Some("circle-alert"),
        }
    }
}

/// `.po-floating-notice__action`: a compact command such as Retry.
pub struct NoticeAction {
    id: ElementId,
    label: SharedString,
    on_click: Handler,
    emphasis: bool,
}
impl NoticeAction {
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        on_click: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            on_click: Rc::new(on_click),
            emphasis: false,
        }
    }
    /// `.editor-save-chip.action`: the warning-filled command that resolves
    /// a held-back conflict.
    pub fn emphasis(mut self) -> Self {
        self.emphasis = true;
        self
    }
}

/// One notice. Placement belongs to its [`NoticeStack`].
#[derive(IntoElement)]
pub struct FloatingNotice {
    id: ElementId,
    message: SharedString,
    tone: NoticeTone,
    actions: Vec<NoticeAction>,
    on_dismiss: Option<Handler>,
}
impl FloatingNotice {
    pub fn new(id: impl Into<ElementId>, message: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            message: message.into(),
            tone: NoticeTone::Neutral,
            actions: vec![],
            on_dismiss: None,
        }
    }
    pub fn tone(mut self, tone: NoticeTone) -> Self {
        self.tone = tone;
        self
    }
    /// Inline commands, before the dismiss control.
    pub fn action(mut self, action: NoticeAction) -> Self {
        self.actions.push(action);
        self
    }
    /// A close control (`shared-ui.notice.dismiss`).
    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}
impl RenderOnce for FloatingNotice {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let tone = self.tone.color(t);
        // A toned notice tints the overlay 13% and its border 36%.
        let (surface, border) = if self.tone == NoticeTone::Neutral {
            (t.overlay, t.border)
        } else {
            (
                theme::mix(tone, t.overlay, 0.13),
                theme::mix(tone, t.border, 0.36),
            )
        };
        let line = 18.;
        let dismissible = self.on_dismiss.is_some();
        let mini = theme::control_mini();
        let id = self.id.clone();
        h_flex()
            .id(self.id)
            .max_w_full()
            .min_w_0()
            .items_start()
            .gap(px(8.))
            .pt(px(8.))
            .pb(px(8.))
            .pl(px(12.))
            .pr(px(if dismissible { 6. } else { 12. }))
            .border_1()
            .border_color(border)
            .rounded(px(metric::MENU_RADIUS))
            .bg(surface)
            .shadow(crate::ui::components::MenuVariant::Default.shadow(t))
            .text_color(t.text)
            .text_size(px(theme::ty().ui.meta))
            .line_height(px(line))
            .font_weight(FontWeight::NORMAL)
            .occlude()
            .children(self.tone.glyph().map(|glyph| {
                div()
                    .flex()
                    .flex_shrink_0()
                    .h(px(line))
                    .items_center()
                    .justify_center()
                    .child(Icon::new(glyph).with_size(px(15.)).stroke(1.8).color(tone))
            }))
            .child(div().min_w_0().flex_1().child(self.message))
            .when(!self.actions.is_empty(), |d| {
                d.child(
                    h_flex()
                        .flex_shrink_0()
                        .items_center()
                        .gap(px(4.))
                        .my(px(-2.))
                        .children(self.actions.into_iter().map(|action| {
                            let handler = action.on_click.clone();
                            let (bg, fg, hover) = if action.emphasis {
                                (
                                    t.warning,
                                    t.text_inverse,
                                    theme::mix(t.warning, t.text, 0.88),
                                )
                            } else {
                                (t.control, t.text, t.control_hover)
                            };
                            div()
                                .id(action.id)
                                .flex()
                                .flex_shrink_0()
                                .items_center()
                                .when(action.emphasis, |d| {
                                    d.h(px(theme::control()))
                                        .px(px(10.))
                                        .rounded(px(6.))
                                        .text_size(px(theme::ty().ui.body))
                                })
                                .when(!action.emphasis, |d| {
                                    d.h(px(mini)).px(px(8.)).rounded(px(5.))
                                })
                                .bg(bg)
                                .text_color(fg)
                                .font_weight(FontWeight::MEDIUM)
                                .whitespace_nowrap()
                                .cursor(theme::clickable_cursor())
                                .hover(move |s| s.bg(hover))
                                .on_click(move |_, window, cx| {
                                    cx.stop_propagation();
                                    handler(window, cx)
                                })
                                .child(action.label)
                        })),
                )
            })
            .when_some(self.on_dismiss, |d, handler| {
                let label = crate::localization::t("shared-ui.notice.dismiss");
                d.child(
                    div()
                        .id(crate::ui::components::menu::child_id(&id, "dismiss"))
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .justify_center()
                        .size(px(mini))
                        .my(px(-2.))
                        .rounded(px(5.))
                        .text_color(t.muted)
                        .cursor(theme::clickable_cursor())
                        .hover(|s| s.bg(t.control).text_color(t.text))
                        .tooltip(tooltip(label))
                        .on_click(move |_, window, cx| {
                            cx.stop_propagation();
                            handler(window, cx)
                        })
                        .child(Icon::new("x").with_size(px(14.)).stroke(1.8)),
                )
            })
    }
}

/// Where a stack sits in its positioned surface.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NoticePlacement {
    #[default]
    TopEnd,
    /// Newest at the bottom (`column-reverse`).
    BottomEnd,
}

/// `.po-floating-notice-stack`: one anchored column per surface so
/// concurrent notices never overlap.
#[derive(IntoElement)]
pub struct NoticeStack {
    placement: NoticePlacement,
    top: f32,
    end: f32,
    max_width: f32,
    notices: Vec<FloatingNotice>,
}
impl NoticeStack {
    /// `inset` from the surface's top (or bottom) and end edges;
    /// `max_width` is `min(400px, …)` of the caller's surface.
    pub fn new(placement: NoticePlacement, top: f32, end: f32, max_width: f32) -> Self {
        Self {
            placement,
            top,
            end,
            max_width,
            notices: vec![],
        }
    }
    pub fn child(mut self, notice: FloatingNotice) -> Self {
        self.notices.push(notice);
        self
    }
}
impl RenderOnce for NoticeStack {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let column = v_flex()
            .absolute()
            .right(px(self.end))
            .max_w(px(self.max_width.max(0.)))
            .items_end()
            .gap(px(8.));
        match self.placement {
            NoticePlacement::TopEnd => column.top(px(self.top)).children(self.notices),
            NoticePlacement::BottomEnd => column
                .bottom(px(self.top))
                .children(self.notices.into_iter().rev()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn tones_carry_the_product_glyphs() {
        assert_eq!(NoticeTone::Neutral.glyph(), None);
        assert_eq!(NoticeTone::Info.glyph(), Some("info"));
        assert_eq!(NoticeTone::Success.glyph(), Some("circle-check"));
        assert_eq!(NoticeTone::Warning.glyph(), Some("triangle-alert"));
        assert_eq!(NoticeTone::Danger.glyph(), Some("circle-alert"));
    }
}
