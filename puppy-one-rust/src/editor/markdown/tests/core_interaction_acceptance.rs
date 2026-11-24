//! Acceptance tests for Markdown pointer selection lifecycle, semantic-plan
//! convergence & oversized table/mermaid limits, link activation policy,
//! inline toggle commands, editing keymap, task checkbox hotspots, and math
//! interaction.
use super::{MarkdownExtension, blocks, hidden, setup, setup_with_focus};
use crate::{
    editor::{
        markdown::{
            FormatCommand,
            core::{
                commands::{Cx as CommandCx, intercept, run_format},
                plans::{self, Atom, Presentation},
                state::PreviewState,
                syntax::{Kind, Syntax},
            },
            features::{
                html::HtmlBlock,
                math::MathBlock,
                rule::Rule,
                table::model::{COLUMN_LIMIT, ROW_BYTE_LIMIT, ROW_LIMIT, table_block},
                task,
            },
        },
        navigation::{Document as NavDocument, ReferenceContext, ReferenceIndex},
        text::{
            buffer::Buffer,
            change::ChangeSet,
            selection::Selection,
            state::{EditorState, Transaction, UserEvent},
        },
        view::{
            EditorView, bind_keys,
            decoration::Block,
            extension::{
                DecorateInput, EditIntent, EditorExtension, LinkAction, config_transaction,
            },
            style,
        },
    },
    render_service::{self, Kind as RenderKind, MAX_SOURCE_BYTES, Request, State as RenderState},
    typography::Scale,
};
use gpui::{
    AppContext as _, FocusHandle, Modifiers, MouseButton, TestAppContext, VisualTestContext, point,
    px,
};
use std::sync::Arc;

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn assert_revealed_source_pointer_lifecycle(
    cx: &mut TestAppContext,
    fragment: &str,
    drag_case: &str,
    click_case: &str,
    keyboard_case: &str,
) {
    let doc = format!("{fragment}\n\nFollowing paragraph.");
    let anchor = doc.find("paragraph").unwrap() + 4;

    // Retains revealed source while dragging in the following paragraph,
    // then folds when a single caret leaves it.
    let (view, visual) = setup(cx, &doc);
    visual.update(|w, _| w.activate_window());
    draw(visual);
    view.update(visual, |v, cx| {
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .preview
            .revealed_source = Some(0..fragment.len());
        v.set_selection(Selection::cursor(3), cx);
    });
    draw(visual);
    let (anchor_pt, drag_pt) = view.read_with(visual, |v, _| {
        let layout = v.layout().unwrap();
        let a = layout.range_boxes(anchor..anchor + 1)[0].center();
        let b = layout.range_boxes(anchor - 2..anchor - 1)[0].center();
        (a, b)
    });
    visual.simulate_mouse_down(anchor_pt, MouseButton::Left, Modifiers::none());
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            Some(0..fragment.len()),
            "{drag_case}: mousedown keeps revealed source during pointer gesture"
        );
    });
    visual.simulate_mouse_move(drag_pt, MouseButton::Left, Modifiers::none());
    visual.simulate_mouse_up(drag_pt, MouseButton::Left, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert!(
            !v.state().selection.is_empty(),
            "{drag_case}: drag produces non-empty range selection"
        );
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            Some(0..fragment.len()),
            "{drag_case}: non-empty drag selection retains revealed source"
        );
    });
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(anchor), cx)
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            None,
            "{drag_case}: collapsing to outside single caret folds revealed source"
        );
        assert_eq!(v.text(), doc, "{drag_case}: document remains unmodified");
    });

    // Folds revealed source after an outside single click completes.
    let (view, visual) = setup(cx, &doc);
    visual.update(|w, _| w.activate_window());
    draw(visual);
    view.update(visual, |v, cx| {
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .preview
            .revealed_source = Some(0..fragment.len());
        v.set_selection(Selection::cursor(3), cx);
    });
    draw(visual);
    let anchor_pt = view.read_with(visual, |v, _| {
        v.layout().unwrap().range_boxes(anchor..anchor + 1)[0].center()
    });
    visual.simulate_mouse_down(anchor_pt, MouseButton::Left, Modifiers::none());
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            Some(0..fragment.len()),
            "{click_case}: revealed source stays open on pointer-down before click completes"
        );
    });
    visual.simulate_mouse_up(anchor_pt, MouseButton::Left, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            None,
            "{click_case}: outside single click completion folds revealed source"
        );
        assert_eq!(v.text(), doc, "{click_case}: document remains unmodified");
    });

    // Retains revealed source for a keyboard range leaving it and allows replacing it.
    let (view, visual) = setup(cx, &doc);
    visual.update(|w, _| w.activate_window());
    draw(visual);
    view.update(visual, |v, cx| {
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .preview
            .revealed_source = Some(0..fragment.len());
        v.set_selection(Selection::range(3, doc.len()), cx);
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            Some(0..fragment.len()),
            "{keyboard_case}: keyboard range leaving revealed source retains it"
        );
    });
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(3..doc.len(), "replacement"),
                Some(Selection::cursor(14)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            format!("{}replacement", &doc[..3]),
            "{keyboard_case}: replacing selection across revealed source edits cleanly"
        );
    });
}

