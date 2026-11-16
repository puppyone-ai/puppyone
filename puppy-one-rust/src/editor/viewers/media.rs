//! `AudioResourceViewer` / `VideoResourceViewer` (`viewers/media`): the
//! system web engine decodes and draws the media and its controls (close to
//! the product's Chromium controls, not a pixel contract). The audio card
//! around them — 54 px file icon and name — is native chrome.
//!
//! Local files stream from the document's folder; Cloud bytes are written to
//! a private temporary folder for the surface's lifetime. Budgets follow the
//! product manifest (audio 512 MiB, video 2 GiB). A media element that
//! cannot load reports it, and the surface shows the product's failure with
//! Retry (`onRetryInput`), which reads the resource again.
use super::{html_visual::script_json, image::resource_failure, web::WebFrame};
use crate::{
    editor::registry::{SurfaceInput, SurfaceRequest, ViewerSurface},
    localization::{t, tf},
    platform::webview::{Content, Entry, Ipc, url_for},
    theme,
    typography::Scale,
    ui::{appearance::ActiveAppearance, components::FileIcon},
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use std::path::{Path, PathBuf};

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
    media_page_themed(kind, src, background, inset, unsupported, true)
}

fn media_theme_css(background: &str, inset: &str, dark: bool) -> String {
    let scheme = if dark { "dark" } else { "light" };
    format!(
        "html{{color-scheme:{scheme}}}html,body{{background:{background}}}video{{background:{inset}}}"
    )
}

fn media_theme_script(background: &str, inset: &str, dark: bool) -> String {
    let payload = serde_json::json!({
        "dark": dark,
        "scheme": if dark { "dark" } else { "light" },
        "css": media_theme_css(background, inset, dark),
    });
    format!(
        "(()=>{{const t={};const s=document.getElementById('po-theme');if(s)s.textContent=t.css;\
         document.documentElement.classList.toggle('dark',t.dark);\
         document.documentElement.dataset.initialTheme=t.scheme;\
         document.documentElement.style.colorScheme=t.scheme;}})()",
        script_json(&payload)
    )
}

fn media_page_themed(
    kind: Kind,
    src: &str,
    background: &str,
    inset: &str,
    unsupported: &str,
    dark: bool,
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
    let class = if dark { "dark" } else { "" };
    let scheme = if dark { "dark" } else { "light" };
    let theme_block = media_theme_css(background, inset, dark);
    format!(
        r#"<!doctype html><html class="{class}" data-initial-theme="{scheme}"><head><meta charset="utf-8"><style id="po-theme">{theme_block}</style><style>
html,body{{margin:0;height:100%;overflow:hidden}}
body{{display:flex;align-items:center;justify-content:center}}
audio{{width:100%}}
video{{max-width:100%;max-height:100%;border-radius:6px}}
</style></head><body>{element}<script>
(()=>{{const el=document.querySelector("audio,video");if(!el)return;
el.addEventListener("error",()=>window.ipc&&window.ipc.postMessage("failed"));
el.addEventListener("play",()=>window.ipc&&window.ipc.postMessage("playing"));
el.addEventListener("pause",()=>window.ipc&&window.ipc.postMessage("paused"));
el.addEventListener("ended",()=>window.ipc&&window.ipc.postMessage("paused"));
}})();
</script></body></html>"#
    )
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

struct Source {
    folder: PathBuf,
    file: String,
    _temporary: Option<tempfile::TempDir>,
}
fn source(resource: &PreviewResource, name: &str) -> Option<Source> {
    match resource.data().ok()? {
        PreviewData::LocalFile(path) => Some(Source {
            folder: path.parent()?.to_path_buf(),
            file: path.file_name()?.to_string_lossy().into_owned(),
            _temporary: None,
        }),
        PreviewData::Bytes { bytes, .. } => {
            let dir = tempfile::tempdir().ok()?;
            let file = Path::new(name).file_name()?.to_string_lossy().into_owned();
            crate::platform::webview::write_private(&dir.path().join(&file), bytes).ok()?;
            Some(Source {
                folder: dir.path().to_path_buf(),
                file,
                _temporary: Some(dir),
            })
        }
    }
}

fn open(request: &SurfaceRequest, kind: Kind, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let (path, dark) = (request.name.to_owned(), request.dark);
    let view = cx.new(|cx| {
        let mut view = MediaView {
            kind,
            name: path.rsplit('/').next().unwrap_or(&path).to_owned().into(),
            path,
            dark,
            resource,
            frame: None,
            failed: false,
            source: None,
            _failures: None,
        };
        view.load(cx);
        view
    });
    Box::new(MediaSurface { view })
}

struct MediaSurface {
    view: Entity<MediaView>,
}
impl ViewerSurface for MediaSurface {
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
    fn apply(&self, _: bool, dark: bool, _: Scale, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.set_dark(dark, cx));
    }
}
struct MediaView {
    kind: Kind,
    name: SharedString,
    path: String,
    dark: bool,
    resource: Option<PreviewResource>,
    frame: Option<Entity<WebFrame>>,
    /// The element reported `error` for this frame.
    failed: bool,
    source: Option<Source>,
    _failures: Option<Task<()>>,
}
impl MediaView {
    fn html_for_source(&self, s: &Source, dark: bool) -> (String, String, String) {
        let palette = theme::pack_theme(&theme::pack_id(), dark);
        let bg = theme::css_hex(palette.canvas);
        let inset = theme::css_hex(palette.inset);
        let html = media_page_themed(
            self.kind,
            &url_for(&s.file),
            &bg,
            &inset,
            t(self.kind.unsupported_key()),
            dark,
        );
        (html, bg, inset)
    }

