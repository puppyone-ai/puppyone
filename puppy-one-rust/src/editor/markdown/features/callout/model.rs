//! Obsidian callout model (`calloutModel.ts`), derived on demand from
//! CommonMark `Kind::Blockquote` elements in `Syntax` (`MA-13`, `MA-04`: zero `gpui`).
use crate::editor::{
    markdown::core::syntax::{Element, Kind, Span, Syntax},
    text::buffer::Buffer,
};

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

/// Parse one outer `Kind::Blockquote` element as an Obsidian callout, if its
/// first line begins with `> [!type][+-]?`.
pub fn parse_callout(doc: &Buffer, quote: &Element) -> Option<Callout> {
    let line = quote.line.clone()?;
    let text_cow = doc.slice_cow(line.clone());
    let text = text_cow.as_ref();
    let lead = text.len() - text.trim_start().len();
    let rest = text[lead..].strip_prefix('>')?;
    let space = usize::from(rest.starts_with([' ', '\t']));
    let after = &rest[space..];
    let word_len = after.strip_prefix("[!")?.find(']').filter(|&n| n > 0)?;
    let word = &after[2..2 + word_len];
    if !word.starts_with(|c: char| c.is_ascii_alphabetic())
        || !word
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    let mut end = 2 + word_len + 1;
    let fold = match after[end..].chars().next() {
        Some('-') => {
            end += 1;
            Some(true)
        }
        Some('+') => {
            end += 1;
            Some(false)
        }
        _ => None,
    };
    let marker_from = line.start + lead + 1 + space;
    let spaces = after[end..].len() - after[end..].trim_start_matches([' ', '\t']).len();
    let marker_to = marker_from + end + spaces;
    let lower = word.to_lowercase();
    let appearance = match lower.as_str() {
        "abstract" | "summary" | "tldr" => "abstract",
        "attention" | "warning" => "warning",
        "bug" => "bug",
        "caution" => "caution",
        "check" | "done" | "success" => "success",
        "cite" | "quote" => "quote",
        "danger" | "error" => "danger",
        "example" => "example",
        "fail" | "failure" | "missing" => "failure",
        "faq" | "help" | "question" => "question",
        "hint" | "tip" => "tip",
        "important" => "important",
        "info" => "info",
        "todo" => "todo",
        _ => "note",
    };
    let mut title = lower;
    if let Some(first) = title.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    Some(Callout {
        appearance,
        default_title: title,
        has_title: !doc.slice_cow(marker_to..line.end).trim().is_empty(),
        fold,
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
