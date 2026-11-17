//! Markdown in a live `EditorView` (GPUI test platform): typing, two-layer
//! reveal (`TA-11`), first-class `InlineWidget`s (`TA-12`), incremental
//! `HeightMap` & `ParagraphCache` (`TA-13`), stable `BlockId` (`TA-14`),
//! incremental `Syntax` & `Plans` (`TA-31`, `TA-32`), full panic isolation
//! (`TA-33`), per-feature state across undo/redo (`TA-06`, `TA-40`), and
//! read-only transaction filtering (`TA-07`).
use super::{MarkdownExtension, features::task};
use crate::{
    editor::{
        text::selection::Selection,
        view::{EditorView, bind_keys, extension::config_transaction, style},
    },
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext};

mod block_acceptance;
mod code_isolation_acceptance;
mod html_acceptance;
mod inline_acceptance;
mod math_acceptance;
mod table_inline_acceptance;
mod table_media_acceptance;

#[test]
fn dialect_reconfiguration_uses_one_composition_and_invalidates_derived_plans() {
    use super::{
        composition::{FEATURES, MDX_FEATURES},
        features::mdx::TabsBlock,
    };
    use crate::{
        editor::{
            text::state::EditorState,
            view::extension::{DecorateInput, EditorExtension},
        },
        formats::markdown::MarkdownDialect,
    };
    let source = "Intro\n\n<Tabs><Tab label=\"One\">content</Tab></Tabs>\n";
    let state = EditorState::new(source);
    let mut markdown = MarkdownExtension::new(false, Scale::Medium);
    let (_, plain) = markdown.parse(&state);
    assert!(std::ptr::eq(markdown.features(), FEATURES));
    assert!(
        !plain
            .iter()
            .any(|p| p.embed().is_some_and(|e| e.model::<TabsBlock>().is_some()))
    );
    let plain_key = markdown.decoration_key();
    assert!(markdown.set_dialect(MarkdownDialect::OpenKnowledgeMdx));
    assert_ne!(markdown.decoration_key(), plain_key);
    assert!(std::ptr::eq(markdown.features(), MDX_FEATURES));
    let (syntax, rich) = markdown.parse(&state);
    assert_eq!(
        rich.iter()
            .filter(|p| p.embed().is_some_and(|e| e.model::<TabsBlock>().is_some()))
            .count(),
        1
    );
    let decorate = |md: &mut MarkdownExtension| {
        md.decorate(&DecorateInput {
            state: &state,
            focused: false,
            pointer_selecting: false,
            dark: false,
        })
        .blocks
        .iter()
        .any(|b| matches!(b, crate::editor::view::decoration::Block::Widget { .. }))
    };
    assert!(decorate(&mut markdown));
    assert!(!markdown.set_dialect(MarkdownDialect::OpenKnowledgeMdx));
    let (same_syntax, same_plans) = markdown.parse(&state);
    assert!(std::rc::Rc::ptr_eq(&syntax, &same_syntax));
    assert!(std::rc::Rc::ptr_eq(&rich, &same_plans));
    assert!(markdown.set_dialect(MarkdownDialect::PuppyGfm));
    assert!(!decorate(&mut markdown));
    assert_eq!(state.doc.as_str(), source);
    assert_eq!(state.revision, 0);
}

fn setup<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    setup_with_focus(cx, text, true)
}

