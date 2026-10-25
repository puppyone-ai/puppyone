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
        let _ = w.draw(cx);
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
    println!(
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
