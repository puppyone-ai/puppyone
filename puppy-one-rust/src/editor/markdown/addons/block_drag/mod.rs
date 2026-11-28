//! Markdown block-drag add-on (`TA-60`, `TODO-27`, `TODO-88`, `R8`
//! `ADDON_CORE_PORTS`):
//! - Mounted as a [`ViewPlugin`] from `src/editor/markdown/extension.rs` so
//!   `src/editor/view/` contains zero Markdown block-drag state or logic.
//! - Imports ONLY narrow core ports (`core::commands::block_move`,
//!   `core::syntax::block_boundaries`).
//! - Split into [`controller`], [`geometry`], [`overlay`], and [`preview`].
mod controller;
mod geometry;
mod overlay;
mod preview;

use crate::editor::{
    markdown::core::{commands::block_move::Movable, syntax::block_boundaries::BoundaryProvider},
    text::state::{Applied, EditorState},
    view::{
        EditorView, SelectDocEnd, SelectDocStart,
        plugins::{PluginDropOutcome, PluginPointerCx, PluginPointerOutcome, ViewPlugin},
    },
};
use controller::BlockDragController;
use gpui::{prelude::*, *};
use std::any::Any;

actions!(markdown_block_drag, [MoveBlockUp, MoveBlockDown]);

pub const KEY_CONTEXT: &str = "MarkdownBlockDrag";

pub struct BlockDragAddon {
    controller: BlockDragController,
}

impl BlockDragAddon {
    pub fn new(provider: BoundaryProvider) -> Self {
        Self {
            controller: BlockDragController::new(provider),
        }
    }

    pub fn install(provider: BoundaryProvider) -> Box<dyn ViewPlugin> {
        Box::new(Self::new(provider))
    }

    pub(super) fn begin_pointer_drag(&mut self, source: Movable) {
        self.controller.begin_pointer_drag(source);
    }

    #[cfg(test)]
    pub fn is_dragging(&self) -> bool {
        self.controller.is_dragging()
    }

    #[cfg(test)]
    pub fn begin_drag_for_tests(
        &mut self,
        doc: &crate::editor::text::buffer::Buffer,
        revision: u64,
        offset: usize,
        boundary: usize,
    ) -> bool {
        self.controller
            .begin_drag_for_tests(doc, revision, offset, boundary)
    }

    #[cfg(test)]
    pub fn finish_drag_for_tests(
        &mut self,
        state: &EditorState,
        read_only: bool,
    ) -> Option<crate::editor::text::state::Transaction> {
        self.controller.finish_drag_for_tests(state, read_only)
    }
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
                .and_then(|addon| addon.controller.move_keyboard(&state, read_only, true));
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
                .and_then(|addon| addon.controller.move_keyboard(&state, read_only, false));
            if let Some(tr) = tr {
                view.dispatch(tr, cx);
            } else {
                window.dispatch_action(Box::new(SelectDocEnd), cx);
            }
        }))
    }

    fn on_applied(&mut self, applied: &Applied, _state: &EditorState) {
        self.controller.on_applied(applied);
    }

    fn on_blur(&mut self, _state: &EditorState) -> bool {
        self.controller.on_blur()
    }

    fn on_escape(&mut self, _state: &EditorState) -> bool {
        self.controller.on_escape()
    }

    fn on_mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        ctx: &mut PluginPointerCx,
    ) -> PluginPointerOutcome {
        self.controller.on_mouse_move(event, ctx)
    }

    fn on_mouse_up(
        &mut self,
        event: &MouseUpEvent,
        ctx: &mut PluginPointerCx,
    ) -> Option<PluginDropOutcome> {
        self.controller.on_mouse_up(event, ctx)
    }

    fn overlay(&self, view: &EditorView, cx: &mut Context<EditorView>) -> Vec<AnyElement> {
        overlay::build_overlay(
            self.controller.hover.as_ref(),
            self.controller.dragging.as_ref(),
            view,
            cx,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{
        geometry::{
            EDGE_SCROLL_MAX_STEP, EDGE_SCROLL_ZONE, compute_edge_scroll_delta, pick_drop_boundary,
        },
        *,
    };
    use crate::editor::markdown::core::{
        commands::block_move, syntax::block_boundaries::BlockBoundaries,
    };
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
        block_move::set_enabled(false);
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
