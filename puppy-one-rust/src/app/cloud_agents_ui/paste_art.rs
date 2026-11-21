//! `AgentPasteDrawing`: what to do with the message, drawn rather than built.
//! It stands beside the message, in the same card: a copy of the message
//! slides in from the message's side with the paste keys, becomes the
//! Agent's message, and the Agent answers with a tick. It explains and never
//! asks for anything: no words, nothing to press. It loops like a GIF,
//! showing another Agent each pass, and a person who asked for less motion
//! sees only the answered chat.
use super::*;

/// The picture's column in the invite card.
pub(super) const WIDTH: f32 = 128.;
/// The drawn scene, centred in the card's height.
const HEIGHT: f32 = 124.;
/// `--loop`.
const LOOP: Duration = Duration::from_millis(5000);
/// The Agents the drawing shows in turn, one on each pass.
const DRAWN: [&str; 4] = ["claude", "codex", "cursor", "gemini"];

/// The value at `p` of keyframes `(at, value)`, held before the first and
/// after the last, eased between them as CSS's `ease` is.
fn frame(p: f32, keys: &[(f32, f32)]) -> f32 {
    let Some(first) = keys.first() else {
        return 0.;
    };
    if p <= first.0 {
        return first.1;
    }
    for pair in keys.windows(2) {
        let ((a, va), (b, vb)) = (pair[0], pair[1]);
        if p <= b {
            return if b > a {
                va + (vb - va) * ease((p - a) / (b - a))
            } else {
                vb
            };
        }
    }
    keys.last().map_or(0., |k| k.1)
}
/// `cubic-bezier(.25, .1, .25, 1)`, solved for x by bisection.
fn ease(x: f32) -> f32 {
    let bezier = |t: f32, a: f32, b: f32| {
        3. * (1. - t).powi(2) * t * a + 3. * (1. - t) * t * t * b + t.powi(3)
    };
    let (mut lo, mut hi) = (0f32, 1f32);
    for _ in 0..20 {
        let mid = (lo + hi) / 2.;
        if bezier(mid, 0.25, 0.25) < x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    bezier((lo + hi) / 2., 0.1, 1.)
}
/// Each part at `p` of the loop; `None` is the resting frame, the chat
/// answered with a tick.
struct Frame {
    /// The copied message: opacity, x and y offsets.
    sheet: (f32, f32, f32),
    key: f32,
    out: f32,
    /// The answer: opacity and its rise.
    answer: (f32, f32),
    dots: f32,
    tick: f32,
}
fn at(p: Option<f32>) -> Frame {
    let Some(p) = p else {
        return Frame {
            sheet: (0., 0., 0.),
            key: 0.,
            out: 1.,
            answer: (1., 0.),
            dots: 0.,
            tick: 1.,
        };
    };
    Frame {
        sheet: (
            frame(p, &[(0., 0.), (0.08, 1.), (0.26, 1.), (0.36, 0.)]),
            frame(p, &[(0., -26.), (0.08, 0.), (0.26, 0.), (0.36, 34.)]),
            frame(p, &[(0.26, 0.), (0.36, -16.)]),
        ),
        key: frame(p, &[(0.12, 0.), (0.16, 1.), (0.28, 1.), (0.33, 0.)]),
        out: frame(p, &[(0.32, 0.), (0.38, 1.), (0.90, 1.), (0.97, 0.)]),
        answer: (
            frame(p, &[(0.44, 0.), (0.50, 1.), (0.90, 1.), (0.97, 0.)]),
            frame(p, &[(0.44, 4.), (0.50, 0.)]),
        ),
        dots: frame(p, &[(0.46, 1.), (0.58, 0.)]),
        tick: frame(p, &[(0.58, 0.), (0.64, 1.)]),
    }
}

fn line(color: Rgba, width: Option<f32>) -> Div {
    div()
        .h(px(4.))
        .rounded(px(3.))
        .bg(color)
        .map(|d| match width {
            Some(width) => d.w(px(width)),
            None => d.w_full(),
        })
}
/// The drawing at `p` of its loop, with `agent` in the chat.
fn scene(p: Option<f32>, agent: &str, t: Theme) -> Div {
    let f = at(p);
    // A card a step darker than the invite card it sits in.
    let surface = theme::mix(t.inset, t.overlay, 0.45);
    let quiet = theme::alpha(t.text, 0.16);
    let ink = theme::mix(t.accent, surface, 0.5);
    let shadow = |weight: f32, y: f32, blur: f32, spread: f32| BoxShadow {
        color: theme::alpha(t.shadow, weight).into(),
        offset: point(px(0.), px(y)),
        blur_radius: px(blur),
        spread_radius: px(spread),
        inset: false,
    };
    let brand = agent_brands::get(agent);
    let chat =
        v_flex()
            .absolute()
            .left(px(36.))
            .top(px(HEIGHT / 2. - 46.))
            .w(px(80.))
            .h(px(92.))
            .gap(px(7.))
            .p(px(8.))
            .rounded(px(9.))
            .bg(surface)
            .shadow(vec![shadow(1.3, 6., 16., -6.)])
            .child(
                h_flex()
                    .gap(px(5.))
                    .items_center()
                    .child(
                        div()
                            .size(px(16.))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .bg(theme::alpha(t.text, 0.08))
                            .children(brand.map(|b| agent_brands::image(b, t.dark, 11.))),
                    )
                    .child(line(quiet, Some(34.))),
            )
            .child(
                h_flex().justify_end().child(
                    v_flex()
                        .w(px(48.))
                        .items_end()
                        .gap(px(3.))
                        .px(px(7.))
                        .py(px(6.))
                        .rounded(px(7.))
                        .bg(theme::alpha(t.accent, 0.30))
                        .opacity(f.out)
                        .child(line(ink, None))
                        .child(line(ink, Some(22.))),
                ),
            )
            .child(
                h_flex().child(
                    div()
                        .relative()
                        .top(px(f.answer.1))
                        .w(px(28.))
                        .h(px(18.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(7.))
                        .bg(theme::alpha(t.success, 0.18))
                        .opacity(f.answer.0)
                        .child(h_flex().absolute().gap(px(3.)).opacity(f.dots).children(
                            (0..3).map(|_| div().size(px(3.5)).rounded_full().bg(t.muted)),
                        ))
                        .child(
                            div()
                                .opacity(f.tick)
                                .text_color(t.success)
                                .child(Icon::new("check").with_size(px(11.)).stroke(3.2)),
                        ),
                ),
            );
    let sheet = v_flex()
        .absolute()
        .left(px(10. + f.sheet.1))
        .top(px(HEIGHT / 2. + 2. + f.sheet.2))
        .w(px(46.))
        .gap(px(3.))
        .p(px(6.))
        .rounded(px(6.))
        .border_1()
        .border_color(theme::alpha(t.accent, 0.45))
        .bg(surface)
        .shadow(vec![shadow(1.3, 6., 14., -4.)])
        .opacity(f.sheet.0)
        .child(line(ink, None))
        .child(line(ink, None))
        .child(line(ink, Some(20.)));
    let key = div()
        .absolute()
        .left(px(12.))
        .top(px(HEIGHT / 2. - 22.))
        .h(px(18.))
        .px(px(5.))
        .flex()
        .items_center()
        .rounded(px(5.))
        .bg(t.text)
        .text_color(surface)
        .text_size(px(theme::ty().ui.micro))
        .line_height(px(18.))
        .font_weight(FontWeight::SEMIBOLD)
        .opacity(f.key)
        .child(tr(
            crate::platform::conventions::Conventions::current().paste_shortcut_key
        ));
    div()
        .relative()
        .w(px(WIDTH))
        .h(px(HEIGHT))
        .flex_none()
        .overflow_hidden()
        .child(chat)
        .child(sheet)
        .child(key)
}
/// The Agent a pass draws: another one each pass.
fn drawn(pass: usize) -> &'static str {
    DRAWN[pass % DRAWN.len()]
}
/// The drawing, playing unless less motion was asked for.
pub(super) fn drawing(t: Theme) -> AnyElement {
    if crate::platform::accessibility::reduce_motion() {
        return scene(None, DRAWN[0], t)
            .debug_selector(|| "cloud-agent-paste-art".into())
            .into_any_element();
    }
    div()
        .debug_selector(|| "cloud-agent-paste-art".into())
        .with_animation(
            "cloud-agent-paste-art",
            Animation::new(LOOP).repeat(),
            move |d, p| {
                let pass = (crate::clock::now_ms() / LOOP.as_millis() as i64) as usize;
                d.child(scene(Some(p), drawn(pass), t))
            },
        )
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// The loop's keyframes, and the still frame for less motion.
    #[test]
    fn the_drawing_ends_each_pass_on_the_answered_chat() {
        assert_eq!(frame(0., &[(0., 0.), (1., 10.)]), 0.);
        assert_eq!(frame(1., &[(0., 0.), (1., 10.)]), 10.);
        // Eased: slow out of the first key, past halfway at the middle.
        assert!(frame(0.5, &[(0., 0.), (1., 10.)]) > 5.);
        assert_eq!(frame(0.2, &[(0.3, 1.), (0.5, 0.)]), 1.);
        assert_eq!(frame(0.9, &[(0.3, 1.), (0.5, 0.)]), 0.);
        let pasting = at(Some(0.2));
        assert!(pasting.sheet.0 == 1. && pasting.key == 1. && pasting.out == 0.);
        let answered = at(Some(0.8));
        assert!(answered.tick == 1. && answered.dots == 0. && answered.out == 1.);
        let still = at(None);
        assert!(still.tick == 1. && still.sheet.0 == 0. && still.key == 0.);
    }

    /// `PasteScene`: a picture of pasting with the paste keys, another Agent
    /// each pass of the drawing.
    #[test]
    fn each_pass_draws_another_agent_pasting_with_the_paste_keys() {
        let passes: Vec<_> = (0..5).map(drawn).collect();
        assert_eq!(passes, ["claude", "codex", "cursor", "gemini", "claude"]);
        assert_eq!(tr("cloud.share.agent.invite.scene.pasteMac"), "⌘V");
        assert_eq!(tr("cloud.share.agent.invite.scene.pasteOther"), "Ctrl+V");
    }
}
