//! Markdown in a live `EditorView` (GPUI test platform): typing, reveal,
//! the composing block line, task toggling and history.
use super::{MarkdownExtension, features::task};
use crate::{
    editor::{
        text::selection::Selection,
        view::{EditorView, bind_keys, style},
    },
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext};

fn setup<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let text = text.to_owned();
    let (view, cx) = cx.add_window_view(move |_, cx| {
        EditorView::new(
            &text,
            Box::new(MarkdownExtension::new(true, Scale::Medium)),
            cx,
        )
    });
    view.update_in(cx, |v, w, cx| v.focus(w, cx));
    cx.run_until_parked();
    (view, cx)
}

fn hidden(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<std::ops::Range<usize>> {
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |v, _| v.decorations().hidden.clone())
}

#[gpui::test]
fn markers_hide_and_reveal_with_the_caret(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "# Title\n\nsome **bold** text");
    // Caret before "some": heading marker and both ** hidden.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(9), cx));
    assert_eq!(hidden(&view, cx), vec![0..2, 14..16, 20..22]);
    // Inside **bold** (14..22): its markers show as source.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(17), cx));
    let h = hidden(&view, cx);
    assert!(h.contains(&(0..2)) && !h.contains(&(14..16)), "{h:?}");
}

#[gpui::test]
fn typing_a_heading_prefix_keeps_the_line_as_source(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "");
    cx.simulate_input("## Ti");
    // The line being composed keeps its literal `##`.
    assert!(hidden(&view, cx).is_empty());
    view.update(cx, |v, _| assert_eq!(v.text(), "## Ti"));
    cx.simulate_keystrokes("enter");
    cx.simulate_input("x");
    assert!(hidden(&view, cx).contains(&(0..3)));
}

#[gpui::test]
fn lists_continue_and_tasks_toggle_with_history(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "- [ ] one");
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(9), cx));
    cx.simulate_keystrokes("enter");
    cx.simulate_input("two");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] two"));
    view.update_in(cx, |v, w, cx| {
        v.run_command(&task::toggle_command(0), w, cx)
    });
    view.update(cx, |v, _| assert_eq!(v.text(), "- [x] one\n- [ ] two"));
    cx.simulate_keystrokes("cmd-z");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] two"));
    cx.simulate_keystrokes("cmd-b");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] **two**"));
}

/// The lines each block of the frame shows, widgets as their line ranges.
fn blocks(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<std::ops::Range<usize>> {
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .map(|b| match b {
                crate::editor::view::decoration::Block::Line { line, .. } => *line..*line + 1,
                crate::editor::view::decoration::Block::Widget { lines, .. } => lines.clone(),
            })
            .collect()
    })
}

#[gpui::test]
fn a_callout_folds_in_the_pane_without_an_edit(cx: &mut TestAppContext) {
    use super::features::callout::{Fold, ID};
    use crate::editor::view::command::Command;
    let text = "intro\n\n> [!tip]+ Later\n> one\n> two\n\nafter";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| {
        v.set_selection(Selection::cursor(text.len()), cx)
    });
    // Open as authored: every line its own box.
    let open = vec![0..1, 1..2, 2..3, 3..4, 4..5, 5..6, 6..7];
    assert_eq!(blocks(&view, cx), open);
    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(
                ID,
                Fold {
                    at: 9,
                    folded: true,
                },
            ),
            w,
            cx,
        )
    });
    // The body leaves the flow; the document and the caret stay.
    let folded = vec![0..1, 1..2, 2..3, 3..5, 5..6, 6..7];
    assert_eq!(blocks(&view, cx), folded);
    view.update(cx, |v, _| {
        assert_eq!(v.text(), text);
        assert_eq!(v.state().selection, Selection::cursor(text.len()));
    });
    // An edit above keeps the fold with its callout.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(5), cx));
    cx.simulate_input("s");
    view.update_in(cx, |v, _, cx| {
        v.set_selection(Selection::cursor(v.text().len()), cx)
    });
    assert_eq!(blocks(&view, cx), folded);
    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(
                ID,
                Fold {
                    at: 10,
                    folded: false,
                },
            ),
            w,
            cx,
        )
    });
    assert_eq!(blocks(&view, cx), open);
}

