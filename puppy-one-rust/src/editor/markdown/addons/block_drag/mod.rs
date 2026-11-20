//! Markdown block-drag add-on (`TA-60`, `TODO-27`, `TODO-88`, `R8`
//! `ADDON_CORE_PORTS`):
//! - Mounted as a [`ViewPlugin`] from `src/editor/markdown/mod.rs` so
//!   `src/editor/view/` contains zero Markdown block-drag state or logic.
//! - Imports ONLY narrow core ports (`core::commands::block_move`,
//!   `core::syntax::block_boundaries`).
//! - Enforces `layout.revision == state.revision` + `state.doc.clamp_range`,
//!   cancels active drags on `Escape`, focus loss, or concurrent document
//!   edits, and auto-scrolls when dragging near the viewport's top/bottom
//!   edges (`TODO-88`).
use crate::editor::{
    markdown::core::{
        commands::block_move::{self, Movable},
        syntax::block_boundaries::{BlockBoundaries, BoundaryProvider},
    },
    text::{
        buffer::Buffer,
        state::{Applied, EditorState, Transaction},
    },
    view::{
        EditorView, SelectDocEnd, SelectDocStart,
        layout::DocLayout,
        plugins::{PluginDropOutcome, PluginPointerCx, PluginPointerOutcome, ViewPlugin},
    },
};
use gpui::{prelude::*, *};
use std::{any::Any, ops::Range};

actions!(markdown_block_drag, [MoveBlockUp, MoveBlockDown]);

pub const KEY_CONTEXT: &str = "MarkdownBlockDrag";

const HANDLE_WIDTH: f32 = 18.;
const HANDLE_HEIGHT: f32 = 24.;
const HANDLE_GAP: f32 = 4.;
const SOURCE_BLEED: f32 = 4.;
const EDGE_SCROLL_ZONE: f32 = 36.;
const EDGE_SCROLL_MAX_STEP: f32 = 18.;

pub struct BlockDragAddon {
    provider: BoundaryProvider,
    cached: Option<(u64, BlockBoundaries)>,
    hover: Option<Movable>,
    dragging: Option<(Movable, Option<usize>)>,
}

impl BlockDragAddon {
    pub fn new(provider: BoundaryProvider) -> Self {
        Self {
            provider,
            cached: None,
            hover: None,
            dragging: None,
        }
    }

    pub fn install(provider: BoundaryProvider) -> Box<dyn ViewPlugin> {
        Box::new(Self::new(provider))
    }

    fn boundaries_for(&mut self, doc: &Buffer, revision: u64) -> &BlockBoundaries {
        let needs_refresh = self.cached.as_ref().is_none_or(|(rev, _)| *rev != revision);
        if needs_refresh {
            let b = (self.provider)(doc, revision);
            self.cached = Some((revision, b));
        }
        &self.cached.as_ref().expect("boundaries cached").1
    }

    fn move_keyboard(
        &mut self,
        view_state: &EditorState,
        read_only: bool,
        up: bool,
    ) -> Option<Transaction> {
        if read_only || !block_move::enabled() {
            return None;
        }
        let boundaries = self
            .boundaries_for(&view_state.doc, view_state.revision)
            .clone();
        if !boundaries.live {
            return None;
        }
        block_move::move_by_keyboard_boundaries(view_state, &boundaries, up)
    }

    #[cfg(test)]
    pub fn is_dragging(&self) -> bool {
        self.dragging.is_some()
    }

    #[cfg(test)]
    pub fn begin_drag_for_tests(
        &mut self,
        doc: &Buffer,
        revision: u64,
        offset: usize,
        boundary: usize,
    ) -> bool {
        let boundaries = self.boundaries_for(doc, revision).clone();
        if !boundaries.live || !block_move::enabled() {
            return false;
        }
        let Some(movable) = block_move::movable_at_boundaries(doc, &boundaries, doc.clamp(offset))
        else {
            return false;
        };
        let b = (!block_move::is_noop(movable.index, boundary)).then_some(boundary);
        self.dragging = Some((movable, b));
        true
    }

