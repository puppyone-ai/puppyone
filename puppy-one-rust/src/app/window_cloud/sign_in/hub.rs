//! `OnboardingValueHub` (`onboarding-value-hub.css`) at dialog scale, with
//! `"Puppyone Cloud"` (`cloud.productName`) as its center label: the user's
//! files in one stacked pile in the middle and seven Agent marks drifting on
//! two loose orbits around them.
use super::{Clock, HUB_SCALE, HUB_SIZE, paint};
use crate::localization::t as tr;
use crate::theme::{self, Theme};
use crate::ui::agent_brands;
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;

struct Orbiting {
    id: &'static str,
    angle: f32,
    radius: f32,
    size: f32,
}

const AGENTS: [Orbiting; 7] = [
    Orbiting { id: "chatgpt", angle: -90., radius: 44., size: 13. },
    Orbiting { id: "claude", angle: -36., radius: 36., size: 12. },
    Orbiting { id: "cursor", angle: 14., radius: 45., size: 10.5 },
    Orbiting { id: "gemini", angle: 64., radius: 37., size: 11.5 },
    Orbiting { id: "github-copilot", angle: 116., radius: 45., size: 10.5 },
    Orbiting { id: "manus", angle: 166., radius: 36., size: 11.5 },
    Orbiting { id: "devin", angle: 216., radius: 44., size: 10.5 },
];

const ORBITS: [(f32, f32); 2] = [(0.365, 0.28), (0.445, 0.16)];
const TURN_SECONDS: f32 = 120.;
const PILE: (f32, f32) = (142., 126.);
const PILE_ZOOM: f32 = 1.25;
const CARD: (f32, f32) = (100., 74.);

pub(super) fn scene(t: &Theme, clock: Clock) -> AnyElement {
    let side = HUB_SIZE;
    let turn = clock
        .motion
        .map_or(0., |s| (s / TURN_SECONDS).fract() * std::f32::consts::TAU);
    let orbits = ORBITS.map(|(radius, accent)| (side * radius, theme::mix(t.accent, t.border, accent)));
    let orbits = paint::paint(move |bounds, window| {
        for (radius, color) in orbits {
            paint::dashed_ring(
                window,
                bounds.center(),
                radius,
                [3., 4.],
                1.,
                turn - 0.5 / radius,
                color,
            );
        }
    });
    let center = v_flex()
        .absolute()
        .inset_0()
        .items_center()
        .justify_center()
        .child(
            v_flex()
                .items_center()
                .gap(px(12.))
                .child(pile(t, HUB_SCALE * PILE_ZOOM))
                .child(
                    div()
                        .text_color(t.accent_text)
                        .text_size(px(theme::ty().ui.caption))
                        .line_height(px(16.))
                        .font_weight(FontWeight::MEDIUM)
                        .whitespace_nowrap()
                        .child(tr("cloud.productName")),
                ),
        );
    div()
        .relative()
        .size(px(side))
        .child(div().absolute().inset_0().child(orbits))
        .child(center)
        .children(
            AGENTS
                .iter()
                .enumerate()
                .map(|(index, agent)| self::agent(t, side, agent, drift(clock.motion, index))),
        )
        .into_any_element()
}

fn drift(motion: Option<f32>, index: usize) -> f32 {
    motion.map_or(0., |s| {
        let phase = ((s + index as f32 * 0.9) / 6.).rem_euclid(2.);
        let k = crate::ui::motion::ease_in_out(if phase < 1. { phase } else { 2. - phase });
        -2. + 5. * k
    })
}

