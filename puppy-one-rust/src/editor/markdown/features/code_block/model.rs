//! Fenced code block model (`codeBlockModel.ts`, `MA-04`: zero `gpui`).
use std::ops::Range;

/// A fenced code block (`codeBlockModel.ts`).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct CodeBlock {
    /// Opening line start to closing (or last) line end.
    pub range: Range<usize>,
    /// The code lines between the fences.
    pub code: Range<usize>,
    pub language: String,
}
