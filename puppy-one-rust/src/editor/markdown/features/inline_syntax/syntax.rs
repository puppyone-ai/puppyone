//! The product's `inline-syntax` parser extension (`inlineSyntaxParser.ts`) and
//! Lezer's `Emoji` extension: `==highlight==`, `%%comment%%`, and `:shortcode:`
//! (`assets/markdown/emoji-shortcodes.json`, imported by
//! `tools/import-emoji-shortcodes.py`).
use crate::editor::{
    markdown::core::syntax::{Element, Kind, Span, Syntax},
    text::buffer::Buffer,
};
use std::{collections::HashMap, ops::Range, sync::OnceLock};

fn table() -> &'static HashMap<String, String> {
    static TABLE: OnceLock<HashMap<String, String>> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../../assets/markdown/emoji-shortcodes.json"
        ))
        .unwrap_or_default()
    })
}

/// `:name:` (Lezer `Emoji`: `/^:[a-zA-Z_0-9]+:/`, and the signed `:+1:` /
/// `:-1:` the product adds) whose name is a known shortcode, with its emoji.
pub fn emoji(text: &str) -> Vec<(Range<usize>, &'static str)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b':' {
            i += 1;
            continue;
        }
        let signed = bytes
            .get(i + 1..i + 4)
            .is_some_and(|s| s == b"+1:" || s == b"-1:");
        let len = if signed {
            2
        } else {
            bytes[i + 1..]
                .iter()
                .take_while(|b| b.is_ascii_alphanumeric() || **b == b'_')
                .count()
        };
        if len == 0 || bytes.get(i + 1 + len) != Some(&b':') {
            i += 1;
            continue;
        }
        let end = i + len + 2;
        if let Some(emoji) = table().get(&text[i + 1..i + 1 + len]) {
            out.push((i..end, emoji.as_str()));
        }
        i = end;
    }
    out
}

fn flanked(text: &str, at: usize, before: bool) -> bool {
    let c = if before {
        text[..at].chars().next_back()
    } else {
        text[at..].chars().next()
    };
    c.is_some_and(|c| !c.is_whitespace())
}

/// `==text==` on one line (`HighlightDelimiter`): an opening `==` before
/// non-space, the nearest closing `==` after non-space; `===` is neither.
/// (opening, closing) byte offsets of the two delimiters.
pub fn highlights(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let delimiter = |i: usize| {
        bytes.get(i..i + 2) == Some(b"==")
            && bytes.get(i + 2) != Some(&b'=')
            && (i == 0 || bytes[i - 1] != b'=')
    };
    let mut out = Vec::new();
    let mut i = 0;
    while i + 5 <= bytes.len() {
        if !delimiter(i) || !flanked(text, i + 2, false) {
            i += 1;
            continue;
        }
        let close = (i + 3..bytes.len().saturating_sub(1))
            .find(|&j| delimiter(j) && flanked(text, j, true));
        match close {
            Some(j) => {
                out.push((i, j));
                i = j + 2;
            }
            None => i += 1,
        }
    }
    out
}

/// `%%comment%%` on one line (`PercentComment`).
pub fn percent_comments(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(open) = text[from..].find("%%") {
        let open = from + open;
        match text[open + 2..].find("%%") {
            Some(close) => {
                let end = open + 2 + close + 2;
                out.push(open..end);
                from = end;
            }
            None => break,
        }
    }
    out
}

/// Emit `Kind::Highlight` (`==text==`) and `Kind::Comment` (`%%comment%%`)
/// elements on one eligible line or table cell.
pub fn recognize_line(line_start: usize, line_text: &str, out: &mut Vec<Element>) {
    if line_text.contains("==") {
        for (open, close) in highlights(line_text) {
            let (from, to) = (line_start + open, line_start + close + 2);
            out.push(Element::new(
                Kind::Highlight,
                from..to,
                vec![from..from + 2, to - 2..to],
                Some(from + 2..to - 2),
            ));
        }
    }
    if line_text.contains("%%") {
        for comment in percent_comments(line_text) {
            let r = line_start + comment.start..line_start + comment.end;
            out.push(Element::new(Kind::Comment, r.clone(), vec![], Some(r)));
        }
    }
}

/// Collect `:shortcode:` (`Kind::Emoji`) elements inside `window`, respecting
/// CommonMark code blocks, inline code, HTML tags/blocks, link destinations,
/// comments, and link definitions.
pub fn collect_emoji_in_range(
    doc: &Buffer,
    syntax: &Syntax,
    window: Range<usize>,
    out: &mut Vec<Element>,
) {
    let ranges = syntax.inline_ranges_in(doc, window);
    if ranges.is_empty() {
        return;
    }
    let overlaps = |spans: &[Span], r: &Span| -> bool {
        let i = spans.partition_point(|s| s.end <= r.start);
        spans.get(i).is_some_and(|s| s.start < r.end)
    };
    let link_def_overlaps = |r: &Span| -> bool {
        let i = syntax.link_defs.partition_point(|(s, _)| s.end <= r.start);
        syntax
            .link_defs
            .get(i)
            .is_some_and(|(s, _)| s.start < r.end)
    };
    for region in ranges {
        let text_cow = doc.slice_cow(region.clone());
        let text = text_cow.as_ref();
        if !text.contains(':') {
            continue;
        }
        for (rel, glyph) in emoji(text) {
            let r = region.start + rel.start..region.start + rel.end;
            if overlaps(&syntax.inline_tags, &r)
                || overlaps(&syntax.html_blocks, &r)
                || link_def_overlaps(&r)
            {
                continue;
            }
            let suppressed = syntax.elements_in(r.clone()).any(|e| {
                if e.range.start >= r.end || e.range.end <= r.start {
                    return false;
                }
                match e.kind {
                    Kind::InlineCode | Kind::Comment => true,
                    Kind::Link | Kind::Image => !e
                        .content
                        .as_ref()
                        .is_some_and(|c| c.start <= r.start && r.end <= c.end),
                    _ => false,
                }
            });
            if suppressed {
                continue;
            }
            let mut e = Element::new(Kind::Emoji, r.clone(), vec![r], None);
            e.text = Some(glyph.to_owned());
            out.push(e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn inline_syntax_follows_the_product_parser() {
        let found: Vec<_> = emoji("ok :smile: :nope: :+1:")
            .into_iter()
            .map(|(r, e)| (r, e.to_owned()))
            .collect();
        assert_eq!(found, vec![(3..10, "😄".into()), (18..22, "👍".into())]);
        assert_eq!(highlights("a ==b c== d === e"), vec![(2, 7)]);
        assert!(highlights("== spaced ==").is_empty());
        assert_eq!(percent_comments("x %%hidden%% y %%open"), vec![2..12]);
    }
}
