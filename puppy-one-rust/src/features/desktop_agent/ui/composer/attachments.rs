//! `AgentVisualAttachmentList`: the draft's image references on the 40px
//! shelf, each with its status and a remove control.
use super::super::agent_theme::AgentTheme;
use super::{ComposerEvent, ComposerView};
use crate::agent::contract::dto::{DraftReference, ReferenceStatus};
use crate::features::desktop_agent::application::agent_reference_preview_store::object_url_bytes;
use crate::features::desktop_agent::domain::agent_prompt_mentions::is_agent_media_reference;
use crate::localization::{Arg, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, tooltip};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;
use gpui_kit::component::Sizable as _;
use std::path::PathBuf;

/// `--agent-reference-card-height`.
const CARD: f32 = 40.;

/// `localizedReferenceError(reference, t)`.
fn localized_reference_error(reference: &DraftReference) -> String {
    const LOCALIZED: [&str; 10] = [
        "capability-unreported",
        "reference-size",
        "workspace-directory-unsupported",
        "workspace-file-unsupported",
        "image-unsupported",
        "file-unsupported",
        "mime-unsupported",
        "reference-limit",
        "reference-total-size",
        "workspace-resolution-failed",
    ];
    let error = reference.error.as_ref();
    match error.map(|e| e.code.as_str()) {
        Some(code) if LOCALIZED.contains(&code) => {
            t(&format!("agent.reference.error.{code}")).into()
        }
        _ => error
            .map(|e| e.message.clone())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| t("agent.reference.failed").into()),
    }
}

/// `AgentVisualAttachment`'s status details: the localized state, then the
/// raw error when it says more.
pub(super) fn reference_details(reference: &DraftReference) -> Vec<String> {
    let status = match reference.status {
        ReferenceStatus::Resolving => t("agent.reference.resolving").to_string(),
        ReferenceStatus::Error => localized_reference_error(reference),
        ReferenceStatus::Ready => String::new(),
    };
    let raw = if reference.status == ReferenceStatus::Error {
        reference
            .error
            .as_ref()
            .map(|e| e.message.clone())
            .unwrap_or_default()
    } else {
        String::new()
    };
    let raw = if raw != status { raw } else { String::new() };
    [status, raw]
        .into_iter()
        .filter(|d| !d.is_empty())
        .collect()
}

impl ComposerView {
    /// `AgentVisualAttachmentList`: image references on the 40px shelf.
    pub(super) fn render_visual_attachments(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let state = &self.data;
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let media: Vec<DraftReference> = state
            .references
            .iter()
            .filter(|r| is_agent_media_reference(r))
            .cloned()
            .collect();
        if media.is_empty() {
            return None;
        }
        let action_hover = theme::mix(t_.menu_bg, t_.text, 0.88);
        let mut shelf = h_flex()
            .w_full()
            .min_w_0()
            .flex_wrap()
            .items_start()
            .gap(px(14.))
            .pt(px(12.))
            .px(px(12.));
        for reference in media {
            let id = reference.id.clone();
            let name = reference.display_name.clone();
            let preview = self.data.previews.get(&id).cloned();
            let image: Option<ImageSource> = preview.and_then(|url| match object_url_bytes(&url) {
                Some(bytes) => {
                    let is_svg = reference.mime.as_deref() == Some("image/svg+xml")
                        || name.to_ascii_lowercase().ends_with(".svg");
                    if is_svg {
                        let raster = crate::platform::svg::rasterize_svg(&bytes, 2.0).ok()?;
                        let buf = image::RgbaImage::from_raw(
                            raster.pixel_width,
                            raster.pixel_height,
                            raster.bgra,
                        )?;
                        return Some(ImageSource::Render(std::sync::Arc::new(RenderImage::new(
                            vec![image::Frame::new(buf)],
                        ))));
                    }
                    let format = match reference.mime.as_deref().unwrap_or_default() {
                        "image/jpeg" => ImageFormat::Jpeg,
                        "image/gif" => ImageFormat::Gif,
                        "image/webp" => ImageFormat::Webp,
                        _ => ImageFormat::Png,
                    };
                    Some(ImageSource::from(std::sync::Arc::new(Image::from_bytes(
                        format,
                        (*bytes).clone(),
                    ))))
                }
                None => {
                    let path = PathBuf::from(url);
                    let is_svg = reference.mime.as_deref() == Some("image/svg+xml")
                        || path
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"));
                    if is_svg {
                        let bytes = std::fs::read(&path).ok()?;
                        let raster = crate::platform::svg::rasterize_svg(&bytes, 2.0).ok()?;
                        let buf = image::RgbaImage::from_raw(
                            raster.pixel_width,
                            raster.pixel_height,
                            raster.bgra,
                        )?;
                        Some(ImageSource::Render(std::sync::Arc::new(RenderImage::new(
                            vec![image::Frame::new(buf)],
                        ))))
                    } else {
                        Some(ImageSource::from(path))
                    }
                }
            });
            let group = SharedString::from(format!("panel-visual-attachment-{id}"));
            let failed = reference.status == ReferenceStatus::Error;
            let remove = tf(
                "agent.reference.remove",
                &[("name", Arg::Text(name.clone()))],
            );
            let remove_id = id.clone();
            let status = match reference.status {
                ReferenceStatus::Resolving => "resolving",
                ReferenceStatus::Ready => "ready",
                ReferenceStatus::Error => "error",
            };
            let card_selector = format!("agent-attachment:{name}:{status}");
            let remove_selector = format!("agent-attachment-remove:{name}");
            shelf = shelf.child(
                div()
                    .id(SharedString::from(format!("panel-visual-card-{id}")))
                    .debug_selector(move || card_selector)
                    .group(group.clone())
                    .relative()
                    .size(px(CARD))
                    .flex_shrink_0()
                    .rounded(px(6.))
                    .border_1()
                    .border_color(if failed { t_.danger } else { a.border_subtle })
                    .bg(a.row_hover)
                    .tooltip(tooltip(
                        std::iter::once(name.clone())
                            .chain(reference_details(&reference))
                            .collect::<Vec<_>>()
                            .join("\n"),
                    ))
                    .child(
                        div()
                            .size_full()
                            .rounded(px(5.))
                            .overflow_hidden()
                            .flex()
                            .items_center()
                            .justify_center()
                            .map(|d| match image {
                                Some(image) => {
                                    d.child(img(image).size_full().object_fit(ObjectFit::Cover))
                                }
                                None => d.child(
                                    Icon::new("image")
                                        .with_size(px(18.))
                                        .stroke(2.)
                                        .color(a.text_muted),
                                ),
                            }),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("panel-visual-remove-{id}")))
                            .debug_selector(move || remove_selector)
                            .absolute()
                            .top(px(-6.))
                            .right(px(-6.))
                            .size(px(20.))
                            .rounded_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(t_.menu_bg)
                            .invisible()
                            .group_hover(group, |s| s.visible())
                            .hover(move |s| s.bg(action_hover))
                            .tooltip(tooltip(remove))
                            .on_click(cx.listener(move |_, _, _, cx| {
                                cx.emit(ComposerEvent::RemoveReference(remove_id.clone()));
                            }))
                            .child(
                                Icon::new("x")
                                    .with_size(px(12.))
                                    .stroke(2.)
                                    .color(a.text_muted),
                            ),
                    ),
            );
        }
        Some(shelf.into_any_element())
    }
}
