//! Acceptance tests for the Markdown table component suites (`context-menu.test.ts`,
//! `drag.test.ts`, `structural-edits.test.ts`, `adjacent-prose.test.ts`,
//! `column-widths.test.ts`), split so each test covers at most 3 TS cases with
//! explicit TS case numbers in doc comments and assertion messages.
use super::{MarkdownExtension, setup};
use crate::editor::{
    markdown::features::table::{
        controls::grip_bounds,
        interaction::TableUi,
        layout as table_layout,
        model::table_block,
        structure_command,
        widget::{clear_last_table_ui_for_tests, last_table_ui_for_tests},
    },
    table::{
        menu::Scope,
        operation::{Axis, Operation},
    },
    text::{
        change::ChangeSet,
        selection::Selection,
        state::{Transaction, UserEvent},
    },
    view::{EditorView, decoration::Block},
};
use gpui::{
    Bounds, Entity, FocusHandle, Focusable, Modifiers, TestAppContext, VisualTestContext, point, px,
};

const TABLE_SOURCE: &str =
    "| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n| four | five | six |";

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn mount_table<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
) -> (
    Entity<EditorView>,
    Entity<TableUi>,
    &'a mut VisualTestContext,
) {
    clear_last_table_ui_for_tests();
    let (view, visual) = setup(cx, source);
    visual.update(|w, _| w.activate_window());
    draw(visual);
    let ui = last_table_ui_for_tests().expect("TableWidget must mount TableUi");
    (view, ui, visual)
}

struct MenuMoveCase<'a> {
    case_label: &'a str,
    axis: Axis,
    row: usize,
    col: usize,
    menu_id: &'a str,
    dest: usize,
    expected_line: usize,
    expected_sub: &'a str,
}

fn assert_menu_move_selection(cx: &mut TestAppContext, spec: MenuMoveCase<'_>) {
    let MenuMoveCase {
        case_label,
        axis,
        row,
        col,
        menu_id,
        dest,
        expected_line,
        expected_sub,
    } = spec;
    let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, row, col, point(px(40.), px(40.)), None, w, cx);
    });
    draw(visual);
    let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
    menu.update(visual, |m, cx| {
        assert!(
            m.run_id_for_tests(menu_id, cx),
            "{case_label}: menu item {menu_id} must run"
        );
    });
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert!(
            u.menu.is_none(),
            "{case_label}: menu must close after {menu_id}"
        );
        assert_eq!(
            u.outline(),
            Some((axis, dest)),
            "{case_label}: structural outline must track moved {axis:?} at {dest} after {menu_id}"
        );
    });
    view.read_with(visual, |v, _| {
        let line = v.text().lines().nth(expected_line).unwrap();
        assert!(
            line.contains(expected_sub),
            "{case_label}: {menu_id} expected {expected_sub:?} on line {expected_line}, got {line:?}"
        );
    });
    visual.simulate_keystrokes("escape");
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert_eq!(
            u.outline(),
            None,
            "{case_label}: Escape must clear structural outline"
        );
    });
}

/// `context-menu.test.ts` #0, #1: row menu moves from row 1 col 0 (`move-row-down`)
/// and row 2 col 0 (`move-row-up`) keep the moved row structurally selected and
/// clear the outline on Escape.
#[gpui::test]
fn menu_row_moves_keep_structural_selection_and_clear_on_escape(cx: &mut TestAppContext) {
    assert_menu_move_selection(
        cx,
        MenuMoveCase {
            case_label: "context-menu.test.ts #0",
            axis: Axis::Row,
            row: 1,
            col: 0,
            menu_id: "move-row-down",
            dest: 2,
            expected_line: 3,
            expected_sub: "one",
        },
    );
    assert_menu_move_selection(
        cx,
        MenuMoveCase {
            case_label: "context-menu.test.ts #1",
            axis: Axis::Row,
            row: 2,
            col: 0,
            menu_id: "move-row-up",
            dest: 1,
            expected_line: 2,
            expected_sub: "four",
        },
    );
}

