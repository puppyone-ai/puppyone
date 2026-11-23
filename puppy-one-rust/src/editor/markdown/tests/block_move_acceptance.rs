//! Acceptance tests for `markdownBlockMove.test.ts` (`editor-comp-6-block-move`):
//! root block moves, separator preservation, nested list items, no-op & read-only
//! guards, single-step undo/redo history, fenced-block byte-for-byte moves,
//! ordered list renumbering with undo/redo, experiment toggle off, keyboard vs
//! drop scroll policy, line-based targeting, lone list items, blank lines inside
//! fences vs between blocks/loose list items, and YAML frontmatter exclusion.
use super::setup;
use crate::editor::{
    markdown::{
        addons::block_drag::BlockDragAddon,
        core::{
            commands::block_move,
            syntax::{Syntax, block_boundaries::BlockBoundaries},
        },
    },
    text::{selection::Selection, state::EditorState},
    view::plugins::ViewPlugin,
};
use gpui::TestAppContext;

fn boundaries_of(state: &EditorState) -> BlockBoundaries {
    let syntax = Syntax::parse(&state.doc);
    BlockBoundaries::of(&syntax, state.revision, true)
}

#[test]
fn root_blocks_move_preserving_separators_trailing_newline_and_selection_direction() {
    // Case 0: moves a root block downward without normalizing source or trailing newline.
    let source = "Alpha\n\nBravo\n\nCharlie\n";
    let mut state = EditorState::new(source);
    let caret = source.find("avo").unwrap();
    state.selection = Selection::cursor(caret);
    let b = boundaries_of(&state);
    let movable = block_move::movable_at_boundaries(&state.doc, &b, caret).unwrap();
    assert_eq!(movable.range, 7..12);
    let tr = block_move::move_block_boundaries(&state, &movable, movable.group.len()).unwrap();
    state.apply(tr);
    assert_eq!(state.doc.as_str(), "Alpha\n\nCharlie\n\nBravo\n");
    assert_eq!(state.selection.head, 18);

    // Case 1: moves a root block upward and preserves backward selection direction.
    let source = "Alpha\n\nBravo\n\nCharlie";
    let anchor = source.find("lie").unwrap();
    let mut state = EditorState::new(source);
    state.selection = Selection::range(anchor + 2, anchor);
    let b = boundaries_of(&state);
    let movable = block_move::movable_at_boundaries(&state.doc, &b, anchor).unwrap();
    let tr = block_move::move_block_boundaries(&state, &movable, 0).unwrap();
    state.apply(tr);
    assert_eq!(state.doc.as_str(), "Charlie\n\nAlpha\n\nBravo");
    assert_eq!(state.selection.anchor, 6);
    assert_eq!(state.selection.head, 4);

    // Case 2: keeps distinct separators on both sides of an interior drop boundary.
    let source = "# A\n\nB\n\n\n# C\n\nD";
    let mut state = EditorState::new(source);
    let caret = source.find('B').unwrap();
    state.selection = Selection::cursor(caret);
    let b = boundaries_of(&state);
    let movable = block_move::movable_at_boundaries(&state.doc, &b, caret).unwrap();
    let tr = block_move::move_block_boundaries(&state, &movable, 3).unwrap();
    state.apply(tr);
    assert_eq!(state.doc.as_str(), "# A\n\n# C\n\n\nB\n\nD");

    // Case 3: moves a list item with nested children only among sibling items.
    let source = "- first\n  - nested\n- second\n- third";
    let mut state = EditorState::new(source);
    let caret = source.find("first").unwrap() + 1;
    state.selection = Selection::cursor(caret);
    let b = boundaries_of(&state);
    let movable = block_move::movable_at_boundaries(&state.doc, &b, caret).unwrap();
    assert!(movable.depth > 0);
    assert_eq!(movable.group.len(), 3);
    let tr = block_move::move_block_boundaries(&state, &movable, movable.group.len()).unwrap();
    state.apply(tr);
    assert_eq!(state.doc.as_str(), "- second\n- third\n- first\n  - nested");

    // Case 4 (no-op part): rejects adjacent/no-op moves.
    let state = EditorState::new("One\n\nTwo");
    let b = boundaries_of(&state);
    let movable = block_move::movable_at_boundaries(&state.doc, &b, 1).unwrap();
    assert!(block_move::move_block_boundaries(&state, &movable, movable.index).is_none());
    assert!(block_move::move_block_boundaries(&state, &movable, movable.index + 1).is_none());
}

