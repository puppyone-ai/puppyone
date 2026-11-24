//! End-to-end Markdown pipeline acceptance (`TA-11`, `TA-13`, `TA-14`, `TA-31`,
//! `TA-32`, `TA-33`, `TA-81`, T7): full vs incremental syntax/plans/decorations
//! equivalence, deferred tail splitting & byte shifting, paragraph cache & BlockId
//! stability, feature panic isolation, and seeded random layout invariants.
use super::{blocks, setup};
use crate::{
    editor::{
        markdown::{MarkdownExtension, features::task},
        text::selection::Selection,
        view::{EditorView, bind_keys, extension::config_transaction, style},
    },
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext};

#[test]
fn random_markdown_and_edits_never_panic_the_pipeline() {
    use crate::editor::markdown::{
        composition::{FEATURES, MDX_FEATURES},
        core::{
            decorations::{self, DecorateCx},
            features::Features,
            plans,
            presentation::block_rhythm,
            state::PreviewState,
            syntax::Syntax,
        },
        style::MarkdownTheme,
    };
    use crate::editor::text::{
        change::ChangeSet,
        state::{EditorState, Transaction, UserEvent},
    };

    const FRAGMENTS: &[&str] = &[
        "\n",
        "\n\n",
        " ",
        "\\",
        "{",
        "}",
        "$$\n",
        "\n$$\n",
        "```math\n",
        "```mermaid\ngraph TD\nA-->B\n",
        "```\n",
        "~~~\n",
        "x^{\\",
        "\\frac{\\",
        "\\sqrt{\\",
        "\\sqrt[3\\",
        "\\mathbb{\\",
        "$\\alpha + x^{\\$",
        "<Tabs/>",
        "<Tabs />\n",
        "<Tabs>\n<Tab label=\"a\">\n",
        "\n</Tab>\n</Tabs>\n",
        "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
        "| \\| | [[w|a]] |\n",
        "- [ ] ",
        "- [x] ",
        "1. ",
        "> [!TIP]- Title\n> ",
        "### Heading ",
        "---\ntitle: Plan\n---\n",
        "[^1] ",
        "[^1]: note\n",
        "[[wiki|alias]]",
        "![alt](img.png)",
        "[link](https://example.com)",
        "<div align=\"center\"><b>hi</b></div>\n",
        "<details><summary>s</summary>x</details>\n",
        "`code`",
        "**bold**",
        "~~strike~~",
        "==mark==",
        "%%comment%%",
        "&amp; :smile: ",
        "中文段落",
        "🧪",
        "e\u{0301}",
    ];

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        }
        fn below(&mut self, bound: usize) -> usize {
            if bound <= 1 {
                0
            } else {
                (self.next() as usize) % bound
            }
        }
        fn pick<'a>(&mut self, items: &'a [&'a str]) -> &'a str {
            items[self.below(items.len())]
        }
    }

    let iterations = std::env::var("PUPPYONE_PIPELINE_FUZZ_ITERATIONS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(64);
    let seed = std::env::var("PUPPYONE_PIPELINE_FUZZ_SEED")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0x5eed_c0de_1300_0001);
    let theme = MarkdownTheme::resolve(true, Scale::Medium);

    let check = |state: &EditorState, preview: &PreviewState, features: Features, live: bool| {
        let syntax = Syntax::parse_with(&state.doc, features);
        let compiled = plans::compile(&state.doc, &syntax, &preview.features, features);
        let composing = preview.composing.map(|c| state.doc.line_index(c));
        let rhythm = block_rhythm(&state.doc, &syntax, composing);
        let _ = decorations::decorate(&DecorateCx {
            doc: &state.doc,
            syntax: &syntax,
            plans: &compiled,
            rhythm: &rhythm,
            theme: &theme,
            preview,
            live,
            features,
            assets: None,
            references: None,
            inline_preview: Some(&crate::editor::markdown::composition::preview::PREVIEW),
        });
        let _ = preview.normalize(&state.doc, &syntax, state.selection);
    };

    for (dialect_index, features) in [(0u64, FEATURES), (1u64, MDX_FEATURES)] {
        let mut rng = Rng(seed ^ dialect_index.wrapping_mul(0xd1b5_4a32_d192_ed03));
        for _ in 0..iterations {
            let mut initial = String::new();
            for _ in 0..=rng.below(14) {
                initial.push_str(rng.pick(FRAGMENTS));
            }
            let mut state = EditorState::new(&initial);
            let mut preview = PreviewState::default();
            check(&state, &preview, features, true);

            for step in 0..12 {
                let a = state.doc.clamp(rng.below(state.doc.len() + 1));
                let b = state.doc.clamp(rng.below(state.doc.len() + 1));
                let range = a.min(b)..a.max(b);
                let mut insert = String::new();
                for _ in 0..rng.below(4) {
                    insert.push_str(rng.pick(FRAGMENTS));
                }
                let caret =
                    rng.below(state.doc.len().saturating_sub(range.len()) + insert.len() + 1);
                let tr = Transaction::edit(
                    ChangeSet::replace(range, insert),
                    None,
                    if step % 3 == 0 {
                        UserEvent::Delete
                    } else {
                        UserEvent::Input
                    },
                );
                if let Some(applied) = state.apply(tr) {
                    let syntax = Syntax::parse_with(&state.doc, features);
                    preview.applied(&applied, &state, &syntax, true, false);
                }
                let head = state.doc.clamp(caret);
                let _ = state.apply(Transaction::select(Selection::cursor(head)));
                let syntax = Syntax::parse_with(&state.doc, features);
                preview.selection_changed(&state, &syntax, true, step % 5 == 0, step % 7 == 0);
                check(&state, &preview, features, step % 11 != 0);
            }
        }
    }
}

