//! `.cm-md-image-widget` (markdown-inline-widgets.css): the images of an
//! image line, in the line's content box. A block image is its natural
//! size within the column (never upscaled); inline ones are capped at
//! 320px tall and sit on one row, a space apart, centred on it. Images have
//! the block radius; the widget takes the block ring while hovered or
//! focused and the selected ring while the selection covers it. Failed images
//! degrade visibly along `Rendered -> Card/Chip Fallback -> Source` (`TA-52`)
//! with a localized reason plus `Retry` / `Source code` controls (`TODO-37`).
use super::{
    ID,
    model::{Item, ShowSource, fit},
};
use crate::{
    editor::{
        markdown::{
            platform::{
                brokers::assets::{self as asset_broker, AssetState},
                policy::AssetFailure,
            },
            shared::widgets::{
                fallback::{FallbackSummary, action_pill},
                ring,
            },
        },
        registry::DocumentAssets,
        view::{
            command::Command,
            style::{Align, Rect, TextStyle},
            widget::{LineEmbed, WidgetCx},
        },
    },
    localization::{t, tf},
    theme::{self, Theme, mix},
};
use gpui::{prelude::*, *};
use std::ops::Range;

/// `.cm-md-image-placeholder`: `min-height: 22px; padding: 0 8px`, 1px border.
const PLACEHOLDER_MIN: f32 = 22.;
const PLACEHOLDER_PADDING: f32 = 8.;
const BLOCK_FALLBACK_MIN_HEIGHT: f32 = 72.;

pub struct ImageEmbed {
    pub items: Vec<Item>,
    pub block: bool,
    pub line: Range<usize>,
    pub assets: Option<DocumentAssets>,
    pub radius: f32,
    pub hover_ring: Rgba,
    pub selected_ring: Rgba,
    pub ring_width: f32,
    pub text: TextStyle,
    pub dark: bool,
}

enum Shown {
    Image(std::sync::Arc<RenderImage>),
    Loading,
    Failed(AssetFailure),
}

fn clamp(min: f32, preferred: f32, max: f32) -> f32 {
    preferred.min(max).max(min)
}

/// Formats a byte budget into a human-readable limit (`"32 MB"`, `"2 MB"`).
fn format_limit_mb(limit_bytes: u64) -> String {
    let mib = (limit_bytes as f64 / (1024.0 * 1024.0)).round() as u64;
    format!("{} MB", mib.max(1))
}

/// Computes the user-visible fallback summary for a failed image (`TA-52`).
pub fn describe_failure(label: &str, failure: &AssetFailure) -> FallbackSummary {
    let kind = t("editor.resource.kind.image");
    let (reason, retryable) = match failure {
        AssetFailure::ExceedsLimit { limit_bytes } => (
            tf(
                "editor.unavailable.resourceLimit",
                &[("limit", format_limit_mb(*limit_bytes).into())],
            ),
            false,
        ),
        AssetFailure::NotFound => (
            tf(
                "editor.resource.loadFailed",
                &[("kind", kind.into()), ("detail", "File not found".into())],
            ),
            true,
        ),
        AssetFailure::Blocked => (
            tf("editor.resource.unavailable", &[("kind", kind.into())]),
            false,
        ),
        AssetFailure::InvalidFormat => (
            tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", kind.into()),
                    ("detail", "Unsupported or corrupted image".into()),
                ],
            ),
            false,
        ),
        AssetFailure::Network(detail) => (
            tf(
                "editor.resource.loadFailed",
                &[
                    ("kind", kind.into()),
                    ("detail", crate::localization::bidi_isolate(detail).into()),
                ],
            ),
            true,
        ),
    };
    FallbackSummary {
        title: label.to_owned(),
        reason,
        retryable,
    }
}

impl ImageEmbed {
    fn measure_items(
        &self,
        available: f32,
        vw: f32,
        chip_height: f32,
        meta: &TextStyle,
        cx: &mut WidgetCx,
    ) -> Vec<(Shown, f32, f32)> {
        let mut boxes = Vec::with_capacity(self.items.len());
        for item in &self.items {
            let state = match &item.source {
                Ok(source) => asset_broker::get(source, self.assets.as_ref(), cx.render.app),
                Err(failure) => AssetState::Failed(failure.clone()),
            };
            boxes.push(match state {
                AssetState::Ready {
                    image,
                    width,
                    height,
                } => {
                    let (w, h) = fit(item.size, self.block, (width, height), available);
                    (Shown::Image(image), w, h)
                }
                AssetState::Loading if self.block => {
                    (Shown::Loading, available, clamp(54., 10. * vw, 96.))
                }
                AssetState::Loading => (
                    Shown::Loading,
                    clamp(96., 18. * vw, 180.),
                    clamp(54., 10. * vw, 96.),
                ),
                AssetState::Failed(failure) if self.block => {
                    (Shown::Failed(failure), available, BLOCK_FALLBACK_MIN_HEIGHT)
                }
                AssetState::Failed(failure) => {
                    let summary = describe_failure(&item.label, &failure);
                    let inline_text = format!("{} — {}", summary.title, summary.reason);
                    let text_w = cx.render.plain_extent(&inline_text, meta, None).1;
                    (
                        Shown::Failed(failure),
                        (text_w + 2. * PLACEHOLDER_PADDING + 2.).min(available),
                        chip_height,
                    )
                }
            });
        }
        boxes
    }

