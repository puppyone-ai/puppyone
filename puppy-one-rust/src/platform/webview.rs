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
/// The product's resource scheme (`puppyone-local:`): the same granted
/// resources, never the entry page or bundled scripts. The HTML visual
/// editor's projection admits only this scheme and `https:`.
pub const LOCAL_SCHEME: &str = "puppyone-local";
const ENTRY: &str = "__entry__";

/// Relative resources that do not live in a local folder (a Cloud
/// document's assets): `relative` is decoded and has only normal components.
pub trait ResourceSource: Send + Sync {
    fn read(&self, relative: &Path) -> Option<Vec<u8>>;
}
/// A shared source, for [`Content`].
#[derive(Clone)]
pub struct Source(pub std::sync::Arc<dyn ResourceSource>);
impl ResourceSource for Source {
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        self.0.read(relative)
    }
}
impl std::fmt::Debug for Source {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Source")
    }
}
/// `projectCloudHtml`'s budgets for one projection: at most
/// `max_references` distinct resources and `max_bytes` in total.
pub struct Budgeted<S> {
    inner: S,
    max_references: usize,
    max_bytes: u64,
    used: std::sync::Mutex<(std::collections::HashSet<PathBuf>, u64)>,
}
impl<S> Budgeted<S> {
    pub fn new(inner: S, max_references: usize, max_bytes: u64) -> Self {
        Self {
            inner,
            max_references,
            max_bytes,
            used: Default::default(),
        }
    }
}
impl<S: ResourceSource> ResourceSource for Budgeted<S> {
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        {
            let mut used = self.used.lock().ok()?;
            if !used.0.contains(relative) {
                if used.0.len() >= self.max_references {
                    return None;
                }
                used.0.insert(relative.to_path_buf());
            }
        }
        let bytes = self.inner.read(relative)?;
        let mut used = self.used.lock().ok()?;
        used.1 += bytes.len() as u64;
        (used.1 <= self.max_bytes).then_some(bytes)
    }
}
/// What a host serves.
#[derive(Clone, Debug)]
pub struct Content {
    /// Granted folder for relative resources (`None`: entry only).
    pub root: Option<PathBuf>,
    /// Relative resources from a provider instead of a folder.
    pub source: Option<Source>,
    /// The entry document (generated HTML).
    pub entry: Entry,
    /// Per-resource byte budget.
    pub max_bytes: u64,
    /// Bundled renderer scripts served at `__assets__/{name}`.
    pub assets: Vec<(&'static str, &'static [u8])>,
    /// Messages the trusted entry page posts (`window.ipc.postMessage`);
    /// `None` gives the page no message channel at all.
    pub ipc: Option<Ipc>,
}
/// The receiving end of a page's messages.
#[derive(Clone)]
pub struct Ipc(pub async_channel::Sender<String>);
impl std::fmt::Debug for Ipc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Ipc")
    }
}
impl Ipc {
    /// Accept a message only from the entry document itself, not a frame
    /// inside it (WebKit exposes message handlers to every frame).
    pub fn accept(&self, frame_url: &str, body: String) -> bool {
        frame_url == entry_url() && self.0.try_send(body).is_ok()
    }
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

/// The response for `path` under [`LOCAL_SCHEME`]: resources only.
pub fn respond_local(content: &Content, path: &str) -> (u16, &'static str, Vec<u8>) {
    let trimmed = path.trim_start_matches('/');
    if trimmed == ENTRY || trimmed.is_empty() || trimmed.starts_with("__assets__/") {
        return (404, "text/plain", b"Not found".to_vec());
    }
    respond(content, path)
}
/// The response for `path` under `content` (status, mime, body).
pub fn respond(content: &Content, path: &str) -> (u16, &'static str, Vec<u8>) {
    let path = path.trim_start_matches('/');
    if path == ENTRY || path.is_empty() {
        let Entry::Html(html) = &content.entry;
        return (200, "text/html; charset=utf-8", html.clone().into_bytes());
    }
    if let Some(name) = path.strip_prefix("__assets__/") {
        return match content.assets.iter().find(|(n, _)| *n == name) {
            Some((n, bytes)) => (200, mime_for(Path::new(n)), bytes.to_vec()),
            None => (404, "text/plain", b"Not found".to_vec()),
        };
    }
    if let (None, Some(source)) = (&content.root, &content.source) {
        let Some(relative) = percent_decode(path)
            .map(PathBuf::from)
            .filter(|p| p.components().all(|c| matches!(c, Component::Normal(_))))
        else {
            return (404, "text/plain", b"Not found".to_vec());
        };
        return match source.0.read(&relative) {
            Some(bytes) if bytes.len() as u64 <= content.max_bytes => {
                (200, mime_for(&relative), bytes)
            }
            Some(_) => (
                413,
                "text/plain",
                b"Resource exceeds its preview budget".to_vec(),
            ),
            None => (404, "text/plain", b"Not found".to_vec()),
        };
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
/// `fs.mkdtemp` + `writeFile(…, {mode: 0o400})`: a private, read-only copy
/// of provider bytes in its own temporary directory, removed with it.
pub fn private_copy(name: &str, bytes: &[u8]) -> std::io::Result<(tempfile::TempDir, PathBuf)> {
    let dir = tempfile::Builder::new()
        .prefix("puppyone-cloud-preview-")
        .tempdir()?;
    let path = dir.path().join(name);
    write_private(&path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400))?;
    }
    Ok((dir, path))
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
/// `url_for` under [`LOCAL_SCHEME`].
pub fn local_url_for(relative: &str) -> String {
    url_for(relative).replacen(SCHEME, LOCAL_SCHEME, 1)
}
/// `createDocumentAssetImportPort`: an image imported beside a document
/// as `image-<uuid>.<png|jpg|gif|webp>`, at most 20 MiB, whose bytes match
/// its extension. Never replaces an existing file.
pub fn import_image(folder: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let valid = regex::Regex::new(
        r"^image-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$",
    )
    .map_err(|e| e.to_string())?;
    let Some(extension) = valid.captures(name).and_then(|c| c.get(1)) else {
        return Err("invalid-image-name".into());
    };
    let kind = if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        "png"
    } else if bytes.starts_with(&[255, 216, 255]) {
        "jpg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "gif"
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        ""
    };
    if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024 || kind != extension.as_str() {
        return Err("invalid-image".into());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join(name))
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())
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
            source: None,
            entry: Entry::Html("<p>hi</p>".into()),
            max_bytes: 32,
            assets: vec![("r.js", b"x()")],
            ipc: None,
        };
        assert_eq!(
            respond(&content, "/__assets__/r.js").1,
            "text/javascript; charset=utf-8"
        );
        assert_eq!(respond(&content, "/__assets__/missing.js").0, 404);
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
        // The resource scheme never serves the page or its scripts.
        assert_eq!(respond_local(&content, "/__entry__").0, 404);
        assert_eq!(respond_local(&content, "/__assets__/r.js").0, 404);
        assert_eq!(respond_local(&content, "/assets/a%20b.css").0, 200);
        assert_eq!(
            local_url_for("a b.html"),
            "puppyone-local://local/a%20b.html"
        );
    }

    #[test]
    fn imported_images_are_new_files_whose_bytes_match_their_name() {
        let dir = tempfile::tempdir().unwrap();
        let png = [137u8, 80, 78, 71, 13, 10, 26, 10, 0, 0];
        let name = "image-0c9d3f1e-6a1b-4f2e-9c3d-1a2b3c4d5e6f.png";
        import_image(dir.path(), name, &png).unwrap();
        assert_eq!(std::fs::read(dir.path().join(name)).unwrap(), png);
        // No replacement, no other names, no mislabelled bytes.
        assert!(import_image(dir.path(), name, &png).is_err());
        assert!(import_image(dir.path(), "../x.png", &png).is_err());
        assert!(
            import_image(
                dir.path(),
                "image-0c9d3f1e-6a1b-4f2e-9c3d-1a2b3c4d5e70.jpg",
                &png
            )
            .is_err()
        );
        let entry = Ipc(async_channel::unbounded().0);
        assert!(!entry.accept("about:srcdoc", "{}".into()));
    }

    struct Memory;
    impl ResourceSource for Memory {
        fn read(&self, relative: &Path) -> Option<Vec<u8>> {
            match relative.to_str()? {
                "style.css" => Some(b"body{}".to_vec()),
                "img/a.png" => Some(vec![0; 10]),
                "img/b.png" => Some(vec![0; 10]),
                _ => None,
            }
        }
    }

    #[test]
    fn a_provider_source_serves_normal_paths_within_its_budgets() {
        let content = Content {
            root: None,
            source: Some(Source(std::sync::Arc::new(Budgeted::new(Memory, 2, 15)))),
            entry: Entry::Html("<p>hi</p>".into()),
            max_bytes: 64,
            assets: vec![],
            ipc: None,
        };
        assert_eq!(respond(&content, "/style.css").0, 200);
        assert_eq!(respond(&content, "/../style.css").0, 404);
        // The second distinct resource fits the reference budget but the
        // total crosses 15 bytes; a third is past the reference budget.
        assert_eq!(respond(&content, "/img/a.png").0, 404);
        assert_eq!(respond(&content, "/img/b.png").0, 404);
    }
}
