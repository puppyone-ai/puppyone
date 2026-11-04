//! The page the browser shows when a sign-in ends (`respond` in
//! `loopback-callback-server.mjs`): the brand mark, a title, the outcome on
//! its tint, and the next step, in the app's language (else the browser's).
//! A successful sign-in also offers "Return to PuppyOne Desktop", a form
//! that POSTs to a one-time path on this listener so the app comes forward.
//! Self-contained: the listener closes before any asset could load.
use base64::{Engine, engine::general_purpose::STANDARD};
use std::sync::OnceLock;

/// `PAGE_COPY` keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Outcome {
    Success,
    Unrecognized,
    NotReady,
    AlreadyUsed,
    StateMismatch,
    Failed,
}
impl Outcome {
    fn key(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Unrecognized => "unrecognized",
            Self::NotReady => "notReady",
            Self::AlreadyUsed => "alreadyUsed",
            Self::StateMismatch => "stateMismatch",
            Self::Failed => "failed",
        }
    }
}

fn data() -> &'static serde_json::Value {
    static DATA: OnceLock<serde_json::Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../../assets/auth/result-page.json"))
            .expect("generated result page copy")
    })
}
fn font() -> &'static str {
    static FONT: OnceLock<String> = OnceLock::new();
    FONT.get_or_init(|| STANDARD.encode(include_bytes!("../../assets/auth/Geist-Variable.woff2")))
}

