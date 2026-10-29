//! `image-preview` (`ImageResourceViewer`): the file centred and contained
//! in the pane (`.native-preview-centered`, `.native-image-preview`), with a
//! pending label while it decodes and an honest message if it cannot.
use crate::workspace::{PreviewData, PreviewResource};
use crate::{
    editor::registry::{SurfaceInput, SurfaceRequest, ViewerSurface},
    localization::{t, tf},
    theme,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::sync::Arc;

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let image = resource.as_ref().and_then(source);
    let view = cx.new(|_| ImagePreview {
        resource,
        image,
        transcoding: false,
    });
    transcode_if_needed(&view, request.name, cx);
    Box::new(ImageSurface { view })
}

/// AVIF (shown by the product's Chromium, unknown to GPUI's decoder) goes
/// through the platform codec off the foreground thread.
fn transcode_if_needed(view: &Entity<ImagePreview>, name: &str, cx: &mut App) {
    if !crate::platform::image_transcode::needs_transcode(name) {
        return;
    }
    let path = match view.read(cx).resource.as_ref().map(|r| r.data()) {
        Some(Ok(PreviewData::LocalFile(path))) => path.clone(),
        _ => return,
    };
    view.update(cx, |v, _| {
        v.image = None;
        v.transcoding = true;
    });
    let budget = crate::editor::registry::source_budget(name);
    let task = cx
        .background_executor()
        .spawn(async move { crate::platform::image_transcode::to_png(&path, budget) });
    let view = view.downgrade();
    cx.spawn(async move |cx| {
        let result = task.await;
        let _ = view.update(cx, |v, cx| {
            if let Ok(png) = result {
                v.image = Some(ImageSource::from(Arc::new(Image::from_bytes(
                    ImageFormat::Png,
                    png,
                ))));
            }
            v.transcoding = false;
            cx.notify();
        });
    })
    .detach();
}

struct ImageSurface {
    view: Entity<ImagePreview>,
}
impl ViewerSurface for ImageSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        self.view.update(cx, |view, cx| {
            view.resource = Some(resource.clone());
            view.image = source(resource);
            cx.notify();
        });
        if let Ok(PreviewData::LocalFile(path)) = resource.data() {
            let name = path.to_string_lossy().into_owned();
            transcode_if_needed(&self.view, &name, cx);
        }
    }
}

fn source(resource: &PreviewResource) -> Option<ImageSource> {
    resource.data().ok().and_then(|data| match data {
        PreviewData::LocalFile(path) => Some(ImageSource::from(path.clone())),
        PreviewData::Bytes { mime, bytes } => ImageFormat::from_mime_type(mime)
            .map(|format| ImageSource::from(Arc::new(Image::from_bytes(format, bytes.to_vec())))),
    })
}

struct ImagePreview {
    resource: Option<PreviewResource>,
    image: Option<ImageSource>,
    /// A platform transcode is running: show loading, not failure.
    transcoding: bool,
}
impl ImagePreview {
    /// `onRetryInput`: forget the failed decode and read the file again.
    fn retry(&mut self, cx: &mut Context<Self>) {
        if let Some(image) = self.image.take() {
            image.remove_asset(cx);
        }
        self.image = self.resource.as_ref().and_then(source);
        cx.notify();
    }
}
/// `.editor-state.editor-state--stacked.danger`: the reason over Retry.
fn failure(message: String, view: WeakEntity<ImagePreview>, p: theme::Theme) -> AnyElement {
    let m = theme::ty();
    v_flex_centered()
        .gap(px(7.))
        .text_size(px(m.ui.meta))
        .line_height(relative(theme::NORMAL_LINE_HEIGHT))
        .text_color(p.danger)
        .child(message)
        .child(
            div()
                .id("image-retry")
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
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |v, cx| v.retry(cx));
                }),
        )
        .into_any_element()
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
        let image = self
            .resource
            .as_ref()
            .filter(|r| r.data().is_ok())
            .and(self.image.clone());
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
            None if self.transcoding => note(t("editor.preview.loading").into(), p.muted),
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
