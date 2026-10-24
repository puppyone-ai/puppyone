//! `DocumentPreview` (`document-preview.css`): the honest surface of a file no
//! viewer can render here — the fallback for binary files, product viewers
//! the native build does not have yet.
use crate::{
    editor::registry::{SurfaceRequest, ViewerSurface},
    localization::t,
    theme,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};

/// `document-placeholder`: "Binary file · PNG".
pub fn open_binary(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    preview(request, t("editor.preview.binaryFile"), cx)
}
/// A product viewer the native build does not have yet.
pub fn open_unavailable(
    request: &SurfaceRequest,
    _: &mut Window,
    cx: &mut App,
) -> Box<dyn ViewerSurface> {
    preview(request, t("editor.preview.unavailable"), cx)
}
fn preview(request: &SurfaceRequest, label: &str, cx: &mut App) -> Box<dyn ViewerSurface> {
    let file_type = file_type(request.name);
    let view = cx.new(|_| DocumentPreview {
        label: label.to_owned().into(),
        file_type,
    });
    Box::new(PlaceholderSurface { view })
}

/// `binaryFileType`: the name's extension, upper-cased.
fn file_type(name: &str) -> Option<String> {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let dot = name.rfind('.')?;
    (dot > 0 && dot < name.len() - 1).then(|| name[dot + 1..].to_uppercase())
}

struct PlaceholderSurface {
    view: Entity<DocumentPreview>,
}
impl ViewerSurface for PlaceholderSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
}

struct DocumentPreview {
    label: SharedString,
    file_type: Option<String>,
}
impl Render for DocumentPreview {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let size = theme::ty().editor.data;
        // GPUI's slash pattern is laid out in device pixels along its 45°
        // stripes: a 1px line every 16px across them, at any scale.
        let along = window.scale_factor() * std::f32::consts::SQRT_2;
        div()
            .id("document-preview")
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .p(px(32.))
            .bg(t.canvas)
            .child(
                // `.document-preview__summary`: a hairline box hatched at
                // 1px every 16px.
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(4.))
                    .max_w_full()
                    .px(px(24.))
                    .py(px(16.))
                    .border_1()
                    .border_color(theme::alpha(t.muted, 0.42))
                    .bg(pattern_slash(
                        theme::alpha(t.muted, 0.32),
                        along,
                        15. * along,
                    ))
                    .text_size(px(size))
                    .line_height(relative(1.45))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.muted)
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .justify_center()
                            .child(self.label.clone())
                            .children(self.file_type.clone().map(|kind| {
                                div()
                                    .text_color(t.text_disabled)
                                    .child(format!(" · {kind}"))
                            })),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::file_type;
    use core::prelude::v1::test;

    #[test]
    fn the_file_type_is_the_upper_cased_extension() {
        assert_eq!(file_type("assets/model.glb").as_deref(), Some("GLB"));
        assert_eq!(file_type(".env"), None);
        assert_eq!(file_type("Makefile"), None);
        assert_eq!(file_type("trailing."), None);
    }
}
