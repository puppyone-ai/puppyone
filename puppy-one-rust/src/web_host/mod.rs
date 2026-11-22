//! Cross-platform embedded web content host (`embedded-web-content.md`).
//!
//! Owns the OS-agnostic per-window LRU WebView pool (`MAX_LIVE_WEBVIEWS_PER_WINDOW`,
//! `VW-20`), overlay/cutout occlusion reconciliation, frame placement, and PNG
//! crop/stitch utilities. All OS-specific WebView bindings live under
//! [`backend`].
mod backend;

use crate::platform::webview::Content;
use backend::NativeBackend;
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    rc::{Rc, Weak},
};

/// Maximum live child WebViews kept resident per window (`VW-20`).
pub const MAX_LIVE_WEBVIEWS_PER_WINDOW: usize = 6;

/// Floating surfaces cut out of a view, in its own coordinates
/// (`x, y, w, h, radius`), and the size they were cut from.
#[derive(Default, PartialEq)]
struct Cut {
    holes: Vec<[f32; 5]>,
    size: (f32, f32),
}

enum HostEngine {
    Native(Box<NativeBackend>),
    #[cfg(any(test, feature = "test-support"))]
    Headless {
        scripts: RefCell<Vec<String>>,
    },
}

/// Shared visibility state of one live engine (main thread only).
struct HostState {
    window: u64,
    painted: Cell<bool>,
    engine: HostEngine,
    visible: Cell<bool>,
    bounds: Cell<(f32, f32, f32, f32)>,
    cutouts: RefCell<Cut>,
}

/// Per-frame LRU handle wrapping an evictable `HostState`.
struct HostSlot {
    window: u64,
    pinned: Cell<bool>,
    last_used: Cell<u64>,
    rendered_frame: Cell<u64>,
    state: RefCell<Option<Rc<HostState>>>,
}

impl HostSlot {
    fn is_alive(&self) -> bool {
        self.state.borrow().is_some()
    }

    fn is_visible(&self) -> bool {
        self.state
            .borrow()
            .as_ref()
            .is_some_and(|s| s.visible.get())
    }

    fn is_painted(&self) -> bool {
        self.state
            .borrow()
            .as_ref()
            .is_some_and(|s| s.painted.get())
    }

    fn evict(&self) {
        let taken = self.state.borrow_mut().take();
        if let Some(state) = &taken
            && let HostEngine::Native(native) = &state.engine
        {
            native.yield_focus_to_window();
        }
        drop(taken);
    }
}

impl HostState {
    fn showing(&self) -> (f32, f32, f32, f32) {
        let fallback = self.bounds.get();
        match &self.engine {
            HostEngine::Native(native) => native.showing_rect(fallback),
            #[cfg(any(test, feature = "test-support"))]
            HostEngine::Headless { .. } => fallback,
        }
    }

    /// Cuts `cutouts` (window coordinates) out of the view where they cross it.
    /// Returns `false` if a cutout covers the whole view or the platform cannot
    /// mask intersecting holes (causing the host to hide while covered).
    fn cut(&self, cutouts: &[crate::ui::native_cover::Cutout]) -> bool {
        let (x, y, w, h) = self.showing();
        if cutouts.iter().any(|c| covers(c, (x, y, w, h))) {
            return false;
        }
        let local: Vec<[f32; 5]> = cutouts
            .iter()
            .filter_map(|c| {
                let cx = f32::from(c.bounds.origin.x).max(x);
                let cy = f32::from(c.bounds.origin.y).max(y);
                let right = f32::from(c.bounds.origin.x + c.bounds.size.width).min(x + w);
                let bottom = f32::from(c.bounds.origin.y + c.bounds.size.height).min(y + h);
                (right - cx >= 1. && bottom - cy >= 1.).then(|| {
                    [
                        f32::from(c.bounds.origin.x) - x,
                        f32::from(c.bounds.origin.y) - y,
                        f32::from(c.bounds.size.width),
                        f32::from(c.bounds.size.height),
                        c.radius,
                    ]
                })
            })
            .collect();
        let mut applied = self.cutouts.borrow_mut();
        if applied.holes == local && (local.is_empty() || applied.size == (w, h)) {
            return match &self.engine {
                HostEngine::Native(native) => native.apply_cutouts(&applied.holes, applied.size),
                #[cfg(any(test, feature = "test-support"))]
                HostEngine::Headless { .. } => local.is_empty(),
            };
        }
        *applied = Cut {
            holes: local,
            size: (w, h),
        };
        match &self.engine {
            HostEngine::Native(native) => native.apply_cutouts(&applied.holes, applied.size),
            #[cfg(any(test, feature = "test-support"))]
            HostEngine::Headless { .. } => applied.holes.is_empty(),
        }
    }