    /// Updates theme in-place without destroying the `<audio>`/`<video>` element
    /// or interrupting playback (`VW-21`).
    fn set_dark(&mut self, dark: bool, cx: &mut Context<Self>) {
        if self.dark == dark {
            return;
        }
        self.dark = dark;
        let palette = theme::pack_theme(&theme::pack_id(), dark);
        let bg = theme::css_hex(palette.canvas);
        let inset = theme::css_hex(palette.inset);
        let script = media_theme_script(&bg, &inset, dark);
        let updated_html = self
            .source
            .as_ref()
            .map(|s| self.html_for_source(s, dark).0);
        if let Some(frame) = &self.frame {
            frame.update(cx, |f, _| {
                f.apply_theme_in_place(dark, &script, updated_html);
            });
        }
        cx.notify();
    }

    /// A fresh engine over the resource (opening, a new input or Retry).
    fn load(&mut self, cx: &mut Context<Self>) {
        self.failed = false;
        let resolved = self
            .resource
            .as_ref()
            .and_then(|resource| source(resource, &self.path));
        let (tx, rx) = async_channel::unbounded::<String>();
        let dark = self.dark;
        self.frame = resolved.as_ref().map(|s| {
            let (html, _, _) = self.html_for_source(s, dark);
            let content = Content {
                root: Some(s.folder.clone()),
                source: None,
                entry: Entry::Html(html),
                max_bytes: self.kind.budget(),
                assets: vec![],
                ipc: Some(Ipc(tx)),
                policy: None,
                frames: None,
                disk_assets: None,
                locked: false,
            };
            cx.new(|_| WebFrame::new(Some(content), dark))
        });
        self.source = resolved;
        self._failures = Some(cx.spawn(async move |this, cx| {
            while let Ok(message) = rx.recv().await {
                let _ = this.update(cx, |view, cx| match message.as_str() {
                    "failed" => {
                        if let Some(frame) = &view.frame {
                            frame.update(cx, |f, _| f.set_pinned(false));
                        }
                        view.failed = true;
                        cx.notify();
                    }
                    "playing" => {
                        if let Some(frame) = &view.frame {
                            frame.update(cx, |f, _| f.set_pinned(true));
                        }
                    }
                    "paused" => {
                        if let Some(frame) = &view.frame {
                            frame.update(cx, |f, _| f.set_pinned(false));
                        }
                    }
                    _ => {}
                });
            }
        }));
        cx.notify();
    }
}
impl Render for MediaView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
        if self.failed {
            let view = cx.weak_entity();
            return shell
                .child(resource_failure(
                    "media-retry",
                    unavailable,
                    p,
                    move |_, cx| {
                        let _ = view.update(cx, |view, cx| view.load(cx));
                    },
                ))
                .into_any_element();
        }
        let Some(frame) = self.frame.clone() else {
            // `ResourcePreviewState`: a failed input names its reason.
            let message = match self.resource.as_ref().map(|r| r.data()) {
                Some(Err(error)) => tf(
                    "editor.resource.loadFailed",
                    &[
                        ("kind", t(self.kind.label_key()).into()),
                        (
                            "detail",
                            crate::localization::bidi_isolate(&error.to_string()).into(),
                        ),
                    ],
                ),
                _ => unavailable,
            };
            return shell
                .text_size(px(theme::ty().ui.meta))
                .text_color(p.danger)
                .child(message)
                .into_any_element();
        };
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
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn media_pages_reference_the_served_file_with_controls() {
        let page = media_page(
            Kind::Video,
            "puppyone-preview://local/a%20b.mp4",
            "BG",
            "INSET",
            "No <video>",
        );
        assert!(page.contains(r#"<video controls preload="auto""#) && page.contains("a%20b.mp4"));
        assert!(page.contains("No &lt;video&gt;</video>"));
        assert!(page.contains(r#"postMessage("failed")"#));
        assert!(media_page(Kind::Audio, "x", "BG", "INSET", "").contains("<audio controls"));
        assert_eq!(Kind::Video.budget(), 2 * 1024 * 1024 * 1024);
    }
}
