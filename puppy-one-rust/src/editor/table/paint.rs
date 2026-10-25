//! Table painting: cells are not layout nodes; each layer is one
//! canvas that paints cell boxes (background with the cell's own end / bottom
//! border, as `border-collapse: separate; border-spacing: 0` does, so every
//! pixel is painted once) and text runs at exact Chromium positions.
use crate::editor::view::{
    render::{RenderCx, chromium_baseline},
    style::TextStyle,
};
use gpui::{prelude::*, *};

/// Border sides of a cell box (CSS order).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Sides {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

#[derive(Clone, Debug)]
pub enum Draw {
    /// A cell's border box.
    Cell {
        bounds: Bounds<f32>,
        background: Rgba,
        border: Sides,
        border_color: Rgba,
        radius: Corners<f32>,
    },
    /// One line of text whose CSS line box starts at `line_top`, clipped to
    /// `clip`. `center` centres the run in that width (flex centring);
    /// `ellipsis` truncates it to the clip (`text-overflow: ellipsis`);
    /// `underline` draws a 1px line `text-underline-offset: 2px` below the
    /// baseline.
    Text {
        text: SharedString,
        style: TextStyle,
        x: f32,
        line_top: f32,
        center: Option<f32>,
        clip: Bounds<f32>,
        ellipsis: bool,
        underline: Option<Rgba>,
    },
}

/// Shape `text` as one run of `style`.
pub fn shape(window: &Window, text: SharedString, style: &TextStyle) -> ShapedLine {
    let run = TextRun {
        len: text.len(),
        font: RenderCx::font(style),
        color: style.color.into(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    window
        .text_system()
        .shape_line(text, px(style.size), &[run], None)
}

/// The longest prefix of `text` that fits `width` with an ellipsis.
fn truncate(window: &Window, text: &SharedString, style: &TextStyle, width: f32) -> SharedString {
    let full = shape(window, text.clone(), style);
    if f32::from(full.width()) <= width {
        return text.clone();
    }
    let ellipsis = f32::from(shape(window, "…".into(), style).width());
    let cut = full
        .index_for_x(px((width - ellipsis).max(0.)))
        .unwrap_or(0);
    let cut = (0..=cut.min(text.len()))
        .rev()
        .find(|i| text.is_char_boundary(*i))
        .unwrap_or(0);
    format!("{}…", &text[..cut]).into()
}

impl Draw {
    pub fn rect(x: f32, y: f32, w: f32, h: f32) -> Bounds<f32> {
        Bounds {
            origin: point(x, y),
            size: size(w, h),
        }
    }
}

fn to_px(b: Bounds<f32>, origin: Point<Pixels>) -> Bounds<Pixels> {
    Bounds {
        origin: point(origin.x + px(b.origin.x), origin.y + px(b.origin.y)),
        size: size(px(b.size.width), px(b.size.height)),
    }
}

/// A canvas painting `draws` in order, in the coordinates of its parent.
pub fn layer(draws: Vec<Draw>) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            let origin = bounds.origin;
            let scale = window.scale_factor();
            for draw in &draws {
                match draw {
                    Draw::Cell {
                        bounds,
                        background,
                        border,
                        border_color,
                        radius,
                    } => {
                        let radii = Corners {
                            top_left: px(radius.top_left),
                            top_right: px(radius.top_right),
                            bottom_right: px(radius.bottom_right),
                            bottom_left: px(radius.bottom_left),
                        };
                        let widths = Edges {
                            top: px(border.top),
                            right: px(border.right),
                            bottom: px(border.bottom),
                            left: px(border.left),
                        };
                        window.paint_quad(quad(
                            to_px(*bounds, origin),
                            radii,
                            *background,
                            widths,
                            *border_color,
                            BorderStyle::Solid,
                        ));
                    }
                    Draw::Text {
                        text,
                        style,
                        x,
                        line_top,
                        center,
                        clip,
                        ellipsis,
                        underline,
                    } => {
                        if text.is_empty() {
                            continue;
                        }
                        let text = if *ellipsis {
                            truncate(window, text, style, clip.size.width - (x - clip.origin.x))
                        } else {
                            text.clone()
                        };
                        let line = shape(window, text, style);
                        let (a, d) = (f32::from(line.ascent), f32::from(line.descent));
                        let baseline = chromium_baseline(scale, style, (a, d), *line_top);
                        // Chromium centres in layout units (1/64 px).
                        let left = match center {
                            Some(w) => x + ((w - f32::from(line.width())) / 2. * 64.).floor() / 64.,
                            None => *x,
                        };
                        let at = point(origin.x + px(left), origin.y + px(baseline - a));
                        window.with_content_mask(
                            Some(ContentMask {
                                bounds: to_px(*clip, origin),
                            }),
                            |window| {
                                let _ =
                                    line.paint(at, px(a + d), TextAlign::Left, None, window, cx);
                                if let Some(color) = underline {
                                    let y = origin.y + px(baseline + 2.);
                                    window.paint_quad(fill(
                                        Bounds {
                                            origin: point(at.x, y),
                                            size: size(line.width(), px(1.)),
                                        },
                                        *color,
                                    ));
                                }
                            },
                        );
                    }
                }
            }
        },
    )
    .absolute()
    .left_0()
    .top_0()
    .size_full()
}