    fn layout_rows(
        &self,
        boxes: &[(Shown, f32, f32)],
        available: f32,
        gap: f32,
    ) -> (Vec<Rect>, f32) {
        let line_height = self.text.line_height_px();
        let mut placed: Vec<Rect> = Vec::with_capacity(boxes.len());
        let mut rows: Vec<usize> = Vec::new();
        let (mut x, mut row_start) = (0., 0);
        for (i, (_, w, h)) in boxes.iter().enumerate() {
            if i > row_start && x + w > available {
                rows.push(row_start);
                row_start = i;
                x = 0.;
            }
            placed.push(Rect::new(x, 0., *w, *h));
            x += w + gap;
        }
        rows.push(row_start);
        let buffer = if self.block { line_height } else { 0. };
        let mut y = buffer;
        for r in 0..rows.len() {
            let from = rows[r];
            let to = rows.get(r + 1).copied().unwrap_or(placed.len());
            let row_height = placed[from..to]
                .iter()
                .map(|b| b.height)
                .fold(if self.block { 0. } else { line_height }, f32::max);
            for b in &mut placed[from..to] {
                b.y = y + (row_height - b.height) / 2.;
            }
            y += row_height;
        }
        (placed, y + buffer)
    }

    fn render_block_fallback(
        &self,
        index: usize,
        item: &Item,
        failure: &AssetFailure,
        bounds: Rect,
        show: ShowSource,
        cx: &WidgetCx,
    ) -> AnyElement {
        let app = Theme::new(self.dark);
        let ty = theme::ty().ui;
        let summary = describe_failure(&item.label, failure);
        let send = cx.sender();
        let retry_source = item.source.as_ref().ok().cloned();
        let retry_assets = self.assets.clone();
        let can_retry = summary.retryable && retry_source.is_some();
        div()
            .w(px(bounds.width))
            .h(px(bounds.height))
            .px(px(12.))
            .py(px(10.))
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .rounded(px(self.radius))
            .border_1()
            .border_color(app.border_subtle)
            .bg(mix(
                app.control,
                Rgba {
                    a: 0.,
                    ..app.control
                },
                0.26,
            ))
            .overflow_hidden()
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(ty.body))
                            .font_weight(FontWeight(600.))
                            .text_color(app.text)
                            .child(SharedString::from(summary.title)),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(ty.meta))
                            .text_color(app.muted)
                            .child(SharedString::from(summary.reason)),
                    ),
            )
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .when(can_retry, |row| {
                        let source = retry_source.clone().unwrap();
                        let assets = retry_assets.clone();
                        row.child(action_pill(
                            ElementId::NamedInteger(
                                "md-image-retry".into(),
                                (self.line.start * 64 + index) as u64,
                            ),
                            t("common.action.retry"),
                            self.dark,
                            move |_, app_cx| asset_broker::retry(&source, assets.as_ref(), app_cx),
                        ))
                    })
                    .child(action_pill(
                        ElementId::NamedInteger(
                            "md-image-source".into(),
                            (self.line.start * 64 + index) as u64,
                        ),
                        t("editor.mode.source"),
                        self.dark,
                        move |window, app_cx| {
                            send(Command::new(ID, show.clone()), window, app_cx);
                        },
                    )),
            )
            .into_any_element()
    }

    fn render_inline_fallback(
        &self,
        item: &Item,
        failure: &AssetFailure,
        bounds: Rect,
        meta: &TextStyle,
        cx: &mut WidgetCx,
    ) -> AnyElement {
        let app = Theme::new(self.dark);
        let summary = describe_failure(&item.label, failure);
        let inline_text = format!("{} — {}", summary.title, summary.reason);
        let label = cx.render.label(
            Rect::new(
                PLACEHOLDER_PADDING + 1.,
                0.,
                (bounds.width - 2. * PLACEHOLDER_PADDING - 2.).max(0.),
                bounds.height,
            ),
            &SharedString::from(inline_text),
            meta,
            Align::Start,
            cx.top + bounds.y,
        );
        div()
            .relative()
            .w(px(bounds.width))
            .h(px(bounds.height))
            .rounded(px(self.radius))
            .border_1()
            .border_color(app.border_subtle)
            .bg(mix(
                app.control,
                Rgba {
                    a: 0.,
                    ..app.control
                },
                0.26,
            ))
            .overflow_hidden()
            .child(label)
            .into_any_element()
    }
}