/// `markdownPointerSelection.test.ts` #0, #1, #2: expanded inline source
/// (`$x^2$`) stays revealed while dragging in the following paragraph (#0),
/// folds after an outside single click completes (#1), and stays revealed for a
/// keyboard range leaving it (#2).
#[gpui::test]
fn pointer_selection_inline_source_retains_on_drag_folds_on_click_and_keeps_keyboard_range(
    cx: &mut TestAppContext,
) {
    assert_revealed_source_pointer_lifecycle(
        cx,
        "$x^2$",
        "markdownPointerSelection.test.ts #0",
        "markdownPointerSelection.test.ts #1",
        "markdownPointerSelection.test.ts #2",
    );
}

/// `markdownPointerSelection.test.ts` #3, #4, #5: expanded block source
/// (`$$\nx^2\n$$`) stays revealed while dragging in the following paragraph
/// (#3), folds after an outside single click completes (#4), and stays revealed
/// for a keyboard range leaving it (#5).
#[gpui::test]
fn pointer_selection_block_source_retains_on_drag_folds_on_click_and_keeps_keyboard_range(
    cx: &mut TestAppContext,
) {
    assert_revealed_source_pointer_lifecycle(
        cx,
        "$$\nx^2\n$$",
        "markdownPointerSelection.test.ts #3",
        "markdownPointerSelection.test.ts #4",
        "markdownPointerSelection.test.ts #5",
    );
}

/// `markdownPointerSelection.test.ts` #9, #10, #12: an active pointer selection
/// gesture cancels on window blur (#9), Escape keydown (#10), and mousemove
/// with released button (#12), resuming caret reveal immediately afterward.
#[gpui::test]
fn pointer_selection_releases_gesture_on_blur_escape_and_released_button(cx: &mut TestAppContext) {
    let source = "Prefix **abcdefghij** suffix\n\nOther paragraph.";
    let caret = source.find("abcdefghij").unwrap() + 4;

    for (case_label, mode) in [
        ("markdownPointerSelection.test.ts #9", "blur"),
        ("markdownPointerSelection.test.ts #10", "escape"),
        ("markdownPointerSelection.test.ts #12", "released-button"),
    ] {
        let (view, visual) = setup(cx, source);
        visual.update(|w, _| w.activate_window());
        draw(visual);
        let pt = view.read_with(visual, |v, _| {
            v.layout().unwrap().range_boxes(caret..caret + 1)[0].center()
        });
        visual.simulate_mouse_down(pt, MouseButton::Left, Modifiers::none());
        view.read_with(visual, |v, _| {
            assert!(
                v.extension::<MarkdownExtension>()
                    .unwrap()
                    .preview
                    .selecting,
                "{case_label}: positive control gesture active before {mode}"
            );
        });
        match mode {
            "blur" => {
                let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
                visual.update(|w, cx| outside.focus(w, cx));
                draw(visual);
                view.update_in(visual, |v, w, cx| v.focus(w, cx));
            }
            "escape" => {
                visual.simulate_keystrokes("escape");
            }
            "released-button" => {
                visual.simulate_mouse_move(pt, None, Modifiers::none());
            }
            _ => unreachable!(),
        }
        draw(visual);
        view.read_with(visual, |v, _| {
            assert!(
                !v.extension::<MarkdownExtension>()
                    .unwrap()
                    .preview
                    .selecting,
                "{case_label}: gesture must cancel on {mode}"
            );
        });
        view.update(visual, |v, cx| {
            v.set_selection(Selection::cursor(source.len()), cx)
        });
        view.read_with(visual, |v, _| {
            assert_eq!(
                v.extension::<MarkdownExtension>().unwrap().preview.reveal,
                None,
                "{case_label}: outside caret keeps reveal cleared after {mode}"
            );
        });
        view.update(visual, |v, cx| {
            v.set_selection(Selection::cursor(caret), cx)
        });
        view.read_with(visual, |v, _| {
            assert!(
                v.extension::<MarkdownExtension>()
                    .unwrap()
                    .preview
                    .reveal
                    .is_some(),
                "{case_label}: caret reveal resumes cleanly after {mode}"
            );
        });
    }
}

