//! `.cm-md-html-source-toggle` (markdown-html-widget.css): the 26×24 "show
//! source" button in a rich block's toolbar, 6px inside its top right
//! corner, shown while the block is hovered, focused within or selected.
//! (`--po-shadow-sm` is not a product token, so it casts no shadow.)
use crate::{
    editor::view::{command::Command, widget::CommandSender},
    theme::{Theme, mix},
};
use gpui::{prelude::*, *};

const WIDTH: f32 = 26.;
const HEIGHT: f32 = 24.;
const INSET: f32 = 6.;
const ICON: f32 = 13.;

/// The toggle for a block of `width` in hover group `group`; `shown` keeps
/// it visible without the pointer (focus within, selected).
pub fn source_toggle(
    id: ElementId,
    group: &'static str,
    width: f32,
    dark: bool,
    shown: bool,
    send: CommandSender,
    command: Command,
) -> Stateful<Div> {
    let t = Theme::new(dark);
    let clear = Rgba { a: 0., ..t.divider };
    let (hover_bg, hover_text) = (t.control_hover, t.text);
    let icon = svg()
        .path("icons/editor-mode-source.svg")
        .size(px(ICON))
        .text_color(t.muted);
    let mut toggle = div()
        .id(id)
        .absolute()
        .top(px(INSET))
        .left(px(width - INSET - WIDTH))
        .w(px(WIDTH))
        .h(px(HEIGHT))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(5.))
        .border_1()
        .border_color(mix(t.divider, clear, 0.82))
        .bg(mix(
            t.panel_raised,
            Rgba {
                a: 0.,
                ..t.panel_raised
            },
            0.92,
        ))
        .text_color(t.muted)
        .cursor(crate::theme::clickable_cursor())
        .hover(move |s| s.bg(hover_bg).text_color(hover_text))
        .child(icon)
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            send(command.clone(), window, cx);
        });
    if !shown {
        toggle = toggle.opacity(0.).group_hover(group, |s| s.opacity(1.));
    }
    toggle
}