/// `context-menu.test.ts` #2, #3: column menu moves from row 0 col 0
/// (`move-column-right`) and row 0 col 1 (`move-column-left`) keep the moved
/// column structurally selected and clear the outline on Escape.
#[gpui::test]
fn menu_column_moves_keep_structural_selection_and_clear_on_escape(cx: &mut TestAppContext) {
    assert_menu_move_selection(
        cx,
        MenuMoveCase {
            case_label: "context-menu.test.ts #2",
            axis: Axis::Column,
            row: 0,
            col: 0,
            menu_id: "move-column-right",
            dest: 1,
            expected_line: 0,
            expected_sub: "| B",
        },
    );
    assert_menu_move_selection(
        cx,
        MenuMoveCase {
            case_label: "context-menu.test.ts #3",
            axis: Axis::Column,
            row: 0,
            col: 1,
            menu_id: "move-column-left",
            dest: 0,
            expected_line: 0,
            expected_sub: "| B",
        },
    );
}

/// `context-menu.test.ts` #4, #5: moving a column through the cell context menu
/// reorders the column and preserves a later outside focus while the moved
/// structural selection stays active.
#[gpui::test]
fn cell_menu_column_move_preserves_outside_focus_while_selection_stays_active(
    cx: &mut TestAppContext,
) {
    let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, 0, 0, point(px(40.), px(40.)), None, w, cx);
    });
    draw(visual);
    let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
    menu.update(visual, |m, cx| {
        assert!(
            m.run_id_for_tests("move-column-right", cx),
            "context-menu.test.ts #5: cell context menu must execute move-column-right"
        );
    });
    visual.update(|w, cx| outside.focus(w, cx));
    draw(visual);
    visual.update(|w, _| {
        assert!(
            outside.is_focused(w),
            "context-menu.test.ts #4: outside focus must stay preserved after moved selection reattaches"
        );
    });
    ui.read_with(visual, |u, _| {
        assert_eq!(
            u.outline(),
            Some((Axis::Column, 1)),
            "context-menu.test.ts #4/#5: moved column 1 must remain structurally selected"
        );
    });
    view.read_with(visual, |v, _| {
        let header = v.text().lines().next().unwrap();
        assert!(
            header.starts_with("| B") && header.contains("| A") && header.contains("| C"),
            "context-menu.test.ts #5: header must reorder B before A and C, got {header:?}"
        );
    });
}

/// `context-menu.test.ts` #9, #17: table context menu provides roving keyboard
/// navigation, typeahead, and Escape editor-focus restoration (#9), and closes
/// on focus exit without restoring editor focus (#17).
#[gpui::test]
fn menu_keyboard_navigation_typeahead_escape_and_focus_blur(cx: &mut TestAppContext) {
    // context-menu.test.ts #9: roving focus, typeahead, and Escape restores editor focus.
    let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, 1, 0, point(px(20.), px(20.)), None, w, cx);
    });
    draw(visual);
    let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("insert-row-above"),
            "context-menu.test.ts #9: initial focused menu item"
        );
    });
    visual.simulate_keystrokes("right");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("insert-row-below"),
            "context-menu.test.ts #9: right arrow advances roving focus"
        );
    });
    visual.simulate_keystrokes("down");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("duplicate-row"),
            "context-menu.test.ts #9: down arrow advances roving focus"
        );
    });
    visual.simulate_keystrokes("end");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("delete-table"),
            "context-menu.test.ts #9: End jumps to last menu item"
        );
    });
    visual.simulate_keystrokes("d");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("duplicate-row"),
            "context-menu.test.ts #9: typeahead 'd' focuses duplicate-row"
        );
    });
    visual.simulate_keystrokes("escape");
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert!(
            u.menu.is_none(),
            "context-menu.test.ts #9: Escape closes menu"
        );
    });
    view.update_in(visual, |v, w, cx| {
        assert!(
            v.focus_handle(cx).is_focused(w),
            "context-menu.test.ts #9: Escape restores editor focus"
        );
    });

    // context-menu.test.ts #17: closes on focus exit without restoring editor focus.
    let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, 1, 0, point(px(30.), px(30.)), None, w, cx);
    });
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert!(
            u.menu.is_some(),
            "context-menu.test.ts #17: positive control menu opened before blur"
        );
    });
    visual.update(|w, cx| outside.focus(w, cx));
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert!(
            u.menu.is_none(),
            "context-menu.test.ts #17: menu closes on focus exit"
        );
    });
    visual.update(|w, _| {
        assert!(
            outside.is_focused(w),
            "context-menu.test.ts #17: outside target retains focus"
        );
    });
}

