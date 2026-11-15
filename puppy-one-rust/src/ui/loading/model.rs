//! Pure rounded relay / breathing geometry port. GPUI and the clock live in the adapter.
use serde::Deserialize;
use std::{collections::HashMap, sync::OnceLock};

#[derive(Clone, Copy, Default)]
pub enum LoaderSize {
    Xs,
    #[default]
    Sm,
    Md,
}
impl LoaderSize {
    fn id(self) -> &'static str {
        match self {
            Self::Xs => "xs",
            Self::Sm => "sm",
            Self::Md => "md",
        }
    }
}
#[derive(Clone, Copy, Default)]
pub enum Layout {
    #[default]
    Inline,
    Area,
}
#[derive(Clone, Copy, Deserialize)]
pub struct Units {
    pub unit: f64,
    pub gap: f64,
}
#[derive(Deserialize)]
pub struct Geometry {
    pub relay: Units,
    #[serde(rename = "box")]
    pub box_size: f64,
}
#[derive(Deserialize)]
pub struct Catalog {
    pub geometry: HashMap<String, Geometry>,
}
pub fn catalog() -> &'static Catalog {
    static DATA: OnceLock<Catalog> = OnceLock::new();
    DATA.get_or_init(|| crate::asset_catalog::section("loading"))
}
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct Shape {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Dot {
    pub shape: Shape,
    pub opacity: f64,
}

/// CSS cubic-bezier, inverted in x (not a naive polynomial in progress).
pub fn ease(t: f64, x1: f64, x2: f64) -> f64 {
    let (mut lo, mut hi) = (0., 1.);
    for _ in 0..40 {
        let u = (lo + hi) / 2.;
        let x = 3. * (1. - u) * (1. - u) * u * x1 + 3. * (1. - u) * u * u * x2 + u * u * u;
        if x < t {
            lo = u;
        } else {
            hi = u;
        }
    }
    let u = (lo + hi) / 2.;
    3. * (1. - u) * u * u + u * u * u
}
fn keyframes(time: f64, frames: &[(f64, f64)]) -> f64 {
    let i = frames
        .windows(2)
        .position(|f| time <= f[1].0)
        .unwrap_or(frames.len() - 2);
    let (a, b) = (frames[i], frames[i + 1]);
    let p = ease(((time - a.0) / (b.0 - a.0)).clamp(0., 1.), 0.65, 0.35);
    a.1 + (b.1 - a.1) * p
}
pub fn dimensions(size: LoaderSize, layout: Layout) -> (f64, f64) {
    let g = &catalog().geometry[size.id()];
    match layout {
        Layout::Area => (g.box_size * 1.27, g.box_size),
        Layout::Inline => (g.relay.unit * 3. + g.relay.gap * 2., g.relay.unit),
    }
}
pub fn mark_shapes(size: LoaderSize, layout: Layout, time: f64, still: bool) -> Vec<Dot> {
    let g = &catalog().geometry[size.id()];
    let (w, h) = dimensions(size, layout);
    let dot = |x, y, d, r, opacity| Dot {
        shape: Shape {
            x,
            y,
            width: d,
            height: d,
            radius: r,
        },
        opacity,
    };
    match layout {
        Layout::Area => {
            let p = if still {
                0.
            } else {
                keyframes(
                    time.rem_euclid(1.8) / 1.8,
                    &[
                        (0., 0.),
                        (0.12, 0.),
                        (0.42, 1.),
                        (0.58, 1.),
                        (0.88, 0.),
                        (1., 0.),
                    ],
                )
            };
            let d = h * 0.27 * (1. + 0.35 * p);
            (0..3)
                .map(|i| {
                    dot(
                        (w - d) / 2. + (i as f64 - 1.) * h * 0.5 * (1. - p),
                        (h - d) / 2.,
                        d,
                        d / 2.,
                        if still { 1. } else { 0.9 + 0.1 * p },
                    )
                })
                .collect()
        }
        Layout::Inline => {
            let u = g.relay;
            let mut dots: Vec<_> = (0..3)
                .map(|i| dot(i as f64 * (u.unit + u.gap), 0., h, h / 2., 0.22))
                .collect();
            let p = if still {
                0.
            } else {
                let p = time.rem_euclid(3.) / 1.5;
                if p > 1. { 2. - p } else { p }
            };
            let left = keyframes(
                p,
                &[
                    (0., 0.),
                    (0.06, 0.),
                    (0.24, 0.),
                    (0.42, 1.),
                    (0.52, 1.),
                    (0.70, 1.),
                    (0.88, 2.),
                    (1., 2.),
                ],
            ) * (u.unit + u.gap);
            let width = keyframes(
                p,
                &[
                    (0., 0.),
                    (0.06, 0.),
                    (0.24, 1.),
                    (0.42, 0.),
                    (0.52, 0.),
                    (0.70, 1.),
                    (0.88, 0.),
                    (1., 0.),
                ],
            ) * (u.unit + u.gap)
                + u.unit;
            dots.push(Dot {
                shape: Shape {
                    x: left,
                    y: 0.,
                    width,
                    height: h,
                    radius: h / 2.,
                },
                opacity: 1.,
            });
            dots
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rounded_keyframes_and_reduced_motion_keep_the_product_figures() {
        let relay = |t| mark_shapes(LoaderSize::Sm, Layout::Inline, t, false);
        assert!((relay(0.36)[3].shape.width - 11.).abs() < 1e-8);
        assert!((relay(0.63)[3].shape.x - 7.).abs() < 1e-8);
        assert!((relay(1.5)[3].shape.x - 14.).abs() < 1e-8);
        assert!((relay(3.)[3].shape.x).abs() < 1e-8);
        let gather = mark_shapes(LoaderSize::Md, Layout::Area, 0.9, false);
        assert_eq!(gather[0].shape.x, gather[2].shape.x);
        let still = mark_shapes(LoaderSize::Md, Layout::Area, 0.9, true);
        assert!(still[0].shape.x < still[1].shape.x && still[1].shape.x < still[2].shape.x);
        assert_eq!(still[0].opacity, 1.);
    }
}
