//! A text leaf: one source range shown through a GPUI Kit paragraph. Hidden
//! ranges are left out of the leaf text (zero width, like the product's
//! `cm-md-hidden-syntax`), tabs expand to their stops, and offsets map both
//! ways between source and leaf text.
use super::decoration::{Mark, MarkStyle};
use gpui_kit::base::text::editor_host::{InlineNode, LinkMark, Paragraph, TextMark};
use std::ops::Range;

/// `tab-size` of `.cm-content` (CodeMirror's default theme: 4).
pub const TAB_SIZE: usize = 4;

#[derive(Clone, Debug, PartialEq)]
struct Piece {
    display: usize,
    display_len: usize,
    /// Relative to the leaf's source start.
    source: usize,
    source_len: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LeafText {
    /// Absolute source range at build time.
    pub source: std::ops::Range<usize>,
    pub text: String,
    pieces: Vec<Piece>,
    /// Display ranges and their Kit marks, non-overlapping.
    pub marks: Vec<(Range<usize>, MarkStyle)>,
}

impl LeafText {
    /// `hidden` and `marks` may be any superset of those touching `source`
    /// (sorted by start). `strike_all` strikes the whole text (task done).
    pub fn build(doc: &str, source: Range<usize>, hidden: &[Range<usize>], marks: &[Mark], strike_all: bool) -> Self {
        Self::build_with_tabs(doc, source, hidden, marks, strike_all, TAB_SIZE)
    }

    /// As `build` with an explicit `tab-size` (code panels use 2 or 4).
    pub fn build_with_tabs(doc: &str, source: Range<usize>, hidden: &[Range<usize>], marks: &[Mark], strike_all: bool, tab_size: usize) -> Self {
        let mut text = String::new();
        let mut pieces = Vec::new();
        let mut cursor = source.start;
        let base = source.start;
        let mut column = 0usize;
        let push_text = |from: usize, to: usize, text: &mut String, pieces: &mut Vec<Piece>, column: &mut usize| {
            let mut run_start = from;
            for (i, ch) in doc[from..to].char_indices() {
                if ch == '\n' {
                    *column = 0;
                } else if ch == '\t' {
                    let at = from + i;
                    if at > run_start {
                        pieces.push(Piece { display: text.len(), display_len: at - run_start, source: run_start - base, source_len: at - run_start });
                        text.push_str(&doc[run_start..at]);
                    }
                    let width = tab_size - *column % tab_size;
                    pieces.push(Piece { display: text.len(), display_len: width, source: at - base, source_len: 1 });
                    text.extend(std::iter::repeat_n(' ', width));
                    *column += width;
                    run_start = at + 1;
                } else {
                    *column += 1;
                }
            }
                if to > run_start {
                pieces.push(Piece { display: text.len(), display_len: to - run_start, source: run_start - base, source_len: to - run_start });
                text.push_str(&doc[run_start..to]);
            }
        };
        let first = hidden.partition_point(|r| r.end <= source.start);
        for r in hidden[first..].iter().take_while(|r| r.start < source.end) {
            let start = r.start.max(cursor);
            if start > cursor {
                push_text(cursor, start, &mut text, &mut pieces, &mut column);
            }
            let end = r.end.min(source.end).max(start);
            pieces.push(Piece { display: text.len(), display_len: 0, source: start - base, source_len: end - start });
            cursor = end.max(cursor);
        }
        if cursor < source.end {
            push_text(cursor, source.end, &mut text, &mut pieces, &mut column);
        }
        let mut leaf = Self { source: source.clone(), text, pieces, marks: Vec::new() };
        let mut out: Vec<(Range<usize>, MarkStyle)> = Vec::new();
        for m in marks.iter().filter(|m| m.range.end > source.start && m.range.start < source.end) {
            let a = leaf.to_display(m.range.start.max(source.start) - base, true);
            let b = leaf.to_display(m.range.end.min(source.end) - base, false);
            if a < b {
                out.push((a..b, m.style.clone()));
            }
        }
        if strike_all && !leaf.text.is_empty() {
            out = strike_over(out, leaf.text.len());
        }
        leaf.marks = out;
        leaf
    }

    pub fn source_len(&self) -> usize {
        self.source.len()
    }

