//! `image-preview` (`ImageResourceViewer`): the file centred and contained
//! in the pane (`.native-preview-centered`, `.native-image-preview`), with a
//! pending label while it decodes and an honest message if it cannot.
use crate::workspace::{PreviewData, PreviewResource};
use crate::{
    editor::registry::{SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface},
    localization::{t, tf},
    theme,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let view = cx.new(|cx| {
        let mut view = ImagePreview::new(resource, cx);
        view.load(request.name, cx);
        view
    });
    Box::new(ImageSurface { view })
}

/// The declared image budget also applies when the provider identifies the
/// format by MIME rather than a filename extension.
fn source_budget() -> u64 {
    crate::editor::registry::manifest()
        .viewers
        .iter()
        .find(|viewer| viewer.id == "image-preview")
        .unwrap()
        .resource_policy
        .max_source_bytes
}

fn image_format(mime: &str) -> Option<ImageFormat> {
    match mime.split(';').next()?.trim().to_ascii_lowercase().as_str() {
        "image/apng" => Some(ImageFormat::Png),
        "image/vnd.microsoft.icon" | "image/x-icon" => Some(ImageFormat::Ico),
        mime => ImageFormat::from_mime_type(mime),
    }
}

/// Called only by the background loader. GPUI receives owned bytes, never an
/// ambient filesystem path that it could reopen outside provider authority.
fn source(resource: &PreviewResource, name: &str, cancel: &AtomicBool) -> Option<Arc<Image>> {
    if cancel.load(Ordering::Acquire) {
        return None;
    }
    let mime = match resource.data().ok()? {
        PreviewData::Bytes { mime, .. } => Some(mime.as_str()),
        PreviewData::LocalFile(_) => None,
    };
    let format = crate::formats::resolve(Some(name), mime);
    let transcode = format.id == "avif";
    let native_format = if transcode {
        ImageFormat::Png
    } else {
        format
            .mime_types
            .iter()
            .find_map(|mime| image_format(mime))
            .or_else(|| mime.and_then(image_format))?
    };
    let bytes = resource.bytes(source_budget())?;
    if cancel.load(Ordering::Acquire) {
        return None;
    }
    let bytes = if transcode {
        crate::platform::image_transcode::bytes_to_png_cancellable(&bytes, source_budget(), cancel)
            .ok()?
    } else {
        bytes
    };
    resource.data().ok()?;
    if cancel.load(Ordering::Acquire) {
        return None;
    }
    Some(Arc::new(Image::from_bytes(native_format, bytes)))
}

struct ImageSurface {
    view: Entity<ImagePreview>,
}
impl ViewerSurface for ImageSurface {
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
        self.view.update(cx, |view, cx| {
            view.resource = Some(resource.clone());
            view.load(&resource.identity.path.as_path().to_string_lossy(), cx);
        });
    }
}

