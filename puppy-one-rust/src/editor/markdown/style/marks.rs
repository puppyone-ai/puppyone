//! Inline spans are drawn by GPUI Kit, which can express bold, italic,
//! strikethrough, inline code and links but no per-span colour or weight
//! other than its bold; this maps the product's inline classes onto that.
use super::{cascade::LineContext, MarkdownTheme};
use crate::editor::{markdown::core::classes::Class, view::decoration::MarkStyle};
use gpui::SharedString;

/// The Kit marks of a span whose elements carry `classes`, on a line with
/// context `line`. Kit expresses weight only as "bold" (the family's Bold
/// slot = `--po-md-strong-weight`); colours other than link and inline code
/// are not expressible and stay the line's colour.
pub fn marks(theme: &MarkdownTheme, classes: Class, line: &LineContext, href: Option<&SharedString>, live: bool) -> MarkStyle {
    let has = |x: Class| classes.has(x);
    if !live {
        // `[data-live-preview="false"] :is(.cm-md-syntax-strong, …)`
        // neutralises every inline role except headings and markup colour.
        return MarkStyle { bold: has(Class::SYNTAX_HEADING) && theme.heading.level(4).weight > line.weight, ..Default::default() };
    }
    let mut weight = line.weight;
    if has(Class::SYNTAX_HEADING) {
        weight = weight.max(theme.heading.level(4).weight);
    }
    // `.cm-md-heading .cm-md-syntax-strong { font-weight: inherit }`.
    if has(Class::SYNTAX_STRONG) && !line.heading {
        weight = theme.inline.strong_weight;
    }
    MarkStyle {
        bold: weight > line.weight,
        italic: has(Class::SYNTAX_EMPHASIS),
        strike: has(Class::SYNTAX_STRIKE),
        code: has(Class::SYNTAX_MONOSPACE),
        link: if has(Class::SYNTAX_LINK) { Some(href.cloned().unwrap_or_default()) } else { None },
    }
}
