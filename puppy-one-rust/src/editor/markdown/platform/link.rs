//! Link broker (`TA-50`): validates Markdown link and embed targets through
//! the format's canonical URL and workspace-reference policy.
use super::policy;

/// Returns the canonical safe `href` if permitted to activate (`getSafeMarkdownHref`).
pub fn safe_href(raw: &str) -> Option<String> {
    crate::editor::markdown::navigation::safe_href(raw)
}

/// Validates an external `https:` embed URL against private/loopback host rules.
pub fn allowed_embed_href(href: &str) -> Option<String> {
    let clean = safe_href(href)?;
    policy::allowed_https_href(&clean)
}
