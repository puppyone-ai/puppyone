//! Inline spans are drawn by GPUI Kit, which can express bold, italic,
//! strikethrough, underline, inline code, links, a highlight background and
//! (patched, `vendor/gpui-base`) a colour, but no weight other than its
//! bold; this maps the product's inline classes onto that.
use super::{MarkdownTheme, cascade::LineContext};
use crate::editor::{markdown::core::classes::Class, view::decoration::MarkStyle};
use gpui::SharedString;

/// The Kit marks of a span whose elements carry `classes`, on a line with
/// context `line`. Kit expresses weight only as "bold" (the family's Bold
/// slot = `--po-md-strong-weight`); colours other than link and inline code
/// are not expressible and stay the line's colour.
pub fn marks(
    theme: &MarkdownTheme,
    classes: Class,
    line: &LineContext,
    href: Option<&SharedString>,
    live: bool,
) -> MarkStyle {
    let has = |x: Class| classes.has(x);
    if !live {
        // `[data-live-preview="false"] :is(.cm-md-syntax-strong, …)`
        // neutralises every inline role except headings and markup colour.
        return MarkStyle {
            bold: has(Class::SYNTAX_HEADING) && theme.heading.level(4).weight > line.weight,
            ..Default::default()
        };
    }
    let mut weight = line.weight;
    if has(Class::SYNTAX_HEADING) {
        weight = weight.max(theme.heading.level(4).weight);
    }
    // `.cm-md-heading .cm-md-syntax-strong { font-weight: inherit }`.
    if has(Class::SYNTAX_STRONG) && !line.heading {
        weight = theme.inline.strong_weight;
    }
    use crate::editor::view::decoration::packed;
    MarkStyle {
        bold: weight > line.weight,
        italic: has(Class::SYNTAX_EMPHASIS) || has(Class::MATH),
        strike: has(Class::SYNTAX_STRIKE),
        underline: has(Class::HTML_UNDERLINE),
        code: has(Class::SYNTAX_MONOSPACE),
        link: if has(Class::SYNTAX_LINK) {
            Some(href.cloned().unwrap_or_default())
        } else {
            None
        },
        highlight: if has(Class::HTML_MARK) {
            Some(packed(gpui::rgb(0xffff00)))
        } else {
            has(Class::SYNTAX_HIGHLIGHT).then(|| packed(theme.inline.highlight_background))
        },
        // `.cm-md-comment` takes the markup colour, link definitions and
        // footnote markers the link colour.
        color: if has(Class::FOOTNOTE_REFERENCE) || has(Class::HTML_SHIFTED) {
            Some(0)
        } else if has(Class::HTML_MARK) {
            Some(packed(gpui::rgb(0x000000)))
        } else if has(Class::COMMENT) {
            Some(packed(theme.inline.markup_color))
        } else if has(Class::LINK_DEFINITION) || has(Class::FOOTNOTE) {
            Some(packed(theme.inline.link_color))
        } else {
            None
        },
    }
}