fn assert_alignment_reflection(
    cx: &mut TestAppContext,
    case_label: &str,
    delim: &str,
    expected_id: &str,
) {
    let original = format!("| A | B |\n| {delim} | --- |\n| one | two |");
    let (view, ui, visual) = mount_table(cx, &original);
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, 0, 0, point(px(20.), px(20.)), None, w, cx);
    });
    draw(visual);
    let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
    menu.read_with(visual, |m, _| {
        let align_section = &m.sections_for_tests()[2];
        let ids: Vec<_> = align_section.iter().map(|i| i.id).collect();
        assert_eq!(
            ids,
            vec!["align-left", "align-center", "align-right"],
            "{case_label}: must expose exactly three alignment choices"
        );
        let checked: Vec<_> = align_section
            .iter()
            .filter(|i| i.selected)
            .map(|i| i.id)
            .collect();
        assert_eq!(
            checked,
            vec![expected_id],
            "{case_label}: delimiter {delim:?} must reflect {expected_id}"
        );
    });
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            original,
            "{case_label}: opening alignment menu must not edit source"
        );
    });
    menu.update(visual, |m, cx| {
        assert!(
            m.run_id_for_tests("align-center", cx),
            "{case_label}: align-center must run from reflected menu"
        );
    });
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert!(
            u.menu.is_none(),
            "{case_label}: menu must close after applying alignment"
        );
    });
    view.read_with(visual, |v, _| {
        let delim_line = v.text().lines().nth(1).unwrap();
        assert!(
            delim_line.contains(":---:"),
            "{case_label}: expected centered delimiter, got {delim_line:?}"
        );
    });
}

/// `context-menu.test.ts` #10, #11: reflects `---` (#10) and `:---` (#11) as
/// `align-left` in exactly three alignment choices without editing source on open.
#[gpui::test]
fn menu_reflects_default_and_left_column_alignments_without_editing_on_open(
    cx: &mut TestAppContext,
) {
    assert_alignment_reflection(cx, "context-menu.test.ts #10", "---", "align-left");
    assert_alignment_reflection(cx, "context-menu.test.ts #11", ":---", "align-left");
}

/// `context-menu.test.ts` #12, #13: reflects `:---:` (#12) and `---:` (#13) as
/// `align-center` / `align-right` in exactly three alignment choices without
/// editing source on open.
#[gpui::test]
fn menu_reflects_center_and_right_column_alignments_without_editing_on_open(
    cx: &mut TestAppContext,
) {
    assert_alignment_reflection(cx, "context-menu.test.ts #12", ":---:", "align-center");
    assert_alignment_reflection(cx, "context-menu.test.ts #13", "---:", "align-right");
}

/// `context-menu.test.ts` #14, #15, #16: applies Align left (`:---`, #14),
/// Align center (`:---:`, #15), and Align right (`---:`, #16) through the menu.
#[gpui::test]
fn menu_applies_left_center_and_right_column_alignments(cx: &mut TestAppContext) {
    for (case_label, menu_id, expected_marker) in [
        ("context-menu.test.ts #14", "align-left", ":---"),
        ("context-menu.test.ts #15", "align-center", ":---:"),
        ("context-menu.test.ts #16", "align-right", "---:"),
    ] {
        let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
        ui.update_in(visual, |u, w, cx| {
            u.open_menu(Scope::Cell, 0, 0, point(px(20.), px(20.)), None, w, cx);
        });
        draw(visual);
        let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
        menu.update(visual, |m, cx| {
            assert!(
                m.run_id_for_tests(menu_id, cx),
                "{case_label}: {menu_id} must run"
            );
        });
        draw(visual);
        ui.read_with(visual, |u, _| {
            assert!(
                u.menu.is_none(),
                "{case_label}: menu must close after {menu_id}"
            );
        });
        view.read_with(visual, |v, _| {
            let first_cell = v
                .text()
                .lines()
                .nth(1)
                .unwrap()
                .split('|')
                .nth(1)
                .unwrap()
                .trim();
            assert!(
                first_cell.starts_with(expected_marker.chars().next().unwrap())
                    && first_cell.ends_with(expected_marker.chars().last().unwrap()),
                "{case_label}: {menu_id} expected {expected_marker:?}, got {first_cell:?}"
            );
        });
    }
}

