//! Markdown embedded runtime acceptance (`markdownEmbedRuntime.test.ts`):
//! document revisions, fenced code highlighting/budgets/tab widths/anchored
//! in-place edits, escaped table cell editing, and Mermaid cached mount,
//! readable initial zoom, bounded zoom controls, and anchored source editing.
use super::{setup, setup_with_focus};
use crate::{
    editor::{
        markdown::{
            features::{
                code_block::{CodeBlock, highlight},
                mermaid,
                table::model::table_block,
            },
            platform::brokers::render as render_broker,
            style::MarkdownTheme,
        },
        text::{
            change::ChangeSet,
            selection::Selection,
            state::{EditorState, Transaction, UserEvent},
        },
        view::{EditorView, decoration::Block},
    },
    render_service::{self, Rendered},
    typography::Scale,
};
use gpui::{Entity, Modifiers, RenderImage, TestAppContext, VisualTestContext};
use image::{Frame as ImageFrame, RgbaImage};
use std::sync::Arc;

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn widget_id(view: &Entity<EditorView>, cx: &VisualTestContext) -> Option<u64> {
    view.read_with(cx, |v, _| {
        v.decorations().blocks.iter().find_map(|b| match b {
            Block::Widget { id, .. } => Some(id.raw()),
            _ => None,
        })
    })
}

fn click(cx: &mut VisualTestContext, selector: &str) {
    let bounds = cx
        .debug_bounds(Box::leak(selector.to_owned().into_boxed_str()))
        .unwrap_or_else(|| panic!("missing selector {selector}"));
    cx.simulate_click(bounds.center(), Modifiers::none());
    draw(cx);
}

fn dummy_rendered(width: f32, height: f32) -> Rendered {
    let rgba = RgbaImage::from_pixel(4, 4, image::Rgba([24, 32, 48, 255]));
    let image = Arc::new(RenderImage::new(vec![ImageFrame::new(rgba)]));
    Rendered {
        image,
        width,
        height,
        baseline: 0.,
    }
}

/// `uses exact immutable document identities for same-sized revisions`.
#[test]
fn same_sized_edits_produce_distinct_document_revisions() {
    let mut state = EditorState::new("alpha\nbeta");
    let first_rev = state.revision;
    let first_len = state.doc.len();
    let first_lines = state.doc.line_count();

    state
        .apply(Transaction::edit(
            ChangeSet::replace(0..5, "omega"),
            None,
            UserEvent::Input,
        ))
        .expect("same-sized replacement applies");

    assert_eq!(state.doc.len(), first_len);
    assert_eq!(state.doc.line_count(), first_lines);
    assert_eq!(state.doc.as_str(), "omega\nbeta");
    assert_ne!(state.revision, first_rev);
}

