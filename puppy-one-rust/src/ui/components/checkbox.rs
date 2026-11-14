//! A native `<input type="checkbox">` as the product shows it (Chromium's
//! 13px box): [`native_checkbox`] draws the box alone, checked or not, for
//! a row that owns the interaction (the row is the `<label>`).
use crate::{theme, ui::appearance::ActiveAppearance};
use gpui::{prelude::*, *};

/// A native checkbox's box alone. `accent` is the `accent-color`
/// (`var(--po-accent)`) of a 14px box sized in CSS; without it the default
/// 13px box takes Chromium's own colours.
pub fn native_checkbox(checked: bool, accent: bool, cx: &App) -> Div {
    let t = cx.palette();
    let size = if accent { 14. } else { 13. };
    checkbox(checked, size, accent.then_some(t.accent), cx)
}
/// The default 13px box with `accent-color: tint` (the import checklist's
/// `var(--po-text)`).
pub fn tinted_checkbox(checked: bool, tint: Rgba, cx: &App) -> Div {
    checkbox(checked, 13., Some(tint), cx)
}
fn checkbox(checked: bool, size: f32, accent: Option<Rgba>, cx: &App) -> Div {
    let t = cx.palette();
    let (fill, mark) = theme::native_checkbox_checked(t.dark, accent);
    let (unchecked, border) = theme::native_checkbox(t.dark);
    div()
        .flex()
        .flex_shrink_0()
        .size(px(size))
        .items_center()
        .justify_center()
        .rounded(px(2.))
        .when(checked, |d| {
            d.bg(fill).child(
                svg()
                    .path("icons/native-check.svg")
                    .size(px(size))
                    .text_color(mark),
            )
        })
        .when(!checked, |d| {
            d.border(px(0.5)).border_color(border).bg(unchecked)
        })
}