fn setup_with_focus<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
    focused: bool,
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
    if focused {
        view.update_in(cx, |v, w, cx| v.focus(w, cx));
    }
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
        // A `q` shows its quotation marks as first-class Text InlineWidgets (`TA-12`).
        let quotes: Vec<_> = d
            .inline_widgets
            .iter()
            .filter_map(|w| w.as_text().map(|s| (w.range.clone(), s.to_string())))
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
    assert_eq!(embeds(&view, cx), vec![true, false, false]);
    assert!(hidden(&view, cx).contains(&(0..41)));
    view.update(cx, |v, _| {
        let d = v.decorations();
        let images: Vec<_> = d
            .inline_widgets
            .iter()
            .filter_map(|w| {
                w.as_image()
                    .map(|(fb, img)| (img.range.clone(), fb.to_string()))
            })
            .collect();
        assert_eq!(images, vec![(50..61, "c".into())]);
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
    let text = "# A\n\npara\n\nlast";
    let (view, cx) = setup(cx, text);
    block_move::set_enabled(true);
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.simulate_keystrokes("cmd-shift-down");
    view.update(cx, |v, _| assert_eq!(v.text(), "para\n\n# A\n\nlast"));
    // The handle's drop moves the block it dragged via `addons::block_drag`.
    view.update_in(cx, |v, _, cx| {
        assert!(super::begin_block_drag_for_tests(v, 13, 0));
        super::finish_block_drag_for_tests(v, cx);
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
        v.dispatch(
            config_transaction(super::SetReferences(Some(ReferenceContext {
                source: "note.md".into(),
                index: std::sync::Arc::new(index),
            }))),
            cx,
        );
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
    use super::{
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
    assert!(
        incremental_hits >= 200,
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
        let _ = w.draw(cx);
    });

    let (rebuilds_before, full_plans_before) =
        view.read_with(cx, |v, _| (v.doc_layer_rebuilds(), v.height_map_stats().0));
    assert_eq!(rebuilds_before, 1);

    for chord in [
        "down", "down", "right", "right", "right", "down", "down", "up",
    ] {
        cx.simulate_keystrokes(chord);
        cx.update(|w, cx| {
            let _ = w.draw(cx);
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
        let _ = w.draw(cx);
    });

    let (hits_before, misses_before) = view.read_with(cx, |v, _| v.paragraph_cache_stats());
    cx.simulate_input("X");
    cx.update(|w, cx| {
        let _ = w.draw(cx);
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
        let _ = w.draw(cx);
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
        let _ = w.draw(cx);
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
fn callout_fold_and_mdx_tabs_map_accurately_across_edits_undo_and_redo(cx: &mut TestAppContext) {
    use super::features::{callout, mdx};
    use crate::editor::view::command::Command;

    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });

    let text = concat!(
        "top\n\n",
        "> [!tip]+ Folded Callout\n> hidden line\n\n",
        "<Tabs>\n<Tab label=\"First\">\none\n</Tab>\n<Tab label=\"Second\">\ntwo\n</Tab>\n</Tabs>\n",
    );
    let callout_at = text.find("[!tip]+").unwrap();
    let tabs_at = text.find("<Tabs>").unwrap();

    let (view, cx) = cx.add_window_view(move |_, cx| {
        EditorView::new(
            text,
            Box::new(MarkdownExtension::new(true, Scale::Medium).mdx()),
            cx,
        )
    });
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(text.len()), cx);
        v.run_command(
            &Command::new(
                callout::ID,
                callout::Fold {
                    at: callout_at,
                    folded: true,
                },
            ),
            w,
            cx,
        );
        v.run_command(
            &Command::new(
                mdx::ID,
                mdx::Action::Select {
                    at: tabs_at,
                    tab: 1,
                },
            ),
            w,
            cx,
        );
    });
    let _ = blocks(&view, cx);

    // Insert 2 new lines at the very top of the document!
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.simulate_input("inserted\nlines\n");
    let _ = blocks(&view, cx);

    let check_mapped_state =
        |view: &Entity<EditorView>, cx: &mut VisualTestContext, shift: usize| {
            view.read_with(cx, |v, _| {
                let md = v.extension::<MarkdownExtension>().unwrap();
                let tabs_state = md.preview.state::<mdx::TabsState>(mdx::ID).unwrap();
                assert_eq!(
                    tabs_state.get(tabs_at + shift),
                    1,
                    "active <Tabs> selection must map by +{shift} bytes"
                );
                let folds_state = md
                    .preview
                    .state::<callout::CalloutFoldState>(callout::ID)
                    .unwrap();
                assert_eq!(
                    folds_state.get(callout_at + shift),
                    Some(true),
                    "callout fold must map by +{shift} bytes"
                );
            });
        };

    let shift = "inserted\nlines\n".len();
    check_mapped_state(&view, cx, shift);

    // TA-06: Undo goes through `EditorView::dispatch` and maps feature state back to original offsets!
    cx.simulate_keystrokes("cmd-z");
    let _ = blocks(&view, cx);
    check_mapped_state(&view, cx, 0);

    // TA-06: Redo goes through `EditorView::dispatch` and maps feature state forward again!
    cx.simulate_keystrokes("cmd-shift-z");
    let _ = blocks(&view, cx);
    check_mapped_state(&view, cx, shift);
}

#[gpui::test]
fn read_only_filter_strips_edits_while_preserving_selection_and_effects(cx: &mut TestAppContext) {
    use crate::editor::text::{
        change::ChangeSet,
        state::{StateEffect, Transaction, UserEvent},
    };

    let text = "# Heading\n\nParagraph body";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| v.set_read_only(true, cx));

    view.update_in(cx, |v, _, cx| {
        let mut tr = Transaction::edit(
            ChangeSet::replace(0..9, "# Mutated"),
            Some(Selection::cursor(11)),
            UserEvent::Input,
        );
        tr.effects
            .push(StateEffect::new(super::SetLivePreview(false)));
        v.dispatch(tr, cx);
    });

    view.read_with(cx, |v, _| {
        assert_eq!(
            v.text(),
            text,
            "TA-07: read_only filter must strip tr.changes"
        );
        assert_eq!(
            v.state().selection,
            Selection::cursor(11),
            "TA-07: read_only filter must preserve tr.selection"
        );
        assert!(
            !v.extension::<MarkdownExtension>().unwrap().live,
            "TA-07: read_only filter must preserve tr.effects"
        );
    });
}

#[gpui::test]
fn run_command_commits_active_ime_composition_before_executing_command(cx: &mut TestAppContext) {
    use gpui::EntityInputHandler as _;
    let (view, cx) = setup(cx, "prefix ");
    view.update_in(cx, |v, w, cx| {
        v.set_selection(Selection::cursor(7), cx);
        v.replace_and_mark_text_in_range(None, "汉字", None, w, cx);
        assert!(v.composing());
        v.run_command(&super::format_command(super::FormatCommand::Bold), w, cx);
    });
    view.read_with(cx, |v, _| {
        assert!(
            !v.composing(),
            "TODO-92: run_command must commit active IME composition first"
        );
        assert_eq!(v.text(), "prefix **汉字**");
    });
}

#[gpui::test]
fn revealed_code_and_table_lines_carry_source_classes_and_setext_gets_heading_style(
    cx: &mut TestAppContext,
) {
    use super::features::html;
    use crate::editor::view::{command::Command, decoration::Block};

    let text = concat!(
        "Setext Title\n============\n\n",
        "plain body\n\n",
        "```md\n# Not A Heading\n```\n\n",
        "| c1 | c2 |\n| -- | -- |\n| v1 | v2 |\n",
    );
    let code_hash_at = text.find("# Not A Heading").unwrap();
    let table_at = text.find("| c1 | c2 |").unwrap();
    let table_end = text.len() - 1;
    let (view, cx) = setup(cx, text);

    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(
                html::ID,
                html::ShowSource(text.find("```md").unwrap()..text.find("```\n\n").unwrap() + 3),
            ),
            w,
            cx,
        );
        v.set_selection(Selection::cursor(code_hash_at), cx);
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });

    view.update(cx, |v, _| {
        let decos = v.decorations();
        let line_style = |line_idx: usize| {
            decos.blocks.iter().find_map(|b| match b {
                Block::Line { line, style } if *line == line_idx => Some(style.clone()),
                _ => None,
            })
        };
        let setext_style = line_style(0).expect("Setext title line");
        let body_style = line_style(3).expect("plain body line");
        let code_line_style = line_style(6).expect("revealed `# Not A Heading` code line");
        assert!(
            setext_style.text.size > body_style.text.size,
            "TODO-45: Setext title must receive heading font size ({} > {})",
            setext_style.text.size,
            body_style.text.size
        );
        assert!(
            code_line_style.text.size <= body_style.text.size,
            "TODO-45: `# Not A Heading` inside revealed code fence must NOT get heading size"
        );
        assert_ne!(
            code_line_style.text.family(),
            body_style.text.family(),
            "TODO-44: revealed code block line must carry monospace CODE_BLOCK_LINE styling"
        );
    });

    // Reveal the table as source and verify `TABLE_LINE` monospace styling (`TODO-44`).
    view.update_in(cx, |v, w, cx| {
        v.run_command(
            &Command::new(html::ID, html::ShowSource(table_at..table_end)),
            w,
            cx,
        );
        v.set_selection(Selection::cursor(table_at), cx);
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |v, _| {
        let decos = v.decorations();
        let table_line_idx = v.state().doc.line_index(table_at);
        let body_style = decos
            .blocks
            .iter()
            .find_map(|b| match b {
                Block::Line { line: 3, style } => Some(style.clone()),
                _ => None,
            })
            .unwrap();
        let tbl_style = decos
            .blocks
            .iter()
            .find_map(|b| match b {
                Block::Line { line, style } if *line == table_line_idx => Some(style.clone()),
                _ => None,
            })
            .expect("revealed table source line");
        assert_ne!(
            tbl_style.text.family(),
            body_style.text.family(),
            "TODO-44: revealed table line must carry monospace TABLE_LINE styling"
        );
    });
}

