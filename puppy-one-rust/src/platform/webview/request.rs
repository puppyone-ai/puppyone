use super::{PreparedContent, ResourceSource, files, mime_for, range::ByteRange, relative_path};
use std::{io::Read, path::Path};

#[cfg(not(target_os = "windows"))]
pub const ENTRY_ORIGIN: &str = "puppyone-preview://local";
// Wry restores custom schemes in request URIs on WebView2, but Origin stays
// the browser's synthetic HTTP origin (the default non-HTTPS workaround).
#[cfg(target_os = "windows")]
pub const ENTRY_ORIGIN: &str = "http://puppyone-preview.local";

/// Transport-neutral response; the native adapter supplies security/CORS
/// headers and consumes the bounded body. Wry currently buffers that body.
pub struct ProtocolResponse {
    pub status: u16,
    pub mime: &'static str,
    pub body: Vec<u8>,
    pub length: Option<u64>,
    pub content_range: Option<String>,
    pub accept_ranges: bool,
    pub cors: bool,
}
impl ProtocolResponse {
    fn error(status: u16, text: &'static str) -> Self {
        Self {
            status,
            mime: "text/plain",
            body: text.as_bytes().to_vec(),
            length: Some(text.len() as u64),
            content_range: None,
            accept_ranges: false,
            cors: false,
        }
    }
    fn bytes(mime: &'static str, bytes: &[u8], head: bool, range: Option<&str>) -> Self {
        let mut result = Self::metadata(mime, bytes.len() as u64);
        if !head {
            match ByteRange::parse(range, bytes.len() as u64) {
                ByteRange::Whole => result.body = bytes.to_vec(),
                ByteRange::Part { start, end } => {
                    result.partial(start, end, bytes.len() as u64);
                    result.body = bytes[start as usize..=end as usize].to_vec();
                }
                ByteRange::Unsatisfiable => result.unsatisfiable(bytes.len() as u64),
            }
        }
        result
    }
    fn metadata(mime: &'static str, size: u64) -> Self {
        Self {
            status: 200,
            mime,
            body: Vec::new(),
            length: Some(size),
            content_range: None,
            accept_ranges: true,
            cors: false,
        }
    }
    fn partial(&mut self, start: u64, end: u64, size: u64) {
        self.status = 206;
        self.length = Some(end - start + 1);
        self.content_range = Some(format!("bytes {start}-{end}/{size}"));
    }
    fn unsatisfiable(&mut self, size: u64) {
        self.status = 416;
        self.length = Some(0);
        self.content_range = Some(format!("bytes */{size}"));
    }
}

/// Both native protocol handlers use this admission path, before any provider
/// I/O. A custom protocol is owned by this host, and its authority retires with
/// the host. Foreign origins never gain access merely because CORS is absent.
pub fn respond_request(
    content: &PreparedContent,
    local: bool,
    method: &str,
    uri: &str,
    origin: Option<&str>,
    range: Option<&str>,
) -> ProtocolResponse {
    let head = method == "HEAD";
    let mut result = if !matches!(method, "GET" | "HEAD" | "OPTIONS") {
        ProtocolResponse::error(405, "Method not allowed")
    } else if !content.is_live() || origin.is_some_and(|o| o != ENTRY_ORIGIN) {
        ProtocolResponse::error(403, "Forbidden")
    } else if let Some(path) = request_path(uri, local) {
        if method == "OPTIONS" {
            let mut result = ProtocolResponse::metadata("text/plain", 0);
            result.status = 204;
            result.length = None;
            result.accept_ranges = false;
            result
        } else {
            resource(content, local, path, head, range)
        }
    } else {
        ProtocolResponse::error(403, "Forbidden")
    };
    if !content.is_live() {
        result = ProtocolResponse::error(403, "Forbidden");
    }
    result.cors = origin == Some(ENTRY_ORIGIN);
    if head {
        result.body.clear();
    }
    result
}

