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
    let image = resource
        .as_ref()
        .and_then(|r| r.data().ok())
        .and_then(|data| match data {
            PreviewData::LocalFile(path) => Some(ImageSource::from(path.clone())),
            PreviewData::Bytes { mime, bytes } => ImageFormat::from_mime_type(mime).map(|format| {
                ImageSource::from(Arc::new(Image::from_bytes(format, bytes.to_vec())))
            }),
        });
    Box::new(ImageSurface {
        view: cx.new(|_| ImagePreview { resource, image }),
    })
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
            view.image = resource.data().ok().and_then(|data| match data {
                PreviewData::LocalFile(path) => Some(ImageSource::from(path.clone())),
                PreviewData::Bytes { mime, bytes } => {
                    ImageFormat::from_mime_type(mime).map(|format| {
                        ImageSource::from(Arc::new(Image::from_bytes(format, bytes.to_vec())))
                    })
                }
            });
            cx.notify();
        });
    }
}

struct ImagePreview {
    resource: Option<PreviewResource>,
    image: Option<ImageSource>,
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
        let content = match image {
            Some(image) => img(image)
                .max_w_full()
                .max_h_full()
                .object_fit(ObjectFit::Contain)
                .rounded(px(6.))
                .with_loading(move || note(t("editor.preview.loading").into(), p.muted))
                .with_fallback(move || note(failed.clone(), p.danger))
                .into_any_element(),
            None => note(failed, p.danger),
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
