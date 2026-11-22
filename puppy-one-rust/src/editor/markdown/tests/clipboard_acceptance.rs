//! Native Markdown clipboard acceptance suite (T6):
//! - Live Preview copy writes canonical raw Markdown source including hidden
//!   markers (`**粗体** [链接](x.md) \`代码\``).
//! - Cross-block selections spanning paragraphs and a Markdown table copy exact
//!   raw Markdown source.
//! - Cut removes the selected range to the clipboard and a single Undo restores
//!   both the exact document text and the original selection.
//! - Multiline paste in the middle of a list item inserts verbatim and reverts
//!   in a single Undo.
//! - Multiline (and pipe-containing) paste inside a Markdown table cell folds
//!   line breaks into a single space and escapes unescaped `|` so table row and
//!   column counts stay intact (with Source mode positive control).
//! - Read-only mode permits Copy while blocking Cut and Paste mutations.
//! - Selecting an entire table block copies its exact raw Markdown source.
use super::{blocks, hidden, setup};
use crate::editor::{
    markdown::{SetLivePreview, features::table::model::table_block},
    text::selection::Selection,
    view::{EditorView, decoration::Block, extension::config_transaction},
};
use gpui::{ClipboardItem, Entity, TestAppContext, VisualTestContext};

fn settle(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
    for _ in 0..3 {
        let _ = blocks(view, cx);
        cx.run_until_parked();
    }
}

fn clipboard_text(cx: &mut VisualTestContext) -> Option<String> {
    cx.read_from_clipboard().and_then(|item| item.text())
}

/// T6 #1: Under Live Preview, selecting `**粗体** [链接](x.md) \`代码\`` and
/// copying writes the exact canonical Markdown source to the clipboard,
/// including all syntax markers that Live Preview hides on screen.
#[gpui::test]
fn t6_01_live_preview_copy_writes_exact_raw_markdown_including_hidden_markers(
    cx: &mut TestAppContext,
) {
    let target = "**粗体** [链接](x.md) `代码`";
    let source = format!("前文 {target} 后文");
    let (view, visual) = setup(cx, &source);
    // Park caret outside the formatted spans so Live Preview genuinely hides markers.
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx);
    });
    settle(&view, visual);
    let hidden_ranges = hidden(&view, visual);
    assert!(
        hidden_ranges.len() >= 5,
        "positive control: Live Preview must hide bold/link/code markers before copy (got {hidden_ranges:?})"
    );

    let start = source.find(target).expect("target span in source");
    let end = start + target.len();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(start, end), cx);
    });
    settle(&view, visual);
    visual.simulate_keystrokes("secondary-c");
    assert_eq!(
        clipboard_text(visual).as_deref(),
        Some(target),
        "Live Preview copy must write canonical Markdown source including hidden markers"
    );

    // Also verify each individual hidden-marker construct copies verbatim.
    for snippet in ["**粗体**", "[链接](x.md)", "`代码`"] {
        let s = source.find(snippet).expect("snippet in source");
        view.update(visual, |v, cx| {
            v.set_selection(Selection::range(s, s + snippet.len()), cx);
        });
        settle(&view, visual);
        visual.simulate_keystrokes("secondary-c");
        assert_eq!(
            clipboard_text(visual).as_deref(),
            Some(snippet),
            "Live Preview copy must write canonical Markdown source for {snippet:?}"
        );
    }
}

/// T6 #2: Selecting from a paragraph across a Markdown table widget into the
/// following paragraph and copying writes the exact raw Markdown source slice.
#[gpui::test]
fn t6_02_cross_block_selection_copy_across_paragraph_table_and_next_paragraph(
    cx: &mut TestAppContext,
) {
    let source = concat!(
        "Intro paragraph with **emphasis**.\n\n",
        "| Col A | Col B |\n",
        "| --- | --- |\n",
        "| one | two |\n\n",
        "Closing paragraph after table."
    );
    let (view, visual) = setup(cx, source);
    settle(&view, visual);
    // Positive control: the table is mounted as a Live Preview block widget.
    view.read_with(visual, |v, _| {
        assert!(
            v.decorations()
                .blocks
                .iter()
                .any(|b| matches!(b, Block::Widget { lines, .. } if *lines == (2..5))),
            "positive control: table must mount as a Live Preview widget on lines 2..5"
        );
    });

    let start = source.find("paragraph with").unwrap();
    let end = source.find("after table").unwrap();
    let expected = &source[start..end];
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(start, end), cx);
    });
    settle(&view, visual);
    visual.simulate_keystrokes("secondary-c");

    assert_eq!(
        clipboard_text(visual).as_deref(),
        Some(expected),
        "cross-block copy across paragraph -> table -> next paragraph must equal raw source"
    );
}

