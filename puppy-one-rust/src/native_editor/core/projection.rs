//! One visible coordinate space for the whole document.
use super::{
    document::{Document, Kind},
    text::{Mark, Text},
};
use std::ops::Range;
#[derive(Clone, Debug)]
pub struct Span {
    pub key: (usize, usize),
    pub range: Range<usize>,
}
#[derive(Clone, Debug, Default)]
pub struct Projection {
    pub text: Text,
    pub spans: Vec<Span>,
}
impl Projection {
    pub fn new(document: &Document) -> Self {
        let mut result = Self::default();
        for (b, block) in document.blocks.iter().enumerate() {
            for (n, text) in block.kind.texts().iter().enumerate() {
                if !result.spans.is_empty() {
                    let separator = match &block.kind {
                        Kind::Table { align, .. } if n > 0 && n % align.len() != 0 => '\t',
                        _ => '\n',
                    };
                    result.text.text.push(separator);
                    result.text.marks.push(Mark::default());
                }
                let start = result.text.text.len();
                result.text.text.push_str(&text.text);
                result.text.marks.extend_from_slice(&text.marks);
                result.spans.push(Span {
                    key: (b, n),
                    range: start..result.text.text.len(),
                });
            }
        }
        result
    }
    pub fn at(&self, offset: usize) -> &Span {
        self.spans
            .iter()
            .find(|s| offset <= s.range.end)
            .unwrap_or_else(|| self.spans.last().expect("document has text"))
    }
    pub fn offset(&self, key: (usize, usize)) -> usize {
        self.spans
            .iter()
            .find(|s| s.key == key)
            .map(|s| s.range.start)
            .unwrap_or(0)
    }
}
