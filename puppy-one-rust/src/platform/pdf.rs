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
/// One rendered page: BGRA, `width` × `height` device pixels.
pub struct Bitmap {
    pub page: usize,
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    pub generation: u64,
}
pub enum Reply {
    Opened(Vec<PageSize>),
    Failed(Failure),
    Page(Bitmap),
}
enum Request {
    Render {
        page: usize,
        width: u32,
        generation: u64,
    },
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
    candidates.push(
        Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .join("vendor/pdfium/lib")
            .join(name),
    );
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
    /// first reply is `Opened` or `Failed`; then one `Page` per render.
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
    /// Renders `page` at `width` device pixels; replies carry `generation`
    /// so superseded zoom levels can be ignored.
    pub fn render(&self, page: usize, width: u32, generation: u64) {
        let _ = self.requests.send(Request::Render {
            page,
            width,
            generation,
        });
    }
}

/// PDFium initializes once per process; every document thread shares it
/// (the `thread_safe` bindings serialize calls into the library).
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
    let sizes: Vec<PageSize> = (0..pages.len())
        .filter_map(|i| pages.get(i).ok())
        .map(|p| PageSize {
            width: p.width().value,
            height: p.height().value,
        })
        .collect();
    if !finish_open(&opened_tx, &opening) {
        return;
    }
    if replies.send_blocking(Reply::Opened(sizes)).is_err() {
        return;
    }
    while let Ok(request) = inbox.recv() {
        // Coalesce: only the newest request for each page matters.
        let mut batch = vec![request];
        while let Ok(more) = inbox.try_recv() {
            batch.push(more);
        }
        let newest = batch
            .iter()
            .map(|Request::Render { generation, .. }| *generation)
            .max()
            .unwrap_or_default();
        let mut seen = std::collections::BTreeSet::new();
        for Request::Render {
            page,
            width,
            generation,
        } in batch.into_iter().rev()
        {
            if generation < newest || !seen.insert(page) {
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
            let config = PdfRenderConfig::new()
                .set_target_width(width.clamp(1, 8192) as i32)
                .render_form_data(true)
                .render_annotations(true)
                // Native PDFium order is BGRA, which GPUI images expect.
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
    #[ignore = "requires PDFium; tools/verify-native-dependencies.py runs this explicitly"]
    fn a_document_opens_and_renders_pages_when_the_engine_is_installed() {
        assert!(
            library_path().is_some(),
            "PDFium missing: run tools/fetch-pdfium.py"
        );
        let (tx, rx) = async_channel::unbounded();
        let document = Document::open(Source::Bytes(sample_pdf()), 1 << 20, owner(), tx);
        match rx.recv_blocking().unwrap() {
            Reply::Opened(sizes) => assert_eq!(
                sizes,
                vec![PageSize {
                    width: 200.,
                    height: 100.
                }]
            ),
            _ => panic!("expected the page sizes"),
        }
        document.render(0, 400, 7);
        match rx.recv_blocking().unwrap() {
            Reply::Page(bitmap) => {
                assert_eq!(
                    (bitmap.page, bitmap.width, bitmap.height, bitmap.generation),
                    (0, 400, 200, 7)
                );
                assert_eq!(bitmap.bgra.len(), 400 * 200 * 4);
                // The filled rectangle is blue (BGRA: B high, R low) at the centre.
                let i = ((100 * 400) + 200) * 4;
                assert!(
                    bitmap.bgra[i] > 200 && bitmap.bgra[i + 2] < 60,
                    "{:?}",
                    &bitmap.bgra[i..i + 4]
                );
            }
            _ => panic!("expected a page bitmap"),
        }
    }
}
