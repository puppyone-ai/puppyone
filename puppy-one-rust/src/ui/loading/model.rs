//! Pure geometry / light field port. GPUI and the clock live in the adapter.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::OnceLock};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoadingStyle {
    Dither,
    #[default]
    #[serde(other)]
    Rounded,
}
impl LoadingStyle {
    pub const ALL: [Self; 2] = [Self::Rounded, Self::Dither];
    pub fn id(self) -> &'static str {
        match self {
            Self::Rounded => "rounded",
            Self::Dither => "dither",
        }
    }
}
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
    pub dither: Units,
    #[serde(rename = "box")]
    pub box_size: f64,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Light {
    pub base: f64,
    pub peak: f64,
    pub halo: f64,
    pub halo_ink: f64,
    pub width: f64,
    pub angle: f64,
    pub period: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub geometry: HashMap<String, Geometry>,
    pub mark_light: Light,
    pub placeholder_light: Light,
    pub thresholds: Vec<f64>,
    pub fps: f64,
    pub cell: f64,
}
pub fn catalog() -> &'static Catalog {
    static DATA: OnceLock<Catalog> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_value(crate::asset_catalog::data()["loading"].clone())
            .expect("loading catalog")
    })
}
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct Shape {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}
impl Shape {
    pub fn contains(self, x: f64, y: f64) -> bool {
        let (x, y) = (x - self.x, y - self.y);
        if x < 0. || y < 0. || x >= self.width || y >= self.height {
            return false;
        }
        let r = self
            .radius
            .max(0.)
            .min(self.width / 2.)
            .min(self.height / 2.);
        let over = |p: f64, size: f64| {
            if p < r {
                r - p
            } else if p > size - r {
                p - (size - r)
            } else {
                0.
            }
        };
        let (dx, dy) = (over(x, self.width), over(y, self.height));
        dx * dx + dy * dy <= r * r
    }
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
pub fn dimensions(style: LoadingStyle, size: LoaderSize, layout: Layout) -> (f64, f64) {
    let g = &catalog().geometry[size.id()];
    match (style, layout) {
        (LoadingStyle::Rounded, Layout::Area) => (g.box_size * 1.27, g.box_size),
        _ => {
            let u = if style == LoadingStyle::Dither {
                g.dither
            } else {
                g.relay
            };
            (u.unit * 3. + u.gap * 2., u.unit)
        }
    }
}
pub fn mark_shapes(
    style: LoadingStyle,
    size: LoaderSize,
    layout: Layout,
    time: f64,
    still: bool,
) -> Vec<Dot> {
    let g = &catalog().geometry[size.id()];
    let (w, h) = dimensions(style, size, layout);
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
    match (style, layout) {
        (LoadingStyle::Dither, _) => (0..3)
            .map(|i| dot(i as f64 * (g.dither.unit + g.dither.gap), 0., h, 0., 1.))
            .collect(),
        (LoadingStyle::Rounded, Layout::Area) => {
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
        (LoadingStyle::Rounded, Layout::Inline) => {
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
pub fn dither_alpha(
    cols: usize,
    rows: usize,
    mask: &[bool],
    light: Light,
    time: Option<f64>,
    alpha: u8,
) -> Vec<u8> {
    let (ux, uy) = (
        light.angle.to_radians().cos(),
        light.angle.to_radians().sin(),
    );
    let centre = time.map(|t| {
        let p = t.rem_euclid(light.period) / light.period;
        let eased = p * p * (3. - 2. * p);
        -light.width * 2.
            + eased * (cols as f64 * ux.abs() + rows as f64 * uy.abs() + light.width * 4.)
    });
    (0..cols * rows)
        .map(|i| {
            let (x, y) = (i % cols, i / cols);
            let lit = centre.map_or(0., |c| {
                (-((x as f64 * ux + y as f64 * uy - c) / light.width).powi(2)).exp()
            });
            let density = if mask[i] {
                light.base + light.peak * lit
            } else {
                light.halo * lit * lit
            };
            if density > catalog().thresholds[(y & 7) * 8 + (x & 7)] {
                if mask[i] {
                    alpha
                } else {
                    (alpha as f64 * light.halo_ink).round() as u8
                }
            } else {
                0
            }
        })
        .collect()
}
pub fn mask(cols: usize, rows: usize, shapes: &[Shape]) -> Vec<bool> {
    (0..cols * rows)
        .map(|i| {
            shapes
                .iter()
                .any(|s| s.contains((i % cols) as f64 + 0.5, (i / cols) as f64 + 0.5))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_typescript_dither_frames_match_byte_for_byte() {
        #[derive(Deserialize)]
        struct Case {
            cols: usize,
            rows: usize,
            shapes: Vec<Shape>,
            light: Light,
            time: Option<f64>,
            alpha: Vec<u8>,
        }
        #[derive(Deserialize)]
        struct Cases {
            cases: Vec<Case>,
        }
        let cases: Cases =
            serde_json::from_str(include_str!("../../../fixtures/ui/dither-oracle.json")).unwrap();
        for c in cases.cases {
            assert_eq!(
                dither_alpha(
                    c.cols,
                    c.rows,
                    &mask(c.cols, c.rows, &c.shapes),
                    c.light,
                    c.time,
                    137
                ),
                c.alpha
            );
        }
    }
    #[test]
    fn rounded_keyframes_and_reduced_motion_keep_the_product_figures() {
        let relay = |t| {
            mark_shapes(
                LoadingStyle::Rounded,
                LoaderSize::Sm,
                Layout::Inline,
                t,
                false,
            )
        };
        assert!((relay(0.36)[3].shape.width - 11.).abs() < 1e-8);
        assert!((relay(0.63)[3].shape.x - 7.).abs() < 1e-8);
        assert!((relay(1.5)[3].shape.x - 14.).abs() < 1e-8);
        assert!((relay(3.)[3].shape.x).abs() < 1e-8);
        let gather = mark_shapes(
            LoadingStyle::Rounded,
            LoaderSize::Md,
            Layout::Area,
            0.9,
            false,
        );
        assert_eq!(gather[0].shape.x, gather[2].shape.x);
        let still = mark_shapes(
            LoadingStyle::Rounded,
            LoaderSize::Md,
            Layout::Area,
            0.9,
            true,
        );
        assert!(still[0].shape.x < still[1].shape.x && still[1].shape.x < still[2].shape.x);
        assert_eq!(still[0].opacity, 1.);
    }
}
