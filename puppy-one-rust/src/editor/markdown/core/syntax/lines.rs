//! Line-level syntax the product recognises with expressions rather than the
//! parser tree: heading / quote / rule line shapes (`blockDecorations.ts`),
//! fenced code blocks (`codeBlockModel.ts`), wiki links, `~~strike~~`, and
//! feature-registered line recognizers (`TA-30`, `TA-33`, `TA-40`).
use super::{Element, Kind, Span};
use crate::editor::{
    markdown::core::{
        feature::{self, Features},
        links,
    },
    text::buffer::Buffer,
};
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

/// Scan fenced code blocks across `line_window` of `doc` without materialising
/// `doc.flat` (`TA-01`, `TA-31`).
pub fn fences_in_lines(doc: &Buffer, line_window: Range<usize>) -> Vec<Fence> {
    let mut out = Vec::new();
    let mut line = line_window.start;
    let end_limit = line_window.end.min(doc.line_count());
    while line < end_limit {
        let text = doc.line_cow(line);
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
        let language = crate::editor::markdown::shared::fence::parse_fence_info(&info).language;
        let mut end = line + 1;
        let mut closed = false;
        while end < end_limit {
            let line_cow = doc.line_cow(end);
            let t = line_cow.trim();
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
            let e = doc.line_range(line).end;
            e..e
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

#[cfg(test)]
pub fn fences(doc: &Buffer) -> Vec<Fence> {
    fences_in_lines(doc, 0..doc.line_count())
}

fn clamp_element(doc: &Buffer, mut e: Element) -> Option<Element> {
    e.range = doc.clamp_range(e.range);
    if e.range.is_empty() {
        return None;
    }
    e.markers = e.markers.into_iter().map(|m| doc.clamp_range(m)).collect();
    e.content = e.content.map(|c| doc.clamp_range(c));
    e.line = e.line.map(|l| doc.clamp_range(l));
    Some(e)
}

/// The source ranges that share the page's inline policy. Table cells are
/// separate regions, so delimiters in neighboring cells cannot form a pair.
/// Code and feature-owned blocks remain excluded. All inputs are sorted;
/// walking their cursors keeps this pass linear in the parsed window.
pub fn inline_ranges(
    doc: &Buffer,
    line_window: Range<usize>,
    blocks: &[Range<usize>],
    tables: &[Span],
    cells: &[Span],
) -> Vec<Span> {
    let mut block = blocks.iter().peekable();
    let mut table = tables.iter().peekable();
    let mut cell = cells.iter().peekable();
    let mut out = Vec::new();
    for line in line_window.start..line_window.end.min(doc.line_count()) {
        while block.peek().is_some_and(|b| b.end <= line) {
            block.next();
        }
        if block.peek().is_some_and(|b| b.contains(&line)) {
            continue;
        }
        let range = doc.line_range(line);
        while table.peek().is_some_and(|t| t.end <= range.start) {
            table.next();
        }
        if table
            .peek()
            .is_some_and(|t| t.start < range.end && t.end > range.start)
        {
            while cell.peek().is_some_and(|c| c.end <= range.start) {
                cell.next();
            }
            while cell.peek().is_some_and(|c| c.start < range.end) {
                let c = cell.next().unwrap();
                if !c.is_empty() {
                    out.push(c.clone());
                }
            }
        } else {
            out.push(range);
        }
    }
    out
}

/// Wiki links, standard images the CommonMark parser leaves as text (a
/// destination with spaces), `~~strike~~`, `==highlight==`, `%%comment%%`,
/// and feature `recognize_inline` hooks over each eligible line or table
/// cell.
pub fn add_inline_elements(
    doc: &Buffer,
    ranges: &[Span],
    features: Features,
    elements: &mut Vec<Element>,
) {
    for range in ranges {
        let text_cow = doc.slice_cow(range.clone());
        let text = text_cow.as_ref();
        let bytes = text.as_bytes();
        for token in links::find_wiki_links(text) {
            if token.range.start > 0
                && bytes[token.range.start - 1] == b'!'
                && !links::is_escaped(bytes, token.range.start - 1)
            {
                let kind = if is_image_path(&token.target) {
                    Some(Kind::ImageEmbed)
                } else if is_video_path(&token.target) {
                    Some(Kind::VideoEmbed)
                } else {
                    None
                };
                if let Some(kind) = kind {
                    let from = range.start + token.range.start - 1;
                    let to = range.start + token.range.end;
                    let mut e = Element::new(kind, from..to, vec![from..to], None);
                    e.href = Some(token.target.clone());
                    let inner = &text[token.range.start + 2..token.range.end - 2];
                    e.text = inner
                        .split_once('|')
                        .map(|(_, alias)| alias.trim().to_owned());
                    elements.push(e);
                }
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
        if text.contains("![") {
            for token in links::find_images(text) {
                let (from, to) = (
                    range.start + token.range.start,
                    range.start + token.range.end,
                );
                let parsed = elements.iter().any(|e| {
                    (e.kind == Kind::Image && e.range.start == from)
                        || (e.kind == Kind::InlineCode && e.range.start < to && from < e.range.end)
                });
                if parsed {
                    continue;
                }
                let alt = range.start + token.alt.start..range.start + token.alt.end;
                let markers = vec![
                    from..from + 2,
                    alt.end..alt.end + 1,
                    alt.end + 1..alt.end + 2,
                    to - 1..to,
                ];
                let mut e = Element::new(Kind::Image, from..to, markers, Some(alt));
                e.href = Some(token.href);
                e.text = token.title;
                elements.push(e);
            }
        }
        for (open, close) in super::inline_syntax::highlights(text) {
            let (from, to) = (range.start + open, range.start + close + 2);
            elements.push(Element::new(
                Kind::Highlight,
                from..to,
                vec![from..from + 2, to - 2..to],
                Some(from + 2..to - 2),
            ));
        }
        for comment in super::inline_syntax::percent_comments(text) {
            let r = range.start + comment.start..range.start + comment.end;
            elements.push(Element::new(Kind::Comment, r.clone(), vec![], Some(r)));
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
        // TA-30, TA-33, TA-40: feature-contributed inline recognizers, isolated
        // against panics and clamped to valid document UTF-8 boundaries.
        for f in features {
            let mut stage = Vec::new();
            if feature::catch_feature_panic(f.id(), "recognize_inline", || {
                f.recognize_inline(range.start, text, &mut stage);
            })
            .is_some()
            {
                for elem in stage {
                    if let Some(clamped) = clamp_element(doc, elem) {
                        elements.push(clamped);
                    }
                }
            }
        }
    }
}

/// An image file by its extension (`OBSIDIAN_IMAGE_EXTENSIONS`).
pub fn is_image_path(target: &str) -> bool {
    let path = target.split(['#', '?']).next().unwrap_or(target);
    path.rsplit_once('.').is_some_and(|(_, ext)| {
        matches!(
            ext.to_ascii_lowercase().as_str(),
            "avif" | "bmp" | "gif" | "jpeg" | "jpg" | "png" | "svg" | "webp"
        )
    })
}

/// A video file by its extension (`VIDEO_EXTENSIONS`: what the engine
/// plays).
pub fn is_video_path(target: &str) -> bool {
    let path = target.split(['#', '?']).next().unwrap_or(target);
    path.rsplit_once('.').is_some_and(|(_, ext)| {
        matches!(
            ext.to_ascii_lowercase().as_str(),
            "3g2" | "3gp" | "3gpp" | "m4v" | "mov" | "mp4" | "ogv" | "qt" | "webm"
        )
    })
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
