//! Blank sheets peeking between `folder-back` and `folder-front`: a folder
//! that holds files says so by its shape alone. Sheets carry no file kind,
//! text or colour, so a page of folders stays quiet.
use crate::{
    theme::{self, Theme},
    ui::moments::paint,
};
use gpui::{prelude::*, *};

/// The paper: a shade lighter than the folder's front in dark appearances,
/// the raised surface in light ones.
pub(super) struct Paper {
    fill: Rgba,
    edge: Rgba,
    shadow: Rgba,
}

impl Paper {
    pub fn new(fade: Option<f32>, t: Theme) -> Self {
        let tone = |color: Rgba| fade.map_or(color, |w| theme::mix(color, t.canvas, w));
        let (fill, edge) = if t.dark {
            (
                theme::mix(t.text, t.canvas, 0.34),
                theme::mix(t.text, t.canvas, 0.40),
            )
        } else {
            (t.panel_raised, theme::mix(t.text, t.panel_raised, 0.10))
        };
        Self {
            fill: tone(fill),
            edge: tone(edge),
            shadow: tone(theme::alpha(t.shadow, if t.dark { 0.28 } else { 0.10 })),
        }
    }
}

/// `(left, top, degrees)` of each Grid sheet, and the order they are drawn
/// in (the middle one last, on top).
pub(super) fn grid_sheet_placements(
    count: usize,
) -> (&'static [(f32, f32, f32)], &'static [usize]) {
    match count {
        1 => (&[(30., 5., 2.)], &[0]),
        2 => (&[(19., 7., -4.), (41., 5., 3.5)], &[0, 1]),
        _ => (&[(11., 9., -6.), (30., 4., 1.), (49., 9., 6.)], &[0, 2, 1]),
    }
}

/// `(left, top)` of each List sheet.
pub(super) fn compact_sheet_placements(count: usize) -> (&'static [(f32, f32)], &'static [usize]) {
    match count {
        1 => (&[(9.5, 2.)], &[0]),
        2 => (&[(6.5, 2.5), (12.5, 1.5)], &[0, 1]),
        _ => (&[(4., 3.), (9.5, 1.5), (15., 3.)], &[0, 2, 1]),
    }
}

/// One `44 × 37` Grid sheet, turned about its centre.
pub(super) fn render_grid_sheet(placement: (f32, f32, f32), paper: &Paper) -> Div {
    let (left, top, degrees) = placement;
    let (w, h) = (44., 37.);
    let (fill, edge, shadow) = (paper.fill, paper.edge, paper.shadow);
    let draw = paint::paint(move |bounds, window| {
        let origin = point(bounds.origin.x + px(left), bounds.origin.y + px(top));
        let pivot = point(origin.x + px(w / 2.), origin.y + px(h / 2.));
        let sheet = size(px(w), px(h));
        let lifted = point(origin.x, origin.y + px(1.5));
        paint::turned_rect(
            window,
            lifted,
            sheet,
            4.,
            pivot,
            degrees,
            Some(shadow),
            None,
        );
        paint::turned_rect(
            window,
            origin,
            sheet,
            4.,
            pivot,
            degrees,
            Some(fill),
            Some((1., edge)),
        );
    });
    div().absolute().inset_0().child(draw)
}

/// One `15 × 12` List sheet.
pub(super) fn render_compact_sheet(placement: (f32, f32), paper: &Paper) -> Div {
    let (left, top) = placement;
    div()
        .absolute()
        .left(px(left))
        .top(px(top))
        .w(px(15.))
        .h(px(12.))
        .rounded(px(2.))
        .bg(paper.fill)
        .border_1()
        .border_color(paper.edge)
}
