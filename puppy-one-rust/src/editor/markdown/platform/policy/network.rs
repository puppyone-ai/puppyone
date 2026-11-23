//! Remote network policy (`platform/policy/network.rs`, `TA-50`, `MA-14`, `R15`):
//! public IP validation, DNS preflight resolution, connection pinning, redirect
//! guards, and system proxy wiring.
//!
//! Remote images go through the system proxy when it names one for the URL,
//! as Chromium does in the TypeScript app: the proxy resolves the host, so a
//! fake-IP proxy (Clash, Surge) answering every name with `198.18.0.0/15`
//! does not block them. Without a proxy, and for web embeds always, every
//! address the host resolves to must be public and the connection is pinned
//! to them.
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
    resolve_endpoint(url, system_resolve)
}

fn resolve_endpoint(url: url::Url, resolve: Resolve) -> Result<ValidatedEndpoint, SharedString> {
    let host_raw = url
        .host_str()
        .ok_or_else(|| SharedString::from("Missing host"))?;
    let host = host_raw
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = resolve(&host, port).map_err(|_| SharedString::from("Unable to resolve host"))?;
    pinned_endpoint(url, host, addrs)
}

/// A resolver: the socket addresses a host and port resolve to.
pub type Resolve = fn(&str, u16) -> std::io::Result<Vec<SocketAddr>>;

/// The system answers a remote request depends on: the proxy it goes through
/// (`None` for direct) and the resolver. Tests substitute their own.
#[derive(Clone, Copy)]
pub struct Network {
    pub proxy_for: fn(&url::Url) -> Option<String>,
    pub resolve: Resolve,
}

impl Network {
    /// The system's proxy settings (static, PAC or WPAD) and resolver.
    pub fn system() -> Self {
        Self {
            proxy_for: system_proxy_for,
            resolve: system_resolve,
        }
    }
}

#[cfg(not(test))]
fn system_proxy_for(url: &url::Url) -> Option<String> {
    crate::platform::proxy::proxy_for(url)
}

/// Tests never use the machine's proxy, only the ones they set up.
#[cfg(test)]
fn system_proxy_for(url: &url::Url) -> Option<String> {
    fake::proxy_for(url)
}

fn system_resolve(host: &str, port: u16) -> std::io::Result<Vec<SocketAddr>> {
    #[cfg(test)]
    if let Some(addrs) = fake::resolve(host) {
        return Ok(addrs
            .into_iter()
            .map(|ip| SocketAddr::new(ip, port))
            .collect());
    }
    Ok((host, port).to_socket_addrs()?.collect())
}

/// Where a remote image request goes (`TA-50`).
#[derive(Clone, Debug)]
pub enum RemoteRoute {
    /// Straight to the public addresses resolved here, pinned for the connection.
    Direct(ValidatedEndpoint),
    /// Through `proxy`, which resolves the host itself.
    Proxied { url: url::Url, proxy: String },
}

impl RemoteRoute {
    pub fn url(&self) -> &url::Url {
        match self {
            Self::Direct(endpoint) => &endpoint.url,
            Self::Proxied { url, .. } => url,
        }
    }
}

/// Routes a remote image request for `href`. Either way the URL must be
/// HTTPS without credentials, a local name or a literal non-public address;
/// with a proxy for it nothing is resolved here, without one every address
/// must be public.
pub fn route_remote(href: &str, network: Network) -> Result<RemoteRoute, SharedString> {
    let url = allowed_https_url(href).ok_or_else(|| SharedString::from("Blocked URL"))?;
    if let Some(proxy) = (network.proxy_for)(&url) {
        return Ok(RemoteRoute::Proxied { url, proxy });
    }
    resolve_endpoint(url, network.resolve).map(RemoteRoute::Direct)
}

