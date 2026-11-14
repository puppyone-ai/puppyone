//! Drawing helpers the first-run pictures share: a scaled unit, CSS easing and
//! step timing, and the strokes and marks GPUI has no element for (dashed
//! rings, partly drawn lines, rotated cards, a QR code's look).
use crate::ui::motion::cubic_bezier;
use gpui::{prelude::*, *};

/// `zoom`: a length of the 380px (or pile) drawing at the picture's scale.
pub(super) fn u(scale: f32, value: f32) -> Pixels {
    px(value * scale)
}

/// CSS `ease`.
pub(super) fn ease(t: f32) -> f32 {
    cubic_bezier(0.25, 0.1, 0.25, 1., t)
}

/// How far a step `duration` long that starts `delay` into its moment has
/// run (`animation-fill-mode: backwards`/`both`). `None` is a moment at rest:
/// every step has ended, as the reference finishes them before capturing.
pub(super) fn step(time: Option<f32>, delay: f32, duration: f32) -> f32 {
    match time {
        None => 1.,
        Some(t) if t <= delay => 0.,
        Some(t) => ((t - delay) / duration).min(1.),
    }
}

/// CSS `box-shadow: 0 <y> <blur> <spread> <color>`.
pub(super) fn shadow(color: Rgba, y: Pixels, blur: Pixels, spread: Pixels) -> BoxShadow {
    BoxShadow {
        color: color.into(),
        offset: point(px(0.), y),
        blur_radius: blur,
        spread_radius: spread,
        inset: false,
    }
}
/// A solid ring outside the box (`box-shadow: 0 0 0 <width> <color>`).
pub(super) fn ring(color: Rgba, width: Pixels) -> BoxShadow {
    shadow(color, px(0.), px(0.), width)
}

/// Paints into the element's own bounds.
pub(super) fn paint(draw: impl Fn(Bounds<Pixels>, &mut Window) + 'static) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, _, window, _| draw(bounds, window),
    )
    .size_full()
}

/// A dashed ring (`stroke-dasharray`), turned `turn` radians.
pub(super) fn dashed_ring(
    window: &mut Window,
    center: Point<Pixels>,
    radius: f32,
    dash: [f32; 2],
    width: f32,
    turn: f32,
    color: Rgba,
) {
    let mut builder = PathBuilder::stroke(px(width)).dash_array(&[px(dash[0]), px(dash[1])]);
    let start = point(
        center.x + px(radius * turn.cos()),
        center.y + px(radius * turn.sin()),
    );
    builder.move_to(start);
    let half = point(
        center.x - px(radius * turn.cos()),
        center.y - px(radius * turn.sin()),
    );
    builder.arc_to(point(px(radius), px(radius)), px(0.), false, true, half);
    builder.arc_to(point(px(radius), px(radius)), px(0.), false, true, start);
    if let Ok(path) = builder.build() {
        window.paint_path(path, color);
    }
}

/// A polyline drawn `progress` of the way along its length (`pathLength="1"`
/// with `stroke-dashoffset`).
pub(super) fn polyline(
    window: &mut Window,
    points: &[Point<Pixels>],
    width: f32,
    progress: f32,
    color: Rgba,
) {
    if points.len() < 2 || progress <= 0. {
        return;
    }
    let lengths: Vec<f32> = points
        .windows(2)
        .map(|w| {
            let (dx, dy) = (f32::from(w[1].x - w[0].x), f32::from(w[1].y - w[0].y));
            (dx * dx + dy * dy).sqrt()
        })
        .collect();
    let mut left = lengths.iter().sum::<f32>() * progress.min(1.);
    let mut builder = PathBuilder::stroke(px(width));
    builder.move_to(points[0]);
    for (segment, length) in points.windows(2).zip(lengths) {
        if left >= length {
            builder.line_to(segment[1]);
            left -= length;
        } else {
            let k = left / length.max(f32::EPSILON);
            builder.line_to(point(
                segment[0].x + (segment[1].x - segment[0].x) * k,
                segment[0].y + (segment[1].y - segment[0].y) * k,
            ));
            break;
        }
    }
    if let Ok(path) = builder.build() {
        window.paint_path(path, color);
    }
}

