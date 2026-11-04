//! `shared/desktop/template-link.mjs`: a template store page
//! (`https://www.puppyone.ai/t/<id>[?release=<id>]`) or the app's own link
//! (`puppyone://templates/import?id=<id>[&release=<id>]`). A link opens
//! nothing by itself: it names a template, which the card then shows.
use crate::platform::build_identity::{self, Channel};

/// `TEMPLATE_STORE_ORIGIN`.
pub const STORE_ORIGIN: &str = "https://www.puppyone.ai";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemplateRef {
    pub id: String,
    pub release: Option<String>,
}

/// `TEMPLATE_ID_PATTERN`: a UUID, versions 1–5.
pub fn require_id(value: &str) -> Result<&str, String> {
    let bytes = value.as_bytes();
    let hex = |range: std::ops::Range<usize>| {
        bytes[range]
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
    };
    let valid = bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|&i| bytes[i] == b'-')
        && hex(0..8)
        && hex(9..13)
        && (b'1'..=b'5').contains(&bytes[14])
        && hex(15..18)
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && hex(20..23)
        && hex(24..36);
    if valid {
        Ok(value)
    } else {
        Err("Invalid template link.".into())
    }
}
/// `getDesktopReturnScheme`.
pub fn scheme(channel: Channel) -> &'static str {
    match channel {
        Channel::Dev => "puppyone-development",
        Channel::Internal => "puppyone-internal",
        Channel::Stable => "puppyone",
    }
}
/// `resolveTemplateStoreOrigin`: the store, or in a development build a
/// local one named by `PUPPYONE_TEMPLATE_STORE_ORIGIN`.
pub fn store_origin() -> String {
    let identity = build_identity::current();
    let Some(value) = std::env::var("PUPPYONE_TEMPLATE_STORE_ORIGIN")
        .ok()
        .filter(|_| !identity.packaged)
    else {
        return STORE_ORIGIN.into();
    };
    url::Url::parse(&value)
        .ok()
        .filter(|url| {
            url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
                && url.path() == "/"
                && (url.origin().ascii_serialization() == STORE_ORIGIN
                    || (url.scheme() == "http"
                        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))))
        })
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_else(|| STORE_ORIGIN.into())
}

/// `parseTemplateLink`.
pub fn parse(value: &str, origin: &str, channel: Channel) -> Result<TemplateRef, String> {
    let paste = || "Paste a Puppyone template store link.".to_owned();
    let invalid = || "Invalid template link.".to_owned();
    if value.len() > 2048 {
        return Err(paste());
    }
    let url = url::Url::parse(value.trim()).map_err(|_| paste())?;
    let releases = url.query_pairs().filter(|(k, _)| k == "release").count();
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || releases > 1
    {
        return Err(invalid());
    }
    let keys: Vec<String> = url.query_pairs().map(|(k, _)| k.into_owned()).collect();
    let id = if url.scheme() == scheme(channel)
        && url.host_str() == Some("templates")
        && url.path() == "/import"
        && url.port().is_none()
    {
        let ids: Vec<String> = url
            .query_pairs()
            .filter(|(k, _)| k == "id")
            .map(|(_, v)| v.into_owned())
            .collect();
        if ids.len() != 1 || keys.iter().any(|k| k != "id" && k != "release") {
            return Err(invalid());
        }
        require_id(&ids[0])?.to_owned()
    } else {
        let link_origin = url.origin().ascii_serialization();
        if (link_origin != STORE_ORIGIN && link_origin != origin)
            || keys.iter().any(|k| k != "release")
        {
            return Err(
                "Use a Puppyone template store link. GitHub repositories must be published to the store first."
                    .into(),
            );
        }
        let id = url
            .path()
            .strip_prefix("/t/")
            .filter(|id| id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
            .ok_or_else(paste)?;
        require_id(id)?.to_owned()
    };
    let release = url
        .query_pairs()
        .find(|(k, _)| k == "release")
        .map(|(_, v)| require_id(&v).map(str::to_owned))
        .transpose()?;
    Ok(TemplateRef { id, release })
}
/// `templateShareLink`.
pub fn share_link(template: &TemplateRef, origin: &str) -> String {
    match &template.release {
        Some(release) => format!("{origin}/t/{}?release={release}", template.id),
        None => format!("{origin}/t/{}", template.id),
    }
}
/// `looksLikeTemplateLink`: a cheap test for pasted text; it proves
/// nothing, and the link is still parsed before anything is asked.
pub fn looks_like(value: &str) -> bool {
    let value = value.trim();
    if value.len() > 2048 || value.chars().any(char::is_whitespace) {
        return false;
    }
    let uuid = |s: &str| s.len() == 36 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
    let lower = value.to_ascii_lowercase();
    if let Some(rest) = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
    {
        let Some((host, path)) = rest.split_once('/') else {
            return false;
        };
        if host.is_empty() {
            return false;
        }
        let Some(tail) = path.strip_prefix("t/") else {
            return false;
        };
        return match tail.split_once("?release=") {
            Some((id, release)) => uuid(id) && uuid(release),
            None => uuid(tail),
        };
    }
    lower
        .split_once("://templates/import?")
        .is_some_and(|(scheme, query)| {
            !scheme.is_empty()
                && scheme.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
                && !query.is_empty()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const ID: &str = "0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab";
    const RELEASE: &str = "11111111-2222-4333-8444-555555555555";

    #[test]
    fn store_and_app_links_name_a_template() {
        let store = parse(
            &format!("https://www.puppyone.ai/t/{ID}?release={RELEASE}"),
            STORE_ORIGIN,
            Channel::Stable,
        )
        .unwrap();
        assert_eq!(store.id, ID);
        assert_eq!(store.release.as_deref(), Some(RELEASE));
        assert_eq!(
            share_link(&store, STORE_ORIGIN),
            format!("https://www.puppyone.ai/t/{ID}?release={RELEASE}")
        );
        let app = parse(
            &format!("puppyone-development://templates/import?id={ID}"),
            STORE_ORIGIN,
            Channel::Dev,
        )
        .unwrap();
        assert_eq!((app.id.as_str(), app.release), (ID, None));
        // Another channel's link, another site, extra parts.
        for bad in [
            format!("puppyone://templates/import?id={ID}"),
            format!("https://github.com/t/{ID}"),
            format!("https://www.puppyone.ai/t/{ID}?x=1"),
            format!("https://www.puppyone.ai/t/{ID}#top"),
            format!("https://user@www.puppyone.ai/t/{ID}"),
            format!("https://www.puppyone.ai/t/{ID}?release={RELEASE}&release={RELEASE}"),
            "https://www.puppyone.ai/t/not-a-template".into(),
        ] {
            assert!(parse(&bad, STORE_ORIGIN, Channel::Dev).is_err(), "{bad}");
        }
        // A development store is accepted alongside the real one.
        assert!(
            parse(
                &format!("http://localhost:3000/t/{ID}"),
                "http://localhost:3000",
                Channel::Dev
            )
            .is_ok()
        );
    }

    #[test]
    fn pasted_text_looks_like_a_link_or_not() {
        assert!(looks_like(&format!(" https://www.puppyone.ai/t/{ID} ")));
        assert!(looks_like(&format!(
            "https://example.com/t/{ID}?release={RELEASE}"
        )));
        assert!(looks_like(&format!("puppyone://templates/import?id={ID}")));
        assert!(!looks_like("hello world"));
        assert!(!looks_like(&format!("https://www.puppyone.ai/x/{ID}")));
        assert!(require_id("0d3b7a4e-1f2a-6b5c-8d9e-0123456789ab").is_err());
    }
}