/// T6 #3: Cutting a selection removes exactly that slice (writing it to the
/// clipboard), and a single Undo restores both the exact document text and the
/// original selection.
#[gpui::test]
fn t6_03_cut_removes_exact_slice_and_single_undo_restores_text_and_selection(
    cx: &mut TestAppContext,
) {
    let source = "Alpha **beta** gamma\n\nSecond paragraph.";
    let (view, visual) = setup(cx, source);
    settle(&view, visual);

    let start = source.find("**beta**").unwrap();
    let end = source.find("Second").unwrap() + "Second".len();
    let original_selection = Selection::range(start, end);
    let cut_slice = &source[start..end];
    view.update(visual, |v, cx| {
        v.set_selection(original_selection, cx);
    });
    settle(&view, visual);

    visual.simulate_keystrokes("secondary-x");
    settle(&view, visual);
    assert_eq!(
        clipboard_text(visual).as_deref(),
        Some(cut_slice),
        "Cut must write exact removed slice to clipboard"
    );
    let after_cut = format!("{}{}", &source[..start], &source[end..]);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            after_cut,
            "Cut must remove exactly the selected slice"
        );
        assert_eq!(v.state().selection, Selection::cursor(start));
    });

    visual.simulate_keystrokes("secondary-z");
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            source,
            "single Undo after Cut must restore exact pre-cut document text"
        );
        assert_eq!(
            v.state().selection,
            original_selection,
            "single Undo after Cut must restore the original selection"
        );
    });

    visual.simulate_keystrokes("secondary-shift-z");
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), after_cut, "Redo must re-apply the cut");
    });
}

/// T6 #4: Pasting multiline plain text into the middle of a Markdown list item
/// inserts it verbatim, and a single Undo reverts the paste completely.
#[gpui::test]
fn t6_04_multiline_paste_in_list_item_inserts_verbatim_and_undoes_in_one_step(
    cx: &mut TestAppContext,
) {
    let list_src = "- first middle end\n- second item";
    let (view, visual) = setup(cx, list_src);
    let insert_at = list_src.find(" end").unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(insert_at), cx);
    });
    settle(&view, visual);

    let payload = " alpha\nbeta\ngamma";
    visual.write_to_clipboard(ClipboardItem::new_string(payload.into()));
    visual.simulate_keystrokes("secondary-v");
    settle(&view, visual);

    let expected = format!(
        "{}{payload}{}",
        &list_src[..insert_at],
        &list_src[insert_at..]
    );
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            expected,
            "multiline plain text pasted in the middle of a list item must insert verbatim"
        );
    });

    visual.simulate_keystrokes("secondary-z");
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            list_src,
            "single Undo must completely revert multiline paste inside a list item"
        );
    });
}

/// T6 #5: Pasting text with newlines (and pipes) into an editable Markdown
/// table cell in Live Preview folds line breaks into single spaces and escapes
/// unescaped `|` so the table keeps its exact row and column counts and intact
/// widget; Source mode remains a positive control allowing raw multiline paste.
#[gpui::test]
fn t6_05_multiline_paste_in_table_cell_preserves_table_structure(cx: &mut TestAppContext) {
    let table_src = "| A | B |\n| --- | --- |\n| one | two |\n| three | four |";
    let (view, visual) = setup(cx, table_src);
    let (orig_rows, orig_cols) = view.read_with(visual, |v, _| {
        let t = table_block(&v.state().doc, &(0..v.state().doc.len())).expect("initial table");
        (t.rows.len(), t.alignments.len())
    });
    assert_eq!((orig_rows, orig_cols), (3, 2));

    let one_start = table_src.find("one").unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(one_start, one_start + 3), cx);
    });
    settle(&view, visual);

    visual.write_to_clipboard(ClipboardItem::new_string(
        "line1\n\nline2 | pipe and \\| kept\n".into(),
    ));
    visual.simulate_keystrokes("secondary-v");
    settle(&view, visual);

    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            "| A | B |\n| --- | --- |\n| line1 line2 \\| pipe and \\| kept | two |\n| three | four |",
            "table-cell paste must fold newlines to a single space and escape unescaped pipes"
        );
        let parsed = table_block(&v.state().doc, &(0..v.state().doc.len()))
            .expect("table must remain a valid GFM table after multiline cell paste");
        assert_eq!(
            parsed.rows.len(),
            orig_rows,
            "table row count must stay unchanged after multiline cell paste"
        );
        assert_eq!(
            parsed.alignments.len(),
            orig_cols,
            "table column count must stay unchanged after multiline cell paste"
        );
        assert!(
            v.decorations()
                .blocks
                .iter()
                .any(|b| matches!(b, Block::Widget { lines, .. } if *lines == (0..4))),
            "intact 4-line table widget must survive multiline cell paste"
        );
    });

    visual.simulate_keystrokes("secondary-z");
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            table_src,
            "single Undo must restore pre-paste table"
        );
    });

    // Positive control: Source mode permits raw multiline + pipe paste verbatim.
    let (src_view, src_cx) = setup(cx, table_src);
    src_view.update(src_cx, |v, cx| {
        v.dispatch(config_transaction(SetLivePreview(false)), cx);
        v.set_selection(Selection::range(one_start, one_start + 3), cx);
    });
    settle(&src_view, src_cx);
    src_cx.write_to_clipboard(ClipboardItem::new_string("raw1\nraw2 | pipe".into()));
    src_cx.simulate_keystrokes("secondary-v");
    settle(&src_view, src_cx);
    src_view.read_with(src_cx, |v, _| {
        assert_eq!(
            v.text(),
            "| A | B |\n| --- | --- |\n| raw1\nraw2 | pipe | two |\n| three | four |",
            "positive control: Source mode must preserve raw multiline paste verbatim"
        );
    });
}