fn agent(t: &Theme, side: f32, agent: &Orbiting, drift: f32) -> impl IntoElement {
    let radians = agent.angle.to_radians();
    let center = (
        side * (0.5 + agent.radius / 100. * radians.cos()),
        side * (0.5 + agent.radius / 100. * radians.sin()),
    );
    let diameter = side * agent.size / 100.;
    let mark = diameter * 0.52;
    let mark: AnyElement = match agent_brands::get(agent.id) {
        Some(brand) if brand.id == "chatgpt" => svg()
            .path("agents/chatgpt-mark.svg")
            .size(px(mark))
            .text_color(t.text)
            .into_any_element(),
        Some(brand) => agent_brands::image(brand, t.dark, mark).into_any_element(),
        None => div().into_any_element(),
    };
    div()
        .absolute()
        .left(px(center.0 - diameter / 2.))
        .top(px(center.1 - diameter / 2. + drift))
        .size(px(diameter))
        .rounded_full()
        .bg(t.panel_raised)
        .shadow(vec![
            paint::ring(t.border, px(1.)),
            paint::shadow(t.shadow, px(6.), px(14.), px(-8.)),
        ])
        .flex()
        .items_center()
        .justify_center()
        .child(mark)
}

#[derive(Clone, Copy)]
enum Kind {
    Folder,
    Sheet,
    Markdown,
    Html,
}

const PILE_CARDS: [(Kind, f32, f32); 4] = [
    (Kind::Folder, 42., 9.),
    (Kind::Sheet, 28., 23.),
    (Kind::Markdown, 14., 37.),
    (Kind::Html, 0., 51.),
];

fn pile(t: &Theme, zoom: f32) -> impl IntoElement {
    let u = |v: f32| paint::u(zoom, v);
    PILE_CARDS.iter().fold(
        div().relative().w(u(PILE.0)).h(u(PILE.1)),
        |pile, &(kind, left, top)| pile.child(card(t, zoom, kind).left(u(left)).top(u(top))),
    )
}

fn card(t: &Theme, zoom: f32, kind: Kind) -> Div {
    let u = |v: f32| paint::u(zoom, v);
    let (tag, accent): (SharedString, Rgba) = match kind {
        Kind::Folder => (
            tr("onboarding.value.folder").into(),
            theme::alpha(t.text, 0.55),
        ),
        Kind::Sheet => ("CSV".into(), t.file.sheet),
        Kind::Markdown => ("MD".into(), t.file.markdown),
        Kind::Html => ("HTML".into(), t.file.html),
    };
    let ground = match kind {
        Kind::Folder => theme::mix(t.text, t.panel_raised, 0.06),
        _ => t.panel_raised,
    };
    let lift = paint::shadow(t.shadow, u(8.), u(18.), u(-12.));
    let shadows = match kind {
        Kind::Html => vec![
            paint::ring(theme::alpha(t.accent, 0.09), u(6.)),
            paint::shadow(t.shadow, u(12.), u(24.), u(-12.)),
        ],
        _ => vec![lift],
    };
    let card = div()
        .absolute()
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
        .shadow(shadows)
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
        );
    let line = |width: f32, height: f32, color: Rgba| {
        div()
            .w(relative(width))
            .h(u(height))
            .flex_none()
            .rounded(u(2.))
            .bg(color)
    };
    let text = theme::alpha(t.text, 0.13);
    match kind {
        Kind::Folder => card.rounded_tl(px(0.)).child(
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
                .bg(ground),
        ),
        Kind::Sheet => card.child(div().grid().grid_cols(3).gap(u(2.)).children((0..9).map(
            |cell| {
                let weight = if cell < 3 { 0.4 } else { 0.14 };
                div()
                    .h(u(7.))
                    .rounded(u(1.))
                    .bg(theme::alpha(t.file.sheet, weight))
            },
        ))),
        Kind::Markdown => card
            .child(line(0.6, 5., theme::alpha(t.text, 0.6)))
            .child(line(1., 4., text))
            .child(line(1., 4., text))
            .child(line(0.55, 4., text)),
        Kind::Html => card
            .child(line(1., 8., theme::mix(t.file.html, t.text, 0.75)))
            .child(
                div()
                    .h(u(24.))
                    .flex()
                    .items_end()
                    .gap(u(5.))
                    .pl(u(2.))
                    .pr(u(30.))
                    .children([(0.45, 0.55), (0.7, 0.75), (0.95, 1.)].map(|(height, weight)| {
                        div()
                            .flex_1()
                            .h(relative(height))
                            .rounded_t(u(2.))
                            .bg(theme::alpha(t.accent, weight))
                    })),
            ),
    }
}
