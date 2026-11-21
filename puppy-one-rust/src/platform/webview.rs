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
#[cfg(test)]
mod file_tests;
pub(crate) mod files;
mod range;
mod request;
mod stream;
#[cfg(test)]
mod stream_tests;
pub use request::{ENTRY_ORIGIN, ProtocolResponse, prepare_request, respond_request};
pub use stream::{CHUNK_BYTES, PreparedResponse, ReadSeek, ResourceStream, ResponseBody};

pub const SCHEME: &str = "puppyone-preview";
/// The product's resource scheme (`puppyone-local:`): the same granted
/// resources, never the entry page or bundled scripts. The HTML visual
/// editor's projection admits only this scheme and `https:`.
pub const LOCAL_SCHEME: &str = "puppyone-local";
const ENTRY: &str = "__entry__";

/// Why a [`ResourceSource`] could not serve a relative asset (`VW-24`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceError {
    NotFound,
    TooLarge,
}

/// Relative resources that do not live in a local folder (a Cloud
/// document's assets): `relative` is decoded and has only normal components.
pub trait ResourceSource: Send + Sync {
    /// Source authority also guards bundled resources and local projections.
    fn is_live(&self) -> bool {
        true
    }
    fn read(&self, relative: &Path) -> Option<Vec<u8>>;
    /// None means this provider only supports the legacy bounded byte API.
    /// An error is terminal: never fall back to an ambient read after denial.
    fn open(&self, _relative: &Path) -> std::io::Result<Option<ResourceStream>> {
        Ok(None)
    }
    fn mime(&self, _relative: &Path) -> Option<&'static str> {
        None
    }
    fn size(&self, _relative: &Path) -> Option<u64> {
        None
    }
    /// Reads `relative` bounded by `max_bytes`, distinguishing [`SourceError::TooLarge`]
    /// (`413`) from [`SourceError::NotFound`] (`404`).
    fn read_checked(&self, relative: &Path, max_bytes: u64) -> Result<Vec<u8>, SourceError> {
        if let Some(size) = self.size(relative)
            && size > max_bytes
        {
            return Err(SourceError::TooLarge);
        }
        match self.read(relative) {
            Some(bytes) if bytes.len() as u64 <= max_bytes => Ok(bytes),
            Some(_) => Err(SourceError::TooLarge),
            None => Err(SourceError::NotFound),
        }
    }
}

/// Size-aware callback adapter for [`Source`] / [`Budgeted`] (`VW-24`).
pub struct SourceReader<SizeFn, ReadFn> {
    size: SizeFn,
    read: ReadFn,
}

impl<SizeFn, ReadFn> SourceReader<SizeFn, ReadFn>
where
    SizeFn: Fn(&Path) -> Option<u64> + Send + Sync,
    ReadFn: Fn(&Path) -> Result<Vec<u8>, SourceError> + Send + Sync,
{
    pub fn new(size: SizeFn, read: ReadFn) -> Self {
        Self { size, read }
    }
}

impl<SizeFn, ReadFn> ResourceSource for SourceReader<SizeFn, ReadFn>
where
    SizeFn: Fn(&Path) -> Option<u64> + Send + Sync,
    ReadFn: Fn(&Path) -> Result<Vec<u8>, SourceError> + Send + Sync,
{
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        (self.read)(relative).ok()
    }

    fn size(&self, relative: &Path) -> Option<u64> {
        (self.size)(relative)
    }

    fn read_checked(&self, relative: &Path, max_bytes: u64) -> Result<Vec<u8>, SourceError> {
        if let Some(size) = (self.size)(relative)
            && size > max_bytes
        {
            return Err(SourceError::TooLarge);
        }
        let bytes = (self.read)(relative)?;
        if bytes.len() as u64 > max_bytes {
            Err(SourceError::TooLarge)
        } else {
            Ok(bytes)
        }
    }
}

