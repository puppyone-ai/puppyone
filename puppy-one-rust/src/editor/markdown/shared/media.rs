//! Shared Markdown media reference parsing (`markdownAssetPolicy.ts`,
//! `resolveMarkdownMediaReference`): resolves standard Markdown media URLs,
//! safe raster `data:image/*` URLs, and Obsidian `![[target|alias]]` embeds
//! without importing any sibling feature, core, or platform module.
use crate::editor::{navigation::ReferenceContext, registry::DocumentAssets};
use base64::Engine as _;
use std::path::{Path, PathBuf};

/// `MARKDOWN_ASSET_MAX_DATA_URL_BYTES` (`2 MiB`).
pub const MAX_DATA_BYTES: usize = 2 * 1024 * 1024;
/// Maximum encoded `data:image/*` payload length accepted before Base64 or
/// percent decoding (`MAX_DATA_BYTES * 4 / 3 + 64`), rejecting oversized inline
/// payloads in $O(1)$ without allocating multi-megabyte buffers (`TA-51`).
pub const MAX_DATA_ENCODED_LEN: usize = MAX_DATA_BYTES * 4 / 3 + 64;

/// `SAFE_RASTER_DATA_MIME_TYPES` (`data:image/svg+xml` is intentionally excluded).
pub const SAFE_RASTER_DATA_MIMES: &[&str] = &[
    "image/apng",
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/x-icon",
];

/// Media element kind shared by HTML blocks (`<video>` / `<audio>`) and the
/// video feature (`platform::embed` media player).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Audio,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum MediaSource {
    /// Workspace-relative path (normalized, never escaping workspace root).
    Workspace(PathBuf),
    /// Credential-free `https:` URL.
    Remote(String),
    /// Validated raster `data:image/*` payload (`<= 2 MiB`) or inline SVG bytes.
    Data(Vec<u8>),
}

impl MediaSource {
    /// Stable logical target string within `assets`' workspace.
    pub fn key(&self, assets: Option<&DocumentAssets>) -> String {
        match self {
            Self::Workspace(path) => format!(
                "workspace:{}:{}",
                assets.map(|a| a.workspace_identity()).unwrap_or_default(),
                path.display()
            ),
            Self::Remote(url) => format!("remote:{url}"),
            Self::Data(bytes) => format!("data:{}", blake3::hash(bytes).to_hex()),
        }
    }
}

/// Why a media reference was rejected before loading.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MediaSourceError {
    Empty,
    Blocked,
    OutsideWorkspace,
    DataTooLarge { limit_bytes: u64 },
}

/// `decodeURIComponent` of a single URL/path segment.
pub fn percent_decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = segment.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn has_scheme(href: &str) -> bool {
    href.split_once(':').is_some_and(|(scheme, _)| {
        scheme.len() > 1
            && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    })
}

/// `resolveWorkspaceRelativePath`: resolves `href` against `document`'s parent
/// folder (or workspace root when prefixed with `/`), refusing `..` above root.
pub fn resolve_workspace_path(document: &Path, href: &str) -> Result<PathBuf, MediaSourceError> {
    let href = href.trim();
    if href.is_empty() || href.starts_with('#') {
        return Err(MediaSourceError::Empty);
    }
    if href.starts_with("//") || has_scheme(href) {
        return Err(MediaSourceError::Blocked);
    }
    let mut parts: Vec<String> = if href.starts_with('/') {
        Vec::new()
    } else {
        let mut parts: Vec<String> = document
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        parts.pop();
        parts
    };
    let path = href
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .replace('\\', "/");
    for raw in path.split('/') {
        if raw.is_empty() || raw == "." {
            continue;
        }
        let segment = percent_decode(raw).ok_or(MediaSourceError::Blocked)?;
        if segment.is_empty()
            || segment.chars().any(|c| c.is_control())
            || segment.contains(['/', '\\'])
        {
            return Err(MediaSourceError::Blocked);
        }
        if segment == ".." {
            if parts.pop().is_none() {
                return Err(MediaSourceError::OutsideWorkspace);
            }
        } else {
            parts.push(segment);
        }
    }
    if parts.is_empty() {
        Err(MediaSourceError::Empty)
    } else {
        Ok(PathBuf::from(parts.join("/")))
    }
}

