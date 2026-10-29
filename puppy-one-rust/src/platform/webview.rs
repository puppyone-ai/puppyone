//! Web content protocol for viewers whose content is a web document (HTML
//! artifacts, App previews) or best shown by the system web engine (audio,
//! video, DOCX/PPTX renderers). One `wry` child WebView per surface, placed
//! over the pane rectangle every frame.
//!
//! Content comes only through the `puppyone-preview://` protocol, scoped to
//! one granted folder (path traversal, symlinks out of the root and oversized
//! files are refused) or to an in-memory entry document. Navigation away from
//! the protocol is refused; http(s) links open in the system browser. No new
//! windows, no devtools, an ephemeral data store.
//!
//! Visibility: a host shows only while its element painted in the last drawn
//! frame and no shell overlay (menu, dialog) is open — native child views
//! draw above GPUI, so overlays hide web content instead of being covered.
use std::path::{Component, Path, PathBuf};

pub const SCHEME: &str = "puppyone-preview";
const ENTRY: &str = "__entry__";

/// What a host serves.
#[derive(Clone, Debug)]
pub struct Content {
    /// Granted folder for relative resources (`None`: entry only).
    pub root: Option<PathBuf>,
    /// The entry document (generated HTML).
    pub entry: Entry,
    /// Per-resource byte budget.
    pub max_bytes: u64,
}
#[derive(Clone, Debug)]
pub enum Entry {
    Html(String),
}

/// `text/html` etc. for a served path.
pub fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "wav" | "wave" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "m4a" | "m4b" => "audio/mp4",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "weba" => "audio/webm",
        "aif" | "aiff" | "aifc" => "audio/aiff",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mov" | "qt" => "video/quicktime",
        "3gp" | "3gpp" | "3g2" => "video/3gpp",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

/// Resolves a request path inside `root`; `None` refuses it.
pub fn resolve(root: &Path, request_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(request_path.trim_start_matches('/'))?;
    let relative = Path::new(&decoded);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return None;
    }
    let candidate = root.join(relative);
    let canonical = candidate.canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    (canonical.starts_with(&root) && canonical.is_file()).then_some(canonical)
}
fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The response for `path` under `content` (status, mime, body).
pub fn respond(content: &Content, path: &str) -> (u16, &'static str, Vec<u8>) {
    let path = path.trim_start_matches('/');
    if path == ENTRY || path.is_empty() {
        let Entry::Html(html) = &content.entry;
        return (200, "text/html; charset=utf-8", html.clone().into_bytes());
    }
    match content.root.as_deref().and_then(|root| resolve(root, path)) {
        Some(file) => serve(content, &file),
        None => (404, "text/plain", b"Not found".to_vec()),
    }
}
fn serve(content: &Content, file: &Path) -> (u16, &'static str, Vec<u8>) {
    match std::fs::metadata(file) {
        Ok(meta) if meta.len() > content.max_bytes => (
            413,
            "text/plain",
            b"Resource exceeds its preview budget".to_vec(),
        ),
        Ok(_) => match std::fs::read(file) {
            Ok(bytes) => (200, mime_for(file), bytes),
            Err(_) => (404, "text/plain", b"Not found".to_vec()),
        },
        Err(_) => (404, "text/plain", b"Not found".to_vec()),
    }
}
/// Writes `bytes` to `path` readable only by this user (temporary media).
pub fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}
/// The URL of a path inside the served root.
pub fn url_for(relative: &str) -> String {
    let encoded: Vec<String> = relative
        .split('/')
        .map(|s| {
            s.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (b as char).to_string()
                    }
                    _ => format!("%{b:02X}"),
                })
                .collect()
        })
        .collect();
    format!("{SCHEME}://local/{}", encoded.join("/"))
}
pub fn entry_url() -> String {
    format!("{SCHEME}://local/{ENTRY}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resources_stay_inside_the_granted_root_and_budget() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/a b.css"), "body{}").unwrap();
        std::fs::write(dir.path().join("big.bin"), vec![0u8; 64]).unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            dir.path().join("link.txt"),
        )
        .unwrap();
        let content = Content {
            root: Some(dir.path().into()),
            entry: Entry::Html("<p>hi</p>".into()),
            max_bytes: 32,
        };
        assert_eq!(respond(&content, "/__entry__").0, 200);
        let (status, mime, body) = respond(&content, "/assets/a%20b.css");
        assert_eq!(
            (status, mime, body.as_slice()),
            (200, "text/css; charset=utf-8", &b"body{}"[..])
        );
        assert_eq!(respond(&content, "/../secret.txt").0, 404);
        assert_eq!(respond(&content, "/link.txt").0, 404);
        assert_eq!(respond(&content, "/big.bin").0, 413);
        assert_eq!(
            url_for("assets/a b.css"),
            "puppyone-preview://local/assets/a%20b.css"
        );
        assert_eq!(mime_for(Path::new("x.MP4")), "video/mp4");
    }
}