    fn set_visible(&self, show: bool) {
        match &self.engine {
            HostEngine::Native(native) => native.set_visible(show),
            #[cfg(any(test, feature = "test-support"))]
            HostEngine::Headless { .. } => {
                let _ = show;
            }
        }
    }
}

/// Whether `cutout` lies over the whole of the window rectangle `(x, y, w, h)`.
fn covers(cutout: &crate::ui::native_cover::Cutout, (x, y, w, h): (f32, f32, f32, f32)) -> bool {
    let b = cutout.bounds;
    f32::from(b.origin.x) <= x + 0.5
        && f32::from(b.origin.y) <= y + 0.5
        && f32::from(b.origin.x + b.size.width) >= x + w - 0.5
        && f32::from(b.origin.y + b.size.height) >= y + h - 0.5
}

/// Whether `(x, y)` (from the top-left) lies in one of `holes` (`x, y, w, h`).
#[allow(dead_code)]
pub(crate) fn in_holes(holes: &[[f32; 4]], x: f32, y: f32) -> bool {
    holes
        .iter()
        .any(|&[hx, hy, hw, hh]| x >= hx && x < hx + hw && y >= hy && y < hy + hh)
}

thread_local! {
    static HOSTS: RefCell<Vec<Weak<HostState>>> = const { RefCell::new(Vec::new()) };
    static SLOTS: RefCell<Vec<Weak<HostSlot>>> = const { RefCell::new(Vec::new()) };
    static USE_CLOCK: Cell<u64> = const { Cell::new(0) };
    static WINDOW_SEQ: RefCell<HashMap<u64, u64>> = RefCell::new(Default::default());
    static PAINTED_IN_SEQ: RefCell<HashSet<u64>> = RefCell::new(Default::default());
    static OVERLAY: RefCell<HashMap<u64, bool>> = RefCell::new(Default::default());
    static SCHEDULED: RefCell<HashSet<u64>> = RefCell::new(Default::default());
}

fn next_use_tick() -> u64 {
    USE_CLOCK.with(|c| {
        let next = c.get().saturating_add(1);
        c.set(next);
        next
    })
}

fn begin_render_for_window(key: u64) -> u64 {
    let painted_prev = PAINTED_IN_SEQ.with(|p| p.borrow_mut().remove(&key));
    if painted_prev {
        reconcile(key);
    }
    current_window_seq(key)
}

fn current_window_seq(key: u64) -> u64 {
    WINDOW_SEQ.with(|m| *m.borrow_mut().entry(key).or_insert(1))
}

fn bump_window_seq(key: u64) {
    WINDOW_SEQ.with(|m| {
        let mut map = m.borrow_mut();
        let entry = map.entry(key).or_insert(1);
        *entry = entry.saturating_add(1);
    });
}

fn window_key(window: &gpui::Window) -> u64 {
    window.window_handle().window_id().as_u64()
}

/// Number of currently live `WebHost` instances in `window`.
pub fn live_host_count(window: &gpui::Window) -> usize {
    live_host_count_for_key(window_key(window))
}

fn live_host_count_for_key(key: u64) -> usize {
    SLOTS.with(|slots| {
        slots.borrow_mut().retain(|w| w.strong_count() > 0);
        slots
            .borrow()
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|slot| slot.window == key && slot.is_alive())
            .count()
    })
}