/// `markdownPointerSelection.test.ts` #6, #14, #15: backward pointer drags
/// suppress reveal during drag and preserve backward selection until collapsed
/// to a caret (#6); committed edits end pointer selection immediately without
/// deferring projection (#15); sibling editors keep independent gesture
/// projections (#14).
#[gpui::test]
fn pointer_selection_backward_drag_committed_edit_and_sibling_editor_isolation(
    cx: &mut TestAppContext,
) {
    let source = "Prefix **abcdefghij** suffix\n\nOther paragraph.";
    let caret = source.find("abcdefghij").unwrap() + 4;

    // markdownPointerSelection.test.ts #6: backward drag suppresses reveal during drag,
    // keeps range on release, then reveals formatted source when collapsing to a caret inside.
    let (view, visual) = setup(cx, source);
    visual.update(|w, _| w.activate_window());
    draw(visual);
    let (start_pt, left_pt) = view.read_with(visual, |v, _| {
        let layout = v.layout().unwrap();
        let a = layout.range_boxes(caret..caret + 1)[0].center();
        let b = layout.range_boxes(caret - 2..caret - 1)[0].center();
        (a, b)
    });
    visual.simulate_mouse_down(start_pt, MouseButton::Left, Modifiers::none());
    view.read_with(visual, |v, _| {
        let md = v.extension::<MarkdownExtension>().unwrap();
        assert!(
            md.preview.selecting,
            "markdownPointerSelection.test.ts #6: pointer selection active on mousedown"
        );
        assert_eq!(
            md.preview.reveal, None,
            "markdownPointerSelection.test.ts #6: reveal suppressed while dragging"
        );
    });
    visual.simulate_mouse_move(left_pt, MouseButton::Left, Modifiers::none());
    visual.simulate_mouse_up(left_pt, MouseButton::Left, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        let md = v.extension::<MarkdownExtension>().unwrap();
        assert!(
            !md.preview.selecting,
            "markdownPointerSelection.test.ts #6: pointer selection ends on release"
        );
        assert_eq!(
            md.preview.reveal, None,
            "markdownPointerSelection.test.ts #6: backward range selection keeps reveal suppressed"
        );
        assert!(
            v.state().selection.head < v.state().selection.anchor,
            "markdownPointerSelection.test.ts #6: backward selection geometry preserved"
        );
    });
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(caret), cx)
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .reveal
                .is_some(),
            "markdownPointerSelection.test.ts #6: collapsing to caret inside bold reveals source"
        );
        assert_eq!(
            v.text(),
            source,
            "markdownPointerSelection.test.ts #6: document unmodified"
        );
    });

    // markdownPointerSelection.test.ts #15: committed edit immediately ends pointer
    // selection and projects revealed source.
    let (view, visual) = setup(cx, source);
    visual.update(|w, _| w.activate_window());
    draw(visual);
    let pt = view.read_with(visual, |v, _| {
        v.layout().unwrap().range_boxes(caret..caret + 1)[0].center()
    });
    visual.simulate_mouse_down(pt, MouseButton::Left, Modifiers::none());
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(caret..caret, "X"),
                Some(Selection::cursor(caret + 1)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        let md = v.extension::<MarkdownExtension>().unwrap();
        assert!(
            !md.preview.selecting,
            "markdownPointerSelection.test.ts #15: committed edit ends pointer selection"
        );
        assert!(
            md.preview.reveal.is_some(),
            "markdownPointerSelection.test.ts #15: committed edit projects revealed source immediately"
        );
        assert_eq!(
            v.text(),
            format!("{}X{}", &source[..caret], &source[caret..]),
            "markdownPointerSelection.test.ts #15: committed edit applied verbatim"
        );
    });

    // markdownPointerSelection.test.ts #14: sibling editor projection stays independent
    // of another editor's active pointer gesture.
    let (left, visual) = setup(cx, source);
    visual.update(|w, _| w.activate_window());
    draw(visual);
    let right = visual.cx.new(|cx| {
        EditorView::new(
            source,
            Box::new(MarkdownExtension::new(true, Scale::Medium)),
            cx,
        )
    });
    let pt = left.read_with(visual, |v, _| {
        v.layout().unwrap().range_boxes(caret..caret + 1)[0].center()
    });
    visual.simulate_mouse_down(pt, MouseButton::Left, Modifiers::none());
    right.update(visual, |v, cx| {
        let st = v.state().clone();
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .selection_changed(&st, true, false);
        v.set_selection(Selection::cursor(caret), cx);
        let st = v.state().clone();
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .selection_changed(&st, true, false);
    });
    left.read_with(visual, |v, _| {
        let md = v.extension::<MarkdownExtension>().unwrap();
        assert!(
            md.preview.selecting,
            "markdownPointerSelection.test.ts #14: left editor keeps active gesture"
        );
        assert_eq!(
            md.preview.reveal, None,
            "markdownPointerSelection.test.ts #14: left editor suppresses reveal during gesture"
        );
    });
    right.read_with(visual, |v, _| {
        let md = v.extension::<MarkdownExtension>().unwrap();
        assert!(
            !md.preview.selecting,
            "markdownPointerSelection.test.ts #14: sibling editor stays independent of left gesture"
        );
        assert!(
            md.preview.reveal.is_some(),
            "markdownPointerSelection.test.ts #14: sibling editor projects reveal normally"
        );
    });
}