struct Pending(Arc<AtomicBool>);
impl Drop for Pending {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}
struct ImagePreview {
    resource: Option<PreviewResource>,
    image: Option<ImageSource>,
    pending: Option<Pending>,
    loading: Option<Task<()>>,
    generation: u64,
}
impl EventEmitter<SurfaceEvent> for ImagePreview {}
impl ImagePreview {
    fn new(resource: Option<PreviewResource>, cx: &mut Context<Self>) -> Self {
        cx.on_release(|view, cx| {
            view.pending = None;
            view.loading = None;
            if let Some(image) = view.image.take() {
                image.remove_asset(cx);
            }
        })
        .detach();
        Self {
            resource,
            image: None,
            pending: None,
            loading: None,
            generation: 0,
        }
    }
    fn retire(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        self.pending = None;
        self.loading = None;
        if let Some(image) = self.image.take() {
            image.remove_asset(cx);
        }
    }
    fn load(&mut self, name: &str, cx: &mut Context<Self>) {
        let resource = self.resource.clone();
        let name = name.to_owned();
        self.start_load(cx, move |cancel| async move {
            source(resource.as_ref()?, &name, &cancel)
        });
    }
    fn start_load<F, Fut>(&mut self, cx: &mut Context<Self>, prepare: F)
    where
        F: FnOnce(Arc<AtomicBool>) -> Fut,
        Fut: std::future::Future<Output = Option<Arc<Image>>> + Send + 'static,
    {
        self.retire(cx);
        let generation = self.generation;
        let cancel = Arc::new(AtomicBool::new(false));
        self.pending = Some(Pending(cancel.clone()));
        let task = cx.background_spawn(prepare(cancel));
        self.loading = Some(cx.spawn(async move |this, cx| {
            let image = task.await;
            let _ = this.update(cx, |view, cx| {
                if view.generation != generation {
                    return;
                }
                view.pending = None;
                view.image = view
                    .resource
                    .as_ref()
                    .filter(|r| r.data().is_ok())
                    .and(image.map(ImageSource::from));
                cx.notify();
            });
        }));
        cx.notify();
    }
    /// `onRetryInput`: the host reacquires a provider snapshot.
    fn retry(&mut self, cx: &mut Context<Self>) {
        cx.emit(SurfaceEvent::RetryInput);
    }
}
/// `.editor-state.editor-state--stacked.danger`: the reason over Retry.
pub(super) fn resource_failure(
    id: &'static str,
    message: String,
    p: theme::Theme,
    on_retry: impl Fn(&mut Window, &mut App) + 'static,
) -> AnyElement {
    let m = theme::ty();
    v_flex_centered()
        .gap(px(7.))
        .text_size(px(m.ui.meta))
        .line_height(relative(theme::NORMAL_LINE_HEIGHT))
        .text_color(p.danger)
        .child(message)
        .child(
            div()
                .id(id)
                .debug_selector(move || id.to_owned())
                .mt(px(6.))
                .h(px(theme::control()))
                .px(px(11.))
                .flex()
                .items_center()
                .border_1()
                .border_color(p.border_subtle)
                .rounded(px(6.))
                .bg(p.control)
                .hover(move |s| s.bg(p.control_hover))
                .cursor(theme::clickable_cursor())
                .text_color(p.text)
                .font_weight(FontWeight(650.))
                .child(t("common.action.retry"))
                .on_click(move |_, window, cx| on_retry(window, cx)),
        )
        .into_any_element()
}
fn failure(message: String, view: WeakEntity<ImagePreview>, p: theme::Theme) -> AnyElement {
    resource_failure("image-retry", message, p, move |_, cx| {
        let _ = view.update(cx, |v, cx| v.retry(cx));
    })
}
fn v_flex_centered() -> Div {
    div().flex().flex_col().items_center().justify_center()
}
impl Render for ImagePreview {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let data = theme::ty().editor.data;
        let note = move |text: String, color: Rgba| {
            div()
                .text_size(px(data))
                .text_color(color)
                .child(text)
                .into_any_element()
        };
        let failed = tf(
            "editor.resource.unavailable",
            &[("kind", t("editor.resource.kind.image").into())],
        );
        if self.resource.as_ref().is_some_and(|r| r.data().is_err()) {
            self.retire(cx);
        }
        let image = self.image.clone();
        let view = cx.weak_entity();
        let content = match image {
            Some(image) => img(image)
                .max_w_full()
                .max_h_full()
                .object_fit(ObjectFit::Contain)
                .rounded(px(6.))
                .with_loading(move || note(t("editor.preview.loading").into(), p.muted))
                .with_fallback(move || failure(failed.clone(), view.clone(), p))
                .into_any_element(),
            None if self.pending.is_some() => note(t("editor.preview.loading").into(), p.muted),
            None => failure(failed, view, p),
        };
        div()
            .id("native-image-preview")
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .p(px(24.))
            .bg(p.canvas)
            .child(content)
    }
}

#[cfg(test)]
mod tests;
