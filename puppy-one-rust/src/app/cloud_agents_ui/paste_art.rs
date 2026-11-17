//! `AgentPasteDrawing`: pasting, drawn rather than built. A copied prompt
//! drops into an Agent's chat with the paste keys, becomes its message, and
//! the Agent answers with a tick. Nothing in it is a control or a word to
//! read; it loops like a GIF, showing another Agent each pass, and a person
//! who asked for less motion sees only the answered chat.
use super::*;

const SIZE: f32 = 168.;
/// `--paste-loop`.
const LOOP: Duration = Duration::from_millis(5000);
/// The Agents the drawing shows in turn, one on each pass.
const DRAWN: [&str; 4] = ["claude", "codex", "cursor", "gemini"];

/// The value at `p` of keyframes `(at, value)`, held before the first and
/// after the last.
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
                va + (vb - va) * (p - a) / (b - a)
            } else {
                vb
            };
        }
    }
    keys.last().map_or(0., |k| k.1)
}
/// Each part at `p` of the loop; `None` is the resting frame, the chat
/// answered with a tick.
struct Frame {
    sheet: (f32, f32, f32),
    key: f32,
    out: f32,
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
            frame(p, &[(0., 12.), (0.08, 0.), (0.26, 0.), (0.36, -36.)]),
            frame(p, &[(0., -10.), (0.08, 0.), (0.26, 0.), (0.36, 70.)]),
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

fn line(color: Rgba, width: Option<f32>, height: f32) -> Div {
    div()
        .h(px(height))
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
    let surface = t.menu_bg;
    let quiet = theme::alpha(t.text, 0.18);
    let brand = agent_brands::get(agent);
    let shadow = |weight: f32| {
        vec![BoxShadow {
            color: theme::alpha(t.shadow, weight).into(),
            offset: point(px(0.), px(6.)),
            blur_radius: px(16.),
            spread_radius: px(-6.),
            inset: false,
        }]
    };
    let card =
        v_flex()
            .absolute()
            .left(px(16.))
            .top(px(44.))
            .w(px(SIZE - 32.))
            .h(px(SIZE - 60.))
            .gap(px(8.))
            .p(px(10.))
            .rounded(px(10.))
            .bg(surface)
            .shadow(shadow(0.45))
            .child(
                h_flex()
                    .gap(px(6.))
                    .items_center()
                    .child(
                        div()
                            .size(px(18.))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .overflow_hidden()
                            .bg(theme::alpha(t.text, 0.08))
                            .children(brand.map(|b| agent_brands::image(b, t.dark, 18. * 0.7))),
                    )
                    .child(line(quiet, Some(46.), 5.)),
            )
            .child(
                h_flex().justify_end().child(
                    v_flex()
                        .w(px((SIZE - 52.) * 0.64))
                        .items_end()
                        .gap(px(4.))
                        .px(px(8.))
                        .py(px(7.))
                        .rounded(px(8.))
                        .bg(theme::alpha(t.accent, 0.30))
                        .opacity(f.out)
                        .child(line(theme::mix(t.accent, surface, 0.7), None, 5.))
                        .child(line(theme::mix(t.accent, surface, 0.7), Some(34.), 5.)),
                ),
            )
            .child(
                h_flex().child(
                    div()
                        .relative()
                        .top(px(f.answer.1))
                        .min_w(px(30.))
                        .h(px(20.))
                        .px(px(8.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(8.))
                        .bg(theme::alpha(t.success, 0.18))
                        .opacity(f.answer.0)
                        .child(h_flex().absolute().gap(px(3.)).opacity(f.dots).children(
                            (0..3).map(|_| div().size(px(4.)).rounded_full().bg(t.muted)),
                        ))
                        .child(
                            div()
                                .opacity(f.tick)
                                .text_color(t.success)
                                .child(Icon::new("check").with_size(px(12.)).stroke(3.)),
                        ),
                ),
            );
    let sheet = v_flex()
        .absolute()
        .top(px(12. + f.sheet.2))
        .right(px(14. - f.sheet.1))
        .w(px(70.))
        .gap(px(4.))
        .p(px(8.))
        .rounded(px(7.))
        .border_1()
        .border_color(theme::alpha(t.accent, 0.45))
        .bg(surface)
        .shadow(shadow(0.5))
        .opacity(f.sheet.0)
        .child(line(theme::mix(t.accent, surface, 0.55), None, 4.))
        .child(line(theme::mix(t.accent, surface, 0.55), None, 4.))
        .child(line(theme::mix(t.accent, surface, 0.55), Some(30.), 4.));
    let key = div()
        .absolute()
        .top(px(50.))
        .right(px(10.))
        .px(px(6.))
        .py(px(2.))
        .rounded(px(5.))
        .bg(t.text)
        .text_color(surface)
        .text_size(px(theme::ty().ui.micro))
        .line_height(px(16.))
        .font_weight(FontWeight::SEMIBOLD)
        .opacity(f.key)
        .child(tr(if cfg!(target_os = "macos") {
            "cloud.share.agent.invite.scene.pasteMac"
        } else {
            "cloud.share.agent.invite.scene.pasteOther"
        }));
    div()
        .relative()
        .size(px(SIZE))
        .flex_none()
        .overflow_hidden()
        .rounded(px(14.))
        .bg(theme::mix(t.accent, surface, 0.08))
        .child(card)
        .child(sheet)
        .child(key)
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
                d.child(scene(Some(p), DRAWN[pass % DRAWN.len()], t))
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
        assert_eq!(frame(0.5, &[(0., 0.), (1., 10.)]), 5.);
        assert_eq!(frame(0.2, &[(0.3, 1.), (0.5, 0.)]), 1.);
        assert_eq!(frame(0.9, &[(0.3, 1.), (0.5, 0.)]), 0.);
        let pasting = at(Some(0.2));
        assert!(pasting.sheet.0 == 1. && pasting.key == 1. && pasting.out == 0.);
        let answered = at(Some(0.8));
        assert!(answered.tick == 1. && answered.dots == 0. && answered.out == 1.);
        let still = at(None);
        assert!(still.tick == 1. && still.sheet.0 == 0. && still.key == 0.);
    }
}
