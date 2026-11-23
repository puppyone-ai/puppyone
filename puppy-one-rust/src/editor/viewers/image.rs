//! `image-preview` (`ImageResourceViewer`): display-size `ImageIO` decoding,
//! source budget precheck (`VW-01`), in-process AVIF/HEIC/GIF/PNG/JPEG/WebP
//! decoding (`VW-03`), and interactive zoom & pan (`Fit`, `100%`, `ZoomIn`,
//! `ZoomOut`, scroll-wheel/pinch zoom, drag pan, on-demand re-decode: `VW-02`).
use crate::workspace::{PreviewData, PreviewResource};
use crate::{
    editor::{
        registry::{
            PaneEntries, PaneItemId, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest,
            ViewerSurface,
        },
        workbench::{
            pane::{Item, ItemKind},
            view_state::SurfaceViewState,
        },
    },
    localization::{t, tf},
    platform::image_transcode::{
        self, DEFAULT_DISPLAY_MAX_PX, DecodeError, DecodedFrame, DecodedImage, ImageInput,
    },
    theme,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

const VIEWPORT_PADDING: f32 = 24.;
const MIN_ZOOM: f32 = 0.1;
const MAX_ZOOM: f32 = 16.0;
const ZOOM_STEPS: [f32; 14] = [
    0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0, 8.0, 16.0,
];

const ITEM_FIT: &str = "image-zoom-fit";
const ITEM_ACTUAL: &str = "image-zoom-actual";
const ITEM_ZOOM_IN: &str = "image-zoom-in";
const ITEM_ZOOM_OUT: &str = "image-zoom-out";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ZoomMode {
    Fit,
    Manual(f32),
}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let name = request.name.to_owned();
    let scale_factor = window.scale_factor();
    let view = cx.new(|cx| {
        let mut preview = ImagePreview::new(name, scale_factor, cx);
        preview.load(resource, cx);
        preview
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

struct AdmittedImage {
    mime: Option<String>,
    bytes: Vec<u8>,
    svg: bool,
}
fn source(resource: &PreviewResource, name: &str, cancel: &AtomicBool) -> Option<AdmittedImage> {
    if cancel.load(Ordering::Acquire) {
        return None;
    }
    let mime = match resource.data().ok()? {
        PreviewData::Bytes { mime, .. } => Some(mime.clone()),
        PreviewData::LocalFile(_) => None,
    };
    let format = crate::formats::resolve(Some(name), mime.as_deref());
    let svg = format.id == "svg";
    let bytes = resource.bytes(source_budget())?;
    resource.data().ok()?;
    if cancel.load(Ordering::Acquire) {
        return None;
    }
    Some(AdmittedImage { mime, bytes, svg })
}
fn decode_resource(
    resource: &PreviewResource,
    name: &str,
    target_px: u32,
    cancel: &AtomicBool,
) -> Result<DecodedMedia, DecodeError> {
    if cancel.load(Ordering::Acquire) {
        return Err(DecodeError::Failed("Image decoding was cancelled".into()));
    }
    let size = resource
        .reader()
        .map_err(|e| DecodeError::Failed(e.to_string()))?
        .len();
    if size > source_budget() {
        return Err(DecodeError::BudgetExceeded {
            size,
            limit: source_budget(),
        });
    }
    let input = source(resource, name, cancel)
        .ok_or_else(|| DecodeError::Failed("Image resource is unavailable".into()))?;
    let result = if input.svg {
        DecodedMedia::Bitmap(crate::platform::svg::decode_svg_for_viewer(
            &input.bytes,
            target_px,
        )?)
    } else {
        DecodedMedia::Bitmap(image_transcode::decode(
            ImageInput::Bytes {
                mime: input.mime.as_deref(),
                bytes: &input.bytes,
            },
            source_budget(),
            target_px,
        )?)
    };
    if cancel.load(Ordering::Acquire) || resource.data().is_err() {
        return Err(DecodeError::Failed("Image resource was retired".into()));
    }
    Ok(result)
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

    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        Some(self.view.read(cx).focus.clone())
    }

    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |v, _| v.name = name);
    }

    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        let resource = resource.clone();
        self.view.update(cx, |v, cx| v.load(Some(resource), cx));
    }

    fn view_state(&self, cx: &App) -> Option<SurfaceViewState> {
        let v = self.view.read(cx);
        let (mode, zoom) = match v.zoom {
            ZoomMode::Fit => ("fit", None),
            ZoomMode::Manual(z) => ("manual", Some(z)),
        };
        Some(SurfaceViewState {
            selection: None,
            scroll_x: v.pan.0.max(0.0),
            scroll_y: v.pan.1.max(0.0),
            mode: Some(mode.into()),
            zoom,
            folds: Vec::new(),
        })
    }

    fn restore_view_state(&self, state: &SurfaceViewState, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |v, cx| {
            if state.mode.as_deref() == Some("manual")
                && let Some(z) = state.zoom.filter(|z| z.is_finite() && *z > 0.)
            {
                v.set_zoom_manual(z, cx);
                let (px_x, px_y) = state.clamped_scroll(None, None);
                v.pan = (px_x, px_y);
                v.clamp_pan();
                cx.notify();
            } else {
                v.set_zoom_fit(cx);
            }
        });
    }

    fn pane(&self, cx: &App) -> PaneEntries {
        self.view.read(cx).pane_entries()
    }

    fn pane_item(&self, item: PaneItemId, _: &mut Window, cx: &mut App) {
        self.view
            .update(cx, |v, cx| v.run_pane_item(item.as_wire(), cx));
    }
}