pub fn workspace_path(document: &Path, href: &str) -> Option<PathBuf> {
    resolve_workspace_path(document, href).ok()
}

/// Validates and decodes a raster `data:image/*` URL (`<= 2 MiB`), checking the
/// encoded payload length in $O(1)$ BEFORE allocating or Base64/percent decoding.
pub fn decode_raster_data_url(href: &str) -> Result<Vec<u8>, MediaSourceError> {
    let Some((head, payload)) = href.split_once(',') else {
        return Err(MediaSourceError::Blocked);
    };
    if head.len() < "data:".len() {
        return Err(MediaSourceError::Blocked);
    }
    let mut parts = head["data:".len()..].split(';');
    let mime = parts
        .next()
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !SAFE_RASTER_DATA_MIMES.contains(&mime.as_str()) {
        return Err(MediaSourceError::Blocked);
    }
    if payload.len() > MAX_DATA_ENCODED_LEN {
        return Err(MediaSourceError::DataTooLarge {
            limit_bytes: MAX_DATA_BYTES as u64,
        });
    }
    let is_base64 = parts.any(|p| p.trim().eq_ignore_ascii_case("base64"));
    let bytes = if is_base64 {
        if payload.bytes().all(|b| !b.is_ascii_whitespace()) {
            base64::engine::general_purpose::STANDARD
                .decode(payload.as_bytes())
                .map_err(|_| MediaSourceError::Blocked)?
        } else {
            let compact: Vec<u8> = payload
                .bytes()
                .filter(|b| !b.is_ascii_whitespace())
                .collect();
            base64::engine::general_purpose::STANDARD
                .decode(&compact)
                .map_err(|_| MediaSourceError::Blocked)?
        }
    } else {
        percent_decode(payload)
            .ok_or(MediaSourceError::Blocked)?
            .into_bytes()
    };
    if bytes.len() > MAX_DATA_BYTES {
        return Err(MediaSourceError::DataTooLarge {
            limit_bytes: MAX_DATA_BYTES as u64,
        });
    }
    Ok(bytes)
}

/// Where a document's media references resolve: its workspace-relative
/// path, and the identity of its workspace root (`DocumentAssets.workspace`).
#[derive(Clone, Copy, Debug)]
pub struct Base<'a> {
    pub document: &'a Path,
    pub root: &'a str,
}

impl<'a> Base<'a> {
    pub fn of(assets: &'a DocumentAssets) -> Self {
        Self {
            document: &assets.document,
            root: &assets.workspace,
        }
    }

    /// `assets`' base, or `document` alone when the document has no assets.
    pub fn or_document(assets: Option<&'a DocumentAssets>, document: &'a Path) -> Self {
        assets.map_or(Self::from(document), Self::of)
    }
}

impl<'a> From<&'a Path> for Base<'a> {
    fn from(document: &'a Path) -> Self {
        Self { document, root: "" }
    }
}

/// Hosted (Cloud) workspace roots are `puppyone-cloud:` URLs.
const HOSTED_SCHEME: &str = "puppyone-cloud";

