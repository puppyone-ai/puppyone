//! `.cm-md-image-widget` (markdown-inline-widgets.css): the images of an
//! image line, in the line's content box. A block image is its natural
//! size within the column (never upscaled); inline ones are capped at
//! 320px tall and sit on one row, a space apart, centred on it. Images have
//! the block radius; the widget takes the block ring while hovered or
//! focused and the selected ring while the selection covers it. Until an
//! image decodes it is a loading tile; one that cannot load shows its alt
//! text (or source) in a placeholder chip.
use super::{ID, ShowSource, cache, source::Source};
use crate::{
    editor::{
        markdown::shared::ring,
        registry::DocumentAssets,
        view::{
            command::Command,
            style::{Align, Rect, TextStyle},
            widget::{LineEmbed, WidgetCx},
        },
    },
    theme::{Theme, mix},
};
use gpui::{prelude::*, *};
use std::ops::Range;

/// `.cm-md-image-widget img { max-height: 320px }` (inline images).
const INLINE_MAX_HEIGHT: f32 = 320.;
/// `.cm-md-image-placeholder`: `min-height: 22px; padding: 0 8px`, 1px border.
const PLACEHOLDER_MIN: f32 = 22.;
const PLACEHOLDER_PADDING: f32 = 8.;

pub struct Item {
    /// The image's (or its link's) source.
    pub range: Range<usize>,
    /// What a placeholder says: the alt text, else the source.
    pub label: String,
    pub size: Option<(f32, Option<f32>)>,
    pub source: Option<Source>,
    pub key: Option<String>,
    pub link: Option<String>,
}

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
    Failed,
}

/// CSS `clamp(min, preferred, max)`.
fn clamp(min: f32, preferred: f32, max: f32) -> f32 {
    preferred.min(max).max(min)
}

impl ImageEmbed {
    /// Width and height of an image of natural size `natural` in `available`.
    fn fit(&self, item: &Item, natural: (f32, f32), available: f32) -> (f32, f32) {
        let (nw, nh) = (natural.0.max(1.), natural.1.max(1.));
        let (mut w, mut h) = match item.size {
            Some((w, Some(h))) => (w, h),
            Some((w, None)) => (w, nh * w / nw),
            None => (nw, nh),
        };
        let auto_height = !matches!(item.size, Some((_, Some(_))));
        if !self.block && auto_height && h > INLINE_MAX_HEIGHT {
            w *= INLINE_MAX_HEIGHT / h;
            h = INLINE_MAX_HEIGHT;
        }
        if w > available {
            if auto_height {
                h *= available / w;
            }
            w = available;
        }
        (w, h)
    }
}