struct Pending(Arc<AtomicBool>);
impl Drop for Pending {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}
#[cfg(test)]
pub(crate) fn decode_resource_for_tests(
    resource: &PreviewResource,
    name: &str,
    target_px: u32,
) -> Result<DecodedImage, DecodeError> {
    let DecodedMedia::Bitmap(decoded) =
        decode_resource(resource, name, target_px, &AtomicBool::new(false))?;
    Ok(decoded)
}

enum DecodedMedia {
    Bitmap(DecodedImage),
}
#[derive(Clone)]
enum LoadedMedia {
    Bitmap(Arc<RenderImage>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum FailureReason {
    Budget(u64),
    Unavailable,
}

pub struct ImagePreview {
    name: String,
    resource: Option<PreviewResource>,
    media: Option<LoadedMedia>,
    natural_size: (u32, u32),
    decoded_max_px: u32,
    pending_max_px: u32,
    loading: bool,
    failure: Option<FailureReason>,
    zoom: ZoomMode,
    pan: (f32, f32),
    drag_anchor: Option<(Point<Pixels>, (f32, f32))>,
    viewport: Size<Pixels>,
    scale_factor: f32,
    generation: u64,
    focus: FocusHandle,
    _task: Option<Task<()>>,
    pending: Option<Pending>,
}

impl EventEmitter<SurfaceEvent> for ImagePreview {}

impl Focusable for ImagePreview {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl ImagePreview {
    fn new(name: String, scale_factor: f32, cx: &mut Context<Self>) -> Self {
        cx.on_release(|view, cx| {
            view.pending = None;
            view._task = None;
            view.release_media(cx);
        })
        .detach();
        Self {
            name,
            resource: None,
            media: None,
            natural_size: (0, 0),
            decoded_max_px: 0,
            pending_max_px: 0,
            loading: false,
            failure: None,
            zoom: ZoomMode::Fit,
            pan: (0., 0.),
            drag_anchor: None,
            viewport: Size::default(),
            scale_factor: scale_factor.max(1.),
            generation: 0,
            focus: cx.focus_handle(),
            _task: None,
            pending: None,
        }
    }

    fn release_media(&mut self, cx: &mut App) {
        if let Some(LoadedMedia::Bitmap(img)) = self.media.take() {
            cx.drop_image(img, None);
        }
    }

    fn initial_target_px(&self) -> u32 {
        let vw = f32::from(self.viewport.width);
        let vh = f32::from(self.viewport.height);
        let max_side = vw.max(vh);
        if max_side > 64. {
            ((max_side * self.scale_factor).ceil() as u32).clamp(256, 4096)
        } else {
            DEFAULT_DISPLAY_MAX_PX
        }
    }

    fn load(&mut self, resource: Option<PreviewResource>, cx: &mut Context<Self>) {
        self.pending = None;
        self.release_media(cx);
        self.resource = resource;
        self.natural_size = (0, 0);
        self.decoded_max_px = 0;
        self.pending_max_px = 0;
        self.failure = None;
        self.zoom = ZoomMode::Fit;
        self.pan = (0., 0.);
        self.drag_anchor = None;
        self.generation += 1;
        self._task = None;

        let Some(resource) = self.resource.clone() else {
            self.loading = false;
            self.failure = Some(FailureReason::Unavailable);
            cx.emit(SurfaceEvent::Redraw);
            cx.notify();
            return;
        };

        let target_px = self.initial_target_px();
        self.spawn_decode(resource, target_px, cx);
    }

    fn spawn_decode(&mut self, resource: PreviewResource, target_px: u32, cx: &mut Context<Self>) {
        let name = self.name.clone();
        self.pending_max_px = target_px;
        self.start_load(cx, move |cancel| async move {
            decode_resource(&resource, &name, target_px, &cancel)
        });
    }
    fn start_load<F, Fut>(&mut self, cx: &mut Context<Self>, prepare: F)
    where
        F: FnOnce(Arc<AtomicBool>) -> Fut,
        Fut: std::future::Future<Output = Result<DecodedMedia, DecodeError>> + Send + 'static,
    {
        self.pending = None;
        self._task = None;
        self.generation += 1;
        let generation = self.generation;
        let cancel = Arc::new(AtomicBool::new(false));
        self.pending = Some(Pending(cancel.clone()));
        self.loading = true;
        let task = cx.background_spawn(prepare(cancel));
        self._task = Some(cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |v, cx| {
                if v.generation != generation {
                    return;
                }
                v.pending = None;
                v.pending_max_px = 0;
                v.loading = false;
                if v.resource.as_ref().is_none_or(|r| r.data().is_err()) {
                    v.release_media(cx);
                    v.failure = Some(FailureReason::Unavailable);
                } else {
                    match result {
                        Ok(DecodedMedia::Bitmap(decoded)) => v.apply_decoded(decoded, cx),
                        Err(DecodeError::BudgetExceeded { limit, .. }) => {
                            v.failure = Some(FailureReason::Budget(limit))
                        }
                        Err(DecodeError::Failed(_)) => v.failure = Some(FailureReason::Unavailable),
                    }
                }
                cx.emit(SurfaceEvent::Redraw);
                cx.notify();
            });
        }));
        cx.emit(SurfaceEvent::Redraw);
        cx.notify();
    }

