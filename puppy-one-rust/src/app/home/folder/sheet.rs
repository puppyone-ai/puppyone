//! Sheets peeking between `folder-back` and `folder-front`, one per file the
//! folder's root holds (up to three). Each says what kind of file it is by
//! the layout printed on it — a document's title and lines, a table's grid,
//! a page's bar and blocks — in the paper's own greys, with no labels or
//! colour, so a page of folders stays quiet. Only the top of a sheet shows
//! above the folder's front, so every layout reads in its first 18px.
use super::super::previews::PreviewKind;
use crate::{
    theme::{self, Theme},
    ui::moments::paint,
};
use gpui::{prelude::*, *};

/// The paper: a shade lighter than the folder's front in dark appearances,
/// the raised surface in light ones; its print leans toward the text.
pub(super) struct Paper {
    fill: Rgba,
    edge: Rgba,
    shadow: Rgba,
    /// A title, a table's header, a page's bar.
    strong: Rgba,
    /// Lines, cells and blocks.
    ink: Rgba,
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
        let (strong, ink) = if t.dark { (0.34, 0.17) } else { (0.40, 0.16) };
        Self {
            fill: tone(fill),
            edge: tone(edge),
            shadow: tone(theme::alpha(t.shadow, if t.dark { 0.28 } else { 0.10 })),
            strong: tone(theme::mix(t.text, fill, strong)),
            ink: tone(theme::mix(t.text, fill, ink)),
        }
    }
}

/// One printed mark: `(x, y, width, height, radius, strong)` in the sheet's
/// own units, before it is turned.
type Mark = (f32, f32, f32, f32, f32, bool);

/// The layout printed on a `44 × 37` Grid sheet.
fn grid_marks(kind: PreviewKind) -> Vec<Mark> {
    match kind {
        // A document: its title, then lines of text.
        PreviewKind::Md => vec![
            (5., 5., 17., 3., 1.5, true),
            (5., 11., 34., 2., 1., false),
            (5., 15., 34., 2., 1., false),
            (5., 19., 26., 2., 1., false),
            (5., 25., 34., 2., 1., false),
        ],
        // A table: a header row over rows of cells, three columns.
        PreviewKind::Csv => (0..5)
            .flat_map(|row| {
                (0..3).map(move |col| {
                    let y = 5. + row as f32 * 5.;
                    (5. + col as f32 * 12., y, 10., 3., 0.75, row == 0)
                })
            })
            .collect(),
        // A page: the browser's bar, a large block, two blocks beside.
        PreviewKind::Html => vec![
            (5., 4.5, 2.5, 2.5, 1.25, true),
            (9., 4.5, 2.5, 2.5, 1.25, true),
            (13., 4.5, 2.5, 2.5, 1.25, true),
            (5., 10., 34., 8., 1.5, false),
            (5., 21., 16., 6., 1.5, false),
            (23., 21., 16., 6., 1.5, false),
        ],
        // Any other file: lines.
        PreviewKind::Other => vec![
            (5., 6., 34., 2., 1., false),
            (5., 10., 34., 2., 1., false),
            (5., 14., 22., 2., 1., false),
        ],
    }
}

/// The same layouts on a `15 × 12` List sheet.
fn compact_marks(kind: PreviewKind) -> Vec<Mark> {
    match kind {
        PreviewKind::Md => vec![
            (2.5, 2.5, 5., 1.5, 0.75, true),
            (2.5, 5.5, 10., 1., 0.5, false),
            (2.5, 7.5, 8., 1., 0.5, false),
        ],
        PreviewKind::Csv => (0..3)
            .flat_map(|row| {
                (0..3).map(move |col| {
                    let y = 2.5 + row as f32 * 2.5;
                    (2.5 + col as f32 * 3.5, y, 3., 1.5, 0.25, row == 0)
                })
            })
            .collect(),
        PreviewKind::Html => vec![
            (2.5, 2.5, 10., 1.5, 0.5, true),
            (2.5, 5., 10., 4., 0.75, false),
        ],
        PreviewKind::Other => vec![
            (2.5, 3., 10., 1., 0.5, false),
            (2.5, 5.5, 7., 1., 0.5, false),
        ],
    }
}

