//! `ProjectComputerGlyph` (`features/computer-mode`): Computer Mode's
//! miniature monitor in the folder's own `104 × 78` stage (`34 × 26` in List
//! rows), so cards, names and captions line up with the folders beside
//! them. A Cloud computer's chassis takes the accent; the chin's light says
//! whether it runs, is starting its desktop, or sleeps; up to three of the
//! project's root files stand on its screen, a desktop's outline otherwise.
use super::{
    super::previews::{PreviewKind, ProjectAssetPreview},
    sheet,
};
use crate::{
    theme::{self, Theme},
    ui::{appearance::ActiveAppearance as _, moments::paint},
};
use gpui::{prelude::*, *};

/// Where the computer runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum ComputerKind {
    Cloud,
    OnDevice,
}

/// `ComputerVisualPowerState`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum ComputerPower {
    Running,
    Provisioning,
    Asleep,
}
impl ComputerPower {
    /// `onboarding.computerMode.status.*`.
    pub fn label(self) -> &'static str {
        match self {
            Self::Running => "onboarding.computerMode.status.running",
            Self::Provisioning => "onboarding.computerMode.status.provisioning",
            Self::Asleep => "onboarding.computerMode.status.asleep",
        }
    }
}

/// The monitor's materials in one appearance.
struct Materials {
    neck: Rgba,
    base: Rgba,
    chassis: Rgba,
    chassis_edge: Rgba,
    viewport: Rgba,
    viewport_edge: Rgba,
    chin: Rgba,
    bar: Rgba,
    window: Rgba,
    led: Rgba,
    shadow: Rgba,
}
impl Materials {
    /// `computer-mode.css`, with `--po-surface` read as the panel and a
    /// faded computer mixed into the canvas like a faded folder.
    fn new(kind: ComputerKind, power: ComputerPower, fade: Option<f32>, t: Theme) -> Self {
        let tone = |c: Rgba| fade.map_or(c, |w| theme::mix(c, t.canvas, w));
        let surface = t.panel;
        let cloud = kind == ComputerKind::Cloud;
        let chrome = theme::alpha(t.text, 0.09);
        Self {
            neck: tone(theme::mix(t.text, surface, 0.14)),
            base: tone(theme::mix(t.text, surface, 0.20)),
            chassis: tone(if cloud {
                theme::mix(t.accent, surface, 0.14)
            } else {
                theme::mix(t.text, surface, 0.12)
            }),
            chassis_edge: tone(if cloud {
                theme::mix(t.accent, t.border, 0.28)
            } else {
                theme::alpha(t.text, 0.18)
            }),
            viewport: tone(if power == ComputerPower::Asleep {
                theme::alpha(theme::mix(t.text, t.canvas, 0.18), 0.72)
            } else {
                t.canvas
            }),
            viewport_edge: tone(theme::alpha(t.text, 0.10)),
            chin: tone(theme::alpha(t.text, 0.10)),
            bar: tone(if cloud {
                theme::alpha(t.accent, 0.22)
            } else {
                chrome
            }),
            window: tone(chrome),
            led: tone(match power {
                ComputerPower::Running => theme::computer_led(false),
                ComputerPower::Provisioning => theme::computer_led(true),
                ComputerPower::Asleep => theme::alpha(t.muted, 0.55),
            }),
            shadow: tone(theme::computer_shadow()),
        }
    }
}

#[derive(IntoElement)]
pub(in crate::app::home) struct ProjectComputerGlyph {
    compact: bool,
    kind: ComputerKind,
    power: ComputerPower,
    sheets: Vec<PreviewKind>,
    is_lit: bool,
    fade: Option<f32>,
}

impl ProjectComputerGlyph {
    pub fn grid(
        kind: ComputerKind,
        power: ComputerPower,
        previews: &[ProjectAssetPreview],
    ) -> Self {
        Self {
            compact: false,
            kind,
            power,
            sheets: previews.iter().take(3).map(|p| p.kind).collect(),
            is_lit: false,
            fade: None,
        }
    }

    pub fn compact(
        kind: ComputerKind,
        power: ComputerPower,
        previews: &[ProjectAssetPreview],
    ) -> Self {
        Self {
            compact: true,
            ..Self::grid(kind, power, previews)
        }
    }

    pub fn lit(mut self, is_lit: bool) -> Self {
        self.is_lit = is_lit;
        self
    }

    pub fn fade(mut self, fade: Option<f32>) -> Self {
        self.fade = fade;
        self
    }
}

