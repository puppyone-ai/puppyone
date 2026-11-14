//! `OnboardingValueEditScene` and its rules in `onboarding-value-carousel.css`:
//! circle a chart, say one line, and an Agent redraws it. The HTML dashboard
//! leads; a Markdown note and a table, turned behind it, only show that they
//! work the same way.
use super::paint::{self, u};
use super::{Clock, Layout};
use crate::localization::t as tr;
use crate::theme::{self, Theme};
use crate::ui::agent_brands;
use gpui::{prelude::*, *};

/// `MONTHLY_LINE`: the dashboard's months on its 260×88 chart.
const LINE: [(f32, f32); 9] = [
    (6., 70.),
    (36., 64.),
    (66., 56.),
    (96., 53.),
    (126., 48.),
    (156., 34.),
    (186., 36.),
    (216., 29.),
    (246., 18.),
];
/// The bars the line replaces: x, y, width, height and opacity.
const BARS: [(f32, f32, f32, f32, f32); 3] = [
    (30., 40., 44., 46., 0.55),
    (108., 28., 44., 58., 0.75),
    (186., 14., 44., 72., 1.),
];

/// Linear interpolation through `(offset, value)` keyframes, eased per
/// segment (`animation-timing-function: ease` applies between keyframes).
fn keyframes(progress: f32, frames: &[(f32, f32)]) -> f32 {
    let p = progress.clamp(0., 1.);
    for pair in frames.windows(2) {
        let ((a, va), (b, vb)) = (pair[0], pair[1]);
        if p <= b {
            let k = if b > a {
                paint::ease((p - a) / (b - a))
            } else {
                1.
            };
            return va + (vb - va) * k;
        }
    }
    frames.last().map_or(0., |f| f.1)
}

/// One animated step of the moment: when it starts and how long it runs, in
/// seconds (`animation-delay`, `animation-duration`).
#[derive(Clone, Copy)]
struct Step {
    delay: f32,
    duration: f32,
}
impl Step {
    /// How far it has run; at rest, to its end.
    fn at(self, time: Option<f32>) -> f32 {
        paint::step(time, self.delay, self.duration)
    }
}
/// `onboarding-scene-select` and `-picked`: the chart circled, then done.
const SELECT: Step = Step {
    delay: 0.,
    duration: 2.3,
};
/// The "done" tag appears (`onboarding-scene-appear`).
const DONE_TAG: Step = Step {
    delay: 2.,
    duration: 0.3,
};
/// The prompt rises (`onboarding-scene-rise`).
const PROMPT: Step = Step {
    delay: 0.6,
    duration: 0.45,
};
/// The bars give way (`onboarding-scene-bars-out`).
const BARS_OUT: Step = Step {
    delay: 0.,
    duration: 2.,
};
/// The line draws itself, then its area fills in.
const DRAW: Step = Step {
    delay: 1.4,
    duration: 0.9,
};
const AREA: Step = Step {
    delay: 1.7,
    duration: 0.6,
};
/// The Markdown line, then the table's column, flash to show they work the
/// same way (`onboarding-scene-flash`, `-flash-box`).
const FLASH: Step = Step {
    delay: 2.6,
    duration: 1.,
};
const PICK: Step = Step {
    delay: 3.,
    duration: 1.,
};

/// The keyframes those steps follow, as `(offset, value)`.
const SELECT_OPACITY: [(f32, f32); 4] = [(0., 0.), (0.1, 0.), (0.2, 1.), (1., 1.)];
const SELECT_DONE: [(f32, f32); 3] = [(0., 0.), (0.85, 0.), (1., 1.)];
const PICKED: [(f32, f32); 5] = [(0., 0.), (0.1, 0.), (0.2, 1.), (0.85, 1.), (1., 0.)];
const FADE_OUT: [(f32, f32); 3] = [(0., 1.), (0.7, 1.), (1., 0.)];
const PULSE: [(f32, f32); 4] = [(0., 0.), (0.4, 1.), (0.6, 1.), (1., 0.)];

/// A box on a turned card, in the drawing's units: where, how big, how
/// round, and its fill and outline.
#[derive(Clone, Copy)]
struct Mark {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    radius: f32,
    fill: Rgba,
    stroke: Option<(f32, Rgba)>,
}
impl Mark {
    fn fill(x: f32, y: f32, w: f32, h: f32, radius: f32, fill: Rgba) -> Self {
        Self {
            x,
            y,
            w,
            h,
            radius,
            fill,
            stroke: None,
        }
    }
    /// `.onboarding-scene-card`: 10px round, 1px border.
    fn card(x: f32, y: f32, w: f32, h: f32, fill: Rgba, border: Rgba) -> Self {
        Self {
            stroke: Some((1., border)),
            ..Self::fill(x, y, w, h, 10., fill)
        }
    }
}