#[gpui::test]
fn front_matter_source_shows_until_the_caret_leaves(cx: &mut TestAppContext) {
    use super::features::front_matter::{ID, ShowSource};
    use crate::editor::view::command::Command;
    let text = "---\ntitle: Plan\n---\n# Body";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| {
        v.set_selection(Selection::cursor(text.len()), cx)
    });
    assert_eq!(blocks(&view, cx), vec![0..3, 3..4]);
    view.update_in(cx, |v, w, cx| {
        v.run_command(&Command::new(ID, ShowSource(0..19)), w, cx)
    });
    // Source lines, the caret on the first key.
    assert_eq!(blocks(&view, cx), vec![0..1, 1..2, 2..3, 3..4]);
    view.update(cx, |v, _| {
        assert_eq!(v.state().selection, Selection::cursor(4))
    });
    // Editing inside keeps the source; leaving it shows the table again.
    cx.simulate_input("a");
    assert_eq!(blocks(&view, cx), vec![0..1, 1..2, 2..3, 3..4]);
    view.update_in(cx, |v, _, cx| {
        v.set_selection(Selection::cursor(v.text().len()), cx)
    });
    assert_eq!(blocks(&view, cx), vec![0..3, 3..4]);
}

#[test]
fn a_footnote_marker_jumps_to_its_counterpart() {
    use crate::editor::{
        text::state::EditorState,
        view::extension::{EditorExtension, LinkAction},
    };
    let mut ext = MarkdownExtension::new(false, Scale::Medium);
    let state = EditorState::new("a[^n] b\n\n[^n]: note\n");
    let to_note = ext.link_at(&state, 2, false).unwrap();
    assert_eq!(
        (to_note.label, to_note.action),
        (1..5, LinkAction::Position(9))
    );
    let back = ext.link_at(&state, 10, false).unwrap();
    assert_eq!((back.label, back.action), (9..14, LinkAction::Position(1)));
}

#[gpui::test]
fn inline_html_tags_hide_and_style_their_content(cx: &mut TestAppContext) {
    let text = "a <b>bold</b> and <q>said</q>\n\nend";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| {
        v.set_selection(Selection::cursor(text.len()), cx)
    });
    assert_eq!(hidden(&view, cx), vec![2..5, 9..13]);
    view.update(cx, |v, _| {
        let d = v.decorations();
        assert!(d.marks.iter().any(|m| m.range == (5..9) && m.style.bold));
        // A `q` shows its quotation marks for its tags.
        let quotes: Vec<_> = d
            .replaced
            .iter()
            .map(|(r, s)| (r.clone(), s.to_string()))
            .collect();
        assert_eq!(
            quotes,
            vec![(18..21, "\u{201c}".into()), (25..29, "\u{201d}".into())]
        );
    });
    // The caret inside shows the tags as source.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(7), cx));
    assert!(hidden(&view, cx).is_empty());
}

#[gpui::test]
fn an_image_line_shows_its_images_and_reveals_on_request(cx: &mut TestAppContext) {
    use super::features::image::{ID, ShowSource};
    use crate::editor::view::{command::Command, decoration::Block};
    let text = "![a](x.png) [![b](y.png)](https://x.test)\n\nbeside ![c](z.png) text";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| {
        v.set_selection(Selection::cursor(text.len()), cx)
    });
    let embeds = |view: &Entity<EditorView>, cx: &mut VisualTestContext| {
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        view.update(cx, |v, _| {
            v.decorations()
                .blocks
                .iter()
                .map(|b| matches!(b, Block::Line { style, .. } if style.embed.is_some()))
                .collect::<Vec<_>>()
        })
    };
    // Images (and a linked one) fill the first line; one beside text sits
    // in the text, its alt text standing in until it decodes.
    assert_eq!(embeds(&view, cx), vec![true, false, false]);
    assert!(hidden(&view, cx).contains(&(0..41)));
    view.update(cx, |v, _| {
        let d = v.decorations();
        let images: Vec<_> = d.inline_images.iter().map(|i| i.range.clone()).collect();
        assert_eq!(images, vec![50..61]);
        assert!(d.replaced.iter().any(|(r, s)| *r == (50..61) && s == "c"));
    });
    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(
                ID,
                ShowSource {
                    line: 0..41,
                    caret: 2,
                },
            ),
            w,
            cx,
        )
    });
    assert_eq!(embeds(&view, cx), vec![false, false, false]);
    view.update(cx, |v, _| {
        assert_eq!(v.state().selection, Selection::cursor(2))
    });
}

