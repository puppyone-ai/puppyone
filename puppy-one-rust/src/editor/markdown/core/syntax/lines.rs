//! Line-level syntax the product recognises with expressions rather than the
//! parser tree: heading / quote / rule line shapes (blockDecorations.ts),
//! fenced code blocks (features/code-block/codeBlockModel.ts), wiki links and
//! `~~strike~~` (markdownElements.ts addExtendedLineElements).
use super::{Element, Kind, Span};
use crate::editor::{markdown::core::links, text::buffer::Buffer};
use std::ops::Range;

/// `^(#{1,6})(\s|$)`: (level, marker length including the space).
pub fn heading_marker(text: &str) -> Option<(u8, usize)> {
    let hashes = text.bytes().take_while(|&b| b == b'#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    match text[hashes..].chars().next() {
        None => Some((hashes as u8, hashes)),
        Some(c) if c.is_whitespace() => Some((hashes as u8, hashes + c.len_utf8())),
        _ => None,
    }
}

/// `^(\s*>+\s?)`: length of the quote prefix.
pub fn blockquote_marker(text: &str) -> Option<usize> {
    let lead = text.len() - text.trim_start().len();
    let quotes = text[lead..].bytes().take_while(|&b| b == b'>').count();
    if quotes == 0 {
        return None;
    }
    let end = lead + quotes;
    Some(
        end + text[end..]
            .chars()
            .next()
            .filter(|c| c.is_whitespace())
            .map_or(0, char::len_utf8),
    )
}

/// `^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$`.
pub fn is_rule_line(text: &str) -> bool {
    let lead = text.len() - text.trim_start().len();
    if lead > 3 || !text[..lead].chars().all(char::is_whitespace) {
        return false;
    }
    let body = text[lead..].trim_end();
    let Some(c) = body.chars().next() else {
        return false;
    };
    matches!(c, '-' | '*' | '_') && body.len() >= 3 && body.chars().all(|x| x == c)
}

/// `^\s*(`{3,}|~{3,})`: the line opens or closes a fence (class only).
pub fn is_fence_line(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with("```") || t.starts_with("~~~")
}

#[derive(Clone, Debug, PartialEq)]
pub struct Fence {
    /// From the opening line start to the closing (or last) line end.
    pub range: Span,
    /// Source line indices covered, opening and closing lines included.
    pub lines: Range<usize>,
    pub closed: bool,
    pub language: String,
    /// Raw info string after the fence.
    pub info: String,
    /// Indentation and fence character run of the opening line.
    pub indent: usize,
    /// Source of the code lines between the fences (empty at the end of
    /// the opening line when there are none).
    pub code: Span,
}

impl Fence {
    #[cfg(test)]
    pub fn code_lines(&self) -> Range<usize> {
        self.lines.start + 1..if self.closed {
            self.lines.end - 1
        } else {
            self.lines.end
        }
    }
}

/// getMarkdownCodeBlock applied line by line, skipping covered lines.
pub fn fences(doc: &Buffer) -> Vec<Fence> {
    let mut out = Vec::new();
    let mut line = 0;
    let count = doc.line_count();
    while line < count {
        let text = doc.line(line);
        let indent = text.len() - text.trim_start().len();
        let rest = &text[indent..];
        let (fc, run) = match rest.as_bytes().first() {
            Some(&c @ (b'`' | b'~')) => (c, rest.bytes().take_while(|&b| b == c).count()),
            _ => (0, 0),
        };
        if run < 3 || (fc == b'`' && rest[run..].contains('`')) {
            line += 1;
            continue;
        }
        let info = rest[run..].to_owned();
        let language = info.split_whitespace().next().unwrap_or("").to_owned();
        let mut end = line + 1;
        let mut closed = false;
        while end < count {
            let t = doc.line(end).trim();
            let n = t.bytes().take_while(|&b| b == fc).count();
            end += 1;
            if n >= run && n == t.len() {
                closed = true;
                break;
            }
        }
        let range = doc.line_range(line).start..doc.line_range(end - 1).end;
        let body = line + 1..if closed { end - 1 } else { end };
        let code = if body.is_empty() {
            doc.line_range(line).end..doc.line_range(line).end
        } else {
            doc.line_range(body.start).start..doc.line_range(body.end - 1).end
        };
        out.push(Fence {
            range,
            lines: line..end,
            closed,
            language,
            info,
            indent,
            code,
        });
        line = end;
    }
    out
}

