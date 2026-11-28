//! Math block model and rich-source budget diagnostics (`mathModel.ts`, `MA-04`: zero `gpui`).
use crate::editor::markdown::core::plans::execution::MATH_MAX_RICH_SOURCE_UNITS;
use std::ops::Range;

/// A display formula (`MarkdownMathBlock`).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct MathBlock {
    /// Opening delimiter line start to closing line end.
    pub range: Range<usize>,
    /// The formula's source between the delimiters.
    pub content: Range<usize>,
    /// The Unicode rendering shown until the typeset formula arrives.
    pub text: String,
    /// The TeX source KaTeX typesets.
    pub source: String,
}

/// Validates a math formula against the canonical UTF-16 rich-preview source budget.
pub fn source_diagnostic(source: &str) -> Option<&'static str> {
    if source.trim().is_empty() {
        Some("math.empty-source")
    } else if source
        .encode_utf16()
        .take(MATH_MAX_RICH_SOURCE_UNITS + 1)
        .count()
        > MATH_MAX_RICH_SOURCE_UNITS
    {
        Some("math.source-too-large")
    } else {
        None
    }
}
