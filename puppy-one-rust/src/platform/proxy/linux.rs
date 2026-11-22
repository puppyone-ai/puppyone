//! Linux system proxy resolution: honors standard proxy environment variables
//! (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`) and falls back to
//! GNOME desktop manual proxy settings (`gsettings org.gnome.system.proxy`).
use super::{Answer, matches_bypass_list, parse_proxy_list};
use std::process::Command;

fn env_var(upper: &str, lower: &str) -> Option<String> {
    std::env::var(upper)
        .ok()
        .or_else(|| std::env::var(lower).ok())
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

fn has_env_proxy() -> bool {
    env_var("HTTPS_PROXY", "https_proxy").is_some()
        || env_var("HTTP_PROXY", "http_proxy").is_some()
        || env_var("ALL_PROXY", "all_proxy").is_some()
}

fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let out = Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    let trimmed = text.trim_matches(['\'', '"']).trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn gnome_manual_enabled() -> bool {
    gsettings_get("org.gnome.system.proxy", "mode").as_deref() == Some("manual")
}

pub(super) fn uses_custom_proxy() -> bool {
    // Only intercept when GNOME manual proxy is active and env proxies are unset
    // (reqwest natively honors HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars).
    !has_env_proxy() && gnome_manual_enabled()
}

pub(super) fn proxy_for(url: &reqwest::Url) -> Answer {
    let host = url.host_str().unwrap_or_default();
    if let Some(no_proxy) = env_var("NO_PROXY", "no_proxy")
        && matches_bypass_list(host, &no_proxy)
    {
        return None;
    }
    let scheme = url.scheme();
    if let Some(proxy) = match scheme {
        "https" => {
            env_var("HTTPS_PROXY", "https_proxy").or_else(|| env_var("ALL_PROXY", "all_proxy"))
        }
        "http" => env_var("HTTP_PROXY", "http_proxy").or_else(|| env_var("ALL_PROXY", "all_proxy")),
        _ => env_var("ALL_PROXY", "all_proxy"),
    } {
        return parse_proxy_list(&proxy, scheme);
    }

    if !gnome_manual_enabled() {
        return None;
    }
    if let Some(ignore) = gsettings_get("org.gnome.system.proxy", "ignore-hosts") {
        let stripped = ignore.trim_matches(['[', ']']);
        if matches_bypass_list(host, stripped) {
            return None;
        }
    }
    let section = if scheme == "https" {
        "org.gnome.system.proxy.https"
    } else {
        "org.gnome.system.proxy.http"
    };
    let proxy_host = gsettings_get(section, "host")
        .or_else(|| gsettings_get("org.gnome.system.proxy.http", "host"))?;
    let port: u16 = gsettings_get(section, "port")
        .or_else(|| gsettings_get("org.gnome.system.proxy.http", "port"))?
        .parse()
        .ok()?;
    if port == 0 {
        return None;
    }
    Some(format!("http://{proxy_host}:{port}"))
}