impl LineEmbed for ImageEmbed {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let available = cx.width;
        let vw = f32::from(cx.render.window.viewport_size().width) / 100.;
        let app = Theme::new(self.dark);
        let meta = TextStyle {
            size: theme::ty().ui.meta,
            color: app.muted,
            ..self.text.clone()
        };
        let chip_height = meta.line_height_px().max(PLACEHOLDER_MIN) + 2.;
        let gap = cx.render.plain_extent(" ", &self.text, None).1;
        let boxes = self.measure_items(available, vw, chip_height, &meta, cx);
        let (placed, height) = self.layout_rows(&boxes, available, gap);
        let state = cx.state;
        let ring_color = if state.selected {
            Some(self.selected_ring)
        } else if state.focus_within() {
            Some(self.hover_ring)
        } else {
            None
        };
        let view = cx.render.view.clone();
        let mut children: Vec<AnyElement> = Vec::with_capacity(self.items.len());
        for (k, ((shown, _, _), item)) in boxes.into_iter().zip(&self.items).enumerate() {
            let b = placed[k];
            let frame_width = if self.block { available } else { b.width };
            let size = (frame_width, b.height);
            let show = ShowSource {
                line: self.line.clone(),
                caret: (item.range.start + 2).min(item.range.end),
            };
            let content: AnyElement = match shown {
                Shown::Image(image) => img(ImageSource::Render(image))
                    .w(px(b.width))
                    .h(px(b.height))
                    .rounded(px(self.radius))
                    .into_any_element(),
                Shown::Loading => div()
                    .w(px(b.width))
                    .h(px(b.height))
                    .rounded(px(self.radius))
                    .bg(mix(
                        app.control,
                        Rgba {
                            a: 0.,
                            ..app.control
                        },
                        0.34,
                    ))
                    .into_any_element(),
                Shown::Failed(ref failure) if self.block => {
                    self.render_block_fallback(k, item, failure, b, show.clone(), cx)
                }
                Shown::Failed(ref failure) => {
                    self.render_inline_fallback(item, failure, b, &meta, cx)
                }
            };
            let frame = match ring_color {
                Some(color) => ring::ring(size, self.radius, self.ring_width, color),
                None => {
                    let hover = self.hover_ring;
                    ring::outline(size, self.radius, self.ring_width)
                        .group_hover(SharedString::from(format!("md-image-{k}")), move |s| {
                            s.border_color(hover)
                        })
                }
            };
            let view = view.clone();
            let link = item.link.clone();
            let caret = item.range.end;
            children.push(
                div()
                    .id(("md-image", self.line.start * 64 + k))
                    .debug_selector(move || format!("md-image-{k}"))
                    .group(SharedString::from(format!("md-image-{k}")))
                    .absolute()
                    .left(px(b.x))
                    .top(px(b.y))
                    .w(px(frame_width))
                    .h(px(b.height))
                    .cursor(if link.is_some() {
                        theme::clickable_cursor()
                    } else {
                        CursorStyle::Arrow
                    })
                    .child(content)
                    .child(frame)
                    .on_mouse_down(MouseButton::Left, move |event, window, app_cx| {
                        app_cx.stop_propagation();
                        let _ = view.update(app_cx, |v, app_cx| {
                            if event.click_count >= 2 {
                                v.run_command(&Command::new(ID, show.clone()), window, app_cx);
                            } else if let Some(href) = &link {
                                v.follow_href(href, app_cx);
                            } else {
                                v.focus(window, app_cx);
                                v.set_selection(
                                    crate::editor::text::selection::Selection::cursor(caret),
                                    app_cx,
                                );
                            }
                        });
                    })
                    .into_any_element(),
            );
        }
        (
            div()
                .relative()
                .w(px(available))
                .h(px(height))
                .children(children)
                .into_any_element(),
            height,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn visible_fallback_summary_surfaces_oversized_missing_and_blocked_reasons() {
        let oversized = describe_failure(
            "poster.png",
            &AssetFailure::ExceedsLimit {
                limit_bytes: 32 * 1024 * 1024,
            },
        );
        assert_eq!(oversized.title, "poster.png");
        assert!(
            oversized.reason.contains("32 MB"),
            "expected size limit in reason, got {:?}",
            oversized.reason
        );
        assert!(!oversized.retryable);

        let missing = describe_failure("diagram.png", &AssetFailure::NotFound);
        assert!(
            missing.reason.contains("File not found"),
            "expected missing detail in reason, got {:?}",
            missing.reason
        );
        assert!(missing.retryable);

        let blocked = describe_failure("outside.png", &AssetFailure::Blocked);
        assert!(!blocked.reason.is_empty());
        assert!(!blocked.retryable);

        let network = describe_failure("remote.png", &AssetFailure::Network("HTTP 503".into()));
        assert!(network.reason.contains("HTTP 503"));
        assert!(network.retryable);
    }
}
