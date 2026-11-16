//! `AudioResourceViewer` / `VideoResourceViewer` (`viewers/media`): the
//! system web engine decodes and draws the media and its controls (close to
//! the product's Chromium controls, not a pixel contract). The audio card
//! around them — 54 px file icon and name — is native chrome.
//!
//! Each surface grants one provider resource. HEAD and byte ranges use its
//! bounded, revocable reader without a whole-file copy. Budgets follow the
//! product manifest (audio 512 MiB, video 2 GiB). A media element that
//! cannot load reports it, and the surface shows the product's failure with
//! Retry (`onRetryInput`), which reads the resource again.
use super::{image::resource_failure, web::WebFrame};
use crate::{
    editor::registry::{SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface},
    localization::{t, tf},
    platform::webview::{
        Content, Entry, Ipc, ResourceSource, ResourceStream, Source as WebSource, url_for,
    },
    theme,
    ui::{appearance::ActiveAppearance, components::FileIcon},
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Audio,
    Video,
}
impl Kind {
    fn budget(self) -> u64 {
        match self {
            Self::Audio => 512 * 1024 * 1024,
            Self::Video => 2 * 1024 * 1024 * 1024,
        }
    }
    fn label_key(self) -> &'static str {
        match self {
            Self::Audio => "editor.resource.kind.audio",
            Self::Video => "editor.resource.kind.video",
        }
    }
    /// `UnsupportedMedia`.
    fn unsupported_key(self) -> &'static str {
        match self {
            Self::Audio => "editor.resource.unsupported.audio",
            Self::Video => "editor.resource.unsupported.video",
        }
    }
}

pub fn open_audio(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    open(request, Kind::Audio, cx)
}
pub fn open_video(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    open(request, Kind::Video, cx)
}

/// The page the engine shows: the media element filling its frame. Its
/// `error` posts `failed` (`onError`); its content is `UnsupportedMedia`.
pub fn media_page(
    kind: Kind,
    src: &str,
    background: &str,
    inset: &str,
    unsupported: &str,
) -> String {
    let unsupported = escape(unsupported);
    let element = match kind {
        Kind::Audio => {
            format!(r#"<audio controls preload="metadata" src="{src}">{unsupported}</audio>"#)
        }
        Kind::Video => format!(
            r#"<video controls preload="auto" playsinline src="{src}">{unsupported}</video>"#
        ),
    };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;background:{background};overflow:hidden}}
body{{display:flex;align-items:center;justify-content:center}}
audio{{width:100%}}
video{{max-width:100%;max-height:100%;border-radius:6px;background:{inset}}}
</style></head><body>{element}<script>
document.querySelector("audio,video").addEventListener("error",()=>window.ipc&&window.ipc.postMessage("failed"));
</script></body></html>"#
    )
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

struct Source {
    file: String,
    protocol: WebSource,
    live: Arc<AtomicBool>,
}
impl Drop for Source {
    fn drop(&mut self) {
        self.live.store(false, Ordering::Release);
    }
}
struct MediaResource {
    resource: PreviewResource,
    file: String,
    budget: u64,
    mime: &'static str,
    live: Arc<AtomicBool>,
}
impl ResourceSource for MediaResource {
    fn is_live(&self) -> bool {
        self.live.load(Ordering::Acquire) && self.resource.data().is_ok()
    }
    fn read(&self, _: &Path) -> Option<Vec<u8>> {
        None
    }
    fn mime(&self, relative: &Path) -> Option<&'static str> {
        (relative == Path::new(&self.file)).then_some(self.mime)
    }
    fn open(&self, relative: &Path) -> std::io::Result<Option<ResourceStream>> {
        if !self.is_live() {
            return Err(std::io::ErrorKind::PermissionDenied.into());
        }
        if relative != Path::new(&self.file) {
            return Err(std::io::ErrorKind::NotFound.into());
        }
        let reader = self.resource.reader().map_err(|e| {
            use crate::workspace::ErrorKind;
            let kind = match e.kind {
                ErrorKind::StaleLease
                | ErrorKind::ForeignResource
                | ErrorKind::PermissionDenied => std::io::ErrorKind::PermissionDenied,
                ErrorKind::NotFound => std::io::ErrorKind::NotFound,
                ErrorKind::Unsupported => std::io::ErrorKind::Unsupported,
                _ => std::io::ErrorKind::Other,
            };
            std::io::Error::new(kind, e.to_string())
        })?;
        if reader.len() > self.budget {
            return Err(std::io::ErrorKind::FileTooLarge.into());
        }
        Ok(Some(ResourceStream {
            length: reader.len(),
            reader: Box::new(reader),
        }))
    }
}
fn source(resource: &PreviewResource, name: &str, budget: u64) -> Option<Source> {
    let mime = match resource.data().ok()? {
        PreviewData::Bytes { bytes, mime } => {
            if bytes.len() as u64 > budget {
                return None;
            }
            Some(mime.as_str())
        }
        PreviewData::LocalFile(_) => None,
    };
    let format = crate::formats::resolve(Some(name), mime);
    let mime = crate::formats::of(name)
        .is_known()
        .then(|| crate::formats::preferred_mime(name))
        .flatten()
        .or_else(|| format.mime_types.first().map(String::as_str))
        .unwrap_or("application/octet-stream");
    let file = Path::new(name).file_name()?.to_string_lossy().into_owned();
    let live = Arc::new(AtomicBool::new(true));
    Some(Source {
        file: file.clone(),
        protocol: WebSource(Arc::new(MediaResource {
            resource: resource.clone(),
            file,
            budget,
            mime,
            live: live.clone(),
        })),
        live,
    })
}

