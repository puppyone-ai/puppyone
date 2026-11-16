//! Centralized Markdown security & resource policies (`TA-51`, `TODO-36`):
//! - HTML tag/void/self-closing sanitization & nesting depth cap (`MAX_HTML_DEPTH = 64`);
//! - TeX group recursion depth cap (`MAX_TEX_DEPTH = 64`);
//! - Pre-decode $O(1)$ `data:image/*` length check (`<= 2 MiB`);
//! - Workspace symlink & canonical containment verification (`<= 32 MiB`);
//! - Public IP validation & DNS-pinned HTTPS client construction (`TA-50`).
use crate::editor::{
    markdown::shared::{
        dom::{self, MAX_HTML_DEPTH, Parsed},
        media_source::{self, MAX_DATA_BYTES, MAX_DATA_ENCODED_LEN, MediaSource, MediaSourceError},
    },
    registry::format_byte_limit,
};
use crate::localization::{t, tf};
use gpui::SharedString;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs},
    path::{Component, Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

pub use dom::MAX_HTML_DEPTH as HTML_MAX_DEPTH;
pub use dom::is_blocked_tag as is_blocked_html_tag;
pub use media_source::{
    MAX_DATA_BYTES as DATA_URL_MAX_BYTES, MAX_DATA_ENCODED_LEN as DATA_URL_MAX_ENCODED_LEN,
};

/// Maximum recursion depth for TeX group/command conversion (`TA-51`, `TODO-36`).
pub const MAX_TEX_DEPTH: usize = 64;
/// Workspace media byte budget (`MARKDOWN_ASSET_MAX_BYTES`, `32 MiB`).
pub const MAX_WORKSPACE_ASSET_BYTES: u64 = 32 * 1024 * 1024;
/// Remote `https:` image response budget (`32 MiB`).
pub const MAX_REMOTE_IMAGE_BYTES: usize = 32 * 1024 * 1024;

const LOCAL_HOST_SUFFIXES: &[&str] = &[".localhost", ".local", ".home.arpa"];

/// Structured failure classification for Markdown assets and media (`TA-52`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum AssetFailure {
    NotFound,
    ExceedsLimit { limit_bytes: u64 },
    Blocked,
    Network(SharedString),
    InvalidFormat,
}

impl AssetFailure {
    pub fn from_source_error(err: MediaSourceError) -> Self {
        match err {
            MediaSourceError::DataTooLarge { limit_bytes } => Self::ExceedsLimit { limit_bytes },
            MediaSourceError::Empty
            | MediaSourceError::Blocked
            | MediaSourceError::OutsideWorkspace => Self::Blocked,
        }
    }

    /// Whether a user-triggered retry should re-attempt loading the resource.
    pub fn is_retryable(&self) -> bool {
        !matches!(self, Self::Blocked)
    }

    /// Concise, user-visible explanation of why the asset/media could not render (`TA-52`).
    pub fn user_reason(&self, kind_key: &'static str) -> String {
        let kind = t(kind_key);
        match self {
            Self::ExceedsLimit { limit_bytes } => tf(
                "editor.unavailable.resourceLimit",
                &[("limit", format_byte_limit(*limit_bytes).into())],
            ),
            Self::NotFound => tf(
                "editor.resource.loadFailed",
                &[("kind", kind.into()), ("detail", "File not found".into())],
            ),
            Self::Blocked => tf("editor.resource.unavailable", &[("kind", kind.into())]),
            Self::Network(detail) => tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", kind.into()),
                    (
                        "detail",
                        if detail.is_empty() {
                            "Network error".into()
                        } else {
                            crate::localization::bidi_isolate(detail).into()
                        },
                    ),
                ],
            ),
            Self::InvalidFormat => tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", kind.into()),
                    ("detail", "Unsupported or corrupted format".into()),
                ],
            ),
        }
    }
}

/// Content version stamp used by `AssetBroker` to invalidate stale bitmaps when
/// local files change on disk (`TODO-33`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ContentStamp {
    File { len: u64, modified_ns: u128 },
    Revision(u64),
    Immutable,
}

/// Sanitizes and validates an HTML snippet under `MAX_HTML_DEPTH` and `BLOCKED_TAGS`.
pub fn parse_sanitized_html(source: &str) -> Parsed {
    debug_assert_eq!(MAX_HTML_DEPTH, 64);
    dom::parse(source)
}

/// Validates and decodes a `data:image/*` URL (`<= 2 MiB`), rejecting oversized
/// encoded strings in $O(1)$ before Base64/percent decoding (`TA-51`).
pub fn validate_data_image_url(href: &str) -> Result<Vec<u8>, AssetFailure> {
    debug_assert_eq!(MAX_DATA_ENCODED_LEN, MAX_DATA_BYTES * 4 / 3 + 64);
    media_source::decode_raster_data_url(href).map_err(AssetFailure::from_source_error)
}

/// Resolves a Markdown image `href` against policy rules.
pub fn resolve_image_reference(document: &Path, href: &str) -> Result<MediaSource, AssetFailure> {
    media_source::resolve_markdown_media(document, href).map_err(AssetFailure::from_source_error)
}

/// Extracts a local filesystem root directory from `DocumentAssets.workspace`
/// when backed by a local `file://` grant or local directory path.
pub fn local_workspace_root(workspace_id: &str) -> Option<PathBuf> {
    if workspace_id.is_empty() {
        return None;
    }
    if let Ok(url) = url::Url::parse(workspace_id)
        && url.scheme() == "file"
        && let Ok(path) = url.to_file_path()
        && path.is_dir()
    {
        return Some(path);
    }
    let candidate = Path::new(workspace_id);
    (candidate.is_absolute() && candidate.is_dir()).then(|| candidate.to_path_buf())
}