    fn apply_decoded(&mut self, decoded: DecodedImage, cx: &mut Context<Self>) {
        let frames: Vec<image::Frame> = decoded
            .frames
            .into_iter()
            .filter_map(|f: DecodedFrame| {
                let buf = image::RgbaImage::from_raw(f.width, f.height, f.bgra)?;
                Some(image::Frame::from_parts(
                    buf,
                    0,
                    0,
                    image::Delay::from_numer_denom_ms(f.delay_ms.max(10), 1),
                ))
            })
            .collect();
        if frames.is_empty() {
            if self.media.is_none() {
                self.failure = Some(FailureReason::Unavailable);
            }
            return;
        }
        let render_img = Arc::new(RenderImage::new(frames));
        let prev = self.media.replace(LoadedMedia::Bitmap(render_img));
        if let Some(LoadedMedia::Bitmap(old)) = prev {
            cx.drop_image(old, None);
        }
        self.natural_size = (decoded.natural_width.max(1), decoded.natural_height.max(1));
        self.decoded_max_px = decoded.decoded_max_px;
        self.failure = None;
        self.clamp_pan();
    }

    fn retry(&mut self, cx: &mut Context<Self>) {
        cx.emit(SurfaceEvent::RetryInput);
    }

    fn available_viewport(&self) -> (f32, f32) {
        let vw = (f32::from(self.viewport.width) - 2. * VIEWPORT_PADDING).max(64.);
        let vh = (f32::from(self.viewport.height) - 2. * VIEWPORT_PADDING).max(64.);
        (vw, vh)
    }

