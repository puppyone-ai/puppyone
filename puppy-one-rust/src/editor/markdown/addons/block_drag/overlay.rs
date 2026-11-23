//! Block-drag overlay builder: combines the dragged preview highlights with the
//! floating margin grip handle (`addons/block_drag/overlay.rs`).
use super::{
    BlockDragAddon,
    geometry::{block_edge_x, handle_anchor_y, rail},
    preview,
};
use crate::editor::{
    markdown::core::commands::block_move::{self, Movable},
    view::EditorView,
};
use gpui::{prelude::*, *};

const HANDLE_WIDTH: f32 = 18.;
const HANDLE_HEIGHT: f32 = 24.;
const HANDLE_GAP: f32 = 4.;

/// Builds overlay elements (drag preview, drop indicator, and grip handle).
pub(super) fn build_overlay(
    hover: Option<&Movable>,
    dragging: Option<&(Movable, Option<usize>)>,
    view: &EditorView,
    cx: &mut Context<EditorView>,
) -> Vec<AnyElement> {
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

    if let Some((block, boundary)) = dragging {
        if let Some(el) =
            preview::source_highlight(layout, doc, block, left, right, view.surface().selection)
        {
            out.push(el);
        }
        if let Some(b) = *boundary
            && let Some(el) = preview::drop_indicator(layout, doc, block, b, left, right, t.accent)
        {
            out.push(el);
        }
    }

    let shown = dragging.map(|(b, _)| b).or(hover);
    if let Some(block) = shown {
        let Some(y) = handle_anchor_y(layout, doc, block) else {
            return out;
        };
        let edge = block_edge_x(layout, doc, block, left);
        let center = (edge - px(HANDLE_GAP + HANDLE_WIDTH / 2.)).max(px(HANDLE_WIDTH / 2.));
        let is_dragging = dragging.is_some();
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
                .opacity(if is_dragging { 0. } else { 0.62 })
                .cursor(if is_dragging {
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
                            addon.begin_pointer_drag(source.clone());
                        }
                        cx.notify();
                    });
                })
                .into_any_element(),
        );
    }
    out
}