pub(super) fn scene(t: &Theme, layout: Layout, clock: Clock) -> AnyElement {
    let (k, time) = (layout.scale, clock.moment);
    let chart_ink = t.accent;
    let done = t.success;

    let select = SELECT.at(time);
    let select_opacity = keyframes(select, &SELECT_OPACITY);
    // The circle turns from the chart's colour to done's at its end.
    let select_color = theme::mix(done, chart_ink, keyframes(select, &SELECT_DONE));
    let picked = keyframes(select, &PICKED);
    let done_tag = paint::ease(DONE_TAG.at(time));
    let prompt = paint::ease(PROMPT.at(time));
    let bars = keyframes(BARS_OUT.at(time), &FADE_OUT);
    let area = paint::ease(AREA.at(time));
    let draw = paint::ease(DRAW.at(time));
    let flash = keyframes(FLASH.at(time), &PULSE);
    let pick = keyframes(PICK.at(time), &PULSE);

    // The two cards behind, turned ±4deg about their centres.
    let line_ink = theme::alpha(t.text, 0.12);
    let flash_ink = theme::mix(theme::alpha(chart_ink, 0.45), line_ink, flash);
    let heading = theme::alpha(t.text, 0.68);
    let (border, ground) = (t.border, t.panel_raised);
    let (sheet_head, sheet_cell) = (
        theme::alpha(t.file.sheet, 0.36),
        theme::alpha(t.file.sheet, 0.14),
    );
    let pick_fill = theme::alpha(chart_ink, 0.12 * pick);
    let pick_edge = theme::alpha(chart_ink, pick);
    let behind = paint::paint(move |bounds, window| {
        let o = bounds.origin;
        let at = |x: f32, y: f32| point(o.x + u(k, x), o.y + u(k, y));
        let sz = |w: f32, h: f32| size(u(k, w), u(k, h));
        // A card and the marks inside it, all turned about the card's centre.
        let card = |window: &mut Window, frame: Mark, degrees: f32, inside: &[Mark]| {
            let pivot = at(frame.x + frame.w / 2., frame.y + frame.h / 2.);
            for (mark, offset) in std::iter::once((&frame, (0., 0.)))
                .chain(inside.iter().map(|m| (m, (frame.x, frame.y))))
            {
                paint::turned_rect(
                    window,
                    at(offset.0 + mark.x, offset.1 + mark.y),
                    sz(mark.w, mark.h),
                    mark.radius * k,
                    pivot,
                    degrees,
                    Some(mark.fill),
                    mark.stroke.map(|(width, color)| (width * k, color)),
                );
            }
        };
        // Markdown: a heading and three lines in its 142px content box, 6 apart.
        let content = 142.;
        card(
            window,
            Mark::card(18., 34., 168., 92., ground, border),
            -4.,
            &[
                Mark::fill(13., 13., content * 0.46, 7., 3., heading),
                Mark::fill(13., 26., content * 0.86, 5., 3., line_ink),
                Mark::fill(13., 37., content * 0.86, 5., 3., flash_ink),
                Mark::fill(13., 48., content * 0.52, 5., 3., line_ink),
            ],
        );
        // The table: a heading, then twelve cells four across, the header row tinted.
        let content = 146.;
        let cell = (content - 3. * 3.) / 4.;
        let mut inside = vec![Mark::fill(13., 13., content * 0.46, 7., 3., heading)];
        inside.extend((0..12).map(|index| {
            let (col, row) = ((index % 4) as f32, (index / 4) as f32);
            let ink = if index < 4 { sheet_head } else { sheet_cell };
            Mark::fill(13. + col * (cell + 3.), 26. + row * 11., cell, 8., 2., ink)
        }));
        // `.onboarding-scene-grid-pick`, flashed over the third column.
        inside.push(Mark {
            stroke: Some((1.5, pick_edge)),
            ..Mark::fill(87., 30., 33.5, 42., 3., pick_fill)
        });
        card(
            window,
            Mark::card(190., 26., 172., 96., ground, border),
            4.,
            &inside,
        );
    });

    let kpi = |label: &'static str, value: SharedString| {
        div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(u(k, 1.))
            .px(u(k, 8.))
            .py(u(k, 6.))
            .rounded(u(k, 6.))
            .bg(theme::alpha(t.text, 0.05))
            .text_color(t.muted)
            .text_size(u(k, 9.))
            .line_height(u(k, 12.))
            .whitespace_nowrap()
            .child(tr(label))
            .child(
                div()
                    .text_color(t.text)
                    .text_size(u(k, 13.))
                    .line_height(u(k, 17.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(value),
            )
    };

    let axis = t.divider;
    let area_fill = theme::alpha(chart_ink, 0.12 * area);
    // The chart's drawing: the 260×88 viewBox stretched over its box
    // (`preserveAspectRatio="none"`), inset 8 8 6 within the chart's border.
    let drawing = paint::paint(move |bounds, window| {
        let (w, h) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
        let (sx, sy) = (w / 260., h / 88.);
        let o = bounds.origin;
        let at = |x: f32, y: f32| point(o.x + px(x * sx), o.y + px(y * sy));
        window.paint_quad(fill(
            Bounds::new(
                at(0., 86.) - point(px(0.), px(sy / 2.)),
                size(px(w), px(sy)),
            ),
            axis,
        ));
        if bars > 0. {
            for (x, y, bw, bh, opacity) in BARS {
                window.paint_quad(
                    fill(
                        Bounds::new(at(x, y), size(px(bw * sx), px(bh * sy))),
                        theme::alpha(chart_ink, opacity * bars),
                    )
                    .corner_radii(px(2. * sx.min(sy))),
                );
            }
        }
        if area > 0. {
            let mut points = vec![at(6., 86.)];
            points.extend(LINE.iter().map(|&(x, y)| at(x, y)));
            points.push(at(246., 86.));
            paint::polygon(window, &points, area_fill);
        }
        let line: Vec<_> = LINE.iter().map(|&(x, y)| at(x, y)).collect();
        paint::polyline(window, &line, 2. * (sx * sy).sqrt(), draw, chart_ink);
    });

    let tag = |label: SharedString, bg: Rgba, opacity: f32| {
        div()
            .absolute()
            .top(u(k, -19.))
            .left(u(k, -2.))
            .px(u(k, 7.))
            .py(u(k, 3.))
            .rounded_t(u(k, 5.))
            .bg(bg)
            .opacity(opacity)
            .text_color(t.text_inverse)
            .text_size(u(k, 10.))
            .line_height(u(k, 13.))
            .font_weight(FontWeight::SEMIBOLD)
            .whitespace_nowrap()
            .child(label)
    };
    let chart = div()
        .relative()
        .flex_1()
        .min_h_0()
        .mt(u(k, 22.))
        .border(u(k, 1.))
        .border_color(t.border_subtle)
        .rounded(u(k, 6.))
        .child(
            div()
                .absolute()
                .left(u(k, 8.))
                .top(u(k, 8.))
                .right(u(k, 8.))
                .bottom(u(k, 6.))
                .child(drawing),
        )
        .child(
            div()
                .absolute()
                .left(u(k, -4.))
                .top(u(k, -4.))
                .right(u(k, -4.))
                .bottom(u(k, -4.))
                .border(u(k, 2.))
                .border_color(select_color)
                .rounded(u(k, 8.))
                .opacity(select_opacity)
                .child(tag(
                    tr("onboarding.value.scene.selected").into(),
                    chart_ink,
                    picked,
                ))
                .child(tag(
                    tr("onboarding.value.scene.done").into(),
                    done,
                    done_tag,
                )),
        );

    let card_shadow =
        |y: f32, blur: f32, spread: f32| paint::shadow(t.shadow, u(k, y), u(k, blur), u(k, spread));
    let dashboard = div()
        .absolute()
        .left(u(k, 6.))
        .top(u(k, 92.))
        .w(u(k, 368.))
        .h(u(k, 246.))
        .pt(u(k, 14.))
        .px(u(k, 16.))
        .pb(u(k, 16.))
        .flex()
        .flex_col()
        .gap(u(k, 6.))
        .border(u(k, 1.))
        .border_color(t.border)
        .rounded(u(k, 10.))
        .bg(t.panel_raised)
        .shadow(vec![card_shadow(14., 30., -18.)])
        .child(
            div()
                .text_color(t.text)
                .text_size(u(k, 15.))
                .line_height(u(k, 20.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(tr("onboarding.value.scene.dashboard")),
        )
        .child(
            div()
                .flex()
                .gap(u(k, 6.))
                .child(kpi(
                    "onboarding.value.scene.revenue",
                    tr("onboarding.value.scene.revenueValue").into(),
                ))
                .child(kpi("onboarding.value.scene.customers", "326".into()))
                .child(kpi("onboarding.value.scene.renewal", "92%".into())),
        )
        .child(chart)
        .child(
            div()
                .absolute()
                .right(u(k, 10.))
                .bottom(u(k, 10.))
                .px(u(k, 5.))
                .py(u(k, 2.))
                .rounded(u(k, 3.))
                .bg(t.file.html)
                .text_color(t.text_inverse)
                .text_size(u(k, 9.))
                .line_height(u(k, 9.))
                .font_weight(FontWeight::SEMIBOLD)
                .child("HTML"),
        );

    let claude =
        agent_brands::get("claude").map(|brand| agent_brands::image(brand, t.dark, 16. * k));
    let prompt_view = div()
        .absolute()
        .left(u(k, 76.))
        .top(u(k, 322. + 8. * (1. - prompt)))
        .w(u(k, 228.))
        .h(u(k, 36.))
        .opacity(prompt)
        .flex()
        .items_center()
        .gap(u(k, 8.))
        .px(u(k, 12.))
        .border(u(k, 1.))
        .border_color(t.border)
        .rounded(u(k, 10.))
        .bg(t.panel_raised)
        .shadow(vec![card_shadow(12., 26., -12.)])
        .text_color(t.text)
        .text_size(u(k, 11.))
        .line_height(u(k, 14.))
        .children(claude)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .overflow_hidden()
                .text_ellipsis()
                .whitespace_nowrap()
                .child(tr("onboarding.value.scene.prompt")),
        )
        .child(div().text_color(t.subtle).text_size(u(k, 10.)).child("↵"));

    div()
        .relative()
        .size(u(k, 380.))
        .child(div().absolute().inset_0().child(behind))
        .child(dashboard)
        .child(prompt_view)
        .into_any_element()
}