    pub fn fit_zoom(&self) -> f32 {
        let (nw, nh) = self.natural_size;
        if nw == 0 || nh == 0 {
            return 1.0;
        }
        if f32::from(self.viewport.width) <= 1. || f32::from(self.viewport.height) <= 1. {
            return 1.0;
        }
        let (vw, vh) = self.available_viewport();
        (vw / nw as f32)
            .min(vh / nh as f32)
            .min(1.0)
            .clamp(MIN_ZOOM, MAX_ZOOM)
    }

    pub fn effective_zoom(&self) -> f32 {
        match self.zoom {
            ZoomMode::Fit => self.fit_zoom(),
            ZoomMode::Manual(z) => z.clamp(MIN_ZOOM, MAX_ZOOM),
        }
    }

    fn scaled_dimensions(&self) -> (f32, f32) {
        let z = self.effective_zoom();
        (
            (self.natural_size.0.max(1) as f32 * z).max(1.),
            (self.natural_size.1.max(1) as f32 * z).max(1.),
        )
    }

    fn max_pan(&self) -> (f32, f32) {
        if f32::from(self.viewport.width) <= 1. || f32::from(self.viewport.height) <= 1. {
            // Allow panning when zoomed > 1.0 even before first layout pass in headless tests.
            let (sw, sh) = self.scaled_dimensions();
            let (nw, nh) = (self.natural_size.0 as f32, self.natural_size.1 as f32);
            return (((sw - nw).max(0.)) * 0.5, ((sh - nh).max(0.)) * 0.5);
        }
        let (vw, vh) = self.available_viewport();
        let (sw, sh) = self.scaled_dimensions();
        (((sw - vw).max(0.)) * 0.5, ((sh - vh).max(0.)) * 0.5)
    }

    fn can_pan(&self) -> bool {
        let (mx, my) = self.max_pan();
        mx > 0.5 || my > 0.5
    }

    fn clamp_pan(&mut self) {
        let (mx, my) = self.max_pan();
        self.pan.0 = self.pan.0.clamp(-mx, mx);
        self.pan.1 = self.pan.1.clamp(-my, my);
    }

    fn maybe_redecode_for_zoom(&mut self, cx: &mut Context<Self>) {
        if !matches!(self.media, Some(LoadedMedia::Bitmap(_))) {
            return;
        }
        let (nw, nh) = self.natural_size;
        let natural_max = nw.max(nh);
        if natural_max == 0 || self.decoded_max_px >= natural_max {
            return;
        }
        let desired = ((natural_max as f32) * self.effective_zoom() * self.scale_factor)
            .ceil()
            .max(1.) as u32;
        let bucket = desired.next_power_of_two().max(desired);
        let clamped = image_transcode::clamp_decode_max_px(bucket, nw, nh);
        if clamped <= self.decoded_max_px || clamped <= self.pending_max_px {
            return;
        }
        let Some(resource) = self.resource.clone().filter(|r| r.data().is_ok()) else {
            return;
        };
        self.spawn_decode(resource, clamped, cx);
    }

    pub fn set_zoom_fit(&mut self, cx: &mut Context<Self>) {
        self.zoom = ZoomMode::Fit;
        self.pan = (0., 0.);
        self.drag_anchor = None;
        self.maybe_redecode_for_zoom(cx);
        cx.emit(SurfaceEvent::Redraw);
        cx.notify();
    }

    pub fn set_zoom_actual(&mut self, cx: &mut Context<Self>) {
        self.zoom = ZoomMode::Manual(1.0);
        self.clamp_pan();
        self.maybe_redecode_for_zoom(cx);
        cx.emit(SurfaceEvent::Redraw);
        cx.notify();
    }

    pub fn set_zoom_manual(&mut self, next: f32, cx: &mut Context<Self>) {
        let clamped = next.clamp(MIN_ZOOM, MAX_ZOOM);
        self.zoom = ZoomMode::Manual(clamped);
        self.clamp_pan();
        self.maybe_redecode_for_zoom(cx);
        cx.emit(SurfaceEvent::Redraw);
        cx.notify();
    }