#[test]
fn incremental_syntax_and_plans_match_full_parse_across_random_edits() {
    use crate::editor::markdown::{
        composition::{FEATURES, MDX_FEATURES},
        core::{
            plans::{self, PlanCache},
            state::FeatureStateStore,
            syntax::Syntax,
        },
    };
    use crate::editor::text::{
        change::ChangeSet,
        state::{EditorState, Transaction, UserEvent},
    };

    const BLOCK_POOL: &[&str] = &[
        "# Heading One\n\n",
        "Paragraph with **bold**, *italic*, $x^2 + 1$, and [ref][k].\n\n",
        "[k]: https://example.com\n\n",
        "- [ ] first task\n- [x] second task\n\n",
        "1. ordered alpha\n2. ordered beta\n\n",
        "> [!note]+ Callout\n> quoted body [^1]\n\n",
        "[^1]: footnote body\n\n",
        "```rust\nfn main() {}\n```\n\n",
        "$$\n\\sum_{i=1}^n i\n$$\n\n",
        "| col1 | col2 |\n| --- | --- |\n| val1 | val2 |\n\n",
        "<Tabs>\n<Tab label=\"One\">\nBody 1\n</Tab>\n<Tab label=\"Two\">\nBody 2\n</Tab>\n</Tabs>\n\n",
    ];

    let mut seed = 0x71a2_94b3_c5d6_e701u64;
    let mut next_usize = |bound: usize| -> usize {
        seed = seed.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = seed;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) as usize) % bound.max(1)
    };

    let mut incremental_hits = 0usize;
    for features in [FEATURES, MDX_FEATURES] {
        for _case in 0..40 {
            let mut text = String::new();
            for _ in 0..18 {
                text.push_str(BLOCK_POOL[next_usize(BLOCK_POOL.len())]);
            }
            let mut state = EditorState::new(&text);
            let folds = FeatureStateStore::default();
            let mut cur_syntax = Syntax::parse_with(&state.doc, features);
            let mut plan_cache = PlanCache::default();
            let mut cur_plans = plans::compile(&state.doc, &cur_syntax, &folds, features);

            for _step in 0..10 {
                let a = state.doc.clamp(next_usize(state.doc.len() + 1));
                let b = state.doc.clamp((a + next_usize(24)).min(state.doc.len()));
                let range = a.min(b)..a.max(b);
                let replacement = match next_usize(6) {
                    0 => "word",
                    1 => "**strong**",
                    2 => "$a+b$",
                    3 => "\nnew line\n",
                    4 => "",
                    _ => BLOCK_POOL[next_usize(BLOCK_POOL.len())],
                };
                let tr = Transaction::edit(
                    ChangeSet::replace(range, replacement),
                    None,
                    UserEvent::Input,
                );
                let Some(applied) = state.apply(tr) else {
                    continue;
                };
                let full_syntax = Syntax::parse_with(&state.doc, features);
                let full_plans = plans::compile(&state.doc, &full_syntax, &folds, features);
                let prev_element_count = cur_syntax.elements.len();

                if let Some((inc_syntax, splice)) = Syntax::try_parse_incremental(
                    &state.doc,
                    &applied.before_doc,
                    &cur_syntax,
                    &applied.changes,
                    features,
                ) {
                    incremental_hits += 1;
                    assert_eq!(
                        inc_syntax, full_syntax,
                        "incremental Syntax diverged from full Syntax::parse_with"
                    );
                    let inc_plans = plans::compile_incremental(
                        &state.doc,
                        &inc_syntax,
                        &cur_plans,
                        prev_element_count,
                        &splice,
                        &folds,
                        features,
                        &mut plan_cache,
                    );
                    let mut refreshed_plans = inc_plans.clone();
                    plans::refresh_shifted_block_plans(
                        &state.doc,
                        &inc_syntax,
                        &folds,
                        features,
                        &mut refreshed_plans,
                        0..state.doc.len(),
                    );
                    assert_eq!(
                        refreshed_plans, full_plans,
                        "incremental Plans diverged from full plans::compile"
                    );
                    cur_syntax = inc_syntax;
                    cur_plans = inc_plans;
                } else {
                    cur_syntax = full_syntax;
                    plan_cache = PlanCache::default();
                    cur_plans = full_plans;
                }
            }
        }
    }
    // An edit beside an unbalanced HTML block parses the whole document when
    // another one lies outside the window (they may pair as an HTML flow), and
    // the `<Tabs>` blocks here are often cut open by these edits.
    assert!(
        incremental_hits >= 190,
        "expected majority of localized edits to take incremental path, got {incremental_hits}"
    );
}

#[gpui::test]
fn cursor_movement_rebuilds_zero_document_layer_blocks_and_zero_full_height_plans(
    cx: &mut TestAppContext,
) {
    let text = concat!(
        "# Heading Alpha\n\n",
        "First paragraph with **bold words**, *emphasis*, and $E = mc^2$ inline math.\n\n",
        "> [!note]+ Callout Title\n> Inside callout body\n\n",
        "```rust\nfn demo() -> i32 { 42 }\n```\n\n",
        "| k | v |\n| - | - |\n| 1 | 2 |\n\n",
        "Final prose line with `inline code`.\n",
    );
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });

    let (rebuilds_before, full_plans_before) =
        view.read_with(cx, |v, _| (v.doc_layer_rebuilds(), v.height_map_stats().0));
    assert_eq!(rebuilds_before, 1);

    for chord in [
        "down", "down", "right", "right", "right", "down", "down", "up",
    ] {
        cx.simulate_keystrokes(chord);
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    }

    let (rebuilds_after, full_plans_after) =
        view.read_with(cx, |v, _| (v.doc_layer_rebuilds(), v.height_map_stats().0));
    assert_eq!(
        rebuilds_after, rebuilds_before,
        "ArrowDown/ArrowRight MUST rebuild 0 Document-Layer decoration snapshots"
    );
    assert_eq!(
        full_plans_after, full_plans_before,
        "ArrowDown/ArrowRight MUST rebuild 0 full HeightMap plans"
    );
}

#[gpui::test]
fn typing_on_upper_line_preserves_paragraph_cache_hits_for_lines_below(cx: &mut TestAppContext) {
    let mut initial = String::from("editable first line\n\n");
    for idx in 0..12 {
        initial.push_str(&format!("unchanged prose line number {idx}\n\n"));
    }
    let (view, cx) = setup(cx, &initial);
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(8), cx));
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });

    let (hits_before, misses_before) = view.read_with(cx, |v, _| v.paragraph_cache_stats());
    cx.simulate_input("X");
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    let (hits_after, misses_after) = view.read_with(cx, |v, _| v.paragraph_cache_stats());
    let new_hits = hits_after - hits_before;
    let new_misses = misses_after - misses_before;
    assert!(
        new_hits >= 10,
        "unchanged lines below edit should hit ParagraphCache (new_hits={new_hits}, new_misses={new_misses})"
    );
    assert!(
        new_misses <= 2,
        "only the edited line should miss ParagraphCache, got new_misses={new_misses}"
    );
}