/// A shared source, for [`Content`].
#[derive(Clone)]
pub struct Source(pub std::sync::Arc<dyn ResourceSource>);
impl Source {
    /// Constructs a [`Source`] backed by a size-aware [`SourceReader`] (`VW-24`).
    pub fn with_size<SizeFn, ReadFn>(size: SizeFn, read: ReadFn) -> Self
    where
        SizeFn: Fn(&Path) -> Option<u64> + Send + Sync + 'static,
        ReadFn: Fn(&Path) -> Result<Vec<u8>, SourceError> + Send + Sync + 'static,
    {
        Self(std::sync::Arc::new(SourceReader::new(size, read)))
    }
}
impl ResourceSource for Source {
    fn mime(&self, relative: &Path) -> Option<&'static str> {
        self.0.mime(relative)
    }
    fn open(&self, relative: &Path) -> std::io::Result<Option<ResourceStream>> {
        self.0.open(relative)
    }
    fn is_live(&self) -> bool {
        self.0.is_live()
    }
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        self.0.read(relative)
    }

    fn size(&self, relative: &Path) -> Option<u64> {
        self.0.size(relative)
    }

    fn read_checked(&self, relative: &Path, max_bytes: u64) -> Result<Vec<u8>, SourceError> {
        self.0.read_checked(relative, max_bytes)
    }
}
impl std::fmt::Debug for Source {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Source")
    }
}
type SizeProbe = Box<dyn Fn(&Path) -> Option<u64> + Send + Sync>;

/// `projectCloudHtml`'s budgets for one projection: at most
/// `max_references` distinct resources and `max_bytes` in total.
pub struct Budgeted<S> {
    inner: S,
    size_probe: Option<SizeProbe>,
    max_references: usize,
    max_bytes: u64,
    used: std::sync::Arc<std::sync::Mutex<(std::collections::HashSet<PathBuf>, u64)>>,
}
impl<S> Budgeted<S> {
    pub fn new(inner: S, max_references: usize, max_bytes: u64) -> Self {
        Self {
            inner,
            size_probe: None,
            max_references,
            max_bytes,
            used: Default::default(),
        }
    }

    /// Attaches an explicit pre-read byte-size probe so oversized resources
    /// fail with [`SourceError::TooLarge`] (`413`) before buffering (`VW-24`).
    pub fn with_size_probe(
        mut self,
        probe: impl Fn(&Path) -> Option<u64> + Send + Sync + 'static,
    ) -> Self {
        self.size_probe = Some(Box::new(probe));
        self
    }

    fn declared_size(&self, relative: &Path) -> Option<u64>
    where
        S: ResourceSource,
    {
        self.size_probe
            .as_ref()
            .and_then(|probe| probe(relative))
            .or_else(|| self.inner.size(relative))
    }
}
impl<S: ResourceSource> ResourceSource for Budgeted<S> {
    fn mime(&self, relative: &Path) -> Option<&'static str> {
        self.inner.mime(relative)
    }
    fn open(&self, relative: &Path) -> std::io::Result<Option<ResourceStream>> {
        {
            let used = self
                .used
                .lock()
                .map_err(|_| std::io::Error::other("Budget lock unavailable"))?;
            if !used.0.contains(relative) && used.0.len() >= self.max_references {
                return Err(std::io::ErrorKind::NotFound.into());
            }
        }
        let Some(stream) = self.inner.open(relative)? else {
            return Ok(None);
        };
        let mut used = self
            .used
            .lock()
            .map_err(|_| std::io::Error::other("Budget lock unavailable"))?;
        if !used.0.contains(relative) && used.0.len() >= self.max_references {
            return Err(std::io::ErrorKind::NotFound.into());
        }
        used.0.insert(relative.to_path_buf());
        drop(used);
        Ok(Some(stream::budgeted(
            stream,
            self.used.clone(),
            self.max_bytes,
        )))
    }
    fn is_live(&self) -> bool {
        self.inner.is_live()
    }
    fn read(&self, relative: &Path) -> Option<Vec<u8>> {
        self.read_checked(relative, self.max_bytes).ok()
    }

    fn size(&self, relative: &Path) -> Option<u64> {
        self.declared_size(relative)
    }

    fn read_checked(&self, relative: &Path, per_resource_max: u64) -> Result<Vec<u8>, SourceError> {
        let single_limit = per_resource_max.min(self.max_bytes);
        if let Some(declared) = self.declared_size(relative)
            && declared > single_limit
        {
            return Err(SourceError::TooLarge);
        }
        {
            let mut used = self.used.lock().map_err(|_| SourceError::NotFound)?;
            if !used.0.contains(relative) {
                if used.0.len() >= self.max_references {
                    return Err(SourceError::NotFound);
                }
                used.0.insert(relative.to_path_buf());
            }
            if let Some(declared) = self.declared_size(relative)
                && used.1.saturating_add(declared) > self.max_bytes
            {
                return Err(SourceError::NotFound);
            }
        }
        let bytes = self.inner.read_checked(relative, single_limit)?;
        if bytes.len() as u64 > single_limit {
            return Err(SourceError::TooLarge);
        }
        let mut used = self.used.lock().map_err(|_| SourceError::NotFound)?;
        used.1 = used.1.saturating_add(bytes.len() as u64);
        if used.1 <= self.max_bytes {
            Ok(bytes)
        } else {
            Err(SourceError::NotFound)
        }
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
    /// `Content-Security-Policy` sent with every response (the entry, its
    /// resources and any document the page navigates to).
    pub policy: Option<&'static str>,
    /// Origins the page's own frames may load (App Preview's running app);
    /// everything else stays refused.
    pub frames: Option<Frames>,
    /// The app's own resources too large to embed (the whiteboard's fonts),
    /// served from a folder at `__assets__/{prefix}/…`.
    pub disk_assets: Option<DiskAssets>,
    /// The page may not leave its entry document (an HTML page that uses
    /// its folder runs offline) or the origins `frames` allows: every other
    /// navigation is refused, not even handed to the browser.
    pub locked: bool,
}

