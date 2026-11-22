//! Link broker (`TA-50`): validates Markdown link and embed targets through
//! the format's canonical URL and workspace-reference policy.
//! Moves into `platform/brokers/link.rs` and `platform/policy/url.rs` in Step M6.
use super::policy;
use regex::Regex;
use std::sync::LazyLock;

/// `getSafeMarkdownHref`: validate the canonical value that will be opened.
pub fn safe_href(value: &str) -> Option<String> {
    static ENTITY: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));").unwrap());
    static CONTROLS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)[\x00-\x1f\x7f]|%(?:0[0-9a-f]|1[0-9a-f]|7f)").unwrap());
    static SCHEME: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^[a-z][a-z0-9+.-]*:").unwrap());
    static SMUGGLING: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^[a-z][a-z0-9+.-]*\s*:").unwrap());
    let decoded = ENTITY.replace_all(value, |c: &regex::Captures| {
        if let Some(name) = c.get(3) {
            return match name.as_str().to_ascii_lowercase().as_str() {
                "amp" => "&",
                "apos" => "'",
                "gt" => ">",
                "lt" => "<",
                "nbsp" => "\u{a0}",
                "quot" => "\"",
                _ => &c[0],
            }
            .to_owned();
        }
        let (digits, radix) = c
            .get(1)
            .map(|m| (m.as_str(), 10))
            .unwrap_or_else(|| (c.get(2).unwrap().as_str(), 16));
        u32::from_str_radix(digits, radix)
            .ok()
            .filter(|&n| n != 0)
            .and_then(char::from_u32)
            .unwrap_or('\u{fffd}')
            .to_string()
    });
    if CONTROLS.is_match(&decoded) {
        return None;
    }
    let value = decoded.trim();
    if value.is_empty() || value.starts_with("//") {
        return None;
    }
    if ["#", "/", "./", "../"]
        .iter()
        .any(|prefix| value.starts_with(prefix))
    {
        return Some(value.into());
    }
    if !SCHEME.is_match(value) {
        return (!SMUGGLING.is_match(value)
            && !value
                .chars()
                .any(|c| c.is_whitespace() || "<>\"'`".contains(c)))
        .then(|| value.into());
    }
    let url = url::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "mailto")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.into())
}

/// Validates an external `https:` embed URL against private/loopback host rules.
pub fn allowed_embed_href(href: &str) -> Option<String> {
    let clean = safe_href(href)?;
    policy::allowed_https_href(&clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `markdownUrlPolicy.test.ts`: control characters (raw, entity-encoded
    /// or percent-encoded), `javascript:` behind an entity colon,
    /// `vbscript:` and `data:` schemes, scheme-relative URLs and credentials
    /// are refused; https, relative paths and fragments open, a URL in its
    /// canonical form.
    #[test]
    fn the_url_policy_refuses_obfuscated_and_unsafe_targets() {
        for refused in [
            "java\nscript:alert(1)",
            "java\tscript:alert(1)",
            "java&#10;script:alert(1)",
            "javascript&#58;alert(1)",
            "vbscript:msgbox(1)",
            "data:text/html,<script>alert(1)</script>",
            "//evil.example/path",
            "https://example.com/%0aheader",
            "https://user:pass@example.com/path",
        ] {
            assert_eq!(safe_href(refused), None, "{refused:?}");
        }
        for (allowed, opens) in [
            ("https://example.com/a", "https://example.com/a"),
            ("./note.md", "./note.md"),
            ("#section", "#section"),
            ("note.md", "note.md"),
            ("HTTPS://EXAMPLE.COM/a", "https://example.com/a"),
        ] {
            assert_eq!(safe_href(allowed).as_deref(), Some(opens), "{allowed:?}");
        }
    }
}