    #[cfg(test)]
    pub fn finish_drag_for_tests(
        &mut self,
        state: &EditorState,
        read_only: bool,
    ) -> Option<Transaction> {
        let (movable, boundary) = self.dragging.take()?;
        self.hover = None;
        if read_only || !block_move::enabled() {
            return None;
        }
        let mut tr = block_move::move_block_boundaries(state, &movable, boundary?)?;
        tr.scroll_into_view = false;
        Some(tr)
    }
}

fn block_top(layout: &DocLayout, doc: &Buffer, range: &Range<usize>) -> Option<Pixels> {
    let clamped = doc.clamp_range(range.clone());
    layout
        .blocks
        .iter()
        .find(|b| b.source.start <= clamped.start && clamped.start <= b.source.end)
        .map(|b| b.bounds.top())
}

fn block_bottom(layout: &DocLayout, doc: &Buffer, range: &Range<usize>) -> Option<Pixels> {
    let clamped = doc.clamp_range(range.clone());
    layout
        .blocks
        .iter()
        .find(|b| b.source.start <= clamped.end && clamped.end <= b.source.end)
        .map(|b| b.bounds.bottom())
}

fn rail(layout: &DocLayout) -> Option<(Pixels, Pixels)> {
    let b = layout.blocks.first()?;
    Some((b.bounds.left(), b.bounds.right()))
}

