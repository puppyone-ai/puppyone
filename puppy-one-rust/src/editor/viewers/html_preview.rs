//! `getHtmlPreviewPolicy(…, interactive)` and `buildHtmlPreviewDocument`
//! (`viewers/html/HtmlPreviewFrame.tsx`): the document Interact shows.
//!
//! The page runs scripts, but it never reads the granted folder from
//! script. Its document has an opaque origin, from the `sandbox` directive in
//! [`INTERACTIVE_HEADER`]; the product sends the same directive on its
//! projected document. Its `connect-src` admits only `https:`. The native
//! host sends that header on every response, so a page that navigates to
//! another HTML file in the folder is held to the same policy.
use crate::platform::webview::{LOCAL_SCHEME, SCHEME};

/// The product's interactive policy. `puppyone-preview:` is the native
/// resource scheme beside `puppyone-local:`.
macro_rules! interactive_csp {
    () => {
        "default-src 'none'; \
        script-src 'unsafe-inline' https: puppyone-preview: puppyone-local:; \
        style-src 'unsafe-inline' https: puppyone-preview: puppyone-local:; \
        img-src data: blob: https: puppyone-preview: puppyone-local:; \
        media-src data: blob: https: puppyone-preview: puppyone-local:; \
        font-src data: https: puppyone-preview: puppyone-local:; \
        connect-src https:; object-src 'none'; frame-src 'none'; \
        base-uri https: puppyone-preview: puppyone-local:; form-action https:"
    };
}
pub const INTERACTIVE_CSP: &str = interactive_csp!();
/// Response header for every Interact response: the policy plus the opaque
/// sandbox (`local-file-protocol.mjs`, document projections).
pub const INTERACTIVE_HEADER: &str = concat!(
    interactive_csp!(),
    "; sandbox allow-downloads allow-forms allow-modals allow-popups \
    allow-popups-to-escape-sandbox allow-scripts"
);

/// `buildHtmlPreviewDocument` for the interactive policy: `<base>` and
/// `<meta http-equiv=refresh>` leave the page; the policy, a `<base>` for
/// the resolved resource folder with `target="_self"` and `extra` lead its
/// head. `base` is the folder relative resources resolve against.
pub fn interactive_document(raw: &str, base: &str, extra: &str) -> String {
    let mut original_base = None;
    let mut out = String::with_capacity(raw.len() + extra.len() + 512);
    let mut head_end = None;
    let mut html_end = None;
    let mut rest = raw;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        let tag = &rest[at..];
        // Comments and raw-text elements hold no tags.
        if let Some(body) = tag.strip_prefix("<!--") {
            let end = body.find("-->").map_or(tag.len(), |e| e + 7);
            out.push_str(&tag[..end]);
            advance(&mut rest, at + end);
            continue;
        }
        let Some((name, end)) = open_tag(tag) else {
            out.push('<');
            advance(&mut rest, at + 1);
            continue;
        };
        let source = &tag[..end];
        match name.as_str() {
            "base" => {
                original_base = original_base.or_else(|| attribute(source, "href"));
                advance(&mut rest, at + end);
                continue;
            }
            "meta"
                if attribute(source, "http-equiv")
                    .is_some_and(|v| v.eq_ignore_ascii_case("refresh")) =>
            {
                advance(&mut rest, at + end);
                continue;
            }
            _ => {}
        }
        out.push_str(source);
        match name.as_str() {
            "head" if head_end.is_none() => head_end = Some(out.len()),
            "html" if html_end.is_none() => html_end = Some(out.len()),
            "script" | "style" | "textarea" | "title" => {
                let close = format!("</{name}");
                let body = &tag[end..];
                let stop = find_ignore_case(body, &close).unwrap_or(body.len());
                out.push_str(&body[..stop]);
                advance(&mut rest, at + end + stop);
                continue;
            }
            _ => {}
        }
        advance(&mut rest, at + end);
    }
    out.push_str(rest);
    let resolved = match original_base {
        Some(href) => url::Url::parse(base)
            .and_then(|b| b.join(href.trim()))
            .ok()
            .filter(|u| {
                matches!(u.scheme(), "https") || [SCHEME, LOCAL_SCHEME].contains(&u.scheme())
            })
            .map(String::from),
        None => Some(base.to_owned()),
    };
    let base_tag = match resolved {
        Some(href) => format!(
            "<base href=\"{}\" target=\"_self\">",
            escape_attribute(&href)
        ),
        None => "<base target=\"_self\">".to_owned(),
    };
    let lead = format!(
        "<meta http-equiv=\"Content-Security-Policy\" content=\"{}\">{base_tag}{extra}",
        escape_attribute(INTERACTIVE_CSP)
    );
    match head_end.or(html_end) {
        Some(at) => format!("{}{lead}{}", &out[..at], &out[at..]),
        None => format!("{lead}{out}"),
    }
}

fn advance(rest: &mut &str, by: usize) {
    *rest = &rest[by..];
}