#[gpui::test]
fn an_html_block_renders_until_its_source_is_shown(cx: &mut TestAppContext) {
    use super::features::html::{ID, ShowSource};
    use crate::editor::view::command::Command;
    let text = "<div align=\"center\">\n<b>hi</b>\n</div>\n\nafter";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| {
        v.set_selection(Selection::cursor(text.len()), cx)
    });
    assert_eq!(blocks(&view, cx), vec![0..3, 3..4, 4..5]);
    view.update_in(cx, |v, w, cx| {
        v.run_command(&Command::new(ID, ShowSource(0..35)), w, cx)
    });
    assert_eq!(blocks(&view, cx), vec![0..1, 1..2, 2..3, 3..4, 4..5]);
}

#[gpui::test]
fn blocks_move_by_keyboard_and_by_handle_with_the_experiment(cx: &mut TestAppContext) {
    use super::core::commands::block_move;
    use crate::editor::view::extension::EditorExtension;
    let text = "# A\n\npara\n\nlast";
    let (view, cx) = setup(cx, text);
    block_move::set_enabled(true);
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.simulate_keystrokes("cmd-shift-down");
    view.update(cx, |v, _| assert_eq!(v.text(), "para\n\n# A\n\nlast"));
    // The handle's drop moves the block it dragged.
    view.update_in(cx, |v, _, cx| {
        let mut md = super::MarkdownExtension::new(true, Scale::Medium);
        let block = md.movable_block(v.state(), 13).unwrap();
        assert_eq!((block.index, block.group.len()), (2, 3));
        v.begin_block_drag_for_tests(block, 0);
        v.finish_block_drag_for_tests(cx);
    });
    view.update(cx, |v, _| assert_eq!(v.text(), "last\n\npara\n\n# A"));
    block_move::set_enabled(false);
    // Without the experiment the keys select to the document's edge.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.simulate_keystrokes("cmd-shift-down");
    view.update(cx, |v, _| {
        assert_eq!(v.text(), "last\n\npara\n\n# A");
        assert_eq!(v.state().selection, Selection::range(0, v.text().len()));
    });
}

#[gpui::test]
fn missing_and_ambiguous_link_targets_are_underlined(cx: &mut TestAppContext) {
    use crate::editor::navigation::{Document, ReferenceContext, ReferenceIndex};
    let text = "[[here]] [[gone]] [[dup]] [x](gone.md)\n\nend";
    let doc = |path: &str| Document {
        path: path.into(),
        name: path.rsplit('/').next().unwrap().into(),
    };
    let index = ReferenceIndex::new(vec![
        doc("note.md"),
        doc("here.md"),
        doc("a/dup.md"),
        doc("b/dup.md"),
    ]);
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| {
        if let Some(md) = v.extension_mut::<MarkdownExtension>() {
            md.references = Some(ReferenceContext {
                source: "note.md".into(),
                index: std::sync::Arc::new(index),
            });
        }
        v.set_selection(Selection::cursor(text.len()), cx)
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |v, _| {
        let lines: Vec<_> = v
            .decorations()
            .underlines
            .iter()
            .map(|u| (u.range.clone(), u.dash))
            .collect();
        // `gone` (dotted) twice, `dup` (dashed); `here` resolves.
        assert_eq!(lines, vec![(11..15, 1.), (20..23, 3.), (27..28, 1.)]);
    });
}