#[gpui::test]
fn block_id_remains_stable_across_prefix_edits_and_reuses_unchanged_widget_rc(
    cx: &mut TestAppContext,
) {
    use crate::editor::view::decoration::Block;
    use std::rc::Rc;

    let text = "header line\n\n$$\na = 1\n$$\n\n```rust\nlet x = 1;\n```\n";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });

    let before_widgets: Vec<_> = view.update(cx, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Widget { id, widget, .. } => Some((id.raw(), Rc::clone(widget))),
                Block::Line { .. } => None,
            })
            .collect()
    });
    assert_eq!(before_widgets.len(), 2);

    // Edit line 0 above both block widgets.
    cx.simulate_input("updated ");
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });

    let after_widgets: Vec<_> = view.update(cx, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Widget { id, widget, .. } => Some((id.raw(), Rc::clone(widget))),
                Block::Line { .. } => None,
            })
            .collect()
    });
    assert_eq!(after_widgets.len(), 2);
    assert_eq!(
        before_widgets[0].0, after_widgets[0].0,
        "MathBlock BlockId must stay stable"
    );
    assert_eq!(
        before_widgets[1].0, after_widgets[1].0,
        "CodeBlock BlockId must stay stable"
    );
}

#[gpui::test]
fn panicking_features_fall_back_to_visible_source_and_log_once(cx: &mut TestAppContext) {
    use crate::editor::markdown::{
        core::{
            decorations::{BlockDecoration, LineDecoration},
            features::{
                CommandCx, CompileCx, FEATURE_PANIC_EVENT, Features, MarkdownFeature,
                WidgetFactoryCx,
            },
            plans::{BlockEmbed, Plan, Presentation},
            state::PreviewState,
            syntax::{Element, Kind},
        },
        features::math,
    };
    use crate::editor::{
        text::state::{EditorState, Transaction},
        view::{
            command::Command,
            decoration::Block,
            widget::{BlockWidget, WidgetCx},
        },
    };
    use gpui::AnyElement;
    use std::rc::Rc;

    struct PanicElement;
    impl MarkdownFeature for PanicElement {
        fn id(&self) -> &'static str {
            "test-panic-element"
        }
        fn semantic_kinds(&self) -> &'static [Kind] {
            &[Kind::Rule]
        }
        fn compile_element(&self, _: usize, _: &Element, _: &CompileCx) -> Option<Plan> {
            panic!("boom in compile_element");
        }
    }

    struct PanicBlocks;
    impl MarkdownFeature for PanicBlocks {
        fn id(&self) -> &'static str {
            "test-panic-blocks"
        }
        fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
            let line = cx.doc.line_range(0);
            out.push(Plan {
                element: None,
                source: line.clone(),
                presentation: Presentation::BlockAtom(BlockEmbed::new("test-panic-blocks", 1usize)),
                delete_units: Vec::new(),
            });
            panic!("boom in compile_blocks");
        }
    }

    struct PanicWidget;
    impl MarkdownFeature for PanicWidget {
        fn id(&self) -> &'static str {
            "test-panic-widget"
        }
        fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
            for line in 0..cx.doc.line_count() {
                if cx.doc.line_cow(line) == ":::panic" {
                    let range = cx.doc.line_range(line);
                    out.push(Plan {
                        element: None,
                        source: range.clone(),
                        presentation: Presentation::BlockAtom(BlockEmbed::new(
                            "test-panic-widget",
                            range,
                        )),
                        delete_units: Vec::new(),
                    });
                }
            }
        }
        fn block_widget(&self, _: &BlockEmbed, _: &WidgetFactoryCx) -> Option<Rc<dyn BlockWidget>> {
            panic!("boom in block_widget");
        }
        fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
            if let Some(range) = embed.model::<std::ops::Range<usize>>() {
                cx.atomic(range.clone());
            }
        }
    }

    struct PanicRenderWidget;
    impl BlockWidget for PanicRenderWidget {
        fn render(&self, _: &mut WidgetCx) -> (AnyElement, f32) {
            panic!("boom in BlockWidget::render");
        }
    }

    struct PanicHooks;
    impl MarkdownFeature for PanicHooks {
        fn id(&self) -> &'static str {
            "test-panic-hooks"
        }
        fn recognize_inline(&self, _line_start: usize, line_text: &str, out: &mut Vec<Element>) {
            if line_text.contains("bad-bounds") {
                // Deliberately emit an out-of-bounds span; `Syntax` clamps it (`TA-33`).
                out.push(Element::new(
                    Kind::FeatureInline("bad"),
                    999_999..1_000_005,
                    Vec::new(),
                    None,
                ));
            }
        }
        fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
            for line in 0..cx.doc.line_count() {
                if cx.doc.line_cow(line) == ":::panic-render" {
                    let range = cx.doc.line_range(line);
                    out.push(Plan {
                        element: None,
                        source: range.clone(),
                        presentation: Presentation::BlockAtom(BlockEmbed::new(
                            "test-panic-hooks",
                            range,
                        )),
                        delete_units: Vec::new(),
                    });
                }
            }
        }
        fn block_widget(&self, _: &BlockEmbed, _: &WidgetFactoryCx) -> Option<Rc<dyn BlockWidget>> {
            Some(Rc::new(PanicRenderWidget))
        }
        fn decorate_block(&self, _: &BlockEmbed, _: &mut BlockDecoration) {
            panic!("boom in decorate_block");
        }
        fn decorate_line(&self, d: &mut LineDecoration) {
            if d.doc.slice_cow(d.range.clone()).contains("panic-line") {
                panic!("boom in decorate_line");
            }
        }
        fn view_command(
            &self,
            cmd: &Command,
            _: &mut PreviewState,
            _: &EditorState,
        ) -> Option<Transaction> {
            if cmd.payload::<&'static str>() == Some(&"panic-view") {
                panic!("boom in view_command");
            }
            None
        }
        fn command(&self, _: &Command, _: &CommandCx) -> Option<Transaction> {
            panic!("boom in command");
        }
    }

    static PANIC_ELEMENT: PanicElement = PanicElement;
    static PANIC_BLOCKS: PanicBlocks = PanicBlocks;
    static PANIC_WIDGET: PanicWidget = PanicWidget;
    static PANIC_HOOKS: PanicHooks = PanicHooks;
    static TEST_FEATURES: Features = &[
        &PANIC_ELEMENT,
        &PANIC_BLOCKS,
        &PANIC_WIDGET,
        &PANIC_HOOKS,
        &math::FEATURE,
        &task::FEATURE,
    ];

    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let text = concat!(
        "---\n\n",
        ":::panic\n\n",
        ":::panic-render\n\n",
        "panic-line and bad-bounds\n\n",
        "$$\nE = mc^2\n$$\n\n",
        "- [ ] healthy\n",
    );
    let (view, cx) = cx.add_window_view(move |_, cx| {
        let mut md = MarkdownExtension::new(true, Scale::Medium);
        md.test_features = Some(TEST_FEATURES);
        EditorView::new(text, Box::new(md), cx)
    });
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(text.len()), cx);
        // Panicking `view_command` and `command` must be isolated (`TA-33`).
        v.run_command(&Command::new("test-panic-hooks", "panic-view"), w, cx);
        v.run_command(&Command::new("test-panic-hooks", "panic-cmd"), w, cx);
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });

    view.update(cx, |v, _| {
        let decos = v.decorations();
        let widgets: Vec<_> = decos
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Widget { lines, .. } => Some(lines.clone()),
                Block::Line { .. } => None,
            })
            .collect();
        // `:::panic-render` mounts its widget (which falls back safely during `render`)
        // alongside the healthy math widget `8..11`.
        assert_eq!(widgets, vec![4..5, 8..11]);
        let panic_line = v.state().doc.line_range(2);
        assert!(
            !decos
                .hidden
                .iter()
                .any(|h| h.start < panic_line.end && panic_line.start < h.end),
            ":::panic line must remain visible source: {:?}",
            decos.hidden
        );
    });

    let task_offset = text.find("- [ ] healthy").unwrap();
    view.update_in(cx, |v, w, cx| {
        let task_line = v.state().doc.line_index(task_offset);
        v.run_command(&task::toggle_command(task_line), w, cx);
    });
    cx.simulate_input("!");
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.update(cx, |v, _| {
        assert!(v.text().contains("- [x] healthy"));
    });

    let events = crate::platform::diagnostics::recorded(FEATURE_PANIC_EVENT);
    for (id, stage) in [
        ("test-panic-element", "compile_element"),
        ("test-panic-blocks", "compile_blocks"),
        ("test-panic-widget", "block_widget"),
    ] {
        let matching: Vec<_> = events
            .iter()
            .filter(|e| e["fields"]["feature"] == id && e["fields"]["stage"] == stage)
            .collect();
        assert_eq!(
            matching.len(),
            1,
            "feature {id}/{stage} should be logged once per session, got {matching:?}"
        );
    }
}