#[gpui::test]
fn markdown_convergence_plans_html_and_oversized_limits(cx: &mut TestAppContext) {
    // 1. Image syntax payload compiles alt, href, and title.
    let img_src = r#"![diagram](assets/a.png "Architecture")"#;
    let state = EditorState::new(img_src);
    let mut md = MarkdownExtension::new(true, Scale::Medium);
    let (syntax, _) = md.parse(&state);
    let img = syntax
        .elements
        .iter()
        .find(|e| e.kind == Kind::Image)
        .expect("image element");
    assert_eq!(img.href.as_deref(), Some("assets/a.png"));
    assert_eq!(state.doc.slice(img.content.clone().unwrap()), "diagram");

    // 2. Task checkboxes compile as inline atoms and horizontal rules as block atoms,
    //    and both render from their compiled plans.
    let plan_src = "- [x] shipped\n\n---";
    let plan_state = EditorState::new(plan_src);
    let (_, compiled) = md.parse(&plan_state);
    assert!(compiled.iter().any(|p| matches!(
        p.presentation,
        Presentation::InlineAtom(Atom::TaskCheckbox { checked: true })
    )));
    assert!(
        compiled
            .iter()
            .any(|p| p.embed().and_then(|e| e.model::<Rule>()).is_some())
    );

    let (view, visual) = setup_with_focus(cx, "- [x] shipped\n\n---", false);
    draw(visual);
    view.read_with(visual, |v, _| {
        let decos = v.decorations();
        assert!(
            decos
                .blocks
                .iter()
                .any(|b| matches!(b, Block::Widget { .. }))
        );
        assert!(decos.blocks.iter().any(|b| match b {
            Block::Line { style, .. } => style.hotspots.iter().any(|(_, c)| c.feature() == "task"),
            _ => false,
        }));
    });

    // 3. Oversized Mermaid source is rejected before opening a renderer host.
    let oversized_req = Request {
        kind: RenderKind::Mermaid {
            config: serde_json::json!({"theme": "base"}),
        },
        source: "x".repeat(MAX_SOURCE_BYTES + 1),
        background: "#ffffff".into(),
        scale: 1.,
    };
    let result = visual.update(|w, cx| render_service::get(&oversized_req, w, cx));
    assert!(matches!(
        result,
        RenderState::Failed(ref msg) if msg.to_lowercase().contains("exceeds")
    ));

    // 4. HTML block reduces event capability (ignores onclick) while preserving safe attributes.
    let html_src = r#"<div onclick="alert(1)"><time datetime="2026-07-10">Today</time></div>"#;
    let html_state = EditorState::new(html_src);
    let (_, html_plans) = md.parse(&html_state);
    let html_block = html_plans
        .iter()
        .find_map(|p| p.embed()?.model::<HtmlBlock>())
        .expect("safe HTML block admitted");
    let crate::editor::markdown::features::html::structure::Parsed::Complete(nodes) =
        crate::editor::markdown::features::html::structure::parse(&html_block.html)
    else {
        panic!("expected complete parsed HTML");
    };
    let crate::editor::markdown::features::html::sanitize::Node::Element(root) = &nodes[0] else {
        panic!("expected div");
    };
    assert_eq!(root.attribute("onclick"), None);
    assert_eq!(root.text(), "Today");

    // 5. Oversized Markdown table budgets: >ROW_LIMIT rows, >COLUMN_LIMIT columns,
    //    and >ROW_BYTE_LIMIT row bytes are bounded before reaching a table widget.
    let mut too_many_rows = String::from("| Name | Value |\n| --- | --- |\n");
    for i in 0..=ROW_LIMIT {
        too_many_rows.push_str(&format!("| row {i} | {i} |\n"));
    }
    let buf_rows = Buffer::new(&too_many_rows);
    assert!(table_block(&buf_rows, &(0..buf_rows.len())).is_none());

    let cols: Vec<String> = (0..COLUMN_LIMIT + 2).map(|i| format!("c{i}")).collect();
    let too_wide = format!(
        "| {} |\n| {} |\n| {} |",
        cols.join(" | "),
        vec!["---"; cols.len()].join(" | "),
        cols.join(" | ")
    );
    let buf_wide = Buffer::new(&too_wide);
    assert!(table_block(&buf_wide, &(0..buf_wide.len())).is_none());

    let too_long_row = format!(
        "| Name | Value |\n| --- | --- |\n| {} | value |",
        "x".repeat(ROW_BYTE_LIMIT)
    );
    let buf_bytes = Buffer::new(&too_long_row);
    assert!(table_block(&buf_bytes, &(0..buf_bytes.len())).is_none());
}

#[gpui::test]
fn link_activation_policy_caret_edit_mode_and_enter_editing(cx: &mut TestAppContext) {
    // 1. Navigation semantics follow one shared executable policy.
    let policy_doc = [
        "[Section](#section)",
        "[Missing heading](#missing)",
        "[Workspace](target.md)",
        "[Missing file](missing.md)",
        "[External](https://example.com)",
        "",
        "# Section",
    ]
    .join("\n");
    let state = EditorState::new(&policy_doc);
    let mut md = MarkdownExtension::new(true, Scale::Medium);
    md.references = Some(ReferenceContext {
        source: "note.md".into(),
        index: Arc::new(ReferenceIndex::new(vec![
            NavDocument {
                path: "note.md".into(),
                name: "note.md".into(),
            },
            NavDocument {
                path: "target.md".into(),
                name: "target.md".into(),
            },
        ])),
    });
    assert!(matches!(
        md.link_target(&state, "#section"),
        Some(LinkAction::Position(_))
    ));
    assert_eq!(md.link_target(&state, "#missing"), None);
    assert!(matches!(
        md.link_target(&state, "target.md"),
        Some(LinkAction::Workspace(ref p)) if p == &["target.md"]
    ));
    assert_eq!(md.link_target(&state, "missing.md"), None);
    assert_eq!(
        md.link_target(&state, "https://example.com"),
        Some(LinkAction::External("https://example.com/".into()))
    );

    // 2. Caret inside a link switches it from navigation to source editing;
    //    moving the caret out restores live-preview link presentation.
    let link_doc = "[External](https://example.com) and body";
    let (view, visual) = setup(cx, link_doc);
    draw(visual);
    view.update(visual, |v, cx| v.set_selection(Selection::cursor(3), cx));
    draw(visual);
    view.read_with(visual, |v, _| {
        let visible: &str = v.layout().unwrap().leaves[0].entry.text.text.as_ref();
        assert!(
            visible.contains("[External](https://example.com)"),
            "{visible:?}"
        );
    });
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(link_doc.len()), cx)
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        let leaf = &v.layout().unwrap().leaves[0].entry.text;
        assert_eq!(leaf.text.as_str(), "External and body");
        assert!(
            leaf.marks
                .iter()
                .any(|(_, s)| s.link.as_deref() == Some("https://example.com"))
        );
    });

    // 3. Mouse-up without matching press (standalone) never opens an external URL,
    //    and Enter while editing inserts a newline rather than following the link.
    let link_pt = view.read_with(visual, |v, _| {
        v.layout().unwrap().range_boxes(1..6)[0].center()
    });
    visual.simulate_mouse_up(link_pt, MouseButton::Left, Modifiers::none());
    assert_eq!(visual.opened_url(), None);

    view.update(visual, |v, cx| v.set_selection(Selection::cursor(0), cx));
    visual.simulate_keystrokes("enter");
    draw(visual);
    assert_eq!(visual.opened_url(), None);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), format!("\n{link_doc}"));
    });
}

