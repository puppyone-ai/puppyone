//! `PdfViewer` (`viewers/pdf/PdfViewer.tsx`): bounded page bitmap cache
//! (`VW-10`), high-zoom viewport tile rendering (`VW-11`), and PDF text layer
//! with pointer selection/copy, host `FindBar` integration, clickable internal
//! & external links, and document outline jump items (`VW-12`).
use crate::{
    editor::{
        registry::{
            PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
        },
        workbench::{
            find::FindEvent,
            pane::{Item, ItemKind},
        },
    },
    localization::{t, tf},
    platform::pdf::{
        self, BookmarkItem, Failure, LinkTarget, PageLink, PageMetadata, PageRect, PageSize,
        PageText, Reply, TileRect,
    },
    theme,
    ui::{appearance::ActiveAppearance, loading::LoadingMark},
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, HashMap, HashSet},
    ops::RangeInclusive,
    rc::Rc,
    sync::Arc,
};

actions!(pdf_viewer, [ZoomIn, ZoomOut, ZoomReset]);
const CONTEXT: &str = "PdfViewer";
/// Points to CSS pixels at 100% (Chromium: 96 / 72).
const PX_PER_PT: f32 = 4. / 3.;
const PAGE_GAP: f32 = 8.;
const MARGIN: f32 = 16.;
const ZOOM_STEPS: [f32; 14] = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1., 1.1, 1.25, 1.5, 2., 3., 4.,
];

/// Strict resident BGRA bitmap budget across page and tile caches (`64 MiB`, `VW-10`).
pub const MAX_BITMAP_BYTES: usize = 64 * 1024 * 1024;
/// Retention window around the visible page range (`visible ± 2` pages, `VW-10`).
pub const PAGE_BUFFER_WINDOW: usize = 2;
/// Device-pixel grid step for high-zoom viewport tiles (`<= 2048 × 2048`, `VW-11`).
pub const TILE_GRID_PX: u32 = 1024;
/// Maximum number of tiles kept in the tile LRU before evicting oldest (`VW-11`).
const MAX_TILE_LRU: usize = 64;

const OUTLINE_PREFIX: &str = "pdf-outline-";

pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        cx.bind_keys([
            KeyBinding::new(&format!("{modifier}-="), ZoomIn, Some(CONTEXT)),
            KeyBinding::new(&format!("{modifier}-+"), ZoomIn, Some(CONTEXT)),
            KeyBinding::new(&format!("{modifier}--"), ZoomOut, Some(CONTEXT)),
            KeyBinding::new(&format!("{modifier}-0"), ZoomReset, Some(CONTEXT)),
        ]);
    }
}

fn intern_id(id: &str) -> &'static str {
    static IDS: std::sync::Mutex<Vec<&'static str>> = std::sync::Mutex::new(Vec::new());
    let mut ids = IDS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = ids.iter().find(|s| **s == id) {
        return existing;
    }
    let leaked: &'static str = Box::leak(id.to_owned().into_boxed_str());
    ids.push(leaked);
    leaked
}

#[derive(Clone, Debug)]
enum PdfEvent {
    Redraw,
    FindResult { current: usize, total: usize },
}

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let id = request.id.to_owned();
    let view = cx.new(|cx| {
        let mut view = PdfView::new(id, cx);
        view.load(resource, cx);
        view
    });
    Box::new(PdfSurface { view })
}

struct PdfSurface {
    view: Entity<PdfView>,
}

impl ViewerSurface for PdfSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }

    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(
            cx.subscribe(&self.view, move |_, ev: &PdfEvent, cx| match ev {
                PdfEvent::Redraw => events(SurfaceEvent::Redraw, cx),
                PdfEvent::FindResult { current, total } => events(
                    SurfaceEvent::FindResult {
                        current: *current,
                        total: *total,
                    },
                    cx,
                ),
            }),
        )
    }

    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        let resource = resource.clone();
        self.view.update(cx, |v, cx| v.load(Some(resource), cx));
    }

    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        Some(self.view.read(cx).focus.clone())
    }

    fn command(&self, name: &str, _: &mut Window, cx: &mut App) {
        if name == "copy" {
            self.view.update(cx, |v, cx| {
                v.copy_selection(cx);
            });
        }
    }

    fn pane(&self, cx: &App) -> PaneEntries {
        self.view.read(cx).pane_entries()
    }

    fn pane_item(&self, id: &'static str, _: &mut Window, cx: &mut App) {
        if id == "pdf-reload" {
            self.view.update(cx, |v, cx| v.reload(cx));
        } else if let Some(rest) = id.strip_prefix(OUTLINE_PREFIX)
            && let Ok(index) = rest.parse::<usize>()
        {
            self.view.update(cx, |v, cx| {
                if let Some(bm) = v.bookmarks.get(index).cloned() {
                    v.scroll_to_page(bm.page, cx);
                }
            });
        }
    }

    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        self.view
            .update(cx, |v, cx| v.handle_find(event, window, cx))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    Checking,
    Ready,
    Failed(Failure),
}

struct RenderedPage {
    generation: u64,
    width: u32,
    bytes: usize,
    last_used: u64,
    image: Arc<RenderImage>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct TileKey {
    page: usize,
    generation: u64,
    full_width: u32,
    full_height: u32,
    rect: TileRect,
}

struct RenderedTile {
    bytes: usize,
    last_used: u64,
    image: Arc<RenderImage>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TextCursor {
    pub page: usize,
    pub char_offset: usize,
}

#[derive(Clone, Debug, PartialEq)]
struct PdfMatch {
    page: usize,
    rects: Vec<PageRect>,
}

pub struct PdfView {
    id: String,
    resource: Option<PreviewResource>,
    document: Option<pdf::Document>,
    phase: Phase,
    sizes: Vec<PageSize>,
    bookmarks: Vec<BookmarkItem>,
    page_texts: BTreeMap<usize, PageText>,
    page_links: HashMap<usize, Vec<PageLink>>,
    pages: HashMap<usize, RenderedPage>,
    tiles: HashMap<TileKey, RenderedTile>,
    requested_pages: HashMap<usize, (u64, u32)>,
    requested_tiles: HashSet<TileKey>,
    retired_images: Vec<Arc<RenderImage>>,
    use_clock: u64,
    /// `None`: automatic (fit the width when wider than the pane, else 100%).
    zoom: Option<f32>,
    generation: u64,
    load: u64,
    scroll: ScrollHandle,
    scroll_y: f32,
    viewport: Rc<Cell<Size<Pixels>>>,
    page_bounds: Rc<RefCell<HashMap<usize, Bounds<Pixels>>>>,
    selection: Option<(TextCursor, TextCursor)>,
    dragging_selection: bool,
    find_query: String,
    matches: Vec<PdfMatch>,
    active_match: usize,
    focus: FocusHandle,
    _replies: Option<Task<()>>,
}

impl EventEmitter<PdfEvent> for PdfView {}

impl PdfView {
    fn new(id: String, cx: &mut Context<Self>) -> Self {
        Self {
            id,
            resource: None,
            document: None,
            phase: Phase::Checking,
            sizes: vec![],
            bookmarks: vec![],
            page_texts: BTreeMap::new(),
            page_links: HashMap::new(),
            pages: HashMap::new(),
            tiles: HashMap::new(),
            requested_pages: HashMap::new(),
            requested_tiles: HashSet::new(),
            retired_images: Vec::new(),
            use_clock: 0,
            zoom: None,
            generation: 0,
            load: 0,
            scroll: ScrollHandle::new(),
            scroll_y: 0.,
            viewport: Rc::new(Cell::new(Size::default())),
            page_bounds: Rc::default(),
            selection: None,
            dragging_selection: false,
            find_query: String::new(),
            matches: Vec::new(),
            active_match: 0,
            focus: cx.focus_handle(),
            _replies: None,
        }
    }

