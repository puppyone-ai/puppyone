//! Math inline (`$formula$`) and display (`$$` … `$$`) syntax scanners
//! (product `features/math/`).
use super::{MathBlock, tex};
use crate::editor::{markdown::shared::token_scan, text::buffer::Buffer};
use std::ops::Range;

/// `$formula$` on one line (`scanInlineMath`): no `$$`, no space just inside
/// either `$`, and not a price range such as `$5-$10`.
pub fn scan_inline_math(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let space = |i: usize| bytes.get(i).is_none_or(|b| b.is_ascii_whitespace());
    let mut out = Vec::new();
    let mut open = 0;
    while open < bytes.len() {
        if bytes[open] != b'$'
            || bytes.get(open + 1) == Some(&b'$')
            || token_scan::is_escaped(bytes, open)
            || space(open + 1)
        {
            open += 1;
            continue;
        }
        let mut next = open;
        let mut close = open + 1;
        while close < bytes.len() {
            if bytes[close] != b'$' || token_scan::is_escaped(bytes, close) {
                close += 1;
                continue;
            }
            if bytes[close - 1] == b'$'
                || bytes.get(close + 1) == Some(&b'$')
                || bytes[close - 1].is_ascii_whitespace()
            {
                next = if bytes.get(close + 1) == Some(&b'$') {
                    close + 1
                } else {
                    close - 1
                };
                break;
            }
            let source = &text[open + 1..close];
            let currency = bytes.get(close + 1).is_some_and(u8::is_ascii_digit)
                && source
                    .trim_start_matches(['+', '-'])
                    .trim_end_matches(['-', '–', '—'])
                    .chars()
                    .all(|c| c.is_ascii_digit() || c == ',' || c == '.')
                && source
                    .trim_start_matches(['+', '-'])
                    .starts_with(|c: char| c.is_ascii_digit());
            if !currency {
                out.push((open, close));
            }
            next = close;
            break;
        }
        open = next.max(open) + 1;
    }
    out
}

/// `^\s{0,3}\$\$\s*$`.
pub fn is_display_delimiter(text: &str) -> bool {
    let lead = text.len() - text.trim_start_matches(' ').len();
    lead <= 3 && text.trim() == "$$"
}

/// `getMarkdownMathBlock`: `$$` lines around a formula that is not empty,
/// outside code, bounded to `line_bounds` (`TA-32` incremental compilation).
pub fn blocks_in_range(
    doc: &Buffer,
    code_lines: &[Range<usize>],
    line_bounds: Range<usize>,
) -> Vec<MathBlock> {
    let in_code = |line: usize| {
        let i = code_lines.partition_point(|r| r.end <= line);
        code_lines.get(i).is_some_and(|r| r.start <= line)
    };
    let mut out = Vec::new();
    let mut line = line_bounds.start;
    let count = line_bounds.end.min(doc.line_count());
    while line < count {
        if in_code(line) || !is_display_delimiter(&doc.line_cow(line)) {
            line += 1;
            continue;
        }
        let Some(close) =
            (line + 1..count).find(|&l| is_display_delimiter(&doc.line_cow(l)) && !in_code(l))
        else {
            break;
        };
        let content = doc.line_range(line).end + 1..doc.line_range(close).start.saturating_sub(1);
        let content = content.start..content.end.max(content.start);
        let source_cow = doc.slice_cow(content.clone());
        let source = source_cow.as_ref();
        let fence_inside = {
            let a = code_lines.partition_point(|r| r.end <= line + 1);
            code_lines.get(a).is_some_and(|r| r.start < close)
        };
        if !source.trim().is_empty() && !fence_inside {
            out.push(MathBlock {
                range: doc.line_range(line).start..doc.line_range(close).end,
                content,
                text: tex::convert(source),
                source: source.to_owned(),
            });
        }
        line = close + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn inline_math_scanner_follows_the_product_rules() {
        assert_eq!(scan_inline_math("a $x^2$ b"), vec![(2, 6)]);
        assert!(scan_inline_math("costs $5 and $10").is_empty());
        assert!(scan_inline_math("$$x$$ and $ y$").is_empty());
        assert!(scan_inline_math(r"\$x$").is_empty());
    }
}