#[test]
fn block_targeting_handles_columns_list_items_blank_lines_and_frontmatter() {
    // Case 12: answers by line, so every column of a row names the same block.
    let list = "- first\n- second\n  - nested one\n  - nested two\n- third";
    let state = EditorState::new(list);
    let b = boundaries_of(&state);
    let line = state.doc.line_range(3);
    let expected_start = line.start + 2;
    for pos in [line.start, line.start + 2, line.start + 6, line.end] {
        let m = block_move::movable_at_boundaries(&state.doc, &b, pos).unwrap();
        assert!(m.depth > 0, "pos {pos}");
        assert_eq!(m.range, expected_start..line.end, "pos {pos}");
        // Also verify `movable_at` over full Syntax stays identical.
        let syntax = Syntax::parse(&state.doc);
        assert_eq!(
            block_move::movable_at(&state.doc, &syntax, pos)
                .unwrap()
                .range,
            expected_start..line.end
        );
    }

    // Case 13: never widens a list item to its whole list at the end of a row.
    let last = state.doc.line_range(4);
    let last_m = block_move::movable_at_boundaries(&state.doc, &b, last.end).unwrap();
    assert!(last_m.depth > 0 && last_m.range.start == last.start);
    let first_line = state.doc.line_range(0);
    let first_m = block_move::movable_at_boundaries(&state.doc, &b, first_line.end).unwrap();
    assert!(first_m.depth > 0 && first_m.range.start == 0);

    // Case 14: gives a lone list item to its container instead of no block.
    let lone = EditorState::new("- only\n\nAfter");
    let lone_b = boundaries_of(&lone);
    let lone_m = block_move::movable_at_boundaries(&lone.doc, &lone_b, 2).unwrap();
    assert_eq!((lone_m.depth, lone_m.range), (0, 0..6));

    let nested = EditorState::new("- parent\n  - only child\n- sibling");
    let nested_b = boundaries_of(&nested);
    let child_end = nested.doc.line_range(1).end;
    let nested_m = block_move::movable_at_boundaries(&nested.doc, &nested_b, child_end).unwrap();
    assert!(nested_m.depth > 0 && nested_m.range.start == 0);

    // Case 15: assigns a blank line between blocks or loose list items to neither.
    let blanks = EditorState::new("One\n\nTwo\n\n- a\n\n- b");
    let blanks_b = boundaries_of(&blanks);
    assert!(block_move::movable_at_boundaries(&blanks.doc, &blanks_b, 4).is_none());
    let loose_blank = blanks.doc.line_range(5).start;
    assert!(block_move::movable_at_boundaries(&blanks.doc, &blanks_b, loose_blank).is_none());

    // Case 16: keeps a blank line inside a code fence with its fence.
    let fence = EditorState::new("Intro\n\n```js\na\n\nb\n```\n\nOutro");
    let fence_b = boundaries_of(&fence);
    let blank_in_fence = fence.doc.line_range(4).start;
    let fence_m = block_move::movable_at_boundaries(&fence.doc, &fence_b, blank_in_fence)
        .expect("blank line inside fence must target the fence");
    assert_eq!(fence_m.depth, 0);
    assert_eq!(fence_m.range.start, 7);
    let fence_syntax = Syntax::parse(&fence.doc);
    assert_eq!(
        block_move::movable_at(&fence.doc, &fence_syntax, blank_in_fence)
            .unwrap()
            .range
            .start,
        7
    );

    // Case 17: keeps YAML frontmatter out of every move.
    let fm_source = "---\ntitle: Hello\n---\n\nOne\n\nTwo";
    let mut fm = EditorState::new(fm_source);
    let fm_b = boundaries_of(&fm);
    for line_idx in [0, 1, 2] {
        let pos = fm.doc.line_range(line_idx).start;
        assert!(block_move::movable_at_boundaries(&fm.doc, &fm_b, pos).is_none());
    }
    let two = block_move::movable_at_boundaries(&fm.doc, &fm_b, fm_source.find("Two").unwrap())
        .expect("Two is movable");
    assert_eq!(two.group.len(), 2);
    let tr = block_move::move_block_boundaries(&fm, &two, 0).unwrap();
    fm.apply(tr);
    assert_eq!(fm.doc.as_str(), "---\ntitle: Hello\n---\n\nTwo\n\nOne");

    // Case 18: offers no handle for the only block after frontmatter.
    let alone_source = "---\ntitle: Hello\n---\n\nAlone";
    let alone = EditorState::new(alone_source);
    let alone_b = boundaries_of(&alone);
    assert!(
        block_move::movable_at_boundaries(
            &alone.doc,
            &alone_b,
            alone_source.find("Alone").unwrap()
        )
        .is_none()
    );
}

