use super::{
    PreparedContent, PreparedResponse, ResourceSource, ResourceStream, files, mime_for,
    range::ByteRange, relative_path,
};
use std::path::Path;

#[cfg(not(target_os = "windows"))]
pub const ENTRY_ORIGIN: &str = "puppyone-preview://local";
// Wry restores custom schemes in request URIs on WebView2, but Origin stays
// the browser's synthetic HTTP origin (the default non-HTTPS workaround).
#[cfg(target_os = "windows")]
pub const ENTRY_ORIGIN: &str = "http://puppyone-preview.local";

/// Transport-neutral response; the native adapter supplies security/CORS
/// headers. Streaming transports use this as metadata with an empty body.
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
    pub(super) fn error(status: u16, text: &'static str) -> Self {
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
    pub(super) fn metadata(mime: &'static str, size: u64) -> Self {
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
    pub(super) fn partial(&mut self, start: u64, end: u64, size: u64) {
        self.status = 206;
        self.length = Some(end - start + 1);
        self.content_range = Some(format!("bytes {start}-{end}/{size}"));
    }
    pub(super) fn unsatisfiable(&mut self, size: u64) {
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
    let mut response = prepare_request(content, local, method, uri, origin, range).collect();
    if method == "HEAD" {
        response.body.clear();
    }
    response
}

pub fn prepare_request(
    content: &PreparedContent,
    local: bool,
    method: &str,
    uri: &str,
    origin: Option<&str>,
    range: Option<&str>,
) -> PreparedResponse {
    let head = method == "HEAD";
    let immediate = |response| PreparedResponse::bytes(content, response);
    let mut result = if !matches!(method, "GET" | "HEAD" | "OPTIONS") {
        immediate(ProtocolResponse::error(405, "Method not allowed"))
    } else if !content.is_live() || origin.is_some_and(|o| o != ENTRY_ORIGIN) {
        immediate(ProtocolResponse::error(403, "Forbidden"))
    } else if let Some(path) = request_path(uri, local) {
        if method == "OPTIONS" {
            let mut result = ProtocolResponse::metadata("text/plain", 0);
            result.status = 204;
            result.length = None;
            result.accept_ranges = false;
            immediate(result)
        } else {
            resource(content, local, path, head, range)
        }
    } else {
        immediate(ProtocolResponse::error(403, "Forbidden"))
    };
    if !content.is_live() {
        result = immediate(ProtocolResponse::error(403, "Forbidden"));
    }
    result.metadata.cors = origin == Some(ENTRY_ORIGIN);
    if head {
        result.body = immediate(ProtocolResponse::metadata("text/plain", 0)).body;
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
) -> PreparedResponse {
    let immediate = |response| PreparedResponse::bytes(content, response);
    let path = path.trim_start_matches('/');
    if path == super::ENTRY || path.is_empty() {
        if local {
            return immediate(ProtocolResponse::error(404, "Not found"));
        }
        let super::Entry::Html(html) = &content.entry;
        return immediate(ProtocolResponse::bytes(
            "text/html; charset=utf-8",
            html.as_bytes(),
            head,
            range,
        ));
    }
    if let Some(name) = path.strip_prefix("__assets__/") {
        if local {
            return immediate(ProtocolResponse::error(404, "Not found"));
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
        return immediate(
            content
                .assets
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(name, bytes)| {
                    ProtocolResponse::bytes(mime_for(Path::new(name)), bytes, head, range)
                })
                .unwrap_or_else(|| ProtocolResponse::error(404, "Not found")),
        );
    }
    if content.root.is_none()
        && let Some(source) = &content.source
    {
        let Some(relative) = relative_path(path) else {
            return immediate(ProtocolResponse::error(404, "Not found"));
        };
        let mime = source
            .mime(&relative)
            .unwrap_or_else(|| mime_for(&relative));
        match source.open(&relative) {
            Ok(Some(stream)) => {
                return super::stream::response(
                    content,
                    stream,
                    mime,
                    head,
                    range,
                    content.max_bytes,
                );
            }
            Err(error) => return immediate(super::stream::error(error)),
            Ok(None) => {}
        }
        if head {
            // A provider must explicitly support metadata. Never disguise a
            // complete body fetch as a metadata-only HEAD.
            return immediate(
                source
                    .0
                    .size(&relative)
                    .map(|size| ProtocolResponse::metadata(mime, size))
                    .unwrap_or_else(|| {
                        ProtocolResponse::error(501, "Provider metadata unavailable")
                    }),
            );
        }
        return immediate(match source.read(&relative) {
            Some(bytes) if bytes.len() as u64 <= content.max_bytes => {
                ProtocolResponse::bytes(mime, &bytes, false, range)
            }
            Some(_) => ProtocolResponse::error(413, "Resource exceeds its preview budget"),
            None => ProtocolResponse::error(404, "Not found"),
        });
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
) -> PreparedResponse {
    let Some(opened) = root.and_then(|r| r.file(&relative_path(path)?).ok()) else {
        return PreparedResponse::bytes(content, ProtocolResponse::error(404, "Not found"));
    };
    let mime = mime_for(&opened.relative);
    let size = opened.size;
    match opened.reader() {
        Ok(reader) => super::stream::response(
            content,
            ResourceStream {
                length: size,
                reader: Box::new(reader),
            },
            mime,
            head,
            range,
            max,
        ),
        Err(error) => PreparedResponse::bytes(content, super::stream::error(error)),
    }
}