/// `renders language-aware syntax tokens behind the editable code surface`,
/// `highlights syntax through the end of code beyond CodeMirror's initial parse viewport`,
/// `keeps plaintext code on the native textarea fallback`, and
/// `falls back to the native textarea when syntax highlighting would exceed its DOM budget`.
#[test]
fn code_block_highlighting_covers_tokens_long_code_plaintext_and_budget_fallback() {
    let colors = MarkdownTheme::resolve(true, Scale::Medium)
        .code_block
        .syntax;

    let sample = r#"interface User { name: "Alice" }"#;
    let tokens = highlight::highlight(sample, "ts", &colors);
    let has_token = |source: &str,
                     spans: &[(std::ops::Range<usize>, gpui::HighlightStyle)],
                     needle: &str,
                     color: gpui::Rgba| {
        let start = source.rfind(needle).unwrap();
        let expected = start..start + needle.len();
        spans.iter().any(|(range, style)| {
            range.start <= expected.start
                && range.end >= expected.end
                && style.color == Some(color.into())
        })
    };
    assert!(
        has_token(sample, &tokens, "interface", colors.keyword),
        "expected keyword highlight for interface: {tokens:?}"
    );
    assert!(
        has_token(sample, &tokens, "\"Alice\"", colors.string),
        "expected string highlight for \"Alice\": {tokens:?}"
    );

    let long_code = format!("{}return value;", "let value = 1;\n".repeat(300));
    let long_tokens = highlight::highlight(&long_code, "ts", &colors);
    assert!(
        has_token(&long_code, &long_tokens, "return", colors.keyword),
        "tail `return` past initial viewport must still highlight (got {} spans)",
        long_tokens.len()
    );

    assert!(highlight::grammar("unknown").is_none());
    assert!(highlight::highlight("plain text", "unknown", &colors).is_empty());

    let over_budget = (0..500)
        .map(|i| format!("const value{i} = {i};"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        highlight::highlight(&over_budget, "ts", &colors).is_empty(),
        "500-line code block exceeding token budget must fall back to plain text"
    );
}

/// `keeps syntax tokens synchronized while code is edited` and
/// `reparses the code when its language is changed in Markdown source`.
#[gpui::test]
fn code_block_highlighting_updates_on_code_and_language_edits(cx: &mut TestAppContext) {
    let colors = MarkdownTheme::resolve(true, Scale::Medium)
        .code_block
        .syntax;
    let has_color = |code: &str, lang: &str, needle: &str, color: gpui::Rgba| {
        let start = code.find(needle).unwrap();
        let expected = start..start + needle.len();
        highlight::highlight(code, lang, &colors)
            .iter()
            .any(|(r, s)| {
                r.start <= expected.start && r.end >= expected.end && s.color == Some(color.into())
            })
    };

    // Editing code inside a TS fence immediately updates syntax tokens.
    let source = "```ts\nconst value = 1;\n```";
    let (view, visual) = setup(cx, source);
    draw(visual);
    assert!(has_color("const value = 1;", "ts", "const", colors.keyword));
    let body_start = source.find("const value = 1;").unwrap();
    let body_end = body_start + "const value = 1;".len();
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(body_start..body_end, "return \"next\";"),
                None,
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "```ts\nreturn \"next\";\n```");
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text == "return \"next\";")
        );
    });
    assert!(has_color(
        "return \"next\";",
        "ts",
        "return",
        colors.keyword
    ));
    assert!(has_color(
        "return \"next\";",
        "ts",
        "\"next\"",
        colors.string
    ));

    // Changing the fence language from `txt` to `typescript` switches from plain to highlighted.
    let txt_source = "```txt\nconst value = 1;\n```";
    let (view, visual) = setup_with_focus(cx, txt_source, false);
    draw(visual);
    let current_code_block = |v: &EditorView| -> CodeBlock {
        let md = v
            .extension::<crate::editor::markdown::MarkdownExtension>()
            .unwrap();
        let cache = md.cache.borrow();
        let parsed = cache.parsed.as_ref().unwrap();
        parsed
            .plans
            .iter()
            .find_map(|p| p.embed()?.model::<CodeBlock>())
            .cloned()
            .expect("code block plan")
    };
    view.read_with(visual, |v, _| {
        let block = current_code_block(v);
        assert_eq!(block.language, "txt");
        assert!(highlight::highlight("const value = 1;", &block.language, &colors).is_empty());
    });
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(3..6, "typescript"),
                None,
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        let block = current_code_block(v);
        assert_eq!(block.language, "typescript");
        assert!(has_color(
            "const value = 1;",
            &block.language,
            "const",
            colors.keyword
        ));
    });
}

/// `uses the resolved language tab width for both code layers`,
/// `keeps a mounted code block anchored after an edit before its widget`, and
/// `preserves the source language when editing a code-only panel`.
#[gpui::test]
fn code_block_uses_language_tab_width_and_keeps_identity_and_fence_across_edits(
    cx: &mut TestAppContext,
) {
    // Python expands tabs to 4 columns; TypeScript uses 2.
    let (py_view, py_cx) = setup_with_focus(cx, "```python\n\treturn True\n```", false);
    draw(py_cx);
    py_view.read_with(py_cx, |v, _| {
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text == "    return True"),
            "python fence must expand leading tab to 4 spaces: {:?}",
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .map(|l| l.entry.text.text.as_str())
                .collect::<Vec<_>>()
        );
    });
    let (ts_view, ts_cx) = setup_with_focus(cx, "```ts\n\treturn true;\n```", false);
    draw(ts_cx);
    ts_view.read_with(ts_cx, |v, _| {
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text == "  return true;"),
            "ts fence must expand leading tab to 2 spaces"
        );
    });

    // Prefix edits keep the mounted code block's BlockId and edits update its shifted slice.
    let source = "Intro\n\n```ts\nold\n```";
    let (view, visual) = setup(cx, source);
    draw(visual);
    let before_id = widget_id(&view, visual).expect("code block mounted");
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(0..0, "Shifted\n"),
                Some(Selection::cursor(0)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    assert_eq!(widget_id(&view, visual), Some(before_id));
    let old_start = view.read_with(visual, |v, _| v.text().find("old").unwrap());
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(old_start, old_start + 3), cx);
    });
    visual.simulate_input("new");
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "Shifted\nIntro\n\n```ts\nnew\n```");
    });

    // Editing inside a tilde code fence preserves its authored fence and language without rewriting.
    let tilde_source = "~~~js\nold\n~~~";
    let (view, visual) = setup(cx, tilde_source);
    draw(visual);
    let old_at = tilde_source.find("old").unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(old_at, old_at + 3), cx);
    });
    visual.simulate_input("new");
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "~~~js\nnew\n~~~");
    });
}

