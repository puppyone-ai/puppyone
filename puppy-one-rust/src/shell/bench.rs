//! The whole window around an open Markdown document: frames while the
//! editor scrolls (real wheel events) and while the window resizes
//! (`tools/bench-editor.py`).
use super::*;
use crate::bench::{self, Samples};
use core::prelude::v1::test;
use std::time::Instant;

#[test]
#[ignore = "benchmark: run in release through tools/bench-editor.py"]
fn window_frame_cost() {
    let temp = tempfile::tempdir().unwrap();
    let text = bench::markdown(bench::sections());
    let lines = text.lines().count();
    std::fs::write(temp.path().join("bench.md"), &text).unwrap();
    let workspace = crate::workspace::Workspace::open(temp.path()).unwrap();
    let document = workspace.read(std::path::Path::new("bench.md")).unwrap();
    let mut app = bench::app();
    app.executor().allow_parking();
    app.update(|cx| {
        bind_keys(cx);
        ui::input::bind_keys(cx);
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        crate::editor::host::bind_keys(cx);
    });
    let mut content = None;
    let (_, cx) = app.add_window_view(|w, cx| {
        let view = cx.new(|cx| Shell::new(w, cx));
        content = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let view = content.unwrap();
    cx.simulate_resize(size(px(1280.), px(800.)));
    view.update_in(cx, |s, w, cx| {
        s.files = Documents::default();
        s.files.workspace = Some(workspace);
        s.files.document = Some(document.clone());
        s.files.outgoing.push(crate::documents::HostMessage::Open {
            id: document.id.clone(),
            name: "bench.md".into(),
            text: document.text.clone(),
            revision: 0,
            external: false,
        });
        s.sync_editor(w, cx);
    });
    let first = bench::draw(cx);
    bench::draw(cx);
    // Wheel events over the editor, a trackpad-like 24px each.
    let at = point(px(760.), px(420.));
    let mut scroll = Samples(Vec::new());
    for _ in 0..bench::frames() {
        let t = Instant::now();
        cx.simulate_event(ScrollWheelEvent {
            position: at,
            delta: ScrollDelta::Pixels(point(px(0.), px(-24.))),
            ..Default::default()
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        scroll.0.push(t.elapsed().as_secs_f64() * 1000.);
    }
    let mut resize = Samples(Vec::new());
    for i in 0..60 {
        cx.simulate_resize(size(px(1280. - 4. * (i + 1) as f32), px(800.)));
        resize.0.push(bench::draw(cx));
    }
    bench::report("window", lines, first, &scroll, &resize);
}
