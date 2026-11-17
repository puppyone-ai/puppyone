//! `AgentCreature`: an Agent with no brand of its own, drawn as a small
//! creature — a body of its own shape and colour, and two eyes. The same
//! name always makes the same creature, so an Agent looks like itself in the
//! Header, its card and the Agents dialog, and across reconnecting. It is
//! awake, eyes open, only while it works; at rest it sleeps.
//!
//! The drawing is the product's SVG, built here from the same geometry and
//! drawn as an image, so the body, its edge and its eyes keep their colours.
use crate::theme;
use gpui::*;
use std::{collections::HashMap, fmt::Write as _, sync::Arc};

type Point = (f64, f64);
enum Part {
    Circle(f64, f64, f64),
    Path(String),
}

const EYES: [Point; 2] = [(44., 47.), (60., 47.)];

/// The point `distance` along the edge from `from` toward `to`, never past
/// its middle.
fn toward((fx, fy): Point, (tx, ty): Point, distance: f64) -> Point {
    let length = (tx - fx).hypot(ty - fy);
    let step = distance.min(length / 2.) / length;
    (fx + (tx - fx) * step, fy + (ty - fy) * step)
}
/// A polygon whose corners are rounded, so every body reads as soft.
fn rounded_polygon(points: &[Point], radius: f64) -> String {
    let format = |(x, y): Point| format!("{x:.2} {y:.2}");
    let n = points.len();
    let mut path = String::new();
    for (index, corner) in points.iter().enumerate() {
        let before = toward(*corner, points[(index + n - 1) % n], radius);
        let after = toward(*corner, points[(index + 1) % n], radius);
        let _ = write!(
            path,
            "{}{} Q{} {}",
            if index == 0 { "M" } else { " L" },
            format(before),
            format(*corner),
            format(after)
        );
    }
    path + " Z"
}
/// Corners around the middle, alternating between the given radii, starting
/// straight up when `turn` is 0.
fn ring(count: usize, radii: &[f64], turn: f64, centre: Point) -> Vec<Point> {
    (0..count)
        .map(|index| {
            let angle = (index as f64 / count as f64) * std::f64::consts::TAU
                - std::f64::consts::FRAC_PI_2
                + turn;
            let radius = radii[index % radii.len()];
            (
                centre.0 + angle.cos() * radius,
                centre.1 + angle.sin() * radius,
            )
        })
        .collect()
}
/// The bodies, each kept 6 units inside the frame so the edge drawn around
/// it is never cut.
fn body(index: usize) -> Vec<Part> {
    use Part::*;
    match index {
        0 => vec![Circle(50., 52., 43.)],
        1 => vec![Path(rounded_polygon(
            &ring(6, &[45.], std::f64::consts::PI / 6., (50., 52.)),
            13.,
        ))],
        2 => vec![Path(rounded_polygon(
            &ring(8, &[46., 31.], 0., (50., 50.)),
            15.,
        ))],
        3 => vec![
            Circle(33., 34., 22.),
            Circle(67., 34., 22.),
            Circle(33., 67., 22.),
            Circle(67., 67., 22.),
            Circle(50., 50., 24.),
        ],
        4 => vec![
            Circle(31., 60., 25.),
            Circle(69., 60., 25.),
            Circle(52., 37., 27.),
            Circle(50., 64., 28.),
        ],
        5 => ring(5, &[24.], 0., (50., 51.))
            .into_iter()
            .map(|(cx, cy)| Circle(cx, cy, 20.))
            .chain([Circle(50., 51., 26.)])
            .collect(),
        6 => vec![Path(
            "M24 9 H76 Q91 9 91 24 V76 Q91 91 76 91 H24 Q9 91 9 76 V24 Q9 9 24 9 Z".into(),
        )],
        _ => vec![Path(rounded_polygon(&ring(5, &[46.], 0., (50., 52.)), 14.))],
    }
}

