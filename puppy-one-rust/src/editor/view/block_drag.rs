//! The block-drag handle (markdown block-drag add-on, blockDragController /
//! blockDragGeometry / markdown-block-drag.css): while the format lets
//! blocks move, the block under the pointer shows an 18×24 grip 4px left of
//! the text rail (a nested list item's, left of its marker), at 62% until
//! the pointer reaches it. Dragging it tints the block like a selection and
//! shows the drop line (accent at 50%, 4px, rounded) midway between the
//! siblings the pointer is between; releasing moves the block there. The
//! product's floating copy of the block and edge autoscroll are not drawn.
use super::{editor::EditorView, extension::MovableBlock};
use gpui::{prelude::*, *};

const HANDLE_WIDTH: f32 = 18.;
const HANDLE_HEIGHT: f32 = 24.;
const HANDLE_GAP: f32 = 4.;
const SOURCE_BLEED: f32 = 4.;

#[derive(Default)]
pub struct BlockDrag {
    /// The block the pointer is over (its handle shows).
    pub hover: Option<MovableBlock>,
    /// The block being dragged and the boundary it would land before.
    pub dragging: Option<(MovableBlock, Option<usize>)>,
}

impl EditorView {
    fn block_top(&self, range: &std::ops::Range<usize>) -> Option<Pixels> {
        let layout = self.layout.as_ref()?;
        layout
            .blocks
            .iter()
            .find(|b| b.source.start <= range.start && range.start <= b.source.end)
            .map(|b| b.bounds.top())
    }
    fn block_bottom(&self, range: &std::ops::Range<usize>) -> Option<Pixels> {
        let layout = self.layout.as_ref()?;
        layout
            .blocks
            .iter()
            .find(|b| b.source.start <= range.end && range.end <= b.source.end)
            .map(|b| b.bounds.bottom())
    }
    /// The text rail's edges (the line boxes' sides).
    fn rail(&self) -> Option<(Pixels, Pixels)> {
        let b = self.layout.as_ref()?.blocks.first()?;
        Some((b.bounds.left(), b.bounds.right()))
    }

    /// The pointer moved with no button held: show the hovered block's handle.
    pub(super) fn block_drag_hover(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let hover = (!self.read_only())
            .then(|| {
                let layout = self.layout.as_ref()?;
                if !layout.bounds.contains(&position) {
                    return None;
                }
                let (left, right) = self.rail()?;
                // The row only: a pointer beside the text resolves like the text.
                let at = point((left + right) / 2., position.y);
                let (offset, _) = layout.offset_at(layout.to_layout(at, self.scroll_y));
                self.extension.movable_block(&self.state, offset)
            })
            .flatten();
        if hover != self.block_drag.hover {
            self.block_drag.hover = hover;
            cx.notify();
        }
    }

    /// `pickDropBoundary`: the first sibling whose midpoint is below the
    /// pointer.
    pub(super) fn block_drag_move(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let Some((block, _)) = self.block_drag.dragging.clone() else {
            return;
        };
        let mut boundary = block.group.len();
        for (i, range) in block.group.iter().enumerate() {
            let (Some(top), Some(bottom)) = (self.block_top(range), self.block_bottom(range))
            else {
                continue;
            };
            if position.y < (top + bottom) / 2. {
                boundary = i;
                break;
            }
        }
        let boundary = Some(boundary).filter(|&b| !is_noop(block.index, b));
        if self.block_drag.dragging.as_ref().map(|(_, b)| *b) != Some(boundary) {
            self.block_drag.dragging = Some((block, boundary));
            cx.notify();
        }
    }

    /// Release: move the block to the boundary it is over.
    pub(super) fn block_drag_drop(&mut self, cx: &mut Context<Self>) -> bool {
        let Some((block, boundary)) = self.block_drag.dragging.take() else {
            return false;
        };
        if let Some(boundary) = boundary
            && let Some(mut tr) = self.extension.move_block(&self.state, &block, boundary)
        {
            // A drop lands where the pointer already is.
            tr.scroll_into_view = false;
            self.dispatch(tr, cx);
        }
        self.block_drag.hover = None;
        cx.notify();
        true
    }

    /// The handle, the dragged block's tint and the drop line, in the
    /// editor's coordinates.
    pub(super) fn block_drag_overlay(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(layout) = self.layout.as_ref() else {
            return Vec::new();
        };
        let Some((left, right)) = self.rail() else {
            return Vec::new();
        };
        let origin = layout.bounds.origin;
        let t = crate::theme::Theme::new(self.dark);
        let mut out = Vec::new();
        let edge = |block: &MovableBlock| {
            if block.nested {
                layout.caret(block.range.start, false).x
            } else {
                left
            }
        };
        if let Some((block, boundary)) = &self.block_drag.dragging {
            if let (Some(top), Some(bottom)) = (
                self.block_top(&block.range),
                self.block_bottom(&block.range),
            ) {
                out.push(
                    div()
                        .absolute()
                        .left(left - origin.x - px(SOURCE_BLEED))
                        .top(top - origin.y)
                        .w(right - left + px(2. * SOURCE_BLEED))
                        .h(bottom - top)
                        .rounded(px(4.))
                        .bg(self.decorations.surface.selection)
                        .into_any_element(),
                );
            }
            if let Some(b) = *boundary {
                let above = b
                    .checked_sub(1)
                    .and_then(|i| self.block_bottom(&block.group[i]));
                let below = block.group.get(b).and_then(|r| self.block_top(r));
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
            .block_drag
            .dragging
            .as_ref()
            .map(|(b, _)| b)
            .or(self.block_drag.hover.as_ref());
        if let Some(block) = shown {
            let y = if layout.leaf_of(block.range.start).is_some() {
                let c = layout.caret(block.range.start, false);
                c.row_top + c.row_height / 2.
            } else if let (Some(top), Some(bottom)) = (
                self.block_top(&block.range),
                self.block_bottom(&block.range),
            ) {
                top + ((bottom - top) / 2.).min(px(26.))
            } else {
                return out;
            };
            let center =
                (edge(block) - px(HANDLE_GAP + HANDLE_WIDTH / 2.)).max(px(HANDLE_WIDTH / 2.));
            let dragging = self.block_drag.dragging.is_some();
            let grip = svg()
                .path("icons/block-drag-grip.svg")
                .w(px(8.))
                .h(px(13.))
                .text_color(t.subtle);
            let view = cx.entity().downgrade();
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
                        let _ = view.update(cx, |v, cx| {
                            v.block_drag.dragging = Some((source.clone(), None));
                            cx.notify();
                        });
                    })
                    .into_any_element(),
            );
        }
        out
    }
}

/// `isMarkdownBlockMoveNoop`.
fn is_noop(index: usize, boundary: usize) -> bool {
    boundary == index || boundary == index + 1
}

#[cfg(test)]
impl EditorView {
    pub fn begin_block_drag_for_tests(&mut self, block: MovableBlock, boundary: usize) {
        self.block_drag.dragging = Some((block, Some(boundary)));
    }
    pub fn finish_block_drag_for_tests(&mut self, cx: &mut Context<Self>) {
        self.block_drag_drop(cx);
    }
}
