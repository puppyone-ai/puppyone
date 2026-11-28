//! Linux system proxy resolution: honors standard proxy environment variables
//! (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`) and falls back to
//! GNOME desktop manual proxy settings (`gsettings org.gnome.system.proxy`).
use super::{Answer, env_proxy_for, has_env_proxy, matches_bypass_list};
use std::process::Command;

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
    if let Some(answer) = env_proxy_for(url) {
        return answer;
    }
    let host = url.host_str().unwrap_or_default();
    let scheme = url.scheme();
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
