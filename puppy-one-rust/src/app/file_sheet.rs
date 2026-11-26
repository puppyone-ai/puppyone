//! Shared paper-sheet miniatures used by Homepage project folders
//! (`home/folder`) and the empty-project start view (`editor_start`).
//!
//! Each sheet says what kind of file it is by the layout printed on it — a
//! document's title and lines, a table's grid, a webpage's bar and blocks, a
//! whiteboard's shapes and arrow — in the paper's own greys, with no labels or
//! colour, so both Home and the empty editor stay quiet.
use super::home::previews::PreviewKind;
use crate::{
    features::create_new::Entry,
    theme::{self, Theme},
    ui::moments::paint,
};
use gpui::{prelude::*, *};

/// The layout drawn on a paper sheet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum SheetKind {
    Md,
    Csv,
    Html,
    Whiteboard,
    Other,
}

impl From<PreviewKind> for SheetKind {
    fn from(kind: PreviewKind) -> Self {
        match kind {
            PreviewKind::Md => Self::Md,
            PreviewKind::Csv => Self::Csv,
            PreviewKind::Html => Self::Html,
            PreviewKind::Other => Self::Other,
        }
    }
}

impl From<Entry> for SheetKind {
    fn from(entry: Entry) -> Self {
        match entry {
            Entry::Markdown => Self::Md,
            Entry::Csv => Self::Csv,
            Entry::Html => Self::Html,
            Entry::Whiteboard => Self::Whiteboard,
            _ => Self::Other,
        }
    }
}

/// The paper palette: folder sheets use [`Paper::new`], standing start-view
/// sheets on the editor canvas use [`Paper::canvas`].
pub(in crate::app) struct Paper {
    pub fill: Rgba,
    pub edge: Rgba,
    pub shadow: Rgba,
    /// A title, a table's header, a page's bar, whiteboard strokes.
    pub strong: Rgba,
    /// Lines, cells and blocks.
    pub ink: Rgba,
    /// Soft tinted fills (table header, browser bar, cards, sticky notes).
    pub tint: Rgba,
}

impl Paper {
    /// Paper peeking out of a Homepage project folder.
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
            tint: tone(theme::alpha(t.text, 0.055)),
        }
    }

    /// Paper standing on the editor canvas (`editor_start`): `#fff`/`#232323`
    /// sheet, quiet hairline border, grey ink and soft tint fills.
    pub fn canvas(t: Theme) -> Self {
        let fill = if t.dark { t.menu_bg } else { t.panel_raised };
        let edge = t.divider;
        let strong = theme::alpha(t.text, if t.dark { 0.36 } else { 0.34 });
        let ink = theme::alpha(t.text, if t.dark { 0.18 } else { 0.16 });
        let tint = theme::alpha(t.text, if t.dark { 0.055 } else { 0.05 });
        Self {
            fill,
            edge,
            shadow: theme::alpha(t.shadow, 0.),
            strong,
            ink,
            tint,
        }
    }
}

/// One printed mark: `(x, y, width, height, radius, strong)` in the sheet's
/// own units, before it is turned.
type Mark = (f32, f32, f32, f32, f32, bool);

