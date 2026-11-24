//! The preview a moved pane shows under the pointer (`paneMovePreview.ts`,
//! `pane-preview-ipc.mjs`): at once a themed shell of the pane's shape,
//! never a copy of its live content, then a small bitmap of the pane's
//! content bounds when the window server gives one.
use super::pane::PaneDrag;
use crate::{theme, ui::appearance::ActiveAppearance as _};
use gpui::{prelude::*, *};
use std::sync::Arc;

/// `PANE_MOVE_PREVIEW_MAX_WIDTH`, `_MAX_HEIGHT`, `_MAX_SCALE`.
pub const MAX_WIDTH: f32 = 240.;
pub const MAX_HEIGHT: f32 = 156.;
pub const MAX_SCALE: f32 = 0.36;
/// The preview sits this far below the pointer, centred on it.
const BELOW_POINTER: f32 = 10.;

/// `getPaneMovePreviewSize`: the pane's shape, at most 240 × 156 and a
/// third of its size.
pub fn preview_size(width: f32, height: f32) -> Size<f32> {
    let (w, h) = (width.max(1.), height.max(1.));
    let scale = (MAX_WIDTH / w).min(MAX_HEIGHT / h).min(MAX_SCALE);
    size((w * scale).round().max(1.), (h * scale).round().max(1.))
}

/// A window rectangle in whole points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// `normalizeCaptureRect`: `request` clipped to the window's content
/// (`content`, `None` when the window has none); `None` when nothing of it
/// is left.
pub fn normalize_capture_rect(
    request: Bounds<f32>,
    content: Option<Size<f32>>,
) -> Option<CaptureRect> {
    let content = content?;
    let (x, y, w, h) = (
        request.origin.x,
        request.origin.y,
        request.size.width,
        request.size.height,
    );
    if ![x, y, w, h].iter().all(|v| v.is_finite()) {
        return None;
    }
    let (cw, ch) = (
        content.width.floor().max(0.),
        content.height.floor().max(0.),
    );
    if cw < 1. || ch < 1. || w <= 0. || h <= 0. {
        return None;
    }
    let left = x.floor().clamp(0., cw);
    let top = y.floor().clamp(0., ch);
    let right = (x + w).ceil().max(left).min(cw);
    let bottom = (y + h).ceil().max(top).min(ch);
    (right > left && bottom > top).then_some(CaptureRect {
        x: left as u32,
        y: top as u32,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
    })
}

/// The bitmap size a capture of `rect` is scaled to (the IPC's resize).
pub fn bitmap_size(rect: CaptureRect) -> (u32, u32) {
    let s = preview_size(rect.width as f32, rect.height as f32);
    (s.width as u32, s.height as u32)
}

/// The view a pane drag draws (`desktop-editor-pane-move-preview`).
pub struct PanePreview {
    size: Size<f32>,
    /// Where the pointer held the handle: GPUI draws the view there.
    offset: Point<Pixels>,
    snapshot: Option<Arc<Image>>,
}

impl PanePreview {
    /// The preview of `drag`'s pane, grabbed `offset` into its handle; the
    /// pane's bitmap is asked for at once and fills the shell when it comes.
    pub fn start(
        drag: &PaneDrag,
        offset: Point<Pixels>,
        window: &mut Window,
        cx: &mut App,
    ) -> Entity<Self> {
        let pane = drag.pane.unwrap_or_default();
        let size = preview_size(f32::from(pane.size.width), f32::from(pane.size.height));
        let preview = cx.new(|_| Self {
            size,
            offset,
            snapshot: None,
        });
        if let Some(job) = capture(window, pane, cx) {
            let weak = preview.downgrade();
            cx.spawn(async move |cx| {
                if let Some(png) = job.await {
                    let image = Arc::new(Image::from_bytes(ImageFormat::Png, png));
                    let _ = weak.update(cx, |p, cx| {
                        p.snapshot = Some(image);
                        cx.notify();
                    });
                }
            })
            .detach();
        }
        preview
    }

    /// The bitmap arrived (`applyPaneMovePreviewSnapshot`).
    pub fn ready(&self) -> bool {
        self.snapshot.is_some()
    }
}

/// `capturePaneMovePreview`: ask the platform for the pane's content
/// bounds, clipped to the window and scaled to the preview.
fn capture(window: &Window, pane: Bounds<Pixels>, cx: &App) -> Option<Task<Option<Vec<u8>>>> {
    let request = Bounds {
        origin: point(f32::from(pane.origin.x), f32::from(pane.origin.y)),
        size: size(f32::from(pane.size.width), f32::from(pane.size.height)),
    };
    let content = window.viewport_size();
    let content = size(f32::from(content.width), f32::from(content.height));
    #[cfg(any(test, feature = "test-support"))]
    if let Some(job) = capture_hook::requested(request, cx) {
        return Some(job);
    }
    let rect = normalize_capture_rect(request, Some(content))?;
    let id = crate::platform::window_capture::window_id(window)?;
    let target = bitmap_size(rect);
    Some(cx.background_executor().spawn(async move {
        crate::platform::window_capture::capture(
            id,
            (content.width as f64, content.height as f64),
            (
                rect.x as f64,
                rect.y as f64,
                rect.width as f64,
                rect.height as f64,
            ),
            target,
        )
    }))
}

