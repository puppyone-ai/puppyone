//! PDF engine host: PDFium — the engine Chromium's PDF viewer uses — on one
//! worker thread per document. The viewer never touches the engine or the
//! file; it sends render requests and receives BGRA page bitmaps.
//!
//! Admission follows the product's PDF viewer: a size preflight against the
//! viewer's `maxSourceBytes` (512 MiB), a 15-second deadline for the document
//! to open, and three failure reasons (limit, timeout, resource). Page
//! renders go through the editor task scheduler, so a heavy document is
//! bounded per window like every other editor task.
mod resource;
#[cfg(test)]
mod resource_tests;
use pdfium_render::prelude::*;
pub use resource::{Reader, Source};
use std::{
    collections::BTreeSet,
    ops::Range,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};

/// `PDF_ATTACHMENT_TIMEOUT_MS`.
pub const OPEN_TIMEOUT: Duration = Duration::from_millis(15_000);
/// Maximum device pixel width or height of any single high-zoom tile (`VW-11`).
pub const MAX_TILE_PX: u32 = 2048;
/// Maximum number of outline/bookmark entries surfaced in the pane menu.
const MAX_OUTLINE_ITEMS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// Larger than the viewer's source budget.
    Limit,
    /// Did not open within `OPEN_TIMEOUT`.
    Timeout,
    /// Unreadable, not a PDF, or no engine on this machine.
    Resource,
}

/// A page size in PDF points (1/72 in).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageSize {
    pub width: f32,
    pub height: f32,
}

/// Top-left-origin rectangle in PDF points (`(0, 0)` at top-left of page).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PageRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Device-pixel tile rectangle within a scaled `full_width` × `full_height` page (`VW-11`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TileRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl TileRect {
    pub fn clamped(self, full_width: u32, full_height: u32) -> Option<Self> {
        let fw = full_width.max(1);
        let fh = full_height.max(1);
        if self.x >= fw || self.y >= fh || self.width == 0 || self.height == 0 {
            return None;
        }
        let width = self.width.min(fw - self.x).min(MAX_TILE_PX);
        let height = self.height.min(fh - self.y).min(MAX_TILE_PX);
        (width > 0 && height > 0).then_some(Self {
            x: self.x,
            y: self.y,
            width,
            height,
        })
    }
}

/// Contiguous horizontal text run on a page (`VW-12`).
#[derive(Clone, Debug, PartialEq)]
pub struct TextRun {
    /// Byte range within `PageText::full_text`.
    pub byte_range: Range<usize>,
    pub rect: PageRect,
}

/// Extracted searchable and selectable text of one PDF page (`VW-12`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PageText {
    pub page: usize,
    pub full_text: String,
    pub runs: Vec<TextRun>,
}

