//! `OnboardingValueHub` and `onboarding-value-hub.css`: the person's files in
//! one pile in the middle, the Agents they use drifting around them on two
//! loose orbits.
use super::{Layout, paint};
use crate::localization::t as tr;
use crate::theme::{self, Theme};
use crate::ui::agent_brands;
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;

/// `HUB_AGENTS`: an odd number on two loose orbits, each its own size.
/// Angle in degrees from the right; radius and size as shares of the side.
const AGENTS: [(&str, f32, f32, f32); 7] = [
    ("chatgpt", -90., 44., 13.),
    ("claude", -36., 36., 12.),
    ("cursor", 14., 45., 10.5),
    ("gemini", 64., 37., 11.5),
    ("github-copilot", 116., 45., 10.5),
    ("manus", 166., 36., 11.5),
    ("devin", 216., 44., 10.5),
];
/// The pile's drawing (`.onboarding-value-files`), zoomed with the picture.
const PILE: (f32, f32) = (142., 126.);
const CARD: (f32, f32) = (100., 74.);

/// One frame of the picture; `time` is the endless motion's clock (`None`:
/// at rest, with no turn or drift).
pub(super) fn scene(t: &Theme, layout: Layout, time: Option<f32>) -> AnyElement {
    let side = layout.hub;
    let (inner, outer) = (
        theme::mix(t.accent, t.border, 0.28),
        theme::mix(t.accent, t.border, 0.16),
    );
    // `onboarding-value-hub-turn`: once round in 120s.
    let turn = time.map_or(0., |s| (s / 120.).fract() * std::f32::consts::TAU);
    let orbits = paint::paint(move |bounds, window| {
        let center = bounds.center();
        for (radius, color) in [(0.365, inner), (0.445, outer)] {
            paint::dashed_ring(window, center, side * radius, [2., 5.], 1., turn - std::f32::consts::FRAC_PI_2, color);
        }
    });
    let pile = self::pile(t, layout.scale * 1.25);
    let center = v_flex()
        .absolute()
        .inset_0()
        .items_center()
        .justify_center()
        .child(
            v_flex()
                .items_center()
                .gap(px(12.))
                .child(pile)
                .child(
                    div()
                        .text_color(t.accent_text)
                        .text_size(px(theme::ty().ui.caption))
                        .line_height(px(16.))
                        .font_weight(FontWeight::MEDIUM)
                        .whitespace_nowrap()
                        .child(tr("onboarding.value.center")),
                ),
        );
    let agents = AGENTS.iter().enumerate().map(|(index, &(id, angle, radius, size))| {
        let radians = angle.to_radians();
        let (x, y) = (50. + radius * radians.cos(), 50. + radius * radians.sin());
        let diameter = side * size / 100.;
        // `onboarding-value-agent-drift`: 6s ease-in-out, alternating between
        // -2px and 3px, each Agent 0.9s behind the one before.
        let drift = time.map_or(0., |s| {
            let phase = ((s + index as f32 * 0.9) / 6.).rem_euclid(2.);
            let k = crate::ui::motion::ease_in_out(if phase < 1. { phase } else { 2. - phase });
            -2. + 5. * k
        });
        let mark: AnyElement = match agent_brands::get(id) {
            Some(brand) if brand.id == "chatgpt" => svg()
                .path("agents/chatgpt-mark.svg")
                .size(px(diameter * 0.52))
                .text_color(t.text)
                .into_any_element(),
            Some(brand) => agent_brands::image(brand, t.dark, diameter * 0.52).into_any_element(),
            None => div().into_any_element(),
        };
        div()
            .absolute()
            .left(px(side * x / 100. - diameter / 2.))
            .top(px(side * y / 100. - diameter / 2. + drift))
            .size(px(diameter))
            .rounded_full()
            .bg(t.panel_raised)
            .shadow(vec![
                BoxShadow {
                    color: t.border.into(),
                    offset: point(px(0.), px(0.)),
                    blur_radius: px(0.),
                    spread_radius: px(1.),
                    inset: false,
                },
                BoxShadow {
                    color: t.shadow.into(),
                    offset: point(px(0.), px(6.)),
                    blur_radius: px(14.),
                    spread_radius: px(-8.),
                    inset: false,
                },
            ])
            .flex()
            .items_center()
            .justify_center()
            .child(mark)
    });
    div()
        .relative()
        .size(px(side))
        .child(div().absolute().inset_0().child(orbits))
        .child(center)
        .children(agents)
        .into_any_element()
}