/// Evicts hidden, unpinned `WebHost`s in `key` (oldest `last_used` first) until
/// live hosts are below `MAX_LIVE_WEBVIEWS_PER_WINDOW` (`VW-20`).
fn enforce_window_cap(key: u64) {
    let cur_seq = current_window_seq(key);
    loop {
        let candidate = SLOTS.with(|slots| {
            slots.borrow_mut().retain(|w| w.strong_count() > 0);
            let live: Vec<Rc<HostSlot>> = slots
                .borrow()
                .iter()
                .filter_map(Weak::upgrade)
                .filter(|s| s.window == key && s.is_alive())
                .collect();
            if live.len() < MAX_LIVE_WEBVIEWS_PER_WINDOW {
                return None;
            }
            live.iter()
                .filter(|s| !s.pinned.get() && !s.is_visible() && s.rendered_frame.get() < cur_seq)
                .min_by_key(|s| s.last_used.get())
                .cloned()
                .or_else(|| {
                    live.iter()
                        .filter(|s| !s.pinned.get() && s.rendered_frame.get() < cur_seq)
                        .min_by_key(|s| s.last_used.get())
                        .cloned()
                })
                .or_else(|| {
                    live.iter()
                        .filter(|s| !s.pinned.get() && !s.is_visible() && !s.is_painted())
                        .min_by_key(|s| s.last_used.get())
                        .cloned()
                })
        });
        match candidate {
            Some(victim) => victim.evict(),
            None => break,
        }
    }
}

/// A WebView handle managed by the per-window LRU cap. Dropping it destroys
/// the native view if still resident.
pub struct WebHost {
    slot: Rc<HostSlot>,
}

impl Drop for WebHost {
    fn drop(&mut self) {
        self.slot.evict();
    }
}

