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
    // Images (and a linked one) fill the first line; beside text they stay source.
    assert_eq!(embeds(&view, cx), vec![true, false, false]);
    assert!(hidden(&view, cx).contains(&(0..41)));
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