    pub fn step_zoom(&mut self, direction: i32, cx: &mut Context<Self>) {
        let current = self.effective_zoom();
        let next = if direction > 0 {
            ZOOM_STEPS.iter().copied().find(|&z| z > current + 0.01)
        } else {
            ZOOM_STEPS
                .iter()
                .rev()
                .copied()
                .find(|&z| z < current - 0.01)
        };
        if let Some(next) = next {
            self.set_zoom_manual(next, cx);
        }
    }

    pub fn pan_by(&mut self, dx: f32, dy: f32, cx: &mut Context<Self>) {
        self.pan.0 += dx;
        self.pan.1 += dy;
        self.clamp_pan();
        cx.notify();
    }

    fn on_viewport_measured(
        &mut self,
        size: Size<Pixels>,
        scale_factor: f32,
        cx: &mut Context<Self>,
    ) {
        let scale = scale_factor.max(1.);
        if self.viewport == size && (self.scale_factor - scale).abs() < 0.01 {
            return;
        }
        self.viewport = size;
        self.scale_factor = scale;
        self.clamp_pan();
        self.maybe_redecode_for_zoom(cx);
        cx.notify();
    }

    fn pane_entries(&self) -> PaneEntries {
        let disabled = self.media.is_none();
        let current = self.effective_zoom();
        PaneEntries {
            segmented: None,
            toggles: vec![],
            items: vec![
                Item {
                    id: ITEM_FIT,
                    label: t("editor.markdown.mermaid.fit").into(),
                    kind: ItemKind::Command {
                        disabled: disabled || self.zoom == ZoomMode::Fit,
                    },
                },
                Item {
                    id: ITEM_ACTUAL,
                    label: "100%".into(),
                    kind: ItemKind::Command {
                        disabled: disabled || self.zoom == ZoomMode::Manual(1.0),
                    },
                },
                Item {
                    id: ITEM_ZOOM_IN,
                    label: t("editor.office.zoomIn").into(),
                    kind: ItemKind::Command {
                        disabled: disabled || current >= MAX_ZOOM - 0.01,
                    },
                },
                Item {
                    id: ITEM_ZOOM_OUT,
                    label: t("editor.office.zoomOut").into(),
                    kind: ItemKind::Command {
                        disabled: disabled || current <= MIN_ZOOM + 0.01,
                    },
                },
            ],
            find: false,
        }
    }

    fn run_pane_item(&mut self, id: &str, cx: &mut Context<Self>) {
        match id {
            ITEM_FIT => self.set_zoom_fit(cx),
            ITEM_ACTUAL => self.set_zoom_actual(cx),
            ITEM_ZOOM_IN => self.step_zoom(1, cx),
            ITEM_ZOOM_OUT => self.step_zoom(-1, cx),
            _ => {}
        }
    }

    fn on_wheel(&mut self, event: &ScrollWheelEvent, cx: &mut Context<Self>) {
        if self.media.is_none() {
            return;
        }
        let delta = event.delta.pixel_delta(px(20.));
        let dy = f32::from(delta.y);
        let dx = f32::from(delta.x);
        if event.modifiers.platform || event.modifiers.control || !self.can_pan() {
            if dy.abs() < 0.2 {
                return;
            }
            let factor = (1.0 + (dy * 0.004).clamp(-0.35, 0.35)).clamp(0.65, 1.35);
            let next = (self.effective_zoom() * factor).clamp(MIN_ZOOM, MAX_ZOOM);
            self.set_zoom_manual(next, cx);
        } else {
            self.pan_by(dx, dy, cx);
        }
    }