/// Whether a remote image request from `origin` may follow a redirect to
/// `next`: an allowed HTTPS URL on the same host, or one that would itself be
/// routed (through a proxy, or to public addresses only).
pub fn remote_redirect_allowed(origin: &url::Url, next: &url::Url, network: Network) -> bool {
    if allowed_https_url(next.as_str()).is_none() {
        return false;
    }
    if next.host_str() == origin.host_str()
        && next.port_or_known_default() == origin.port_or_known_default()
    {
        return true;
    }
    route_remote(next.as_str(), network).is_ok()
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

/// Evaluates whether a redirect target `next` from `origin_url` is permitted:
/// the same origin only, or the remote image rule (`remote_redirect_allowed`).
pub fn redirect_allowed(origin_url: &url::Url, next: &url::Url, same_origin_only: bool) -> bool {
    if same_origin_only {
        return allowed_https_url(next.as_str()).is_some() && next.origin() == origin_url.origin();
    }
    remote_redirect_allowed(origin_url, next, Network::system())
}

/// Builds the HTTPS client for a remote image `route`: every request goes
/// through the proxy `network` names for its URL, a direct route connects
/// only to its pinned addresses, and each of at most five redirects must pass
/// `remote_redirect_allowed`.
pub fn build_remote_client(
    route: &RemoteRoute,
    timeout: Duration,
    network: Network,
) -> Result<reqwest::Client, SharedString> {
    let origin_url = route.url().clone();
    let proxy_for = network.proxy_for;
    let mut builder = reqwest::Client::builder()
        .proxy(reqwest::Proxy::custom(proxy_for))
        .timeout(timeout)
        .redirect_policy(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5
                || !remote_redirect_allowed(&origin_url, attempt.url(), network)
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }));
    if let RemoteRoute::Direct(endpoint) = route
        && endpoint.host.parse::<IpAddr>().is_err()
        && let Some(&validated_socket_addr) = endpoint.addrs.first()
    {
        builder = builder.resolve(&endpoint.host, validated_socket_addr);
    }
    #[cfg(test)]
    for root in fake::roots() {
        builder = builder.add_root_certificate(root);
    }
    builder
        .build()
        .map_err(|e| SharedString::from(e.to_string()))
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

/// Test doubles for the system proxy, resolver and trusted roots, keyed by
/// host so parallel tests never see each other's answers.
#[cfg(test)]
pub(crate) mod fake {
    use std::{net::IpAddr, sync::Mutex};