    fn next_tick(&mut self) -> u64 {
        self.use_clock = self.use_clock.saturating_add(1);
        self.use_clock
    }

    /// Total BGRA bytes currently resident across page and tile caches (`VW-10`, `VW-40`).
    pub fn resident_bitmap_bytes(&self) -> usize {
        let page_bytes: usize = self.pages.values().map(|p| p.bytes).sum();
        let tile_bytes: usize = self.tiles.values().map(|t| t.bytes).sum();
        page_bytes.saturating_add(tile_bytes)
    }

    fn flush_retired_images(&mut self, cx: &mut Context<Self>) {
        for img in self.retired_images.drain(..) {
            cx.drop_image(img, None);
        }
    }

    fn clear_all_bitmaps(&mut self, cx: &mut Context<Self>) {
        for (_, p) in self.pages.drain() {
            cx.drop_image(p.image, None);
        }
        for (_, t) in self.tiles.drain() {
            cx.drop_image(t.image, None);
        }
        self.flush_retired_images(cx);
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        let resource = self.resource.clone();
        self.load(resource, cx);
    }

    fn load(&mut self, resource: Option<PreviewResource>, cx: &mut Context<Self>) {
        self.clear_all_bitmaps(cx);
        self.resource = resource;
        self.document = None;
        self.sizes.clear();
        self.bookmarks.clear();
        self.page_texts.clear();
        self.page_links.clear();
        self.requested_pages.clear();
        self.requested_tiles.clear();
        self.page_bounds.borrow_mut().clear();
        self.selection = None;
        self.dragging_selection = false;
        self.matches.clear();
        self.active_match = 0;
        self.scroll_y = 0.;
        self.scroll.set_offset(point(px(0.), px(0.)));
        self.load += 1;
        self.generation += 1;

        let Some(resource) = self.resource.clone() else {
            self.phase = Phase::Failed(Failure::Resource);
            cx.emit(PdfEvent::Redraw);
            cx.notify();
            return;
        };
        let source = match resource.data() {
            Ok(PreviewData::LocalFile(path)) => pdf::Source::File(path.clone()),
            Ok(PreviewData::Bytes { bytes, .. }) => pdf::Source::Bytes(bytes.to_vec()),
            Err(_) => {
                self.phase = Phase::Failed(Failure::Resource);
                cx.emit(PdfEvent::Redraw);
                cx.notify();
                return;
            }
        };
        self.phase = Phase::Checking;
        let max_bytes = crate::editor::registry::source_budget("document.pdf");
        let (tx, rx) = async_channel::unbounded();
        let owner = crate::platform::tasks::Owner::new("pdf", self.id.clone(), self.load);
        self.document = Some(pdf::Document::open(source, max_bytes, owner, tx));
        let load = self.load;
        self._replies = Some(cx.spawn(async move |this, cx| {
            while let Ok(reply) = rx.recv().await {
                if this
                    .update(cx, |v, cx| {
                        if v.load == load {
                            v.receive(reply, cx)
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
        cx.emit(PdfEvent::Redraw);
        cx.notify();
    }

    pub(crate) fn receive(&mut self, reply: Reply, cx: &mut Context<Self>) {
        match reply {
            Reply::Opened { sizes, bookmarks } if self.phase == Phase::Checking => {
                self.sizes = sizes;
                self.bookmarks = bookmarks;
                self.phase = if self.sizes.is_empty() {
                    Phase::Failed(Failure::Resource)
                } else {
                    Phase::Ready
                };
                cx.emit(PdfEvent::Redraw);
            }
            Reply::Opened { .. } => {}
            Reply::Failed(failure) if self.phase == Phase::Checking => {
                self.phase = Phase::Failed(failure);
                self.document = None;
                cx.emit(PdfEvent::Redraw);
            }
            Reply::Failed(_) => {}
            Reply::Metadata(PageMetadata { page, text, links }) => {
                self.page_texts.insert(page, text);
                if !links.is_empty() {
                    self.page_links.insert(page, links);
                }
                if !self.find_query.is_empty() {
                    self.recompute_matches_preserving_active();
                    let total = self.matches.len();
                    let current = if total > 0 { self.active_match + 1 } else { 0 };
                    cx.emit(PdfEvent::FindResult { current, total });
                }
            }
            Reply::Page(bitmap) => {
                if bitmap.generation != self.generation {
                    return;
                }
                let retention = self.retain_window_range();
                if !retention.contains(&bitmap.page) {
                    return;
                }
                let byte_len = bitmap.bgra.len();
                if byte_len == 0 || byte_len > MAX_BITMAP_BYTES {
                    return;
                }
                let Some(buffer) =
                    image::RgbaImage::from_raw(bitmap.width, bitmap.height, bitmap.bgra)
                else {
                    return;
                };
                let tick = self.next_tick();
                let frame = image::Frame::new(buffer);
                // Replace & immediately drop any previous generation bitmap for this page (`VW-10`).
                if let Some(old) = self.pages.insert(
                    bitmap.page,
                    RenderedPage {
                        generation: bitmap.generation,
                        width: bitmap.width,
                        bytes: byte_len,
                        last_used: tick,
                        image: Arc::new(RenderImage::new(vec![frame])),
                    },
                ) {
                    cx.drop_image(old.image, None);
                }
                self.enforce_cache_budget();
                self.flush_retired_images(cx);
            }
            Reply::Tile(tile) => {
                if tile.generation != self.generation {
                    return;
                }
                let retention = self.retain_window_range();
                if !retention.contains(&tile.page) {
                    return;
                }
                let byte_len = tile.bgra.len();
                if byte_len == 0 || byte_len > MAX_BITMAP_BYTES {
                    return;
                }
                let Some(buffer) =
                    image::RgbaImage::from_raw(tile.rect.width, tile.rect.height, tile.bgra)
                else {
                    return;
                };
                let tick = self.next_tick();
                let key = TileKey {
                    page: tile.page,
                    generation: tile.generation,
                    full_width: tile.full_width,
                    full_height: tile.full_height,
                    rect: tile.rect,
                };
                let frame = image::Frame::new(buffer);
                if let Some(old) = self.tiles.insert(
                    key,
                    RenderedTile {
                        bytes: byte_len,
                        last_used: tick,
                        image: Arc::new(RenderImage::new(vec![frame])),
                    },
                ) {
                    cx.drop_image(old.image, None);
                }
                self.enforce_cache_budget();
                self.flush_retired_images(cx);
            }
        }
        cx.notify();
    }

    fn pane_entries(&self) -> PaneEntries {
        let mut items = vec![Item {
            id: "pdf-reload",
            label: t("editor.app.reload").into(),
            kind: ItemKind::Command {
                disabled: self.resource.is_none() || matches!(self.phase, Phase::Checking),
            },
        }];
        for (idx, bm) in self.bookmarks.iter().enumerate() {
            let indent = "  ".repeat(bm.depth.min(3));
            items.push(Item {
                id: intern_id(&format!("{OUTLINE_PREFIX}{idx}")),
                label: format!("{indent}{} (p. {})", bm.title, bm.page + 1).into(),
                kind: ItemKind::Command { disabled: false },
            });
        }
        PaneEntries {
            segmented: None,
            toggles: vec![],
            items,
            find: true,
        }
    }

    /// CSS pixels per point at the current zoom.
    fn scale(&self) -> f32 {
        let vw = f32::from(self.viewport.get().width);
        let available = if vw > 2. * MARGIN {
            vw - 2. * MARGIN
        } else {
            800.
        };
        let widest = self
            .sizes
            .iter()
            .map(|s| s.width)
            .fold(0., f32::max)
            .max(1.);
        match self.zoom {
            Some(zoom) => zoom * PX_PER_PT,
            None => (available / widest).min(PX_PER_PT),
        }
    }

    fn effective_zoom(&self) -> f32 {
        self.scale() / PX_PER_PT
    }

    fn is_tiled_page(&self, size: PageSize, scale: f32, scale_factor: f32) -> bool {
        let full_px_w = (size.width * scale * scale_factor.max(1.)).round().max(1.) as u32;
        full_px_w > pdf::MAX_TILE_PX || self.effective_zoom() > 2.0
    }

    fn step_zoom(&mut self, direction: i32, cx: &mut Context<Self>) {
        let current = self.effective_zoom();
        let next = if direction > 0 {
            ZOOM_STEPS.iter().copied().find(|z| *z > current + 0.001)
        } else {
            ZOOM_STEPS
                .iter()
                .rev()
                .copied()
                .find(|z| *z < current - 0.001)
        };
        if let Some(next) = next {
            self.set_zoom(Some(next), cx);
        }
    }

    pub fn set_zoom(&mut self, zoom: Option<f32>, cx: &mut Context<Self>) {
        let old_scale = self.scale().max(0.01);
        let old_scroll = self.current_scroll_top();
        let anchor = if old_scroll > 0. && !self.sizes.is_empty() {
            let p = *self.visible_page_range().start();
            let old_page_y = self.page_top_y(p, old_scale);
            let offset_pt = ((old_scroll - old_page_y) / old_scale).max(0.);
            Some((p, offset_pt))
        } else {
            None
        };
        self.zoom = zoom;
        let new_scale = self.scale().max(0.01);
        if let Some((p, offset_pt)) = anchor {
            let new_page_y = self.page_top_y(p, new_scale);
            let scaled_scroll = if offset_pt <= 0.001 && p > 0 {
                (new_page_y - PAGE_GAP * 0.5).max(0.)
            } else {
                (new_page_y + offset_pt * new_scale).max(0.)
            };
            self.scroll_y = scaled_scroll;
            self.scroll.set_offset(point(px(0.), px(-scaled_scroll)));
        }
        self.generation += 1;
        self.requested_pages.clear();
        self.requested_tiles.clear();
        // Keep current visible page bitmaps displayed until new generation arrives (`VW-10`),
        // while trimming anything outside the retention window or over budget.
        self.enforce_cache_budget();
        self.flush_retired_images(cx);
        cx.notify();
    }

    fn current_scroll_top(&self) -> f32 {
        let handle_y = -f32::from(self.scroll.offset().y);
        if handle_y.abs() > 0.5 {
            handle_y.max(0.)
        } else {
            self.scroll_y.max(0.)
        }
    }

    pub fn set_scroll_top(&mut self, y: f32, cx: &mut Context<Self>) {
        let clamped = y.max(0.);
        self.scroll_y = clamped;
        self.scroll.set_offset(point(px(0.), px(-clamped)));
        self.enforce_cache_budget();
        self.flush_retired_images(cx);
        cx.notify();
    }

    fn page_top_y(&self, target_page: usize, scale: f32) -> f32 {
        let mut y = MARGIN;
        for (i, sz) in self.sizes.iter().enumerate() {
            if i == target_page {
                break;
            }
            y += sz.height * scale + PAGE_GAP;
        }
        y
    }

    pub fn scroll_to_page(&mut self, page: usize, cx: &mut Context<Self>) {
        if self.sizes.is_empty() {
            return;
        }
        let target = page.min(self.sizes.len() - 1);
        let y = if target == 0 {
            0.
        } else {
            (self.page_top_y(target, self.scale()) - PAGE_GAP * 0.5).max(0.)
        };
        self.set_scroll_top(y, cx);
    }

    fn scroll_to_page_rect(&mut self, page: usize, rect: PageRect, cx: &mut Context<Self>) {
        let scale = self.scale();
        let page_y = self.page_top_y(page, scale);
        let target_y = page_y + rect.y * scale;
        let vh = f32::from(self.viewport.get().height).max(400.);
        let top = self.current_scroll_top();
        if target_y < top + 24. || target_y + rect.height * scale > top + vh - 24. {
            let min_page_top = if page == 0 {
                0.
            } else {
                (page_y - PAGE_GAP * 0.5).max(0.)
            };
            self.set_scroll_top((target_y - vh * 0.35).max(min_page_top), cx);
        }
    }

    /// Computes `[first_visible ..= last_visible]` intersecting the viewport.
    pub fn visible_page_range(&self) -> RangeInclusive<usize> {
        if self.sizes.is_empty() {
            return 0..=0;
        }
        let scale = self.scale();
        let top = self.current_scroll_top();
        let vh = f32::from(self.viewport.get().height);
        let height = if vh > 1. { vh } else { 600. };
        let bottom = top + height;

        let mut y = MARGIN;
        let mut first = None;
        let mut last = 0usize;
        for (idx, sz) in self.sizes.iter().enumerate() {
            let h = sz.height * scale;
            if y + h >= top && y <= bottom {
                if first.is_none() {
                    first = Some(idx);
                }
                last = idx;
            } else if y > bottom && first.is_some() {
                break;
            }
            y += h + PAGE_GAP;
        }
        match first {
            Some(f) => f..=last,
            None => {
                let last_idx = self.sizes.len() - 1;
                last_idx..=last_idx
            }
        }
    }

    /// Retention window: visible pages `± PAGE_BUFFER_WINDOW` (`± 2`, `VW-10`).
    pub fn retain_window_range(&self) -> RangeInclusive<usize> {
        if self.sizes.is_empty() {
            return 0..=0;
        }
        let vis = self.visible_page_range();
        let start = vis.start().saturating_sub(PAGE_BUFFER_WINDOW);
        let end = (*vis.end() + PAGE_BUFFER_WINDOW).min(self.sizes.len() - 1);
        start..=end
    }

    fn distance_from_visible(page: usize, vis: &RangeInclusive<usize>) -> usize {
        if page < *vis.start() {
            vis.start() - page
        } else if page > *vis.end() {
            page - vis.end()
        } else {
            0
        }
    }

    /// Enforces both the `visible ± 2` retention window and the strict
    /// `MAX_BITMAP_BYTES` (`64 MiB`) budget, queueing evicted `RenderImage`s
    /// for GPU texture release (`VW-10`, `VW-11`).
    fn enforce_cache_budget(&mut self) {
        if self.sizes.is_empty() {
            return;
        }
        let vis = self.visible_page_range();
        let keep = self.retain_window_range();

        // 1. Evict pages & tiles outside `visible ± 2`.
        let out_pages: Vec<usize> = self
            .pages
            .keys()
            .copied()
            .filter(|p| !keep.contains(p))
            .collect();
        for p in out_pages {
            if let Some(removed) = self.pages.remove(&p) {
                self.retired_images.push(removed.image);
            }
            self.requested_pages.remove(&p);
        }

        let out_tiles: Vec<TileKey> = self
            .tiles
            .keys()
            .copied()
            .filter(|k| !keep.contains(&k.page))
            .collect();
        for k in out_tiles {
            if let Some(removed) = self.tiles.remove(&k) {
                self.retired_images.push(removed.image);
            }
            self.requested_tiles.remove(&k);
        }

        // 2. Cap tile count LRU at `MAX_TILE_LRU`.
        while self.tiles.len() > MAX_TILE_LRU {
            let cur_gen = self.generation;
            let victim = self
                .tiles
                .iter()
                .min_by_key(|(k, v)| {
                    (
                        k.generation == cur_gen,
                        std::cmp::Reverse(Self::distance_from_visible(k.page, &vis)),
                        v.last_used,
                    )
                })
                .map(|(k, _)| *k);
            let Some(victim) = victim else { break };
            if let Some(removed) = self.tiles.remove(&victim) {
                self.retired_images.push(removed.image);
            }
        }

        // 3. Enforce strict `MAX_BITMAP_BYTES` across resident pages + tiles,
        //    evicting stale generations and pages farthest from `vis` first!
        while self.resident_bitmap_bytes() > MAX_BITMAP_BYTES
            && (self.pages.len() + self.tiles.len()) > 1
        {
            let cur_gen = self.generation;
            let best_page = self
                .pages
                .iter()
                .map(|(&p, entry)| {
                    (
                        entry.generation == cur_gen,
                        std::cmp::Reverse(Self::distance_from_visible(p, &vis)),
                        entry.last_used,
                        p,
                    )
                })
                .min();
            let best_tile = self
                .tiles
                .iter()
                .map(|(&k, entry)| {
                    (
                        k.generation == cur_gen,
                        std::cmp::Reverse(Self::distance_from_visible(k.page, &vis)),
                        entry.last_used,
                        k,
                    )
                })
                .min_by_key(|t| (t.0, t.1, t.2));

            match (best_page, best_tile) {
                (Some(bp), Some(bt)) => {
                    if (bp.0, bp.1, bp.2) <= (bt.0, bt.1, bt.2) {
                        if let Some(removed) = self.pages.remove(&bp.3) {
                            self.retired_images.push(removed.image);
                        }
                    } else if let Some(removed) = self.tiles.remove(&bt.3) {
                        self.retired_images.push(removed.image);
                    }
                }
                (Some(bp), None) => {
                    if let Some(removed) = self.pages.remove(&bp.3) {
                        self.retired_images.push(removed.image);
                    }
                }
                (None, Some(bt)) => {
                    if let Some(removed) = self.tiles.remove(&bt.3) {
                        self.retired_images.push(removed.image);
                    }
                }
                (None, None) => break,
            }
        }
    }

    /// Computes required high-zoom viewport tiles (plus 1-tile margin) in device pixels (`VW-11`).
    pub fn visible_tiles_for_page(
        &self,
        page: usize,
        page_y_css: f32,
        size: PageSize,
        scale: f32,
        scale_factor: f32,
    ) -> (u32, u32, Vec<TileRect>) {
        let sf = scale_factor.max(1.);
        let full_w = (size.width * scale * sf).round().max(1.) as u32;
        let full_h = (size.height * scale * sf).round().max(1.) as u32;
        let scroll_top = self.current_scroll_top();
        let scroll_left = (-f32::from(self.scroll.offset().x)).max(0.);
        let vp = self.viewport.get();
        let vw = if f32::from(vp.width) > 1. {
            f32::from(vp.width)
        } else {
            800.
        };
        let vh = if f32::from(vp.height) > 1. {
            f32::from(vp.height)
        } else {
            600.
        };

        let page_h_css = size.height * scale;
        let page_w_css = size.width * scale;
        let local_top_css = (scroll_top - page_y_css).clamp(0., page_h_css);
        let local_bottom_css = (scroll_top + vh - page_y_css).clamp(local_top_css, page_h_css);
        let local_left_css = scroll_left.clamp(0., page_w_css);
        let local_right_css = (scroll_left + vw).clamp(local_left_css, page_w_css);

        let margin = TILE_GRID_PX;
        let px_x0 = ((local_left_css * sf).floor().max(0.) as u32).saturating_sub(margin);
        let px_y0 = ((local_top_css * sf).floor().max(0.) as u32).saturating_sub(margin);
        let px_x1 = ((local_right_css * sf).ceil().max(1.) as u32)
            .saturating_add(margin)
            .min(full_w);
        let px_y1 = ((local_bottom_css * sf).ceil().max(1.) as u32)
            .saturating_add(margin)
            .min(full_h);

        let col_start = px_x0 / TILE_GRID_PX;
        let col_end = px_x1.saturating_sub(1) / TILE_GRID_PX;
        let row_start = px_y0 / TILE_GRID_PX;
        let row_end = px_y1.saturating_sub(1) / TILE_GRID_PX;

        let mut out = Vec::new();
        for row in row_start..=row_end {
            let y = row * TILE_GRID_PX;
            if y >= full_h {
                break;
            }
            let h = TILE_GRID_PX.min(full_h - y);
            for col in col_start..=col_end {
                let x = col * TILE_GRID_PX;
                if x >= full_w {
                    break;
                }
                let w = TILE_GRID_PX.min(full_w - x);
                out.push(TileRect {
                    x,
                    y,
                    width: w,
                    height: h,
                });
            }
        }
        let _ = page;
        (full_w, full_h, out)
    }

    /// Requests visible & buffer pages (or high-zoom viewport tiles) at device resolution.
    fn request_visible(&mut self, scale_factor: f32) {
        self.enforce_cache_budget();
        let sf = scale_factor.max(1.);
        let scale = self.scale();
        let keep = self.retain_window_range();
        let vis = self.visible_page_range();
        let generation = self.generation;

        let mut y = MARGIN;
        let mut page_requests = Vec::new();
        let mut tile_requests = Vec::new();
        let mut completed_tiled_pages = Vec::new();

        for index in 0..self.sizes.len() {
            let size = self.sizes[index];
            let h = size.height * scale;
            if keep.contains(&index) {
                if self.is_tiled_page(size, scale, sf) {
                    if vis.contains(&index) {
                        let (full_w, full_h, needed_tiles) =
                            self.visible_tiles_for_page(index, y, size, scale, sf);
                        let mut all_present = !needed_tiles.is_empty();
                        let tick = self.next_tick();
                        for rect in needed_tiles {
                            let key = TileKey {
                                page: index,
                                generation,
                                full_width: full_w,
                                full_height: full_h,
                                rect,
                            };
                            if let Some(existing) = self.tiles.get_mut(&key) {
                                existing.last_used = tick;
                            } else {
                                all_present = false;
                                if self.requested_tiles.insert(key) {
                                    tile_requests.push((index, full_w, full_h, rect));
                                }
                            }
                        }
                        if all_present {
                            completed_tiled_pages.push(index);
                        }
                    }
                } else {
                    let width = (size.width * scale * sf)
                        .round()
                        .clamp(1., pdf::MAX_TILE_PX as f32) as u32;
                    let fresh = if let Some(p) = self.pages.get_mut(&index) {
                        if p.generation == generation && p.width == width {
                            p.last_used = self.use_clock.saturating_add(1);
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    };
                    let pending = self.requested_pages.get(&index) == Some(&(generation, width));
                    if !fresh && !pending {
                        self.requested_pages.insert(index, (generation, width));
                        page_requests.push((index, width));
                    }
                }
            }
            y += h + PAGE_GAP;
        }

        // Once all high-zoom tiles for a visible page have arrived, drop any old full-page backdrop.
        for idx in completed_tiled_pages {
            if let Some(old) = self.pages.remove(&idx) {
                self.retired_images.push(old.image);
            }
        }

        if let Some(document) = self.document.as_ref() {
            for (index, width) in page_requests {
                document.render(index, width, generation);
            }
            for (index, fw, fh, rect) in tile_requests {
                document.render_tile(index, fw, fh, rect, generation);
            }
        }
    }

    // --- Text Layer: Search (`FindBar`) & Selection/Copy (`VW-12`) --------------

    fn slice_rects_in_page(
        page_text: &PageText,
        char_range: std::ops::Range<usize>,
    ) -> Vec<PageRect> {
        if char_range.start >= char_range.end || page_text.full_text.is_empty() {
            return Vec::new();
        }
        // Build char index -> byte index mapping on `full_text`.
        let mut char_to_byte: Vec<usize> =
            page_text.full_text.char_indices().map(|(b, _)| b).collect();
        char_to_byte.push(page_text.full_text.len());
        let total_chars = char_to_byte.len().saturating_sub(1);
        let c_start = char_range.start.min(total_chars);
        let c_end = char_range.end.min(total_chars);
        if c_start >= c_end {
            return Vec::new();
        }
        let b_start = char_to_byte[c_start];
        let b_end = char_to_byte[c_end];

        let mut rects = Vec::new();
        for run in &page_text.runs {
            let ov_start = b_start.max(run.byte_range.start);
            let ov_end = b_end.min(run.byte_range.end);
            if ov_start >= ov_end {
                continue;
            }
            let run_str = &page_text.full_text[run.byte_range.clone()];
            let run_chars = run_str.chars().count().max(1) as f32;
            let prefix_chars = page_text.full_text[run.byte_range.start..ov_start]
                .chars()
                .count() as f32;
            let span_chars = page_text.full_text[ov_start..ov_end].chars().count().max(1) as f32;
            rects.push(PageRect {
                x: run.rect.x + run.rect.width * (prefix_chars / run_chars),
                y: run.rect.y,
                width: (run.rect.width * (span_chars / run_chars)).max(1.5),
                height: run.rect.height.max(2.),
            });
        }
        rects
    }

    fn recompute_matches_preserving_active(&mut self) {
        let query_chars: Vec<char> = self
            .find_query
            .chars()
            .flat_map(char::to_lowercase)
            .collect();
        self.matches.clear();
        if query_chars.is_empty() {
            self.active_match = 0;
            return;
        }
        let q_len = query_chars.len();
        for (&page_idx, page_text) in &self.page_texts {
            // Map each lowered char back to its source char index in `page_text.full_text`.
            let mut lowered = Vec::new();
            let mut src_char_idx = Vec::new();
            for (ci, ch) in page_text.full_text.chars().enumerate() {
                for lc in ch.to_lowercase() {
                    lowered.push(lc);
                    src_char_idx.push(ci);
                }
            }
            if lowered.len() < q_len {
                continue;
            }
            let mut i = 0;
            while i + q_len <= lowered.len() {
                if lowered[i..i + q_len] == query_chars[..] {
                    let c0 = src_char_idx[i];
                    let c1 = src_char_idx[i + q_len - 1] + 1;
                    let mut rects = Self::slice_rects_in_page(page_text, c0..c1);
                    if rects.is_empty() {
                        rects.push(PageRect {
                            x: 0.,
                            y: 0.,
                            width: 24.,
                            height: 12.,
                        });
                    }
                    self.matches.push(PdfMatch {
                        page: page_idx,
                        rects,
                    });
                    i += q_len;
                } else {
                    i += 1;
                }
            }
        }
        if self.active_match >= self.matches.len() {
            self.active_match = 0;
        }
    }

    pub fn handle_find(
        &mut self,
        event: FindEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<(usize, usize)> {
        match event {
            FindEvent::Query(query) => {
                self.find_query = query;
                self.active_match = 0;
                self.recompute_matches_preserving_active();
                if let Some(first) = self.matches.first().cloned()
                    && let Some(&rect) = first.rects.first()
                {
                    self.scroll_to_page_rect(first.page, rect, cx);
                }
                cx.notify();
                let total = self.matches.len();
                Some((if total > 0 { 1 } else { 0 }, total))
            }
            FindEvent::Move { forward } => {
                let total = self.matches.len();
                if total == 0 {
                    return Some((0, 0));
                }
                self.active_match = if forward {
                    (self.active_match + 1) % total
                } else {
                    (self.active_match + total - 1) % total
                };
                if let Some(m) = self.matches.get(self.active_match).cloned()
                    && let Some(&rect) = m.rects.first()
                {
                    self.scroll_to_page_rect(m.page, rect, cx);
                }
                cx.notify();
                Some((self.active_match + 1, total))
            }
            FindEvent::Close => {
                self.find_query.clear();
                self.matches.clear();
                self.active_match = 0;
                self.focus.focus(window, cx);
                cx.notify();
                None
            }
        }
    }

    fn hit_test_text_cursor(&self, page: usize, pt_x: f32, pt_y: f32) -> Option<TextCursor> {
        let page_text = self.page_texts.get(&page)?;
        if page_text.runs.is_empty() {
            return None;
        }
        // Pick the containing run, or nearest run within 28 pt when dragging.
        let best = page_text.runs.iter().min_by(|a, b| {
            let dist = |r: &PageRect| {
                let dx = if pt_x < r.x {
                    r.x - pt_x
                } else if pt_x > r.x + r.width {
                    pt_x - (r.x + r.width)
                } else {
                    0.
                };
                let dy = if pt_y < r.y {
                    r.y - pt_y
                } else if pt_y > r.y + r.height {
                    pt_y - (r.y + r.height)
                } else {
                    0.
                };
                // Weight vertical distance higher so lines stay distinct.
                dy * 4. + dx
            };
            dist(&a.rect)
                .partial_cmp(&dist(&b.rect))
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
        let prefix_chars = page_text.full_text[..best.byte_range.start].chars().count();
        let run_chars = page_text.full_text[best.byte_range.clone()].chars().count();
        let ratio = if best.rect.width > 0.1 {
            ((pt_x - best.rect.x) / best.rect.width).clamp(0., 1.)
        } else {
            0.
        };
        let within = (ratio * run_chars as f32).round() as usize;
        Some(TextCursor {
            page,
            char_offset: prefix_chars + within.min(run_chars),
        })
    }

    pub fn begin_text_selection(
        &mut self,
        page: usize,
        pt_x: f32,
        pt_y: f32,
        cx: &mut Context<Self>,
    ) {
        if let Some(cursor) = self.hit_test_text_cursor(page, pt_x, pt_y) {
            self.selection = Some((cursor, cursor));
            self.dragging_selection = true;
            cx.notify();
        } else {
            self.selection = None;
            self.dragging_selection = false;
            cx.notify();
        }
    }

    pub fn update_text_selection(
        &mut self,
        page: usize,
        pt_x: f32,
        pt_y: f32,
        cx: &mut Context<Self>,
    ) {
        let Some((anchor, _)) = self.selection else {
            return;
        };
        if let Some(head) = self.hit_test_text_cursor(page, pt_x, pt_y) {
            self.selection = Some((anchor, head));
            cx.notify();
        }
    }

    fn ordered_selection(&self) -> Option<(TextCursor, TextCursor)> {
        let (a, b) = self.selection?;
        if a <= b {
            (a != b).then_some((a, b))
        } else {
            Some((b, a))
        }
    }

    pub fn selected_text(&self) -> Option<String> {
        let (start, end) = self.ordered_selection()?;
        let mut out = String::new();
        for p in start.page..=end.page {
            let Some(pt) = self.page_texts.get(&p) else {
                continue;
            };
            let chars: Vec<char> = pt.full_text.chars().collect();
            let from = if p == start.page {
                start.char_offset.min(chars.len())
            } else {
                0
            };
            let to = if p == end.page {
                end.char_offset.min(chars.len())
            } else {
                chars.len()
            };
            if from < to {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.extend(&chars[from..to]);
            }
        }
        (!out.is_empty()).then_some(out)
    }

    pub fn copy_selection(&self, cx: &mut Context<Self>) -> bool {
        let Some(text) = self.selected_text() else {
            return false;
        };
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        true
    }

    fn selection_rects_for_page(&self, page: usize) -> Vec<PageRect> {
        let Some((start, end)) = self.ordered_selection() else {
            return Vec::new();
        };
        if page < start.page || page > end.page {
            return Vec::new();
        }
        let Some(pt) = self.page_texts.get(&page) else {
            return Vec::new();
        };
        let total = pt.full_text.chars().count();
        let from = if page == start.page {
            start.char_offset.min(total)
        } else {
            0
        };
        let to = if page == end.page {
            end.char_offset.min(total)
        } else {
            total
        };
        Self::slice_rects_in_page(pt, from..to)
    }

    pub fn activate_link(&mut self, target: &LinkTarget, cx: &mut Context<Self>) {
        match target {
            LinkTarget::Page(page) => self.scroll_to_page(*page, cx),
            LinkTarget::ExternalUrl(url) => cx.open_url(url),
        }
    }

    fn window_point_to_page(&self, pos: Point<Pixels>, scale: f32) -> Option<(usize, f32, f32)> {
        let bounds_map = self.page_bounds.borrow();
        let (&best_page, &bounds) =
            bounds_map
                .iter()
                .find(|(_, b)| b.contains(&pos))
                .or_else(|| {
                    if !self.dragging_selection {
                        return None;
                    }
                    bounds_map.iter().min_by(|(_, a), (_, b)| {
                        let cy_a = f32::from(a.origin.y) + f32::from(a.size.height) * 0.5;
                        let cy_b = f32::from(b.origin.y) + f32::from(b.size.height) * 0.5;
                        (f32::from(pos.y) - cy_a)
                            .abs()
                            .partial_cmp(&(f32::from(pos.y) - cy_b).abs())
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                })?;
        let s = scale.max(0.01);
        let px_x = (f32::from(pos.x - bounds.origin.x) / s).max(0.);
        let px_y = (f32::from(pos.y - bounds.origin.y) / s).max(0.);
        Some((best_page, px_x, px_y))
    }

    fn failure(&self, failure: Failure, cx: &mut Context<Self>) -> AnyElement {
        let p = cx.palette();
        let message = match failure {
            Failure::Limit => tf(
                "editor.unavailable.resourceLimit",
                &[(
                    "limit",
                    format!(
                        "{} MiB",
                        crate::editor::registry::source_budget("a.pdf") / 1024 / 1024
                    )
                    .into(),
                )],
            ),
            Failure::Timeout => t("editor.pdf.timeout").to_owned(),
            Failure::Resource => tf(
                "editor.resource.unavailable",
                &[("kind", t("editor.resource.kind.pdf").into())],
            ),
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(7.))
            .p(px(24.))
            .bg(p.canvas)
            .text_size(px(theme::ty().ui.meta))
            .text_color(p.danger)
            .child(message)
            .child(
                div()
                    .id("pdf-retry")
                    .min_h(px(theme::control_tight()))
                    .px(px(8.))
                    .py(px(2.))
                    .flex()
                    .items_center()
                    .border_1()
                    .border_color(p.border_subtle)
                    .rounded(px(4.))
                    .bg(p.control)
                    .text_color(p.muted)
                    .hover(move |d| d.bg(p.control_hover).text_color(p.text))
                    .cursor(theme::clickable_cursor())
                    .child(t("common.action.retry"))
                    .on_click(cx.listener(|v, _, _, cx| v.reload(cx))),
            )
            .into_any_element()
    }
}

impl Focusable for PdfView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for PdfView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        let scale_factor = window.scale_factor().max(1.);
        let viewport = self.viewport.clone();
        let measure = canvas(
            move |bounds, _, _| viewport.set(bounds.size),
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();

        let body: AnyElement = match self.phase {
            Phase::Failed(failure) => return self.failure(failure, cx).into_any_element(),
            Phase::Checking => div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(8.))
                .bg(p.panel_raised)
                .text_size(px(theme::ty().ui.meta))
                .text_color(p.subtle)
                .child(LoadingMark::new("pdf-pending"))
                .child(t("editor.preview.loading"))
                .into_any_element(),
            Phase::Ready => {
                self.request_visible(scale_factor);
                let scale = self.scale();
                let keep = self.retain_window_range();
                self.page_bounds
                    .borrow_mut()
                    .retain(|idx, _| keep.contains(idx));

                let mut column = div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(PAGE_GAP))
                    .py(px(MARGIN))
                    .px(px(MARGIN))
                    .min_w_full();

                // Virtualize pages before `keep.start()` into one top spacer so 1,000-page
                // documents keep O(1) element count per frame (`VW-10`, `VW-40`).
                let start_idx = *keep.start();
                let end_idx = *keep.end();
                if start_idx > 0 {
                    let top_h: f32 = self.sizes[..start_idx]
                        .iter()
                        .map(|s| s.height * scale + PAGE_GAP)
                        .sum::<f32>()
                        - PAGE_GAP;
                    column = column.child(div().flex_none().w(px(1.)).h(px(top_h.max(0.))));
                }

                for index in start_idx..=end_idx.min(self.sizes.len().saturating_sub(1)) {
                    let size = self.sizes[index];
                    let (w, h) = (size.width * scale, size.height * scale);
                    let bounds_tracker = self.page_bounds.clone();
                    let page_measure = canvas(
                        move |bounds, _, _| {
                            bounds_tracker.borrow_mut().insert(index, bounds);
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full();

                    let mut page = div()
                        .id(("pdf-page", index))
                        .relative()
                        .flex_none()
                        .w(px(w))
                        .h(px(h))
                        .overflow_hidden()
                        .bg(theme::document_page::paper())
                        .shadow(vec![BoxShadow {
                            color: theme::document_page::shadow(),
                            offset: point(px(0.), px(1.)),
                            blur_radius: px(4.),
                            spread_radius: px(0.),
                            inset: false,
                        }])
                        .child(page_measure);

                    // Full-page bitmap (or old-generation backdrop while tiles arrive).
                    if let Some(rendered) = self.pages.get(&index) {
                        page = page.child(
                            img(ImageSource::from(rendered.image.clone()))
                                .w(px(w))
                                .h(px(h))
                                .object_fit(ObjectFit::Fill),
                        );
                    }

                    // High-zoom viewport tiles (`VW-11`).
                    if self.is_tiled_page(size, scale, scale_factor) {
                        let full_w = (size.width * scale * scale_factor).round().max(1.) as u32;
                        let full_h = (size.height * scale * scale_factor).round().max(1.) as u32;
                        for (key, tile) in &self.tiles {
                            if key.page == index
                                && key.generation == self.generation
                                && key.full_width == full_w
                                && key.full_height == full_h
                            {
                                page = page.child(
                                    img(ImageSource::from(tile.image.clone()))
                                        .absolute()
                                        .left(px(key.rect.x as f32 / scale_factor))
                                        .top(px(key.rect.y as f32 / scale_factor))
                                        .w(px(key.rect.width as f32 / scale_factor))
                                        .h(px(key.rect.height as f32 / scale_factor))
                                        .object_fit(ObjectFit::Fill),
                                );
                            }
                        }
                    }

                    // Search match highlights (`VW-12`).
                    for (m_idx, m) in self.matches.iter().enumerate() {
                        if m.page != index {
                            continue;
                        }
                        let is_active = m_idx == self.active_match;
                        let fill = if is_active {
                            theme::alpha(p.accent, 0.42)
                        } else {
                            theme::alpha(p.warning, 0.34)
                        };
                        for rect in &m.rects {
                            page = page.child(
                                div()
                                    .absolute()
                                    .left(px(rect.x * scale))
                                    .top(px(rect.y * scale))
                                    .w(px((rect.width * scale).max(2.)))
                                    .h(px((rect.height * scale).max(2.)))
                                    .rounded(px(2.))
                                    .bg(fill)
                                    .when(is_active, |d| d.border_1().border_color(p.accent)),
                            );
                        }
                    }

                    // Pointer text selection highlights (`VW-12`).
                    for rect in self.selection_rects_for_page(index) {
                        page = page.child(
                            div()
                                .absolute()
                                .left(px(rect.x * scale))
                                .top(px(rect.y * scale))
                                .w(px((rect.width * scale).max(2.)))
                                .h(px((rect.height * scale).max(2.)))
                                .bg(theme::alpha(p.selection, 0.55)),
                        );
                    }

                    // Clickable link hotspots (`VW-12`).
                    if let Some(links) = self.page_links.get(&index) {
                        for (l_idx, link) in links.iter().enumerate() {
                            let target = link.target.clone();
                            page = page.child(
                                div()
                                    .id(("pdf-link", index * 10_000 + l_idx))
                                    .absolute()
                                    .left(px(link.rect.x * scale))
                                    .top(px(link.rect.y * scale))
                                    .w(px((link.rect.width * scale).max(4.)))
                                    .h(px((link.rect.height * scale).max(4.)))
                                    .cursor(CursorStyle::PointingHand)
                                    .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                        cx.stop_propagation()
                                    })
                                    .on_click(cx.listener(move |v, _, _, cx| {
                                        v.activate_link(&target, cx);
                                    })),
                            );
                        }
                    }

                    column = column.child(page);
                }

                if end_idx + 1 < self.sizes.len() {
                    let bottom_h: f32 = self.sizes[end_idx + 1..]
                        .iter()
                        .map(|s| s.height * scale + PAGE_GAP)
                        .sum::<f32>()
                        - PAGE_GAP;
                    column = column.child(div().flex_none().w(px(1.)).h(px(bottom_h.max(0.))));
                }

                div()
                    .id("pdf-scroll")
                    .size_full()
                    .overflow_scroll()
                    .track_scroll(&self.scroll)
                    .bg(p.panel_raised)
                    .on_scroll_wheel(cx.listener(|v, _, _, cx| {
                        v.scroll_y = (-f32::from(v.scroll.offset().y)).max(0.);
                        v.enforce_cache_budget();
                        v.flush_retired_images(cx);
                        cx.notify();
                    }))
                    .child(column)
                    .child(crate::ui::scrollbar::both("pdf-scrollbar", &self.scroll))
                    .into_any_element()
            }
        };

        div()
            .id("pdf-preview-surface")
            .relative()
            .size_full()
            .overflow_hidden()
            .track_focus(&self.focus)
            .key_context(CONTEXT)
            .on_action(cx.listener(|v, _: &ZoomIn, _, cx| v.step_zoom(1, cx)))
            .on_action(cx.listener(|v, _: &ZoomOut, _, cx| v.step_zoom(-1, cx)))
            .on_action(cx.listener(|v, _: &ZoomReset, _, cx| v.set_zoom(None, cx)))
            .on_action(cx.listener(|v, _: &gpui_kit::base::input::Copy, _, cx| {
                v.copy_selection(cx);
            }))
            .on_key_down(cx.listener(|v, event: &KeyDownEvent, _, cx| {
                if (event.keystroke.modifiers.platform || event.keystroke.modifiers.control)
                    && event.keystroke.key.eq_ignore_ascii_case("c")
                    && v.copy_selection(cx)
                {
                    cx.stop_propagation();
                }
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|v, event: &MouseDownEvent, window, cx| {
                    v.focus.focus(window, cx);
                    let scale = v.scale();
                    if let Some((page, px_x, px_y)) = v.window_point_to_page(event.position, scale)
                    {
                        v.begin_text_selection(page, px_x, px_y, cx);
                    } else if v.selection.take().is_some() {
                        v.dragging_selection = false;
                        cx.notify();
                    }
                }),
            )
            .on_mouse_move(cx.listener(|v, event: &MouseMoveEvent, _, cx| {
                if !v.dragging_selection {
                    return;
                }
                if event.pressed_button != Some(MouseButton::Left) {
                    v.dragging_selection = false;
                    return;
                }
                let scale = v.scale();
                if let Some((page, px_x, px_y)) = v.window_point_to_page(event.position, scale) {
                    v.update_text_selection(page, px_x, px_y, cx);
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|v, _, _, _| {
                    v.dragging_selection = false;
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|v, _, _, _| {
                    v.dragging_selection = false;
                }),
            )
            .child(measure)
            .child(body)
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::pdf::{Bitmap, TextRun as PdfTextRun, TileBitmap};
    use core::prelude::v1::test;

    #[gpui::test]
    #[ignore = "requires PDFium; tools/verify-native-dependencies.py runs this explicitly"]
    fn a_pdf_opens_fits_the_pane_and_renders_its_page(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        assert!(
            pdf::library_path().is_some(),
            "PDFium missing: run tools/fetch-pdfium.py"
        );
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.pdf"), crate::platform::pdf::test_pdf()).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("a.pdf")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = PdfView::new("a.pdf".into(), cx);
            view.load(Some(resource), cx);
            view
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
            });
            if view.read_with(cx, |v, _| {
                v.phase == Phase::Ready && v.pages.contains_key(&0)
            }) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the page never rendered"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        view.read_with(cx, |v, _| {
            assert_eq!(v.sizes.len(), 1);
            assert!((v.effective_zoom() - 1.).abs() < 0.01 || v.effective_zoom() < 1.);
        });
        let before = view.read_with(cx, |v, _| v.generation);
        view.update(cx, |v, cx| v.step_zoom(1, cx));
        view.read_with(cx, |v, _| assert_eq!(v.generation, before + 1));
    }

    #[gpui::test]
    fn a_non_pdf_reports_the_resource_failure_with_retry(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.pdf"), b"not a pdf").unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(std::path::Path::new("a.pdf")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view = PdfView::new("a.pdf".into(), cx);
            view.load(Some(resource), cx);
            view
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while view.read_with(cx, |v, _| v.phase == Phase::Checking) {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        view.read_with(cx, |v, _| {
            assert_eq!(v.phase, Phase::Failed(Failure::Resource))
        });
    }

    /// `VW-10`, `VW-11` & `VW-40`: Continuous scrolling across `1,000` pages
    /// keeps resident bitmap bytes strictly `<= MAX_BITMAP_BYTES` (`64 MiB`),
    /// retains only `visible ± 2` pages, keeps old-generation bitmaps on zoom
    /// until the replacement arrives, and switches to `<= 2048px` viewport tiles
    /// when zoomed past `2.0`.
    #[gpui::test]
    fn scrolling_thousand_pages_bounds_bitmap_memory_and_high_zoom_uses_tiles(
        cx: &mut TestAppContext,
    ) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let v = PdfView::new("book-1000.pdf".into(), cx);
            v.viewport.set(Size {
                width: px(900.),
                height: px(800.),
            });
            v
        });

        let sizes = vec![
            PageSize {
                width: 612.,
                height: 792.,
            };
            1_000
        ];
        view.update(cx, |v, cx| {
            v.receive(
                Reply::Opened {
                    sizes,
                    bookmarks: vec![],
                },
                cx,
            );
        });

        // Each 800×1000 BGRA page bitmap is ~3.05 MiB: 1,000 pages would consume ~3.05 GiB!
        let (bw, bh) = (800u32, 1000u32);
        let single_page_bytes = (bw * bh * 4) as usize;
        for page in 0..1_000usize {
            view.update(cx, |v, cx| {
                v.scroll_to_page(page, cx);
                let generation = v.generation;
                v.receive(
                    Reply::Page(Bitmap {
                        page,
                        width: bw,
                        height: bh,
                        bgra: vec![200u8; single_page_bytes],
                        generation,
                    }),
                    cx,
                );
                let resident = v.resident_bitmap_bytes();
                assert!(
                    resident <= MAX_BITMAP_BYTES,
                    "page {page}: resident {resident} > {MAX_BITMAP_BYTES}"
                );
                let keep = v.retain_window_range();
                assert!(v.pages.keys().all(|k| keep.contains(k)));
            });
        }

        // Verify zoom transition (`VW-10`): old generation stays on page 999 until new arrives.
        let gen_before = view.read_with(cx, |v, _| v.generation);
        view.update(cx, |v, cx| v.set_zoom(Some(1.5), cx));
        view.read_with(cx, |v, _| {
            assert_eq!(v.pages.get(&999).unwrap().generation, gen_before);
        });
        view.update(cx, |v, cx| {
            let new_gen = v.generation;
            v.receive(
                Reply::Page(Bitmap {
                    page: 999,
                    width: 1200,
                    height: 1500,
                    bgra: vec![180u8; 1200 * 1500 * 4],
                    generation: new_gen,
                }),
                cx,
            );
            assert_eq!(v.pages.get(&999).unwrap().generation, new_gen);
            assert_eq!(v.pages.get(&999).unwrap().width, 1200);
            assert!(v.resident_bitmap_bytes() <= MAX_BITMAP_BYTES);
        });

        // High-zoom (`zoom = 3.0 > 2.0`, `VW-11`) computes viewport tiles <= 2048x2048.
        view.update(cx, |v, cx| {
            v.set_zoom(Some(3.0), cx);
            let scale = v.scale();
            let sz = v.sizes[999];
            assert!(v.is_tiled_page(sz, scale, 2.0));
            let y = v.page_top_y(999, scale);
            let (fw, fh, tiles) = v.visible_tiles_for_page(999, y, sz, scale, 2.0);
            assert!(fw > pdf::MAX_TILE_PX);
            assert!(!tiles.is_empty());
            for tr in &tiles {
                assert!(tr.width <= pdf::MAX_TILE_PX && tr.height <= pdf::MAX_TILE_PX);
            }
            let cur_gen = v.generation;
            let first_tile = tiles[0];
            v.receive(
                Reply::Tile(TileBitmap {
                    page: 999,
                    full_width: fw,
                    full_height: fh,
                    rect: first_tile,
                    bgra: vec![255u8; (first_tile.width * first_tile.height * 4) as usize],
                    generation: cur_gen,
                }),
                cx,
            );
            assert_eq!(v.tiles.len(), 1);
            assert!(v.resident_bitmap_bytes() <= MAX_BITMAP_BYTES);
        });
    }

    /// `VW-12`: Text selection + copy, host `FindBar` across evicted pages,
    /// internal/external links, and document outline jump items.
    #[gpui::test]
    fn text_layer_supports_find_selection_copy_links_and_outline(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let v = PdfView::new("spec.pdf".into(), cx);
            v.viewport.set(Size {
                width: px(800.),
                height: px(600.),
            });
            v
        });
        let surface = PdfSurface { view: view.clone() };

        let sizes = vec![
            PageSize {
                width: 600.,
                height: 800.,
            };
            5
        ];
        let bookmarks = vec![
            BookmarkItem {
                title: "Introduction".into(),
                page: 0,
                depth: 0,
            },
            BookmarkItem {
                title: "Architecture".into(),
                page: 3,
                depth: 1,
            },
        ];

        view.update(cx, |v, cx| {
            v.receive(Reply::Opened { sizes, bookmarks }, cx);
            v.receive(
                Reply::Metadata(PageMetadata {
                    page: 0,
                    text: PageText {
                        page: 0,
                        full_text: "Hello Rust PDF Viewer".into(),
                        runs: vec![PdfTextRun {
                            byte_range: 0..21,
                            rect: PageRect {
                                x: 40.,
                                y: 60.,
                                width: 210.,
                                height: 14.,
                            },
                        }],
                    },
                    links: vec![
                        PageLink {
                            rect: PageRect {
                                x: 40.,
                                y: 100.,
                                width: 80.,
                                height: 16.,
                            },
                            target: LinkTarget::Page(4),
                        },
                        PageLink {
                            rect: PageRect {
                                x: 140.,
                                y: 100.,
                                width: 100.,
                                height: 16.,
                            },
                            target: LinkTarget::ExternalUrl("https://puppyone.ai/docs".into()),
                        },
                    ],
                }),
                cx,
            );
            // Page 4 has NO resident bitmap in `v.pages`, yet Find searches it!
            v.receive(
                Reply::Metadata(PageMetadata {
                    page: 4,
                    text: PageText {
                        page: 4,
                        full_text: "Deep Rust Chapter".into(),
                        runs: vec![PdfTextRun {
                            byte_range: 0..17,
                            rect: PageRect {
                                x: 40.,
                                y: 120.,
                                width: 170.,
                                height: 14.,
                            },
                        }],
                    },
                    links: vec![],
                }),
                cx,
            );
        });

        // 1. Outline items & `find: true` in `PaneEntries`.
        let entries = cx.update(|_, cx| surface.pane(cx));
        assert!(entries.find);
        assert_eq!(entries.items.len(), 3); // Reload + 2 bookmarks
        cx.update(|w, cx| surface.pane_item("pdf-outline-1", w, cx));
        assert_eq!(
            *view.read_with(cx, |v, _| v.visible_page_range()).start(),
            3
        );

        // 2. Host `FindBar` searches all pages even without bitmaps (`VW-12`).
        let res = cx.update(|w, cx| surface.find(FindEvent::Query("rust".into()), w, cx));
        assert_eq!(res, Some((1, 2)));
        let next = cx.update(|w, cx| surface.find(FindEvent::Move { forward: true }, w, cx));
        assert_eq!(next, Some((2, 2)));
        assert_eq!(
            *view.read_with(cx, |v, _| v.visible_page_range()).start(),
            4
        );
        assert_eq!(
            cx.update(|w, cx| surface.find(FindEvent::Close, w, cx)),
            None
        );

        // 3. Drag text selection + Copy (`⌘C` / `copy_selection`).
        view.update(cx, |v, cx| {
            // "Hello Rust PDF Viewer" at x=40..250 (10 pt per char): x=100..140 -> "Rust"
            v.begin_text_selection(0, 100., 66., cx);
            v.update_text_selection(0, 140., 66., cx);
            assert_eq!(v.selected_text().as_deref(), Some("Rust"));
            assert!(v.copy_selection(cx));
        });
        assert_eq!(
            cx.read_from_clipboard().and_then(|c| c.text()),
            Some("Rust".into())
        );

        // 4. Internal & external links.
        view.update(cx, |v, cx| {
            v.scroll_to_page(0, cx);
            let links = v.page_links.get(&0).unwrap().clone();
            v.activate_link(&links[0].target, cx);
            assert_eq!(*v.visible_page_range().start(), 4);
            v.activate_link(&links[1].target, cx);
        });
        assert_eq!(cx.opened_url().as_deref(), Some("https://puppyone.ai/docs"));
    }
}
