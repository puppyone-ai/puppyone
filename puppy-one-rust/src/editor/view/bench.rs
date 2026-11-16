//! The Markdown editor alone: frames while scrolling, resizing and editing a
//! long document (`tools/bench-editor.py`).
use super::{EditorView, bind_keys};
use crate::bench::{self, Samples};
use crate::editor::markdown::MarkdownExtension;
use crate::editor::text::selection::Selection;
use crate::typography::Scale;
use core::prelude::v1::test;
use gpui::*;
use std::time::Instant;

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
    for _ in 0..bench::frames() {
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

fn mid_paragraph_offset(text: &str, sections: usize) -> usize {
    let heading = format!("## Section {}:", sections / 2);
    let start = text.find(&heading).unwrap_or(text.len() / 2);
    let needle = "PuppyOne opens ";
    text[start..]
        .find(needle)
        .map(|rel| start + rel + needle.len())
        .unwrap_or(start)
}

fn place_caret_at_middle(view: &Entity<EditorView>, cx: &mut VisualTestContext, sections: usize) {
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        let mid = mid_paragraph_offset(v.text(), sections);
        v.set_selection(Selection::cursor(mid), cx);
    });
    bench::draw(cx);
    bench::draw(cx);
}

fn time_input_frame(
    cx: &mut VisualTestContext,
    dispatch: impl FnOnce(&mut VisualTestContext),
) -> f64 {
    let t = Instant::now();
    dispatch(cx);
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    t.elapsed().as_secs_f64() * 1000.
}

fn run_ime_step(view: &Entity<EditorView>, cx: &mut VisualTestContext, step_in_cycle: usize) {
    match step_in_cycle % 5 {
        0 => view.update_in(cx, |v, w, cx| {
            v.replace_and_mark_text_in_range(None, "n", Some(1..1), w, cx);
        }),
        1 => view.update_in(cx, |v, w, cx| {
            v.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        }),
        2 => view.update_in(cx, |v, w, cx| {
            v.replace_and_mark_text_in_range(None, "nih", Some(3..3), w, cx);
        }),
        3 => view.update_in(cx, |v, w, cx| {
            v.replace_and_mark_text_in_range(None, "nihao", Some(5..5), w, cx);
        }),
        _ => view.update_in(cx, |v, w, cx| {
            v.replace_text_in_range(None, "你好", w, cx);
        }),
    }
}

/// CPU cost of a single edit or caret frame (input dispatch through `Window::draw`)
/// in the middle of a multi-section Markdown document (`TA-81`).
#[test]
#[ignore = "benchmark: run in release through tools/bench-editor.py"]
fn editor_edit_cost() {
    let sections = bench::sections();
    let steps = bench::edit_steps();
    let text = bench::markdown(sections);
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
    bench::draw(cx);
    let lines = view.read_with(cx, |v, _| v.state.doc.line_count());

    const CHARS: [&str; 5] = ["a", "b", "c", "d", " "];

    // 1. Character-by-character typing in the middle paragraph.
    place_caret_at_middle(&view, cx, sections);
    for i in 0..3 {
        let _ = time_input_frame(cx, |cx| cx.simulate_input(CHARS[i % CHARS.len()]));
    }
    let before_len = view.read_with(cx, |v, _| v.text().len());
    let mut typing = Samples(Vec::with_capacity(steps));
    for i in 0..steps {
        typing.0.push(time_input_frame(cx, |cx| {
            cx.simulate_input(CHARS[i % CHARS.len()])
        }));
    }
    assert!(view.read_with(cx, |v, _| v.text().len()) > before_len);

    // 2. Arrow-key movement (selection-only transactions, no document change).
    place_caret_at_middle(&view, cx, sections);
    for i in 0..4 {
        let key = if i % 2 == 0 { "down" } else { "up" };
        let _ = time_input_frame(cx, |cx| cx.simulate_keystrokes(key));
    }
    let rev_before = view.read_with(cx, |v, _| v.state.revision);
    let mut arrow = Samples(Vec::with_capacity(steps));
    for i in 0..steps {
        let key = if i % 2 == 0 { "down" } else { "up" };
        let head_before = view.read_with(cx, |v, _| v.state.selection.head);
        arrow
            .0
            .push(time_input_frame(cx, |cx| cx.simulate_keystrokes(key)));
        let head_after = view.read_with(cx, |v, _| v.state.selection.head);
        assert_ne!(head_before, head_after, "arrow key must move selection");
    }
    assert_eq!(
        rev_before,
        view.read_with(cx, |v, _| v.state.revision),
        "arrow movement must not mutate the document"
    );

    // 3. IME composition: progressive `replace_and_mark_text_in_range` updates followed by commit.
    place_caret_at_middle(&view, cx, sections);
    for step in 0..5 {
        let _ = time_input_frame(cx, |cx| run_ime_step(&view, cx, step));
    }
    let ime_steps = steps.max(5) / 5 * 5;
    let mut ime = Samples(Vec::with_capacity(ime_steps));
    for step in 0..ime_steps {
        ime.0
            .push(time_input_frame(cx, |cx| run_ime_step(&view, cx, step)));
    }
    assert!(
        view.update_in(cx, |v, w, cx| v.marked_text_range(w, cx))
            .is_none(),
        "IME benchmark cycles must end committed"
    );

    // 4. Typing in the middle paragraph while Find is active with many matches across the document.
    let total_matches = view.update(cx, |v, cx| v.find_query("the", cx).1);
    assert!(
        total_matches >= sections,
        "expected dense find matches across document, got {total_matches}"
    );
    place_caret_at_middle(&view, cx, sections);
    for i in 0..3 {
        let _ = time_input_frame(cx, |cx| cx.simulate_input(CHARS[i % CHARS.len()]));
    }
    let mut find_typing = Samples(Vec::with_capacity(steps));
    for i in 0..steps {
        find_typing.0.push(time_input_frame(cx, |cx| {
            cx.simulate_input(CHARS[i % CHARS.len()])
        }));
    }
    view.update(cx, |v, cx| v.find_clear(cx));

    bench::report_edit("edit", lines, &typing, &arrow, &ime, &find_typing);
}