fn compute_edge_scroll_delta(pointer_y: f32, bounds_top: f32, bounds_bottom: f32) -> f32 {
    if bounds_bottom - bounds_top <= EDGE_SCROLL_ZONE * 2. {
        return 0.;
    }
    if pointer_y < bounds_top + EDGE_SCROLL_ZONE {
        let ratio = ((bounds_top + EDGE_SCROLL_ZONE - pointer_y) / EDGE_SCROLL_ZONE).clamp(0., 1.);
        -EDGE_SCROLL_MAX_STEP * ratio
    } else if pointer_y > bounds_bottom - EDGE_SCROLL_ZONE {
        let ratio =
            ((pointer_y - (bounds_bottom - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE).clamp(0., 1.);
        EDGE_SCROLL_MAX_STEP * ratio
    } else {
        0.
    }
}

/// Binary-search the drop boundary across `count` vertically ordered blocks,
/// splitting each block at its midpoint (`(top + bottom) / 2`).
fn pick_drop_boundary(
    count: usize,
    pointer_y: f32,
    mut bounds: impl FnMut(usize) -> Option<(f32, f32)>,
) -> usize {
    let mut lo = 0usize;
    let mut hi = count;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match bounds(mid) {
            Some((top, bottom)) if pointer_y < (top + bottom) / 2. => hi = mid,
            _ => lo = mid + 1,
        }
    }
    lo
}

impl ViewPlugin for BlockDragAddon {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn key_context(&self) -> Option<&'static str> {
        Some(KEY_CONTEXT)
    }

    fn register_keymap(&self, cx: &mut App) {
        let c = Some(KEY_CONTEXT);
        cx.bind_keys([
            KeyBinding::new("secondary-shift-up", MoveBlockUp, c),
            KeyBinding::new("secondary-shift-down", MoveBlockDown, c),
        ]);
    }

    fn bind_actions(&self, root: Div, cx: &mut Context<EditorView>) -> Div {
        root.on_action(cx.listener(|view, _: &MoveBlockUp, window, cx| {
            let read_only = view.read_only();
            let state = view.state().clone();
            let tr = view
                .plugin_mut::<BlockDragAddon>()
                .and_then(|addon| addon.move_keyboard(&state, read_only, true));
            if let Some(tr) = tr {
                view.dispatch(tr, cx);
            } else {
                window.dispatch_action(Box::new(SelectDocStart), cx);
            }
        }))
        .on_action(cx.listener(|view, _: &MoveBlockDown, window, cx| {
            let read_only = view.read_only();
            let state = view.state().clone();
            let tr = view
                .plugin_mut::<BlockDragAddon>()
                .and_then(|addon| addon.move_keyboard(&state, read_only, false));
            if let Some(tr) = tr {
                view.dispatch(tr, cx);
            } else {
                window.dispatch_action(Box::new(SelectDocEnd), cx);
            }
        }))
    }

    fn on_applied(&mut self, applied: &Applied, _state: &EditorState) {
        if !applied.changes.is_empty() {
            self.cached = None;
            self.hover = None;
            self.dragging = None;
        }
    }

    fn on_blur(&mut self, _state: &EditorState) -> bool {
        self.dragging.take().is_some() || self.hover.take().is_some()
    }

    fn on_escape(&mut self, _state: &EditorState) -> bool {
        if self.dragging.take().is_some() {
            self.hover = None;
            return true;
        }
        false
    }

    fn on_mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        ctx: &mut PluginPointerCx,
    ) -> PluginPointerOutcome {
        if !block_move::enabled() || ctx.read_only {
            if self.hover.take().is_some() || self.dragging.take().is_some() {
                ctx.request_notify();
            }
            return PluginPointerOutcome::Ignored;
        }

        if let Some((block, prev_boundary)) = self.dragging.clone() {
            let Some(layout) = ctx.layout.filter(|l| l.revision == ctx.state.revision) else {
                self.dragging = None;
                self.hover = None;
                ctx.request_notify();
                return PluginPointerOutcome::Consumed;
            };

            let scroll_dy = compute_edge_scroll_delta(
                f32::from(event.position.y),
                f32::from(layout.bounds.top()),
                f32::from(layout.bounds.bottom()),
            );
            if scroll_dy != 0. {
                ctx.scroll_by(scroll_dy);
            }

            let pointer_y = f32::from(event.position.y);
            let boundary = pick_drop_boundary(block.group.len(), pointer_y, |i| {
                let range = &block.group[i];
                Some((
                    f32::from(block_top(layout, &ctx.state.doc, range)?),
                    f32::from(block_bottom(layout, &ctx.state.doc, range)?),
                ))
            });
            let next_boundary = Some(boundary).filter(|&b| !block_move::is_noop(block.index, b));
            if next_boundary != prev_boundary {
                self.dragging = Some((block, next_boundary));
                ctx.request_notify();
            }
            return PluginPointerOutcome::Consumed;
        }

        if event.pressed_button.is_some() {
            return PluginPointerOutcome::Ignored;
        }

        let hover = ctx
            .layout
            .filter(|l| l.revision == ctx.state.revision && l.bounds.contains(&event.position))
            .and_then(|layout| {
                let (left, right) = rail(layout)?;
                let at = point((left + right) / 2., event.position.y);
                let (raw_offset, _) = layout.offset_at(layout.to_layout(at, ctx.scroll_y));
                let offset = ctx.state.doc.clamp(raw_offset);
                let boundaries = self.boundaries_for(&ctx.state.doc, ctx.state.revision);
                if !boundaries.live {
                    return None;
                }
                block_move::movable_at_boundaries(&ctx.state.doc, boundaries, offset)
            });

        if hover != self.hover {
            self.hover = hover;
            ctx.request_notify();
        }
        PluginPointerOutcome::Ignored
    }

    fn on_mouse_up(
        &mut self,
        _event: &MouseUpEvent,
        ctx: &mut PluginPointerCx,
    ) -> Option<PluginDropOutcome> {
        let (movable, boundary) = self.dragging.take()?;
        self.hover = None;
        ctx.request_notify();
        if ctx.read_only || !block_move::enabled() {
            return Some(PluginDropOutcome::Consumed(None));
        }
        let tx = boundary
            .and_then(|b| block_move::move_block_boundaries(ctx.state, &movable, b))
            .map(|mut tr| {
                tr.scroll_into_view = false;
                tr
            });
        Some(PluginDropOutcome::Consumed(tx))
    }

    fn overlay(&self, view: &EditorView, cx: &mut Context<EditorView>) -> Vec<AnyElement> {
        if !block_move::enabled() || view.read_only() {
            return Vec::new();
        }
        let state = view.state();
        let Some(layout) = view.layout().filter(|l| l.revision == state.revision) else {
            return Vec::new();
        };
        let Some((left, right)) = rail(layout) else {
            return Vec::new();
        };
        let doc = &state.doc;
        let origin = layout.bounds.origin;
        let t = crate::theme::Theme::new(view.dark());
        let mut out = Vec::new();
        let edge = |block: &Movable| {
            let start = doc.clamp(block.range.start);
            if block.depth > 0 {
                layout.caret(start, false).x
            } else {
                left
            }
        };

        if let Some((block, boundary)) = &self.dragging {
            if let (Some(top), Some(bottom)) = (
                block_top(layout, doc, &block.range),
                block_bottom(layout, doc, &block.range),
            ) {
                out.push(
                    div()
                        .absolute()
                        .left(left - origin.x - px(SOURCE_BLEED))
                        .top(top - origin.y)
                        .w(right - left + px(2. * SOURCE_BLEED))
                        .h(bottom - top)
                        .rounded(px(4.))
                        .bg(view.surface().selection)
                        .into_any_element(),
                );
            }
            if let Some(b) = *boundary {
                let above = b
                    .checked_sub(1)
                    .and_then(|i| block.group.get(i))
                    .and_then(|r| block_bottom(layout, doc, r));
                let below = block.group.get(b).and_then(|r| block_top(layout, doc, r));
                let y = match (above, below) {
                    (Some(a), Some(c)) => Some((a + c) / 2.),
                    (a, c) => a.or(c),
                };
                if let Some(y) = y {
                    let from = edge(block);
                    out.push(
                        div()
                            .absolute()
                            .left(from - origin.x)
                            .top(y - origin.y - px(2.))
                            .w(right - from)
                            .h(px(4.))
                            .rounded(px(2.))
                            .bg(crate::theme::alpha(t.accent, 0.5))
                            .into_any_element(),
                    );
                }
            }
        }

        let shown = self
            .dragging
            .as_ref()
            .map(|(b, _)| b)
            .or(self.hover.as_ref());
        if let Some(block) = shown {
            let start = doc.clamp(block.range.start);
            let y = if layout.leaf_of(start).is_some() {
                let c = layout.caret(start, false);
                c.row_top + c.row_height / 2.
            } else if let (Some(top), Some(bottom)) = (
                block_top(layout, doc, &block.range),
                block_bottom(layout, doc, &block.range),
            ) {
                top + ((bottom - top) / 2.).min(px(26.))
            } else {
                return out;
            };
            let center =
                (edge(block) - px(HANDLE_GAP + HANDLE_WIDTH / 2.)).max(px(HANDLE_WIDTH / 2.));
            let dragging = self.dragging.is_some();
            let grip = svg()
                .path("icons/block-drag-grip.svg")
                .w(px(8.))
                .h(px(13.))
                .text_color(t.subtle);
            let entity = cx.entity().downgrade();
            let source = block.clone();
            let (hover_bg, hover_text) = (crate::theme::alpha(t.text, 0.08), t.muted);
            out.push(
                div()
                    .id("md-block-drag-handle")
                    .absolute()
                    .left(center - origin.x - px(HANDLE_WIDTH / 2.))
                    .top(y - origin.y - px(HANDLE_HEIGHT / 2.))
                    .w(px(HANDLE_WIDTH))
                    .h(px(HANDLE_HEIGHT))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(4.))
                    .opacity(if dragging { 0. } else { 0.62 })
                    .cursor(if dragging {
                        CursorStyle::ClosedHand
                    } else {
                        CursorStyle::OpenHand
                    })
                    .hover(move |s| s.bg(hover_bg).text_color(hover_text).opacity(1.))
                    .child(grip)
                    .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                        cx.stop_propagation();
                        let _ = entity.update(cx, |v, cx| {
                            if let Some(addon) = v.plugin_mut::<BlockDragAddon>() {
                                addon.dragging = Some((source.clone(), None));
                            }
                            cx.notify();
                        });
                    })
                    .into_any_element(),
            );
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::rc::Rc;

    fn test_addon(live: bool) -> BlockDragAddon {
        BlockDragAddon::new(Rc::new(move |doc, rev| {
            let mut top_blocks = Vec::new();
            let mut start = 0usize;
            for line in 0..doc.line_count() {
                let r = doc.line_range(line);
                if doc.line_cow(line).trim().is_empty() {
                    if start < r.start {
                        top_blocks.push(start..r.start.saturating_sub(1));
                    }
                    start = r.end + 1;
                }
            }
            if start < doc.len() {
                top_blocks.push(
                    start
                        ..doc.len().saturating_sub(usize::from(
                            doc.line_cow(doc.line_count() - 1).is_empty(),
                        )),
                );
            }
            BlockBoundaries {
                revision: rev,
                live,
                top_blocks,
                lists: Vec::new(),
                items: Vec::new(),
            }
        }))
    }

    #[test]
    fn escape_and_blur_cancel_active_drag() {
        block_move::set_enabled(true);
        let state = EditorState::new("alpha\n\nbeta\n");
        let mut addon = test_addon(true);
        assert!(addon.begin_drag_for_tests(&state.doc, state.revision, 0, 2));
        assert!(addon.is_dragging());
        assert!(addon.on_escape(&state));
        assert!(!addon.is_dragging());
        assert!(!addon.on_escape(&state));

        assert!(addon.begin_drag_for_tests(&state.doc, state.revision, 0, 2));
        assert!(addon.on_blur(&state));
        assert!(!addon.is_dragging());
    }

    #[test]
    fn edge_autoscroll_computes_signed_deltas_near_top_and_bottom() {
        assert!(compute_edge_scroll_delta(8., 0., 400.) < 0.);
        assert_eq!(compute_edge_scroll_delta(200., 0., 400.), 0.);
        assert!(compute_edge_scroll_delta(392., 0., 400.) > 0.);
    }

    #[test]
    fn block_drag_geometry_splits_midpoints_clamps_binary_searches_and_edge_scrolls() {
        let blocks = [(0., 100.), (120., 140.), (160., 400.)];
        let pick = |y: f32| pick_drop_boundary(blocks.len(), y, |i| Some(blocks[i]));
        // Splits each block at its midpoint.
        assert_eq!(pick(49.), 0);
        assert_eq!(pick(50.), 1);
        assert_eq!(pick(129.), 1);
        assert_eq!(pick(130.), 2);
        assert_eq!(pick(279.), 2);
        assert_eq!(pick(280.), 3);
        // Clamps outside the group.
        assert_eq!(pick(-500.), 0);
        assert_eq!(pick(9000.), 3);
        // Reads only logarithmically many blocks for 100,000 blocks.
        let mut reads = 0usize;
        let boundary = pick_drop_boundary(100_000, 5_000_000., |i| {
            reads += 1;
            let top = (i as f32) * 100.;
            Some((top, top + 50.))
        });
        assert_eq!(boundary, 50_000);
        assert!(reads <= 18, "reads={reads}");
        // Edge scroll rests outside zones, ramps inside zones, and caps past edges.
        assert_eq!(compute_edge_scroll_delta(300., 0., 600.), 0.);
        assert_eq!(compute_edge_scroll_delta(EDGE_SCROLL_ZONE, 0., 600.), 0.);
        assert_eq!(
            compute_edge_scroll_delta(600. - EDGE_SCROLL_ZONE, 0., 600.),
            0.
        );
        assert_eq!(
            compute_edge_scroll_delta(EDGE_SCROLL_ZONE / 2., 0., 600.),
            -EDGE_SCROLL_MAX_STEP / 2.
        );
        assert_eq!(
            compute_edge_scroll_delta(600. - EDGE_SCROLL_ZONE / 2., 0., 600.),
            EDGE_SCROLL_MAX_STEP / 2.
        );
        assert_eq!(
            compute_edge_scroll_delta(-200., 0., 600.),
            -EDGE_SCROLL_MAX_STEP
        );
        assert_eq!(
            compute_edge_scroll_delta(900., 0., 600.),
            EDGE_SCROLL_MAX_STEP
        );
    }
}