impl WebHost {
    #[cfg(feature = "dev-capture")]
    #[allow(dead_code)]
    fn native(&self) -> std::cell::Ref<'_, backend::NativeBackend> {
        std::cell::Ref::map(self.slot.state.borrow(), |state| {
            match &state.as_ref().expect("resident native probe").engine {
                HostEngine::Native(native) => native.as_ref(),
                #[cfg(any(test, feature = "test-support"))]
                HostEngine::Headless { .. } => panic!("native probe cannot use a headless engine"),
            }
        })
    }

    /// Creates a standalone WebView hidden (e.g. `render_service`, inline embeds);
    /// it shows once its element paints and is not part of `WebFrame`'s LRU pool.
    pub fn new(window: &gpui::Window, content: Content, dark: bool) -> Result<Self, String> {
        Self::new_child(window, window_key(window), content, dark)
    }

    pub(crate) fn new_child(
        window: &impl raw_window_handle::HasWindowHandle,
        key: u64,
        content: Content,
        dark: bool,
    ) -> Result<Self, String> {
        let engine = HostEngine::Native(Box::new(NativeBackend::build(window, content, dark)?));
        let state = Rc::new(HostState {
            window: key,
            painted: Cell::new(false),
            engine,
            visible: Cell::new(false),
            bounds: Cell::new((0., 0., 0., 0.)),
            cutouts: RefCell::new(Cut::default()),
        });
        HOSTS.with(|h| h.borrow_mut().push(Rc::downgrade(&state)));
        let slot = Rc::new(HostSlot {
            window: key,
            pinned: Cell::new(true),
            last_used: Cell::new(next_use_tick()),
            rendered_frame: Cell::new(current_window_seq(key)),
            state: RefCell::new(Some(state)),
        });
        Ok(Self { slot })
    }

    /// Creates a `WebFrame`-managed WebView subject to the per-window LRU cap
    /// (`MAX_LIVE_WEBVIEWS_PER_WINDOW`, `VW-20`).
    pub fn new_managed(
        window: &gpui::Window,
        content: Content,
        dark: bool,
        pinned: bool,
    ) -> Result<Self, String> {
        let key = window_key(window);
        let seq = begin_render_for_window(key);
        enforce_window_cap(key);

        let engine = if NativeBackend::is_supported() {
            match NativeBackend::build(window, content, dark) {
                Ok(view) => HostEngine::Native(Box::new(view)),
                #[cfg(any(test, feature = "test-support"))]
                Err(_) => HostEngine::Headless {
                    scripts: RefCell::new(Vec::new()),
                },
                #[cfg(not(any(test, feature = "test-support")))]
                Err(error) => return Err(error),
            }
        } else {
            #[cfg(any(test, feature = "test-support"))]
            {
                let _ = (content, dark);
                HostEngine::Headless {
                    scripts: RefCell::new(Vec::new()),
                }
            }
            #[cfg(not(any(test, feature = "test-support")))]
            {
                return Err(NativeBackend::build(window, content, dark)
                    .err()
                    .unwrap_or_else(|| {
                        crate::localization::t("native.web.embeddedUnavailable").to_owned()
                    }));
            }
        };

        let state = Rc::new(HostState {
            window: key,
            painted: Cell::new(false),
            engine,
            visible: Cell::new(false),
            bounds: Cell::new((0., 0., 0., 0.)),
            cutouts: RefCell::new(Cut::default()),
        });
        HOSTS.with(|h| h.borrow_mut().push(Rc::downgrade(&state)));
        let slot = Rc::new(HostSlot {
            window: key,
            pinned: Cell::new(pinned),
            last_used: Cell::new(next_use_tick()),
            rendered_frame: Cell::new(seq),
            state: RefCell::new(Some(state)),
        });
        SLOTS.with(|s| s.borrow_mut().push(Rc::downgrade(&slot)));
        Ok(Self { slot })
    }

    pub fn is_alive(&self) -> bool {
        self.slot.is_alive()
    }

    pub fn set_pinned(&self, pinned: bool) {
        self.slot.pinned.set(pinned);
    }

    pub fn is_pinned(&self) -> bool {
        self.slot.pinned.get()
    }

    /// Marks this host as actively rendered during `window`'s current frame.
    pub fn mark_rendered(&self, window: &gpui::Window) {
        if self.slot.is_alive() {
            let seq = begin_render_for_window(window_key(window));
            self.slot.rendered_frame.set(seq);
            self.slot.last_used.set(next_use_tick());
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn evaluated_scripts(&self) -> Vec<String> {
        let borrow = self.slot.state.borrow();
        let Some(state) = borrow.as_ref() else {
            return Vec::new();
        };
        match &state.engine {
            HostEngine::Native(_) => Vec::new(),
            HostEngine::Headless { scripts } => scripts.borrow().clone(),
        }
    }

    /// Called from the element's paint: place the view over `bounds`.
    pub fn place(&self, bounds: gpui::Bounds<gpui::Pixels>) {
        let Some(state) = self.slot.state.borrow().clone() else {
            return;
        };
        self.slot.last_used.set(next_use_tick());
        let rect = (
            f32::from(bounds.origin.x),
            f32::from(bounds.origin.y),
            f32::from(bounds.size.width).max(1.),
            f32::from(bounds.size.height).max(1.),
        );
        state.painted.set(true);
        state.bounds.set(rect);
        PAINTED_IN_SEQ.with(|p| {
            p.borrow_mut().insert(state.window);
        });
        #[allow(irrefutable_let_patterns)]
        if let HostEngine::Native(native) = &state.engine {
            native.place(rect);
        }
    }

    /// Called from the element's paint inside scrolling content.
    pub fn place_clipped(
        &self,
        bounds: gpui::Bounds<gpui::Pixels>,
        clip: gpui::Bounds<gpui::Pixels>,
        radius: f32,
    ) {
        let visible = bounds.intersect(&clip);
        if f32::from(visible.size.width) < 1. || f32::from(visible.size.height) < 1. {
            return;
        }
        let Some(state) = self.slot.state.borrow().clone() else {
            return;
        };
        self.slot.last_used.set(next_use_tick());
        state.painted.set(true);
        PAINTED_IN_SEQ.with(|p| {
            p.borrow_mut().insert(state.window);
        });
        let to_rect = |b: gpui::Bounds<gpui::Pixels>| {
            (
                f32::from(b.origin.x),
                f32::from(b.origin.y),
                f32::from(b.size.width),
                f32::from(b.size.height),
            )
        };
        let bounds_rect = to_rect(bounds);
        let visible_rect = to_rect(visible);
        state.bounds.set(bounds_rect);
        #[allow(irrefutable_let_patterns)]
        if let HostEngine::Native(native) = &state.engine {
            native.place_clipped(
                bounds_rect,
                visible_rect,
                if visible == bounds { radius } else { 0. },
            );
        }
    }

    /// Whether the view showed after the window's last drawn frame.
    pub fn is_visible(&self) -> bool {
        self.slot.is_visible()
    }

    pub fn reload(&self) {
        if let Some(state) = self.slot.state.borrow().as_ref()
            && let HostEngine::Native(native) = &state.engine
        {
            native.reload();
        }
    }

    pub fn resize_hidden(&self, width: f32, height: f32) {
        if let Some(state) = self.slot.state.borrow().as_ref()
            && let HostEngine::Native(native) = &state.engine
        {
            native.resize_hidden(width, height);
        }
    }

    pub fn snapshot(
        &self,
        rect: (f32, f32, f32, f32),
        width: f32,
        done: impl FnOnce(Option<Vec<u8>>) + 'static,
    ) {
        let Some(state) = self.slot.state.borrow().clone() else {
            done(None);
            return;
        };
        match &state.engine {
            HostEngine::Native(native) => native.snapshot(rect, width, Box::new(done)),
            #[cfg(any(test, feature = "test-support"))]
            HostEngine::Headless { .. } => done(None),
        }
    }

    pub fn evaluate(&self, script: &str) {
        let borrow = self.slot.state.borrow();
        let Some(state) = borrow.as_ref() else {
            return;
        };
        match &state.engine {
            HostEngine::Native(native) => native.evaluate(script),
            #[cfg(any(test, feature = "test-support"))]
            HostEngine::Headless { scripts } => scripts.borrow_mut().push(script.to_owned()),
        }
    }

    pub fn has_native_capture(&self) -> bool {
        self.slot
            .state
            .borrow()
            .as_ref()
            .is_some_and(|s| match &s.engine {
                HostEngine::Native(native) => native.has_native_capture(),
                #[cfg(any(test, feature = "test-support"))]
                HostEngine::Headless { .. } => false,
            })
    }

    /// Captures the live WebView viewport as PNG bytes on the main thread.
    pub fn capture_png(
        &self,
        crop: Option<(f32, f32, f32, f32)>,
        viewport: Option<(f32, f32)>,
        done: impl FnOnce(Option<Vec<u8>>) + 'static,
    ) {
        let Some(state) = self.slot.state.borrow().clone() else {
            done(None);
            return;
        };
        match &state.engine {
            HostEngine::Native(native) => native.capture_png(crop, viewport, Box::new(done)),
            #[cfg(any(test, feature = "test-support"))]
            HostEngine::Headless { .. } => done(None),
        }
    }
}

/// Shell overlays (menus, dialogs) over this window hide its web content.
pub fn set_overlay(window: &gpui::Window, open: bool) {
    OVERLAY.with(|o| o.borrow_mut().insert(window_key(window), open));
}

/// Called once per drawn frame by the window's shell: after the frame, hosts
/// that painted show, the rest hide, and the frame sequence advances.
pub fn frame_drawn(window: &mut gpui::Window) {
    let key = window_key(window);
    let any = HOSTS.with(|h| {
        h.borrow_mut().retain(|w| w.strong_count() > 0);
        h.borrow()
            .iter()
            .filter_map(Weak::upgrade)
            .any(|s| s.window == key)
    });
    if !any {
        return;
    }
    let first = SCHEDULED.with(|s| s.borrow_mut().insert(key));
    if first {
        crate::ui::native_cover::take(key);
        window.on_next_frame(move |_, _| {
            SCHEDULED.with(|s| s.borrow_mut().remove(&key));
            reconcile(key);
        });
    }
}

fn reconcile(key: u64) {
    PAINTED_IN_SEQ.with(|p| {
        p.borrow_mut().remove(&key);
    });
    let overlay = OVERLAY.with(|o| o.borrow().get(&key).copied().unwrap_or(false));
    let cutouts = crate::ui::native_cover::take(key);
    HOSTS.with(|h| {
        for state in h.borrow().iter().filter_map(Weak::upgrade) {
            if state.window != key {
                continue;
            }
            let show = state.painted.replace(false) && !overlay && state.cut(&cutouts);
            if state.visible.get() != show {
                state.visible.set(show);
                state.set_visible(show);
            }
        }
    });
    bump_window_seq(key);
}

/// Crops `png` to logical CSS rectangle `crop` `(x, y, w, h)` within `viewport` `(vw, vh)`,
/// preserving Retina backing-store resolution.
pub fn crop_png_bytes(
    png: &[u8],
    crop: (f32, f32, f32, f32),
    viewport: (f32, f32),
) -> Option<Vec<u8>> {
    let decoded = image::load_from_memory(png).ok()?;
    let (img_w, img_h) = (decoded.width(), decoded.height());
    if img_w == 0 || img_h == 0 {
        return None;
    }
    let scale_x = img_w as f32 / viewport.0.max(1.);
    let scale_y = img_h as f32 / viewport.1.max(1.);
    let x = (crop.0.max(0.) * scale_x).round() as u32;
    let y = (crop.1.max(0.) * scale_y).round() as u32;
    if x >= img_w || y >= img_h {
        return None;
    }
    let w = ((crop.2.max(1.) * scale_x).round() as u32)
        .max(1)
        .min(img_w - x);
    let h = ((crop.3.max(1.) * scale_y).round() as u32)
        .max(1)
        .min(img_h - y);
    let sub = decoded.crop_imm(x, y, w, h);
    let mut out = std::io::Cursor::new(Vec::new());
    sub.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// Vertically stitches viewport PNG slices `(scroll_y, png_bytes)` into one
/// full-page Retina PNG of `total_logical_h` over `viewport_h`.
pub fn stitch_png_slices(
    slices: &[(f32, Vec<u8>)],
    total_logical_h: f32,
    viewport_h: f32,
) -> Option<Vec<u8>> {
    let first = image::load_from_memory(&slices.first()?.1).ok()?.to_rgba8();
    let (slice_w, slice_h) = (first.width(), first.height());
    if slice_w == 0 || slice_h == 0 {
        return None;
    }
    if slices.len() == 1 && total_logical_h <= viewport_h + 1. {
        return Some(slices[0].1.clone());
    }
    let scale_y = slice_h as f32 / viewport_h.max(1.);
    let out_h = ((total_logical_h.max(viewport_h) * scale_y).round() as u32)
        .max(slice_h)
        .min(slice_h.saturating_mul(8));
    let mut canvas = image::RgbaImage::new(slice_w, out_h);
    for (scroll_y, raw) in slices {
        let Ok(img) = image::load_from_memory(raw) else {
            continue;
        };
        let rgba = img.to_rgba8();
        let dest_y = ((*scroll_y).max(0.) * scale_y).round() as u32;
        for py in 0..rgba.height() {
            let cy = dest_y.saturating_add(py);
            if cy >= out_h {
                break;
            }
            for px in 0..rgba.width().min(slice_w) {
                canvas.put_pixel(px, cy, *rgba.get_pixel(px, py));
            }
        }
    }
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(canvas)
        .write_to(&mut out, image::ImageFormat::Png)
        .ok()?;
    Some(out.into_inner())
}

#[cfg(feature = "dev-capture")]
pub struct Snapshot {
    pub bounds: (f32, f32, f32, f32),
    pub png: Rc<RefCell<Option<Option<Vec<u8>>>>>,
}

#[cfg(feature = "dev-capture")]
pub fn snapshots(window: &gpui::Window) -> Vec<Snapshot> {
    let key = window_key(window);
    let states: Vec<Rc<HostState>> = HOSTS.with(|h| {
        h.borrow()
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|s| s.window == key && s.visible.get())
            .collect()
    });
    states
        .into_iter()
        .filter_map(|state| {
            #[allow(irrefutable_let_patterns)]
            let HostEngine::Native(native) = &state.engine else {
                return None;
            };
            if !native.has_native_capture() {
                return None;
            }
            let png: Rc<RefCell<Option<Option<Vec<u8>>>>> = Rc::default();
            let slot = png.clone();
            native.capture_png(
                None,
                None,
                Box::new(move |bytes| {
                    *slot.borrow_mut() = Some(bytes);
                }),
            );
            Some(Snapshot {
                bounds: state.bounds.get(),
                png,
            })
        })
        .collect()
}

/// Runs the isolated native WebKit acceptance executable (macOS).
#[cfg(feature = "dev-capture")]
pub fn run_stream_probe() {
    backend::run_stream_probe();
}

/// Runs the installed whiteboard in the production native host and IPC channel (macOS).
#[cfg(feature = "dev-capture")]
pub fn run_whiteboard_probe(root: &std::path::Path) {
    backend::run_whiteboard_probe(root);
}

/// Runs the bundled Context Map, PuppyFlow, and HTML preview pages in WebKit (macOS).
#[cfg(feature = "dev-capture")]
pub fn run_document_pages_probe() {
    backend::run_document_pages_probe();
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn sample_png(w: u32, h: u32, r: u8, g: u8, b: u8) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([r, g, b, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn crop_and_stitch_preserve_retina_scale() {
        let retina = sample_png(800, 600, 69, 153, 223);
        let cropped = crop_png_bytes(&retina, (50., 40., 120., 80.), (400., 300.)).unwrap();
        let decoded = image::load_from_memory(&cropped).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (240, 160));

        let top = sample_png(400, 300, 20, 30, 40);
        let bottom = sample_png(400, 300, 200, 100, 50);
        let stitched = stitch_png_slices(&[(0., top), (150., bottom)], 450., 300.).unwrap();
        let full = image::load_from_memory(&stitched).unwrap().to_rgba8();
        assert_eq!((full.width(), full.height()), (400, 450));
        assert_eq!(full.get_pixel(10, 10).0, [20, 30, 40, 255]);
        assert_eq!(full.get_pixel(10, 440).0, [200, 100, 50, 255]);
    }

    #[test]
    fn only_a_shape_over_the_whole_view_covers_it() {
        use crate::ui::native_cover::Cutout;
        let shape = |x: f32, y: f32, w: f32, h: f32| Cutout {
            bounds: gpui::Bounds::new(
                gpui::point(gpui::px(x), gpui::px(y)),
                gpui::size(gpui::px(w), gpui::px(h)),
            ),
            radius: 0.,
        };
        let view = (300., 40., 700., 760.);
        assert!(covers(&shape(0., 0., 1280., 800.), view));
        assert!(covers(&shape(300.2, 40., 699.9, 760.), view));
        assert!(!covers(&shape(320., 60., 224., 300.), view));
        assert!(!covers(&shape(0., 40., 1280., 700.), view));
    }

    #[test]
    fn the_pointer_passes_through_only_the_holes() {
        let holes = [[20., 10., 224., 300.], [400., 0., 40., 40.]];
        assert!(in_holes(&holes, 20., 10.));
        assert!(in_holes(&holes, 100., 200.));
        assert!(in_holes(&holes, 439., 39.));
        assert!(!in_holes(&holes, 244., 100.));
        assert!(!in_holes(&holes, 100., 310.));
        assert!(!in_holes(&[], 100., 100.));
    }

    #[test]
    fn webview2_and_wkwebview_origins_both_satisfy_protocol_and_ipc_checks() {
        use crate::platform::webview::{
            Ipc, is_entry_navigation_url, is_entry_url, is_protocol_url,
        };
        assert!(is_entry_url("puppyone-preview://local/__entry__"));
        assert!(is_entry_url("http://puppyone-preview.local/__entry__"));
        assert!(!is_entry_url(
            "http://puppyone-preview.local.evil.com/__entry__"
        ));
        assert!(!is_entry_url("https://puppyone-preview.local/__entry__"));

        assert!(is_entry_navigation_url(
            "http://puppyone-preview.local/__entry__#section-1"
        ));
        assert!(is_protocol_url(
            "http://puppyone-preview.local/assets/app.js"
        ));
        assert!(!is_protocol_url("http://puppyone-preview.local.evil.com/x"));

        let (tx, rx) = async_channel::bounded(2);
        let ipc = Ipc(tx);
        assert!(ipc.accept("http://puppyone-preview.local/__entry__", "ok".into()));
        assert!(!ipc.accept("https://attacker.example/__entry__", "bad".into()));
        assert_eq!(rx.try_recv().ok().as_deref(), Some("ok"));
    }
}
