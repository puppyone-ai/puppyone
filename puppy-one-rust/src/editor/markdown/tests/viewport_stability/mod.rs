//! Native GPUI viewport stability test matrix (T2): verifies across 17
//! individual `#[gpui::test]` scenarios that the text row at the top of the
//! viewport stays anchored within `0.5px` across width/height resizes, bottom
//! clamping, font-scale & theme switches, Live Preview <-> Source toggles,
//! external edits (inserts, deletes, appends, anchor deletion), typing inside
//! the viewport, undo/redo above the viewport, async image decode & HTML block
//! measurement above the viewport, blur/focus, explicit scroll jumps, and
//! `PageDown` caret reveals.
use super::{blocks, setup, setup_with_focus};
use crate::editor::{
    markdown::SetAssets,
    registry::DocumentAssets,
    text::selection::Selection,
    view::{EditorView, extension::config_transaction},
};
use gpui::{Entity, TestAppContext, VisualTestContext, point, px, size};
use image::RgbaImage;
use std::sync::Arc;

mod edits_and_async;
mod layout_and_modes;

pub(super) const DEFAULT_TOLERANCE_PX: f32 = 0.5;

#[derive(Clone, Copy, Debug)]
pub(super) enum TopKind {
    Paragraph,
    Table,
    CodeBlock,
    Image,
}

pub(super) fn settle(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
    for _ in 0..6 {
        let _ = blocks(view, cx);
        cx.run_until_parked();
    }
}

pub(super) fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut buf = Vec::new();
    RgbaImage::from_pixel(width, height, image::Rgba([64, 140, 220, 255]))
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

/// Builds the T2 60-section test document: each section has a `##` heading,
/// a 4-sentence wrapping paragraph, a 2-item list (first item a long sentence),
/// a fenced code block, a 2×2 table, and every 10th section a standalone image.
pub(super) fn sixty_section_document() -> String {
    let mut out = String::new();
    for i in 1..=60 {
        out.push_str(&format!("## Section {i}\n\n"));
        out.push_str(&format!(
            "Section {i} opens with a long sentence crafted to wrap across multiple visual rows whenever the editor column narrows during window resizing. \
             A second sentence continues the narrative so mid-paragraph scroll anchors sit cleanly on wrapped interior text rather than only on headings. \
             The third sentence introduces inline **strong emphasis** and `inline_code_{i}` to exercise mixed shaping metrics across font scales. \
             Finally the fourth sentence closes paragraph {i} with steady prose that keeps line heights predictable.\n\n"
        ));
        out.push_str(&format!(
            "- List item one in section {i} is intentionally written as a long sentence that wraps cleanly inside the reading column at narrower pane widths.\n\
             - Short item two in section {i}.\n\n"
        ));
        out.push_str(&format!(
            "```rust\nfn section_{i}_helper(x: usize) -> usize {{\n    x + {i}\n}}\n```\n\n"
        ));
        out.push_str(&format!(
            "| Key {i} | Value {i} |\n| --- | --- |\n| row-{i}-a | cell-{i}-a |\n| row-{i}-b | cell-{i}-b |\n\n"
        ));
        if i % 10 == 0 {
            out.push_str(&format!("![img-{i}](img-{i}.png)\n\n"));
        }
    }
    out
}

pub(super) fn default_assets() -> DocumentAssets {
    let png = png_bytes(48, 24);
    DocumentAssets {
        workspace: "memory://t2-viewport-stability".into(),
        document: "doc.md".into(),
        read: Arc::new(move |_| Some(png.clone())),
    }
}

pub(super) fn capture_top_text(view: &Entity<EditorView>, cx: &VisualTestContext) -> (usize, f32) {
    view.read_with(cx, |v, _| {
        let layout = v.layout().expect("settled layout before op");
        let left = layout.blocks[0].bounds.left();
        let top = layout.bounds.top() + px(2.);
        let (offset, _) = layout.offset_at(point(left, top));
        let row0 = f32::from(layout.caret(offset, false).row_top - layout.bounds.top());
        (offset, row0)
    })
}