/// Wiki links and `~~strike~~` per source line outside block features
/// (`blocks`: sorted line ranges of fenced code and tables).
pub fn add_line_elements(doc: &Buffer, blocks: &[Range<usize>], elements: &mut Vec<Element>) {
    let mut block = blocks.iter().peekable();
    for line in 0..doc.line_count() {
        while block.peek().is_some_and(|b| b.end <= line) {
            block.next();
        }
        if block.peek().is_some_and(|b| b.contains(&line)) {
            continue;
        }
        let range = doc.line_range(line);
        let text = doc.line(line);
        let bytes = text.as_bytes();
        for token in links::find_wiki_links(text) {
            // `![[…]]` is an embed envelope, not a wiki link label.
            if token.range.start > 0
                && bytes[token.range.start - 1] == b'!'
                && !links::is_escaped(bytes, token.range.start - 1)
            {
                continue;
            }
            let base = range.start;
            let (from, to) = (base + token.range.start, base + token.range.end);
            let visible = base + token.visible.start..base + token.visible.end;
            let mut e = Element::new(
                Kind::WikiLink,
                from..to,
                vec![from..visible.start, visible.end..to],
                Some(visible),
            );
            e.href = Some(token.target);
            elements.push(e);
        }
        for (open, close) in strikes(text) {
            let (from, to) = (range.start + open, range.start + close + 2);
            elements.push(Element::new(
                Kind::Strike,
                from..to,
                vec![from..from + 2, to - 2..to],
                Some(from + 2..to - 2),
            ));
        }
    }
}

/// `/(~~)(\S(?:.*?\S)?)(~~)/g` over one line: (opening, closing) indices.
fn strikes(text: &str) -> Vec<(usize, usize)> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let tilde = |k: usize| {
        chars.get(k).is_some_and(|c| c.1 == '~') && chars.get(k + 1).is_some_and(|c| c.1 == '~')
    };
    let mut out = Vec::new();
    let mut k = 0;
    while k + 5 <= chars.len() {
        if !tilde(k) || chars.get(k + 2).is_none_or(|c| c.1.is_whitespace()) {
            k += 1;
            continue;
        }
        // Lazy: the first `~~` after ≥1 content char that follows a non-space.
        let found = (k + 3..chars.len().saturating_sub(1))
            .find(|&j| tilde(j) && !chars[j - 1].1.is_whitespace());
        match found {
            Some(j) => {
                out.push((chars[k].0, chars[j].0));
                k = j + 2;
            }
            None => k += 1,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_shapes_match_the_product_expressions() {
        assert_eq!(heading_marker("## Lists"), Some((2, 3)));
        assert_eq!(heading_marker("##"), Some((2, 2)));
        assert_eq!(heading_marker("#x"), None);
        assert_eq!(heading_marker("####### x"), None);
        assert_eq!(blockquote_marker("> quote"), Some(2));
        assert_eq!(blockquote_marker("  >> q"), Some(5));
        assert!(
            is_rule_line("---")
                && is_rule_line(" * * *".replace(' ', "").as_str())
                && !is_rule_line("--")
        );
        assert_eq!(strikes("a ~~b c~~ d ~~ e~~ ~~f~~"), vec![(2, 7), (19, 22)]);
        assert_eq!(strikes("~~x~~"), vec![(0, 3)]);
    }

    #[test]
    fn fences_follow_the_line_scanner() {
        let doc = Buffer::new("a\n```rust\nfn x() {}\n```\nb\n~~~\nopen");
        let f = fences(&doc);
        assert_eq!(f.len(), 2);
        assert_eq!(
            (f[0].lines.clone(), f[0].closed, f[0].language.as_str()),
            (1..4, true, "rust")
        );
        assert_eq!((f[1].lines.clone(), f[1].closed), (5..7, false));
        assert_eq!(f[0].code_lines(), 2..3);
    }
}