/// `<name …>` at the start of `tag`: its lower-case name and length, with
/// quoted attribute values allowed to hold `>`.
fn open_tag(tag: &str) -> Option<(String, usize)> {
    let body = tag.strip_prefix('<')?;
    let name: String = body
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    if name.is_empty() || !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    let mut quote = None;
    for (i, c) in body.char_indices().skip(name.len()) {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some((name.to_ascii_lowercase(), i + 2)),
            _ => {}
        }
    }
    None
}

/// An attribute's value in a start tag (unquoted, single or double quoted).
fn attribute(tag: &str, wanted: &str) -> Option<String> {
    let inner = tag.trim_start_matches('<').trim_end_matches('>');
    let mut chars = inner.char_indices().peekable();
    // Skip the tag name.
    while chars
        .peek()
        .is_some_and(|(_, c)| !c.is_whitespace() && *c != '/')
    {
        chars.next();
    }
    loop {
        while chars
            .peek()
            .is_some_and(|(_, c)| c.is_whitespace() || *c == '/')
        {
            chars.next();
        }
        let start = chars.peek()?.0;
        while chars
            .peek()
            .is_some_and(|(_, c)| !c.is_whitespace() && !matches!(c, '=' | '/'))
        {
            chars.next();
        }
        let name = &inner[start..chars.peek().map_or(inner.len(), |(i, _)| *i)];
        while chars.peek().is_some_and(|(_, c)| c.is_whitespace()) {
            chars.next();
        }
        let value = if chars.peek().is_some_and(|(_, c)| *c == '=') {
            chars.next();
            while chars.peek().is_some_and(|(_, c)| c.is_whitespace()) {
                chars.next();
            }
            match chars.peek().map(|(_, c)| *c) {
                Some(q @ ('"' | '\'')) => {
                    chars.next();
                    let from = chars.peek().map_or(inner.len(), |(i, _)| *i);
                    let mut to = inner.len();
                    for (i, c) in chars.by_ref() {
                        if c == q {
                            to = i;
                            break;
                        }
                    }
                    inner[from..to].to_owned()
                }
                _ => {
                    let from = chars.peek().map_or(inner.len(), |(i, _)| *i);
                    while chars.peek().is_some_and(|(_, c)| !c.is_whitespace()) {
                        chars.next();
                    }
                    inner[from..chars.peek().map_or(inner.len(), |(i, _)| *i)].to_owned()
                }
            }
        } else {
            String::new()
        };
        if name.eq_ignore_ascii_case(wanted) {
            return Some(value);
        }
        if name.is_empty() {
            return None;
        }
    }
}

fn find_ignore_case(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const BASE: &str = "puppyone-preview://local/";

    #[test]
    fn the_policy_leads_the_head_and_the_page_keeps_its_own_markup() {
        let page = interactive_document(
            "<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>",
            BASE,
            "<style id=\"s\"></style>",
        );
        let csp = page.find("Content-Security-Policy").unwrap();
        assert!(page.find("<head>").unwrap() < csp);
        assert!(csp < page.find("<title>").unwrap());
        assert!(page.contains("connect-src https:"));
        assert!(page.contains(&format!("<base href=\"{BASE}\" target=\"_self\">")));
        assert!(page.contains("<style id=\"s\"></style>"));
        assert!(page.ends_with("<body><p>x</p></body></html>"));
        assert!(interactive_document("<p>bare</p>", BASE, "").starts_with("<meta"));
    }

    #[test]
    fn base_and_refresh_leave_and_only_safe_bases_resolve() {
        let page = interactive_document(
            "<head><base href=\"assets/\"><base href=\"https://x.test/\"><meta http-equiv=\"Refresh\" content=\"0;url=https://x.test\"></head>",
            BASE,
            "",
        );
        assert!(!page.contains("Refresh"));
        assert!(page.contains("<base href=\"puppyone-preview://local/assets/\" target=\"_self\">"));
        assert_eq!(page.matches("<base").count(), 1);
        for unsafe_base in ["file:///etc/", "javascript:alert(1)", "http://x.test/"] {
            let page = interactive_document(&format!("<base href='{unsafe_base}'>"), BASE, "");
            assert!(page.contains("<base target=\"_self\">"), "{unsafe_base}");
        }
        let https = interactive_document("<base href=https://cdn.test/a/>", BASE, "");
        assert!(https.contains("<base href=\"https://cdn.test/a/\" target=\"_self\">"));
    }

    #[test]
    fn script_text_comments_and_quoted_angles_are_not_tags() {
        let raw = "<head><!-- <base href=x> --><script>let s = '<base href=y>';</script>\
            <div title=\"a > b\"><base href=z></div></head>";
        let page = interactive_document(raw, BASE, "");
        assert!(page.contains("<!-- <base href=x> -->"));
        assert!(page.contains("let s = '<base href=y>';"));
        assert!(page.contains("<div title=\"a > b\"></div>"));
        assert!(page.contains("<base href=\"puppyone-preview://local/z\" target=\"_self\">"));
    }
}
