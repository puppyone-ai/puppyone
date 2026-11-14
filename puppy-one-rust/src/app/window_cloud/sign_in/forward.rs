//! `OnboardingValueForwardScene` (`agent = "grok-bot"`) at dialog scale: the
//! dashboard's share link goes to Grok Bot on a phone, which takes it over and
//! writes the peak annotation back to the live dashboard.
use super::{
    Clock, HUB_SCALE,
    paint::{self, u},
};
use crate::localization::{Arg, t as tr, tf};
use crate::theme::{self, Theme};
use crate::ui::{agent_brands, components::Icon};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

const DASHBOARD: [f32; 4] = [14., 88., 206., 222.];
const PHONE: [f32; 4] = [236., 66., 136., 252.];
const WIRE: [(f32, f32); 4] = [(196., 286.), (226., 284.), (222., 220.), (236., 196.)];
const MONTHLY_LINE: [(f32, f32); 9] = [
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

mod at {
    pub const WIRE: (f32, f32) = (0.3, 0.8);
    pub const RISE: f32 = 0.4;
    pub const LINK: f32 = 0.3;
    pub const OPENED: f32 = 1.1;
    pub const ASK: f32 = 2.;
    pub const SAVED: f32 = 2.8;
    pub const CHANGED: f32 = 3.2;
}

fn rise(time: Option<f32>, delay: f32) -> (f32, f32) {
    let k = paint::ease(paint::step(time, delay, at::RISE));
    (k, 8. * (1. - k))
}

fn shadow(color: Rgba, s: f32, y: f32, blur: f32, spread: f32) -> BoxShadow {
    BoxShadow {
        color: color.into(),
        offset: point(px(0.), u(s, y)),
        blur_radius: u(s, blur),
        spread_radius: u(s, spread),
        inset: false,
    }
}

fn placed(s: f32, [left, top, width, height]: [f32; 4]) -> Div {
    div()
        .absolute()
        .left(u(s, left))
        .top(u(s, top))
        .w(u(s, width))
        .h(u(s, height))
}

pub(super) fn scene(t: &Theme, clock: Clock) -> AnyElement {
    let scale = HUB_SCALE;
    let time = clock.moment;
    div()
        .relative()
        .size(px(380. * scale))
        .text_color(t.text)
        .child(div().absolute().inset_0().child(wire(t, scale, time)))
        .child(dashboard(t, scale, time))
        .child(phone(t, scale, time))
        .into_any_element()
}

fn wire(t: &Theme, s: f32, time: Option<f32>) -> impl IntoElement {
    let shown = paint::ease(paint::step(time, at::WIRE.0, at::WIRE.1));
    let color = theme::alpha(t.accent, 0.7 * shown);
    paint::paint(move |bounds, window| {
        if shown > 0. {
            let point_at =
                |(x, y): (f32, f32)| point(bounds.origin.x + px(x * s), bounds.origin.y + px(y * s));
            dashed_bezier(window, WIRE.map(point_at), 1.5 * s, color);
        }
    })
}

fn dashed_bezier(
    window: &mut Window,
    [p0, p1, p2, p3]: [Point<Pixels>; 4],
    width: f32,
    color: Rgba,
) {
    const SAMPLES: usize = 400;
    let curve = |t: f32| {
        let m = 1. - t;
        let (a, b, c, d) = (m * m * m, 3. * m * m * t, 3. * m * t * t, t * t * t);
        point(
            p0.x * a + p1.x * b + p2.x * c + p3.x * d,
            p0.y * a + p1.y * b + p2.y * c + p3.y * d,
        )
    };
    let points: Vec<_> = (0..=SAMPLES)
        .map(|i| curve(i as f32 / SAMPLES as f32))
        .collect();
    let mut lengths = vec![0f32];
    for pair in points.windows(2) {
        let (dx, dy) = (f32::from(pair[1].x - pair[0].x), f32::from(pair[1].y - pair[0].y));
        lengths.push(lengths.last().unwrap() + dx.hypot(dy));
    }
    let total = *lengths.last().unwrap();
    let along = |distance: f32| {
        let i = lengths.partition_point(|&l| l < distance).clamp(1, SAMPLES);
        let (a, b) = (lengths[i - 1], lengths[i]);
        let k = if b > a { (distance - a) / (b - a) } else { 0. };
        point(
            points[i - 1].x + (points[i].x - points[i - 1].x) * k,
            points[i - 1].y + (points[i].y - points[i - 1].y) * k,
        )
    };
    let (on, period) = (0.02 * total, 0.05 * total);
    let cap = px(width / 2.);
    let mut start = 0.;
    while start < total {
        let end = (start + on).min(total);
        let dash: Vec<_> = (0..=6)
            .map(|k| along(start + (end - start) * k as f32 / 6.))
            .collect();
        paint::polyline(window, &dash, width, 1., color);
        for tip in [dash[0], dash[6]] {
            let bounds = Bounds::new(point(tip.x - cap, tip.y - cap), size(cap * 2., cap * 2.));
            window.paint_quad(fill(bounds, color).corner_radii(cap));
        }
        start += period;
    }
}

fn dashboard(t: &Theme, s: f32, time: Option<f32>) -> impl IntoElement {
    let u = |v: f32| u(s, v);
    let kpis = h_flex().w_full().gap(u(4.)).children(
        [
            (
                tr("onboarding.value.scene.revenue"),
                tr("onboarding.value.scene.revenueValue"),
            ),
            (tr("onboarding.value.scene.customers"), "326"),
            (tr("onboarding.value.scene.renewal"), "92%"),
        ]
        .map(|(label, value)| {
            v_flex()
                .flex_1()
                .min_w_0()
                .gap(u(1.))
                .px(u(5.))
                .py(u(4.))
                .rounded(u(6.))
                .bg(theme::alpha(t.text, 0.05))
                .text_color(t.muted)
                .text_size(u(8.))
                .line_height(u(10.))
                .whitespace_nowrap()
                .child(label)
                .child(
                    div()
                        .text_color(t.text)
                        .text_size(u(10.))
                        .line_height(u(13.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(value),
                )
        }),
    );
    placed(s, DASHBOARD)
        .flex()
        .flex_col()
        .p(u(12.))
        .gap(u(5.))
        .border(u(1.))
        .border_color(t.border)
        .rounded(u(10.))
        .bg(t.panel_raised)
        .shadow(vec![shadow(t.shadow, s, 14., 30., -18.)])
        .child(
            div()
                .text_size(u(13.))
                .line_height(u(17.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(tr("onboarding.value.scene.dashboard")),
        )
        .child(kpis)
        .child(chart(t, s, time))
        .child(share(t, s))
}

fn chart(t: &Theme, s: f32, time: Option<f32>) -> impl IntoElement {
    let u = |v: f32| u(s, v);
    let (shown, low) = rise(time, at::CHANGED);
    let tag = |text: SharedString, ground: Rgba| {
        div()
            .px(u(6.))
            .py(u(2.))
            .bg(ground)
            .text_color(t.text_inverse)
            .text_size(u(9.))
            .line_height(u(13.))
            .font_weight(FontWeight::SEMIBOLD)
            .whitespace_nowrap()
            .child(text)
    };
    let agent_name = agent_brands::get("grok-bot").map_or("Grok Bot", |b| b.name);
    let changed_by = tf(
        "onboarding.value.scene.changedBy",
        &[("agent", Arg::from(agent_name))],
    );
    div()
        .relative()
        .flex_1()
        .min_h_0()
        .mt(u(22.))
        .child(
            div()
                .absolute()
                .left(u(8.))
                .right(u(8.))
                .top(u(8.))
                .bottom(u(6.))
                .child(line_chart(t)),
        )
        .child(
            div()
                .absolute()
                .top(u(2. + low))
                .right(u(6.))
                .opacity(shown)
                .child(tag(tr("onboarding.value.scene.peak").into(), t.file.html).rounded(u(4.))),
        )
        .child(
            div()
                .absolute()
                .top(u(-3. + low))
                .bottom(u(-3. - low))
                .left(u(-3.))
                .right(u(-3.))
                .opacity(shown)
                .border(u(2.))
                .border_color(t.success)
                .rounded(u(7.))
                .child(
                    div()
                        .absolute()
                        .top(u(-17.))
                        .right(u(-2.))
                        .child(tag(changed_by.into(), t.success).rounded_t(u(4.))),
                ),
        )
}

fn line_chart(t: &Theme) -> impl IntoElement {
    let (axis, area, line) = (t.divider, theme::alpha(t.accent, 0.12), t.accent);
    paint::paint(move |bounds, window| {
        let (sx, sy) = (
            f32::from(bounds.size.width) / 260.,
            f32::from(bounds.size.height) / 88.,
        );
        let at = |(x, y): (f32, f32)| {
            point(bounds.origin.x + px(x * sx), bounds.origin.y + px(y * sy))
        };
        paint::polyline(window, &[at((0., 86.)), at((260., 86.))], sy, 1., axis);
        let points: Vec<_> = MONTHLY_LINE.iter().copied().map(at).collect();
        let mut outline = vec![at((6., 86.))];
        outline.extend(points.iter().copied());
        outline.push(at((246., 86.)));
        paint::polygon(window, &outline, area);
        paint::polyline(window, &points, sx + sy, 1., line);
    })
}

fn share(t: &Theme, s: f32) -> impl IntoElement {
    let u = |v: f32| u(s, v);
    h_flex()
        .flex_none()
        .items_center()
        .justify_end()
        .gap(u(6.))
        .mt(u(6.))
        .child(
            h_flex()
                .items_center()
                .gap(u(4.))
                .px(u(8.))
                .py(u(5.))
                .rounded_full()
                .bg(theme::alpha(t.accent, 0.12))
                .text_color(t.accent_text)
                .text_size(u(9.))
                .line_height(u(11.))
                .font_weight(FontWeight::MEDIUM)
                .whitespace_nowrap()
                .child(Icon::new("link-2").stroke(2.).with_size(u(11.)).color(t.accent_text))
                .child(tr("onboarding.value.scene.send")),
        )
        .child(qr(t, s))
}

fn qr(t: &Theme, s: f32) -> impl IntoElement {
    let ground = theme::on_solid();
    let ink = theme::qr_ink();
    div()
        .flex_none()
        .size(u(s, 22.))
        .p(u(s, 2.))
        .border(u(s, 1.))
        .border_color(t.border)
        .rounded(u(s, 4.))
        .bg(ground)
        .opacity(0.8)
        .child(paint::paint(move |bounds, window| {
            let side = f32::from(bounds.size.width.min(bounds.size.height));
            paint::qr_mark(window, bounds.origin, side, ground, ink);
        }))
}

fn phone(t: &Theme, s: f32, time: Option<f32>) -> impl IntoElement {
    let u = |v: f32| u(s, v);
    let name = tr("onboarding.value.scene.dashboard");
    let mine = theme::mix(t.text, t.canvas, 0.86);
    let brand = agent_brands::get("grok-bot");
    let agent_name = brand.map_or("Grok Bot", |b| b.name);
    let avatar: AnyElement = match brand {
        Some(b) => agent_brands::artwork(b, t.dark, 13. * s)
            .rounded_full()
            .into_any_element(),
        None => div().size(u(13.)).rounded_full().into_any_element(),
    };
    let message = |delay: f32| {
        let (shown, low) = rise(time, delay);
        div()
            .relative()
            .top(u(low))
            .opacity(shown)
            .flex_none()
            .max_w(relative(0.92))
            .px(u(7.))
            .py(u(5.))
            .rounded(u(8.))
            .bg(theme::alpha(t.text, 0.06))
            .text_size(u(8.5))
            .line_height(u(12.))
    };
    placed(s, PHONE)
        .flex()
        .flex_col()
        .pt(u(22.))
        .px(u(8.))
        .pb(u(10.))
        .gap(u(6.))
        .overflow_hidden()
        .border(u(1.5))
        .border_color(t.border_strong)
        .rounded(u(22.))
        .bg(t.panel_raised)
        .shadow(vec![shadow(t.shadow, s, 18., 36., -20.)])
        .child(
            h_flex()
                .absolute()
                .top(u(8.))
                .left_0()
                .right_0()
                .justify_center()
                .child(div().w(u(30.)).h(u(5.)).rounded(u(3.)).bg(t.border_strong)),
        )
        .child(
            h_flex()
                .flex_none()
                .items_center()
                .gap(u(5.))
                .pb(u(6.))
                .border_b(u(1.))
                .border_color(t.divider)
                .text_size(u(10.))
                .line_height(u(13.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(avatar)
                .child(agent_name),
        )
        .child(
            message(at::LINK)
                .self_end()
                .max_w(relative(0.96))
                .p(u(5.))
                .border(u(1.))
                .border_color(t.border)
                .bg(t.panel_raised)
                .child(link_preview(t, s, name)),
        )
        .child(
            message(at::OPENED)
                .self_start()
                .child(tf("onboarding.value.scene.opened", &[("name", Arg::from(name))])),
        )
        .child(
            message(at::ASK)
                .self_end()
                .bg(mine)
                .text_color(t.canvas)
                .child(tr("onboarding.value.scene.ask")),
        )
        .child(
            message(at::SAVED)
                .self_start()
                .text_color(t.success)
                .child(tr("onboarding.value.scene.saved")),
        )
}

fn link_preview(t: &Theme, s: f32, name: &'static str) -> impl IntoElement + use<> {
    let u = |v: f32| u(s, v);
    let thumb = h_flex()
        .flex_none()
        .w(u(28.))
        .h(u(24.))
        .p(u(4.))
        .items_end()
        .gap(u(2.))
        .rounded(u(4.))
        .bg(theme::alpha(t.text, 0.06))
        .children([(0.4, 0.55), (0.65, 0.75), (0.9, 1.)].map(|(height, opacity)| {
            div()
                .flex_1()
                .h(relative(height))
                .rounded(u(1.))
                .bg(theme::alpha(t.accent, opacity))
        }));
    let text = v_flex()
        .min_w_0()
        .child(
            div()
                .overflow_hidden()
                .text_ellipsis()
                .whitespace_nowrap()
                .text_size(u(8.5))
                .line_height(u(11.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(name),
        )
        .child(
            div()
                .font_family(theme::MONO)
                .text_size(u(7.5))
                .line_height(u(10.))
                .text_color(t.accent_text)
                .whitespace_nowrap()
                .child("puppyone.ai/…"),
        );
    h_flex()
        .items_center()
        .gap(u(6.))
        .min_w_0()
        .child(thumb)
        .child(text)
}