#[test]
fn inline_toggle_commands_wrap_unwrap_and_handle_cjk_punctuation() {
    let run_toggle =
        |text: &str, from: usize, to: usize, cmd: FormatCommand| -> (String, Selection) {
            let mut state = EditorState::new(text);
            state.selection = Selection::range(from, to);
            let syntax = Syntax::parse(&state.doc);
            let plans = plans::compile(
                &state.doc,
                &syntax,
                &Default::default(),
                crate::editor::markdown::composition::FEATURES,
            );
            let preview = PreviewState::default();
            let tr = run_format(
                cmd,
                &CommandCx {
                    state: &state,
                    syntax: &syntax,
                    plans: &plans,
                    preview: &preview,
                    read_only: false,
                },
            )
            .expect("format command applies");
            state.apply(tr);
            (state.doc.as_str().to_owned(), state.selection)
        };

    // Unwrap full wrapped tokens: bold, italic, strike, underline.
    assert_eq!(
        run_toggle("**hello**", 0, 9, FormatCommand::Bold).0,
        "hello"
    );
    assert_eq!(
        run_toggle("*hello*", 0, 7, FormatCommand::Italic).0,
        "hello"
    );
    assert_eq!(
        run_toggle("~~hello~~", 0, 9, FormatCommand::Strike).0,
        "hello"
    );
    assert_eq!(
        run_toggle("<u>hello</u>", 0, 12, FormatCommand::Underline).0,
        "hello"
    );

    // Unwrap bold when caret is inside word or inner visible text is selected.
    assert_eq!(
        run_toggle("**hello**", 4, 4, FormatCommand::Bold).0,
        "hello"
    );
    assert_eq!(
        run_toggle("**hello**", 2, 7, FormatCommand::Bold).0,
        "hello"
    );

    // Wrap keeps inner visible text selected, then unwraps cleanly.
    let (wrapped, sel) = run_toggle("hello", 0, 5, FormatCommand::Bold);
    assert_eq!(wrapped, "**hello**");
    assert_eq!((sel.from(), sel.to()), (2, 7));
    assert_eq!(&wrapped[sel.from()..sel.to()], "hello");
    assert_eq!(
        run_toggle(&wrapped, sel.from(), sel.to(), FormatCommand::Bold).0,
        "hello"
    );

    // Empty doc inserts empty bold markers with caret centered.
    let (empty_bold, sel) = run_toggle("", 0, 0, FormatCommand::Bold);
    assert_eq!(empty_bold, "****");
    assert_eq!(sel, Selection::cursor(2));

    // Long CJK text leaves trailing punctuator outside ** when followed by CJK text,
    // and unwraps cleanly back to original.
    let prefix = "长段落测试下面要进行长段的测试，主要是为了进行长段的测试。没有进行长段的测试的话，这个根本就不可能。就是进行长段落的测试。";
    let suffix = "如果没有进行长段落的测试，这个功能就实现得不够完善";
    let inner = prefix.strip_suffix('。').unwrap();
    let full = format!("{prefix}{suffix}");
    let (cjk_bold, cjk_sel) = run_toggle(&full, 0, prefix.len(), FormatCommand::Bold);
    assert_eq!(cjk_bold, format!("**{inner}**。{suffix}"));
    assert!(!cjk_bold.contains("<strong>"));
    let parsed = Syntax::parse(&Buffer::new(&cjk_bold));
    assert!(parsed.elements.iter().any(|e| {
        e.kind == Kind::Strong
            && e.content
                .as_ref()
                .is_some_and(|r| &cjk_bold[r.clone()] == inner)
    }));
    let (unwrapped, _) = run_toggle(&cjk_bold, cjk_sel.from(), cjk_sel.to(), FormatCommand::Bold);
    assert_eq!(unwrapped, full);

    // CJK paragraph ending at document boundary keeps trailing punctuator inside **.
    let boundary = "就是进行长段落的测试。";
    let (boundary_bold, _) = run_toggle(boundary, 0, boundary.len(), FormatCommand::Bold);
    assert_eq!(boundary_bold, format!("**{boundary}**"));
    let parsed_b = Syntax::parse(&Buffer::new(&boundary_bold));
    assert!(parsed_b.elements.iter().any(|e| e.kind == Kind::Strong));
}