fn request_path(uri: &str, local: bool) -> Option<&str> {
    let scheme = if local {
        super::LOCAL_SCHEME
    } else {
        super::SCHEME
    };
    let rest = uri.strip_prefix(scheme)?.strip_prefix("://local")?;
    // Exact authority, no user-info, port, query or lookalike host/scheme.
    // Fragments are viewer state, as in the Electron capability handler.
    let path = rest.split_once('#').map_or(rest, |(p, _)| p);
    if !path.starts_with('/') || path.contains('?') {
        return None;
    }
    Some(path)
}

fn resource(
    content: &PreparedContent,
    local: bool,
    path: &str,
    head: bool,
    range: Option<&str>,
) -> ProtocolResponse {
    let path = path.trim_start_matches('/');
    if path == super::ENTRY || path.is_empty() {
        if local {
            return ProtocolResponse::error(404, "Not found");
        }
        let super::Entry::Html(html) = &content.entry;
        return ProtocolResponse::bytes("text/html; charset=utf-8", html.as_bytes(), head, range);
    }
    if let Some(name) = path.strip_prefix("__assets__/") {
        if local {
            return ProtocolResponse::error(404, "Not found");
        }
        if let Some(disk) = &content.disk_assets
            && let Some(relative) = name
                .strip_prefix(disk.prefix)
                .and_then(|n| n.strip_prefix('/'))
        {
            return file(
                content,
                content.disk_root.as_ref(),
                relative,
                super::DISK_ASSET_MAX_BYTES,
                head,
                range,
            );
        }
        return content
            .assets
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(name, bytes)| {
                ProtocolResponse::bytes(mime_for(Path::new(name)), bytes, head, range)
            })
            .unwrap_or_else(|| ProtocolResponse::error(404, "Not found"));
    }
    if content.root.is_none()
        && let Some(source) = &content.source
    {
        let Some(relative) = relative_path(path) else {
            return ProtocolResponse::error(404, "Not found");
        };
        if head {
            // A provider must explicitly support metadata. Never disguise a
            // complete body fetch as a metadata-only HEAD.
            return source
                .0
                .size(&relative)
                .map(|size| ProtocolResponse::metadata(mime_for(&relative), size))
                .unwrap_or_else(|| ProtocolResponse::error(501, "Provider metadata unavailable"));
        }
        return match source.read(&relative) {
            Some(bytes) if bytes.len() as u64 <= content.max_bytes => {
                ProtocolResponse::bytes(mime_for(&relative), &bytes, false, range)
            }
            Some(_) => ProtocolResponse::error(413, "Resource exceeds its preview budget"),
            None => ProtocolResponse::error(404, "Not found"),
        };
    }
    file(
        content,
        content.local_root.as_ref(),
        path,
        content.max_bytes,
        head,
        range,
    )
}

fn file(
    content: &PreparedContent,
    root: Option<&files::LocalRoot>,
    path: &str,
    max: u64,
    head: bool,
    range: Option<&str>,
) -> ProtocolResponse {
    let Some(opened) = root.and_then(|r| r.file(&relative_path(path)?).ok()) else {
        return ProtocolResponse::error(404, "Not found");
    };
    let size = opened.size;
    let mut result = ProtocolResponse::metadata(mime_for(&opened.relative), size);
    if head {
        return result;
    }
    let bytes = match ByteRange::parse(range, size) {
        ByteRange::Whole => opened.read_bounded(max),
        ByteRange::Unsatisfiable => {
            result.unsatisfiable(size);
            return result;
        }
        ByteRange::Part { start, end } => {
            result.partial(start, end, size);
            let length = end - start + 1;
            if length > max {
                return ProtocolResponse::error(413, "Resource exceeds its preview budget");
            }
            opened
                .stream(start, length, content.live.clone())
                .and_then(|mut stream| {
                    let mut bytes = Vec::new();
                    stream.read_to_end(&mut bytes)?;
                    if bytes.len() as u64 != length {
                        return Err(std::io::Error::other("Resource changed while reading"));
                    }
                    Ok(bytes)
                })
        }
    };
    match bytes {
        Ok(bytes) => {
            result.body = bytes;
            result
        }
        Err(e) if e.kind() == std::io::ErrorKind::FileTooLarge => {
            ProtocolResponse::error(413, "Resource exceeds its preview budget")
        }
        Err(_) => ProtocolResponse::error(404, "Not found"),
    }
}
