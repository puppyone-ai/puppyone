//! The Markdown editor alone: frames while scrolling and resizing a long
//! document (`tools/bench-editor.py`).
use super::{EditorView, bind_keys};
use crate::bench::{self, Samples};
use crate::editor::markdown::MarkdownExtension;
use crate::typography::Scale;
use core::prelude::v1::test;
use gpui::*;

#[test]
#[ignore = "benchmark: run in release through tools/bench-editor.py"]
fn editor_frame_cost() {
    let text = bench::markdown(bench::sections());
    let mut app = bench::app();
    app.update(bind_keys);
    let (view, cx) = app.add_window_view(|_, cx| {
        EditorView::new(
            &text,
            Box::new(MarkdownExtension::new(true, Scale::Medium)),
            cx,
        )
    });
    cx.simulate_resize(size(px(1000.), px(800.)));
    let first = bench::draw(cx);
    bench::draw(cx);
    let lines = view.read_with(cx, |v, _| v.state.doc.line_count());
    // A trackpad-like 24px step per frame.
    let mut scroll = Samples(Vec::new());
    for _ in 0..120 {
        view.update(cx, |v, cx| {
            v.scroll_y += 24.;
            cx.notify();
        });
        scroll.0.push(bench::draw(cx));
    }
    // The window narrowing 4px per frame.
    let mut resize = Samples(Vec::new());
    for i in 0..60 {
        cx.simulate_resize(size(px(1000. - 4. * (i + 1) as f32), px(800.)));
        resize.0.push(bench::draw(cx));
    }
    bench::report("editor", lines, first, &scroll, &resize);
}