/// Verifies that `relative` stays strictly inside `workspace_root` without
/// traversing symlinks (`TA-51`), exists as a regular file within `max_bytes`,
/// and returns its canonical path and [`ContentStamp`].
pub fn verify_workspace_file(
    workspace_root: &Path,
    relative: &Path,
    max_bytes: u64,
) -> Result<(PathBuf, ContentStamp), AssetFailure> {
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(AssetFailure::Blocked);
    }
    let canon_root = workspace_root
        .canonicalize()
        .map_err(|_| AssetFailure::NotFound)?;
    let mut cursor = workspace_root.to_path_buf();
    for component in relative.components() {
        cursor.push(component);
        let meta = std::fs::symlink_metadata(&cursor).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AssetFailure::NotFound
            } else {
                AssetFailure::Blocked
            }
        })?;
        if meta.file_type().is_symlink() {
            return Err(AssetFailure::Blocked);
        }
    }
    let canon_file = cursor.canonicalize().map_err(|_| AssetFailure::Blocked)?;
    if !canon_file.starts_with(&canon_root) {
        return Err(AssetFailure::Blocked);
    }
    let meta = std::fs::symlink_metadata(&canon_file).map_err(|_| AssetFailure::NotFound)?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(AssetFailure::Blocked);
    }
    if meta.len() > max_bytes {
        return Err(AssetFailure::ExceedsLimit {
            limit_bytes: max_bytes,
        });
    }
    let modified_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    Ok((
        canon_file,
        ContentStamp::File {
            len: meta.len(),
            modified_ns,
        },
    ))
}

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

/// `assertMarkdownWebEmbedHref`: accepts only credential-free `https:` URLs
/// targeting public non-local hostnames or public IP literals.
pub fn allowed_https_url(href: &str) -> Option<url::Url> {
    let url = url::Url::parse(href).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let ip = match url.host()? {
        url::Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            if name.is_empty()
                || name == "localhost"
                || LOCAL_HOST_SUFFIXES.iter().any(|s| name.ends_with(s))
            {
                return None;
            }
            None
        }
        url::Host::Ipv4(ip) => Some(IpAddr::V4(ip)),
        url::Host::Ipv6(ip) => Some(IpAddr::V6(ip)),
    };
    if ip.is_some_and(|addr| !is_public_ip(addr)) {
        return None;
    }
    Some(url)
}

pub fn allowed_https_href(href: &str) -> Option<String> {
    allowed_https_url(href).map(|u| u.to_string())
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
/// public socket address (`ClientBuilder::resolve` / `resolve_to_addrs`) and a
/// redirect guard that blocks private, loopback, non-HTTPS, or cross-origin
/// hops (`TA-50`).
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
    fn html_policy_blocks_void_and_self_closing_tags_and_deep_trees() {
        for snippet in [
            "<div><embed src=\"a.swf\"/></div>",
            "<div><base href=\"https://evil.test/\"/></div>",
            "<div><link rel=\"stylesheet\" href=\"x.css\"/></div>",
            "<div><meta charset=\"utf-8\"/></div>",
            "<div><input value=\"x\"/></div>",
        ] {
            let Parsed::Complete(nodes) = parse_sanitized_html(snippet) else {
                panic!("expected complete parse for {snippet}");
            };
            let dom::Node::Element(div) = &nodes[0] else {
                panic!("expected div");
            };
            assert!(
                div.children.is_empty(),
                "blocked tag survived in {snippet}: {div:?}"
            );
        }

        let deep = format!("{}ok{}", "<div>".repeat(200), "</div>".repeat(200));
        assert_eq!(parse_sanitized_html(&deep), Parsed::Unsupported);
    }

    #[test]
    fn oversized_data_image_url_is_rejected_before_decode() {
        let payload = "A".repeat(MAX_DATA_ENCODED_LEN + 8);
        let href = format!("data:image/png;base64,{payload}");
        assert_eq!(
            validate_data_image_url(&href),
            Err(AssetFailure::ExceedsLimit {
                limit_bytes: MAX_DATA_BYTES as u64,
            })
        );
    }

    #[test]
    fn workspace_containment_refuses_escaping_symlinks_and_oversized_files() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(ws.path().join("ok.png"), b"1234").unwrap();
        std::fs::write(outside.path().join("secret.png"), b"secret").unwrap();

        let (_, stamp) =
            verify_workspace_file(ws.path(), Path::new("ok.png"), 1024).expect("valid file");
        assert!(matches!(stamp, ContentStamp::File { len: 4, .. }));

        assert_eq!(
            verify_workspace_file(ws.path(), Path::new("ok.png"), 2),
            Err(AssetFailure::ExceedsLimit { limit_bytes: 2 })
        );
        assert_eq!(
            verify_workspace_file(ws.path(), Path::new("missing.png"), 1024),
            Err(AssetFailure::NotFound)
        );
        assert_eq!(
            verify_workspace_file(ws.path(), Path::new("../secret.png"), 1024),
            Err(AssetFailure::Blocked)
        );

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                outside.path().join("secret.png"),
                ws.path().join("escape.png"),
            )
            .unwrap();
            assert_eq!(
                verify_workspace_file(ws.path(), Path::new("escape.png"), 1024),
                Err(AssetFailure::Blocked)
            );
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
