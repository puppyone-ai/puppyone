//! Native acceptance for the callout, footnote and front-matter cases in the
//! pinned TS markdownBlockSyntax suite. Presentation comes from a drawn frame;
//! interactive checks dispatch actual pointer events to the rendered controls.
use super::{blocks, setup, setup_with_focus};
use crate::editor::{
    markdown::{MarkdownExtension, features::front_matter::FrontMatter},
    text::{selection::Selection, state::EditorState},
    tokens,
    view::{EditorView, bind_keys, decoration::Block, style::Paint},
};
use crate::typography::Scale;
use gpui::{Entity, Focusable, Modifiers, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn displayed(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> String {
    draw(cx);
    view.read_with(cx, |v, _| {
        v.layout()
            .unwrap()
            .leaves
            .iter()
            .map(|leaf| leaf.entry.text.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn assert_unchanged(view: &Entity<EditorView>, cx: &mut VisualTestContext, source: &str) {
    view.read_with(cx, |v, _| {
        assert_eq!(v.text(), source);
        assert_eq!(
            v.state().revision,
            0,
            "presentation must not edit the document"
        );
    });
}

#[gpui::test]
fn callout_appearances_titles_and_markdown_body_render_without_changing_source(
    cx: &mut TestAppContext,
) {
    for (marker, appearance, title) in [
        ("NOTE", "note", "Note"),
        ("tip", "tip", "Tip"),
        ("IMPORTANT", "important", "Important"),
        ("WARNING", "warning", "Warning"),
        ("CAUTION", "caution", "Caution"),
        ("done", "success", "Done"),
        ("unknown", "note", "Unknown"),
    ] {
        let source = format!("> [!{marker}]\n> **bold** body");
        let (view, visual) = setup_with_focus(cx, &source, false);
        view.update(visual, |v, cx| v.set_read_only(true, cx));
        let text = displayed(&view, visual);
        assert!(text.contains(title), "{marker}: {text:?}");
        assert!(text.contains("bold body"), "{marker}: {text:?}");
        assert!(!text.contains("[!") && !text.contains("**"));
        view.read_with(visual, |v, _| {
            let decorations = v.decorations();
            let lines: Vec<_> = decorations.blocks.iter().filter_map(|b| match b {
                Block::Line { style, .. } => Some(style),
                _ => None,
            }).collect();
            assert_eq!(lines.len(), 2);
            let tint = tokens::callout_color(appearance);
            assert!(lines.iter().all(|s| s.background == Some(gpui::Rgba { a: 0.10, ..tint })));
            assert!(lines[0].overlays.iter().any(|p| matches!(p, Paint::Icon { path, .. } if path.as_ref() == format!("icons/callout-{appearance}.svg"))));
            assert!(v.layout().unwrap().leaves.iter().any(|leaf| {
                leaf.entry.text.marks.iter().any(|(range, style)| {
                    style.bold && &leaf.entry.text.text[range.clone()] == "bold"
                })
            }), "rendered bold run missing");
        });
        assert_unchanged(&view, visual, &source);
    }
    let source = "> [!warning] Mind the gap\n> body";
    let (view, visual) = setup_with_focus(cx, source, false);
    let text = displayed(&view, visual);
    assert!(text.contains("Mind the gap") && !text.contains("Warning") && !text.contains("[!"));
    assert_unchanged(&view, visual, source);

    let (view, visual) = setup_with_focus(cx, "> plain quote", false);
    assert!(displayed(&view, visual).contains("plain quote"));
    view.read_with(visual, |v, _| {
        assert!(v.decorations().blocks.iter().all(|b| match b {
            Block::Line { style, .. } => !style.overlays.iter().any(
                |p| matches!(p, Paint::Icon { path, .. } if path.starts_with("icons/callout-"))
            ),
            _ => false,
        }))
    });
}

#[gpui::test]
fn callout_markers_reveal_only_while_the_focused_caret_touches_the_title(cx: &mut TestAppContext) {
    let source = "> [!note] Title\n> **bold** body\n\nafter";
    let (view, cx) = setup_with_focus(cx, source, false);
    // An editable pane that has never held focus still renders its header.
    assert!(!displayed(&view, cx).contains("[!note]"));
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(5), cx);
    });
    assert!(displayed(&view, cx).contains("[!note]"));
    view.update(cx, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    assert!(!displayed(&view, cx).contains("[!note]"));
    assert_unchanged(&view, cx, source);
    let at = source.find("body").unwrap() + 4;
    view.update(cx, |v, cx| v.set_selection(Selection::cursor(at), cx));
    cx.simulate_input("!");
    draw(cx);
    view.read_with(cx, |v, _| {
        assert_eq!(v.text(), source.replacen("body", "body!", 1))
    });
    cx.simulate_keystrokes("secondary-z");
    draw(cx);
    view.read_with(cx, |v, _| assert_eq!(v.text(), source));
}

#[gpui::test]
fn callout_fold_buttons_toggle_both_initial_states_without_source_edits(cx: &mut TestAppContext) {
    for (marker, initially_folded) in [("-", true), ("+", false)] {
        for read_only in [false, true] {
            let source = format!("> [!tip]{marker} Folded\n> hidden body\n\nafter");
            let (view, visual) = setup_with_focus(cx, &source, false);
            let selection = Selection::cursor(source.find("Folded").unwrap());
            view.update(visual, |v, cx| {
                v.set_read_only(read_only, cx);
                v.set_selection(selection, cx);
            });
            assert_eq!(
                displayed(&view, visual).contains("hidden body"),
                !initially_folded
            );
            for visible in [initially_folded, !initially_folded] {
                let button = visual
                    .debug_bounds("callout")
                    .unwrap_or_else(|| panic!("missing fold control: marker={marker}, readonly={read_only}, visible={visible}"));
                visual.simulate_click(button.center(), Modifiers::none());
                assert_eq!(displayed(&view, visual).contains("hidden body"), visible);
                assert_unchanged(&view, visual, &source);
                view.update_in(visual, |v, w, cx| {
                    assert!(
                        !v.focus_handle(cx).is_focused(w),
                        "folding must preserve pane focus"
                    );
                    assert_eq!(v.state().selection, selection);
                });
            }
        }
    }
}

#[gpui::test]
fn footnotes_render_first_use_numbers_and_reveal_only_the_touched_source(cx: &mut TestAppContext) {
    let source = "One[^b] two[^a] three[^b]\n\n[^a]: first note\n\n[^b]: second note";
    let (view, visual) = setup_with_focus(cx, source, false);
    let text = displayed(&view, visual);
    assert_eq!(
        text,
        "One1 two2 three1\n\n2\u{2002} first note\n\n1\u{2002} second note"
    );
    assert!(!text.contains("[^"));
    assert_unchanged(&view, visual, source);
    for (marker, len) in [
        (source.find("[^b]").unwrap(), 4),
        (source.find("[^a]:").unwrap(), 5),
    ] {
        for caret in [marker, marker + 1, marker + len] {
            view.update_in(visual, |v, w, cx| {
                v.focus(w, cx);
                v.set_selection(Selection::cursor(caret), cx);
            });
            let text = displayed(&view, visual);
            assert!(
                text.contains(&source[marker..marker + len]),
                "caret {caret}: {text:?}"
            );
            assert_unchanged(&view, visual, source);
        }
    }
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    assert!(!displayed(&view, visual).contains("[^"));
    view.update(visual, |v, cx| {
        v.set_read_only(true, cx);
        v.set_selection(Selection::cursor(source.find("[^b]").unwrap()), cx);
    });
    assert!(
        !displayed(&view, visual).contains("[^"),
        "readonly never reveals source"
    );
    let (view, visual) = setup_with_focus(cx, "Text[^missing]", false);
    assert_eq!(displayed(&view, visual), "Text[^missing]");
    assert_unchanged(&view, visual, "Text[^missing]");
}

#[gpui::test]
fn footnote_pointer_navigation_jumps_to_definition_and_back_without_editing(
    cx: &mut TestAppContext,
) {
    let source = "Text[^1]\n\n[^1]: the note";
    let (view, cx) = setup(cx, source);
    let reference = source.find("[^1]").unwrap();
    let definition = source.find("[^1]:").unwrap();
    for (from, to, width) in [(reference, definition, 4), (definition, reference, 5)] {
        view.update(cx, |v, cx| {
            v.set_selection(Selection::cursor(source.len()), cx)
        });
        draw(cx);
        let bounds = view.read_with(cx, |v, _| {
            v.layout().unwrap().range_boxes(from..from + width)[0]
        });
        cx.simulate_click(bounds.center(), Modifiers::none());
        draw(cx);
        view.read_with(cx, |v, _| {
            assert_eq!(v.state().selection, Selection::cursor(to))
        });
        assert_unchanged(&view, cx, source);
    }
}

#[gpui::test]
fn front_matter_table_and_source_button_preserve_metadata_and_reject_invalid_blocks(
    cx: &mut TestAppContext,
) {
    let source = "---\ntitle: \"Hello\"\ntags:\n  - a\n  - b\n---\n\n# Body";
    let state = EditorState::new(source);
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    let (_, plans) = markdown.parse(&state);
    let metadata: Vec<_> = plans
        .iter()
        .filter_map(|p| p.embed()?.model::<FrontMatter>())
        .collect();
    assert_eq!(metadata.len(), 1);
    assert_eq!(
        metadata[0].entries,
        vec![
            ("title".into(), "Hello".into()),
            ("tags".into(), "a, b".into())
        ]
    );
    let (view, visual) = setup(cx, source);
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    assert!(!displayed(&view, visual).contains("---"));
    view.read_with(visual, |v, _| {
        assert!(
            matches!(&v.decorations().blocks[0], Block::Widget { lines, .. } if *lines == (0..6))
        );
        assert!(v.layout().unwrap().blocks[0].bounds.size.height > gpui::px(0.));
    });
    assert_unchanged(&view, visual, source);
    let button = visual
        .debug_bounds("md-front-matter")
        .expect("metadata source control");
    visual.simulate_mouse_move(button.center(), None, Modifiers::none());
    draw(visual);
    visual.simulate_click(button.center(), Modifiers::none());
    // Source-mode list indentation occupies the native line rail; the
    // source buffer still retains the authored spaces.
    let text = displayed(&view, visual);
    assert!(
        text.contains("title: \"Hello\"")
            && text.contains("tags:\n- a\n- b")
            && text.contains("---"),
        "{text:?}"
    );
    assert_unchanged(&view, visual, source);
    for source in [
        "text\n\n---\n\ntitle: x\n---",
        "---\ntitle: x\n\nno closing rule",
        "---\n---\n\nbody",
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        draw(visual);
        assert!(
            visual.debug_bounds("md-front-matter").is_none(),
            "{source:?}"
        );
        assert_unchanged(&view, visual, source);
    }
}

#[gpui::test]
fn a_callout_folds_in_the_pane_without_an_edit(cx: &mut TestAppContext) {
    use crate::editor::markdown::features::callout::{Fold, ID};
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
    use crate::editor::markdown::features::front_matter::{ID, ShowSource};
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
fn callout_fold_and_mdx_tabs_map_accurately_across_edits_undo_and_redo(cx: &mut TestAppContext) {
    use crate::editor::markdown::features::{callout, mdx};
    use crate::editor::view::command::Command;

    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
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
    cx.simulate_keystrokes("secondary-z");
    let _ = blocks(&view, cx);
    check_mapped_state(&view, cx, 0);

    // TA-06: Redo goes through `EditorView::dispatch` and maps feature state forward again!
    cx.simulate_keystrokes("secondary-shift-z");
    let _ = blocks(&view, cx);
    check_mapped_state(&view, cx, shift);
}
