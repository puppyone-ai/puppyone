//! Markdown source-panel syntax highlighting (`CE-10`, `TODO-49`):
//! highlights Markdown source directly from the Markdown pipeline's own
//! [`Syntax`] tree (`TA-31`) without compiling a separate tree-sitter Markdown
//! grammar.
use super::core::syntax::{Hl, Syntax};
use crate::editor::{
    code::highlight::SyntaxColors,
    text::buffer::Buffer,
    view::decoration::{Mark, MarkStyle, packed},
};
use std::ops::Range;

/// Maximum document byte size for synchronous Markdown source highlighting.
const MAX_SOURCE_HIGHLIGHT_BYTES: usize = 2 * 1024 * 1024;

/// Produce sorted, non-overlapping source-mode syntax [`Mark`]s for `doc`
/// from the Markdown pipeline's own [`Syntax`] tree (`CE-10`).
pub fn source_highlights(doc: &Buffer, colors: &SyntaxColors) -> Vec<Mark> {
    if doc.is_empty() || doc.len() > MAX_SOURCE_HIGHLIGHT_BYTES {
        return Vec::new();
    }
    let syntax = Syntax::parse(doc);
    source_highlights_from_syntax(doc, &syntax, colors)
}

pub(crate) fn source_highlights_from_syntax(
    doc: &Buffer,
    syntax: &Syntax,
    colors: &SyntaxColors,
) -> Vec<Mark> {
    let mut raw: Vec<(Range<usize>, Hl)> = syntax.highlights.clone();
    for fence in &syntax.fences {
        if !fence.code.is_empty() {
            raw.push((fence.code.clone(), Hl::MONOSPACE));
        }
    }
    let mut html_spans: Vec<Range<usize>> =
        Vec::with_capacity(syntax.html_blocks.len() + syntax.inline_tags.len());
    html_spans.extend(syntax.html_blocks.iter().cloned());
    html_spans.extend(syntax.inline_tags.iter().cloned());

    let mut out: Vec<Mark> = Vec::new();
    for line in 0..doc.line_count() {
        let range = doc.line_range(line);
        if range.is_empty() {
            continue;
        }
        let mut cuts = vec![range.start, range.end];
        for (r, _) in &raw {
            if r.end > range.start && r.start < range.end {
                cuts.push(r.start.max(range.start));
                cuts.push(r.end.min(range.end));
            }
        }
        for r in &html_spans {
            if r.end > range.start && r.start < range.end {
                cuts.push(r.start.max(range.start));
                cuts.push(r.end.min(range.end));
            }
        }
        cuts.sort_unstable();
        cuts.dedup();
        for pair in cuts.windows(2) {
            let seg = pair[0]..pair[1];
            let mut flags = Hl::NONE;
            for (r, h) in &raw {
                if r.start <= seg.start && r.end >= seg.end {
                    flags = flags | *h;
                }
            }
            let in_html = html_spans
                .iter()
                .any(|r| r.start <= seg.start && r.end >= seg.end);
            let style = style_for(flags, in_html, colors);
            if style.is_plain() {
                continue;
            }
            match out.last_mut() {
                Some(last) if last.range.end == seg.start && last.style == style => {
                    last.range.end = seg.end;
                }
                _ => out.push(Mark { range: seg, style }),
            }
        }
    }
    out
}

fn style_for(flags: Hl, in_html: bool, colors: &SyntaxColors) -> MarkStyle {
    let color = if flags.has(Hl::MARKUP) {
        Some(colors.meta)
    } else if in_html {
        Some(colors.type_name)
    } else if flags.has(Hl::MONOSPACE) {
        Some(colors.string)
    } else if flags.has(Hl::LINK) {
        Some(colors.function)
    } else if flags.has(Hl::HEADING) {
        Some(colors.keyword)
    } else if flags.has(Hl::STRONG) {
        Some(colors.constant)
    } else if flags.has(Hl::EMPHASIS) {
        Some(colors.special)
    } else if flags.has(Hl::LIST) {
        Some(colors.operator)
    } else if flags.has(Hl::QUOTE) || flags.has(Hl::STRIKE) {
        Some(colors.comment)
    } else {
        None
    };
    MarkStyle {
        bold: flags.has(Hl::HEADING) || flags.has(Hl::STRONG),
        italic: flags.has(Hl::EMPHASIS),
        strike: flags.has(Hl::STRIKE),
        color: color.map(packed),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::typography::Scale;

    #[test]
    fn markdown_source_highlights_headings_code_links_and_markup() {
        let colors = SyntaxColors::resolve(true, Scale::Medium);
        let doc = Buffer::new("# Title\n\nSee [docs](https://example.com) and `code`.\n");
        let marks = source_highlights(&doc, &colors);
        assert!(
            marks
                .iter()
                .any(|m| m.style.color == Some(packed(colors.meta))),
            "expected `#` / link / code delimiters in meta colour: {marks:?}"
        );
        assert!(
            marks
                .iter()
                .any(|m| m.style.bold && m.style.color == Some(packed(colors.keyword))),
            "expected heading text in bold keyword colour: {marks:?}"
        );
        assert!(
            marks
                .iter()
                .any(|m| m.style.color == Some(packed(colors.function))),
            "expected link in function colour: {marks:?}"
        );
        assert!(
            marks
                .iter()
                .any(|m| m.style.color == Some(packed(colors.string))),
            "expected inline code in string colour: {marks:?}"
        );
    }
}
