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
        generation: 0,
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
    let generation = view.update(cx, |v, _| {
        v.image = None;
        v.transcoding = true;
        v.generation
    });
    let budget = crate::editor::registry::source_budget(name);
    let task = cx
        .background_executor()
        .spawn(async move { crate::platform::image_transcode::to_png(&path, budget) });
    let view = view.downgrade();
    cx.spawn(async move |cx| {
        let result = task.await;
        let _ = view.update(cx, |v, cx| {
            if generation != v.generation {
                return;
            }
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
            view.generation += 1;
            view.transcoding = false;
            // Local files keep the same path after an external write. Drop
            // GPUI's decoded asset so the new lease displays the new bytes.
            if let Some(image) = view.image.take() {
                image.remove_asset(cx);
            }
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
    generation: u64,
}
impl EventEmitter<SurfaceEvent> for ImagePreview {}
impl ImagePreview {
    /// `onRetryInput`: forget the failed decode and read the file again.
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[gpui::test]
    fn an_external_replacement_at_the_same_path_evicts_the_decoded_image(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("image.png");
        std::fs::write(&path, include_bytes!("../../../fixtures/editor/sample.png")).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("image.png")).unwrap();
        let (view, cx) = cx.add_window_view(|_, _| ImagePreview {
            image: source(&resource),
            resource: Some(resource),
            transcoding: false,
            generation: 0,
        });
        cx.update(|window, cx| {
            let _ = window.draw(cx);
        });
        view.read_with(cx, |view, cx| {
            assert!(view.image.as_ref().unwrap().is_asset_cached(cx))
        });
        std::fs::write(&path, include_bytes!("../../../fixtures/editor/broken.png")).unwrap();
        let replacement = ws.resource(std::path::Path::new("image.png")).unwrap();
        cx.update(|_, cx| {
            ImageSurface { view: view.clone() }.rebind_resource(&replacement, cx);
            assert!(
                !view.read(cx).image.as_ref().unwrap().is_asset_cached(cx),
                "same-path cache must not keep displaying obsolete bytes"
            )
        });
    }

    #[gpui::test]
    fn a_late_avif_transcode_cannot_replace_the_new_png_resource(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("old.avif"),
            include_bytes!("../../../fixtures/media/red.avif"),
        )
        .unwrap();
        std::fs::write(
            dir.path().join("new.png"),
            include_bytes!("../../../fixtures/editor/sample.png"),
        )
        .unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let old = ws.resource(std::path::Path::new("old.avif")).unwrap();
        let new = ws.resource(std::path::Path::new("new.png")).unwrap();
        let (view, cx) = cx.add_window_view(|_, _| ImagePreview {
            image: source(&old),
            resource: Some(old),
            transcoding: false,
            generation: 0,
        });
        cx.update(|_, cx| {
            transcode_if_needed(&view, "old.avif", cx);
            ImageSurface { view: view.clone() }.rebind_resource(&new, cx);
        });
        cx.run_until_parked();
        view.read_with(cx, |view, _| {
            assert!(
                matches!(&view.image, Some(ImageSource::Resource(_))),
                "obsolete transcode replaced the new source"
            );
            assert_eq!(view.resource.as_ref().unwrap(), &new);
            assert!(!view.transcoding);
        });
    }
}