struct CodeBenchHost {
    surface: Box<dyn crate::editor::registry::ViewerSurface>,
    _sub: Subscription,
}

impl Render for CodeBenchHost {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.surface.element()
    }
}

/// CE-30: single-keystroke adapter & frame cost on `160 KiB` (`sections = 1`) vs
/// `16 MiB` (`sections = 100`) text/code files (`tools/bench-editor.py` `code_edit`).
#[test]
#[ignore = "benchmark: run in release through tools/bench-editor.py"]
fn code_edit_cost() {
    use crate::editor::{
        registry::{self, EditorDocument, SourceKind, SurfaceEvent, SurfaceInput, SurfaceRequest},
        viewers::code,
    };
    use std::{cell::Cell, rc::Rc};

    let sections = bench::sections().max(1);
    let steps = bench::edit_steps();
    let target_bytes = sections * 163_840; // 1 -> 160 KiB, 100 -> ~16 MiB (16,384,000 B)
    let line_template =
        "2026-11-16T12:00:00Z INFO  worker::pipeline request_id=abc123 status=200\n";
    let repeat_lines = target_bytes.div_ceil(line_template.len());
    let text = line_template.repeat(repeat_lines);

    let mut app = bench::app();
    app.update(bind_keys);
    let snapshots_taken = Rc::new(Cell::new(0usize));
    let snap_counter = snapshots_taken.clone();

    let (host, cx) = app.add_window_view(|w, cx| {
        let format = registry::resolve(&EditorDocument::local("large.log")).format;
        let surface = code::open(
            &SurfaceRequest {
                id: "bench-code-16m",
                name: "large.log",
                input: SurfaceInput::Text(&text),
                format,
                resolved_extension: None,
                dark: true,
                scale: Scale::Medium,
                workspace: None,
                file_mode: false,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: SourceKind::Local,
            },
            w,
            cx,
        );
        let sub = surface
            .subscribe(
                Rc::new(move |ev, _| {
                    if matches!(ev, SurfaceEvent::Changed) {
                        snap_counter.set(snap_counter.get() + 1);
                    }
                }),
                cx,
            )
            .unwrap();
        CodeBenchHost { surface, _sub: sub }
    });

    cx.simulate_resize(size(px(1000.), px(800.)));
    bench::draw(cx);

    let code_view = host.read_with(cx, |h, _| {
        h.surface.as_test_probe().unwrap().code_editor().unwrap()
    });
    let (lines, bytes, mid_byte) = code_view.read_with(cx, |v, cx| {
        let doc = v.editor.read(cx).committed_doc();
        let mid_line = doc.line_count() / 2;
        (doc.line_count(), doc.len(), doc.line_range(mid_line).start)
    });

    code_view.update_in(cx, |v, w, cx| {
        v.editor.update(cx, |e, cx| {
            e.focus(w, cx);
            e.set_selection(Selection::cursor(mid_byte), cx);
        });
    });
    bench::draw(cx);
    bench::draw(cx);

    const CHARS: [&str; 5] = ["a", "b", "c", "d", " "];

    // 1. Adapter-layer keystroke cost (input -> Rope transaction -> Changed -> O(1) Buffer snapshot).
    for i in 0..3 {
        host.update_in(cx, |h, w, cx| {
            let cv = h.surface.as_test_probe().unwrap().code_editor().unwrap();
            cv.update(cx, |v, cx| {
                v.replace_text_in_range(None, CHARS[i % CHARS.len()], w, cx)
            });
            let buf = h.surface.buffer(cx).unwrap();
            assert!(!buf.has_materialized_flat());
        });
    }
    let before_snaps = snapshots_taken.get();
    let mut adapter = Samples(Vec::with_capacity(steps));
    for i in 0..steps {
        let ch = CHARS[i % CHARS.len()];
        let elapsed_ms = host.update_in(cx, |h, w, cx| {
            let t = Instant::now();
            let cv = h.surface.as_test_probe().unwrap().code_editor().unwrap();
            cv.update(cx, |v, cx| v.replace_text_in_range(None, ch, w, cx));
            let buf = h.surface.buffer(cx).unwrap();
            assert!(!buf.has_materialized_flat());
            t.elapsed().as_secs_f64() * 1000.
        });
        adapter.0.push(elapsed_ms);
    }
    assert_eq!(snapshots_taken.get() - before_snaps, steps);
    bench::draw(cx);

    // 2. Full keystroke + Window::draw frame cost in the middle of the file.
    let mut frame = Samples(Vec::with_capacity(steps));
    for i in 0..steps {
        let ch = CHARS[i % CHARS.len()];
        frame.0.push(time_input_frame(cx, |cx| {
            host.update_in(cx, |h, w, cx| {
                let cv = h.surface.as_test_probe().unwrap().code_editor().unwrap();
                cv.update(cx, |v, cx| v.replace_text_in_range(None, ch, w, cx));
                let _ = h.surface.buffer(cx).unwrap();
            });
        }));
    }

    bench::report_code_edit(sections, lines, bytes, &adapter, &frame);
}