/// `matchLocale`.
fn match_locale(raw: &str) -> Option<&'static str> {
    let tag = raw.trim().replace('_', "-").to_lowercase();
    if tag == "zh"
        || ["zh-hans", "zh-cn", "zh-sg"]
            .iter()
            .any(|p| tag.starts_with(p))
    {
        return Some("zh-Hans");
    }
    if tag == "pt" || tag.starts_with("pt-") {
        return Some("pt-BR");
    }
    ["en", "es", "fr", "de", "ja", "ko"]
        .into_iter()
        .find(|locale| tag == *locale || tag.starts_with(&format!("{locale}-")))
}
/// `resolveCallbackLocale`: the app's language, else the browser's best.
pub(super) fn locale(app: &str, accept_language: Option<&str>) -> &'static str {
    if let Some(locale) = match_locale(app) {
        return locale;
    }
    let mut candidates: Vec<(f32, usize, &str)> = accept_language
        .unwrap_or_default()
        .split(',')
        .enumerate()
        .map(|(index, entry)| {
            let mut parts = entry.trim().split(';');
            let tag = parts.next().unwrap_or_default();
            let weight = parts
                .next()
                .and_then(|q| q.trim().strip_prefix("q=").or(q.trim().strip_prefix("Q=")))
                .and_then(|q| q.parse::<f32>().ok())
                .filter(|q| (0. ..=1.).contains(q))
                .unwrap_or(1.);
            (weight, index, tag)
        })
        .collect();
    candidates.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    candidates
        .into_iter()
        .filter(|(weight, _, _)| *weight > 0.)
        .find_map(|(_, _, tag)| match_locale(tag))
        .unwrap_or("en")
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// The response bytes for `status`, with the return form when `return_path`
/// is the listener's one-time path.
pub(super) fn response(
    status: u16,
    outcome: Outcome,
    locale: &str,
    return_path: Option<&str>,
) -> Vec<u8> {
    let copy = &data()["copy"][locale];
    let text = |i: usize| copy[outcome.key()][i].as_str().unwrap_or_default();
    let (title, description, next) = (text(0), text(1), text(2));
    let success = outcome == Outcome::Success;
    let tone = if success {
        "--po-success"
    } else {
        "--po-danger"
    };
    let form = return_path.map(|path| {
        format!(
            r#"<form class="return-form" method="post" action="{}" target="puppyone-return-frame"><button class="return-button" type="submit">{}</button></form>"#,
            escape(path),
            escape(copy["returnButton"].as_str().unwrap_or_default())
        )
    });
    let body = format!(
        r#"<!doctype html>
<html lang="{locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>{title} · PuppyOne Desktop</title>
  <style>
    @font-face {{ font-family: "Geist Sans"; src: url(data:font/woff2;base64,{font}) format("woff2"); font-style: normal; font-weight: 100 900; font-display: swap; }}
    :root {{ color-scheme: light; --po-inset: #e7e3db; --po-text: #292723; --po-text-inverse: #fffefa; --po-text-muted: #68645c; --po-text-subtle: #928c83; --po-success: #168145; --po-danger: #dc2626; }}
    * {{ box-sizing: border-box; }}
    html {{ min-height: 100%; }}
    body {{ min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--po-inset); color: var(--po-text); font-family: "Geist Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }}
    main {{ width: min(100%, 380px); padding: 24px; text-align: center; }}
    .brand {{ display: block; width: 48px; height: 48px; margin: 0 auto 16px; opacity: .95; }}
    .brand svg {{ display: block; width: 100%; height: 100%; }}
    h1 {{ margin: 0 0 32px; font-size: 24px; font-weight: 600; line-height: 32px; }}
    .description {{ margin: 0; padding: 8px 12px; border-radius: 8px; color: var({tone}); background: color-mix(in srgb, var({tone}) 10%, transparent); font-size: 14px; line-height: 20px; }}
    .return-form {{ margin-top: 24px; }}
    .return-button {{ display: flex; align-items: center; justify-content: center; width: 100%; min-height: 40px; padding: 8px 16px; border: 0; border-radius: 6px; background: var(--po-text); color: var(--po-text-inverse); font: inherit; font-size: 14px; font-weight: 600; line-height: 20px; cursor: pointer; }}
    .return-button:hover {{ opacity: .9; }}
    .return-button:focus-visible {{ outline: 3px solid var(--po-success); outline-offset: 3px; }}
    .next-step {{ margin: {next_margin} 0 0; color: var(--po-text-subtle); font-size: 12px; line-height: 18px; }}
    @media (prefers-color-scheme: dark) {{
      :root {{ color-scheme: dark; --po-inset: #0d0d0d; --po-text: #fafafa; --po-text-inverse: #0a0a0a; --po-text-muted: #a1a1aa; --po-text-subtle: #71717a; --po-success: #34d399; --po-danger: #f87171; }}
    }}
  </style>
</head>
<body>
  <main role="{role}">
    <div class="brand">{mark}</div>
    <h1>{title}</h1>
    <p class="description">{description}</p>
    {form}
    <p class="next-step">{next}</p>
  </main>
  {frame}
</body>
</html>"#,
        title = escape(title),
        description = escape(description),
        next = escape(next),
        font = font(),
        mark = data()["brandMark"].as_str().unwrap_or_default(),
        role = if success { "status" } else { "alert" },
        next_margin = if return_path.is_some() {
            "16px"
        } else {
            "24px"
        },
        form = form.unwrap_or_default(),
        frame = if return_path.is_some() {
            r#"<iframe name="puppyone-return-frame" title="" hidden></iframe>"#
        } else {
            ""
        },
    );
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Result",
    };
    let mut bytes = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'self'; frame-src 'self'\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    bytes.extend_from_slice(body.as_bytes());
    bytes
}
/// The return action's answer: nothing, and the app comes forward.
pub(super) fn returned() -> &'static [u8] {
    b"HTTP/1.1 204 No Content\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_page_speaks_the_apps_language_else_the_browsers() {
        assert_eq!(locale("zh-Hans", Some("en")), "zh-Hans");
        assert_eq!(locale("xx", Some("fr-CA;q=0.4, de;q=0.9, en;q=0")), "de");
        assert_eq!(locale("", Some("pt")), "pt-BR");
        assert_eq!(locale("", None), "en");
        let page = String::from_utf8(response(
            200,
            Outcome::Success,
            "en",
            Some("/auth/return/x"),
        ))
        .unwrap();
        assert!(page.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(page.contains("Signed in successfully"));
        assert!(page.contains(r#"action="/auth/return/x""#));
        let page = String::from_utf8(response(409, Outcome::AlreadyUsed, "ja", None)).unwrap();
        assert!(page.contains("ログインリンクは使用済みです"));
        assert!(!page.contains("return-form\""));
        assert!(page.contains(r#"role="alert""#));
    }
}