    fn render_controls(&self, p: theme::Theme, cx: &mut Context<Self>) -> AnyElement {
        let pct = (self.effective_zoom() * 100.).round() as u32;
        let btn = |id: &'static str, label: SharedString, active: bool| {
            let bg = if active { p.selected } else { p.control };
            let fg = if active { p.text } else { p.muted };
            let hover_bg = p.control_hover;
            let hover_fg = p.text;
            div()
                .id(id)
                .h(px(theme::control_tight()))
                .px(px(7.))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(4.))
                .bg(bg)
                .text_color(fg)
                .text_size(px(theme::ty().ui.caption))
                .cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
                .child(label)
        };
        div()
            .id("image-zoom-controls")
            .occlude()
            .absolute()
            .bottom(px(12.))
            .right(px(12.))
            .flex()
            .items_center()
            .gap(px(3.))
            .p(px(3.))
            .rounded(px(7.))
            .border_1()
            .border_color(p.border_subtle)
            .bg(theme::alpha(p.overlay, 0.92))
            .shadow(vec![theme::elevation_low(&p)])
            .child(
                btn("image-inline-zoom-out", "−".into(), false)
                    .on_click(cx.listener(|v, _, _, cx| v.step_zoom(-1, cx))),
            )
            .child(
                div()
                    .min_w(px(42.))
                    .px(px(4.))
                    .flex()
                    .justify_center()
                    .text_size(px(theme::ty().ui.caption))
                    .text_color(p.subtle)
                    .child(format!("{pct}%")),
            )
            .child(
                btn("image-inline-zoom-in", "+".into(), false)
                    .on_click(cx.listener(|v, _, _, cx| v.step_zoom(1, cx))),
            )
            .child(
                btn(
                    "image-inline-fit",
                    t("editor.markdown.mermaid.fit").into(),
                    self.zoom == ZoomMode::Fit,
                )
                .on_click(cx.listener(|v, _, _, cx| v.set_zoom_fit(cx))),
            )
            .child(
                btn(
                    "image-inline-actual",
                    "100%".into(),
                    self.zoom == ZoomMode::Manual(1.0),
                )
                .on_click(cx.listener(|v, _, _, cx| v.set_zoom_actual(cx))),
            )
            .into_any_element()
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
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let data = theme::ty().editor.data;
        let weak = cx.entity().downgrade();
        let scale_factor = window.scale_factor();
        let measure = canvas(
            move |bounds, _, cx| {
                let size = bounds.size;
                let _ = weak.update(cx, |this, cx| {
                    this.on_viewport_measured(size, scale_factor, cx);
                });
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();

        let note = move |text: String, color: Rgba| {
            div()
                .text_size(px(data))
                .text_color(color)
                .child(text)
                .into_any_element()
        };

        let unavailable_msg = tf(
            "editor.resource.unavailable",
            &[("kind", t("editor.resource.kind.image").into())],
        );

        let resource_valid = self.resource.as_ref().is_some_and(|r| r.data().is_ok());
        if !resource_valid {
            self.pending = None;
            self._task = None;
            self.generation += 1;
            self.loading = false;
            self.release_media(cx);
        }
        let view_weak = cx.weak_entity();

        let (content, show_controls): (AnyElement, bool) = if !resource_valid {
            (failure(unavailable_msg, view_weak, p), false)
        } else if let Some(reason) = &self.failure {
            let msg = match reason {
                FailureReason::Budget(limit) => tf(
                    "editor.unavailable.resourceLimit",
                    &[(
                        "limit",
                        crate::editor::registry::format_byte_limit(*limit).into(),
                    )],
                ),
                FailureReason::Unavailable => unavailable_msg,
            };
            (failure(msg, view_weak, p), false)
        } else if let Some(media) = self.media.clone() {
            let (sw, sh) = self.scaled_dimensions();
            let (pan_x, pan_y) = self.pan;
            let LoadedMedia::Bitmap(render_img) = media;
            let source = ImageSource::from(render_img);
            let img_el = img(source)
                .w(px(sw))
                .h(px(sh))
                .object_fit(ObjectFit::Fill)
                .rounded(px(6.))
                .with_loading(move || note(t("editor.preview.loading").into(), p.muted))
                .with_fallback(move || failure(unavailable_msg.clone(), view_weak.clone(), p));
            let stage = div()
                .flex_none()
                .w(px(sw))
                .h(px(sh))
                .ml(px(pan_x * 2.))
                .mt(px(pan_y * 2.))
                .child(img_el)
                .into_any_element();
            (stage, true)
        } else if self.loading {
            (note(t("editor.preview.loading").into(), p.muted), false)
        } else {
            (failure(unavailable_msg, view_weak, p), false)
        };

        let cursor = if self.drag_anchor.is_some() {
            CursorStyle::ClosedHand
        } else if self.can_pan() {
            CursorStyle::OpenHand
        } else {
            CursorStyle::Arrow
        };
        let controls = show_controls.then(|| self.render_controls(p, cx));

        div()
            .id("native-image-preview")
            .relative()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .p(px(VIEWPORT_PADDING))
            .bg(p.canvas)
            .cursor(cursor)
            .track_focus(&self.focus)
            .on_key_down(cx.listener(|v, event: &KeyDownEvent, _, cx| {
                if !(event.keystroke.modifiers.platform || event.keystroke.modifiers.control) {
                    return;
                }
                match event.keystroke.key.as_str() {
                    "=" | "+" => {
                        cx.stop_propagation();
                        v.step_zoom(1, cx);
                    }
                    "-" => {
                        cx.stop_propagation();
                        v.step_zoom(-1, cx);
                    }
                    "0" => {
                        cx.stop_propagation();
                        v.set_zoom_fit(cx);
                    }
                    "1" => {
                        cx.stop_propagation();
                        v.set_zoom_actual(cx);
                    }
                    _ => {}
                }
            }))
            .on_scroll_wheel(cx.listener(|v, event: &ScrollWheelEvent, _, cx| {
                v.on_wheel(event, cx);
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|v, event: &MouseDownEvent, window, cx| {
                    v.focus.focus(window, cx);
                    if v.can_pan() {
                        v.drag_anchor = Some((event.position, v.pan));
                        cx.notify();
                    }
                }),
            )
            .on_mouse_move(cx.listener(|v, event: &MouseMoveEvent, _, cx| {
                if let Some((start, origin_pan)) = v.drag_anchor {
                    if event.pressed_button != Some(MouseButton::Left) {
                        v.drag_anchor = None;
                        cx.notify();
                        return;
                    }
                    let dx = f32::from(event.position.x - start.x);
                    let dy = f32::from(event.position.y - start.y);
                    v.pan = (origin_pan.0 + dx, origin_pan.1 + dy);
                    v.clamp_pan();
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|v, _, _, cx| {
                    if v.drag_anchor.take().is_some() {
                        cx.notify();
                    }
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|v, _, _, cx| {
                    if v.drag_anchor.take().is_some() {
                        cx.notify();
                    }
                }),
            )
            .child(measure)
            .child(content)
            .children(controls)
    }
}

#[cfg(test)]
mod interaction_tests {
    use super::*;
    use core::prelude::v1::test;

    fn make_png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([40, 120, 210, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[gpui::test]
    fn image_decodes_at_display_size_supports_zoom_pan_and_redecodes_on_zoom(
        cx: &mut TestAppContext,
    ) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("big.png"), make_png(2400, 1600)).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("big.png")).unwrap();

        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut v = ImagePreview::new("big.png".into(), 1.0, cx);
            v.viewport = Size {
                width: px(448.),
                height: px(348.),
            };
            v.load(Some(resource), cx);
            v
        });

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while view.read_with(cx, |v, _| v.loading) {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let initial_decoded = view.read_with(cx, |v, _| {
            assert_eq!(v.natural_size, (2400, 1600));
            // Display-size decode: initially decoded for ~448px viewport, well below 2400px!
            assert!(v.decoded_max_px <= 512, "decoded={}", v.decoded_max_px);
            assert_eq!(v.zoom, ZoomMode::Fit);
            let entries = v.pane_entries();
            assert_eq!(entries.items.len(), 4);
            v.decoded_max_px
        });

        // Switch to ActualSize 100%: triggers higher-resolution re-decode and allows panning.
        view.update(cx, |v, cx| v.run_pane_item(ITEM_ACTUAL, cx));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while view.read_with(cx, |v, _| v.pending_max_px > 0) {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        view.update(cx, |v, cx| {
            assert_eq!(v.zoom, ZoomMode::Manual(1.0));
            assert!(
                v.decoded_max_px > initial_decoded,
                "expected higher-res redecode: {} > {}",
                v.decoded_max_px,
                initial_decoded
            );
            assert!(v.can_pan());
            v.pan_by(500., -300., cx);
            assert!(v.pan.0 > 0. && v.pan.1 < 0.);
            // Fit resets pan to (0, 0).
            v.run_pane_item(ITEM_FIT, cx);
            assert_eq!(v.pan, (0., 0.));
        });
    }
}

#[cfg(test)]
mod tests;
