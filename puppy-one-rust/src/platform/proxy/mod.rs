//! System proxy resolution for `reqwest` clients across macOS, Windows, and Linux.
//!
//! - macOS: CFNetwork PAC / WPAD evaluation (`macos.rs`)
//! - Windows: WinHTTP WPAD / PAC / WinINET proxy configuration (`windows.rs`)
//! - Linux: standard proxy environment variables + GNOME `gsettings` manual proxy (`linux.rs`)
use std::time::Duration;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux as imp;
#[cfg(target_os = "macos")]
use macos as imp;
#[cfg(target_os = "windows")]
use windows as imp;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use super::Answer;
    pub(super) fn uses_custom_proxy() -> bool {
        false
    }
    pub(super) fn proxy_for(_: &reqwest::Url) -> Answer {
        None
    }
}

/// How long a URL's answer is reused (by scheme, host and port).
const CACHE_FOR: Duration = Duration::from_secs(60);
/// The longest one PAC evaluation may take; past it, the request goes direct.
#[cfg(target_os = "macos")]
pub(super) const PAC_TIMEOUT: Duration = Duration::from_secs(5);

/// What a resolution says: a proxy's URL, or direct.
pub(super) type Answer = Option<String>;

/// `builder` with the system's proxy configuration (PAC / WPAD / OS settings),
/// when the system uses one.
pub fn system(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    if imp::uses_custom_proxy() {
        return builder.proxy(reqwest::Proxy::custom(|url| {
            // Like Chromium, a loopback endpoint never goes through a proxy.
            if is_loopback(url) {
                return None;
            }
            cached(url, || imp::proxy_for(url))
        }));
    }
    builder
}

pub(super) fn is_loopback(url: &reqwest::Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

fn cached(url: &reqwest::Url, resolve: impl FnOnce() -> Answer) -> Answer {
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
        time::Instant,
    };
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Answer)>>> = OnceLock::new();
    let key = format!(
        "{}://{}:{}",
        url.scheme(),
        url.host_str().unwrap_or_default(),
        url.port_or_known_default().unwrap_or_default()
    );
    let cache = CACHE.get_or_init(Default::default);
    if let Some((at, answer)) = cache.lock().ok().and_then(|c| c.get(&key).cloned())
        && at.elapsed() < CACHE_FOR
    {
        return answer;
    }
    let answer = resolve();
    if let Ok(mut cache) = cache.lock() {
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_FOR);
        cache.insert(key, (Instant::now(), answer.clone()));
    }
    answer
}

/// Parses WinHTTP / WinINET / PAC-style proxy lists (e.g.
/// `"http=10.0.0.1:8080;https=10.0.0.2:8443"`, `"PROXY 10.0.0.1:3128; DIRECT"`,
/// or `"10.0.0.1:8080"`) and picks the first applicable HTTP(S) proxy URL.
#[allow(dead_code)]
pub(super) fn parse_proxy_list(raw: &str, target_scheme: &str) -> Answer {
    let target = target_scheme.to_ascii_lowercase();
    let mut fallback: Option<String> = None;
    for entry in raw.split([';', ',']) {
        let trimmed = entry.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("DIRECT") {
            continue;
        }
        let cleaned = trimmed
            .strip_prefix("PROXY ")
            .or_else(|| trimmed.strip_prefix("proxy "))
            .or_else(|| trimmed.strip_prefix("HTTPS "))
            .or_else(|| trimmed.strip_prefix("https "))
            .unwrap_or(trimmed)
            .trim();
        if cleaned.is_empty() {
            continue;
        }
        if let Some((proto, addr)) = cleaned.split_once('=') {
            let proto = proto.trim().to_ascii_lowercase();
            let addr = addr.trim();
            if addr.is_empty() {
                continue;
            }
            if proto == target {
                return Some(normalize_proxy_url(addr));
            }
            if fallback.is_none() && matches!(proto.as_str(), "http" | "https") {
                fallback = Some(normalize_proxy_url(addr));
            }
        } else if fallback.is_none() {
            fallback = Some(normalize_proxy_url(cleaned));
        }
    }
    fallback
}