/// A host captures directory authority once, before asynchronous requests can
/// race with root renames or replacement. Missing roots remain unavailable.
#[derive(Clone, Debug)]
pub struct PreparedContent {
    content: Content,
    local_root: Option<files::LocalRoot>,
    disk_root: Option<files::LocalRoot>,
    live: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
impl Content {
    pub fn prepare(self) -> PreparedContent {
        let local_root = self
            .root
            .as_deref()
            .and_then(|p| files::LocalRoot::open(p).ok());
        let disk_root = self
            .disk_assets
            .as_ref()
            .and_then(|d| files::LocalRoot::open(&d.dir).ok());
        PreparedContent {
            content: self,
            local_root,
            disk_root,
            live: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
        }
    }
}
impl PreparedContent {
    /// Called by the owning native WebView before it is destroyed. Pending
    /// readers cannot publish bytes after the host's authority retires.
    pub fn revoke(&self) {
        self.live.store(false, std::sync::atomic::Ordering::Release);
    }
    pub fn is_live(&self) -> bool {
        self.live.load(std::sync::atomic::Ordering::Acquire)
            && self.source.as_ref().is_none_or(ResourceSource::is_live)
    }
}
impl std::ops::Deref for PreparedContent {
    type Target = Content;
    fn deref(&self) -> &Self::Target {
        &self.content
    }
}
/// A folder of trusted app resources: `prefix` names it under `__assets__/`;
/// a missing folder or file is a 404, never a fallback elsewhere.
#[derive(Clone, Debug)]
pub struct DiskAssets {
    pub prefix: &'static str,
    pub dir: PathBuf,
    /// SHA-256 verified bundle files held in memory (`__assets__/{name}`).
    pub bundles: Vec<(&'static str, std::sync::Arc<[u8]>)>,
}
/// One app resource from disk at most (Xiaolai's largest shard is ~1 MB).
const DISK_ASSET_MAX_BYTES: u64 = 8 * 1024 * 1024;
/// Frame origins a page may load, changed while it runs.
#[derive(Clone, Debug, Default)]
pub struct Frames(pub std::sync::Arc<std::sync::Mutex<Vec<String>>>);
impl Frames {
    /// Allow `url`'s origin (scheme, host and port).
    pub fn allow(&self, url: &str) {
        if let Some(origin) = origin(url)
            && let Ok(mut origins) = self.0.lock()
            && !origins.contains(&origin)
        {
            origins.push(origin);
        }
    }
    pub fn allows(&self, url: &str) -> bool {
        origin(url)
            .is_some_and(|origin| self.0.lock().is_ok_and(|origins| origins.contains(&origin)))
    }
}
/// An http(s) URL's origin.
fn origin(url: &str) -> Option<String> {
    let url = url::Url::parse(url).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
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
    /// inside it (WebKit exposes message handlers to every frame, and
    /// WebView2 reports the synthetic `http://puppyone-preview.local/__entry__`
    /// origin for custom schemes).
    pub fn accept(&self, frame_url: &str, body: String) -> bool {
        is_entry_url(frame_url) && self.0.try_send(body).is_ok()
    }
}
#[derive(Clone, Debug)]
pub enum Entry {
    Html(String),
}

/// `text/html` etc. for a served path.
pub fn mime_for(path: &Path) -> &'static str {
    if let Some(mime) = path
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(po_contracts::formats::explicit_response_mime)
    {
        return mime;
    }
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
        _ => path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(po_contracts::formats::preferred_mime)
            .unwrap_or("application/octet-stream"),
    }
}