/// A filled polygon.
pub(super) fn polygon(window: &mut Window, points: &[Point<Pixels>], color: Rgba) {
    let mut builder = PathBuilder::fill();
    builder.add_polygon(points, true);
    if let Ok(path) = builder.build() {
        window.paint_path(path, color);
    }
}

/// A rounded rectangle at `origin` (its own top-left before turning), turned
/// `degrees` about `pivot`: the drawn form of a CSS `rotate()`d box.
#[allow(clippy::too_many_arguments)]
pub(super) fn turned_rect(
    window: &mut Window,
    origin: Point<Pixels>,
    size: Size<Pixels>,
    radius: f32,
    pivot: Point<Pixels>,
    degrees: f32,
    fill: Option<Rgba>,
    stroke: Option<(f32, Rgba)>,
) {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let turn = |p: Point<Pixels>| {
        let (x, y) = (f32::from(p.x - pivot.x), f32::from(p.y - pivot.y));
        point(
            pivot.x + px(x * cos - y * sin),
            pivot.y + px(x * sin + y * cos),
        )
    };
    let (w, h) = (f32::from(size.width), f32::from(size.height));
    let r = radius.min(w / 2.).min(h / 2.);
    // The outline, corners as short polylines so the turn stays exact.
    let mut outline = Vec::new();
    for (cx, cy, from) in [
        (w - r, r, -90f32),
        (w - r, h - r, 0.),
        (r, h - r, 90.),
        (r, r, 180.),
    ] {
        for k in 0..=6 {
            let a = (from + 15. * k as f32).to_radians();
            outline.push(turn(point(
                origin.x + px(cx + r * a.cos()),
                origin.y + px(cy + r * a.sin()),
            )));
        }
    }
    if let Some(color) = fill {
        polygon(window, &outline, color);
    }
    if let Some((width, color)) = stroke {
        let mut builder = PathBuilder::stroke(px(width));
        builder.add_polygon(&outline, true);
        if let Ok(path) = builder.build() {
            window.paint_path(path, color);
        }
    }
}

/// A QR code's look, not a code: three finder squares and a fixed scatter
/// (`QrMark`, the same seed), `side` square at `origin`.
pub(super) fn qr_mark(
    window: &mut Window,
    origin: Point<Pixels>,
    side: f32,
    color: Rgba,
    ground: Rgba,
) {
    const SIZE: usize = 21;
    // The product draws it in a `-1 -1 23 23` viewBox: a module of quiet edge.
    let cell = side / (SIZE as f32 + 2.);
    let at = |x: f32, y: f32, w: f32, h: f32| {
        Bounds::new(
            point(
                origin.x + px((x + 1.) * cell),
                origin.y + px((y + 1.) * cell),
            ),
            size(px(w * cell), px(h * cell)),
        )
    };
    for (fx, fy) in [(0., 0.), (14., 0.), (0., 14.)] {
        // Outer 7, white 5, inner 3 (`fillRule="evenodd"`).
        for (inset, filled) in [(0., true), (1., false), (2., true)] {
            let edge = 7. - inset * 2.;
            let bounds = at(fx + inset, fy + inset, edge, edge);
            window.paint_quad(fill(bounds, if filled { color } else { ground }));
        }
    }
    // In JavaScript numbers, as the product computes it: the product exceeds
    // 2^53 and rounds, and the pattern follows that rounding.
    let mut seed: f64 = 7.;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let in_finder = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
            seed = (seed * 1_103_515_245. + 12_345.) % 2_147_483_648.;
            if !in_finder && seed % 5. < 2. {
                window.paint_quad(fill(at(x as f32, y as f32, 1., 1.), color));
            }
        }
    }
}