fn open(request: &SurfaceRequest, kind: Kind, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let (path, dark) = (request.name.to_owned(), request.dark);
    let view = cx.new(|cx| {
        let mut view = MediaView::new(path, kind, resource, dark);
        view.load(cx);
        view
    });
    Box::new(MediaSurface { view })
}

struct MediaSurface {
    view: Entity<MediaView>,
}
impl ViewerSurface for MediaSurface {
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(
            cx.subscribe(&self.view, move |_, event: &SurfaceEvent, cx| {
                events(event.clone(), cx)
            }),
        )
    }
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        let resource = resource.clone();
        self.view.update(cx, |view, cx| {
            view.resource = Some(resource);
            view.load(cx);
        });
    }
}
impl EventEmitter<SurfaceEvent> for MediaView {}
struct MediaView {
    kind: Kind,
    name: SharedString,
    path: String,
    dark: bool,
    resource: Option<PreviewResource>,
    frame: Option<Entity<WebFrame>>,
    /// The element reported `error` for this frame.
    failed: bool,
    _source: Option<Source>,
    _failures: Option<Task<()>>,
    generation: u64,
}
impl MediaView {
    fn new(path: String, kind: Kind, resource: Option<PreviewResource>, dark: bool) -> Self {
        Self {
            name: path.rsplit('/').next().unwrap_or(&path).to_owned().into(),
            path,
            kind,
            resource,
            dark,
            frame: None,
            failed: false,
            _source: None,
            _failures: None,
            generation: 0,
        }
    }
    fn content(&self, source: &Source, ipc: Option<Ipc>, cx: &App) -> Content {
        let palette = cx.palette();
        Content {
            root: None,
            source: Some(source.protocol.clone()),
            entry: Entry::Html(media_page(
                self.kind,
                &url_for(&source.file),
                &theme::css_hex(palette.canvas),
                &theme::css_hex(palette.inset),
                t(self.kind.unsupported_key()),
            )),
            max_bytes: self.kind.budget(),
            assets: vec![],
            ipc,
            policy: None,
            frames: None,
            disk_assets: None,
            locked: false,
        }
    }
    fn resource_is_live(&self) -> bool {
        self.resource.as_ref().is_some_and(|r| r.data().is_ok())
    }
    fn retire(&mut self) {
        self.generation += 1;
        self._failures = None;
        self.frame = None;
        self._source = None;
        self.failed = true;
    }
    fn receive_failure(&mut self, generation: u64, cx: &mut Context<Self>) {
        if generation != self.generation {
            return;
        }
        self.retire();
        cx.notify();
    }
    /// A fresh engine over the resource (opening, a new input or Retry).
    fn load(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        self._failures = None;
        self.frame = None;
        self._source = None;
        self.failed = false;
        let resolved = self
            .resource
            .as_ref()
            .and_then(|resource| source(resource, &self.path, self.kind.budget()));
        let (tx, rx) = async_channel::unbounded::<String>();
        self.frame = resolved.as_ref().map(|source| {
            let content = self.content(source, Some(Ipc(tx)), cx);
            cx.new(|_| WebFrame::new(Some(content), self.dark))
        });
        self._source = resolved;
        self._failures = Some(cx.spawn(async move |this, cx| {
            while let Ok(message) = rx.recv().await {
                if message == "failed" {
                    let _ = this.update(cx, |view, cx| view.receive_failure(generation, cx));
                }
            }
        }));
        cx.notify();
    }
}
impl Render for MediaView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.resource_is_live() {
            self.retire();
        }
        let p = cx.palette();
        let unavailable = tf(
            "editor.resource.unavailable",
            &[("kind", t(self.kind.label_key()).into())],
        );
        let shell = div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .p(px(24.))
            .bg(p.canvas);
        if self.failed || self.frame.is_none() {
            let view = cx.weak_entity();
            return shell
                .child(resource_failure(
                    "media-retry",
                    unavailable,
                    p,
                    move |_, cx| {
                        let _ = view.update(cx, |_, cx| cx.emit(SurfaceEvent::RetryInput));
                    },
                ))
                .into_any_element();
        }
        let frame = self.frame.clone().expect("live media frame");
        match self.kind {
            Kind::Video => shell
                .child(div().size_full().child(frame))
                .into_any_element(),
            // `.native-media-card`: min(560px, 100%), centred, 14px gaps.
            Kind::Audio => shell
                .child(
                    div()
                        .w_full()
                        .max_w(px(560.))
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap(px(14.))
                        .text_color(p.muted)
                        .child(FileIcon::file(self.name.clone(), "default").size_px(54.))
                        .child(
                            div()
                                .max_w_full()
                                .truncate()
                                .text_color(p.text)
                                .text_size(px(theme::ty().ui.body))
                                .font_weight(FontWeight::BOLD)
                                .child(self.name.clone()),
                        )
                        .child(div().w_full().h(px(54.)).child(frame)),
                )
                .into_any_element(),
        }
    }
}

#[cfg(test)]
mod tests;
