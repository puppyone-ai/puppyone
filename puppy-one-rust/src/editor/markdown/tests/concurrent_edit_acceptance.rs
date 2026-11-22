//! Native concurrent-editing, offscreen remount, block-move selection mapping,
//! code-block Escape/blur state restoration, and IME-under-external-edit
//! acceptance (`T5-B`):
//! - `runtime-foundations.test.ts` #2 (`keeps embedded edit sessions range-mapped and revision-aware`)
//! - `markdownEmbedRuntime.test.ts` #1, #2, #3, #4, #20 (plus native Escape/blur companion for #4/#16)
//! - `markdownBlockMove.test.ts` #20 (`relocates contained drafts, maps disjoint drafts, and conflicts partial overlap`)
//! - Native invariant: active IME preedit inside a fenced code block abandoned
//!   cleanly on `apply_external` without duplicating or dropping text.
use super::{blocks, setup};
use crate::editor::{
    markdown::core::{
        commands::block_move,
        syntax::{Syntax, block_boundaries::BlockBoundaries},
    },
    text::{selection::Selection, state::EditorState},
    view::{EditorView, decoration::Block},
};
use gpui::{Entity, EntityInputHandler, TestAppContext, VisualTestContext, px, size};

fn settle(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
    for _ in 0..4 {
        let _ = blocks(view, cx);
        cx.run_until_parked();
    }
}

fn first_widget_id(view: &Entity<EditorView>, cx: &VisualTestContext) -> Option<u64> {
    view.read_with(cx, |v, _| {
        v.decorations().blocks.iter().find_map(|b| match b {
            Block::Widget { id, .. } => Some(id.raw()),
            _ => None,
        })
    })
}

/// `runtime-foundations.test.ts` #2 (`keeps embedded edit sessions range-mapped and revision-aware`)
/// and `markdownEmbedRuntime.test.ts` #1 (`rebases an explicitly opted-in draft across a non-overlapping edit in one transaction`):
/// While the caret is actively inside a fenced code block or a table cell, an
/// external non-overlapping write (`apply_external`) shifts the document,
/// advances revision, keeps `BlockId` stable, maps the caret into the exact
/// shifted cell/code position, and subsequent typing lands in place.
#[gpui::test]
fn t5_b1_external_non_overlapping_edit_keeps_code_and_table_caret_mapped_and_editable(
    cx: &mut TestAppContext,
) {
    // 1. Fenced code block case
    let code_src = "before\n\n```ts\nold\n```\n\nafter";
    let (view, visual) = setup(cx, code_src);
    settle(&view, visual);
    let code_id = first_widget_id(&view, visual).expect("code block mounted");
    let rev0 = view.read_with(visual, |v, _| v.state().revision);
    let old_end = code_src.find("old").unwrap() + 3;
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(old_end), cx);
    });
    settle(&view, visual);

    let prefix = "agent-prefix\n";
    let external = format!("{prefix}{code_src}");
    view.update(visual, |v, cx| v.apply_external(&external, cx));
    settle(&view, visual);

    view.read_with(visual, |v, _| {
        assert!(v.state().revision > rev0, "revision must advance");
        assert_eq!(
            v.state().selection.head,
            old_end + prefix.len(),
            "caret inside code block must map across non-overlapping prefix edit"
        );
    });
    assert_eq!(
        first_widget_id(&view, visual),
        Some(code_id),
        "code block must retain stable BlockId across non-overlapping external edit"
    );

    visual.simulate_input("_v2");
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            "agent-prefix\nbefore\n\n```ts\nold_v2\n```\n\nafter"
        );
    });

    // 2. Table cell case
    let table_src = "Intro\n\n| A | B |\n| --- | --- |\n| one | two |\n\nOutro";
    let (tview, tvisual) = setup(cx, table_src);
    settle(&tview, tvisual);
    let table_id = first_widget_id(&tview, tvisual).expect("table widget mounted");
    let one_end = table_src.find("one").unwrap() + 3;
    tview.update(tvisual, |v, cx| {
        v.set_selection(Selection::cursor(one_end), cx);
    });
    settle(&tview, tvisual);

    let t_prefix = "Added header line\n\n";
    let t_external = format!("{t_prefix}{table_src}");
    tview.update(tvisual, |v, cx| v.apply_external(&t_external, cx));
    settle(&tview, tvisual);

    tview.read_with(tvisual, |v, _| {
        assert_eq!(
            v.state().selection.head,
            one_end + t_prefix.len(),
            "caret inside table cell must map across non-overlapping external edit"
        );
    });
    assert_eq!(
        first_widget_id(&tview, tvisual),
        Some(table_id),
        "table widget must retain stable BlockId across non-overlapping external edit"
    );

    tvisual.simulate_input("!");
    settle(&tview, tvisual);
    tview.read_with(tvisual, |v, _| {
        assert_eq!(
            v.text(),
            "Added header line\n\nIntro\n\n| A | B |\n| --- | --- |\n| one! | two |\n\nOutro"
        );
    });
}