pub(super) fn measure_offset_top(
    view: &Entity<EditorView>,
    cx: &VisualTestContext,
    offset: usize,
    label: &str,
) -> f32 {
    view.read_with(cx, |v, _| {
        let layout = v.layout().expect("settled layout after op");
        assert!(
            layout.covers(offset),
            "{label}: anchored offset {offset} fell outside laid-out range"
        );
        f32::from(layout.caret(offset, false).row_top - layout.bounds.top())
    })
}

pub(super) fn scroll_to_top_kind(
    view: &Entity<EditorView>,
    cx: &mut VisualTestContext,
    top: TopKind,
) {
    let (needle, extra_px) = match top {
        TopKind::Paragraph => ("Section 30 opens with a long sentence", 54.0),
        TopKind::Table => ("| row-30-a | cell-30-a |", 0.0),
        TopKind::CodeBlock => ("fn section_30_helper", 0.0),
        TopKind::Image => ("![img-30](img-30.png)", 0.0),
    };
    let offset = view.read_with(cx, |v, _| {
        v.text()
            .find(needle)
            .unwrap_or_else(|| panic!("missing needle {needle:?}"))
    });
    view.update(cx, |v, cx| {
        v.set_selection(Selection::cursor(offset), cx);
    });
    settle(view, cx);
    let target_scroll = view.read_with(cx, |v, _| {
        let l = v.layout().expect("layout after jumping to target");
        let y = f32::from(l.caret(offset, false).row_top - l.bounds.top() + l.scroll);
        (y + extra_px).max(0.)
    });
    view.update(cx, |v, cx| {
        v.set_selection(Selection::cursor(0), cx);
        v.set_scroll_top(target_scroll, cx);
    });
    settle(view, cx);
}

pub(super) fn open_sixty_section_view(
    cx: &mut TestAppContext,
    focused: bool,
) -> (Entity<EditorView>, &mut VisualTestContext) {
    let text = sixty_section_document();
    let (view, visual) = if focused {
        setup(cx, &text)
    } else {
        setup_with_focus(cx, &text, false)
    };
    visual.simulate_resize(size(px(1000.), px(700.)));
    view.update_in(visual, |v, _, cx| {
        v.dispatch(config_transaction(SetAssets(Some(default_assets()))), cx);
    });
    settle(&view, visual);
    // Allow background PNG decoding of the 48×24 fixture images to settle cleanly.
    std::thread::sleep(std::time::Duration::from_millis(20));
    settle(&view, visual);
    (view, visual)
}

/// Shared T2 helper: sets a 1000×700 window, scrolls via `set_scroll_top` onto
/// `top`, draws 6×, captures the viewport-top line offset (`bounds.top() + 2px`)
/// and `row0`, runs `op(&view, cx)`, draws 6×, and asserts `layout.covers(map(offset))`
/// and `|row1 - row0| <= 0.5`.
pub(super) fn assert_top_text_holds(
    cx: &mut TestAppContext,
    top: TopKind,
    op: impl FnOnce(&Entity<EditorView>, &mut VisualTestContext),
    map: impl Fn(usize) -> usize,
) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, false);
    scroll_to_top_kind(&view, visual, top);

    let (offset, row0) = capture_top_text(&view, visual);
    op(&view, visual);
    settle(&view, visual);

    let mapped = map(offset);
    let label = format!("top={top:?}");
    let row1 = measure_offset_top(&view, visual, mapped, &label);
    let drift = (row1 - row0).abs();
    assert!(
        drift <= DEFAULT_TOLERANCE_PX,
        "{label}: viewport top text drifted by {drift:.3}px (row0={row0:.2}, row1={row1:.2}, offset={offset}->{mapped})"
    );
}