#[test]
fn random_markdown_and_edits_never_panic_the_pipeline() {
    use super::{
        composition::{FEATURES, MDX_FEATURES},
        core::{
            decorations::{self, DecorateCx},
            feature::Features,
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
        let syntax = Syntax::parse(&state.doc);
        let compiled = plans::compile(&state.doc, &syntax, &preview.callout_folds, features);
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
                    let syntax = Syntax::parse(&state.doc);
                    preview.applied(&applied, &state, &syntax, true, false);
                }
                let head = state.doc.clamp(caret);
                let _ = state.apply(Transaction::select(Selection::cursor(head)));
                let syntax = Syntax::parse(&state.doc);
                preview.selection_changed(&state, &syntax, true, step % 5 == 0, step % 7 == 0);
                check(&state, &preview, features, step % 11 != 0);
            }
        }
    }
}

#[gpui::test]
fn panicking_features_fall_back_to_visible_source_and_log_once(cx: &mut TestAppContext) {
    use super::{
        core::{
            decorations::BlockDecoration,
            feature::{CompileCx, FEATURE_PANIC_EVENT, Features, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan, Presentation},
            syntax::{Element, Kind},
        },
        features::math,
    };
    use crate::editor::view::{decoration::Block, widget::BlockWidget};
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
                if cx.doc.line(line) == ":::panic" {
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

    static PANIC_ELEMENT: PanicElement = PanicElement;
    static PANIC_BLOCKS: PanicBlocks = PanicBlocks;
    static PANIC_WIDGET: PanicWidget = PanicWidget;
    static TEST_FEATURES: Features = &[
        &PANIC_ELEMENT,
        &PANIC_BLOCKS,
        &PANIC_WIDGET,
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
    let text = "---\n\n:::panic\n\n$$\nE = mc^2\n$$\n\n- [ ] healthy\n";
    let (view, cx) = cx.add_window_view(move |_, cx| {
        let mut md = MarkdownExtension::new(true, Scale::Medium);
        md.features = TEST_FEATURES;
        EditorView::new(text, Box::new(md), cx)
    });
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(text.len()), cx);
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });

    // Only the healthy math block becomes a Block::Widget; `---` and `:::panic`
    // degrade to visible source lines, and partial output from `PanicBlocks` is discarded.
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
        assert_eq!(widgets, vec![4..7], "only healthy math widget should mount");
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

    // Remaining features and editing continue to work across multiple cycles.
    let task_offset = text.find("- [ ] healthy").unwrap();
    view.update_in(cx, |v, w, cx| {
        let task_line = v.state().doc.line_index(task_offset);
        v.run_command(&task::toggle_command(task_line), w, cx);
    });
    cx.simulate_input("!");
    cx.update(|w, cx| {
        let _ = w.draw(cx);
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
            .filter(|e| e["fields"]["feature"] == id)
            .collect();
        assert_eq!(
            matching.len(),
            1,
            "feature {id} should be logged once per session, got {matching:?}"
        );
        assert_eq!(matching[0]["fields"]["stage"], stage);
    }
}