/// `(left, top, degrees)` of each Grid sheet, and the order they are drawn
/// in (the middle one last, on top).
pub(super) fn grid_sheet_placements(
    count: usize,
) -> (&'static [(f32, f32, f32)], &'static [usize]) {
    match count {
        1 => (&[(30., 3., 2.)], &[0]),
        2 => (&[(16., 5., -4.), (44., 3., 3.5)], &[0, 1]),
        _ => (&[(7., 7., -6.), (30., 2., 1.), (53., 7., 6.)], &[0, 2, 1]),
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

/// One `44 × 37` Grid sheet and its print, turned about the sheet's centre.
pub(super) fn render_grid_sheet(
    placement: (f32, f32, f32),
    kind: PreviewKind,
    paper: &Paper,
) -> Div {
    let (left, top, degrees) = placement;
    let (w, h) = (44., 37.);
    let (fill, edge, shadow) = (paper.fill, paper.edge, paper.shadow);
    let (strong, ink) = (paper.strong, paper.ink);
    let marks = grid_marks(kind);
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
        for &(x, y, mw, mh, radius, is_strong) in &marks {
            paint::turned_rect(
                window,
                point(origin.x + px(x), origin.y + px(y)),
                size(px(mw), px(mh)),
                radius,
                pivot,
                degrees,
                Some(if is_strong { strong } else { ink }),
                None,
            );
        }
    });
    div().absolute().inset_0().child(draw)
}

/// One `15 × 12` List sheet and its print.
pub(super) fn render_compact_sheet(placement: (f32, f32), kind: PreviewKind, paper: &Paper) -> Div {
    let (left, top) = placement;
    let (strong, ink) = (paper.strong, paper.ink);
    div()
        .absolute()
        .left(px(left))
        .top(px(top))
        .w(px(15.))
        .h(px(12.))
        .overflow_hidden()
        .rounded(px(2.))
        .bg(paper.fill)
        .border_1()
        .border_color(paper.edge)
        .children(
            compact_marks(kind)
                .into_iter()
                .map(move |(x, y, mw, mh, radius, is_strong)| {
                    // Marks sit inside the 1px edge.
                    div()
                        .absolute()
                        .left(px(x - 1.))
                        .top(px(y - 1.))
                        .w(px(mw))
                        .h(px(mh))
                        .rounded(px(radius))
                        .bg(if is_strong { strong } else { ink })
                }),
        )
}

/// The same layouts on a `22 × 30` sheet standing on a computer's screen
/// (`.project-computer-preview`).
fn screen_marks(kind: PreviewKind) -> Vec<Mark> {
    match kind {
        PreviewKind::Md => vec![
            (3., 3., 9., 2., 1., true),
            (3., 7., 16., 1.5, 0.75, false),
            (3., 10., 16., 1.5, 0.75, false),
            (3., 13., 11., 1.5, 0.75, false),
            (3., 17., 16., 1.5, 0.75, false),
        ],
        PreviewKind::Csv => (0..5)
            .flat_map(|row| {
                (0..2).map(move |col| {
                    let y = 3. + row as f32 * 4.;
                    (3. + col as f32 * 8.5, y, 7.5, 2., 0.5, row == 0)
                })
            })
            .collect(),
        PreviewKind::Html => vec![
            (3., 3., 1.6, 1.6, 0.8, true),
            (5.6, 3., 1.6, 1.6, 0.8, true),
            (8.2, 3., 1.6, 1.6, 0.8, true),
            (3., 7., 16., 7., 1., false),
            (3., 16., 7.5, 5., 1., false),
            (11.5, 16., 7.5, 5., 1., false),
        ],
        PreviewKind::Other => vec![
            (3., 4., 16., 1.5, 0.75, false),
            (3., 7., 16., 1.5, 0.75, false),
            (3., 10., 10., 1.5, 0.75, false),
        ],
    }
}

/// One `22 × 30` sheet at `(left, top)` on a computer's screen.
pub(super) fn render_screen_sheet(left: f32, top: f32, kind: PreviewKind, paper: &Paper) -> Div {
    let (strong, ink) = (paper.strong, paper.ink);
    div()
        .absolute()
        .left(px(left))
        .top(px(top))
        .w(px(22.))
        .h(px(30.))
        .overflow_hidden()
        .rounded(px(3.))
        .bg(paper.fill)
        .border_1()
        .border_color(paper.edge)
        .shadow(vec![crate::ui::moments::paint::shadow(
            paper.shadow,
            px(1.),
            px(3.),
            px(0.),
        )])
        .children(
            screen_marks(kind)
                .into_iter()
                .map(move |(x, y, mw, mh, radius, is_strong)| {
                    div()
                        .absolute()
                        .left(px(x - 1.))
                        .top(px(y - 1.))
                        .w(px(mw))
                        .h(px(mh))
                        .rounded(px(radius))
                        .bg(if is_strong { strong } else { ink })
                }),
        )
}