/// `markdownEmbedRuntime.test.ts` #2 (`rejects an overlapping edit even when explicit rebase is enabled`)
/// and native `TA-71`: when an external write overwrites the actively edited
/// code block or table cell, the editor stays panic-free with selection landing
/// cleanly on the modified range boundary, adopts the external content, and
/// `undo(false)` recovers the overwritten user edit while `undo(true)` re-applies.
#[gpui::test]
fn t5_b2_external_overlapping_overwrite_recovers_user_input_on_undo(cx: &mut TestAppContext) {
    // 1. Overlapping overwrite inside a code block
    let src = "Intro\n\n```ts\nold\n```\n\nOutro";
    let (view, visual) = setup(cx, src);
    settle(&view, visual);
    let old_pos = src.find("old").unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(old_pos, old_pos + 3), cx);
    });
    visual.simulate_input("user_draft");
    settle(&view, visual);
    let user_text = view.read_with(visual, |v, _| v.text().to_owned());
    assert_eq!(user_text, "Intro\n\n```ts\nuser_draft\n```\n\nOutro");

    let ext_text = "Intro\n\n```ts\nEXTERNAL_NEW\n```\n\nOutro";
    let ext_start = ext_text.find("EXTERNAL_NEW").unwrap();
    let ext_end = ext_start + "EXTERNAL_NEW".len();
    view.update(visual, |v, cx| v.apply_external(ext_text, cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), ext_text);
        let head = v.state().selection.head;
        assert!(
            head == ext_start || head == ext_end,
            "selection ({head}) must land cleanly on overwritten range boundary ({ext_start}..{ext_end})"
        );
        assert!(v.can_undo(), "external overwrite must be undoable (TA-71)");
    });

    view.update(visual, |v, cx| v.undo(false, cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            user_text,
            "undo after overlapping external overwrite must recover user code edit"
        );
    });

    view.update(visual, |v, cx| v.undo(true, cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| assert_eq!(v.text(), ext_text));

    // 2. Overlapping overwrite inside a table cell
    let tsrc = "| Key | Val |\n| --- | --- |\n| alpha | beta |";
    let (tview, tvisual) = setup(cx, tsrc);
    settle(&tview, tvisual);
    let alpha_pos = tsrc.find("alpha").unwrap();
    tview.update(tvisual, |v, cx| {
        v.set_selection(Selection::range(alpha_pos, alpha_pos + 5), cx);
    });
    tvisual.simulate_input("local_cell");
    settle(&tview, tvisual);
    let local_table = tview.read_with(tvisual, |v, _| v.text().to_owned());
    assert_eq!(
        local_table,
        "| Key | Val |\n| --- | --- |\n| local_cell | beta |"
    );

    let ext_table = "| Key | Val |\n| --- | --- |\n| agent_cell | beta |";
    tview.update(tvisual, |v, cx| v.apply_external(ext_table, cx));
    settle(&tview, tvisual);
    tview.read_with(tvisual, |v, _| assert_eq!(v.text(), ext_table));

    tview.update(tvisual, |v, cx| v.undo(false, cx));
    settle(&tview, tvisual);
    tview.read_with(tvisual, |v, _| {
        assert_eq!(
            v.text(),
            local_table,
            "undo after overlapping external table overwrite must recover user cell input"
        );
    });
}