/// Deferred suffix tail splitting (`Parsed::tail`) and deferred inline
/// decoration byte shifting (`Decorations::deferred`) must stay bit-for-bit
/// equivalent to a full fresh parse + compile + decorate across repeated
/// typing, IME composition, newline edits, forward/backward jumps, unclosed
/// fences, and full materialisation (`TA-81`).
#[test]
fn deferred_tail_and_deferred_byte_shift_match_full_pipeline_across_edits() {
    use crate::editor::{
        markdown::{
            composition::FEATURES,
            core::{plans, syntax::Syntax},
        },
        text::state::{EditorState, UserEvent},
        view::extension::EditorExtension,
    };

    let mut ext = MarkdownExtension::new(true, Scale::Medium);
    let mut state = EditorState::new(&sectioned_document(40));

    // Initial full build.
    let _ = ext.decorate_document(&state, true);

    // 1. Typing & IME cycle in Section 15 (middle): detaches tail and defers byte shift.
    let mut pos = state.doc.as_str().find("Paragraph 15 with").unwrap() + "Paragraph 15 ".len();
    for ch in ["a", "b", "c"] {
        apply_markdown_edit(&mut ext, &mut state, pos..pos, ch, UserEvent::Input);
        pos += ch.len();
        let doc_rc = ext.decorate_document(&state, true);
        assert!(
            doc_rc.has_deferred_shift(),
            "typing must use deferred suffix byte shift"
        );
        drop(doc_rc);
    }
    assert!(
        ext.cache.borrow().parsed.as_ref().unwrap().tail.is_some(),
        "repeated middle edits must retain detached suffix tail"
    );
    // IME preedit -> multi-byte CJK commit.
    let ime_start = pos;
    let mut ime_end = pos;
    for s in ["n", "ni", "nihao", "你好"] {
        apply_markdown_edit(
            &mut ext,
            &mut state,
            ime_start..ime_end,
            s,
            UserEvent::Compose,
        );
        ime_end = ime_start + s.len();
        assert_matches_full_pipeline(&ext, &state, &format!("ime-{s}"));
    }

    // 2. Insert and delete a newline in Section 15 (tests line_delta != 0 with detached tail).
    apply_markdown_edit(
        &mut ext,
        &mut state,
        ime_end..ime_end,
        "\nSecond line",
        UserEvent::Input,
    );
    assert_matches_full_pipeline(&ext, &state, "newline-insert");
    apply_markdown_edit(
        &mut ext,
        &mut state,
        ime_end..ime_end + "\nSecond line".len(),
        "",
        UserEvent::Delete,
    );
    assert_matches_full_pipeline(&ext, &state, "newline-delete");

    // 3. Jump forward into the detached tail (Section 30) and edit.
    let fwd = state.doc.as_str().find("Paragraph 30 with").unwrap() + "Paragraph 30 ".len();
    apply_markdown_edit(&mut ext, &mut state, fwd..fwd, "FORWARD ", UserEvent::Input);
    assert_matches_full_pipeline(&ext, &state, "jump-forward");

    // 4. Jump backward before the deferred split (Section 3) and edit.
    let bwd = state.doc.as_str().find("Paragraph 3 with").unwrap() + "Paragraph 3 ".len();
    apply_markdown_edit(&mut ext, &mut state, bwd..bwd, "BACK ", UserEvent::Input);
    assert_matches_full_pipeline(&ext, &state, "jump-backward");

    // 5. Type an unclosed fence inside prefix (must gracefully materialise tail, never duplicate it).
    let fence_pos = state.doc.as_str().find("Paragraph 5 with").unwrap();
    apply_markdown_edit(
        &mut ext,
        &mut state,
        fence_pos..fence_pos,
        "```rust\n",
        UserEvent::Input,
    );
    assert_matches_full_pipeline(&ext, &state, "unclosed-fence");
    apply_markdown_edit(
        &mut ext,
        &mut state,
        fence_pos..fence_pos + "```rust\n".len(),
        "",
        UserEvent::Delete,
    );
    assert_matches_full_pipeline(&ext, &state, "remove-unclosed-fence");

    // 6. Full syntax & plans equivalence after materialisation via `parse()`.
    let (syn, pl) = ext.parse(&state);
    let expected_syn = Syntax::parse_with(&state.doc, FEATURES);
    let expected_pl = plans::compile(&state.doc, &expected_syn, &ext.preview.features, FEATURES);
    assert_eq!(
        *syn, expected_syn,
        "materialised Syntax must equal fresh parse"
    );
    assert_eq!(pl.len(), expected_pl.len(), "materialised Plan count");
    let mut refreshed_pl = (*pl).clone();
    plans::refresh_shifted_block_plans(
        &state.doc,
        &syn,
        &ext.preview.features,
        FEATURES,
        &mut refreshed_pl,
        0..state.doc.len(),
    );
    assert_eq!(
        refreshed_pl, expected_pl,
        "materialised Plans after shifted-block refresh must equal fresh compile"
    );
}

