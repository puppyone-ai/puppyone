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
        s.session
            .docs
            .update(cx, |d, _| d.replace(Documents::default()));
        s.session
            .docs
            .update(cx, |d, _| d.workspace = Some(workspace));
        s.session
            .docs
            .update(cx, |d, _| d.document = Some(document.clone()));
        s.session.docs.update(cx, |d, _| {
            d.outgoing.push(crate::documents::HostMessage::Open {
                id: document.id.clone(),
                name: "bench.md".into(),
                text: document.text.clone(),
                revision: 0,
                external: false,
            })
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

/// The panes' motion over an open Markdown document: what closing and
/// reopening the Explorer and narrowing it by its edge cost per frame, and
/// how often the Explorer itself renders meanwhile (`PUPPYONE_BENCH_FILE`
/// benchmarks a document of your own).
#[test]
#[ignore = "benchmark: run in release"]
fn pane_motion_frame_cost() {
    let temp = tempfile::tempdir().unwrap();
    let text = match std::env::var("PUPPYONE_BENCH_FILE") {
        Ok(path) => std::fs::read_to_string(path).unwrap(),
        Err(_) => bench::markdown(bench::sections()),
    };
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
        s.session
            .docs
            .update(cx, |d, _| d.replace(Documents::default()));
        s.session
            .docs
            .update(cx, |d, _| d.workspace = Some(workspace));
        s.session
            .docs
            .update(cx, |d, _| d.document = Some(document.clone()));
        s.session.docs.update(cx, |d, _| {
            d.outgoing.push(crate::documents::HostMessage::Open {
                id: document.id.clone(),
                name: "bench.md".into(),
                text: document.text.clone(),
                revision: 0,
                external: false,
            })
        });
        s.sync_editor(w, cx);
    });
    for _ in 0..3 {
        bench::draw(cx);
    }
    let renders =
        |cx: &mut VisualTestContext| view.read_with(cx, |s, cx| s.explorer.read(cx).renders);
    let edge = |cx: &mut VisualTestContext| view.read_with(cx, |s, _| s.layout.editor.x);
    // A toggle, then frames until the edge settles at `target`.
    let toggle = |cx: &mut VisualTestContext, label: &str, target: f32| {
        let before = renders(cx);
        let t = Instant::now();
        view.update_in(cx, |s, w, cx| s.command(Command::ToggleExplorer, w, cx));
        let command = t.elapsed().as_secs_f64() * 1000.;
        let mut frames = Samples(Vec::new());
        let started = Instant::now();
        while started.elapsed().as_millis() < 2000 {
            frames.0.push(bench::draw(cx));
            if edge(cx) == target {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
        let rendered = renders(cx) - before;
        println!(
            "PANES {label:<6} command {command:6.2}ms  frames {:3}  mean {:5.2}ms  p95 {:5.2}ms  max {:6.2}ms  Explorer renders {rendered}",
            frames.0.len(),
            frames.mean(),
            frames.p95(),
            frames.0.iter().cloned().fold(0., f64::max),
        );
    };
    for _ in 0..2 {
        toggle(cx, "close", 0.);
        toggle(cx, "open", 320.);
    }
    // Narrowing by the edge: every pointer sample is a frame.
    let before = renders(cx);
    let at = |x: f32| point(px(x), px(400.));
    cx.simulate_mouse_down(at(322.), MouseButton::Left, Modifiers::default());
    let mut frames = Samples(Vec::new());
    for i in 0..60 {
        cx.simulate_mouse_move(
            at(322. - 1.5 * i as f32),
            Some(MouseButton::Left),
            Modifiers::default(),
        );
        frames.0.push(bench::draw(cx));
    }
    cx.simulate_mouse_up(at(232.), MouseButton::Left, Modifiers::default());
    println!(
        "PANES drag   samples {:3}  mean {:5.2}ms  p95 {:5.2}ms  max {:6.2}ms  Explorer renders {}",
        frames.0.len(),
        frames.mean(),
        frames.p95(),
        frames.0.iter().cloned().fold(0., f64::max),
        renders(cx) - before,
    );
}