/// `markdownEmbedRuntime.test.ts` #3 (`keeps a stable edit-session id and draft across detach + range mapping`)
/// and #4 (`mirrors code input into the store and restores it after a DOM remount`):
/// Type into a code block, scroll it completely offscreen (detaching its
/// viewport element), apply an external prefix edit that shifts its range, and
/// scroll back into view — `BlockId` stays identical and typed code survives
/// verbatim in both buffer and rendered leaves.
#[gpui::test]
fn t5_b3_b4_code_block_keeps_block_id_and_edits_across_offscreen_detach_and_prefix_shift(
    cx: &mut TestAppContext,
) {
    let tail: String = (0..140)
        .map(|i| {
            format!("Tail paragraph {i} giving enough scroll height to detach the code block.\n\n")
        })
        .collect();
    let src = format!("```ts\nold\n```\n\n{tail}");
    let (view, visual) = setup(cx, &src);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);

    let initial_id = first_widget_id(&view, visual).expect("code block mounted");
    let old_pos = src.find("old").unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(old_pos, old_pos + 3), cx);
    });
    visual.simulate_input("recover me");
    settle(&view, visual);

    // Scroll far below so the code block detaches from the laid-out viewport.
    view.update(visual, |v, cx| v.set_scroll_top(5_000., cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert!(
            !v.layout().expect("layout").covers(old_pos),
            "positive control: code block must detach offscreen before range shift"
        );
    });

    // External prefix edit shifts the detached code block's range.
    let current = view.read_with(visual, |v, _| v.text().to_owned());
    let shifted = format!("xxx\n\n{current}");
    view.update(visual, |v, cx| v.apply_external(&shifted, cx));
    settle(&view, visual);

    // Scroll back to top and verify BlockId + edited content survived remount.
    view.update(visual, |v, cx| v.set_scroll_top(0., cx));
    settle(&view, visual);
    assert_eq!(
        first_widget_id(&view, visual),
        Some(initial_id),
        "code block must retain identical BlockId across offscreen detach + prefix shift"
    );
    view.read_with(visual, |v, _| {
        assert!(v.text().starts_with("xxx\n\n```ts\nrecover me\n```"));
        assert!(
            v.layout()
                .expect("layout")
                .leaves
                .iter()
                .any(|l| l.entry.text.text == "recover me"),
            "remounted code block must render preserved user text"
        );
    });
}

/// `markdownEmbedRuntime.test.ts` #20
/// (`restores and explicitly rebases a table-cell draft after its range moves`):
/// Edit a table cell, scroll the table offscreen to detach its widget, shift
/// its byte range with an external prefix edit, scroll back into view, and
/// verify `BlockId`, caret mapping, edited cell content, and subsequent edits
/// inside the shifted cell all remain intact.
#[gpui::test]
fn t5_b5_table_cell_keeps_block_id_and_edits_across_offscreen_detach_and_prefix_shift(
    cx: &mut TestAppContext,
) {
    let tail: String = (0..140)
        .map(|i| format!("Tail line {i} pushing the table offscreen when scrolled down.\n\n"))
        .collect();
    let src = format!("| Col A | Col B |\n| --- | --- |\n| alpha | beta |\n\n{tail}");
    let (view, visual) = setup(cx, &src);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);

    let initial_id = first_widget_id(&view, visual).expect("table widget mounted");

    let alpha_pos = src.find("alpha").unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(alpha_pos, alpha_pos + 5), cx);
    });
    visual.simulate_input("draft");
    settle(&view, visual);
    let caret_after_draft = view.read_with(visual, |v, _| v.state().selection.head);

    // Scroll far down so the table leaves the mounted viewport.
    view.update(visual, |v, cx| v.set_scroll_top(5_000., cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert!(
            !v.layout().expect("layout").covers(alpha_pos),
            "positive control: table must leave mounted viewport before shift"
        );
    });

    // Shift table range via external prefix edit.
    let prefix = "Prefix paragraph inserted above table.\n\n";
    let shifted = format!(
        "{prefix}{}",
        view.read_with(visual, |v, _| v.text().to_owned())
    );
    view.update(visual, |v, cx| v.apply_external(&shifted, cx));
    settle(&view, visual);

    // Scroll back to top: BlockId, caret mapping, and cell content must persist.
    view.update(visual, |v, cx| v.set_scroll_top(0., cx));
    settle(&view, visual);
    assert_eq!(
        first_widget_id(&view, visual),
        Some(initial_id),
        "table must keep stable BlockId across detach + range shift"
    );
    view.read_with(visual, |v, _| {
        assert_eq!(v.state().selection.head, caret_after_draft + prefix.len());
        assert!(v.text().contains("| draft | beta |"));
    });

    // Subsequent typing commits directly into the rebased table cell.
    visual.simulate_input("_2");
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert!(v.text().contains("| draft_2 | beta |"));
    });
}