#[gpui::test]
fn markdown_editing_keymap_binds_shortcuts_and_list_tab_ownership(cx: &mut TestAppContext) {
    // 1. Shortcuts toggle bold, italic, underline, strike (both secondary-d and
    //    secondary-shift-x), and headings 1/2/3 via real GPUI keybindings.
    let (view, visual) = setup(cx, "hello");
    view.update(visual, |v, cx| v.set_selection(Selection::range(0, 5), cx));
    visual.simulate_keystrokes("secondary-u");
    view.read_with(visual, |v, _| assert_eq!(v.text(), "<u>hello</u>"));
    visual.simulate_keystrokes("secondary-u");
    view.read_with(visual, |v, _| assert_eq!(v.text(), "hello"));

    for (shortcut, expected) in [
        ("secondary-b", "**hello**"),
        ("secondary-i", "*hello*"),
        ("secondary-d", "~~hello~~"),
        ("secondary-shift-x", "~~hello~~"),
    ] {
        let (view, visual) = setup(cx, "hello");
        view.update(visual, |v, cx| v.set_selection(Selection::range(0, 5), cx));
        visual.simulate_keystrokes(shortcut);
        view.read_with(visual, |v, _| assert_eq!(v.text(), expected, "{shortcut}"));
    }
    for (shortcut, expected) in [
        ("secondary-alt-1", "# hello"),
        ("secondary-alt-2", "## hello"),
        ("secondary-alt-3", "### hello"),
    ] {
        let (view, visual) = setup(cx, "hello");
        view.update(visual, |v, cx| v.set_selection(Selection::cursor(5), cx));
        visual.simulate_keystrokes(shortcut);
        view.read_with(visual, |v, _| assert_eq!(v.text(), expected, "{shortcut}"));
    }

    // 2. Unavailable list Tab / Shift-Tab is owned without inserting generic tab spaces.
    for (doc, key) in [
        ("- parent\n    - [ ] first child", "tab"),
        ("- root", "shift-tab"),
    ] {
        let (view, visual) = setup(cx, doc);
        view.update(visual, |v, cx| {
            v.set_selection(Selection::cursor(doc.len()), cx)
        });
        visual.simulate_keystrokes(key);
        view.read_with(visual, |v, _| assert_eq!(v.text(), doc, "{doc} / {key}"));
    }

    // 3. Outside lists, Tab still performs generic indentation.
    let (view, visual) = setup(cx, "ordinary text");
    view.update(visual, |v, cx| v.set_selection(Selection::cursor(0), cx));
    visual.simulate_keystrokes("tab");
    view.read_with(visual, |v, _| {
        assert!(v.text().ends_with("ordinary text") && v.text().len() > "ordinary text".len());
    });
    // Also check pure intercept returns None outside lists.
    let state = EditorState::new("ordinary text");
    let syntax = Syntax::parse(&state.doc);
    let plans = plans::compile(
        &state.doc,
        &syntax,
        &Default::default(),
        crate::editor::markdown::composition::FEATURES,
    );
    assert!(
        intercept(
            EditIntent::Tab,
            &CommandCx {
                state: &state,
                syntax: &syntax,
                plans: &plans,
                preview: &PreviewState::default(),
                read_only: false,
            }
        )
        .is_none()
    );
}

