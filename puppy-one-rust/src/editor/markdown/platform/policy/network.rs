//! Remote network policy (`platform/policy/network.rs`, `TA-50`, `MA-14`, `R15`):
//! public IP validation, DNS preflight resolution, connection pinning, redirect
//! guards, and system proxy wiring.
use super::url::allowed_https_url;
use gpui::SharedString;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs},
    time::Duration,
};

/// `isPublicIpAddress`: rejects loopback, private, CGNAT, link-local,
/// documentation, benchmarking, multicast, reserved, and mapped IPv6 addresses.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => {
            let w = ip.segments();
            if w[..5].iter().all(|w| *w == 0) && (w[5] == 0xffff || w[5] == 0) {
                let [a, b] = w[6].to_be_bytes();
                let [c, d] = w[7].to_be_bytes();
                return public_v4(Ipv4Addr::new(a, b, c, d));
            }
            (w[0] & 0xe000) == 0x2000
                && !(w[0] == 0x2001 && matches!(w[1], 0x0db8 | 0x0000 | 0x0002))
                && w[0] != 0x2002
        }
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || (a == 100 && (64..=127).contains(&b))
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && (c == 0 || c == 2))
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

/// Validated public endpoint with pre-resolved socket addresses for DNS pinning (`TA-50`).
#[derive(Clone, Debug)]
pub struct ValidatedEndpoint {
    pub url: url::Url,
    pub host: String,
    pub addrs: Vec<SocketAddr>,
}

/// Resolves `href` once off the foreground thread and verifies every resolved
/// socket address is a public IP (`TA-50`).
pub fn resolve_public_endpoint(href: &str) -> Result<ValidatedEndpoint, SharedString> {
    let url = allowed_https_url(href).ok_or_else(|| SharedString::from("Blocked URL"))?;
    let host_raw = url
        .host_str()
        .ok_or_else(|| SharedString::from("Missing host"))?;
    let host = host_raw
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<SocketAddr> = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| SharedString::from("Unable to resolve host"))?
        .collect();
    pinned_endpoint(url, host, addrs)
}

/// The endpoint `addrs` resolved to, only when there is one and every
/// address is public: one private answer fails the whole resolution.
fn pinned_endpoint(
    url: url::Url,
    host: String,
    addrs: Vec<SocketAddr>,
) -> Result<ValidatedEndpoint, SharedString> {
    if addrs.is_empty() {
        return Err("Unable to resolve host".into());
    }
    if !addrs.iter().all(|a| is_public_ip(a.ip())) {
        return Err("Blocked private or loopback address".into());
    }
    Ok(ValidatedEndpoint { url, host, addrs })
}

/// Evaluates whether a redirect target `next` from `origin_url` is permitted.
pub fn redirect_allowed(origin_url: &url::Url, next: &url::Url, same_origin_only: bool) -> bool {
    if allowed_https_url(next.as_str()).is_none() {
        return false;
    }
    if same_origin_only {
        return next.origin() == origin_url.origin();
    }
    if next.host_str() == origin_url.host_str()
        && next.port_or_known_default() == origin_url.port_or_known_default()
    {
        return true;
    }
    // Cross-host redirect (e.g. CDN image redirect): require all resolved IPs to be public.
    resolve_public_endpoint(next.as_str()).is_ok()
}

/// Builds an HTTPS `reqwest::Client` with DNS pinned to the pre-validated
/// public socket address (`ClientBuilder::resolve`) and a redirect guard that
/// blocks private, loopback, non-HTTPS, or cross-origin hops (`TA-50`).
pub fn build_pinned_https_client(
    endpoint: &ValidatedEndpoint,
    timeout: Duration,
    same_origin_only: bool,
) -> Result<reqwest::Client, SharedString> {
    let origin_url = endpoint.url.clone();
    let base = if cfg!(test) {
        reqwest::Client::builder().no_proxy()
    } else {
        crate::platform::proxy::system(reqwest::Client::builder())
    };
    let mut builder = base
        .timeout(timeout)
        .redirect_policy(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5
                || !redirect_allowed(&origin_url, attempt.url(), same_origin_only)
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }));
    if endpoint.host.parse::<IpAddr>().is_err()
        && let Some(&validated_socket_addr) = endpoint.addrs.first()
    {
        builder = builder.resolve(&endpoint.host, validated_socket_addr);
    }
    builder
        .build()
        .map_err(|e| SharedString::from(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn one_private_dns_answer_fails_the_whole_resolution() {
        // `fails closed when DNS returns any non-public endpoint`.
        let url = url::Url::parse("https://embed.example/").unwrap();
        let resolve = |addrs: &[&str]| {
            pinned_endpoint(
                url.clone(),
                "embed.example".into(),
                addrs.iter().map(|a| a.parse().unwrap()).collect(),
            )
        };
        assert!(resolve(&["93.184.216.34:443"]).is_ok());
        assert!(resolve(&["93.184.216.34:443", "10.0.0.1:443"]).is_err());
        assert!(resolve(&["[::1]:443"]).is_err());
        assert!(resolve(&[]).is_err());
        // Loopback aliases and IPv4-mapped IPv6 never reach DNS.
        for href in [
            "https://localhost./",
            "https://LOCALHOST/",
            "https://[::ffff:127.0.0.1]/",
        ] {
            assert!(allowed_https_url(href).is_none(), "{href}");
        }
    }

    #[test]
    fn redirect_and_url_policy_rejects_private_and_local_targets() {
        let origin = url::Url::parse("https://example.com/embed/1").unwrap();
        let same_origin = url::Url::parse("https://example.com/embed/2").unwrap();
        let loopback = url::Url::parse("https://127.0.0.1/admin").unwrap();
        let private = url::Url::parse("https://192.168.1.1/").unwrap();
        let downgrade = url::Url::parse("http://example.com/embed/2").unwrap();
        let other_host = url::Url::parse("https://other.example/embed/2").unwrap();

        assert!(redirect_allowed(&origin, &same_origin, true));
        assert!(!redirect_allowed(&origin, &loopback, false));
        assert!(!redirect_allowed(&origin, &private, false));
        assert!(!redirect_allowed(&origin, &downgrade, false));
        assert!(!redirect_allowed(&origin, &other_host, true));
    }
}
