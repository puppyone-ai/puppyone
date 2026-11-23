//! A focus / selection ring (`box-shadow: 0 0 0 Npx color`): drawn as an
//! outline just outside a box. GPUI paints a box shadow as a filled rect
//! behind the element, which would show through translucent backgrounds,
//! where CSS clips an outer shadow to outside the border box.
use gpui::{prelude::*, *};

/// A ring of `width` around a box of `size` with corner `radius`, as a
/// child of that box.
pub fn ring(size: (f32, f32), radius: f32, width: f32, color: Rgba) -> Div {
    outline(size, radius, width).border_color(color)
}

/// The same ring with a transparent colour, for hover styles to colour.
pub fn outline(size: (f32, f32), radius: f32, width: f32) -> Div {
    div()
        .absolute()
        .left(px(-width))
        .top(px(-width))
        .w(px(size.0 + 2. * width))
        .h(px(size.1 + 2. * width))
        .rounded(px(radius + width))
        .border(px(width))
        .border_color(Rgba::default())
}