#[gpui::test]
fn task_checkbox_hotspot_toggles_atomically_across_prefix_edits_and_readonly(
    cx: &mut TestAppContext,
) {
    // 1. Pointer-down alone never toggles; full click toggles atomically preserving selection,
    //    and repeated clicks toggle back cleanly without disturbing sibling tasks.
    let (view, visual) = setup(cx, "- [ ] First\n- [ ] Second");
    view.update(visual, |v, cx| v.set_selection(Selection::cursor(6), cx));
    draw(visual);
    // When multiple task hotspots render, GPUI's debug_bounds map retains the last one (Second).
    let box_pt = visual.debug_bounds("task").expect("task hotspot").center();
    visual.simulate_mouse_down(box_pt, MouseButton::Left, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            "- [ ] First\n- [ ] Second",
            "pointer-down alone must not toggle"
        );
    });
    visual.simulate_mouse_up(box_pt, MouseButton::Left, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "- [ ] First\n- [x] Second");
        assert_eq!(v.state().selection, Selection::cursor(6));
    });
    visual.simulate_click(box_pt, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "- [ ] First\n- [ ] Second");
    });

    // 2. Resolves task after prefix edits shift its line number.
    let doc = "- [ ] Top\n\nParagraph one\n\n- [ ] Middle\n\n- [ ] Bottom";
    let (view, visual) = setup(cx, doc);
    draw(visual);
    let insert_at = doc.find("Paragraph").unwrap();
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(insert_at..insert_at, "Inserted line\n\n"),
                None,
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    let middle_line = view.read_with(visual, |v, _| {
        let pos = v.text().find("- [ ] Middle").unwrap();
        v.state().doc.line_index(pos)
    });
    view.update_in(visual, |v, w, cx| {
        v.run_command(
            &crate::editor::markdown::features::task::toggle_command(middle_line),
            w,
            cx,
        );
    });
    view.read_with(visual, |v, _| {
        assert!(v.text().contains("- [x] Middle"));
        assert!(v.text().contains("- [ ] Bottom"));
    });

    // 3. Read-only documents ignore checkbox clicks.
    let (view, visual) = setup(cx, "- [ ] Locked");
    view.update(visual, |v, cx| v.set_read_only(true, cx));
    draw(visual);
    let box_pt = visual.debug_bounds("task").expect("task hotspot").center();
    visual.simulate_click(box_pt, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "- [ ] Locked");
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn math_interaction_keeps_failed_latex_visible_and_edits_or_deletes_formulas(
    cx: &mut TestAppContext,
) {
    // 1. Invalid LaTeX keeps canonical source intact and produces a math plan without dropping source.
    let broken = r"Broken $\frac{$ formula";
    let (view, visual) = setup_with_focus(cx, broken, false);
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), broken);
        assert_eq!(v.state().revision, 0);
        assert!(!v.decorations().inline_widgets.is_empty());
    });

    // 2. Double-clicking display math (including indented display blocks) focuses
    //    the editor at the formula content start and renders the editable source leaf.
    for source in ["$$\nE = mc^2\n$$", "  $$\nE = mc^2\n  $$"] {
        let (view, visual) = setup_with_focus(cx, source, false);
        draw(visual);
        let bounds = visual
            .debug_bounds("md-math-block")
            .expect("display math widget");
        visual.simulate_event(gpui::MouseDownEvent {
            position: bounds.center(),
            modifiers: Modifiers::none(),
            button: MouseButton::Left,
            click_count: 2,
            first_mouse: false,
        });
        draw(visual);
        let expected_caret = source.find('E').unwrap();
        view.read_with(visual, |v, _| {
            assert_eq!(v.state().selection, Selection::cursor(expected_caret));
            assert!(
                v.layout()
                    .unwrap()
                    .leaves
                    .iter()
                    .any(|l| l.entry.text.text.contains("E = mc^2")),
                "double-click reveals editable display math source"
            );
            assert_eq!(v.text(), source);
        });
    }

    // 3. Read-only inline and display math formulas are protected from Backspace/Delete.
    for source in ["$x^2$", "$$\nx^2\n$$"] {
        let (view, visual) = setup(cx, source);
        view.update(visual, |v, cx| {
            v.set_read_only(true, cx);
            v.set_selection(Selection::range(0, source.len()), cx);
        });
        draw(visual);
        visual.simulate_keystrokes("backspace delete");
        view.read_with(visual, |v, _| {
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }

    // 4. Editable inline and display math formulas delete as one undoable edit.
    for source in ["$x^2$", "$$\nx^2\n$$"] {
        let (view, visual) = setup(cx, source);
        view.update(visual, |v, cx| {
            v.set_selection(Selection::range(0, source.len()), cx);
        });
        draw(visual);
        visual.simulate_keystrokes("delete");
        view.read_with(visual, |v, _| assert_eq!(v.text(), ""));
        visual.simulate_keystrokes("secondary-z");
        view.read_with(visual, |v, _| assert_eq!(v.text(), source));
    }

    let _ = point(px(0.), px(0.));
    let _ = MathBlock {
        range: 0..0,
        content: 0..0,
        text: String::new(),
        source: String::new(),
    };
    let _ = DecorateInput {
        state: &EditorState::new(""),
        focused: false,
        pointer_selecting: false,
        dark: false,
    };
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
    cx.simulate_keystrokes("secondary-z");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] two"));
    cx.simulate_keystrokes("secondary-b");
    view.update(cx, |v, _| assert_eq!(v.text(), "- [ ] one\n- [ ] **two**"));
}

/// `markdownFormatHotkeys.test.ts` and the macOS half of
/// `markdownFormatShortcuts.electron.test.mjs`: ⌘B, ⌘I, ⌘U, ⌘D and ⌘⇧X format
/// the selection in a focused Markdown editor; ⌘⇧B, ⌥ or Control chords do
/// not, and nothing formats an editor without focus.
#[gpui::test]
fn format_shortcuts_follow_the_product_contract(cx: &mut TestAppContext) {
    let mut cases = vec![
        ("secondary-b", "**word**"),
        ("secondary-i", "*word*"),
        ("secondary-u", "<u>word</u>"),
        ("secondary-d", "~~word~~"),
        ("secondary-shift-x", "~~word~~"),
        ("secondary-shift-b", "word"),
        ("secondary-alt-i", "word"),
        ("alt-i", "word"),
    ];
    if crate::platform::os::Os::current().is_macos() {
        cases.push(("ctrl-i", "word"));
        cases.push(("secondary-ctrl-i", "word"));
    } else {
        cases.push(("super-i", "word"));
        cases.push(("secondary-super-i", "word"));
    }
    for (chord, formatted) in cases {
        let (view, cx) = setup(cx, "word");
        view.update_in(cx, |v, _, cx| v.set_selection(Selection::range(0, 4), cx));
        cx.simulate_keystrokes(chord);
        view.update(cx, |v, _| assert_eq!(v.text(), formatted, "{chord}"));
    }
    let (view, cx) = setup_with_focus(cx, "word", false);
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::range(0, 4), cx));
    cx.simulate_keystrokes("secondary-i");
    view.update(cx, |v, _| assert_eq!(v.text(), "word"));
}

