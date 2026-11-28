//! Passive code decorations (`CodeMirrorCodeEditor` + `codeIndentGuides.ts`,
//! `CE-03`, `CE-12`):
//! - `bracketMatching()` (windowed around cursor on [`Buffer`] without
//!   materialising `flat`);
//! - `highlightSelectionMatches({ minSelectionLength: 2, maxMatchCount: 100 })`;
//! - `highlightTrailingWhitespace()`;
//! - `codeIndentGuides` (`getIndentGuideCharacterOffsets`, capped at `16`
//!   guide columns).
use crate::editor::text::buffer::Buffer;
use std::ops::Range;

const PAIRS: [(char, char); 3] = [('(', ')'), ('[', ']'), ('{', '}')];
/// CodeMirror's `maxScanDistance` (characters).
const SCAN: usize = 10_000;
/// Window byte radius around cursor for rope-based bracket scan (`4 * SCAN`).
const WINDOW_BYTES: usize = SCAN * 4;
/// `highlightSelectionMatches` `maxMatchCount`.
const MAX_MATCHES: usize = 100;
/// Maximum document byte size for eager selection-match / trailing-space scans.
pub const MAX_PASSIVE_SCAN_BYTES: usize = 512 * 1024;
/// Maximum indent guide columns per line (`CE-12`).
pub const MAX_INDENT_GUIDES: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Brackets {
    Matched(Range<usize>, Range<usize>),
    Unmatched(Range<usize>),
}

