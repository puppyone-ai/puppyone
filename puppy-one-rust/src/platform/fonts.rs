//! The app's fonts, read from the one file that names them
//! (`assets/typography/fonts.json`): for each face, the family the native
//! app draws with on this platform, the CSS stack the font catalog uses (the
//! importers read the same file for the web views and the imported themes),
//! the bundled font files and the fallback advance of "0". Bundled files are
//! registered by `ui::fonts::register_bundled`.
use super::os::Os;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::LazyLock;

/// One face of `fonts.json`, resolved for this platform.
#[derive(Debug)]
pub struct Face {
    /// The family GPUI draws with.
    pub family: &'static str,
    /// The CSS `font-family` stack (catalog, web views).
    pub stack: Vec<&'static str>,
    /// Bundled font files, relative to `assets/` (embedded by
    /// `tools/generate-assets-rs.py`, registered at startup).
    pub files: Vec<&'static str>,
    /// The advance of "0" per em by weight, before the running font is
    /// measured (`ui::fonts`).
    zero_advance: BTreeMap<u16, f32>,
}

impl Face {
    /// The fallback advance of "0" per em at the nearest listed weight.
    pub fn zero_advance(&self, weight: f32) -> f32 {
        self.zero_advance
            .iter()
            .min_by(|(a, _), (b, _)| {
                (**a as f32 - weight)
                    .abs()
                    .total_cmp(&(**b as f32 - weight).abs())
            })
            .map_or(0.6, |(_, advance)| *advance)
    }
}

/// The four faces: interface and body text, serif reading themes, code and
/// the terminal.
#[derive(Debug)]
pub struct Faces {
    pub sans: Face,
    pub serif: Face,
    pub mono: Face,
    pub terminal: Face,
}

impl Faces {
    /// Every bundled font file, once.
    pub fn files(&self) -> impl Iterator<Item = &'static str> + '_ {
        let mut seen = Vec::new();
        [&self.sans, &self.serif, &self.mono, &self.terminal]
            .into_iter()
            .flat_map(|face| face.files.iter().copied())
            .filter(move |file| {
                let new = !seen.contains(file);
                seen.push(*file);
                new
            })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FaceSource {
    family: BTreeMap<String, String>,
    stack: Vec<String>,
    files: Vec<String>,
    zero_advance: BTreeMap<u16, f32>,
}

#[derive(Deserialize)]
struct Source {
    faces: BTreeMap<String, FaceSource>,
}

const SOURCE: &str = include_str!("../../assets/typography/fonts.json");

fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

/// `source`'s faces for `os` (a platform without its own entry takes Linux's).
fn parse(source: &str, os: Os) -> Faces {
    let mut source: Source = serde_json::from_str(source).expect("assets/typography/fonts.json");
    let key = match os {
        Os::Macos => "macos",
        Os::Windows => "windows",
        Os::Linux | Os::Other => "linux",
    };
    let mut face = |name: &str| {
        let face = source
            .faces
            .remove(name)
            .unwrap_or_else(|| panic!("fonts.json names no `{name}` face"));
        Face {
            family: leak(
                face.family
                    .get(key)
                    .unwrap_or_else(|| panic!("fonts.json: `{name}` has no {key} family"))
                    .clone(),
            ),
            stack: face.stack.into_iter().map(leak).collect(),
            files: face.files.into_iter().map(leak).collect(),
            zero_advance: face.zero_advance,
        }
    };
    Faces {
        sans: face("sans"),
        serif: face("serif"),
        mono: face("mono"),
        terminal: face("terminal"),
    }
}

/// The app's faces on this platform.
pub fn faces() -> &'static Faces {
    static FACES: LazyLock<Faces> = LazyLock::new(|| parse(SOURCE, Os::current()));
    &FACES
}

/// A CSS `font-family` value of `stack`: names with spaces quoted.
pub fn css(stack: &[&str]) -> String {
    stack
        .iter()
        .map(|name| {
            if name.contains(' ') {
                format!("\"{name}\"")
            } else {
                (*name).to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn every_platform_has_every_face() {
        for os in [Os::Macos, Os::Windows, Os::Linux, Os::Other] {
            let faces = parse(SOURCE, os);
            for face in [&faces.sans, &faces.serif, &faces.mono, &faces.terminal] {
                assert!(!face.family.is_empty() && !face.stack.is_empty(), "{os:?}");
            }
        }
        let mac = parse(SOURCE, Os::Macos);
        assert_eq!(mac.sans.family, ".SystemUIFont");
        assert_eq!(mac.mono.family, ".AppleSystemUIFontMonospaced");
        assert_eq!(parse(SOURCE, Os::Windows).mono.family, "Consolas");
    }

    #[test]
    fn the_fallback_advance_takes_the_nearest_weight_and_css_quotes_spaced_names() {
        let faces = parse(SOURCE, Os::Macos);
        assert_eq!(faces.sans.zero_advance(450.), 0.606);
        assert_eq!(faces.sans.zero_advance(650.), 0.638);
        assert_eq!(faces.mono.zero_advance(700.), 0.618);
        assert_eq!(
            css(&["ui-serif", "New York", "Georgia"]),
            "ui-serif, \"New York\", Georgia"
        );
    }
}