/// The layout printed on a `44 × 37` Grid sheet.
fn grid_marks(kind: SheetKind) -> Vec<Mark> {
    match kind {
        // A document: its title, then lines of text.
        SheetKind::Md => vec![
            (5., 5., 17., 3., 1.5, true),
            (5., 11., 34., 2., 1., false),
            (5., 15., 34., 2., 1., false),
            (5., 19., 26., 2., 1., false),
            (5., 25., 34., 2., 1., false),
        ],
        // A table: a header row over rows of cells, three columns.
        SheetKind::Csv => (0..5)
            .flat_map(|row| {
                (0..3).map(move |col| {
                    let y = 5. + row as f32 * 5.;
                    (5. + col as f32 * 12., y, 10., 3., 0.75, row == 0)
                })
            })
            .collect(),
        // A page: the browser's bar, a large block, two blocks beside.
        SheetKind::Html => vec![
            (5., 4.5, 2.5, 2.5, 1.25, true),
            (9., 4.5, 2.5, 2.5, 1.25, true),
            (13., 4.5, 2.5, 2.5, 1.25, true),
            (5., 10., 34., 8., 1.5, false),
            (5., 21., 16., 6., 1.5, false),
            (23., 21., 16., 6., 1.5, false),
        ],
        // A whiteboard: round node, box, sticky card.
        SheetKind::Whiteboard => vec![
            (7., 6., 10., 10., 5., true),
            (24., 16., 14., 9., 2., true),
            (7., 20., 11., 10., 1.5, false),
        ],
        // Any other file: lines.
        SheetKind::Other => vec![
            (5., 6., 34., 2., 1., false),
            (5., 10., 34., 2., 1., false),
            (5., 14., 22., 2., 1., false),
        ],
    }
}

/// The same layouts on a `15 × 12` List sheet.
fn compact_marks(kind: SheetKind) -> Vec<Mark> {
    match kind {
        SheetKind::Md => vec![
            (2.5, 2.5, 5., 1.5, 0.75, true),
            (2.5, 5.5, 10., 1., 0.5, false),
            (2.5, 7.5, 8., 1., 0.5, false),
        ],
        SheetKind::Csv => (0..3)
            .flat_map(|row| {
                (0..3).map(move |col| {
                    let y = 2.5 + row as f32 * 2.5;
                    (2.5 + col as f32 * 3.5, y, 3., 1.5, 0.25, row == 0)
                })
            })
            .collect(),
        SheetKind::Html => vec![
            (2.5, 2.5, 10., 1.5, 0.5, true),
            (2.5, 5., 10., 4., 0.75, false),
        ],
        SheetKind::Whiteboard => vec![(2.5, 2.5, 4., 4., 2., true), (8., 6., 4.5, 3., 0.75, false)],
        SheetKind::Other => vec![
            (2.5, 3., 10., 1., 0.5, false),
            (2.5, 5.5, 7., 1., 0.5, false),
        ],
    }
}

/// `(left, top, degrees)` of each Grid sheet, and the order they are drawn
/// in (the middle one last, on top).
pub(in crate::app) fn grid_sheet_placements(
    count: usize,
) -> (&'static [(f32, f32, f32)], &'static [usize]) {
    match count {
        1 => (&[(30., 3., 2.)], &[0]),
        2 => (&[(16., 5., -4.), (44., 3., 3.5)], &[0, 1]),
        _ => (&[(7., 7., -6.), (30., 2., 1.), (53., 7., 6.)], &[0, 2, 1]),
    }
}

/// `(left, top)` of each List sheet.
pub(in crate::app) fn compact_sheet_placements(
    count: usize,
) -> (&'static [(f32, f32)], &'static [usize]) {
    match count {
        1 => (&[(9.5, 2.)], &[0]),
        2 => (&[(6.5, 2.5), (12.5, 1.5)], &[0, 1]),
        _ => (&[(4., 3.), (9.5, 1.5), (15., 3.)], &[0, 2, 1]),
    }
}