/// `commits an escaped table cell against the exact Markdown source slice`.
#[gpui::test]
fn escaped_table_cell_renders_and_edits_against_its_exact_source_slice(cx: &mut TestAppContext) {
    let source = "| a\\|b |\n| --- |";
    let (view, visual) = setup(cx, source);
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        let model = table_block(&v.state().doc, &(0..source.len())).expect("table model");
        assert_eq!(model.rows[0].cells[0].text, "a|b");
        assert_eq!(
            v.state().doc.slice(model.rows[0].cells[0].range.clone()),
            "a\\|b"
        );
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text == "a|b")
        );
    });

    // Editing the escaped cell updates its exact source slice in place while keeping `\|`.
    let b_pos = source.find('b').unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(b_pos, b_pos + 1), cx);
    });
    visual.simulate_input("c");
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(v.text().len()), cx);
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "| a\\|c |\n| --- |");
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text == "a|c")
        );
    });
}

/// `binds Mermaid async work to a real revision-scoped execution session`,
/// `mounts cached Mermaid output synchronously without loading or a new render`, and
/// `starts dense Mermaid diagrams at a readable scale and exposes bounded zoom controls`.
#[gpui::test]
fn mermaid_cached_mount_readable_zoom_and_superseding_cancellation(cx: &mut TestAppContext) {
    // Slot-scoped cancellation: editing `A` -> `X` supersedes the pending render key.
    let mut queue: render_broker::RenderQueueCore<&'static str> =
        render_broker::RenderQueueCore::new(16);
    let req_a = mermaid::widget::request_for_tests("graph TD; A-->B", true, Scale::Medium, 1.0);
    let req_x = mermaid::widget::request_for_tests("graph TD; X-->B", true, Scale::Medium, 1.0);
    let key_a = render_broker::cache_key(&req_a);
    let key_x = render_broker::cache_key(&req_x);
    assert_ne!(key_a, key_x);
    assert_eq!(queue.request((1, 0), key_a), None);
    assert_eq!(queue.request((1, 0), key_x), None);
    assert_eq!(
        queue.pop_next(),
        Some(key_x),
        "superseded diagram revision A must be skipped in favor of X"
    );

    // Warm cache mounts synchronously without showing loading or queueing a new render,
    // and starts a dense 1000x400 diagram at 70% with bounded +10% zoom controls.
    let diagram_source = "graph TD; A-->B";
    let rendered = dummy_rendered(1000., 400.);
    for scale in [1.0, 0.75] {
        let req = mermaid::widget::request_for_tests(diagram_source, true, Scale::Medium, scale);
        render_service::seed_ready_for_tests(&req, rendered.clone());
    }
    let source = format!("```mermaid\n{diagram_source}\n```");
    let (_view, visual) = setup_with_focus(cx, &source, false);
    draw(visual);

    assert!(visual.debug_bounds("md-mermaid-canvas").is_some());
    assert!(visual.debug_bounds("md-mermaid-loading").is_none());
    assert!(!render_service::has_in_flight_for_tests(&req_a));
    assert!(
        visual.debug_bounds("md-mermaid-zoom:70%").is_some(),
        "dense 1000px diagram should start at readable 70% minimum scale"
    );

    click(visual, "md-mermaid-zoom-in");
    assert!(
        visual.debug_bounds("md-mermaid-zoom:80%").is_some(),
        "clicking zoom-in should step from 70% to 80%"
    );
}

/// `creates a delayed Mermaid edit session from the widget's mapped range`.
#[gpui::test]
fn mermaid_widget_stays_anchored_and_edits_mapped_source_after_prefix_edit(
    cx: &mut TestAppContext,
) {
    let source = "Intro\n\n```mermaid\ngraph TD; A-->B\n```";
    let (view, visual) = setup(cx, source);
    view.update(visual, |v, cx| v.set_selection(Selection::cursor(0), cx));
    draw(visual);
    let before_id = widget_id(&view, visual).expect("mermaid widget mounted");

    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(0..0, "Shifted\n"),
                Some(Selection::cursor(0)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    assert_eq!(widget_id(&view, visual), Some(before_id));

    click(visual, "md-mermaid-edit");
    assert!(visual.debug_bounds("md-mermaid-done").is_some());
    visual.simulate_keystrokes("backspace");
    visual.simulate_input("C");
    draw(visual);
    click(visual, "md-mermaid-done");
    assert!(visual.debug_bounds("md-mermaid-edit").is_some());
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            "Shifted\nIntro\n\n```mermaid\ngraph TD; A-->C\n```"
        );
    });
}
