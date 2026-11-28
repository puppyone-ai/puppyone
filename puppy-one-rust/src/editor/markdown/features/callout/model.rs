//! Obsidian callout model (`calloutModel.ts`), derived on demand from
//! CommonMark `Kind::Blockquote` elements in `Syntax` (`MA-13`, `MA-04`: zero `gpui`).
use super::syntax::parse_header;
use crate::editor::{
    markdown::core::syntax::{Element, Kind, Span, Syntax},
    text::buffer::Buffer,
};
use std::ops::Range;

/// An Obsidian callout (`calloutModel.ts`).
#[derive(Clone, Debug, PartialEq)]
pub struct Callout {
    pub appearance: &'static str,
    pub default_title: String,
    pub has_title: bool,
    pub fold: Option<bool>,
    pub marker: Span,
    pub first_line: usize,
    pub last_line: usize,
}

/// The body of a folded callout, out of the flow.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct FoldedBody {
    pub range: Range<usize>,
}

/// Parse one outer `Kind::Blockquote` element as an Obsidian callout, if its
/// first line begins with `> [!type][+-]?`.
pub fn parse_callout(doc: &Buffer, quote: &Element) -> Option<Callout> {
    let line = quote.line.clone()?;
    let text_cow = doc.slice_cow(line.clone());
    let header = parse_header(text_cow.as_ref())?;
    let marker_from = line.start + header.marker_start;
    let marker_to = line.start + header.marker_end;
    Some(Callout {
        appearance: header.appearance,
        default_title: header.default_title,
        has_title: !doc.slice_cow(marker_to..line.end).trim().is_empty(),
        fold: header.fold,
        marker: marker_from..marker_to,
        first_line: doc.line_index(line.start),
        last_line: doc.line_index(quote.range.end.saturating_sub(1).max(quote.range.start)),
    })
}

/// Collect all outer callouts present in `syntax.elements`.
pub fn collect_callouts(doc: &Buffer, syntax: &Syntax) -> Vec<Callout> {
    let mut covered = 0;
    syntax
        .elements
        .iter()
        .filter(|e| e.kind == Kind::Blockquote)
        .filter(|e| {
            let outer = e.range.start >= covered;
            covered = covered.max(e.range.end);
            outer
        })
        .filter_map(|e| parse_callout(doc, e))
        .collect()
}

/// Look up the outer callout covering `line` in `O(log N)` via `Syntax::elements_in`.
pub fn callout_at(doc: &Buffer, syntax: &Syntax, line: usize) -> Option<Callout> {
    if line >= doc.line_count() {
        return None;
    }
    let line_range = doc.line_range(line);
    let outer_quote = syntax
        .elements_in(line_range)
        .filter(|e| e.kind == Kind::Blockquote)
        .min_by_key(|e| (e.range.start, std::cmp::Reverse(e.range.end)))?;
    let c = parse_callout(doc, outer_quote)?;
    (c.first_line <= line && line <= c.last_line).then_some(c)
}