/// T6 #6: In read-only mode, Copy writes the selected raw Markdown to the
/// clipboard normally, whereas Cut and Paste leave the document untouched
/// (paired with editable positive controls proving both mutate when writable).
#[gpui::test]
fn t6_06_read_only_allows_copy_and_blocks_cut_and_paste(cx: &mut TestAppContext) {
    let source = "Keep **this** text intact.";
    let start = source.find("**this**").unwrap();
    let end = start + "**this**".len();

    // Positive control: editable mode mutates on Cut and Paste.
    let (edit_view, edit_cx) = setup(cx, source);
    edit_view.update(edit_cx, |v, cx| {
        v.set_selection(Selection::range(start, end), cx);
    });
    settle(&edit_view, edit_cx);
    edit_cx.simulate_keystrokes("secondary-x");
    settle(&edit_view, edit_cx);
    edit_view.read_with(edit_cx, |v, _| {
        assert_ne!(
            v.text(),
            source,
            "positive control: Cut must mutate an editable document"
        );
    });
    edit_cx.write_to_clipboard(ClipboardItem::new_string("REPLACED".into()));
    edit_cx.simulate_keystrokes("secondary-v");
    settle(&edit_view, edit_cx);
    edit_view.read_with(edit_cx, |v, _| {
        assert!(
            v.text().contains("REPLACED"),
            "positive control: Paste must insert into an editable document"
        );
    });

    // Read-only mode: Copy works; Cut and Paste leave text unchanged.
    let (ro_view, ro_cx) = setup(cx, source);
    ro_view.update(ro_cx, |v, cx| {
        v.set_read_only(true, cx);
        v.set_selection(Selection::range(start, end), cx);
    });
    settle(&ro_view, ro_cx);

    ro_cx.write_to_clipboard(ClipboardItem::new_string("sentinel".into()));
    ro_cx.simulate_keystrokes("secondary-c");
    assert_eq!(
        clipboard_text(ro_cx).as_deref(),
        Some("**this**"),
        "Copy must still write selected Markdown in read-only mode"
    );

    ro_cx.simulate_keystrokes("secondary-x");
    settle(&ro_view, ro_cx);
    ro_view.read_with(ro_cx, |v, _| {
        assert_eq!(
            v.text(),
            source,
            "Cut must leave a read-only document untouched"
        );
    });

    ro_cx.write_to_clipboard(ClipboardItem::new_string("INJECTED".into()));
    ro_cx.simulate_keystrokes("secondary-v");
    settle(&ro_view, ro_cx);
    ro_view.read_with(ro_cx, |v, _| {
        assert_eq!(
            v.text(),
            source,
            "Paste must leave a read-only document untouched"
        );
    });
}

/// T6 #7: Selecting an entire Markdown table block (document selection covering
/// the full table range) and copying writes the exact raw Markdown table source
/// to the clipboard.
#[gpui::test]
fn t6_07_selecting_entire_table_block_copies_exact_table_source(cx: &mut TestAppContext) {
    let table_src = concat!(
        "| Name | Role |\n",
        "| :--- | ---: |\n",
        "| **Alice** | `admin` |\n",
        "| [Bob](bob.md) | member |"
    );
    let doc = format!("Before table.\n\n{table_src}\n\nAfter table.");
    let table_start = doc.find(table_src).expect("table in doc");
    let table_end = table_start + table_src.len();

    let (view, visual) = setup(cx, &doc);
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert!(
            v.decorations()
                .blocks
                .iter()
                .any(|b| matches!(b, Block::Widget { lines, .. } if *lines == (2..6))),
            "positive control: table must mount as a Live Preview widget on lines 2..6"
        );
    });

    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(table_start, table_end), cx);
    });
    settle(&view, visual);
    visual.write_to_clipboard(ClipboardItem::new_string("stale".into()));
    visual.simulate_keystrokes("secondary-c");

    assert_eq!(
        clipboard_text(visual).as_deref(),
        Some(table_src),
        "copying a full-table selection must write the exact raw Markdown table source"
    );
}