impl Render for PanePreview {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let (w, h) = (self.size.width, self.size.height);
        // Centred under the pointer, 10px below it.
        let left = f32::from(self.offset.x) - w / 2.;
        let top = f32::from(self.offset.y) + BELOW_POINTER;
        // The shell's placeholder rules until the bitmap arrives.
        let rule = |at: f32, width: f32| {
            div()
                .absolute()
                .left(px(w * 0.12))
                .top(px(h * 0.12 + h * 0.76 * at))
                .w(px(w * 0.76 * width))
                .h(px(1.))
                .bg(p.divider)
        };
        // GPUI draws a drag's view where the handle was grabbed; the shell
        // sits from there.
        let shell = div()
            .debug_selector(|| "pane-move-preview".into())
            .absolute()
            .left(px(left))
            .top(px(top))
            .w(px(w))
            .h(px(h))
            .relative()
            .overflow_hidden()
            .rounded(px(2.))
            .bg(theme::alpha(p.canvas, 0.88))
            .shadow_lg()
            .opacity(0.88)
            .map(|d| match self.snapshot.clone() {
                Some(image) => d.child(
                    img(image)
                        .debug_selector(|| "pane-move-preview-image".into())
                        .size_full()
                        .object_fit(ObjectFit::Cover),
                ),
                None => d
                    .child(rule(0., 0.46))
                    .child(rule(0.32, 0.72))
                    .child(rule(0.64, 0.58)),
            });
        div().relative().size_0().child(shell)
    }
}

/// Tests: what drags ask the platform for, answered with a fixed bitmap.
#[cfg(any(test, feature = "test-support"))]
pub mod capture_hook {
    use super::*;
    use std::cell::RefCell;

    type Answer = Option<Vec<u8>>;
    struct Hook {
        requests: Vec<Bounds<f32>>,
        answer: Answer,
        /// Answers wait until [`release`] while held.
        held: Option<(async_channel::Sender<()>, async_channel::Receiver<()>)>,
    }
    thread_local! {
        static HOOK: RefCell<Option<Hook>> = const { RefCell::new(None) };
    }

    /// Record what drags ask for and answer with `png`, once released.
    pub fn answer_with(png: Option<Vec<u8>>) {
        HOOK.with(|h| {
            *h.borrow_mut() = Some(Hook {
                requests: Vec::new(),
                answer: png,
                held: Some(async_channel::unbounded()),
            })
        });
    }

    /// Let the held answers through.
    pub fn release() {
        HOOK.with(|h| {
            if let Some((tx, _)) = h.borrow_mut().as_mut().and_then(|h| h.held.take()) {
                tx.close();
            }
        });
    }

    pub fn requests() -> Vec<Bounds<f32>> {
        HOOK.with(|h| {
            h.borrow()
                .as_ref()
                .map(|h| h.requests.clone())
                .unwrap_or_default()
        })
    }

    pub(super) fn requested(request: Bounds<f32>, cx: &App) -> Option<Task<Option<Vec<u8>>>> {
        HOOK.with(|h| {
            let mut h = h.borrow_mut();
            let hook = h.as_mut()?;
            hook.requests.push(request);
            let answer = hook.answer.clone();
            let wait = hook.held.as_ref().map(|(_, rx)| rx.clone());
            Some(cx.background_executor().spawn(async move {
                if let Some(rx) = wait {
                    let _ = rx.recv().await;
                }
                answer
            }))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `paneMovePreview.test.ts` #0 (size) and `pane-preview-ipc.mjs` #0–#1.
    #[test]
    fn previews_keep_the_panes_shape_and_captures_stay_in_the_window() {
        assert_eq!(preview_size(400., 600.), size(104., 156.));
        assert_eq!(preview_size(640., 420.), size(230., 151.));
        let rect = normalize_capture_rect(
            Bounds {
                origin: point(-10., 10.),
                size: size(500., 300.),
            },
            Some(size(400., 240.)),
        )
        .unwrap();
        assert_eq!(
            rect,
            CaptureRect {
                x: 0,
                y: 10,
                width: 400,
                height: 230
            }
        );
        assert_eq!(bitmap_size(rect), (144, 83));
        let bounds = |w: f32, h: f32| Bounds {
            origin: point(0., 0.),
            size: size(w, h),
        };
        assert_eq!(
            normalize_capture_rect(bounds(0., 20.), Some(size(400., 240.))),
            None
        );
        assert_eq!(normalize_capture_rect(bounds(20., 20.), None), None);
    }
}
