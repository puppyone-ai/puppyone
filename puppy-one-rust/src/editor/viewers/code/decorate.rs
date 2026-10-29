//! The product code editor's passive decorations (`CodeMirrorCodeEditor`):
//! `bracketMatching()`, `highlightSelectionMatches({minSelectionLength: 2})`
//! and `highlightTrailingWhitespace()`, painted as Kit range decorations
//! with the product colours (`code-editor.css`). Ranges are UTF-8 offsets.
use std::ops::Range;

const PAIRS: [(char, char); 3] = [('(', ')'), ('[', ']'), ('{', '}')];
/// CodeMirror's `maxScanDistance`.
const SCAN: usize = 10_000;
/// `highlightSelectionMatches` `maxMatchCount`.
const MAX_MATCHES: usize = 100;

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
    }

    #[test]
    fn selection_matches_and_trailing_whitespace() {
        let text = "let foo = foo + foo;\nfoo";
        assert_eq!(selection_matches(text, 4..7), vec![10..13, 16..19, 21..24]);
        assert!(selection_matches(text, 4..5).is_empty());
        assert!(selection_matches("a b\nc", 0..5).is_empty());
        assert_eq!(trailing_whitespace("a  \nb\t\nc"), vec![1..3, 5..6]);
    }
}