/// `markdownFormatShortcuts.electron.test.mjs` #3: holding a format
/// shortcut applies it once; its auto-repeats do nothing, and a fresh press
/// after the key was released applies it again. Option, Control on macOS
/// (Command elsewhere), both platform modifiers and a released key are no
/// format shortcut.
#[gpui::test]
fn held_format_shortcuts_apply_once_and_other_inputs_are_ignored(cx: &mut TestAppContext) {
    use crate::platform::key_repeat::test_support::simulate as repeating;
    for (chord, formatted) in [
        ("secondary-b", "**word**"),
        ("secondary-i", "*word*"),
        ("secondary-u", "<u>word</u>"),
        ("secondary-d", "~~word~~"),
        ("secondary-shift-x", "~~word~~"),
    ] {
        let (view, cx) = setup(cx, "word");
        view.update_in(cx, |v, _, cx| v.set_selection(Selection::range(0, 4), cx));
        cx.simulate_keystrokes(chord);
        view.update(cx, |v, _| assert_eq!(v.text(), formatted, "{chord}"));
        repeating(true);
        for _ in 0..3 {
            cx.simulate_keystrokes(chord);
            view.update(cx, |v, _| {
                assert_eq!(v.text(), formatted, "{chord}: an auto-repeat")
            });
        }
        repeating(false);
        cx.simulate_keystrokes(chord);
        view.update(cx, |v, _| {
            assert_eq!(v.text(), "word", "{chord}: a fresh press toggles back")
        });
    }
    let (view, cx) = setup(cx, "word");
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::range(0, 4), cx));
    let mut ignored = vec!["secondary-alt-i"];
    ignored.extend(if crate::platform::os::Os::current().is_macos() {
        ["ctrl-i", "secondary-ctrl-i"]
    } else {
        ["super-i", "secondary-super-i"]
    });
    for chord in ignored {
        cx.simulate_keystrokes(chord);
        view.update(cx, |v, _| assert_eq!(v.text(), "word", "{chord}"));
    }
    cx.simulate_event(gpui::KeyUpEvent {
        keystroke: gpui::Keystroke::parse("secondary-i").unwrap(),
    });
    view.update(cx, |v, _| assert_eq!(v.text(), "word", "a released key"));
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
            config_transaction(crate::editor::markdown::SetReferences(Some(
                ReferenceContext {
                    source: "note.md".into(),
                    index: std::sync::Arc::new(index),
                },
            ))),
            cx,
        );
        v.set_selection(Selection::cursor(text.len()), cx)
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
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
            .push(StateEffect::new(crate::editor::markdown::SetLivePreview(
                false,
            )));
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
        v.run_command(
            &crate::editor::markdown::format_command(crate::editor::markdown::FormatCommand::Bold),
            w,
            cx,
        );
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
    use crate::editor::markdown::features::html;
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
        w.draw(cx).clear(cx);
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
        w.draw(cx).clear(cx);
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
fn read_only_allows_view_commands_and_blocks_document_edits(cx: &mut TestAppContext) {
    use crate::editor::markdown::features::{callout, front_matter, mermaid, table};
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

/// A Markdown document (headings, long paragraphs, lists, code, tables)
/// resized narrower and wider again: the text at the viewport top stays
/// where it is, with no drift accumulating across resizes.
#[gpui::test]
fn resizing_keeps_the_markdown_at_the_viewport_top(cx: &mut TestAppContext) {
    use gpui::{point, px, size};
    let prose = "Every paragraph here wraps across several rows, so a narrower column adds rows to the blocks above the viewport as well as to the one at its top. ".repeat(4);
    let text = (0..60)
        .map(|i| {
            format!(
                "## Section {i}\n\n{prose}\n\n- first item {prose}\n- second item\n\n```rust\nfn section_{i}() {{}}\n```\n\n| a | b |\n| - | - |\n| {i} | cell |\n"
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let (view, cx) = setup(cx, &text);
    cx.simulate_resize(size(px(1000.), px(700.)));
    for _ in 0..6 {
        let _ = blocks(&view, cx);
        cx.run_until_parked();
    }
    view.update(cx, |v, cx| v.set_scroll_top(30_000., cx));
    let settle = |cx: &mut VisualTestContext| {
        for _ in 0..6 {
            let _ = blocks(&view, cx);
            cx.run_until_parked();
        }
    };
    settle(cx);
    let row_of = |cx: &mut VisualTestContext, offset: usize| {
        view.read_with(cx, |v, _| {
            let l = v.layout().unwrap();
            f32::from(l.caret(offset, false).row_top - l.bounds.top())
        })
    };
    let offset = view.read_with(cx, |v, _| {
        let l = v.layout().unwrap();
        let left = l.blocks[0].bounds.left();
        l.offset_at(point(left, l.bounds.top() + px(2.))).0
    });
    let row = row_of(cx, offset);
    for width in [760., 560., 440., 880., 1000.].repeat(3) {
        cx.simulate_resize(size(px(width), px(700.)));
        settle(cx);
        let now = row_of(cx, offset);
        assert!(
            (now - row).abs() <= 0.5,
            "at {width}px the top text moved {}",
            now - row
        );
    }
}