#[gpui::test]
fn panicking_features_fall_back_to_visible_source_and_log_once(cx: &mut TestAppContext) {
    use super::{
        core::{
            decorations::{BlockDecoration, LineDecoration},
            feature::{
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
        let _ = w.draw(cx);
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
            .filter(|e| e["fields"]["feature"] == id && e["fields"]["stage"] == stage)
            .collect();
        assert_eq!(
            matching.len(),
            1,
            "feature {id}/{stage} should be logged once per session, got {matching:?}"
        );
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
        let md = MarkdownExtension::new(true, Scale::Medium);
        let mut v = EditorView::new(text, Box::new(md), cx);
        v.set_read_only(true, cx);
        v
    });
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(text.len()), cx);
    });
    let initial_blocks = blocks(&view, cx);
    assert!(initial_blocks.contains(&(0..3)), "{initial_blocks:?}");
    assert!(initial_blocks.contains(&(5..6)), "{initial_blocks:?}");

    // 1. Mermaid Zoom and Activate update pane view state and invalidate decoration_key.
    let key_before = view.update(cx, |v, _| {
        use crate::editor::view::extension::EditorExtension;
        let md = v.extension::<MarkdownExtension>().unwrap();
        let d = md
            .preview
            .state::<mermaid::MermaidState>(mermaid::ID)
            .map_or_else(Default::default, |s| s.get(mermaid_at));
        assert_eq!(d.zoom, None);
        assert!(!d.activated);
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
        let d = md
            .preview
            .state::<mermaid::MermaidState>(mermaid::ID)
            .unwrap()
            .get(mermaid_at);
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

    // Positive control: once read-only is lifted via single-source `set_read_only`,
    // those exact commands mutate the document (`TA-21`).
    view.update_in(cx, |v, w, cx| {
        v.set_read_only(false, cx);
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