/// Validated destination of a PDF link annotation (`VW-12`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkTarget {
    Page(usize),
    ExternalUrl(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct PageLink {
    pub rect: PageRect,
    pub target: LinkTarget,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PageMetadata {
    pub page: usize,
    pub text: PageText,
    pub links: Vec<PageLink>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BookmarkItem {
    pub title: String,
    pub page: usize,
    pub depth: usize,
}

/// One rendered full page: BGRA, `width` × `height` device pixels.
pub struct Bitmap {
    pub page: usize,
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    pub generation: u64,
}

/// One rendered viewport tile (`<= 2048 × 2048` device pixels) of a high-zoom page (`VW-11`).
pub struct TileBitmap {
    pub page: usize,
    pub full_width: u32,
    pub full_height: u32,
    pub rect: TileRect,
    pub bgra: Vec<u8>,
    pub generation: u64,
}

pub enum Reply {
    Opened {
        sizes: Vec<PageSize>,
        bookmarks: Vec<BookmarkItem>,
    },
    Failed(Failure),
    Page(Bitmap),
    Tile(TileBitmap),
    Metadata(PageMetadata),
}

enum Request {
    Render {
        page: usize,
        width: u32,
        generation: u64,
    },
    RenderTile {
        page: usize,
        full_width: u32,
        full_height: u32,
        rect: TileRect,
        generation: u64,
    },
}

/// Validates external PDF URI actions: only credential-free `http(s):` or `mailto:` URLs pass.
pub fn validate_external_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 || trimmed.chars().any(char::is_control) {
        return None;
    }
    let parsed = url::Url::parse(trimmed).ok()?;
    match parsed.scheme() {
        "http" | "https" => {
            if !parsed.username().is_empty() || parsed.password().is_some() {
                return None;
            }
            Some(parsed.into())
        }
        "mailto" => Some(parsed.into()),
        _ => None,
    }
}

/// Converts a PDF bottom-left `PdfRect` into top-left `PageRect` points.
fn pdf_rect_to_top_left(rect: PdfRect, page_w: f32, page_h: f32) -> PageRect {
    let pw = page_w.max(1.);
    let ph = page_h.max(1.);
    let x0 = rect.left().value.clamp(0., pw);
    let x1 = rect.right().value.clamp(x0, pw);
    let y0 = (ph - rect.top().value).clamp(0., ph);
    let y1 = (ph - rect.bottom().value).clamp(y0, ph);
    PageRect {
        x: x0,
        y: y0,
        width: (x1 - x0).max(0.),
        height: (y1 - y0).max(0.),
    }
}

/// Renders a clipped viewport tile (`<= 2048 × 2048` device pixels) of `page`
/// scaled to `full_width × full_height` using `FPDFBitmap` origin/clip transform (`VW-11`).
pub fn render_tile(
    page: &PdfPage<'_>,
    full_width: u32,
    full_height: u32,
    tile_rect: TileRect,
) -> Option<(TileRect, Vec<u8>)> {
    let clamped = tile_rect.clamped(full_width, full_height)?;
    let mut bitmap = PdfBitmap::empty(
        clamped.width as i32,
        clamped.height as i32,
        PdfBitmapFormat::BGRA,
    )
    .ok()?;
    let config = PdfRenderConfig::new()
        .set_target_size(full_width.max(1) as i32, full_height.max(1) as i32)
        .set_origin(-(clamped.x as i32), -(clamped.y as i32))
        .clear_before_rendering(true)
        .render_form_data(true)
        .render_annotations(true)
        .set_reverse_byte_order(false);
    page.render_into_bitmap_with_config(&mut bitmap, &config)
        .ok()?;
    Some((clamped, bitmap.as_raw_bytes()))
}

fn extract_page_metadata(
    page_idx: usize,
    pdf_page: &PdfPage<'_>,
    page_count: usize,
) -> PageMetadata {
    let page_w = pdf_page.width().value;
    let page_h = pdf_page.height().value;

    let mut full_text = String::new();
    let mut runs = Vec::new();
    if let Ok(text_layer) = pdf_page.text() {
        for segment in text_layer.segments().iter() {
            let raw = segment.text();
            let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
            let trimmed = normalized.trim_matches('\0');
            if trimmed.is_empty() {
                continue;
            }
            if !full_text.is_empty() && !full_text.ends_with([' ', '\n']) {
                full_text.push(' ');
            }
            let start = full_text.len();
            full_text.push_str(trimmed);
            let end = full_text.len();
            let rect = pdf_rect_to_top_left(segment.bounds(), page_w, page_h);
            if rect.width > 0. && rect.height > 0. {
                runs.push(TextRun {
                    byte_range: start..end,
                    rect,
                });
            }
        }
    }

    let mut links = Vec::new();
    for link in pdf_page.links().iter() {
        let Ok(raw_rect) = link.rect() else {
            continue;
        };
        let rect = pdf_rect_to_top_left(raw_rect, page_w, page_h);
        if rect.width <= 0. || rect.height <= 0. {
            continue;
        }
        let target = link
            .destination()
            .and_then(|d| d.page_index().ok())
            .map(|idx| idx as usize)
            .filter(|&idx| idx < page_count)
            .map(LinkTarget::Page)
            .or_else(|| {
                let action = link.action()?;
                if let Some(local) = action.as_local_destination_action() {
                    let idx = local.destination().ok()?.page_index().ok()? as usize;
                    return (idx < page_count).then_some(LinkTarget::Page(idx));
                }
                if let Some(uri_action) = action.as_uri_action() {
                    let uri = uri_action.uri().ok()?;
                    return validate_external_url(&uri).map(LinkTarget::ExternalUrl);
                }
                None
            });
        if let Some(target) = target {
            links.push(PageLink { rect, target });
        }
    }

    PageMetadata {
        page: page_idx,
        text: PageText {
            page: page_idx,
            full_text,
            runs,
        },
        links,
    }
}

fn extract_bookmarks(document: &PdfDocument<'_>, page_count: usize) -> Vec<BookmarkItem> {
    let mut out = Vec::new();
    fn walk(
        node: Option<PdfBookmark<'_>>,
        depth: usize,
        page_count: usize,
        out: &mut Vec<BookmarkItem>,
    ) {
        let mut cursor = node;
        while let Some(bm) = cursor {
            if out.len() >= MAX_OUTLINE_ITEMS {
                return;
            }
            let title = bm
                .title()
                .map(|t| t.trim().to_owned())
                .filter(|t| !t.is_empty());
            let page = bm
                .destination()
                .and_then(|d| d.page_index().ok())
                .or_else(|| {
                    bm.action()?
                        .as_local_destination_action()?
                        .destination()
                        .ok()?
                        .page_index()
                        .ok()
                })
                .map(|idx| idx as usize)
                .filter(|&idx| idx < page_count);
            if let (Some(title), Some(page)) = (title, page) {
                out.push(BookmarkItem { title, page, depth });
            }
            if depth < 6 {
                walk(bm.first_child(), depth + 1, page_count, out);
            }
            cursor = bm.next_sibling();
        }
    }
    walk(document.bookmarks().root(), 0, page_count, &mut out);
    out
}

/// Where the PDFium library lives: explicit override, the app bundle,
/// beside the executable, or the developer vendor folder.
pub fn library_path() -> Option<PathBuf> {
    let name = pdfium_library_name();
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PUPPYONE_PDFIUM_LIB") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        candidates.push(dir.join("../Frameworks").join(name));
        candidates.push(dir.join(name));
    }
    let repo_root = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    if cfg!(target_os = "windows") {
        candidates.push(repo_root.join("vendor/pdfium/bin").join(name));
    }
    candidates.push(repo_root.join("vendor/pdfium/lib").join(name));
    candidates.into_iter().find(|p| p.is_file())
}

fn pdfium_library_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "libpdfium.dylib"
    } else if cfg!(target_os = "windows") {
        "pdfium.dll"
    } else {
        "libpdfium.so"
    }
}