/// `resolveWorkspaceAssetInput`: an authored absolute `puppyone-cloud:` URL
/// inside the document's own hosted root is the root path after it. Another
/// root, a URL that leaves the root, and any query or fragment (a capability
/// token) are refused. Other hrefs pass through.
fn hosted_root_path(root: &str, href: &str) -> Result<Option<String>, MediaSourceError> {
    let is_hosted = |s: &str| {
        s.split_once(':')
            .is_some_and(|(scheme, _)| scheme.eq_ignore_ascii_case(HOSTED_SCHEME))
    };
    if !is_hosted(href) {
        return Ok(None);
    }
    let url = url::Url::parse(href).map_err(|_| MediaSourceError::Blocked)?;
    let root = url::Url::parse(root).map_err(|_| MediaSourceError::Blocked)?;
    if root.scheme() != HOSTED_SCHEME || url.query().is_some() || url.fragment().is_some() {
        return Err(MediaSourceError::Blocked);
    }
    let root = root.as_str();
    let root = root.strip_suffix('/').unwrap_or(root);
    match url.as_str().strip_prefix(root) {
        Some(rest) if rest.starts_with('/') => Ok(Some(rest.to_owned())),
        _ => Err(MediaSourceError::OutsideWorkspace),
    }
}

/// Resolves a Markdown image/media `href` with detailed policy failure reasons.
pub fn resolve_markdown_media<'a>(
    base: impl Into<Base<'a>>,
    href: &str,
) -> Result<MediaSource, MediaSourceError> {
    let Base { document, root } = base.into();
    let href = href.trim();
    if href.is_empty() {
        return Err(MediaSourceError::Empty);
    }
    if href.chars().any(|c| c.is_control()) {
        return Err(MediaSourceError::Blocked);
    }
    let lower = href.to_ascii_lowercase();
    if lower.starts_with("data:") {
        return decode_raster_data_url(href).map(MediaSource::Data);
    }
    if lower.starts_with("https:") {
        let url = url::Url::parse(href).map_err(|_| MediaSourceError::Blocked)?;
        if url.host_str().is_some_and(|h| !h.is_empty())
            && url.username().is_empty()
            && url.password().is_none()
        {
            return Ok(MediaSource::Remote(url.to_string()));
        }
        return Err(MediaSourceError::Blocked);
    }
    if let Some(path) = hosted_root_path(root, href)? {
        return resolve_workspace_path(document, &path).map(MediaSource::Workspace);
    }
    resolve_workspace_path(document, href).map(MediaSource::Workspace)
}

/// `evaluateMarkdownAssetHref` (`https-only` for remote images).
pub fn markdown<'a>(base: impl Into<Base<'a>>, href: &str) -> Option<MediaSource> {
    resolve_markdown_media(base, href).ok()
}

/// Resolves an Obsidian `![[target]]` embed with detailed policy failure reasons.
pub fn resolve_embed_media(
    document: &Path,
    target: &str,
    references: Option<&ReferenceContext>,
) -> Result<MediaSource, MediaSourceError> {
    if let Some(resolved) = references.map(|r| r.resolve(target))
        && resolved.exists
        && !resolved.ambiguous
        && let Some(path) = resolved.path
    {
        return Ok(MediaSource::Workspace(PathBuf::from(path)));
    }
    let Some(raw) = target.split(['?', '#']).next() else {
        return Err(MediaSourceError::Empty);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(MediaSourceError::Empty);
    }
    if trimmed.starts_with("//") || has_scheme(trimmed) {
        return Err(MediaSourceError::Blocked);
    }
    let authored = trimmed.replace('\\', "/");
    let href = if authored.contains('/') {
        format!("/{}", authored.trim_start_matches('/'))
    } else {
        authored
    };
    resolve_workspace_path(document, &href).map(MediaSource::Workspace)
}

/// An Obsidian `![[target]]` embed: the link graph's file, else a
/// workspace-root path when it names folders, else beside the document.
pub fn embed(
    document: &Path,
    target: &str,
    references: Option<&ReferenceContext>,
) -> Option<MediaSource> {
    resolve_embed_media(document, target, references).ok()
}