#[gpui::test]
fn keyboard_moves_history_fences_renumbering_readonly_scroll_and_toggle_off(
    cx: &mut TestAppContext,
) {
    // Case 5: records one history event per keyboard movement with undo/redo.
    let (view, visual) = setup(cx, "One\n\nTwo\n\nThree\n\nFour");
    block_move::set_enabled(true);
    let two = "One\n\nTwo".find("Two").unwrap() + 1;
    view.update_in(visual, |v, _, cx| {
        v.set_selection(Selection::cursor(two), cx)
    });
    visual.simulate_keystrokes("secondary-shift-down");
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "One\n\nThree\n\nTwo\n\nFour")
    });
    visual.simulate_keystrokes("secondary-shift-down");
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "One\n\nThree\n\nFour\n\nTwo")
    });
    visual.simulate_keystrokes("secondary-z");
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "One\n\nThree\n\nTwo\n\nFour")
    });
    visual.simulate_keystrokes("secondary-z");
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "One\n\nTwo\n\nThree\n\nFour")
    });
    visual.simulate_keystrokes("secondary-shift-z");
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "One\n\nThree\n\nTwo\n\nFour")
    });

    // Case 4 (read-only part): rejects moves in read-only state.
    let (ro_view, ro_visual) = setup(cx, "One\n\nTwo");
    block_move::set_enabled(true);
    ro_view.update_in(ro_visual, |v, _, cx| {
        v.set_read_only(true, cx);
        v.set_selection(Selection::cursor(1), cx);
    });
    ro_visual.simulate_keystrokes("secondary-shift-down");
    ro_view.read_with(ro_visual, |v, _| assert_eq!(v.text(), "One\n\nTwo"));

    // Case 6: moves a fenced block byte-for-byte with caret tracking.
    let fenced = "```js\nx()\n```";
    let fence_src = format!("Intro\n\n{fenced}\n\nOutro");
    let (fence_view, fence_visual) = setup(cx, &fence_src);
    block_move::set_enabled(true);
    let caret_in_fence = fence_src.find("x()").unwrap() + 1;
    fence_view.update_in(fence_visual, |v, _, cx| {
        v.set_selection(Selection::cursor(caret_in_fence), cx)
    });
    fence_visual.simulate_keystrokes("secondary-shift-down");
    fence_view.read_with(fence_visual, |v, _| {
        let expected = format!("Intro\n\nOutro\n\n{fenced}");
        assert_eq!(v.text(), expected);
        assert_eq!(v.state().selection.head, expected.find("x()").unwrap() + 1);
    });

    // Case 7: renumbers ordered siblings atomically and reverses cleanly on undo/redo.
    let ordered_src = "9. nine\n10. ten\n11. eleven";
    let (ord_view, ord_visual) = setup(cx, ordered_src);
    block_move::set_enabled(true);
    let ten_caret = ordered_src.find("ten").unwrap() + 1;
    ord_view.update_in(ord_visual, |v, _, cx| {
        v.set_selection(Selection::cursor(ten_caret), cx)
    });
    ord_visual.simulate_keystrokes("secondary-shift-up");
    ord_view.read_with(ord_visual, |v, _| {
        assert_eq!(v.text(), "1. ten\n2. nine\n3. eleven");
        assert_eq!(v.state().selection.head, 4);
    });
    ord_visual.simulate_keystrokes("secondary-z");
    ord_view.read_with(ord_visual, |v, _| assert_eq!(v.text(), ordered_src));
    ord_visual.simulate_keystrokes("secondary-shift-z");
    ord_view.read_with(ord_visual, |v, _| {
        assert_eq!(v.text(), "1. ten\n2. nine\n3. eleven")
    });

    // Case 10: keyboard move reveals caret (`scroll_into_view == true`) while drop keeps viewport (`false`).
    let (scroll_view, scroll_visual) = setup(cx, "One\n\nTwo\n\nThree");
    block_move::set_enabled(true);
    scroll_view.update(scroll_visual, |v, _| {
        let state = v.state().clone();
        let mut s = state.clone();
        s.selection = Selection::cursor("One\n\nTwo".find("Two").unwrap() + 1);
        let b = boundaries_of(&s);
        let kb_tr = block_move::move_by_keyboard_boundaries(&s, &b, true).unwrap();
        assert!(
            kb_tr.scroll_into_view,
            "keyboard move must scroll into view"
        );
        let addon = v.plugin_mut::<BlockDragAddon>().unwrap();
        assert!(addon.begin_drag_for_tests(&s.doc, s.revision, s.selection.head, 3));
        let drop_tr = addon.finish_drag_for_tests(&s, false).unwrap();
        assert!(!drop_tr.scroll_into_view, "pointer drop must not scroll");
    });

    // Case 11: moves the block holding a caret at the very end of its line.
    let (eol_view, eol_visual) = setup(cx, "One\n\nTwo\n\nThree");
    block_move::set_enabled(true);
    eol_view.update_in(eol_visual, |v, _, cx| {
        v.set_selection(Selection::cursor("One\n\nTwo".len()), cx)
    });
    eol_visual.simulate_keystrokes("secondary-shift-down");
    eol_view.read_with(eol_visual, |v, _| {
        assert_eq!(v.text(), "One\n\nThree\n\nTwo")
    });

    // Case 8: turning the experiment off removes overlay elements and restores default keys.
    let (off_view, off_visual) = setup(cx, "One\n\nTwo");
    block_move::set_enabled(true);
    off_visual.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    off_view.update(off_visual, |v, cx| {
        assert!(crate::editor::markdown::begin_block_drag_for_tests(v, 0, 2));
        let addon = v.plugin::<BlockDragAddon>().unwrap();
        assert!(
            !addon.overlay(v, cx).is_empty(),
            "overlay renders while enabled"
        );
    });
    block_move::set_enabled(false);
    off_view.update_in(off_visual, |v, _, cx| {
        let addon = v.plugin::<BlockDragAddon>().unwrap();
        assert!(
            addon.overlay(v, cx).is_empty(),
            "overlay clears when disabled"
        );
        v.set_selection(Selection::cursor(0), cx);
    });
    off_visual.simulate_keystrokes("secondary-shift-down");
    off_view.read_with(off_visual, |v, _| {
        assert_eq!(v.text(), "One\n\nTwo");
        assert_eq!(v.state().selection, Selection::range(0, v.text().len()));
    });
}

#[gpui::test]
fn blocks_move_by_keyboard_and_by_handle_with_the_experiment(cx: &mut TestAppContext) {
    use crate::editor::markdown::core::commands::block_move;
    let text = "# A\n\npara\n\nlast";
    let (view, cx) = setup(cx, text);
    block_move::set_enabled(true);
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.simulate_keystrokes("secondary-shift-down");
    view.update(cx, |v, _| assert_eq!(v.text(), "para\n\n# A\n\nlast"));
    // The handle's drop moves the block it dragged via `addons::block_drag`.
    view.update_in(cx, |v, _, cx| {
        assert!(crate::editor::markdown::begin_block_drag_for_tests(
            v, 13, 0
        ));
        crate::editor::markdown::finish_block_drag_for_tests(v, cx);
    });
    view.update(cx, |v, _| assert_eq!(v.text(), "last\n\npara\n\n# A"));
    block_move::set_enabled(false);
    // Without the experiment the keys select to the document's edge.
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.simulate_keystrokes("secondary-shift-down");
    view.update(cx, |v, _| {
        assert_eq!(v.text(), "last\n\npara\n\n# A");
        assert_eq!(v.state().selection, Selection::range(0, v.text().len()));
    });
}