impl LineEmbed for ImageEmbed {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let available = cx.width;
        let vw = f32::from(cx.render.window.viewport_size().width) / 100.;
        let t = Theme::new(self.dark);
        let meta = TextStyle {
            size: crate::theme::ty().ui.meta,
            color: t.muted,
            ..self.text.clone()
        };
        let chip_height = meta.line_height_px().max(PLACEHOLDER_MIN) + 2.;
        let gap = cx.render.plain_extent(" ", &self.text, None).1;
        // Every item's box, then its row placement.
        let mut boxes: Vec<(Shown, f32, f32)> = Vec::new();
        for item in &self.items {
            let state = match (&item.key, &item.source) {
                (Some(key), Some(source)) => {
                    cache::get(key, source, self.assets.as_ref(), cx.render.app)
                }
                _ => cache::State::Failed,
            };
            boxes.push(match state {
                cache::State::Ready {
                    image,
                    width,
                    height,
                } => {
                    let (w, h) = self.fit(item, (width, height), available);
                    (Shown::Image(image), w, h)
                }
                cache::State::Loading if self.block => {
                    (Shown::Loading, available, clamp(54., 10. * vw, 96.))
                }
                cache::State::Loading => (
                    Shown::Loading,
                    clamp(96., 18. * vw, 180.),
                    clamp(54., 10. * vw, 96.),
                ),
                cache::State::Failed if self.block => (Shown::Failed, available, chip_height),
                cache::State::Failed => {
                    let text = cx.render.plain_extent(&item.label, &meta, None).1;
                    (
                        Shown::Failed,
                        (text + 2. * PLACEHOLDER_PADDING + 2.).min(available),
                        chip_height,
                    )
                }
            });
        }
        // Rows: inline boxes flow and wrap, centred on their row.
        let line_height = self.text.line_height_px();
        let mut placed: Vec<Rect> = Vec::new();
        let mut rows: Vec<(usize, f32)> = Vec::new();
        let (mut x, mut row_start) = (0., 0);
        for (i, (_, w, h)) in boxes.iter().enumerate() {
            if i > row_start && x + w > available {
                rows.push((row_start, 0.));
                row_start = i;
                x = 0.;
            }
            placed.push(Rect::new(x, 0., *w, *h));
            x += w + gap;
        }
        rows.push((row_start, 0.));
        // A block widget is block-level inside its line, so CodeMirror's
        // widget buffers before and after it each take a line box of their
        // own (the product's 26.25px above and below a block image).
        let buffer = if self.block { line_height } else { 0. };
        let mut y = buffer;
        for r in 0..rows.len() {
            let from = rows[r].0;
            let to = rows.get(r + 1).map_or(placed.len(), |next| next.0);
            let height = placed[from..to]
                .iter()
                .map(|b| b.height)
                .fold(if self.block { 0. } else { line_height }, f32::max);
            for b in &mut placed[from..to] {
                b.y = y + (height - b.height) / 2.;
            }
            y += height;
        }
        let height = y + buffer;
        let state = cx.state;
        let ring_color = if state.selected {
            Some(self.selected_ring)
        } else if state.focus_within() {
            Some(self.hover_ring)
        } else {
            None
        };
        let view = cx.render.view.clone();
        let mut children: Vec<AnyElement> = Vec::new();
        for (k, ((shown, _, _), item)) in boxes.into_iter().zip(&self.items).enumerate() {
            let b = placed[k];
            // The block widget spans the column; an inline one its image.
            let frame_width = if self.block { available } else { b.width };
            let size = (frame_width, b.height);
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
                    .bg(mix(t.control, Rgba { a: 0., ..t.control }, 0.34))
                    .into_any_element(),
                Shown::Failed => {
                    let label = cx.render.label(
                        Rect::new(
                            PLACEHOLDER_PADDING + 1.,
                            0.,
                            (b.width - 2. * PLACEHOLDER_PADDING - 2.).max(0.),
                            b.height,
                        ),
                        &SharedString::from(item.label.clone()),
                        &meta,
                        Align::Start,
                        cx.top + b.y,
                    );
                    div()
                        .relative()
                        .w(px(b.width))
                        .h(px(b.height))
                        .rounded(px(self.radius))
                        .border_1()
                        .border_color(t.border_subtle)
                        .bg(mix(t.control, Rgba { a: 0., ..t.control }, 0.26))
                        .overflow_hidden()
                        .child(label)
                        .into_any_element()
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
            let show = ShowSource {
                line: self.line.clone(),
                caret: (item.range.start + 2).min(item.range.end),
            };
            let caret = item.range.end;
            children.push(
                div()
                    .id(("md-image", self.line.start * 64 + k))
                    .group(SharedString::from(format!("md-image-{k}")))
                    .absolute()
                    .left(px(b.x))
                    .top(px(b.y))
                    .w(px(frame_width))
                    .h(px(b.height))
                    .cursor(if link.is_some() {
                        crate::theme::clickable_cursor()
                    } else {
                        CursorStyle::Arrow
                    })
                    .child(content)
                    .child(frame)
                    .on_mouse_down(MouseButton::Left, move |event, window, cx| {
                        cx.stop_propagation();
                        let _ = view.update(cx, |v, cx| {
                            if event.click_count >= 2 {
                                v.run_command(&Command::new(ID, show.clone()), window, cx);
                            } else if let Some(href) = &link {
                                v.follow_href(href, cx);
                            } else {
                                v.focus(window, cx);
                                v.set_selection(
                                    crate::editor::text::selection::Selection::cursor(caret),
                                    cx,
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