/// `markdownBlockMove.test.ts` #20
/// (`embedded draft relocation > relocates contained drafts, maps disjoint drafts, and conflicts partial overlap`):
/// Moving a block relocates a selection contained in that block to its new
/// location, maps a disjoint selection (both in a sibling block and past the
/// moved group) to its exact surviving text, and safely collapses a selection
/// that partially overlaps the moved block's boundary.
#[test]
fn t5_b6_block_move_relocates_contained_maps_disjoint_and_resolves_partial_overlap() {
    let source = "Alpha one\n\nBravo two\n\nCharlie three\n\nDelta four";
    let parse_bravo = |state: &EditorState| {
        let syntax = Syntax::parse(&state.doc);
        let bounds = BlockBoundaries::of(&syntax, state.revision, true);
        let pos = source.find("Bravo").unwrap();
        block_move::movable_at_boundaries(&state.doc, &bounds, pos).expect("Bravo movable")
    };

    // 1. Contained selection inside moved block (`Bravo two`) relocates with it.
    let mut contained = EditorState::new(source);
    let two_start = source.find("two").unwrap();
    contained.selection = Selection::range(two_start, two_start + 3);
    let movable = parse_bravo(&contained);
    let tr = block_move::move_block_boundaries(&contained, &movable, 3).unwrap();
    contained.apply(tr);
    assert_eq!(
        contained.doc.as_str(),
        "Alpha one\n\nCharlie three\n\nBravo two\n\nDelta four"
    );
    assert_eq!(
        contained.doc.slice(contained.selection.as_range()),
        "two",
        "contained selection must relocate with moved block"
    );

    // 2. Disjoint selection in a sibling block (`Charlie three`) maps cleanly to `three`.
    let mut disjoint_sibling = EditorState::new(source);
    let three_start = source.find("three").unwrap();
    disjoint_sibling.selection = Selection::range(three_start, three_start + 5);
    let movable = parse_bravo(&disjoint_sibling);
    let tr = block_move::move_block_boundaries(&disjoint_sibling, &movable, 3).unwrap();
    disjoint_sibling.apply(tr);
    assert_eq!(
        disjoint_sibling
            .doc
            .slice(disjoint_sibling.selection.as_range()),
        "three",
        "disjoint selection in sibling block must map to sibling's new position"
    );

    // 3. Disjoint selection after the moved region (`Delta four`) maps cleanly to `four`.
    let mut disjoint_after = EditorState::new(source);
    let four_start = source.find("four").unwrap();
    disjoint_after.selection = Selection::range(four_start, four_start + 4);
    let movable = parse_bravo(&disjoint_after);
    let tr = block_move::move_block_boundaries(&disjoint_after, &movable, 3).unwrap();
    disjoint_after.apply(tr);
    assert_eq!(
        disjoint_after
            .doc
            .slice(disjoint_after.selection.as_range()),
        "four",
        "disjoint selection past moved span must preserve its target text"
    );

    // 4. Partial overlap straddling the moved block's start resolves conflict by collapsing cleanly.
    let mut overlap = EditorState::new(source);
    let one_start = source.find("one").unwrap();
    overlap.selection = Selection::range(one_start, two_start + 2);
    let movable = parse_bravo(&overlap);
    let tr = block_move::move_block_boundaries(&overlap, &movable, 3).unwrap();
    overlap.apply(tr);
    let expected_bravo = overlap.doc.as_str().find("Bravo two").unwrap();
    assert!(
        overlap.selection.is_empty(),
        "partial overlap across moved block boundary must collapse cleanly instead of sprawling"
    );
    assert_eq!(
        overlap.selection.head, expected_bravo,
        "partial-overlap conflict collapses to the relocated block start"
    );
}