/// Random edits anywhere in a long document (in the prefix, inside the
/// detached tail, across block boundaries) keep the incremental pipeline equal
/// to a full rebuild after every step. Reproduce a failure with the printed seed
/// (`PUPPYONE_PIPELINE_DIFF_SEED`); `PUPPYONE_PIPELINE_DIFF_EDITS` runs longer.
#[test]
fn random_edits_keep_the_incremental_pipeline_equal_to_a_full_rebuild() {
    use crate::editor::{
        text::state::{EditorState, UserEvent},
        view::extension::EditorExtension,
    };
    const FRAGMENTS: &[&str] = &[
        "a",
        "word ",
        "中文",
        "🧪",
        " ",
        "\n",
        "\n\n",
        "**",
        "`",
        "[link](x)",
        "- ",
        "- [ ] ",
        "1. ",
        "## ",
        "> ",
        "```\n",
        "```rust\n",
        "| a | b |\n| - | - |\n",
        "$$\n",
        "[^1]",
        "[^1]: note\n",
        "<div>\n",
        "</div>\n",
        "%%",
        "---\n",
    ];
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        }
        fn below(&mut self, bound: usize) -> usize {
            if bound <= 1 {
                0
            } else {
                (self.next() as usize) % bound
            }
        }
    }
    let edits = std::env::var("PUPPYONE_PIPELINE_DIFF_EDITS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(120);
    let seed = std::env::var("PUPPYONE_PIPELINE_DIFF_SEED")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0x0d1f_f5ee_d000_0134);
    let mut rng = Rng(seed);
    let mut ext = MarkdownExtension::new(true, Scale::Medium);
    let mut state = EditorState::new(&sectioned_document(40));
    let _ = ext.decorate_document(&state, true);
    for step in 0..edits {
        let len = state.doc.len();
        let at = state.doc.clamp(rng.below(len + 1));
        let fragment = FRAGMENTS[rng.below(FRAGMENTS.len())];
        let (range, insert, event) = match rng.below(4) {
            0 | 1 => (at..at, fragment, UserEvent::Input),
            2 => (
                at..state.doc.clamp((at + 1 + rng.below(40)).min(len)),
                "",
                UserEvent::Delete,
            ),
            _ => (
                at..state.doc.clamp((at + rng.below(12)).min(len)),
                fragment,
                UserEvent::Input,
            ),
        };
        if range.is_empty() && insert.is_empty() {
            continue;
        }
        let label = format!("seed {seed} step {step}: {range:?} -> {insert:?}");
        apply_markdown_edit(&mut ext, &mut state, range, insert, event);
        assert_matches_full_pipeline(&ext, &state, &label);
    }
}

