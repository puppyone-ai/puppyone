//! Document text with a line index. Offsets are UTF-8 byte positions; lines are
//! separated by `\n` (the document session normalises line endings on read and
//! restores them on save).
use std::ops::Range;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Buffer {
    text: String,
    /// Byte offset of every line start; `line_starts[0] == 0`.
    line_starts: Vec<usize>,
}

impl Buffer {
    pub fn new(text: impl Into<String>) -> Self {
        let text = text.into();
        let mut buffer = Self {
            text,
            line_starts: vec![0],
        };
        buffer.reindex_from(0);
        buffer
    }
    pub fn as_str(&self) -> &str {
        &self.text
    }
    pub fn len(&self) -> usize {
        self.text.len()
    }
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }
    pub fn slice(&self, range: Range<usize>) -> &str {
        &self.text[range]
    }
    pub fn line_count(&self) -> usize {
        self.line_starts.len()
    }
    /// Byte range of line `index`, excluding its line break.
    pub fn line_range(&self, index: usize) -> Range<usize> {
        let start = self.line_starts[index];
        let end = self
            .line_starts
            .get(index + 1)
            .map_or(self.text.len(), |next| next - 1);
        start..end
    }
    pub fn line(&self, index: usize) -> &str {
        &self.text[self.line_range(index)]
    }
    /// Index of the line containing `offset` (a line break belongs to its line).
    pub fn line_index(&self, offset: usize) -> usize {
        match self.line_starts.binary_search(&offset.min(self.text.len())) {
            Ok(index) => index,
            Err(index) => index - 1,
        }
    }
    /// Snap `offset` to the nearest character boundary at or before it.
    pub fn clamp(&self, offset: usize) -> usize {
        let mut offset = offset.min(self.text.len());
        while !self.text.is_char_boundary(offset) {
            offset -= 1;
        }
        offset
    }
    pub fn replace(&mut self, range: Range<usize>, insert: &str) {
        self.text.replace_range(range.clone(), insert);
        let line = self.line_index(range.start);
        self.reindex_from(line);
    }
    fn reindex_from(&mut self, line: usize) {
        let start = self.line_starts[line];
        self.line_starts.truncate(line + 1);
        self.line_starts.extend(
            self.text[start..]
                .match_indices('\n')
                .map(|(index, _)| start + index + 1),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lines_and_edits_keep_the_index_consistent() {
        let mut b = Buffer::new("a\nbc\n\nd");
        assert_eq!(b.line_count(), 4);
        assert_eq!(b.line(1), "bc");
        assert_eq!(b.line(2), "");
        assert_eq!(b.line_index(2), 1);
        assert_eq!(b.line_index(4), 1);
        assert_eq!(b.line_index(5), 2);
        b.replace(2..4, "x\ny");
        assert_eq!(b.as_str(), "a\nx\ny\n\nd");
        assert_eq!(b.line_count(), 5);
        assert_eq!(b.line(2), "y");
        assert_eq!(b, Buffer::new("a\nx\ny\n\nd"));
        assert_eq!(Buffer::new("é").clamp(1), 0);
    }
}