/// Native companion contract for `markdownEmbedRuntime.test.ts` #4 / #16:
/// editing partway through a fenced code block and pressing `Escape` or losing
/// editor focus retains all typed text in the canonical document (never rolling
/// back) while restoring the code panel to its non-editing (`resting`) visual state.
#[gpui::test]
fn t5_b7_code_block_escape_and_blur_keep_typed_text_and_leave_editing_state(
    cx: &mut TestAppContext,
) {
    let src = "Intro\n\n```ts\nconst a = 1;\n```\n\nOutro";
    let (view, visual) = setup(cx, src);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);

    // Focus inside code block and type partway through.
    let pos = src.find("1;").unwrap() + 2;
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(pos), cx);
    });
    visual.simulate_input(" // wip");
    settle(&view, visual);

    let after_escape_expected = "Intro\n\n```ts\nconst a = 1; // wip\n```\n\nOutro";
    assert!(
        visual.debug_bounds("md-code-panel:focused").is_some(),
        "positive control: code block must render in focused editing state while caret is inside"
    );
    view.read_with(visual, |v, _| assert_eq!(v.text(), after_escape_expected));

    // Press Escape: typed text stays in canonical buffer, decoration returns to resting.
    visual.simulate_keystrokes("escape");
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            after_escape_expected,
            "Escape inside code block must retain typed text without rolling back"
        );
    });
    assert!(
        visual.debug_bounds("md-code-panel:resting").is_some()
            && visual.debug_bounds("md-code-panel:focused").is_none(),
        "Escape inside code block must restore resting non-editing decoration state"
    );

    // Re-enter code block, type more, then blur editor focus: text stays & panel rests.
    let wip_end = after_escape_expected.find("wip").unwrap() + 3;
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(wip_end), cx);
    });
    visual.simulate_input("_2");
    settle(&view, visual);
    assert!(
        visual.debug_bounds("md-code-panel:focused").is_some(),
        "positive control: re-entering code block restores focused state"
    );

    let after_blur_expected = "Intro\n\n```ts\nconst a = 1; // wip_2\n```\n\nOutro";
    visual.update(|w, cx| w.blur(cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            after_blur_expected,
            "blurring editor mid-code-edit must retain typed text without rolling back"
        );
    });
    assert!(
        visual.debug_bounds("md-code-panel:resting").is_some()
            && visual.debug_bounds("md-code-panel:focused").is_none(),
        "blurring editor mid-code-edit must restore resting non-editing decoration state"
    );
}

/// T5-B native invariant: an active IME preedit inside a fenced code block
/// interrupted by `apply_external` abandons the uncommitted preedit cleanly
/// without duplicating or dropping text, and `undo(false)` recovers the
/// pre-composition code rather than the abandoned preedit.
#[gpui::test]
fn t5_b8_ime_composition_inside_code_block_abandoned_cleanly_on_external_edit(
    cx: &mut TestAppContext,
) {
    cx.update(crate::ui::ime::init);
    let src = "Intro\n\n```ts\nconst x = 1;\n```\n\nOutro";
    let (view, visual) = setup(cx, src);
    settle(&view, visual);

    let insert_at = src.find("1;").unwrap() + 2;
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(insert_at), cx);
    });
    settle(&view, visual);

    // Start an uncommitted IME composition inside the code block.
    view.update_in(visual, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "nihao", None, w, cx);
    });
    settle(&view, visual);
    view.update_in(visual, |v, w, cx| {
        assert!(
            v.marked_text_range(w, cx).is_some(),
            "positive control: IME composition must be active inside code block"
        );
        assert!(v.text().contains("const x = 1;nihao"));
    });

    // External agent edit updates the document while preedit is open.
    let external = "Agent note\n\nIntro\n\n```ts\nconst x = 1;\n```\n\nOutro";
    view.update(visual, |v, cx| v.apply_external(external, cx));
    settle(&view, visual);

    view.update_in(visual, |v, w, cx| {
        assert!(
            v.marked_text_range(w, cx).is_none(),
            "apply_external must abandon open IME preedit inside code block"
        );
        assert_eq!(
            v.text(),
            external,
            "external text must adopt cleanly without duplicating or keeping abandoned preedit"
        );
    });

    // Undo recovers pre-composition source (`src`), NOT `"const x = 1;nihao"`.
    view.update(visual, |v, cx| v.undo(false, cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            src,
            "undo must recover pre-composition code without resurrecting abandoned preedit"
        );
    });
}