#[allow(dead_code)]
fn normalize_proxy_url(addr: &str) -> String {
    if addr.contains("://") {
        addr.to_owned()
    } else {
        format!("http://{addr}")
    }
}

/// Evaluates a comma/semicolon-separated bypass list (`NO_PROXY`, WinINET
/// `lpszProxyBypass`, or GNOME `ignore-hosts`).
#[allow(dead_code)]
pub(super) fn matches_bypass_list(host: &str, bypass: &str) -> bool {
    let host = host.trim().to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    for rule in bypass.split([';', ',', ' ']) {
        let rule = rule.trim().trim_matches(['\'', '"']).to_ascii_lowercase();
        if rule.is_empty() {
            continue;
        }
        if rule == "*" {
            return true;
        }
        if rule == "<local>" && !host.contains('.') {
            return true;
        }
        let rule_host = rule
            .split_once(':')
            .filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit()))
            .map_or(rule.as_str(), |(h, _)| h);
        if let Some(suffix) = rule_host.strip_prefix("*.") {
            if host == suffix || host.ends_with(&format!(".{suffix}")) {
                return true;
            }
        } else if let Some(suffix) = rule_host.strip_prefix('.') {
            if host == suffix || host.ends_with(&format!(".{suffix}")) {
                return true;
            }
        } else if host == rule_host {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn answers_are_reused_per_origin() {
        let url = reqwest::Url::parse("https://cache.test:8443/a").unwrap();
        assert_eq!(
            cached(&url, || Some("http://p:1".into())),
            Some("http://p:1".into())
        );
        let again = reqwest::Url::parse("https://cache.test:8443/b").unwrap();
        assert_eq!(cached(&again, || None), Some("http://p:1".into()));
    }

    #[test]
    fn loopback_urls_always_bypass_proxy() {
        assert!(is_loopback(
            &reqwest::Url::parse("http://localhost:3000").unwrap()
        ));
        assert!(is_loopback(
            &reqwest::Url::parse("http://127.0.0.1:8080/a").unwrap()
        ));
        assert!(is_loopback(
            &reqwest::Url::parse("http://[::1]:8080/a").unwrap()
        ));
        assert!(!is_loopback(
            &reqwest::Url::parse("https://api.puppyone.ai/api/v1").unwrap()
        ));
    }

    #[test]
    fn parses_winhttp_and_pac_proxy_lists_by_scheme() {
        assert_eq!(
            parse_proxy_list("http=10.0.0.1:8080;https=10.0.0.2:8443", "https"),
            Some("http://10.0.0.2:8443".into())
        );
        assert_eq!(
            parse_proxy_list("http=10.0.0.1:8080;https=10.0.0.2:8443", "http"),
            Some("http://10.0.0.1:8080".into())
        );
        assert_eq!(
            parse_proxy_list("PROXY 10.0.0.3:3128; DIRECT", "https"),
            Some("http://10.0.0.3:3128".into())
        );
        assert_eq!(parse_proxy_list("DIRECT", "https"), None);
    }

    #[test]
    fn bypass_list_matches_exact_suffix_wildcard_and_local() {
        let bypass = "localhost;*.corp.example;.internal.local;<local>";
        assert!(matches_bypass_list("localhost", bypass));
        assert!(matches_bypass_list("git.corp.example", bypass));
        assert!(matches_bypass_list("api.internal.local", bypass));
        assert!(matches_bypass_list("intranet", bypass));
        assert!(!matches_bypass_list("api.puppyone.ai", bypass));
        assert!(matches_bypass_list("anything.example", "*"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_pac_script_chooses_a_proxy_per_host() {
        let script = r#"function FindProxyForURL(url, host) {
            if (host == "example.com") return "PROXY 10.0.0.1:3128; DIRECT";
            return "DIRECT";
        }"#;
        assert_eq!(
            macos::evaluate_source(script, "https://example.com/a"),
            Some(Some("http://10.0.0.1:3128".into()))
        );
        assert_eq!(
            macos::evaluate_source(script, "https://other.test/"),
            Some(None)
        );
    }
}
