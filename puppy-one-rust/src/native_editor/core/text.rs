//! Inline text and marks; offsets are UTF-8 bytes, marks index Unicode scalars.
use std::ops::Range;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mark {
    pub bold: bool,
    pub italic: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Text {
    pub text: String,
    pub marks: Vec<Mark>,
}
impl Text {
    pub fn plain(text: impl Into<String>) -> Self {
        let text = text.into();
        Self {
            marks: vec![Mark::default(); text.chars().count()],
            text,
        }
    }
    pub(in crate::native_editor) fn push(&mut self, text: &str, mark: Mark) {
        self.text.push_str(text);
        self.marks
            .extend(std::iter::repeat_n(mark, text.chars().count()));
    }
}
pub(in crate::native_editor) fn slice(text: &Text, range: Range<usize>) -> Text {
    let a = text.text[..range.start].chars().count();
    let b = a + text.text[range.clone()].chars().count();
    Text {
        text: text.text[range].into(),
        marks: text.marks[a..b].to_vec(),
    }
}
pub(in crate::native_editor) fn concat(parts: &[Text]) -> Text {
    Text {
        text: parts.iter().map(|t| t.text.as_str()).collect(),
        marks: parts.iter().flat_map(|t| t.marks.iter().copied()).collect(),
    }
}
pub(in crate::native_editor) fn split(text: &Text) -> Vec<Text> {
    let mut start = 0;
    text.text
        .split('\n')
        .map(|part| {
            let value = slice(text, start..start + part.len());
            start += part.len() + 1;
            value
        })
        .collect()
}
