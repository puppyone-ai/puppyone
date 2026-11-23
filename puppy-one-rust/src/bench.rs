//! Frame-cost benchmarks (`tools/bench-editor.py`): the editor and the whole
//! window drawn with the platform's real text shaping, so the numbers follow
//! what a person scrolling or resizing the window waits for (CPU side of a
//! frame: build, layout, prepaint and paint; the GPU and the display link
//! are not part of it).
//!
//! The benchmarks are ignored tests: run them in release, one size per
//! process (Kit keeps thread-local text caches), through the tool.
use gpui::*;
use std::{sync::Arc, time::Instant};

/// Sections of a product-like Markdown document: a heading, two wrapping
/// paragraphs with inline marks, a list, a fenced code block and, every
/// third section, a table (about 24 source lines each).
pub fn markdown(sections: usize) -> String {
    let para = "PuppyOne opens any folder on your computer. Your documents, spreadsheets, slides, PDFs and web pages stay as ordinary files you can just open — nothing to upload, nothing to migrate. Let AI agents work in that folder: every change is tracked in Git, down to a redline view for Word documents, and anything can be rolled back.";
    let mut s = String::new();
    for i in 0..sections {
        s += &format!(
            "## Section {i}: a heading that names the part\n\n{para}\n\n{para} See [the docs](https://example.com/{i}) and `inline_code({i})` for **details** and *more*.\n\n"
        );
        for k in 0..4 {
            s += &format!(
                "- Item {k} with `code` and a [link](https://example.com) that is long enough to wrap onto a second row in the column\n"
            );
        }
        s += "\n```rust\n";
        for k in 0..8 {
            s += &format!(
                "fn handler_{k}(cx: &mut Context<Self>) -> Option<usize> {{ Some({k} * 2) }}\n"
            );
        }
        s += "```\n\n";
        if i % 3 == 0 {
            s += "| Name | Qty | Note |\n| --- | --: | --- |\n| apple | 3 | fresh |\n| pear | 5 | ripe |\n| plum | 7 | sweet |\n\n";
        }
    }
    s
}

/// Extreme Markdown stress document shapes for `editor_stress_edit_cost` (T4):
/// - `list_10k`: 10,000-item bullet list
/// - `single_line_100k`: 100,000-character single line
/// - `wide_table_200x2000`: 200 columns x 2,000 rows Markdown table
/// - `images_500`: 500 standalone Markdown image embeds
#[allow(dead_code)]
pub fn stress_markdown(shape: &str) -> String {
    match shape {
        "list_10k" => (0..10_000)
            .map(|i| format!("- List item {i} with inline `code_{i}` and **emphasis**"))
            .collect::<Vec<_>>()
            .join("\n"),
        "single_line_100k" => "word ".repeat(20_000),
        "wide_table_200x2000" => {
            let header = (0..200)
                .map(|c| format!("C{c}"))
                .collect::<Vec<_>>()
                .join("|");
            let sep = (0..200).map(|_| "---").collect::<Vec<_>>().join("|");
            let row = (0..200)
                .map(|c| format!("v{c}"))
                .collect::<Vec<_>>()
                .join("|");
            let mut out = String::with_capacity(2_002 * (row.len() + 3));
            out.push_str(&format!("|{header}|\n|{sep}|\n"));
            for _ in 0..2_000 {
                out.push('|');
                out.push_str(&row);
                out.push_str("|\n");
            }
            out
        }
        "images_500" => (0..500)
            .map(|i| format!("![Image {i}](assets/img-{i}.png)\n"))
            .collect(),
        other => panic!("unknown PUPPYONE_BENCH_STRESS shape: {other}"),
    }
}

/// Extreme stress shape name (`PUPPYONE_BENCH_STRESS`).
#[allow(dead_code)]
pub fn stress_shape() -> String {
    std::env::var("PUPPYONE_BENCH_STRESS").unwrap_or_else(|_| "list_10k".to_owned())
}

/// A test app whose text system shapes with the platform (Core Text), with
/// the fonts the application loads at startup.
pub fn app() -> TestAppContext {
    let app = TestAppContext::build_with_text_system(
        TestDispatcher::new(0),
        None,
        Arc::new(gpui_apple::AppleTextSystem::new()),
    );
    app.update(|cx| {
        gpui_kit::init(cx);
        cx.text_system()
            .add_fonts(vec![
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Regular.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Medium.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-SemiBold.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Bold.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Regular.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Bold.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Italic.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-BoldItalic.ttf")),
            ])
            .unwrap();
        cx.text_system()
            .add_fonts(crate::editor::view::style::font_bytes())
            .unwrap();
    });
    app
}

/// Milliseconds one `Window::draw` takes.
pub fn draw(cx: &mut VisualTestContext) -> f64 {
    let t = Instant::now();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    t.elapsed().as_secs_f64() * 1000.
}