/// `.onboarding-value-files`: back to front the folder, CSV, MD and HTML, each
/// a step up and to the right of the one before, so every kind shows its tag.
fn pile(t: &Theme, z: f32) -> impl IntoElement {
    let u = |v: f32| paint::u(z, v);
    let line = theme::alpha(t.text, 0.13);
    let card = |left: f32, top: f32, accent: Rgba, tag: SharedString, ground: Rgba| {
        div()
            .absolute()
            .left(u(left))
            .top(u(top))
            .w(u(CARD.0))
            .h(u(CARD.1))
            .pt(u(20.))
            .px(u(9.))
            .pb(u(9.))
            .flex()
            .flex_col()
            .gap(u(5.))
            .border_1()
            .border_color(t.border)
            .rounded(u(7.))
            .bg(ground)
            .shadow(vec![BoxShadow {
                color: t.shadow.into(),
                offset: point(px(0.), u(8.)),
                blur_radius: u(18.),
                spread_radius: u(-12.),
                inset: false,
            }])
            .child(
                div()
                    .absolute()
                    .top(u(3.))
                    .right(u(6.))
                    .px(u(4.))
                    .py(u(2.))
                    .rounded(u(3.))
                    .bg(accent)
                    .text_color(t.text_inverse)
                    .text_size(u(7.5))
                    .line_height(u(7.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .whitespace_nowrap()
                    .child(tag),
            )
    };
    let bar = |width: Option<f32>, height: f32, color: Rgba| {
        div()
            .h(u(height))
            .flex_none()
            .rounded(u(2.))
            .bg(color)
            .map(|d| match width {
                Some(w) => d.w(relative(w)),
                None => d.w_full(),
            })
    };
    let folder_ground = theme::mix(t.text, t.panel_raised, 0.06);
    let folder = card(42., 9., theme::alpha(t.text, 0.55), tr("onboarding.value.folder").into(), folder_ground)
        .rounded_tl(px(0.))
        // The tab (`.is-folder::before`).
        .child(
            div()
                .absolute()
                .top(u(-9.))
                .left(u(-1.))
                .w(u(36.))
                .h(u(9.))
                .border_1()
                .border_b_0()
                .border_color(t.border)
                .rounded_tl(u(4.))
                .rounded_tr(u(6.))
                .bg(folder_ground),
        );
    let sheet = card(28., 23., t.file.sheet, "CSV".into(), t.panel_raised).child(
        div().grid().grid_cols(3).gap(u(2.)).children((0..9).map(|cell| {
            div().h(u(7.)).rounded(u(1.)).bg(theme::alpha(
                t.file.sheet,
                if cell < 3 { 0.4 } else { 0.14 },
            ))
        })),
    );
    let markdown = card(14., 37., t.file.markdown, "MD".into(), t.panel_raised)
        .child(bar(Some(0.6), 5., theme::alpha(t.text, 0.6)))
        .child(bar(None, 4., line))
        .child(bar(None, 4., line))
        .child(bar(Some(0.55), 4., line));
    let accent = t.accent;
    let html = card(0., 51., t.file.html, "HTML".into(), t.panel_raised)
        .shadow(vec![
            BoxShadow {
                color: theme::alpha(t.accent, 0.09).into(),
                offset: point(px(0.), px(0.)),
                blur_radius: px(0.),
                spread_radius: u(6.),
                inset: false,
            },
            BoxShadow {
                color: t.shadow.into(),
                offset: point(px(0.), u(12.)),
                blur_radius: u(24.),
                spread_radius: u(-12.),
                inset: false,
            },
        ])
        .child(bar(None, 8., theme::mix(t.file.html, t.text, 0.75)))
        .child(
            div()
                .h(u(24.))
                .flex()
                .items_end()
                .gap(u(5.))
                .pl(u(2.))
                .pr(u(30.))
                .children([(0.45, 0.55), (0.7, 0.75), (0.95, 1.)].map(|(height, opacity)| {
                    div()
                        .flex_1()
                        .h(relative(height))
                        .rounded_t(u(2.))
                        .bg(theme::alpha(accent, opacity))
                })),
        );
    div()
        .relative()
        .w(u(PILE.0))
        .h(u(PILE.1))
        .child(folder)
        .child(sheet)
        .child(markdown)
        .child(html)
}