/// A document open on its own engine thread. Dropping it ends the thread.
pub struct Document {
    requests: mpsc::Sender<Request>,
    replies: async_channel::Sender<Reply>,
    opening_resolved: Arc<AtomicBool>,
}
impl Drop for Document {
    fn drop(&mut self) {
        self.opening_resolved.store(true, Ordering::Release);
        // Retire publication on the owner thread, even if an engine call or
        // provider admission has not returned yet.
        self.replies.close();
    }
}

impl Document {
    /// Opens `source` for `owner` (its window scope and document id). The
    /// first reply is `Opened` or `Failed`; then page/tile renders and
    /// background `Metadata` extraction stream back.
    pub fn open(
        source: Source,
        max_bytes: u64,
        owner: super::tasks::Owner,
        replies: async_channel::Sender<Reply>,
    ) -> Self {
        Self::open_with_timeout(source, max_bytes, owner, replies, OPEN_TIMEOUT)
    }
    fn open_with_timeout(
        source: Source,
        max_bytes: u64,
        owner: super::tasks::Owner,
        replies: async_channel::Sender<Reply>,
        timeout: Duration,
    ) -> Self {
        let (requests, inbox) = mpsc::channel::<Request>();
        let publication = replies.clone();
        let failed = replies.clone();
        let opening_resolved = Arc::new(AtomicBool::new(false));
        let opening = opening_resolved.clone();
        let panicked = opening_resolved.clone();
        super::watchdog::spawn_contained(
            "pdf-engine",
            move || run(source, max_bytes, owner, inbox, replies, timeout, opening),
            move |_| {
                if !panicked.swap(true, Ordering::AcqRel) {
                    let _ = failed.try_send(Reply::Failed(Failure::Resource));
                }
            },
        );
        Self {
            requests,
            replies: publication,
            opening_resolved,
        }
    }

