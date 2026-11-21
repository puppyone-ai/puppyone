//! Large CSV table frame & operation benchmark (`CS-30`):
//! measures `500 × 20` (reference), `10,000 × 20` (tall), and `500 × 100`
//! (wide) across initial first-screen open (`CS-13`), scrolling, active-cell
//! typing, and structural row operations (`DeleteRow` / `InsertRowBelow`).
use super::{CsvEditor, bind_keys as bind_csv_keys, operations::Operation};
use crate::{
    bench::{self, Samples},
    editor::view::bind_keys,
    typography::Scale,
};
use core::prelude::v1::test;
use gpui::*;
use std::time::Instant;

fn csv_fixture(data_rows: usize, cols: usize) -> String {
    let mut out = String::with_capacity((data_rows + 1) * cols * 10);
    for c in 0..cols {
        if c > 0 {
            out.push(',');
        }
        out.push_str(&format!("col_{c}"));
    }
    out.push('\n');
    for r in 0..data_rows {
        for c in 0..cols {
            if c > 0 {
                out.push(',');
            }
            out.push_str(&format!("r{r}_c{c}"));
        }
        out.push('\n');
    }
    out
}

/// Encodes benchmark shape via `PUPPYONE_BENCH_SECTIONS`:
/// - `500`   -> `500 × 20` (baseline for 20x row scaling check)
/// - `10000` -> `10,000 × 20` (`CS-30` tall table)
/// - `50000` -> `500 × 100` (`CS-30` wide table)
fn shape_from_sections(sections: usize) -> (usize, usize) {
    match sections {
        500 => (500, 20),
        10_000 => (10_000, 20),
        50_000 => (500, 100),
        other => (other.max(10), 20),
    }
}

struct CsvBenchHost {
    editor: Option<Entity<CsvEditor>>,
}

impl Render for CsvBenchHost {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let mut root = div().size_full();
        if let Some(ref e) = self.editor {
            root = root.child(e.clone());
        }
        root
    }
}

#[test]
#[ignore = "benchmark: run in release through tools/bench-editor.py"]
fn csv_table_cost() {
    let sections = bench::sections();
    let (data_rows, cols) = shape_from_sections(sections);
    let steps = bench::edit_steps();
    let text = csv_fixture(data_rows, cols);
    let mut app = bench::app();
    app.update(|cx| {
        bind_keys(cx);
        bind_csv_keys(cx);
        let _ = crate::editor::tokens::Tokens::get(true, Scale::Medium);
    });

    // Pre-warm the window & font system so `open_ms` measures `CsvEditor::new`
    // + immediate first-screen frame (`CS-13`) rather than cold window creation.
    let (host, cx) = app.add_window_view(|_, _| CsvBenchHost { editor: None });
    cx.simulate_resize(size(px(1000.), px(800.)));
    bench::draw(cx);

    // 1. Open + first-screen draw (`CS-13`: large tables preview synchronously).
    let open_ms = cx.update(|w, cx| {
        let t_open = Instant::now();
        let view =
            cx.new(|cx| CsvEditor::new("bench-csv", "large.csv", &text, true, Scale::Medium, cx));
        host.update(cx, |h, cx| {
            h.editor = Some(view);
            cx.notify();
        });
        w.draw(cx).clear(cx);
        t_open.elapsed().as_secs_f64() * 1000.
    });
    let view = host.read_with(cx, |h, _| h.editor.clone().unwrap());

    // Complete background parse (`CS-13`) so full table operations run on all rows.
    cx.run_until_parked();
    bench::draw(cx);
    assert!(!view.read_with(cx, |v, _| v.is_loading()));

    // 2. Scroll frames across the table.
    let mut scroll = Samples(Vec::with_capacity(60));
    for i in 0..60 {
        let sy = ((i + 1) * 28) as f32;
        let sx = if cols > 20 {
            ((i % 20) * 18) as f32
        } else {
            0.
        };
        view.update(cx, |v, cx| v.set_view_scroll(sx, sy, cx));
        scroll.0.push(bench::draw(cx));
    }

    // 3. Active-cell character typing in the middle of the table.
    let mid_row = (data_rows / 2).max(1);
    let mid_col = (cols / 2).min(cols - 1);
    view.update(cx, |v, cx| {
        v.set_view_scroll(0., (mid_row.saturating_sub(5) * 32) as f32, cx)
    });
    bench::draw(cx);
    view.update_in(cx, |v, w, cx| v.activate(mid_row, mid_col, Some(0), w, cx));
    bench::draw(cx);
    const CHARS: [&str; 5] = ["a", "b", "c", "d", "1"];
    let mut cell_type = Samples(Vec::with_capacity(steps));
    for i in 0..steps {
        let t = Instant::now();
        cx.simulate_input(CHARS[i % CHARS.len()]);
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        cell_type.0.push(t.elapsed().as_secs_f64() * 1000.);
    }
    cx.simulate_keystrokes("enter");
    cx.run_until_parked();
    bench::draw(cx);

    // 4. Structural operations (`DeleteRow` / `InsertRowBelow`) in the middle of the table.
    let mut structural = Samples(Vec::with_capacity(steps));
    for i in 0..steps {
        let op = if i % 2 == 0 {
            Operation::DeleteRow
        } else {
            Operation::InsertRowBelow
        };
        let t = Instant::now();
        view.update_in(cx, |v, w, cx| v.apply_operation(op, mid_row, 0, w, cx));
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        structural.0.push(t.elapsed().as_secs_f64() * 1000.);
    }

    bench::report_csv(
        sections,
        data_rows + 1,
        cols,
        open_ms,
        &scroll,
        &cell_type,
        &structural,
    );
}
