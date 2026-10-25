//! Text editor frame chrome (product viewers/shared/TextEditorFrame.tsx and
//! editor-chrome.css): the live / source mode toggle in the bottom-left of
//! CSV and code viewers.
use super::tokens::{Tokens, over};
use crate::typography::Scale;
use gpui::{prelude::*, *};

#[derive(Clone, Debug, PartialEq)]
pub struct FrameTheme {
    pub border: Rgba,
    pub background: Rgba,
    pub color: Rgba,
    pub active_background: Rgba,
    pub active_color: Rgba,
    pub button_height: f32,
    pub shadow: Rgba,
}

impl FrameTheme {
    /// `surface`: the opaque editor surface under the toggle. GPUI paints a
    /// box shadow under the whole box, where CSS clips it to the outside, so
    /// the translucent control fill is composited onto the surface first.
    pub fn resolve(dark: bool, scale: Scale, surface: Rgba) -> Self {
        let t = Tokens::csv(dark, scale);
        // `--po-elevation-low`: 0 2px 4px -2px of the shadow colour at 28%.
        let shadow = t.color("--po-shadow");
        Self {
            border: t.color("--po-border"),
            background: over(t.color("--po-control"), surface),
            color: t.color("--po-text-subtle"),
            active_background: t.color("--po-selected"),
            active_color: t.color("--po-text"),
            button_height: t.len("--po-control-size-tight", 16.),
            shadow: Rgba {
                a: shadow.a * 0.28,
                ..shadow
            },
        }
    }
}

/// `.editor-mode-toggle`: 12px from the bottom-left, a 2px-padded group of
/// two 24px buttons (pencil: live, code: source).
pub fn mode_toggle(
    theme: &FrameTheme,
    live: bool,
    on_live: impl Fn(&mut Window, &mut App) + 'static,
    on_source: impl Fn(&mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let button = |id: &'static str, icon: &'static str, active: bool| {
        let (bg, color) = if active {
            (theme.active_background, theme.active_color)
        } else {
            (Rgba::default(), theme.color)
        };
        let hover = (theme.active_background, theme.active_color);
        div()
            .id(id)
            .flex()
            .items_center()
            .justify_center()
            .w(px(24.))
            .h(px(theme.button_height))
            .rounded(px(4.))
            .bg(bg)
            .text_color(color)
            .hover(move |s| s.bg(hover.0).text_color(hover.1))
            .child(
                svg()
                    .path(format!("icons/{icon}.svg"))
                    .size(px(12.))
                    .text_color(color),
            )
    };
    div()
        .id("editor-mode-toggle")
        .occlude()
        .absolute()
        .left(px(12.))
        .bottom(px(12.))
        .flex()
        .gap(px(1.))
        .p(px(2.))
        .border_1()
        .border_color(theme.border)
        .rounded(px(6.))
        .bg(theme.background)
        .shadow(vec![BoxShadow {
            color: theme.shadow.into(),
            offset: point(px(0.), px(2.)),
            blur_radius: px(4.),
            spread_radius: px(-2.),
            inset: false,
        }])
        .child(
            button("editor-mode-live", "editor-mode-edit", live)
                .on_click(move |_, w, cx| on_live(w, cx)),
        )
        .child(
            button("editor-mode-source", "editor-mode-source", !live)
                .on_click(move |_, w, cx| on_source(w, cx)),
        )
}