/// One `44 × 37` Grid sheet and its print, turned about the sheet's centre.
pub(in crate::app) fn render_grid_sheet(
    placement: (f32, f32, f32),
    kind: impl Into<SheetKind>,
    paper: &Paper,
) -> Div {
    let (left, top, degrees) = placement;
    let (w, h) = (44., 37.);
    let (fill, edge, shadow) = (paper.fill, paper.edge, paper.shadow);
    let (strong, ink) = (paper.strong, paper.ink);
    let marks = grid_marks(kind.into());
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
pub(in crate::app) fn render_compact_sheet(
    placement: (f32, f32),
    kind: impl Into<SheetKind>,
    paper: &Paper,
) -> Div {
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
        .children(compact_marks(kind.into()).into_iter().map(
            move |(x, y, mw, mh, radius, is_strong)| {
                // Marks sit inside the 1px edge.
                div()
                    .absolute()
                    .left(px(x - 1.))
                    .top(px(y - 1.))
                    .w(px(mw))
                    .h(px(mh))
                    .rounded(px(radius))
                    .bg(if is_strong { strong } else { ink })
            },
        ))
}

/// The same layouts on a `22 × 30` sheet standing on a computer's screen
/// (`.project-computer-preview`).
fn screen_marks(kind: SheetKind) -> Vec<Mark> {
    match kind {
        SheetKind::Md => vec![
            (3., 3., 9., 2., 1., true),
            (3., 7., 16., 1.5, 0.75, false),
            (3., 10., 16., 1.5, 0.75, false),
            (3., 13., 11., 1.5, 0.75, false),
            (3., 17., 16., 1.5, 0.75, false),
        ],
        SheetKind::Csv => (0..5)
            .flat_map(|row| {
                (0..2).map(move |col| {
                    let y = 3. + row as f32 * 4.;
                    (3. + col as f32 * 8.5, y, 7.5, 2., 0.5, row == 0)
                })
            })
            .collect(),
        SheetKind::Html => vec![
            (3., 3., 1.6, 1.6, 0.8, true),
            (5.6, 3., 1.6, 1.6, 0.8, true),
            (8.2, 3., 1.6, 1.6, 0.8, true),
            (3., 7., 16., 7., 1., false),
            (3., 16., 7.5, 5., 1., false),
            (11.5, 16., 7.5, 5., 1., false),
        ],
        SheetKind::Whiteboard => vec![
            (4., 5., 6., 6., 3., true),
            (11., 14., 7.5, 5., 1., true),
            (4., 16., 5.5, 5.5, 1., false),
        ],
        SheetKind::Other => vec![
            (3., 4., 16., 1.5, 0.75, false),
            (3., 7.5, 16., 1.5, 0.75, false),
            (3., 11., 10., 1.5, 0.75, false),
        ],
    }
}

/// One `22 × 30` sheet standing on the computer's screen.
pub(in crate::app) fn render_screen_sheet(
    left: f32,
    top: f32,
    kind: impl Into<SheetKind>,
    paper: &Paper,
) -> Div {
    let (strong, ink) = (paper.strong, paper.ink);
    div()
        .absolute()
        .left(px(left))
        .top(px(top))
        .w(px(22.))
        .h(px(30.))
        .overflow_hidden()
        .rounded(px(2.5))
        .bg(paper.fill)
        .border_1()
        .border_color(paper.edge)
        .children(screen_marks(kind.into()).into_iter().map(
            move |(x, y, mw, mh, radius, is_strong)| {
                div()
                    .absolute()
                    .left(px(x - 1.))
                    .top(px(y - 1.))
                    .w(px(mw))
                    .h(px(mh))
                    .rounded(px(radius))
                    .bg(if is_strong { strong } else { ink })
            },
        ))
}

#[allow(clippy::too_many_arguments)]
fn paint_sheet_rect(
    window: &mut Window,
    ox: Pixels,
    oy: Pixels,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    color: Rgba,
) {
    window.paint_quad(PaintQuad {
        bounds: Bounds::new(point(ox + px(x), oy + px(y)), size(px(w), px(h))),
        corner_radii: Corners::all(px(r)),
        background: color.into(),
        border_widths: Edges::default(),
        border_color: transparent_black(),
        border_style: BorderStyle::default(),
    });
}

fn paint_sheet_stroke(
    window: &mut Window,
    ox: Pixels,
    oy: Pixels,
    pts: &[(f32, f32)],
    width: f32,
    closed: bool,
    color: Rgba,
) {
    let mut b = PathBuilder::stroke(px(width));
    let mapped: Vec<Point<Pixels>> = pts
        .iter()
        .map(|&(x, y)| point(ox + px(x), oy + px(y)))
        .collect();
    b.add_polygon(&mapped, closed);
    if let Ok(path) = b.build() {
        window.paint_path(path, color);
    }
}

/// One `72 × 92` standing sheet for the empty-project start view (`editor_start`):
/// the same greyscale visual language as Home folders, at reading scale, plus a
/// dedicated whiteboard layout (circle, box, curved arrow, sticky note, wave).
pub(in crate::app) fn render_start_sheet(kind: SheetKind, hover_group: &str, t: Theme) -> Div {
    const W: f32 = 72.;
    const H: f32 = 92.;
    let paper = Paper::canvas(t);
    let (ink, tint, stroke_color) = (paper.ink, paper.tint, paper.strong);
    let ink_soft = theme::alpha(t.text, if t.dark { 0.13 } else { 0.11 });
    let ink_mid = theme::alpha(t.text, if t.dark { 0.11 } else { 0.095 });

    let draw = paint::paint(move |bounds, window| {
        let ox = bounds.origin.x;
        let oy = bounds.origin.y;

        match kind {
            SheetKind::Md => {
                // Title bar + two paragraphs of grey text bars.
                paint_sheet_rect(window, ox, oy, 11., 13., 32., 5., 2., ink);
                for (i, w) in [52., 47., 50., 28.].into_iter().enumerate() {
                    paint_sheet_rect(
                        window,
                        ox,
                        oy,
                        11.,
                        27. + i as f32 * 8.,
                        w,
                        3.,
                        1.5,
                        ink_soft,
                    );
                }
                for (i, w) in [49., 44., 36.].into_iter().enumerate() {
                    paint_sheet_rect(
                        window,
                        ox,
                        oy,
                        11.,
                        64. + i as f32 * 8.,
                        w,
                        3.,
                        1.5,
                        ink_soft,
                    );
                }
            }
            SheetKind::Csv => {
                // Header tint + 7-row × 3-column grid + header & cell marks.
                paint_sheet_rect(window, ox, oy, 9., 11., 54., 10., 0., tint);
                for r in 0..=7 {
                    let y = 11. + r as f32 * 10.;
                    paint_sheet_rect(window, ox, oy, 9., y, 54., 1., 0., ink);
                }
                for x in [9., 27., 45., 62.] {
                    paint_sheet_rect(window, ox, oy, x, 11., 1., 71., 0., ink);
                }
                paint_sheet_rect(window, ox, oy, 12., 14.5, 11., 3., 1.5, ink);
                paint_sheet_rect(window, ox, oy, 30., 14.5, 11., 3., 1.5, ink);
                paint_sheet_rect(window, ox, oy, 48., 14.5, 10., 3., 1.5, ink);
                for (r, l) in [(0, 9.), (1, 12.), (2, 7.), (3, 10.), (4, 8.)] {
                    let y = 24.5 + r as f32 * 10.;
                    paint_sheet_rect(window, ox, oy, 12., y, l, 3., 1.5, ink_mid);
                    paint_sheet_rect(window, ox, oy, 30., y, l + 1., 3., 1.5, ink_mid);
                }
            }
            SheetKind::Html => {
                // Browser chrome bar + 3 window dots + hero block + 2 cards + footer lines.
                paint_sheet_rect(window, ox, oy, 1., 1., W - 2., 12., 0., tint);
                paint_sheet_rect(window, ox, oy, 1., 13., W - 2., 1., 0., ink);
                for cx in [7., 12., 17.] {
                    paint_sheet_rect(window, ox, oy, cx - 1.6, 7. - 1.6, 3.2, 3.2, 1.6, ink);
                }
                paint_sheet_rect(window, ox, oy, 10., 20., 52., 22., 3., tint);
                paint_sheet_rect(window, ox, oy, 16., 27., 26., 4., 2., ink);
                paint_sheet_rect(window, ox, oy, 16., 34., 18., 3., 1.5, ink_mid);
                paint_sheet_rect(window, ox, oy, 10., 48., 24., 18., 3., tint);
                paint_sheet_rect(window, ox, oy, 38., 48., 24., 18., 3., tint);
                paint_sheet_rect(window, ox, oy, 10., 72., 44., 3., 1.5, ink_mid);
                paint_sheet_rect(window, ox, oy, 10., 79., 32., 3., 1.5, ink_mid);
            }
            SheetKind::Whiteboard => {
                // Circle node (cx=24, cy=30, r=10).
                let circle: Vec<(f32, f32)> = (0..28)
                    .map(|k| {
                        let a = (k as f32 / 28.) * std::f32::consts::TAU;
                        (24. + 10. * a.cos(), 30. + 10. * a.sin())
                    })
                    .collect();
                paint_sheet_stroke(window, ox, oy, &circle, 1.3, true, stroke_color);
                // Box node (x=38, y=52, w=24, h=17, rx=3).
                window.paint_quad(PaintQuad {
                    bounds: Bounds::new(point(ox + px(38.), oy + px(52.)), size(px(24.), px(17.))),
                    corner_radii: Corners::all(px(3.)),
                    background: transparent_black().into(),
                    border_widths: Edges::all(px(1.3)),
                    border_color: stroke_color.into(),
                    border_style: BorderStyle::default(),
                });
                // Curved connector arrow from circle toward box.
                let curve: Vec<(f32, f32)> = (0..=10)
                    .map(|i| {
                        let s = i as f32 / 10.;
                        let inv = 1. - s;
                        let x = inv * inv * inv * 32.
                            + 3. * inv * inv * s * 38.
                            + 3. * inv * s * s * 41.
                            + s * s * s * 44.;
                        let y = inv * inv * inv * 37.
                            + 3. * inv * inv * s * 41.
                            + 3. * inv * s * s * 45.
                            + s * s * s * 51.;
                        (x, y)
                    })
                    .collect();
                paint_sheet_stroke(window, ox, oy, &curve, 1.3, false, stroke_color);
                paint_sheet_stroke(
                    window,
                    ox,
                    oy,
                    &[(41., 48.), (44., 51.5), (45.2, 47.1)],
                    1.3,
                    false,
                    stroke_color,
                );
                // Sticky note with two short ink bars.
                paint_sheet_rect(window, ox, oy, 11., 55., 17., 17., 2., tint);
                paint_sheet_rect(window, ox, oy, 14., 60., 11., 2.5, 1.2, ink_soft);
                paint_sheet_rect(window, ox, oy, 14., 65., 7., 2.5, 1.2, ink_soft);
                // Freehand top-right stroke.
                let wave: Vec<(f32, f32)> = (0..=8)
                    .map(|i| {
                        let s = i as f32 / 8.;
                        let inv = 1. - s;
                        let x = inv * inv * inv * 44.
                            + 3. * inv * inv * s * 48.
                            + 3. * inv * s * s * 53.
                            + s * s * s * 57.;
                        let y = inv * inv * inv * 20.
                            + 3. * inv * inv * s * 17.
                            + 3. * inv * s * s * 17.
                            + s * s * s * 21.;
                        (x, y)
                    })
                    .collect();
                paint_sheet_stroke(
                    window,
                    ox,
                    oy,
                    &wave,
                    1.3,
                    false,
                    theme::alpha(stroke_color, 0.7),
                );
            }
            SheetKind::Other => {
                paint_sheet_rect(window, ox, oy, 11., 16., 28., 4., 2., ink);
                for (i, w) in [48., 44., 50., 36., 42.].into_iter().enumerate() {
                    paint_sheet_rect(
                        window,
                        ox,
                        oy,
                        11.,
                        29. + i as f32 * 9.,
                        w,
                        3.,
                        1.5,
                        ink_soft,
                    );
                }
            }
        }
    });

    div()
        .relative()
        .w(px(W))
        .h(px(H))
        .flex_none()
        .rounded(px(5.))
        .overflow_hidden()
        .bg(paper.fill)
        .border_1()
        .border_color(paper.edge)
        .group_hover(SharedString::from(hover_group.to_owned()), move |d| {
            d.top(px(-2.)).border_color(paper.strong)
        })
        .child(draw)
}
