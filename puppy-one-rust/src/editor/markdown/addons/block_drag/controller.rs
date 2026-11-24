//! Block-drag gesture state machine, keyboard move dispatch, and boundary cache
//! (`addons/block_drag/controller.rs`).
use super::geometry::{
    block_bottom, block_top, compute_edge_scroll_delta, pick_drop_boundary, rail,
};
use crate::editor::{
    markdown::core::{
        commands::block_move::{self, Movable},
        syntax::block_boundaries::{BlockBoundaries, BoundaryProvider},
    },
    text::{
        buffer::Buffer,
        state::{Applied, EditorState, Transaction},
    },
    view::plugins::{PluginDropOutcome, PluginPointerCx, PluginPointerOutcome},
};
use gpui::{MouseMoveEvent, MouseUpEvent, point};

pub(super) struct BlockDragController {
    provider: BoundaryProvider,
    cached: Option<(u64, BlockBoundaries)>,
    pub(super) hover: Option<Movable>,
    pub(super) dragging: Option<(Movable, Option<usize>)>,
}

impl BlockDragController {
    pub(super) fn new(provider: BoundaryProvider) -> Self {
        Self {
            provider,
            cached: None,
            hover: None,
            dragging: None,
        }
    }

    fn boundaries_for(&mut self, doc: &Buffer, revision: u64) -> &BlockBoundaries {
        let needs_refresh = self.cached.as_ref().is_none_or(|(rev, _)| *rev != revision);
        if needs_refresh {
            let b = (self.provider)(doc, revision);
            self.cached = Some((revision, b));
        }
        &self.cached.as_ref().expect("boundaries cached").1
    }

    pub(super) fn begin_pointer_drag(&mut self, source: Movable) {
        self.dragging = Some((source, None));
    }

    pub(super) fn move_keyboard(
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

    pub(super) fn on_applied(&mut self, applied: &Applied) {
        if !applied.changes.is_empty() {
            self.cached = None;
            self.hover = None;
            self.dragging = None;
        }
    }

    pub(super) fn on_blur(&mut self) -> bool {
        self.dragging.take().is_some() || self.hover.take().is_some()
    }

    pub(super) fn on_escape(&mut self) -> bool {
        if self.dragging.take().is_some() {
            self.hover = None;
            return true;
        }
        false
    }

    pub(super) fn on_mouse_move(
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

    pub(super) fn on_mouse_up(
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

    #[cfg(test)]
    pub(super) fn is_dragging(&self) -> bool {
        self.dragging.is_some()
    }

    #[cfg(test)]
    pub(super) fn begin_drag_for_tests(
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
    pub(super) fn finish_drag_for_tests(
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