/// `context-menu.test.ts` #18, #19: row grip click opens a 6-item horizontal
/// toolbar below the visible grip (#18); column grip highlights its source
/// column from press until menu close and exposes 8 items (Columns + 3
/// Alignment radios, excluding CSV-only width actions) (#19).
#[gpui::test]
fn grip_menus_open_row_toolbar_below_grip_and_highlight_source_column(cx: &mut TestAppContext) {
    // context-menu.test.ts #18: row handle click opens 6-item horizontal toolbar below grip.
    let (_view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    ui.update_in(visual, |u, w, cx| {
        let g = u.frame.as_ref().unwrap().geometry.clone();
        let origin = u.origin.unwrap();
        let (left, width) = g.columns[0];
        let (top, height) = g.rows[1];
        u.pointer_moved(
            point(
                origin.x + px(left + width / 2.),
                origin.y + px(top + height / 2.),
            ),
            cx,
        );
        let grip = grip_bounds(&g, Axis::Row, 1);
        let press = point(
            origin.x + px(grip.origin.x + grip.size.width / 2.),
            origin.y + px(grip.origin.y + grip.size.height / 2.),
        );
        u.start_drag(Axis::Row, press, cx);
        u.end_drag(false, grip, w, cx);
        let open = u
            .menu
            .as_ref()
            .expect("context-menu.test.ts #18: row grip menu must open");
        assert_eq!(
            open.position,
            point(
                origin.x + px(grip.origin.x + 5.),
                origin.y + px(grip.origin.y + grip.size.height - 5. + 4.),
            ),
            "context-menu.test.ts #18: toolbar must anchor below visible row grip"
        );
        let count: usize = open
            .menu
            .read(cx)
            .sections_for_tests()
            .iter()
            .map(Vec::len)
            .sum();
        assert_eq!(
            count, 6,
            "context-menu.test.ts #18: row grip toolbar must contain 6 items"
        );
    });

    // context-menu.test.ts #19: column handle highlights source column from press until menu close,
    // and exposes 8 items (Columns + 3 Alignment radios, none of the CSV-only width commands).
    let (_view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    ui.update_in(visual, |u, w, cx| {
        let g = u.frame.as_ref().unwrap().geometry.clone();
        let origin = u.origin.unwrap();
        let (left, width) = g.columns[1];
        let (top, height) = g.rows[0];
        u.pointer_moved(
            point(
                origin.x + px(left + width / 2.),
                origin.y + px(top + height / 2.),
            ),
            cx,
        );
        let grip = grip_bounds(&g, Axis::Column, 1);
        let press = point(
            origin.x + px(grip.origin.x + 10.),
            origin.y + px(grip.origin.y + 10.),
        );
        u.start_drag(Axis::Column, press, cx);
        assert_eq!(
            u.outline(),
            Some((Axis::Column, 1)),
            "context-menu.test.ts #19: source column highlighted on pointer-down"
        );
        assert!(
            !u.gestures.drag.unwrap().moved,
            "context-menu.test.ts #19: press without drag has moved=false"
        );
        u.end_drag(false, grip, w, cx);
        assert_eq!(
            u.outline(),
            Some((Axis::Column, 1)),
            "context-menu.test.ts #19: source column stays highlighted while menu is open"
        );
        let open = u
            .menu
            .as_ref()
            .expect("context-menu.test.ts #19: column grip menu must open");
        let sections = open.menu.read(cx).sections_for_tests();
        assert_eq!(
            sections.len(),
            2,
            "context-menu.test.ts #19: column grip menu has 2 sections"
        );
        let total: usize = sections.iter().map(Vec::len).sum();
        assert_eq!(
            total, 8,
            "context-menu.test.ts #19: column grip menu exposes 8 items"
        );
        let align_checked: Vec<_> = sections[1].iter().map(|i| (i.id, i.selected)).collect();
        assert_eq!(
            align_checked,
            vec![
                ("align-left", true),
                ("align-center", false),
                ("align-right", false),
            ],
            "context-menu.test.ts #19: alignment radios reflect default left alignment"
        );
        for item in sections.iter().flatten() {
            assert_ne!(
                item.id, "auto-fit-column",
                "context-menu.test.ts #19: no CSV auto-fit action in Markdown table"
            );
            assert!(
                !item.label.contains("Auto fit"),
                "context-menu.test.ts #19: unexpected label {:?}",
                item.label
            );
            assert!(
                !item.label.contains("Fit columns"),
                "context-menu.test.ts #19: unexpected label {:?}",
                item.label
            );
            assert!(
                !item.label.contains("Reset column"),
                "context-menu.test.ts #19: unexpected label {:?}",
                item.label
            );
        }
        u.menu = None;
        assert_eq!(
            u.outline(),
            None,
            "context-menu.test.ts #19: outline clears once column grip menu closes"
        );
    });
}

/// `drag.test.ts` #1, #3: Escape (#1) and window blur (#3) cancel pressed and
/// dragged row/column handles without opening a menu or editing source.
#[gpui::test]
fn drag_cancels_pressed_and_dragged_handles_on_escape_and_window_blur(cx: &mut TestAppContext) {
    for (case_label, cancel_by_blur) in [
        ("drag.test.ts #1 (Escape)", false),
        ("drag.test.ts #3 (blur)", true),
    ] {
        for axis in [Axis::Column, Axis::Row] {
            for moved in [false, true] {
                let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
                ui.update_in(visual, |u, _, cx| {
                    let g = u.frame.as_ref().unwrap().geometry.clone();
                    let origin = u.origin.unwrap();
                    let (left, width) = g.columns[0];
                    let (top, height) = g.rows[1];
                    u.pointer_moved(
                        point(
                            origin.x + px(left + width / 2.),
                            origin.y + px(top + height / 2.),
                        ),
                        cx,
                    );
                    let start = point(origin.x + px(left + 10.), origin.y + px(top + 10.));
                    u.start_drag(axis, start, cx);
                    assert!(
                        u.outline().is_some(),
                        "{case_label} ({axis:?}, moved={moved}): positive control outline active before cancel"
                    );
                    if moved {
                        u.drag_to(point(start.x + px(40.), start.y + px(40.)), cx);
                        assert!(
                            u.gestures.drag.unwrap().moved,
                            "{case_label} ({axis:?}): drag moved flag active before cancel"
                        );
                    }
                });
                draw(visual);
                if cancel_by_blur {
                    ui.update(visual, |u, cx| u.cancel_active_gesture(cx));
                } else {
                    visual.simulate_keystrokes("escape");
                }
                draw(visual);
                ui.read_with(visual, |u, _| {
                    assert!(
                        u.gestures.drag.is_none(),
                        "{case_label} ({axis:?}, moved={moved}): active drag cleared"
                    );
                    assert!(
                        u.menu.is_none(),
                        "{case_label} ({axis:?}, moved={moved}): no menu opened on cancel"
                    );
                    assert_eq!(
                        u.outline(),
                        None,
                        "{case_label} ({axis:?}, moved={moved}): outline cleared on cancel"
                    );
                });
                view.read_with(visual, |v, _| {
                    assert_eq!(
                        v.text(),
                        TABLE_SOURCE,
                        "{case_label} ({axis:?}, moved={moved}): source unchanged on cancel"
                    );
                });
            }
        }
    }
}

/// `drag.test.ts` #4, #5: dragging column 0 to the end keeps column 2
/// structurally selected without stealing outside focus and clears on Escape
/// (#4); dragging body row 1 down keeps row 2 structurally selected without
/// stealing outside focus and clears on cell click (#5).
#[gpui::test]
fn drag_commits_moved_column_and_row_with_structural_selection(cx: &mut TestAppContext) {
    // drag.test.ts #4: dragging column 0 to end keeps column 2 structurally selected
    // without stealing outside focus, and Escape clears it.
    let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
    visual.update(|w, cx| outside.focus(w, cx));
    ui.update_in(visual, |u, w, cx| {
        let g = u.frame.as_ref().unwrap().geometry.clone();
        let origin = u.origin.unwrap();
        let (c0_left, c0_w) = g.columns[0];
        let (r0_top, r0_h) = g.rows[0];
        u.pointer_moved(
            point(
                origin.x + px(c0_left + c0_w / 2.),
                origin.y + px(r0_top + r0_h / 2.),
            ),
            cx,
        );
        let start = point(origin.x + px(c0_left + c0_w / 2.), origin.y + px(r0_top));
        u.start_drag(Axis::Column, start, cx);
        let (c2_left, c2_w) = g.columns[2];
        u.drag_to(
            point(origin.x + px(c2_left + c2_w), origin.y + px(r0_top)),
            cx,
        );
        u.end_drag(false, Bounds::default(), w, cx);
    });
    draw(visual);
    visual.update(|w, _| {
        assert!(
            outside.is_focused(w),
            "drag.test.ts #4: column drag must not steal outside focus"
        );
    });
    ui.read_with(visual, |u, _| {
        assert_eq!(
            u.outline(),
            Some((Axis::Column, 2)),
            "drag.test.ts #4: moved column 2 must stay structurally selected"
        );
    });
    view.read_with(visual, |v, _| {
        let header = v.text().lines().next().unwrap();
        assert!(
            header.starts_with("| B") && header.contains("| C") && header.contains("| A"),
            "drag.test.ts #4: header expected B | C | A, got {header:?}"
        );
    });
    visual.simulate_keystrokes("escape");
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert_eq!(
            u.outline(),
            None,
            "drag.test.ts #4: Escape must clear moved column outline"
        );
    });

    // drag.test.ts #5: dragging body row 1 down keeps row 2 structurally selected
    // without stealing outside focus, and clicking a cell clears it.
    let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
    visual.update(|w, cx| outside.focus(w, cx));
    let cell_point = ui.update_in(visual, |u, w, cx| {
        let g = u.frame.as_ref().unwrap().geometry.clone();
        let origin = u.origin.unwrap();
        let (c0_left, c0_w) = g.columns[0];
        let (r1_top, r1_h) = g.rows[1];
        let (r2_top, r2_h) = g.rows[2];
        u.pointer_moved(
            point(
                origin.x + px(c0_left + c0_w / 2.),
                origin.y + px(r1_top + r1_h / 2.),
            ),
            cx,
        );
        let start = point(origin.x + px(c0_left), origin.y + px(r1_top + r1_h / 2.));
        u.start_drag(Axis::Row, start, cx);
        u.drag_to(
            point(origin.x + px(c0_left), origin.y + px(r2_top + r2_h)),
            cx,
        );
        u.end_drag(false, Bounds::default(), w, cx);
        point(
            origin.x + px(c0_left + 12.),
            origin.y + px(r2_top + r2_h / 2.),
        )
    });
    draw(visual);
    visual.update(|w, _| {
        assert!(
            outside.is_focused(w),
            "drag.test.ts #5: row drag must not steal outside focus"
        );
    });
    ui.read_with(visual, |u, _| {
        assert_eq!(
            u.outline(),
            Some((Axis::Row, 2)),
            "drag.test.ts #5: moved row 2 must stay structurally selected"
        );
    });
    view.read_with(visual, |v, _| {
        let lines: Vec<_> = v.text().lines().collect();
        assert!(
            lines[2].contains("four") && lines[3].contains("one"),
            "drag.test.ts #5: row 1 ('one') moved below row 2 ('four'), got {lines:?}"
        );
    });
    visual.simulate_mouse_down(cell_point, gpui::MouseButton::Left, Modifiers::none());
    visual.simulate_mouse_up(cell_point, gpui::MouseButton::Left, Modifiers::none());
    draw(visual);
    ui.read_with(visual, |u, _| {
        assert_eq!(
            u.outline(),
            None,
            "drag.test.ts #5: clicking a cell must clear moved row outline"
        );
    });
}