    /// Renders `page` at `width` device pixels (`<= 2048` normal mode).
    pub fn render(&self, page: usize, width: u32, generation: u64) {
        let _ = self.requests.send(Request::Render {
            page,
            width,
            generation,
        });
    }

    /// Renders a viewport `rect` tile (`<= 2048 × 2048`) of `page` at high zoom (`VW-11`).
    pub fn render_tile(
        &self,
        page: usize,
        full_width: u32,
        full_height: u32,
        rect: TileRect,
        generation: u64,
    ) {
        let _ = self.requests.send(Request::RenderTile {
            page,
            full_width,
            full_height,
            rect,
            generation,
        });
    }
}

/// PDFium initializes once per process; every document thread shares it.
fn engine(library: &Path) -> Option<&'static Pdfium> {
    static ENGINE: std::sync::OnceLock<Option<Pdfium>> = std::sync::OnceLock::new();
    ENGINE
        .get_or_init(|| Pdfium::bind_to_library(library).ok().map(Pdfium::new))
        .as_ref()
}

fn finish_open(signal: &mpsc::Sender<()>, resolved: &AtomicBool) -> bool {
    if resolved.swap(true, Ordering::AcqRel) {
        return false;
    }
    let _ = signal.send(());
    true
}

fn run(
    source: Source,
    max_bytes: u64,
    owner: super::tasks::Owner,
    inbox: mpsc::Receiver<Request>,
    replies: async_channel::Sender<Reply>,
    timeout: Duration,
    opening: Arc<AtomicBool>,
) {
    // The deadline covers admission, binding and parsing: a separate watchdog reports
    // the timeout even if PDFium never returns for this file.
    let (opened_tx, opened_rx) = mpsc::channel::<()>();
    {
        let replies = replies.clone();
        let opening = opening.clone();
        std::thread::spawn(move || {
            if opened_rx.recv_timeout(timeout) == Err(mpsc::RecvTimeoutError::Timeout)
                && !opening.swap(true, Ordering::AcqRel)
            {
                let _ = replies.try_send(Reply::Failed(Failure::Timeout));
            }
        });
    }
    let source = match resource::admit(source, max_bytes) {
        Ok(source) => source,
        Err(failure) => {
            if finish_open(&opened_tx, &opening) {
                let _ = replies.send_blocking(Reply::Failed(failure));
            }
            return;
        }
    };
    if opening.load(Ordering::Acquire) || replies.is_closed() {
        return;
    }
    let Some(library) = library_path() else {
        if finish_open(&opened_tx, &opening) {
            let _ = replies.send_blocking(Reply::Failed(Failure::Resource));
        }
        return;
    };
    let Some(pdfium) = engine(&library) else {
        if finish_open(&opened_tx, &opening) {
            let _ = replies.send_blocking(Reply::Failed(Failure::Resource));
        }
        return;
    };
    let document = pdfium.load_pdf_from_reader(source, None);
    let document = match document {
        Ok(document) => document,
        Err(_) => {
            if finish_open(&opened_tx, &opening) {
                let _ = replies.send_blocking(Reply::Failed(Failure::Resource));
            }
            return;
        }
    };
    let pages = document.pages();
    let page_count = pages.len() as usize;
    let sizes: Vec<PageSize> = (0..pages.len())
        .filter_map(|i| pages.get(i).ok())
        .map(|p| PageSize {
            width: p.width().value,
            height: p.height().value,
        })
        .collect();
    let bookmarks = extract_bookmarks(&document, page_count);
    if !finish_open(&opened_tx, &opening) {
        return;
    }
    if replies
        .send_blocking(Reply::Opened { sizes, bookmarks })
        .is_err()
    {
        return;
    }

    let mut extracted_meta = vec![false; page_count];
    let mut next_bg_meta = 0usize;

    loop {
        // While unextracted pages remain, extract one page of text/links whenever
        // no interactive render request is queued; once all pages are indexed, park on `recv()`.
        let first = if next_bg_meta < page_count {
            match inbox.try_recv() {
                Ok(req) => Some(req),
                Err(mpsc::TryRecvError::Empty) => {
                    while next_bg_meta < page_count && extracted_meta[next_bg_meta] {
                        next_bg_meta += 1;
                    }
                    if next_bg_meta < page_count {
                        let idx = next_bg_meta;
                        next_bg_meta += 1;
                        extracted_meta[idx] = true;
                        if let Ok(pdf_page) = pages.get(idx as i32) {
                            let meta = extract_page_metadata(idx, &pdf_page, page_count);
                            if replies.send_blocking(Reply::Metadata(meta)).is_err() {
                                return;
                            }
                        }
                        continue;
                    }
                    None
                }
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        } else {
            None
        };

        let request = match first {
            Some(r) => r,
            None => match inbox.recv() {
                Ok(r) => r,
                Err(_) => return,
            },
        };

        let mut batch = vec![request];
        while let Ok(more) = inbox.try_recv() {
            batch.push(more);
        }
        let newest = batch
            .iter()
            .map(|r| match r {
                Request::Render { generation, .. } | Request::RenderTile { generation, .. } => {
                    *generation
                }
            })
            .max()
            .unwrap_or_default();

        let mut seen_pages = BTreeSet::new();
        let mut seen_tiles = std::collections::HashSet::new();

        for item in batch.into_iter().rev() {
            match item {
                Request::Render {
                    page,
                    width,
                    generation,
                } => {
                    if generation < newest || !seen_pages.insert(page) {
                        continue;
                    }
                    let lease = super::tasks::Scheduler::global().acquire(super::tasks::Request {
                        owner: owner.clone(),
                        kind: "pdf-render",
                        input_bytes: 0,
                        max_input_bytes: max_bytes.max(1),
                        priority: super::tasks::Priority::Interactive,
                    });
                    let Ok(lease) = lease else { continue };
                    if lease.cancelled() {
                        return;
                    }
                    let Ok(pdf_page) = pages.get(page as i32) else {
                        continue;
                    };
                    if page < page_count && !extracted_meta[page] {
                        extracted_meta[page] = true;
                        let meta = extract_page_metadata(page, &pdf_page, page_count);
                        if replies.send_blocking(Reply::Metadata(meta)).is_err() {
                            return;
                        }
                    }
                    let config = PdfRenderConfig::new()
                        .set_target_width(width.clamp(1, MAX_TILE_PX) as i32)
                        .render_form_data(true)
                        .render_annotations(true)
                        .set_reverse_byte_order(false);
                    let Ok(bitmap) = pdf_page.render_with_config(&config) else {
                        continue;
                    };
                    let reply = Reply::Page(Bitmap {
                        page,
                        width: bitmap.width() as u32,
                        height: bitmap.height() as u32,
                        bgra: bitmap.as_raw_bytes(),
                        generation,
                    });
                    drop(lease);
                    if replies.send_blocking(reply).is_err() {
                        return;
                    }
                }
                Request::RenderTile {
                    page,
                    full_width,
                    full_height,
                    rect,
                    generation,
                } => {
                    if generation < newest || !seen_tiles.insert((page, rect)) {
                        continue;
                    }
                    let lease = super::tasks::Scheduler::global().acquire(super::tasks::Request {
                        owner: owner.clone(),
                        kind: "pdf-render-tile",
                        input_bytes: 0,
                        max_input_bytes: max_bytes.max(1),
                        priority: super::tasks::Priority::Interactive,
                    });
                    let Ok(lease) = lease else { continue };
                    if lease.cancelled() {
                        return;
                    }
                    let Ok(pdf_page) = pages.get(page as i32) else {
                        continue;
                    };
                    if page < page_count && !extracted_meta[page] {
                        extracted_meta[page] = true;
                        let meta = extract_page_metadata(page, &pdf_page, page_count);
                        if replies.send_blocking(Reply::Metadata(meta)).is_err() {
                            return;
                        }
                    }
                    let Some((clamped_rect, bgra)) =
                        render_tile(&pdf_page, full_width, full_height, rect)
                    else {
                        continue;
                    };
                    let reply = Reply::Tile(TileBitmap {
                        page,
                        full_width,
                        full_height,
                        rect: clamped_rect,
                        bgra,
                        generation,
                    });
                    drop(lease);
                    if replies.send_blocking(reply).is_err() {
                        return;
                    }
                }
            }
        }
    }
}

/// A one-page 200×100 pt PDF with a blue rectangle (tests).
#[cfg(any(test, feature = "test-support"))]
pub fn test_pdf() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>",
        "<< /Length 35 >>\nstream\n0 0 1 rg 20 20 160 60 re f\nendstream",
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend(format!("{} 0 obj\n{body}\nendobj\n", i + 1).bytes());
    }
    let xref = out.len();
    out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        out.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    out.extend(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .bytes(),
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner() -> super::super::tasks::Owner {
        super::super::tasks::Owner::new("test", "pdf", 1)
    }
    pub(crate) fn sample_pdf() -> Vec<u8> {
        super::test_pdf()
    }

    #[test]
    fn preflight_refuses_oversized_and_non_pdf_sources() {
        assert_eq!(
            resource::admit(Source::Bytes(sample_pdf()), 10).map(|_| ()),
            Err(Failure::Limit)
        );
        assert_eq!(
            resource::admit(Source::Bytes(b"hello".to_vec()), 1 << 20).map(|_| ()),
            Err(Failure::Resource)
        );
        assert_eq!(
            resource::admit(Source::Bytes(sample_pdf()), 1 << 20).map(|_| ()),
            Ok(())
        );
        let missing = Source::File("/nonexistent/file.pdf".into());
        assert_eq!(
            resource::admit(missing, 1 << 20).map(|_| ()),
            Err(Failure::Resource)
        );
    }

    #[test]
    fn external_urls_and_tile_rects_are_strictly_validated_and_bounded() {
        assert_eq!(
            validate_external_url("https://example.com/paper"),
            Some("https://example.com/paper".into())
        );
        assert_eq!(
            validate_external_url("mailto:author@example.com"),
            Some("mailto:author@example.com".into())
        );
        assert_eq!(validate_external_url("javascript:alert(1)"), None);
        assert_eq!(validate_external_url("file:///etc/passwd"), None);
        assert_eq!(validate_external_url("https://user:pw@example.com/"), None);

        let tile = TileRect {
            x: 1500,
            y: 1000,
            width: 4000,
            height: 4000,
        };
        let clamped = tile.clamped(5000, 2200).unwrap();
        assert_eq!(
            clamped,
            TileRect {
                x: 1500,
                y: 1000,
                width: MAX_TILE_PX,
                height: 1200,
            }
        );
        assert!(
            (TileRect {
                x: 5000,
                y: 0,
                width: 100,
                height: 100,
            })
            .clamped(5000, 2200)
            .is_none()
        );
    }

    #[test]
    #[ignore = "requires PDFium; tools/verify-native-dependencies.py runs this explicitly"]
    fn a_document_opens_and_renders_pages_when_the_engine_is_installed() {
        assert!(
            library_path().is_some(),
            "PDFium missing: run tools/fetch-pdfium.py"
        );
        let (tx, rx) = async_channel::unbounded();
        let document = Document::open(Source::Bytes(sample_pdf()), 1 << 20, owner(), tx);
        match rx.recv_blocking().unwrap() {
            Reply::Opened { sizes, .. } => assert_eq!(
                sizes,
                vec![PageSize {
                    width: 200.,
                    height: 100.
                }]
            ),
            _ => panic!("expected the page sizes"),
        }
        document.render(0, 400, 7);
        loop {
            match rx.recv_blocking().unwrap() {
                Reply::Metadata(_) => continue,
                Reply::Page(bitmap) => {
                    assert_eq!(
                        (bitmap.page, bitmap.width, bitmap.height, bitmap.generation),
                        (0, 400, 200, 7)
                    );
                    assert_eq!(bitmap.bgra.len(), 400 * 200 * 4);
                    let i = ((100 * 400) + 200) * 4;
                    assert!(
                        bitmap.bgra[i] > 200 && bitmap.bgra[i + 2] < 60,
                        "{:?}",
                        &bitmap.bgra[i..i + 4]
                    );
                    break;
                }
                _ => panic!("expected a page bitmap"),
            }
        }
    }
}
