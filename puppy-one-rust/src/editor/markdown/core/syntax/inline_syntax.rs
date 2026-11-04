//! The product's `inline-syntax` parser extension (inlineSyntaxParser.ts) and
//! Lezer's `Emoji` extension, as source scans: `==highlight==`,
//! `%%comment%%` and `:shortcode:` (`assets/markdown/emoji-shortcodes.json`,
//! imported by `tools/import-emoji-shortcodes.py`).
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
