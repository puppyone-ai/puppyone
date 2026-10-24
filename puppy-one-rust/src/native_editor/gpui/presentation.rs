//! Native projection of the Web Medium reading profile. No document state.
use gpui::{prelude::*, *};
use gpui_kit::base::text::TextViewStyle;
pub const CONTENT_INSET: f32 = 48.;
pub const READING_WIDTH: f32 = 724.;
pub const BODY_SIZE: f32 = 15.;
pub const BODY_LINE_HEIGHT: f32 = 1.75;
pub fn text_style(dark: bool) -> TextViewStyle {
    let t = crate::theme::Theme::new(dark);
    let code = StyleRefinement {
        background: Some(t.chrome.into()),
        ..Default::default()
    };
    let table = StyleRefinement {
        background: Some(t.canvas.into()),
        ..Default::default()
    };
    TextViewStyle::default()
        .with_dark(dark)
        .with_foreground(t.text.into())
        .with_muted_foreground(t.muted.into())
        .with_border(t.divider.into())
        .with_selection(t.selection.into())
        .with_code_background(t.chrome.into())
        .with_code_block(code)
        .with_table(table)
        .with_heading(|level| {
            let (size, weight) = match level {
                1 => (30., 650.),
                2 => (23., 625.),
                3 => (19., 600.),
                4 => (17., 600.),
                5 => (16., 600.),
                _ => (15., 600.),
            };
            StyleRefinement::default()
                .text_size(px(crate::theme::font_size(size)))
                .font_weight(FontWeight(weight))
                .line_height(relative(1.5))
        })
        .with_paragraph_gap(rems(1.))
}