    struct Host {
        name: String,
        proxy: Option<String>,
        addrs: Vec<IpAddr>,
    }
    static HOSTS: Mutex<Vec<Host>> = Mutex::new(Vec::new());
    static ROOTS: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());

    /// Requests to `host` go through `proxy` (direct when `None`), and the
    /// host resolves to `addrs`.
    pub(crate) fn set_host(host: &str, proxy: Option<&str>, addrs: &[&str]) {
        let mut hosts = HOSTS.lock().unwrap();
        hosts.retain(|h| h.name != host);
        hosts.push(Host {
            name: host.to_owned(),
            proxy: proxy.map(str::to_owned),
            addrs: addrs.iter().map(|a| a.parse().unwrap()).collect(),
        });
    }

    /// Every remote request trusts the PEM certificate `pem`.
    pub(crate) fn trust(pem: &[u8]) {
        let mut roots = ROOTS.lock().unwrap();
        if !roots.iter().any(|r| r == pem) {
            roots.push(pem.to_vec());
        }
    }

    pub(super) fn proxy_for(url: &url::Url) -> Option<String> {
        let hosts = HOSTS.lock().unwrap();
        hosts
            .iter()
            .find(|h| Some(h.name.as_str()) == url.host_str())
            .and_then(|h| h.proxy.clone())
    }

    pub(super) fn resolve(host: &str) -> Option<Vec<IpAddr>> {
        let hosts = HOSTS.lock().unwrap();
        hosts
            .iter()
            .find(|h| h.name == host)
            .map(|h| h.addrs.clone())
    }

    pub(super) fn roots() -> Vec<reqwest::Certificate> {
        let roots = ROOTS.lock().unwrap();
        roots
            .iter()
            .filter_map(|pem| reqwest::Certificate::from_pem(pem).ok())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn local_proxy(_: &url::Url) -> Option<String> {
        Some("http://127.0.0.1:1082".into())
    }
    fn no_proxy(_: &url::Url) -> Option<String> {
        None
    }
    /// What a fake-IP proxy's DNS answers for every name.
    fn fake_ip_dns(_: &str, port: u16) -> std::io::Result<Vec<SocketAddr>> {
        Ok(vec![SocketAddr::new("198.18.0.37".parse().unwrap(), port)])
    }
    fn public_dns(_: &str, port: u16) -> std::io::Result<Vec<SocketAddr>> {
        Ok(vec![SocketAddr::new(
            "93.184.216.34".parse().unwrap(),
            port,
        )])
    }
    const PROXIED: Network = Network {
        proxy_for: local_proxy,
        resolve: fake_ip_dns,
    };
    const DIRECT: Network = Network {
        proxy_for: no_proxy,
        resolve: fake_ip_dns,
    };

    #[test]
    fn a_system_proxy_carries_remote_images_past_fake_ip_dns() {
        let href = "https://img.shields.io/badge/license-MIT-blue.svg";
        // 1. With a proxy the fake-IP answer is never consulted.
        match route_remote(href, PROXIED) {
            Ok(RemoteRoute::Proxied { url, proxy }) => {
                assert_eq!(url.as_str(), href);
                assert_eq!(proxy, "http://127.0.0.1:1082");
            }
            other => panic!("expected a proxied route, got {other:?}"),
        }
        // 2. Without one the same answer is a private address and blocks.
        let blocked = route_remote(href, DIRECT).unwrap_err();
        assert_eq!(blocked.as_ref(), "Blocked private or loopback address");
        // Control: a direct route to a public answer is pinned to it.
        let public = Network {
            proxy_for: no_proxy,
            resolve: public_dns,
        };
        match route_remote(href, public) {
            Ok(RemoteRoute::Direct(endpoint)) => {
                assert_eq!(endpoint.host, "img.shields.io");
                assert_eq!(
                    endpoint.addrs,
                    vec!["93.184.216.34:443".parse::<SocketAddr>().unwrap()]
                );
            }
            other => panic!("expected a direct route, got {other:?}"),
        }
        assert!(
            build_remote_client(
                &route_remote(href, PROXIED).unwrap(),
                Duration::from_secs(5),
                PROXIED
            )
            .is_ok()
        );
    }

    #[test]
    fn a_system_proxy_never_opens_local_or_plain_http_urls() {
        // 3. Literal local addresses and local names, 4. plain HTTP.
        for href in [
            "https://127.0.0.1/x.png",
            "https://localhost/x.png",
            "https://10.0.0.5/x.png",
            "https://192.168.1.2/x.png",
            "https://[::1]/x.png",
            "https://printer.local/x.png",
            "http://img.shields.io/x.png",
        ] {
            assert_eq!(
                route_remote(href, PROXIED).unwrap_err().as_ref(),
                "Blocked URL",
                "{href}"
            );
        }
        // Control: the same proxy carries a public HTTPS name.
        assert!(route_remote("https://img.shields.io/x.png", PROXIED).is_ok());
    }

    #[test]
    fn remote_redirects_follow_the_same_routing_rule() {
        let origin = url::Url::parse("https://img.example/a.png").unwrap();
        let url = |href: &str| url::Url::parse(href).unwrap();
        // 5. A redirect to a literal private address or a local name is
        // stopped whether or not a proxy carries the request.
        for next in [
            "https://127.0.0.1/x.png",
            "https://10.0.0.1/x.png",
            "https://[::1]/x.png",
            "https://localhost/x.png",
            "http://cdn.example/x.png",
        ] {
            assert!(
                !remote_redirect_allowed(&origin, &url(next), PROXIED),
                "{next}"
            );
            assert!(
                !remote_redirect_allowed(&origin, &url(next), DIRECT),
                "{next}"
            );
        }
        // Controls: the same host always; another host through the proxy;
        // directly only when every answer is public.
        assert!(remote_redirect_allowed(
            &origin,
            &url("https://img.example/b.png"),
            DIRECT
        ));
        assert!(remote_redirect_allowed(
            &origin,
            &url("https://cdn.example/x.png"),
            PROXIED
        ));
        assert!(!remote_redirect_allowed(
            &origin,
            &url("https://cdn.example/x.png"),
            DIRECT
        ));
        let public = Network {
            proxy_for: no_proxy,
            resolve: public_dns,
        };
        assert!(remote_redirect_allowed(
            &origin,
            &url("https://cdn.example/x.png"),
            public
        ));
    }

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

    #[test]
    fn private_and_local_targets_never_load() {
        use super::super::url::allowed_https_href;
        assert!(allowed_https_href("https://example.com/a").is_some());
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
            assert!(allowed_https_href(href).is_none(), "{href}");
        }
        assert!(is_public_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_public_ip("100.64.0.1".parse().unwrap()));
        assert!(!is_public_ip("169.254.1.1".parse().unwrap()));
        assert!(!is_public_ip("224.0.0.1".parse().unwrap()));
        assert!(is_public_ip("2606:4700::1111".parse().unwrap()));
        assert!(!is_public_ip("2001:db8::1".parse().unwrap()));
        assert!(!is_public_ip("fe80::1".parse().unwrap()));
        assert!(!is_public_ip("2002::1".parse().unwrap()));
    }
}
