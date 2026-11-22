//! Footnote syntax scanning helpers (`features/footnote/footnoteModel.ts`).
use crate::editor::markdown::shared::token_scan;

/// `[^id]` at `at` in `text` (`/^\[\^([^\]\s]+)\]/`): the id's length.
pub fn footnote_marker(text: &str, at: usize) -> Option<usize> {
    let rest = text.get(at..)?.strip_prefix("[^")?;
    let len = rest.find(|c: char| c == ']' || c.is_whitespace())?;
    (len > 0 && rest[len..].starts_with(']')).then_some(len)
}

/// Whether the footnote reference at `at` is backslash-escaped.
pub fn is_escaped(bytes: &[u8], at: usize) -> bool {
    token_scan::is_escaped(bytes, at)
}
