//! `markdownPerformanceProjection.test.ts`: an edit in a long document is
//! parsed, planned and decorated as a splice of its own block window, a focus
//! change rebuilds no document decorations, and a table stays one widget
//! through local edits.
use super::{MarkdownExtension, setup, setup_with_focus};
use crate::editor::{
    text::{
        change::ChangeSet,
        selection::Selection,
        state::{Transaction, UserEvent},
    },
    view::{EditorView, decoration::Block},
};
use gpui::{Entity, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn replace(
    view: &Entity<EditorView>,
    cx: &mut VisualTestContext,
    range: std::ops::Range<usize>,
    text: &str,
) {
    view.update(cx, |v, cx| {
        v.dispatch(
            Transaction::edit(ChangeSet::replace(range, text), None, UserEvent::Input),
            cx,
        )
    });
    draw(cx);
}

/// The lines the last edit was parsed over, if it was a splice rather than
/// a parse of the whole document.
fn spliced_lines(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Option<usize> {
    view.update(cx, |v, _| {
        let md = v.extension::<MarkdownExtension>().unwrap();
        let cache = md.cache.borrow();
        let parsed = cache.parsed.as_ref()?;
        let (_, splice) = parsed.last_splice.as_ref()?;
        Some(splice.new_lines.len())
    })
}

fn full_plans(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> u64 {
    view.read_with(cx, |v, _| v.height_map_stats().0)
}

/// `patches a 10,000-line single-character edit without a full scan or plan
/// rebuild`.
#[gpui::test]
fn an_edit_in_ten_thousand_lines_is_a_splice_of_its_window(cx: &mut gpui::TestAppContext) {
    let text = (0..10_000)
        .map(|i| {
            if i % 40 == 0 {
                format!("# Heading {i}")
            } else {
                format!(
                    "Paragraph {i} with **bold**, _emphasis_, and [link](note-{}.md).",
                    i % 30
                )
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let line = text.match_indices('\n').nth(4_998).unwrap().0 + 1;
    let (view, cx) = setup_with_focus(cx, &text, false);
    draw(cx);
    let full = full_plans(&view, cx);
    replace(&view, cx, line + 2..line + 3, "x");
    // The window is the edited line's top-level block (a 39-line paragraph
    // between headings here) and its neighbours, never the document.
    assert!(spliced_lines(&view, cx).is_some_and(|lines| lines <= 48));
    assert_eq!(full_plans(&view, cx), full);
    assert!(!view.update(cx, |v, _| v.decorations().hidden.is_empty()));
}

/// `rebuilds only the old/new reveal block when focus changes`: focusing
/// the editor reveals the caret's element without rebuilding the document
/// decorations.
#[gpui::test]
fn a_focus_change_rebuilds_no_document_decorations(cx: &mut gpui::TestAppContext) {
    let text = (0..2_000)
        .map(|i| format!("Paragraph {i} with **bold** text."))
        .collect::<Vec<_>>()
        .join("\n");
    let caret = text.find("bold").unwrap() + 2;
    let (view, cx) = setup_with_focus(cx, &text, false);
    view.update(cx, |v, cx| v.set_selection(Selection::cursor(caret), cx));
    draw(cx);
    let hidden = view.update(cx, |v, _| v.decorations().hidden.len());
    let rebuilds = view.read_with(cx, |v, _| v.doc_layer_rebuilds());
    view.update_in(cx, |v, w, cx| v.focus(w, cx));
    draw(cx);
    assert_eq!(view.read_with(cx, |v, _| v.doc_layer_rebuilds()), rebuilds);
    assert!(view.update(cx, |v, _| v.decorations().hidden.len()) < hidden);
}

/// `keeps structural table decoration in CodeMirror layout after a local
/// edit`; `keeps the table atom mounted when an adjacent empty line becomes
/// prose`.
#[gpui::test]
fn a_table_stays_one_widget_through_local_edits(cx: &mut gpui::TestAppContext) {
    let tables = |view: &Entity<EditorView>, cx: &mut VisualTestContext| {
        view.update(cx, |v, _| {
            v.decorations()
                .blocks
                .iter()
                .filter_map(|b| match b {
                    Block::Widget { lines, .. } => Some((lines.start, lines.end)),
                    Block::Line { .. } => None,
                })
                .collect::<Vec<_>>()
        })
    };
    let text = "# Table\n\n| Name | Value |\n| --- | ---: |\n| A | 1 |\n| B | 2 |\n\nTail";
    let (view, cx) = setup_with_focus(cx, text, false);
    draw(cx);
    assert_eq!(tables(&view, cx), [(2, 6)]);
    let row = text.find("| A").unwrap();
    replace(&view, cx, row + 2..row + 3, "C");
    assert_eq!(tables(&view, cx), [(2, 6)]);

    let table = "| Name | Value |\n| --- | ---: |\n| A | 1 |";
    let (view, cx) = setup(cx, &format!("{table}\n"));
    view.update(cx, |v, cx| {
        v.set_selection(Selection::cursor(table.len() + 1), cx)
    });
    draw(cx);
    cx.simulate_input("正文");
    draw(cx);
    assert_eq!(
        &view.read_with(cx, |v, _| v.text().to_owned())[table.len()..],
        "\n正文"
    );
    assert_eq!(tables(&view, cx), [(0, 3)]);
}