fn scan(text: &str, at: usize, open: char, close: char, forward: bool) -> Option<usize> {
    let mut depth = 0usize;
    if forward {
        for (i, c) in text[at..].char_indices().take(SCAN) {
            if c == open {
                depth += 1;
            } else if c == close {
                depth -= 1;
                if depth == 0 {
                    return Some(at + i);
                }
            }
        }
    } else {
        for (i, c) in text[..at + close.len_utf8()]
            .char_indices()
            .rev()
            .take(SCAN)
        {
            if c == close {
                depth += 1;
            } else if c == open {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
        }
    }
    None
}

/// The bracket before the cursor wins, then the one after it.
pub fn brackets(text: &str, cursor: usize) -> Option<Brackets> {
    let cursor = cursor.min(text.len());
    if !text.is_char_boundary(cursor) {
        return None;
    }
    let before = text[..cursor].char_indices().next_back();
    let after = text[cursor..].chars().next().map(|c| (cursor, c));
    for (at, c) in [before, after].into_iter().flatten() {
        for (open, close) in PAIRS {
            let partner = if c == open {
                scan(text, at, open, close, true)
            } else if c == close {
                scan(text, at, open, close, false)
            } else {
                continue;
            };
            let own = at..at + c.len_utf8();
            return Some(match partner {
                Some(p) => Brackets::Matched(own, p..p + 1),
                None => Brackets::Unmatched(own),
            });
        }
    }
    None
}

/// Windowed bracket matching over `doc` without materialising `doc.flat` (`CE-02`, `CE-03`).
pub fn brackets_in_buffer(doc: &Buffer, cursor: usize) -> Option<Brackets> {
    let cursor = doc.clamp(cursor);
    let start = doc.clamp(cursor.saturating_sub(WINDOW_BYTES));
    let end = doc.clamp((cursor + WINDOW_BYTES).min(doc.len()));
    let window = doc.slice_cow(start..end);
    match brackets(&window, cursor - start)? {
        Brackets::Matched(a, b) => Some(Brackets::Matched(
            start + a.start..start + a.end,
            start + b.start..start + b.end,
        )),
        Brackets::Unmatched(r) => Some(Brackets::Unmatched(start + r.start..start + r.end)),
    }
}

/// Other occurrences of a single-line selection of at least two characters.
pub fn selection_matches(text: &str, selection: Range<usize>) -> Vec<Range<usize>> {
    let Some(needle) = text.get(selection.clone()) else {
        return vec![];
    };
    if needle.chars().count() < 2 || needle.contains('\n') || needle.trim().is_empty() {
        return vec![];
    }
    text.match_indices(needle)
        .map(|(i, m)| i..i + m.len())
        .filter(|r| *r != selection)
        .take(MAX_MATCHES)
        .collect()
}

/// Selection match highlights over `doc` within [`MAX_PASSIVE_SCAN_BYTES`].
pub fn selection_matches_in_buffer(doc: &Buffer, selection: Range<usize>) -> Vec<Range<usize>> {
    if selection.is_empty() || doc.len() > MAX_PASSIVE_SCAN_BYTES {
        return Vec::new();
    }
    let selection = doc.clamp_range(selection);
    let needle = doc.slice_cow(selection.clone());
    if needle.chars().count() < 2 || needle.contains('\n') || needle.trim().is_empty() {
        return Vec::new();
    }
    let full = doc.slice_cow(0..doc.len());
    selection_matches(&full, selection)
}

/// Spaces and tabs before each line end.
pub fn trailing_whitespace(text: &str) -> Vec<Range<usize>> {
    let mut out = vec![];
    let mut start = 0;
    for line in text.split('\n') {
        let trimmed = line.trim_end_matches([' ', '\t']).len();
        if trimmed < line.len() {
            out.push(start + trimmed..start + line.len());
        }
        start += line.len() + 1;
    }
    out
}

/// Trailing whitespace byte ranges across `doc` within [`MAX_PASSIVE_SCAN_BYTES`].
pub fn trailing_whitespace_in_buffer(doc: &Buffer) -> Vec<Range<usize>> {
    if doc.is_empty() || doc.len() > MAX_PASSIVE_SCAN_BYTES {
        return Vec::new();
    }
    let mut out = Vec::new();
    for line_idx in 0..doc.line_count() {
        let range = doc.line_range(line_idx);
        if range.is_empty() {
            continue;
        }
        let line = doc.line_cow(line_idx);
        let trimmed = line.trim_end_matches([' ', '\t']).len();
        if trimmed < line.len() {
            out.push(range.start + trimmed..range.end);
        }
    }
    out
}

/// `getIndentGuideCharacterOffsets` (`codeIndentGuides.ts`, `CE-12`):
/// returns `(byte_offset, guide_column)` pairs for each complete indentation
/// level of `line`, capped at [`MAX_INDENT_GUIDES`] (`16`).
pub fn indent_guides_for_line(
    line: &str,
    indent_unit: usize,
    tab_size: usize,
) -> Vec<(usize, usize)> {
    if indent_unit == 0 || tab_size == 0 || line.is_empty() {
        return Vec::new();
    }
    let mut ws: Vec<(usize, usize, usize)> = Vec::new();
    let mut column = 0usize;
    for (offset, b) in line.bytes().enumerate() {
        if b != b' ' && b != b'\t' {
            break;
        }
        let next = if b == b'\t' {
            column + tab_size - (column % tab_size)
        } else {
            column + 1
        };
        ws.push((offset, column, next));
        column = next;
    }
    let complete = (column / indent_unit).min(MAX_INDENT_GUIDES);
    if complete == 0 {
        return Vec::new();
    }
    let mut out: Vec<(usize, usize)> = Vec::with_capacity(complete);
    for level in 0..complete {
        let guide_col = level * indent_unit;
        if let Some(&(char_offset, from_col, _)) = ws
            .iter()
            .find(|&&(_, from_c, to_c)| from_c <= guide_col && guide_col < to_c)
            && out
                .last()
                .is_none_or(|&(prev_off, _)| prev_off != char_offset)
        {
            out.push((char_offset, from_col));
        }
    }
    out
}

/// Character byte offsets of each indent guide on `line` (1:1 with TS
/// `getIndentGuideCharacterOffsets`, capped at [`MAX_INDENT_GUIDES`]).
pub fn indent_guide_offsets(line: &str, indent_unit: usize, tab_size: usize) -> Vec<usize> {
    indent_guides_for_line(line, indent_unit, tab_size)
        .into_iter()
        .map(|(off, _)| off)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brackets_match_with_nesting_from_either_side() {
        let text = "f(a[b](c))";
        assert_eq!(brackets(text, 2), Some(Brackets::Matched(1..2, 9..10)));
        assert_eq!(brackets(text, 10), Some(Brackets::Matched(9..10, 1..2)));
        assert_eq!(brackets(text, 4), Some(Brackets::Matched(3..4, 5..6)));
        assert_eq!(brackets("x)", 2), Some(Brackets::Unmatched(1..2)));
        assert_eq!(brackets("abc", 1), None);

        let buf = Buffer::new(text);
        assert_eq!(
            brackets_in_buffer(&buf, 2),
            Some(Brackets::Matched(1..2, 9..10))
        );
    }

    #[test]
    fn selection_matches_and_trailing_whitespace() {
        let text = "let foo = foo + foo;\nfoo";
        assert_eq!(selection_matches(text, 4..7), vec![10..13, 16..19, 21..24]);
        assert!(selection_matches(text, 4..5).is_empty());
        assert!(selection_matches("a b\nc", 0..5).is_empty());
        assert_eq!(trailing_whitespace("a  \nb\t\nc"), vec![1..3, 5..6]);
    }

    #[test]
    fn indent_guides_match_ts_contract_and_cap_at_sixteen_columns() {
        assert_eq!(
            indent_guide_offsets("      return value", 2, 2),
            vec![0, 2, 4]
        );
        assert!(indent_guide_offsets(" return value", 2, 2).is_empty());
        assert_eq!(indent_guide_offsets("\t\tpass", 4, 4), vec![0, 1]);
        assert_eq!(indent_guide_offsets("  value  ", 2, 2), vec![0]);

        let deep = format!("{}x", "  ".repeat(25));
        let guides = indent_guide_offsets(&deep, 2, 2);
        assert_eq!(guides.len(), MAX_INDENT_GUIDES);
        assert_eq!(guides.last(), Some(&(2 * (MAX_INDENT_GUIDES - 1))));
    }
}
