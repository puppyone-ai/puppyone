//! In-document fragment normalization and lookup
//! (product `core/links/markdownFragmentTargets.ts`).
use crate::editor::navigation;

/// Normalize a Markdown heading or HTML fragment identifier (strip optional
/// leading `#`, percent-decode, trim, lowercase).
pub fn fragment(value: &str) -> String {
    navigation::percent_decode(value.trim().strip_prefix('#').unwrap_or(value.trim()))
        .trim()
        .to_lowercase()
}