/// Decode once and admit only relative normal components.
fn relative_path(request_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(request_path.trim_start_matches('/'))?;
    if decoded.contains('\0') || decoded.contains('\\') {
        return None;
    }
    let relative = Path::new(&decoded);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return None;
    }
    (!relative.as_os_str().is_empty()).then(|| relative.to_path_buf())
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

/// `Range: bytes=0-0` under [`LOCAL_SCHEME`] (`probeLocalResourceSize`):
/// a granted file's size and first byte, answered without reading the file,
/// so an oversized resource is refused before it is buffered.
pub fn probe_local(content: &PreparedContent, path: &str) -> Option<(u64, Vec<u8>)> {
    use std::io::Read;
    let trimmed = path.trim_start_matches('/');
    if !content.is_live()
        || trimmed == ENTRY
        || trimmed.is_empty()
        || trimmed.starts_with("__assets__/")
    {
        return None;
    }
    let opened = content
        .local_root
        .as_ref()?
        .file(&relative_path(path)?)
        .ok()?;
    let size = opened.size;
    let mut first = Vec::new();
    opened.file.take(1).read_to_end(&mut first).ok()?;
    // An empty file has no byte to range over: it is served whole.
    (content.is_live() && !first.is_empty()).then_some((size, first))
}
/// The response for `path` under [`LOCAL_SCHEME`]: resources only.
pub fn respond_local(content: &PreparedContent, path: &str) -> (u16, &'static str, Vec<u8>) {
    let trimmed = path.trim_start_matches('/');
    if trimmed == ENTRY || trimmed.is_empty() || trimmed.starts_with("__assets__/") {
        return (404, "text/plain", b"Not found".to_vec());
    }
    respond(content, path)
}
/// The response for `path` under `content` (status, mime, body).
pub fn respond(content: &PreparedContent, path: &str) -> (u16, &'static str, Vec<u8>) {
    let result = respond_request(
        content,
        false,
        "GET",
        &format!(
            "{SCHEME}://local/{path}",
            path = path.trim_start_matches('/')
        ),
        None,
        None,
    );
    (result.status, result.mime, result.body)
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
/// Synthetic WebView2 entry URL produced by `wry` on Windows when custom
/// schemes map onto `http://<scheme>.local/...`.
pub fn webview2_entry_url() -> String {
    format!("http://{SCHEME}.local/{ENTRY}")
}
/// Whether `url` is the exact entry document URL on either WKWebView
/// (`puppyone-preview://local/__entry__`) or WebView2
/// (`http://puppyone-preview.local/__entry__`).
pub fn is_entry_url(url: &str) -> bool {
    url == entry_url() || url == webview2_entry_url()
}
/// Whether `url` is the entry document or an in-document `#fragment` navigation.
pub fn is_entry_navigation_url(url: &str) -> bool {
    let matches_base = |base: String| {
        url == base
            || url
                .strip_prefix(&base)
                .is_some_and(|rest| rest.starts_with('#'))
    };
    matches_base(entry_url()) || matches_base(webview2_entry_url())
}
/// Whether `url` addresses the preview custom protocol on either WKWebView or WebView2.
pub fn is_protocol_url(url: &str) -> bool {
    url.starts_with(&format!("{SCHEME}://local/"))
        || url.starts_with(&format!("http://{SCHEME}.local/"))
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
    fn disk_assets_serve_their_folder_only_and_never_as_resources() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("fonts/Virgil")).unwrap();
        std::fs::write(dir.path().join("fonts/Virgil/Virgil.woff2"), b"wOF2").unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "x").unwrap();
        let content = Content {
            root: None,
            source: None,
            entry: Entry::Html("<p>board</p>".into()),
            max_bytes: 0,
            assets: vec![("excalidraw.js", b"x()")],
            ipc: None,
            policy: None,
            frames: None,
            disk_assets: Some(DiskAssets {
                prefix: "excalidraw",
                dir: dir.path().into(),
                bundles: Vec::new(),
            }),
            locked: false,
        }
        .prepare();
        let (status, mime, body) =
            respond(&content, "/__assets__/excalidraw/fonts/Virgil/Virgil.woff2");
        assert_eq!(
            (status, mime, body.as_slice()),
            (200, "font/woff2", &b"wOF2"[..])
        );
        // The embedded assets are still there; nothing leaves the folder.
        assert_eq!(respond(&content, "/__assets__/excalidraw.js").0, 200);
        assert_eq!(
            respond(&content, "/__assets__/excalidraw/fonts/none.woff2").0,
            404
        );
        assert_eq!(
            respond(&content, "/__assets__/excalidraw/../secret.txt").0,
            404
        );
        assert_eq!(respond(&content, "/__assets__/excalidrawfonts/x").0, 404);
        assert_eq!(
            respond_local(&content, "/__assets__/excalidraw/fonts/Virgil/Virgil.woff2").0,
            404
        );
    }

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
            policy: None,
            frames: None,
            disk_assets: None,
            locked: false,
        }
        .prepare();
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

    /// `htmlImageImport.test.ts`: SVG, a mislabelled or empty file and one
    /// over 20 MiB are refused without writing anything; a name with a
    /// path never leaves the document folder; a failed write is reported.
    #[test]
    fn image_imports_refuse_unsafe_files_and_report_failed_writes() {
        let dir = tempfile::tempdir().unwrap();
        let uuid = "0c9d3f1e-6a1b-4f2e-9c3d-1a2b3c4d5e6f";
        let png = |len: usize| {
            let mut bytes = vec![137u8, 80, 78, 71, 13, 10, 26, 10];
            bytes.resize(len.max(8), 0);
            bytes
        };
        for (name, bytes) in [
            (format!("image-{uuid}.svg"), b"<svg></svg>".to_vec()),
            (
                format!("image-{uuid}.png"),
                b"<script>bad()</script>".to_vec(),
            ),
            (format!("image-{uuid}.png"), Vec::new()),
            (format!("image-{uuid}.png"), png(20 * 1024 * 1024 + 1)),
            (format!("../private/image-{uuid}.png"), png(9)),
        ] {
            assert!(import_image(dir.path(), &name, &bytes).is_err(), "{name}");
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        let missing = dir.path().join("missing-folder");
        assert!(import_image(&missing, &format!("image-{uuid}.png"), &png(9)).is_err());
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
            policy: None,
            frames: None,
            disk_assets: None,
            locked: false,
        }
        .prepare();
        assert_eq!(respond(&content, "/style.css").0, 200);
        assert_eq!(respond(&content, "/../style.css").0, 404);
        // The second distinct resource fits the reference budget but the
        // total crosses 15 bytes; a third is past the reference budget.
        assert_eq!(respond(&content, "/img/a.png").0, 404);
        assert_eq!(respond(&content, "/img/b.png").0, 404);
    }

    #[test]
    fn oversized_provider_resource_checks_size_before_read_and_returns_413() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        let reads = Arc::new(AtomicUsize::new(0));
        let reads_in_cb = reads.clone();
        let reader = Source::with_size(
            |relative| match relative.to_str()? {
                "huge.mp4" => Some(128),
                "fit.css" => Some(6),
                "unprobed_big.bin" => None,
                _ => None,
            },
            move |relative| match relative.to_str() {
                Some("huge.mp4") => {
                    reads_in_cb.fetch_add(1, Ordering::SeqCst);
                    Ok(vec![0u8; 128])
                }
                Some("fit.css") => {
                    reads_in_cb.fetch_add(1, Ordering::SeqCst);
                    Ok(b"body{}".to_vec())
                }
                Some("unprobed_big.bin") => {
                    reads_in_cb.fetch_add(1, Ordering::SeqCst);
                    Ok(vec![1u8; 64])
                }
                _ => Err(SourceError::NotFound),
            },
        );
        let content = Content {
            root: None,
            source: Some(Source(Arc::new(Budgeted::new(reader, 8, 32)))),
            entry: Entry::Html("<p>hi</p>".into()),
            max_bytes: 32,
            assets: vec![],
            ipc: None,
            policy: None,
            frames: None,
            disk_assets: None,
            locked: false,
        };
        // Pre-read size check rejects `huge.mp4` with HTTP 413 without reading bytes into memory.
        assert_eq!(respond(&content.clone().prepare(), "/huge.mp4").0, 413);
        assert_eq!(
            reads.load(Ordering::SeqCst),
            0,
            "oversized resource with known size must not be read into memory"
        );
        // Unprobed oversized single resource also returns HTTP 413 (not 404).
        assert_eq!(
            respond(&content.clone().prepare(), "/unprobed_big.bin").0,
            413
        );
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        // Normal in-budget resource still succeeds with 200, and missing resource returns 404.
        assert_eq!(respond(&content.clone().prepare(), "/fit.css").0, 200);
        assert_eq!(respond(&content.clone().prepare(), "/missing.png").0, 404);
    }
}