/// FNV-1a, then a full avalanche, so the creature is a stable function of
/// the name in every process, and names that differ by one character still
/// land on different bodies and colours.
fn hash(text: &str) -> u32 {
    let mut value: u32 = 0x811c9dc5;
    for character in text.chars() {
        value ^= character as u32;
        value = value.wrapping_mul(0x01000193);
    }
    value ^= value >> 16;
    value = value.wrapping_mul(0x85ebca6b);
    value ^= value >> 13;
    value = value.wrapping_mul(0xc2b2ae35);
    value ^= value >> 16;
    value
}
/// `agentCreatureFor`: the body and the colour a name makes.
pub fn creature_for(seed: &str) -> (usize, usize) {
    let value = hash(&seed.trim().to_lowercase());
    ((value % 8) as usize, ((value >> 16) % 8) as usize)
}

fn hex(color: Rgba) -> String {
    let c = |v: f32| (v.clamp(0., 1.) * 255.).round() as u8;
    format!("#{:02x}{:02x}{:02x}", c(color.r), c(color.g), c(color.b))
}
/// `saturate(0.6) brightness(0.9)`: a creature at rest, its colour quieter.
fn resting(rgba: Rgba) -> Rgba {
    let luma = 0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b;
    let quiet = |v: f32| ((luma + (v - luma) * 0.6) * 0.9).clamp(0., 1.);
    Rgba {
        r: quiet(rgba.r),
        g: quiet(rgba.g),
        b: quiet(rgba.b),
        a: 1.,
    }
}
/// The creature's SVG: the host's own ground around the body, so stacked
/// creatures stay apart, then the body and its eyes.
pub fn svg(seed: &str, awake: bool, ground: Rgba) -> String {
    let (index, color) = creature_for(seed);
    let color = theme::agent_creature(color);
    let fill = if awake { color } else { resting(color) };
    let parts = body(index);
    let draw = |out: &mut String| {
        for part in &parts {
            match part {
                Part::Circle(cx, cy, r) => {
                    let _ = write!(out, r#"<circle cx="{cx:.2}" cy="{cy:.2}" r="{r}"/>"#);
                }
                Part::Path(d) => {
                    let _ = write!(out, r#"<path d="{d}"/>"#);
                }
            }
        }
    };
    let mut out = String::from(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">"#);
    let ground = hex(ground);
    let _ = write!(
        out,
        r#"<g fill="{ground}" stroke="{ground}" stroke-width="9" stroke-linejoin="round">"#
    );
    draw(&mut out);
    let _ = write!(out, r#"</g><g fill="{}">"#, hex(fill));
    draw(&mut out);
    out.push_str("</g>");
    let eyes = hex(theme::agent_creature_eyes());
    for (cx, cy) in EYES {
        if awake {
            let _ = write!(
                out,
                r#"<ellipse cx="{cx}" cy="{cy}" rx="4.6" ry="10" fill="{eyes}" transform="rotate(-12 {cx} {cy})"/>"#
            );
        } else {
            let _ = write!(
                out,
                r#"<path d="M{} {} q6 6.5 12 0" fill="none" stroke="{eyes}" stroke-width="4.5" stroke-linecap="round"/>"#,
                cx - 6.,
                cy + 1.
            );
        }
    }
    out.push_str("</svg>");
    out
}

thread_local! {
    static IMAGES: std::cell::RefCell<HashMap<String, Arc<Image>>> = Default::default();
}
/// The creature for `seed`, drawn once per look and kept.
pub fn image(seed: &str, awake: bool, ground: Rgba) -> Arc<Image> {
    let key = format!("{}\n{awake}\n{}", seed.trim().to_lowercase(), hex(ground));
    IMAGES.with(|images| {
        images
            .borrow_mut()
            .entry(key)
            .or_insert_with(|| {
                Arc::new(Image::from_bytes(
                    ImageFormat::Svg,
                    svg(seed, awake, ground).into_bytes(),
                ))
            })
            .clone()
    })
}

#[cfg(test)]
#[path = "agent_creature_tests.rs"]
mod tests;
