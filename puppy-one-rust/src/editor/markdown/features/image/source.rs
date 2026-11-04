//! Where an image's bytes come from (`markdownAssetPolicy.ts`,
//! `resolveMarkdownMediaReference`): a workspace file, an `https:` URL or a
//! raster `data:` URL. Anything else (`http:`, `file:`, other schemes, a
//! path leaving the workspace) does not load.
use crate::editor::{navigation::ReferenceContext, registry::DocumentAssets};
use base64::Engine as _;
use std::path::{Path, PathBuf};

/// `MARKDOWN_ASSET_MAX_DATA_URL_BYTES`.
const MAX_DATA_BYTES: usize = 2 * 1024 * 1024;
/// `SAFE_RASTER_DATA_MIME_TYPES`.
const DATA_TYPES: &[&str] = &[
    "image/apng",
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/x-icon",
];

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Source {
    /// Workspace-relative.
    Workspace(PathBuf),
    Remote(String),
    Data(Vec<u8>),
}

impl Source {
    /// The cache identity of what it loads, within `assets`' workspace.
    pub fn key(&self, assets: Option<&DocumentAssets>) -> String {
        match self {
            Source::Workspace(path) => format!(
                "workspace:{}:{}",
                assets.map_or("", |a| a.workspace.as_str()),
                path.display()
            ),
            Source::Remote(url) => format!("remote:{url}"),
            Source::Data(bytes) => format!("data:{}", blake3::hash(bytes).to_hex()),
        }
    }
}

/// `decodeURIComponent` of one path segment.
fn decode(segment: &str) -> Option<String> {
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

/// `resolveWorkspaceRelativePath`: `href` against the document's folder
/// (or the workspace root, after `/`), never above the root.
pub fn workspace_path(document: &Path, href: &str) -> Option<PathBuf> {
    let href = href.trim();
    if href.is_empty() || href.starts_with('#') || has_scheme(href) {
        return None;
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
        let segment = decode(raw)?;
        if segment.is_empty()
            || segment.chars().any(|c| c.is_control())
            || segment.contains(['/', '\\'])
        {
            return None;
        }
        if segment == ".." {
            parts.pop()?;
        } else {
            parts.push(segment);
        }
    }
    (!parts.is_empty()).then(|| parts.iter().collect())
}

fn has_scheme(href: &str) -> bool {
    href.split_once(':').is_some_and(|(scheme, _)| {
        scheme.len() > 1
            && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    })
}

/// A Markdown image's source (`evaluateMarkdownAssetHref`, `remotePolicy`
/// `https-only` for images).
pub fn markdown(document: &Path, href: &str) -> Option<Source> {
    let href = href.trim();
    let lower = href.to_ascii_lowercase();
    if href.chars().any(|c| c.is_control()) {
        return None;
    }
    if lower.starts_with("data:") {
        return data(href).map(Source::Data);
    }
    if lower.starts_with("https:") {
        let url = url::Url::parse(href).ok()?;
        return (url.host_str().is_some_and(|h| !h.is_empty())
            && url.username().is_empty()
            && url.password().is_none())
        .then(|| Source::Remote(url.to_string()));
    }
    workspace_path(document, href).map(Source::Workspace)
}

/// An Obsidian `![[target]]` embed: the link graph's file, else a
/// workspace-root path when it names folders, else beside the document.
pub fn embed(
    document: &Path,
    target: &str,
    references: Option<&ReferenceContext>,
) -> Option<Source> {
    if let Some(resolved) = references.map(|r| r.resolve(target))
        && resolved.exists
        && !resolved.ambiguous
        && let Some(path) = resolved.path
    {
        return Some(Source::Workspace(PathBuf::from(path)));
    }
    let authored = target.split(['?', '#']).next()?.trim().replace('\\', "/");
    if authored.is_empty() {
        return None;
    }
    let href = if authored.contains('/') {
        format!("/{}", authored.trim_start_matches('/'))
    } else {
        authored
    };
    workspace_path(document, &href).map(Source::Workspace)
}

/// A raster `data:image/…` URL's bytes, at most 2 MiB.
fn data(href: &str) -> Option<Vec<u8>> {
    let (head, payload) = href.split_once(',')?;
    let mut parts = head["data:".len()..].split(';');
    let mime = parts.next()?.trim().to_ascii_lowercase();
    if !DATA_TYPES.contains(&mime.as_str()) {
        return None;
    }
    let bytes = if parts.any(|p| p.trim().eq_ignore_ascii_case("base64")) {
        let compact: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
        base64::engine::general_purpose::STANDARD
            .decode(compact)
            .ok()?
    } else {
        decode(payload)?.into_bytes()
    };
    (bytes.len() <= MAX_DATA_BYTES).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn sources_follow_the_asset_policy() {
        let doc = Path::new("notes/day.md");
        let ws = |p: &str| Some(Source::Workspace(PathBuf::from(p)));
        assert_eq!(markdown(doc, "img/a%20b.png?x=1"), ws("notes/img/a b.png"));
        assert_eq!(markdown(doc, "../top.png"), ws("top.png"));
        assert_eq!(markdown(doc, "/assets/x.png"), ws("assets/x.png"));
        assert_eq!(markdown(doc, "../../out.png"), None);
        assert_eq!(markdown(doc, "http://x.test/a.png"), None);
        assert_eq!(markdown(doc, "file:///etc/a.png"), None);
        assert_eq!(
            markdown(doc, "https://x.test/a.png"),
            Some(Source::Remote("https://x.test/a.png".into()))
        );
        assert_eq!(
            markdown(doc, "data:image/png;base64,iVBO"),
            Some(Source::Data(vec![0x89, 0x50, 0x4e]))
        );
        assert_eq!(markdown(doc, "data:text/html,<b>"), None);
        assert_eq!(embed(doc, "pic.png", None), ws("notes/pic.png"));
        assert_eq!(embed(doc, "media/pic.png", None), ws("media/pic.png"));
    }
}