/// `x, y, w, h, radius` in the `104 × 78` stage.
type Shape = (f32, f32, f32, f32, f32);
const CHASSIS: Shape = (8., 6., 88., 57., 7.);
const VIEWPORT: Shape = (12.5, 10.5, 79., 43., 3.5);
const BASE: Shape = (33., 70., 38., 3.5, 1.75);
/// The chin's rule, drawn as a hairline box.
const CHIN: Shape = (9., 55.075, 86., 0.85, 0.);
/// A desktop's top bar, then its windows and dock.
const BAR: Shape = (17., 15., 24., 3.2, 1.6);
const WINDOWS: [Shape; 3] = [
    (17., 21., 46., 19., 2.5),
    (66., 21., 20., 11., 2.),
    (34., 46.5, 36., 3.5, 1.75),
];
const NECK: [(f32, f32); 4] = [(45., 62.), (59., 62.), (61.5, 70.5), (42.5, 70.5)];
const LED: (f32, f32) = (86.5, 59.2);
/// `.project-computer-preview-deck`: `inset: 14px 16px 24px`, sheets on its
/// floor, centred, `3px` apart.
const DECK: (f32, f32, f32) = (16., 72., 54.);

impl RenderOnce for ProjectComputerGlyph {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let (w, h) = if self.compact {
            super::LIST_FOLDER_SIZE
        } else {
            super::GRID_FOLDER_SIZE
        };
        let m = Materials::new(self.kind, self.power, self.fade, t);
        let desktop = self.sheets.is_empty();
        let led_radius = if self.compact { 2.1 } else { 1.8 };
        let monitor = paint::paint(move |bounds, window| {
            let s = f32::from(bounds.size.width) / 104.;
            let o = bounds.origin;
            let at = |x: f32, y: f32| point(o.x + px(x * s), o.y + px(y * s));
            let shape = |window: &mut Window,
                         (x, y, sw, sh, r): Shape,
                         fill: Rgba,
                         edge: Option<(f32, Rgba)>| {
                paint::turned_rect(
                    window,
                    at(x, y),
                    size(px(sw * s), px(sh * s)),
                    r * s,
                    o,
                    0.,
                    Some(fill),
                    edge.map(|(width, color)| (width * s, color)),
                );
            };
            paint::polygon(window, &NECK.map(|(x, y)| at(x, y)), m.neck);
            shape(window, BASE, m.base, None);
            shape(window, CHASSIS, m.chassis, Some((1.2, m.chassis_edge)));
            shape(window, VIEWPORT, m.viewport, Some((0.9, m.viewport_edge)));
            shape(window, CHIN, m.chin, None);
            if desktop {
                shape(window, BAR, m.bar, None);
                for window_shape in WINDOWS {
                    shape(window, window_shape, m.window, None);
                }
            }
            let (cx_, cy) = LED;
            shape(
                window,
                (
                    cx_ - led_radius,
                    cy - led_radius,
                    led_radius * 2.,
                    led_radius * 2.,
                    led_radius,
                ),
                m.led,
                None,
            );
        });
        // The deck of sheets on a Grid computer's screen.
        let sheets: Vec<Div> = if self.compact {
            vec![]
        } else {
            let paper = sheet::Paper::new(self.fade, t);
            let count = self.sheets.len() as f32;
            let (left, width, floor) = DECK;
            let span = count * 22. + (count - 1.).max(0.) * 3.;
            let start = left + (width - span) / 2.;
            self.sheets
                .iter()
                .enumerate()
                .map(|(i, kind)| {
                    sheet::render_screen_sheet(start + i as f32 * 25., floor - 30., *kind, &paper)
                })
                .collect()
        };
        let (cx0, cy0, cw, ch, cr) = CHASSIS;
        let lift = if self.is_lit { -1.5 } else { 0. };
        let scale = w / 104.;
        div()
            .relative()
            .flex_none()
            .w(px(w))
            .h(px(h))
            .top(px(lift))
            // `filter: drop-shadow(0 3px 8px …)`, cast by the chassis.
            .child(
                div()
                    .absolute()
                    .left(px(cx0 * scale))
                    .top(px(cy0 * scale))
                    .w(px(cw * scale))
                    .h(px(ch * scale))
                    .rounded(px(cr * scale))
                    .shadow(vec![paint::shadow(
                        m.shadow,
                        px(3. * scale),
                        px(8. * scale),
                        px(0.),
                    )]),
            )
            .child(div().absolute().inset_0().child(monitor))
            .children(sheets)
    }
}
