//! Link broker (`platform/brokers/link.rs`, `TA-50`): validates Markdown link
//! and external embed targets through `platform::policy::url`.
pub use super::super::policy::url::safe_href;

/// Validates an external `https:` embed URL against private/loopback host rules.
pub fn allowed_embed_href(href: &str) -> Option<String> {
    let clean = safe_href(href)?;
    super::super::policy::url::allowed_https_href(&clean)
}