/// `sections` repetitions of a heading, a paragraph with inline marks, a list,
/// a fenced block and a table: long enough for the pipeline to detach its tail.
fn sectioned_document(sections: usize) -> String {
    (0..sections)
        .map(|i| {
            format!(
                "## Section {i}\n\nParagraph {i} with **bold**, *italic*, `code`, and [link](https://example.com/{i}) text.\n\n- item one {i}\n- [x] task {i}\n\n```rust\nfn s_{i}() {{}}\n```\n\n| A | B |\n| - | - |\n| {i} | val |\n"
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The incremental pipeline (detached tail, deferred byte shift) decorates a
/// document exactly as a fresh parse, compile and decorate of the same text.
fn assert_matches_full_pipeline(
    ext: &MarkdownExtension,
    state: &crate::editor::text::state::EditorState,
    label: &str,
) {
    use crate::editor::markdown::{
        composition::FEATURES,
        core::{
            decorations::{self, DecorateCx},
            plans,
            presentation::block_rhythm,
            state::PreviewState,
            syntax::Syntax,
        },
        style::MarkdownTheme,
    };
    use crate::editor::view::{
        decoration::{Block, LayeredDecorations},
        extension::{DecorateInput, EditorExtension},
    };
    let theme = MarkdownTheme::resolve(true, Scale::Medium);
    let doc_rc = ext.decorate_document(state, true);
    let rev_rc = ext.decorate_reveal(
        &DecorateInput {
            state,
            focused: true,
            pointer_selecting: false,
            dark: true,
        },
        &doc_rc,
    );
    let layered = LayeredDecorations::new(doc_rc, rev_rc);

    // Fresh ground-truth full parse -> compile -> decorate.
    let full_syntax = Syntax::parse_with(&state.doc, FEATURES);
    let full_plans = plans::compile(&state.doc, &full_syntax, &ext.preview.features, FEATURES);
    let full_rhythm = block_rhythm(&state.doc, &full_syntax, None);
    let full_doc = decorations::decorate(&DecorateCx {
        doc: &state.doc,
        syntax: &full_syntax,
        plans: &full_plans,
        rhythm: &full_rhythm,
        theme: &theme,
        preview: &PreviewState::document_only(ext.preview.features.clone()),
        live: true,
        features: FEATURES,
        assets: None,
        references: None,
        inline_preview: Some(&crate::editor::markdown::composition::preview::PREVIEW),
    });
    let full_rev = decorations::decorate_reveal(
        &full_doc,
        &DecorateCx {
            doc: &state.doc,
            syntax: &full_syntax,
            plans: &full_plans,
            rhythm: &[],
            theme: &theme,
            preview: &ext.preview,
            live: true,
            features: FEATURES,
            assets: None,
            references: None,
            inline_preview: Some(&crate::editor::markdown::composition::preview::PREVIEW),
        },
        state.revision,
    );
    let full_layered =
        LayeredDecorations::new(std::rc::Rc::new(full_doc), std::rc::Rc::new(full_rev));

    // Check viewport-style range queries spanning prefix, edited window, and shifted suffix.
    for probe_line in [
        0,
        5,
        100,
        200,
        state.doc.line_count() / 2,
        state.doc.line_count() - 2,
    ] {
        let r = state
            .doc
            .line_range(probe_line.min(state.doc.line_count() - 1));
        assert_eq!(
            layered.marks_in(&r).as_ref(),
            full_layered.marks_in(&r).as_ref(),
            "{label}: marks_in mismatch at line {probe_line}"
        );
        assert_eq!(
            layered.hidden_in(&r).as_ref(),
            full_layered.hidden_in(&r).as_ref(),
            "{label}: hidden_in mismatch at line {probe_line}"
        );
        let a_iw: Vec<_> = layered
            .inline_widgets_in(&r)
            .iter()
            .map(|w| (w.range.clone(), w.display_text().clone()))
            .collect();
        let b_iw: Vec<_> = full_layered
            .inline_widgets_in(&r)
            .iter()
            .map(|w| (w.range.clone(), w.display_text().clone()))
            .collect();
        assert_eq!(
            a_iw, b_iw,
            "{label}: inline_widgets_in mismatch at line {probe_line}"
        );
        let mid_pos = (r.start + r.end) / 2;
        assert_eq!(
            layered.atomic_containing(mid_pos),
            full_layered.atomic_containing(mid_pos),
            "{label}: atomic_containing mismatch at line {probe_line}"
        );
    }

    // Check full materialised decorations match ground truth 100%.
    let mat = layered.as_decorations();
    let exp = full_layered.as_decorations();
    assert_eq!(mat.blocks.len(), exp.blocks.len(), "{label}: block count");
    for (i, (a, b)) in mat.blocks.iter().zip(&exp.blocks).enumerate() {
        assert_eq!(a.lines(), b.lines(), "{label}: block[{i}] lines");
        assert_eq!(
            matches!(a, Block::Widget { .. }),
            matches!(b, Block::Widget { .. }),
            "{label}: block[{i}] kind"
        );
    }
    assert_same_items(&mat.marks, &exp.marks, &format!("{label}: full marks"));
    assert_same_items(&mat.hidden, &exp.hidden, &format!("{label}: full hidden"));
    assert_same_items(&mat.atomic, &exp.atomic, &format!("{label}: full atomic"));
    assert_eq!(mat.underlines, exp.underlines, "{label}: full underlines");
}

/// One edit through the same path the editor view takes.
/// Fails at the first item where `incremental` and `full` differ, showing
/// only the neighbourhood instead of both whole lists.
fn assert_same_items<T: PartialEq + std::fmt::Debug>(incremental: &[T], full: &[T], label: &str) {
    let Some(at) =
        (0..incremental.len().max(full.len())).find(|&i| incremental.get(i) != full.get(i))
    else {
        return;
    };
    let near = |items: &[T]| {
        let from = at.saturating_sub(2);
        format!(
            "{:?}",
            &items[from.min(items.len())..(at + 3).min(items.len())]
        )
    };
    panic!(
        "{label}: first difference at index {at} (incremental {} items, full {})\n incremental: {}\n        full: {}",
        incremental.len(),
        full.len(),
        near(incremental),
        near(full)
    );
}

fn apply_markdown_edit(
    ext: &mut MarkdownExtension,
    state: &mut crate::editor::text::state::EditorState,
    range: std::ops::Range<usize>,
    insert: &str,
    event: crate::editor::text::state::UserEvent,
) {
    use crate::editor::{
        text::{change::ChangeSet, state::Transaction},
        view::extension::EditorExtension,
    };
    let caret = range.start + insert.len();
    let applied = state
        .apply(Transaction::edit(
            ChangeSet::replace(range, insert),
            Some(Selection::cursor(caret)),
            event,
        ))
        .unwrap();
    ext.prepare_applied(&applied, state);
    let _ = ext.normalize_selection(state);
    ext.applied(&applied, state, true);
}

/// T7 (Rust-native): Seeded random operation sequences across 3 fixed seeds ×
/// 200 steps each (overridable via `PUPPYONE_LAYOUT_INV_SEEDS` /
/// `PUPPYONE_LAYOUT_INV_SEED` and `PUPPYONE_LAYOUT_INV_STEPS`) mix text
/// inserts/deletes, random `set_scroll_top`, width resizes (`440..=1400`),
/// height resizes (`300..=1100`), Live Preview toggles, `apply_external`, and
/// `PageDown` / `PageUp`, asserting after EVERY step:
/// 1. Adjacent laid-out blocks are strictly contiguous (`|next.top - prev.bottom| <= 0.5px`)
///    with positive heights and non-overlapping source ranges.
/// 2. Layout covers the entire viewport unless the document starts/ends inside it.
/// 3. After any caret-revealing operation (insert, delete, PageDown, PageUp),
///    the caret stays inside the viewport.
/// 4. On any interior width-only or height-only resize step, the viewport-top
///    text stays anchored within `0.5px` (reusing T2's anchoring check).
/// 5. No panics occur.
#[gpui::test]
fn random_operations_keep_the_layout_consistent(cx: &mut TestAppContext) {
    use crate::editor::markdown::ToggleLivePreview;
    use gpui::{point, px, size};

    struct Rng(u64);
    impl Rng {
        fn new(seed: u64) -> Self {
            Self(seed.max(1))
        }
        fn next_u64(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn range(&mut self, upper: usize) -> usize {
            if upper == 0 {
                0
            } else {
                (self.next_u64() as usize) % upper
            }
        }
    }

    fn settle_view(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
        let mut prev: Option<(f32, f32, u64, usize)> = None;
        for i in 0..6 {
            let _ = blocks(view, cx);
            cx.run_until_parked();
            let cur = view.read_with(cx, |v, _| {
                let l = v.layout();
                (
                    v.scroll_top(),
                    l.map_or(0., |l| f32::from(l.height)),
                    v.state().revision,
                    l.map_or(0, |l| l.blocks.len()),
                )
            });
            if i >= 1 && prev == Some(cur) {
                break;
            }
            prev = Some(cur);
        }
    }

    fn clamp_char_boundary(s: &str, idx: usize) -> usize {
        let mut i = idx.min(s.len());
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
        i
    }

    fn seed_doc() -> String {
        let prose = "Mixed Markdown prose wrapping across several rows so width resizes, height resizes, and edits thoroughly exercise layout contiguity, height caching, and scroll anchoring. ".repeat(3);
        (0..14)
            .map(|i| {
                format!(
                    "## Heading {i}\n\n{prose}\n\n- [ ] task {i} with **bold** and `code`\n- bullet item {i}\n\n> quoted note {i}\n\n```rust\nfn step_{i}() -> usize {{\n    {i}\n}}\n```\n\n| K{i} | V{i} |\n| --- | --- |\n| a{i} | b{i} |\n"
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn assert_invariants(
        view: &Entity<EditorView>,
        cx: &VisualTestContext,
        check_caret_visible: bool,
        step_label: &str,
    ) {
        view.read_with(cx, |v, _| {
            let layout = v.layout().expect("layout must exist after settle");
            assert!(
                !layout.blocks.is_empty(),
                "{step_label}: laid-out blocks must be non-empty"
            );

            let vp_top = f32::from(layout.bounds.top());
            let vp_bottom = f32::from(layout.bounds.bottom());
            let first = layout.blocks.first().unwrap();
            let last = layout.blocks.last().unwrap();

            // Invariant 2: layout covers viewport unless document is shorter / at edge.
            if !layout.starts_document {
                assert!(
                    f32::from(first.bounds.top()) <= vp_top + 1.0,
                    "{step_label}: gap above viewport (first_top={}, vp_top={vp_top})",
                    f32::from(first.bounds.top())
                );
            }
            if !layout.ends_document {
                assert!(
                    f32::from(last.bounds.bottom()) >= vp_bottom - 1.0,
                    "{step_label}: gap below viewport (last_bottom={}, vp_bottom={vp_bottom})",
                    f32::from(last.bounds.bottom())
                );
            }
            if layout.starts_document && layout.ends_document {
                let doc_h = f32::from(last.bounds.bottom() - first.bounds.top());
                let vp_h = f32::from(layout.bounds.size.height);
                if doc_h >= vp_h {
                    assert!(
                        f32::from(first.bounds.top()) <= vp_top + 1.0
                            && f32::from(last.bounds.bottom()) >= vp_bottom - 1.0,
                        "{step_label}: full-doc layout taller than viewport did not cover it"
                    );
                }
            }

            // Invariant 1: blocks positive height, strictly contiguous, non-overlapping.
            for (idx, b) in layout.blocks.iter().enumerate() {
                let h = f32::from(b.bounds.size.height);
                assert!(
                    h > 0.0,
                    "{step_label}: block {idx} must have positive height (got {h})"
                );
            }
            for (idx, pair) in layout.blocks.windows(2).enumerate() {
                let prev_bottom = f32::from(pair[0].bounds.bottom());
                let next_top = f32::from(pair[1].bounds.top());
                let gap = (next_top - prev_bottom).abs();
                assert!(
                    gap <= 0.5,
                    "{step_label}: blocks {idx}..{} non-contiguous (prev_bottom={prev_bottom:.2}, next_top={next_top:.2}, gap={gap:.3})",
                    idx + 1
                );
                assert!(
                    pair[0].source.end <= pair[1].source.start,
                    "{step_label}: block source ranges overlap/out-of-order ({:?} vs {:?})",
                    pair[0].source,
                    pair[1].source
                );
            }

            // Invariant 3: caret valid and inside viewport after caret-revealing ops.
            let sel = v.state().selection;
            assert!(
                sel.head <= v.state().doc.len(),
                "{step_label}: caret {} exceeds doc len {}",
                sel.head,
                v.state().doc.len()
            );
            if check_caret_visible {
                assert!(
                    layout.covers(sel.head),
                    "{step_label}: revealed caret {} not covered by layout",
                    sel.head
                );
                let caret = layout.caret(sel.head, sel.upstream);
                let row_top = f32::from(caret.row_top);
                let row_bottom = row_top + f32::from(caret.row_height);
                assert!(
                    row_bottom >= vp_top - 1.5 && row_top <= vp_bottom + 1.5,
                    "{step_label}: revealed caret row [{row_top:.1}, {row_bottom:.1}] outside viewport [{vp_top:.1}, {vp_bottom:.1}]"
                );
            }
        });
    }

    let steps = std::env::var("PUPPYONE_LAYOUT_INV_STEPS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(200);
    let seeds: Vec<u64> = if let Ok(raw) = std::env::var("PUPPYONE_LAYOUT_INV_SEEDS") {
        raw.split(',')
            .filter_map(|s| s.trim().parse::<u64>().ok())
            .collect()
    } else if let Ok(raw) = std::env::var("PUPPYONE_LAYOUT_INV_SEED") {
        raw.trim()
            .parse::<u64>()
            .map(|s| vec![s])
            .unwrap_or_else(|_| vec![0x5EED_CAFE_0001, 0x5EED_BEEF_0002, 0x5EED_F00D_0003])
    } else {
        vec![0x5EED_CAFE_0001, 0x5EED_BEEF_0002, 0x5EED_F00D_0003]
    };

    const INSERTS: &[&str] = &[
        "hello ",
        "**bold** ",
        "`code` ",
        "- item\n",
        "\n",
        "wrap words quickly ",
        "> quote\n",
        "中文段落 ",
    ];

    for seed in seeds {
        let mut rng = Rng::new(seed);
        let doc = seed_doc();
        let (view, visual) = setup(cx, &doc);
        let mut width = 960.0f32;
        let mut height = 680.0f32;
        visual.simulate_resize(size(px(width), px(height)));
        settle_view(&view, visual);
        assert_invariants(&view, visual, false, &format!("seed={seed} init"));

        let mut resize_anchor_checks = 0usize;
        let mut caret_reveal_checks = 0usize;
        let mut just_scrolled = false;

        for step in 0..steps {
            let label = format!("seed={seed} step={step}");
            let op = rng.range(100);
            match op {
                // 0..13: insert text/newline (caret-revealing)
                0..=13 => {
                    just_scrolled = false;
                    let text = view.read_with(visual, |v, _| v.text().to_owned());
                    let pos = clamp_char_boundary(&text, rng.range(text.len() + 1));
                    let snippet = INSERTS[rng.range(INSERTS.len())];
                    view.update(visual, |v, cx| {
                        v.set_selection(Selection::cursor(pos), cx);
                    });
                    visual.simulate_input(snippet);
                    settle_view(&view, visual);
                    assert_invariants(&view, visual, true, &format!("{label} insert"));
                    caret_reveal_checks += 1;
                }
                // 14..23: delete range (caret-revealing)
                14..=23 => {
                    just_scrolled = false;
                    let text = view.read_with(visual, |v, _| v.text().to_owned());
                    if text.len() > 24 {
                        let from = clamp_char_boundary(&text, rng.range(text.len() - 1));
                        let span = 1 + rng.range(16.min(text.len() - from));
                        let to =
                            clamp_char_boundary(&text, (from + span).min(text.len())).max(from);
                        if to > from {
                            view.update(visual, |v, cx| {
                                v.set_selection(Selection::range(from, to), cx);
                            });
                            visual.simulate_keystrokes("backspace");
                            settle_view(&view, visual);
                            assert_invariants(&view, visual, true, &format!("{label} delete"));
                            caret_reveal_checks += 1;
                        }
                    }
                }
                // 24..39: set_scroll_top to random position
                24..=39 => {
                    just_scrolled = true;
                    let max_scroll = view.read_with(visual, |v, _| {
                        let l = v.layout().expect("layout");
                        (f32::from(l.height) - f32::from(l.bounds.size.height)).max(0.0)
                    });
                    let target = if max_scroll <= 1.0 {
                        0.0
                    } else {
                        match rng.range(5) {
                            0 => 0.0,
                            1 => max_scroll,
                            _ => (rng.range(1000) as f32 / 1000.0) * max_scroll,
                        }
                    };
                    view.update(visual, |v, cx| v.set_scroll_top(target, cx));
                    settle_view(&view, visual);
                    assert_invariants(
                        &view,
                        visual,
                        false,
                        &format!("{label} scroll({target:.0})"),
                    );
                }
                // 40..69: width-only (440..=1400) or height-only (300..=1100) resize
                // with T2 interior viewport-top anchor check (<= 0.5px).
                40..=69 => {
                    let pre = view.read_with(visual, |v, _| {
                        let l = v.layout().expect("layout");
                        let max_s =
                            (f32::from(l.height) - f32::from(l.bounds.size.height)).max(0.0);
                        let scroll = v.scroll_top();
                        let interior =
                            scroll > 20.0 && scroll < max_s - 20.0 && !l.blocks.is_empty();
                        interior.then(|| {
                            let left = l.blocks[0].bounds.left();
                            let (probe_off, probe_up) =
                                l.offset_at(point(left, l.bounds.top() + px(2.)));
                            if let Some(held) = v.active_held_anchor_for_tests() {
                                let off = held.offset();
                                assert!(
                                    l.covers(off),
                                    "{label} pre-resize: active held anchor {off} must stay covered"
                                );
                                if just_scrolled {
                                    assert_eq!(
                                        off, probe_off,
                                        "{label} pre-resize: fresh anchor after scroll must match viewport top"
                                    );
                                }
                                let dist =
                                    f32::from(l.caret(off, held.upstream).row_top - l.bounds.top());
                                assert!(
                                    (dist - held.row).abs() <= 0.5,
                                    "{label} pre-resize: held anchor drifted before resize (dist={dist:.2}, held={:.2})",
                                    held.row
                                );
                                (off, held.upstream, dist)
                            } else {
                                let dist =
                                    f32::from(l.caret(probe_off, probe_up).row_top - l.bounds.top());
                                (probe_off, probe_up, dist)
                            }
                        })
                    });
                    just_scrolled = false;
                    let resize_kind = if op < 55 {
                        width = (440 + rng.range(961)) as f32;
                        "width"
                    } else {
                        height = (300 + rng.range(801)) as f32;
                        "height"
                    };
                    visual.simulate_resize(size(px(width), px(height)));
                    settle_view(&view, visual);
                    assert_invariants(
                        &view,
                        visual,
                        false,
                        &format!("{label} resize-{resize_kind}({width:.0}x{height:.0})"),
                    );
                    if let Some((off, upstream, before_dist)) = pre {
                        let checked = view.read_with(visual, |v, _| {
                            let l = v.layout().expect("layout");
                            let max_s =
                                (f32::from(l.height) - f32::from(l.bounds.size.height)).max(0.0);
                            let scroll = v.scroll_top();
                            if scroll > 1.0 && scroll < max_s - 1.0 {
                                assert!(
                                    l.covers(off),
                                    "{label} resize-{resize_kind}({width:.0}x{height:.0}): anchored offset {off} left laid-out range"
                                );
                                let after_dist =
                                    f32::from(l.caret(off, upstream).row_top - l.bounds.top());
                                let drift = (after_dist - before_dist).abs();
                                assert!(
                                    drift <= 0.5,
                                    "{label} resize-{resize_kind}({width:.0}x{height:.0}): top text drifted {drift:.3}px (before={before_dist:.2}, after={after_dist:.2})"
                                );
                                true
                            } else {
                                false
                            }
                        });
                        if checked {
                            resize_anchor_checks += 1;
                        }
                    }
                }
                // 70..78: toggle Live Preview <-> Source Mode
                70..=78 => {
                    just_scrolled = false;
                    view.update(visual, |v, cx| {
                        v.dispatch(config_transaction(ToggleLivePreview), cx);
                    });
                    settle_view(&view, visual);
                    assert_invariants(&view, visual, false, &format!("{label} toggle-live"));
                }
                // 79..87: apply_external (prepend, append, or middle insertion)
                79..=87 => {
                    just_scrolled = false;
                    let current = view.read_with(visual, |v, _| v.text().to_owned());
                    let next = match rng.range(3) {
                        0 => format!("External header {step}\n\n{current}"),
                        1 => format!("{current}\n\nExternal footer {step}"),
                        _ => {
                            let cut = clamp_char_boundary(&current, current.len() / 2);
                            format!(
                                "{}\nExternal note {step}\n{}",
                                &current[..cut],
                                &current[cut..]
                            )
                        }
                    };
                    view.update(visual, |v, cx| v.apply_external(&next, cx));
                    settle_view(&view, visual);
                    assert_invariants(&view, visual, false, &format!("{label} apply_external"));
                }
                // 88..99: PageDown / PageUp (caret-revealing)
                _ => {
                    just_scrolled = false;
                    let key = if rng.range(2) == 0 {
                        "pagedown"
                    } else {
                        "pageup"
                    };
                    let head_before = view.read_with(visual, |v, _| v.state().selection.head);
                    visual.simulate_keystrokes(key);
                    settle_view(&view, visual);
                    let head_after = view.read_with(visual, |v, _| v.state().selection.head);
                    // Only assert caret-in-viewport when PageDown/PageUp actually moved
                    // the caret (or if the caret was already visible before the boundary clamp).
                    let moved = head_after != head_before;
                    assert_invariants(&view, visual, moved, &format!("{label} {key}"));
                    if moved {
                        caret_reveal_checks += 1;
                    }
                }
            }
        }

        assert!(
            resize_anchor_checks >= 10,
            "positive control (seed={seed}): must verify interior resize anchors (got {resize_anchor_checks})"
        );
        assert!(
            caret_reveal_checks >= 20,
            "positive control (seed={seed}): must verify revealed caret visibility (got {caret_reveal_checks})"
        );
    }
}