/// Sections to benchmark (`PUPPYONE_BENCH_SECTIONS`).
pub fn sections() -> usize {
    std::env::var("PUPPYONE_BENCH_SECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(40)
}

/// Scroll frames to time (`PUPPYONE_BENCH_FRAMES`; more for profiling).
pub fn frames() -> usize {
    std::env::var("PUPPYONE_BENCH_FRAMES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(120)
}

/// Edit samples per operation (`PUPPYONE_BENCH_EDIT_STEPS`; multiple of 5 so
/// progressive 5-step IME composition cycles complete cleanly).
#[allow(dead_code)]
pub fn edit_steps() -> usize {
    std::env::var("PUPPYONE_BENCH_EDIT_STEPS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(25)
}

pub struct Samples(pub Vec<f64>);

impl Samples {
    pub fn mean(&self) -> f64 {
        self.0.iter().sum::<f64>() / self.0.len().max(1) as f64
    }
    pub fn p95(&self) -> f64 {
        let mut v = self.0.clone();
        v.sort_by(|a, b| a.total_cmp(b));
        v.get((v.len() * 95 / 100).min(v.len().saturating_sub(1)))
            .copied()
            .unwrap_or(0.)
    }
}

/// One result line the tool parses.
pub fn report(surface: &str, lines: usize, first: f64, scroll: &Samples, resize: &Samples) {
    po_platform::outputln!(
        "BENCH {}",
        serde_json::json!({
            "surface": surface,
            "sections": sections(),
            "lines": lines,
            "firstMs": first,
            "scrollMeanMs": scroll.mean(),
            "scrollP95Ms": scroll.p95(),
            "resizeMeanMs": resize.mean(),
            "resizeP95Ms": resize.p95(),
        })
    );
}

/// One edit-path result line (`tools/bench-editor.py` `edit` surface).
#[allow(dead_code)]
pub fn report_edit(
    surface: &str,
    lines: usize,
    typing: &Samples,
    arrow: &Samples,
    ime: &Samples,
    find_typing: &Samples,
) {
    po_platform::outputln!(
        "BENCH {}",
        serde_json::json!({
            "surface": surface,
            "sections": sections(),
            "lines": lines,
            "typeMeanMs": typing.mean(),
            "typeP95Ms": typing.p95(),
            "arrowMeanMs": arrow.mean(),
            "arrowP95Ms": arrow.p95(),
            "imeMeanMs": ime.mean(),
            "imeP95Ms": ime.p95(),
            "findTypeMeanMs": find_typing.mean(),
            "findTypeP95Ms": find_typing.p95(),
        })
    );
}

/// One CSV table benchmark line (`CS-30`: `tools/bench-editor.py` `csv` surface).
#[allow(dead_code)]
pub fn report_csv(
    sections: usize,
    rows: usize,
    cols: usize,
    open_ms: f64,
    scroll: &Samples,
    cell_type: &Samples,
    structural: &Samples,
) {
    println!(
        "BENCH {}",
        serde_json::json!({
            "surface": "csv",
            "sections": sections,
            "lines": rows,
            "cols": cols,
            "firstMs": open_ms,
            "scrollMeanMs": scroll.mean(),
            "scrollP95Ms": scroll.p95(),
            "cellTypeMeanMs": cell_type.mean(),
            "cellTypeP95Ms": cell_type.p95(),
            "structuralMeanMs": structural.mean(),
            "structuralP95Ms": structural.p95(),
        })
    );
}

/// One code/text adapter & frame benchmark line (`CE-30`: `code_edit` surface).
#[allow(dead_code)]
pub fn report_code_edit(
    sections: usize,
    lines: usize,
    bytes: usize,
    adapter: &Samples,
    frame: &Samples,
) {
    println!(
        "BENCH {}",
        serde_json::json!({
            "surface": "code_edit",
            "sections": sections,
            "lines": lines,
            "bytes": bytes,
            "keystrokeAdapterMeanMs": adapter.mean(),
            "keystrokeAdapterP95Ms": adapter.p95(),
            "keystrokeFrameMeanMs": frame.mean(),
            "keystrokeFrameP95Ms": frame.p95(),
        })
    );
}

/// One extreme-shape typing & arrow-key benchmark line (`tools/bench-editor.py` `stress` surface).
#[allow(dead_code)]
pub fn report_stress(shape: &str, lines: usize, first: f64, typing: &Samples, arrow: &Samples) {
    po_platform::outputln!(
        "BENCH {}",
        serde_json::json!({
            "surface": "stress",
            "sections": shape,
            "lines": lines,
            "firstMs": first,
            "typeMeanMs": typing.mean(),
            "typeP95Ms": typing.p95(),
            "arrowMeanMs": arrow.mean(),
            "arrowP95Ms": arrow.p95(),
        })
    );
}