/// `structural-edits.test.ts` #0, #1, #2: inserting rows/columns moves the
/// caret into the new cell (#0); after an earlier prefix edit outside the
/// table, both structural commands (#1) and cell edits (#2) target the shifted
/// table range without corrupting surrounding text.
#[gpui::test]
fn structural_edits_insert_rows_columns_and_anchor_after_prefix_edits(cx: &mut TestAppContext) {
    // structural-edits.test.ts #0: adds row and column and moves caret into the new cell.
    let (view, _ui, visual) = mount_table(cx, TABLE_SOURCE);
    view.update_in(visual, |v, w, cx| {
        v.run_command(
            &structure_command(0, Operation::InsertRowBelow, 2, 0),
            w,
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text().lines().count(),
            5,
            "structural-edits.test.ts #0: InsertRowBelow adds 5th line"
        );
        let caret = v.state().selection.head;
        let line_idx = v.state().doc.line_index(caret);
        assert_eq!(
            line_idx, 4,
            "structural-edits.test.ts #0: caret placed in newly appended row"
        );
    });
    view.update_in(visual, |v, w, cx| {
        v.run_command(
            &structure_command(0, Operation::InsertColumnRight, 0, 2),
            w,
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        let header = v.text().lines().next().unwrap();
        assert_eq!(
            header.matches('|').count(),
            5,
            "structural-edits.test.ts #0: InsertColumnRight adds 4th column, got {header:?}"
        );
        assert_eq!(
            v.state().doc.line_index(v.state().selection.head),
            0,
            "structural-edits.test.ts #0: caret stays on header row of inserted column"
        );
    });

    // structural-edits.test.ts #1 & #2: after an earlier edit outside the table's
    // patch, both structural operations (#1) and cell edits (#2) target the shifted range.
    let prefix = "Top\n\nParagraph one\nParagraph two\nParagraph three\n\n";
    let (view, _ui, visual) = mount_table(cx, &format!("{prefix}{TABLE_SOURCE}\nOutro"));
    view.update(visual, |v, cx| {
        let pos = v.state().doc.line_range(1).end;
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(pos..pos, "\nInserted before the table"),
                None,
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    let table_start = view.read_with(visual, |v, _| v.text().find("| A |").unwrap());
    view.update_in(visual, |v, w, cx| {
        v.run_command(
            &structure_command(table_start, Operation::InsertRowBelow, 2, 0),
            w,
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert!(
            v.text().contains("Paragraph two"),
            "structural-edits.test.ts #1: prefix text preserved after shifted structural edit"
        );
        assert!(
            v.text().contains("Outro"),
            "structural-edits.test.ts #1: suffix text preserved after shifted structural edit"
        );
        assert_eq!(
            v.text().matches('|').count(),
            20,
            "structural-edits.test.ts #1: table grew to 5 rows × 4 pipes after prefix shift"
        );
    });
    // Edit first body cell (`one` -> `updated`) after prefix shift.
    view.update(visual, |v, cx| {
        let at = v.text().find("| one").unwrap() + 2;
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(at..at + 3, "updated"),
                None,
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert!(
            v.text().contains("Paragraph two"),
            "structural-edits.test.ts #2: prefix text preserved after shifted cell edit"
        );
        assert!(
            v.text().contains("| updated"),
            "structural-edits.test.ts #2: cell edit committed into shifted table range"
        );
    });
}

/// `adjacent-prose.test.ts` #0, #1: prose immediately following a table renders
/// as normal editor text outside the table widget across structural edits (#0),
/// and typing prose directly after a table keeps the table plan bounded on
/// every keystroke (#1).
#[gpui::test]
fn adjacent_prose_stays_outside_table_widget_across_structural_edits_and_typing(
    cx: &mut TestAppContext,
) {
    // adjacent-prose.test.ts #0: adjacent prose stays normal editor text outside the table.
    let prose = "这里面有几个要素值得注意。";
    let (view, _ui, visual) = mount_table(cx, &format!("{TABLE_SOURCE}\n{prose}"));
    view.read_with(visual, |v, _| {
        let blocks: Vec<_> = v
            .decorations()
            .blocks
            .iter()
            .map(|b| match b {
                Block::Widget { lines, .. } => (true, lines.clone()),
                Block::Line { line, .. } => (false, *line..*line + 1),
            })
            .collect();
        assert_eq!(
            blocks,
            vec![(true, 0..4), (false, 4..5)],
            "adjacent-prose.test.ts #0: adjacent prose must be a normal Block::Line outside the table"
        );
    });
    view.update_in(visual, |v, w, cx| {
        v.run_command(
            &structure_command(0, Operation::InsertRowBelow, 2, 0),
            w,
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text().lines().filter(|l| *l == prose).count(),
            1,
            "adjacent-prose.test.ts #0: adjacent prose line stays unique after row insertion"
        );
        assert!(
            v.text().ends_with(prose),
            "adjacent-prose.test.ts #0: adjacent prose remains after table"
        );
    });

    // adjacent-prose.test.ts #1: typing prose directly after a table keeps
    // the table plan bounded to `0..TABLE_SOURCE.len()` on every keystroke.
    let (view, _ui, visual) = mount_table(cx, &format!("{TABLE_SOURCE}\n"));
    let typed = "正文会留在表格外。";
    view.update_in(visual, |v, _, cx| {
        v.set_selection(Selection::cursor(v.text().len()), cx);
    });
    for ch in typed.chars() {
        let mut buf = [0u8; 4];
        visual.simulate_input(ch.encode_utf8(&mut buf));
        draw(visual);
        view.read_with(visual, |v, _| {
            let md = v.extension::<MarkdownExtension>().unwrap();
            let cache = md.cache.borrow();
            let table_plan = cache
                .parsed
                .as_ref()
                .unwrap()
                .plans
                .iter()
                .find(|p| p.embed().is_some_and(|e| e.feature == "table"))
                .expect("adjacent-prose.test.ts #1: table plan stays mounted");
            assert_eq!(
                table_plan.source,
                0..TABLE_SOURCE.len(),
                "adjacent-prose.test.ts #1: table range must stay bounded after typing {ch:?}"
            );
        });
    }
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            format!("{TABLE_SOURCE}\n{typed}"),
            "adjacent-prose.test.ts #1: typed prose remains intact outside table"
        );
    });
}

/// `column-widths.test.ts` #0, #1, #2: semantic column tracks stay stable
/// before/during/after rich cell editing (#0), wide tables fit automatic tracks
/// to the 640px reading column with auto-fit (#1), and short tables hug their
/// content instead of stretching (#2).
#[gpui::test]
fn semantic_column_tracks_stay_stable_fit_reading_column_and_hug_short_tables(
    cx: &mut TestAppContext,
) {
    // column-widths.test.ts #0: stable semantic column tracks before/during/after rich cell edit.
    let rich = "| **Name** | Value |\n| --- | --- |\n| Alpha | Beta |";
    let (view, ui, visual) = mount_table(cx, rich);
    let widths_before = ui.read_with(visual, |u, _| {
        u.frame.as_ref().unwrap().geometry.columns.clone()
    });
    assert_eq!(
        widths_before.len(),
        2,
        "column-widths.test.ts #0: two semantic column tracks expected"
    );
    // Focus inside `**Name**`, then leave: column geometry must not jump.
    view.update_in(visual, |v, _, cx| {
        v.set_selection(Selection::cursor(rich.find("Name").unwrap() + 1), cx);
    });
    draw(visual);
    let widths_editing = ui.read_with(visual, |u, _| {
        u.frame.as_ref().unwrap().geometry.columns.clone()
    });
    assert_eq!(
        widths_editing, widths_before,
        "column-widths.test.ts #0: column widths must not jump when focusing rich cell"
    );
    view.update_in(visual, |v, _, cx| {
        v.set_selection(Selection::cursor(rich.len()), cx);
    });
    draw(visual);
    let widths_after = ui.read_with(visual, |u, _| {
        u.frame.as_ref().unwrap().geometry.columns.clone()
    });
    assert_eq!(
        widths_after, widths_before,
        "column-widths.test.ts #0: column widths must stay stable after leaving cell"
    );

    // column-widths.test.ts #1: fits automatic tracks to the 640px reading column
    // by content and auto-fits within it.
    let wide_src = format!(
        "| {} | B |\n| --- | --- |\n| Alpha | Beta |",
        "wide ".repeat(80)
    );
    let doc = crate::editor::text::buffer::Buffer::new(&wide_src);
    let table = table_block(&doc, &(0..doc.len())).unwrap();
    let widths = table_layout::column_widths(&table, 640., 13., 21.);
    assert_eq!(
        widths[0] + widths[1],
        638.,
        "column-widths.test.ts #1: wide table tracks must sum to reading column interior (638px)"
    );
    assert!(
        widths[0] > 500.,
        "column-widths.test.ts #1: wide column receives proportional share, got {widths:?}"
    );
    assert!(
        widths[1] < 80.,
        "column-widths.test.ts #1: narrow column stays compact, got {widths:?}"
    );
    assert_eq!(
        table_layout::natural_width(&table, 0, 640., 13., 21.),
        638.,
        "column-widths.test.ts #1: auto-fit caps natural width at reading column"
    );

    // column-widths.test.ts #2: short table hugs its content instead of stretching.
    let short_src = "| 字段 | 值 |\n| --- | --- |\n| Title | puppyone |";
    let short_doc = crate::editor::text::buffer::Buffer::new(short_src);
    let short_table = table_block(&short_doc, &(0..short_doc.len())).unwrap();
    let short_widths = table_layout::column_widths(&short_table, 640., 13., 21.);
    assert_eq!(
        short_widths.len(),
        2,
        "column-widths.test.ts #2: two column tracks for short table"
    );
    assert!(
        short_widths[0] + short_widths[1] < 240.,
        "column-widths.test.ts #2: short table should hug content (< 240px), got {short_widths:?}"
    );
}
