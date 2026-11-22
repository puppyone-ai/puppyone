//! HTML sanitization profile policy (`platform/policy/html_profiles.rs`,
//! `TA-51`, `MA-14`).

/// Maximum HTML element nesting depth accepted by the parser and renderer (`TA-51`).
pub const MAX_HTML_DEPTH: usize = 64;
pub const HTML_MAX_DEPTH: usize = MAX_HTML_DEPTH;

/// `BLOCKED_EXECUTABLE_TAGS`: dropped whether opened/closed, void, or self-closing.
pub const BLOCKED_TAGS: &[&str] = &[
    "base", "embed", "form", "iframe", "input", "link", "meta", "object", "script", "style",
    "template",
];

/// `BLOCKED_TAGS_DROPPED_WITH_CONTENT`: their payload never surfaces as text.
/// The other blocked tags (such as a `form` wrapper) unwrap to their children.
pub const DROPPED_WITH_CONTENT: &[&str] =
    &["embed", "iframe", "object", "script", "style", "template"];

pub fn is_blocked_tag(tag: &str) -> bool {
    BLOCKED_TAGS.contains(&tag.to_ascii_lowercase().as_str())
}

pub use is_blocked_tag as is_blocked_html_tag;