    /// Display offset of a relative source offset. Offsets inside a hidden
    /// or expanded range resolve to its start, or its end with `after`.
    pub fn to_display(&self, offset: usize, after: bool) -> usize {
        for p in &self.pieces {
            if offset < p.source {
                return p.display;
            }
            if offset < p.source + p.source_len || (offset == p.source && p.source_len == 0) {
                if p.display_len == p.source_len {
                    return p.display + (offset - p.source);
                }
                return if after && offset > p.source { p.display + p.display_len } else { p.display };
            }
        }
        self.text.len()
    }

    /// Relative source offset of a display (caret) index. At a hidden range
    /// the position after it is chosen (the visible text that follows),
    /// except at the end of the leaf.
    pub fn to_source(&self, index: usize) -> usize {
        let mut result = None;
        for p in &self.pieces {
            if index < p.display {
                break;
            }
            if p.display_len == 0 {
                if index == p.display {
                    result = Some(p.source + p.source_len);
                }
                continue;
            }
            if index < p.display + p.display_len {
                return if p.display_len == p.source_len {
                    p.source + (index - p.display)
                } else if index - p.display < p.display_len.div_ceil(2) {
                    p.source
                } else {
                    p.source + p.source_len
                };
            }
            result = Some(p.source + p.source_len);
        }
        if index >= self.text.len() {
            return self.source_len();
        }
        result.unwrap_or(0)
    }

    /// The Kit paragraph for this leaf.
    pub fn paragraph(&self, key: u64) -> Paragraph {
        let marks = self
            .marks
            .iter()
            .map(|(r, m)| {
                (
                    r.clone(),
                    TextMark {
                        bold: m.bold,
                        italic: m.italic,
                        strikethrough: m.strike,
                        code: m.code,
                        link: m.link.as_ref().map(|url| LinkMark { url: url.clone(), identifier: None, title: None }),
                        ..Default::default()
                    },
                )
            })
            .collect();
        let mut p = Paragraph::default();
        p.push(InlineNode::new(self.text.clone()).marks(marks));
        p.with_leaf_key(key)
    }
}

/// Add a strikethrough over `0..len`, splitting existing marks.
fn strike_over(marks: Vec<(Range<usize>, MarkStyle)>, len: usize) -> Vec<(Range<usize>, MarkStyle)> {
    let mut out = Vec::new();
    let mut at = 0;
    for (r, mut m) in marks {
        if r.start > at {
            out.push((at..r.start, MarkStyle { strike: true, ..Default::default() }));
        }
        m.strike = true;
        at = r.end;
        out.push((r, m));
    }
    if at < len {
        out.push((at..len, MarkStyle { strike: true, ..Default::default() }));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_ranges_and_tabs_map_both_ways() {
        let doc = "a **bold** z\tq";
        let marks = [Mark { range: 4..8, style: MarkStyle { bold: true, ..Default::default() } }];
        let leaf = LeafText::build(doc, 0..doc.len(), &[2..4, 8..10], &marks, false);
        assert_eq!(leaf.text, "a bold z    q");
        assert_eq!(leaf.marks, vec![(2..6, MarkStyle { bold: true, ..Default::default() })]);
        // Hidden markers: both edges show at the same display offset.
        assert_eq!(leaf.to_display(2, false), 2);
        assert_eq!(leaf.to_display(3, true), 2);
        assert_eq!(leaf.to_display(4, false), 2);
        assert_eq!(leaf.to_display(8, false), 6);
        assert_eq!(leaf.to_display(10, false), 6);
        // Display → source prefers the text after a hidden range.
        assert_eq!(leaf.to_source(2), 4);
        assert_eq!(leaf.to_source(6), 10);
        assert_eq!(leaf.to_source(5), 7);
        // The tab after "z" (visible column 8) expands to the next stop.
        assert_eq!(leaf.to_display(12, false), 8);
        assert_eq!(leaf.to_display(13, false), 12);
        assert_eq!(leaf.to_source(9), 12);
        assert_eq!(leaf.to_source(11), 13);
        assert_eq!(leaf.to_source(leaf.text.len()), doc.len());
        let empty = LeafText::build("", 0..0, &[], &[], true);
        assert_eq!((empty.text.as_str(), empty.to_source(0)), ("", 0));
    }
}
