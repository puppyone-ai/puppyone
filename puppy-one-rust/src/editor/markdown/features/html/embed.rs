//! External web embeds facade (`TA-42`, `TA-50`, `TODO-35`):
//! delegates `<iframe>` detection, public IP / DNS-pinned preflight policy, and
//! bounded per-window `WebHost` lifecycle to
//! [`crate::editor::markdown::platform::brokers::embed`] and [`crate::editor::markdown::platform::policy`].
pub use crate::editor::markdown::platform::brokers::embed::{
    external_iframe_href as external_href, render_web_embed as render, web_embed_entry_page as page,
};
pub use crate::editor::markdown::platform::policy::{
    allowed_https_href as allowed, is_public_ip as is_public,
};

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn only_a_lone_https_iframe_is_an_embed() {
        let embed = |s: &str| external_href(s);
        assert_eq!(
            embed(r#"<iframe src="https://www.youtube.com/embed/x"></iframe>"#).as_deref(),
            Some("https://www.youtube.com/embed/x")
        );
        assert_eq!(
            embed("<IFRAME SRC='https://a.test/p?a=1&amp;b=2' />").as_deref(),
            Some("https://a.test/p?a=1&b=2")
        );
        assert_eq!(embed(r#"<iframe src="http://a.test"></iframe>"#), None);
        assert_eq!(
            embed(r#"<iframe src="https://a.test" width="5"></iframe>"#),
            None,
            "one attribute only"
        );
        assert_eq!(embed(r#"<iframe src="https://a.test">"#), None, "unclosed");
        assert_eq!(embed(r#"x <iframe src="https://a.test"></iframe>"#), None);
    }

    #[test]
    fn private_and_local_targets_never_load() {
        assert!(allowed("https://example.com/a").is_some());
        for href in [
            "https://localhost/",
            "https://printer.local/",
            "https://router.home.arpa/",
            "https://127.0.0.1/",
            "https://10.1.2.3/",
            "https://192.168.1.1/",
            "https://[::1]/",
            "https://[::ffff:127.0.0.1]/",
            "https://user:pw@example.com/",
            "http://example.com/",
        ] {
            assert!(allowed(href).is_none(), "{href}");
        }
        assert!(is_public("8.8.8.8".parse().unwrap()));
        assert!(!is_public("100.64.0.1".parse().unwrap()));
        assert!(!is_public("169.254.1.1".parse().unwrap()));
        assert!(!is_public("224.0.0.1".parse().unwrap()));
        assert!(is_public("2606:4700::1111".parse().unwrap()));
        assert!(!is_public("2001:db8::1".parse().unwrap()));
        assert!(!is_public("fe80::1".parse().unwrap()));
        assert!(!is_public("2002::1".parse().unwrap()));
    }

    #[test]
    fn the_entry_page_leaves_for_the_embed() {
        assert!(page("https://a.test/\"x").contains(r#"location.replace("https://a.test/\"x")"#));
    }
}