#[gpui::test]
fn read_only_allows_view_commands_and_blocks_document_edits(cx: &mut TestAppContext) {
    use super::features::{callout, front_matter, mermaid, table};
    use crate::editor::{table::operation::Operation, view::command::Command};

    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });

    let text = concat!(
        "---\ntitle: Spec\n---\n\n",
        "> [!note]+ Details\n> hidden when folded\n\n",
        "```mermaid\ngraph TD\n  A-->B\n```\n\n",
        "- [ ] immutable task\n\n",
        "| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
    let fm_end = "---\ntitle: Spec\n---".len();
    let callout_marker_at = text.find("[!note]+").unwrap();
    let mermaid_at = text.find("```mermaid").unwrap();
    let task_at = text.find("- [ ] immutable task").unwrap();
    let table_at = text.find("| a | b |").unwrap();

    let (view, cx) = cx.add_window_view(move |_, cx| {
        let mut md = MarkdownExtension::new(true, Scale::Medium);
        md.read_only = true;
        let mut v = EditorView::new(text, Box::new(md), cx);
        v.set_read_only(true, cx);
        v
    });
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(text.len()), cx);
    });
    let initial_blocks = blocks(&view, cx);
    // Initially front matter (0..3) is a widget and callout lines (4, 5) are separate lines.
    assert!(initial_blocks.contains(&(0..3)), "{initial_blocks:?}");
    assert!(initial_blocks.contains(&(5..6)), "{initial_blocks:?}");

    // 1. Mermaid Zoom and Activate update pane view state and invalidate decoration_key.
    let key_before = view.update(cx, |v, _| {
        use crate::editor::view::extension::EditorExtension;
        let md = v.extension::<MarkdownExtension>().unwrap();
        assert_eq!(md.preview.diagrams.get(mermaid_at).zoom, None);
        assert!(!md.preview.diagrams.get(mermaid_at).activated);
        md.decoration_key()
    });
    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(
                mermaid::ID,
                mermaid::Action::Zoom {
                    at: mermaid_at,
                    percent: 150,
                },
            ),
            w,
            cx,
        );
        v.run_command(
            &Command::new(mermaid::ID, mermaid::Action::Activate { at: mermaid_at }),
            w,
            cx,
        );
    });
    let key_after = view.update(cx, |v, _| {
        use crate::editor::view::extension::EditorExtension;
        let md = v.extension::<MarkdownExtension>().unwrap();
        let d = md.preview.diagrams.get(mermaid_at);
        assert_eq!(d.zoom, Some(150));
        assert!(d.activated);
        md.decoration_key()
    });
    assert_ne!(
        key_before, key_after,
        "Mermaid view state must invalidate decoration_key so zoom/activate redraws"
    );

    // 2. Callout Fold collapses the callout body in read-only mode.
    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(
                callout::ID,
                callout::Fold {
                    at: callout_marker_at,
                    folded: true,
                },
            ),
            w,
            cx,
        );
    });
    let _ = blocks(&view, cx);
    view.update(cx, |v, _| {
        let body_range = v.state().doc.line_range(5);
        assert!(
            v.decorations().atomic.contains(&body_range),
            "folded callout body should become atomic in read-only mode"
        );
    });

    // 3. ShowSource reveals front matter lines in read-only mode.
    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(front_matter::ID, front_matter::ShowSource(0..fm_end)),
            w,
            cx,
        );
    });
    let revealed_blocks = blocks(&view, cx);
    assert!(
        revealed_blocks.contains(&(0..1))
            && revealed_blocks.contains(&(1..2))
            && revealed_blocks.contains(&(2..3)),
        "front matter ShowSource should expand 0..3 into source lines in read-only mode: {revealed_blocks:?}"
    );

    // 4. Document-mutating commands (task toggle, table structural edit) do not alter text.
    let (rev_before, task_line) = view.read_with(cx, |v, _| {
        (v.state().revision, v.state().doc.line_index(task_at))
    });
    view.update_in(cx, |v, w, cx| {
        v.run_command(&task::toggle_command(task_line), w, cx);
        v.run_command(
            &table::structure_command(table_at, Operation::InsertRowAbove, 1, 0),
            w,
            cx,
        );
    });
    view.update(cx, |v, _| {
        assert_eq!(v.text(), text);
        assert_eq!(v.state().revision, rev_before);
    });

    // Positive control: once read-only is lifted, those exact commands mutate the document.
    view.update_in(cx, |v, w, cx| {
        v.set_read_only(false, cx);
        v.extension_mut::<MarkdownExtension>().unwrap().read_only = false;
        v.run_command(&task::toggle_command(task_line), w, cx);
        v.run_command(
            &table::structure_command(table_at, Operation::InsertRowAbove, 1, 0),
            w,
            cx,
        );
    });
    view.update(cx, |v, _| {
        assert!(v.text().contains("- [x] immutable task"));
        assert_ne!(v.text(), text);
    });
}