/// `parseMarkdownImageSize`: `100` sets width, `100x50` or `100X50` sets both.
pub fn parse_image_size(value: &str) -> Option<(f32, Option<f32>)> {
    let value = value.trim();
    let (w, h) = match value.split_once(['x', 'X']) {
        Some((w, h)) => (w, Some(h)),
        None => (value, None),
    };
    let number = |s: &str| {
        (!s.is_empty() && s.len() <= 4 && s.chars().all(|c| c.is_ascii_digit()))
            .then(|| s.parse::<f32>().ok())
            .flatten()
    };
    Some((
        number(w)?,
        match h {
            Some(h) => Some(number(h)?),
            None => None,
        },
    ))
}

/// `splitMarkdownImageAlt`: strips a trailing `|size` alias from `alt`.
pub fn split_image_alt(alt: &str) -> (String, Option<(f32, Option<f32>)>) {
    match alt
        .rsplit_once('|')
        .and_then(|(text, s)| Some((text, parse_image_size(s)?)))
    {
        Some((text, size)) => (text.trim().to_owned(), Some(size)),
        None => (alt.to_owned(), None),
    }
}

/// `parseVideoSize`: `640` or `640x360`, each `1..=4096`.
pub fn parse_video_size(value: &str) -> Option<(u32, Option<u32>)> {
    let (w, h) = match value.trim().split_once('x') {
        Some((w, h)) => (w, Some(h)),
        None => (value.trim(), None),
    };
    let number = |s: &str| {
        (!s.is_empty() && s.len() <= 4 && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse::<u32>().ok())
            .flatten()
            .filter(|n| (1..=4096).contains(n))
    };
    Some((
        number(w)?,
        match h {
            Some(h) => Some(number(h)?),
            None => None,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn media_sources_and_oversized_data_urls_follow_policy() {
        let doc = Path::new("notes/day.md");
        let ws = |p: &str| Some(MediaSource::Workspace(PathBuf::from(p)));
        assert_eq!(markdown(doc, "img/a%20b.png?x=1"), ws("notes/img/a b.png"));
        assert_eq!(markdown(doc, "../top.png"), ws("top.png"));
        assert_eq!(markdown(doc, "/assets/x.png"), ws("assets/x.png"));
        assert_eq!(
            resolve_markdown_media(doc, "../../out.png"),
            Err(MediaSourceError::OutsideWorkspace)
        );
        assert_eq!(markdown(doc, "http://x.test/a.png"), None);
        assert_eq!(markdown(doc, "file:///etc/a.png"), None);
        assert_eq!(
            markdown(doc, "https://x.test/a.png"),
            Some(MediaSource::Remote("https://x.test/a.png".into()))
        );
        assert_eq!(
            markdown(doc, "data:image/png;base64,iVBO"),
            Some(MediaSource::Data(vec![0x89, 0x50, 0x4e]))
        );
        assert_eq!(markdown(doc, "data:text/html,<b>"), None);
        assert_eq!(markdown(doc, "data:image/svg+xml;base64,PHN2Zz4="), None);
        assert_eq!(embed(doc, "pic.png", None), ws("notes/pic.png"));
        assert_eq!(embed(doc, "media/pic.png", None), ws("media/pic.png"));
        assert_eq!(embed(doc, "https://x.test/v.mp4", None), None);

        // Oversized encoded `data:image/png;base64,...` (> MAX_DATA_BYTES * 4 / 3 + 64)
        // is rejected immediately before Base64 decoding (even with invalid Base64 characters!).
        let oversized = format!(
            "data:image/png;base64,{}",
            "!".repeat(MAX_DATA_ENCODED_LEN + 1)
        );
        assert_eq!(
            resolve_markdown_media(doc, &oversized),
            Err(MediaSourceError::DataTooLarge {
                limit_bytes: MAX_DATA_BYTES as u64,
            })
        );
    }

    /// `markdownAssetPolicy.test.ts` #0: in a hosted document, relative,
    /// root and absolute `puppyone-cloud:` references inside the complete
    /// account/project/scope root resolve to the same workspace path; escapes,
    /// a sibling root, another host and a token query are refused, and an
    /// absolute reference needs the document's root.
    #[test]
    fn hosted_absolute_references_resolve_only_inside_the_documents_root() {
        let root = "puppyone-cloud://cloud.example/https/api/v1/owner/project/scope/";
        let base = Base {
            document: Path::new("notes/doc.md"),
            root,
        };
        let inside = format!("{root}assets/a.png");
        for href in ["../assets/a.png", "/assets/a.png", inside.as_str()] {
            assert_eq!(
                markdown(base, href),
                Some(MediaSource::Workspace(PathBuf::from("assets/a.png"))),
                "{href}"
            );
        }
        let sibling = format!("{}-other/a.png", root.trim_end_matches('/'));
        let above = format!("{root}../a.png");
        let encoded_above = format!("{root}%2e%2e/a.png");
        for href in [
            "../../secret.png",
            "/../../secret.png",
            sibling.as_str(),
            above.as_str(),
            encoded_above.as_str(),
            "puppyone-cloud://other.example/https/api/v1/owner/project/scope/a.png",
        ] {
            assert_eq!(markdown(base, href), None, "{href}");
        }
        for href in [format!("{inside}?token=secret"), format!("{inside}#part")] {
            assert_eq!(
                resolve_markdown_media(base, &href),
                Err(MediaSourceError::Blocked),
                "{href}"
            );
        }
        // Without the document's root an absolute reference is refused, and
        // a root of another kind never admits one.
        assert_eq!(markdown(base.document, &inside), None);
        for other in ["", "workspace:local", "file:///Users/me/project/"] {
            let base = Base {
                root: other,
                ..base
            };
            assert_eq!(markdown(base, &inside), None, "{other}");
        }
        // The URL scheme is case-insensitive; the root without its trailing
        // slash is the same root.
        let upper = inside.replacen("puppyone-cloud", "PUPPYONE-CLOUD", 1);
        let bare = Base {
            root: root.trim_end_matches('/'),
            ..base
        };
        for (base, href) in [(base, upper.as_str()), (bare, inside.as_str())] {
            assert_eq!(
                markdown(base, href),
                Some(MediaSource::Workspace(PathBuf::from("assets/a.png"))),
                "{href}"
            );
        }
    }

    /// `markdownAssetPolicy.test.ts` under the product's settings (images
    /// `https-only`, video `deny`): executable and local schemes, capability
    /// URLs, credentials, plain http, SVG and oversized data and workspace
    /// escapes are refused; small raster data, credential-free https images
    /// and workspace paths beside the document load; a video never loads
    /// remotely.
    #[test]
    fn markdown_assets_follow_the_products_image_and_video_settings() {
        let doc = Path::new("notes/doc.md");
        for href in [
            "file:///etc/passwd.png",
            "javascript:alert(1)",
            "vbscript:msgbox",
            "blob:https://app.example/id",
            "puppyone-local://file/token/root/a.png",
            "https://user:pass@example.com/a.png",
            "http://example.com/a.png",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "../../secret.png",
        ] {
            assert_eq!(markdown(doc, href), None, "{href}");
        }
        assert_eq!(
            markdown(doc, "data:image/png;base64,iVBO"),
            Some(MediaSource::Data(vec![0x89, 0x50, 0x4e]))
        );
        assert_eq!(
            markdown(doc, "https://example.com/a.png"),
            Some(MediaSource::Remote("https://example.com/a.png".into()))
        );
        assert_eq!(
            markdown(doc, "./img/a.png"),
            Some(MediaSource::Workspace(PathBuf::from("notes/img/a.png")))
        );
        assert_eq!(embed(doc, "https://example.com/clip.mp4", None), None);
        assert_eq!(markdown(doc, "data:video/mp4;base64,AAAA"), None);
        assert_eq!(
            embed(doc, "assets/clip.mp4", None),
            Some(MediaSource::Workspace(PathBuf::from("assets/clip.mp4")))
        );
    }
}
