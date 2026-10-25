//! Headings (`.cm-md-heading`, `.cm-md-heading-N` in markdown-content.css).
use crate::editor::tokens::Tokens;
use gpui::Rgba;

/// One heading level.
#[derive(Clone, Debug, PartialEq)]
pub struct HeadingLevel {
    /// `--po-md-hN-size`.
    pub size: f32,
    /// `--po-md-hN-weight` (h1–h3) or `--po-md-heading-weight` (h4–h6).
    pub weight: f32,
    /// `--po-md-hN-gap-before` / `-after`, at the heading's size.
    pub gap_before: f32,
    pub gap_after: f32,
    /// `--po-md-heading-color` (`--po-md-h6-color` for h6).
    pub color: Rgba,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HeadingStyle {
    pub levels: [HeadingLevel; 6],
    /// `--po-md-heading-line-height`.
    pub line_height: f32,
    /// `--po-md-heading-border-color`: the rule below h1 and h2.
    pub border: Rgba,
}

impl HeadingStyle {
    pub fn resolve(t: &Tokens, size: f32) -> Self {
        let level = |n: usize| {
            let size = t.len(&format!("--po-md-h{n}-size"), size);
            HeadingLevel {
                size,
                weight: if n <= 3 {
                    t.number(&format!("--po-md-h{n}-weight"))
                } else {
                    t.number("--po-md-heading-weight")
                },
                gap_before: t.len(&format!("--po-md-h{n}-gap-before"), size),
                gap_after: t.len(&format!("--po-md-h{n}-gap-after"), size),
                color: if n == 6 {
                    t.color("--po-md-h6-color")
                } else {
                    t.color("--po-md-heading-color")
                },
            }
        };
        Self {
            levels: [level(1), level(2), level(3), level(4), level(5), level(6)],
            line_height: t.number("--po-md-heading-line-height"),
            border: t.color("--po-md-heading-border-color"),
        }
    }

    pub fn level(&self, level: usize) -> &HeadingLevel {
        &self.levels[level.clamp(1, 6) - 1]
    }
}
