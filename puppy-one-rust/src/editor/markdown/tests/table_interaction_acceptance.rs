//! Acceptance tests for the Markdown table component suites (`context-menu.test.ts`,
//! `drag.test.ts`, `structural-edits.test.ts`, `adjacent-prose.test.ts`,
//! `column-widths.test.ts`):
//! - Context menu row/column moves with structural selection outline, outside
//!   focus preservation, and Escape dismissal.
//! - Roving keyboard focus, typeahead, Escape focus restoration, and focus-exit blur.
//! - Alignment reflection (`---`, `:---`, `:---:`, `---:`) and application.
//! - Row & column grip menus, source column highlighting, and drag cancellation
//!   on Escape and window blur.
//! - Dragging rows & columns with structural selection and click/Escape dismissal.
//! - Structural row/column insertion, caret placement, and prefix-edit anchoring.
//! - Adjacent prose staying outside the table widget across live typing.
//! - Semantic column widths (stable across cell focus, reading-column fit +
//!   auto-fit, and compact tables hugging content).
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
    Bounds, Entity, FocusHandle, Focusable, Modifiers, TestAppContext, VisualTestContext, point,
    px, size,
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

#[gpui::test]
fn menu_moves_keep_structural_selection_preserve_outside_focus_and_clear_on_escape(
    cx: &mut TestAppContext,
) {
    // context-menu.test.ts cases 0..=3: row/column menu moves leave the whole
    // moved row/column structurally selected and Escape clears the outline.
    for (axis, row, col, menu_id, dest, expected_line, expected_sub) in [
        (Axis::Row, 1, 0, "move-row-down", 2, 3, "one"),
        (Axis::Row, 2, 0, "move-row-up", 1, 2, "four"),
        (Axis::Column, 0, 0, "move-column-right", 1, 0, "| B"),
        (Axis::Column, 0, 1, "move-column-left", 0, 0, "| B"),
    ] {
        let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
        ui.update_in(visual, |u, w, cx| {
            u.open_menu(Scope::Cell, row, col, point(px(40.), px(40.)), None, w, cx);
        });
        draw(visual);
        let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
        menu.update(visual, |m, cx| {
            assert!(m.run_id_for_tests(menu_id, cx), "menu item {menu_id}");
        });
        draw(visual);
        ui.read_with(visual, |u, _| {
            assert!(u.menu.is_none(), "menu closes after {menu_id}");
            assert_eq!(u.outline(), Some((axis, dest)), "outline for {menu_id}");
        });
        view.read_with(visual, |v, _| {
            let line = v.text().lines().nth(expected_line).unwrap();
            assert!(line.contains(expected_sub), "{menu_id}: {line:?}");
        });
        visual.simulate_keystrokes("escape");
        draw(visual);
        ui.read_with(visual, |u, _| {
            assert_eq!(u.outline(), None, "Escape must clear structural outline");
        });
    }

    // context-menu.test.ts case 4: keeps a later outside focus while the moved
    // selection stays active; case 5: cell context menu moves column right.
    let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, 0, 0, point(px(40.), px(40.)), None, w, cx);
    });
    draw(visual);
    let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
    menu.update(visual, |m, cx| {
        assert!(m.run_id_for_tests("move-column-right", cx));
    });
    visual.update(|w, cx| outside.focus(w, cx));
    draw(visual);
    visual.update(|w, _| assert!(outside.is_focused(w), "outside focus preserved"));
    ui.read_with(visual, |u, _| {
        assert_eq!(u.outline(), Some((Axis::Column, 1)));
    });
    view.read_with(visual, |v, _| {
        let header = v.text().lines().next().unwrap();
        assert!(
            header.starts_with("| B") && header.contains("| A") && header.contains("| C"),
            "{header:?}"
        );
    });
}

#[gpui::test]
fn menu_keyboard_navigation_typeahead_escape_and_focus_blur(cx: &mut TestAppContext) {
    // context-menu.test.ts case 9: roving focus, typeahead, and Escape restores editor focus.
    let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, 1, 0, point(px(20.), px(20.)), None, w, cx);
    });
    draw(visual);
    let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("insert-row-above")
        );
    });
    visual.simulate_keystrokes("right");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("insert-row-below")
        );
    });
    visual.simulate_keystrokes("down");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("duplicate-row")
        );
    });
    visual.simulate_keystrokes("end");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("delete-table")
        );
    });
    visual.simulate_keystrokes("d");
    menu.read_with(visual, |m, _| {
        assert_eq!(
            m.selected_item_for_tests().map(|i| i.id),
            Some("duplicate-row")
        );
    });
    visual.simulate_keystrokes("escape");
    draw(visual);
    ui.read_with(visual, |u, _| assert!(u.menu.is_none()));
    view.update_in(visual, |v, w, cx| {
        assert!(
            v.focus_handle(cx).is_focused(w),
            "Escape restores editor focus"
        );
    });

    // context-menu.test.ts case 17: closes on focus exit without restoring editor focus.
    let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
    ui.update_in(visual, |u, w, cx| {
        u.open_menu(Scope::Cell, 1, 0, point(px(30.), px(30.)), None, w, cx);
    });
    draw(visual);
    ui.read_with(visual, |u, _| assert!(u.menu.is_some()));
    visual.update(|w, cx| outside.focus(w, cx));
    draw(visual);
    ui.read_with(visual, |u, _| assert!(u.menu.is_none()));
    visual.update(|w, _| assert!(outside.is_focused(w)));
}

#[gpui::test]
fn menu_reflects_and_applies_exactly_three_column_alignments(cx: &mut TestAppContext) {
    // context-menu.test.ts cases 10..=13: reflect ---, :---, :---:, ---: without editing on open.
    for (delim, expected_id) in [
        ("---", "align-left"),
        (":---", "align-left"),
        (":---:", "align-center"),
        ("---:", "align-right"),
    ] {
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
            assert_eq!(ids, vec!["align-left", "align-center", "align-right"]);
            let checked: Vec<_> = align_section
                .iter()
                .filter(|i| i.selected)
                .map(|i| i.id)
                .collect();
            assert_eq!(checked, vec![expected_id], "delimiter {delim}");
        });
        view.read_with(visual, |v, _| assert_eq!(v.text(), original));
        menu.update(visual, |m, cx| {
            assert!(m.run_id_for_tests("align-center", cx));
        });
        draw(visual);
        ui.read_with(visual, |u, _| assert!(u.menu.is_none()));
        view.read_with(visual, |v, _| {
            let delim_line = v.text().lines().nth(1).unwrap();
            assert!(delim_line.contains(":---:"), "{delim_line:?}");
        });
    }

    // context-menu.test.ts cases 14..=16: apply Align left, center, right.
    for (menu_id, expected_marker) in [
        ("align-left", ":---"),
        ("align-center", ":---:"),
        ("align-right", "---:"),
    ] {
        let (view, ui, visual) = mount_table(cx, TABLE_SOURCE);
        ui.update_in(visual, |u, w, cx| {
            u.open_menu(Scope::Cell, 0, 0, point(px(20.), px(20.)), None, w, cx);
        });
        draw(visual);
        let menu = ui.read_with(visual, |u, _| u.menu.as_ref().unwrap().menu.clone());
        menu.update(visual, |m, cx| {
            assert!(m.run_id_for_tests(menu_id, cx));
        });
        draw(visual);
        ui.read_with(visual, |u, _| assert!(u.menu.is_none()));
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
                "{menu_id}: {first_cell:?}"
            );
        });
    }
}

#[gpui::test]
fn grip_menus_highlight_source_and_drag_cancel_or_commit_with_selection(cx: &mut TestAppContext) {
    // context-menu.test.ts case 18: row handle click opens 6-item horizontal toolbar below grip.
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
        let open = u.menu.as_ref().expect("row grip menu opened");
        assert_eq!(
            open.position,
            point(
                origin.x + px(grip.origin.x + 5.),
                origin.y + px(grip.origin.y + grip.size.height - 5. + 4.),
            )
        );
        let count: usize = open
            .menu
            .read(cx)
            .sections_for_tests()
            .iter()
            .map(Vec::len)
            .sum();
        assert_eq!(count, 6);
    });

    // context-menu.test.ts case 19: column handle highlights source column from press until menu closes,
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
        assert_eq!(u.outline(), Some((Axis::Column, 1)));
        assert!(!u.gestures.drag.unwrap().moved);
        u.end_drag(false, grip, w, cx);
        assert_eq!(u.outline(), Some((Axis::Column, 1)));
        let open = u.menu.as_ref().expect("column grip menu opened");
        let sections = open.menu.read(cx).sections_for_tests();
        assert_eq!(sections.len(), 2);
        let total: usize = sections.iter().map(Vec::len).sum();
        assert_eq!(total, 8);
        let align_checked: Vec<_> = sections[1].iter().map(|i| (i.id, i.selected)).collect();
        assert_eq!(
            align_checked,
            vec![
                ("align-left", true),
                ("align-center", false),
                ("align-right", false),
            ]
        );
        for item in sections.iter().flatten() {
            assert_ne!(item.id, "auto-fit-column");
            assert!(!item.label.contains("Auto fit"));
            assert!(!item.label.contains("Fit columns"));
            assert!(!item.label.contains("Reset column"));
        }
        u.menu = None;
        assert_eq!(u.outline(), None);
    });

    // drag.test.ts cases 1 (Escape) & 3 (window blur): cancel pressed and dragged handles
    // without opening a menu or editing source.
    for cancel_by_blur in [false, true] {
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
                    assert!(u.outline().is_some());
                    if moved {
                        u.drag_to(point(start.x + px(40.), start.y + px(40.)), cx);
                        assert!(u.gestures.drag.unwrap().moved);
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
                    assert!(u.gestures.drag.is_none());
                    assert!(u.menu.is_none());
                    assert_eq!(u.outline(), None);
                });
                view.read_with(visual, |v, _| assert_eq!(v.text(), TABLE_SOURCE));
            }
        }
    }

    // drag.test.ts case 4: dragging column 0 to end keeps column 2 structurally selected
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
    visual.update(|w, _| assert!(outside.is_focused(w)));
    ui.read_with(visual, |u, _| {
        assert_eq!(u.outline(), Some((Axis::Column, 2)))
    });
    view.read_with(visual, |v, _| {
        let header = v.text().lines().next().unwrap();
        assert!(
            header.starts_with("| B") && header.contains("| C") && header.contains("| A"),
            "{header:?}"
        );
    });
    visual.simulate_keystrokes("escape");
    draw(visual);
    ui.read_with(visual, |u, _| assert_eq!(u.outline(), None));

    // drag.test.ts case 5: dragging body row 1 down keeps row 2 structurally selected
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
    visual.update(|w, _| assert!(outside.is_focused(w)));
    ui.read_with(visual, |u, _| assert_eq!(u.outline(), Some((Axis::Row, 2))));
    view.read_with(visual, |v, _| {
        let lines: Vec<_> = v.text().lines().collect();
        assert!(
            lines[2].contains("four") && lines[3].contains("one"),
            "{lines:?}"
        );
    });
    visual.simulate_mouse_down(cell_point, gpui::MouseButton::Left, Modifiers::none());
    visual.simulate_mouse_up(cell_point, gpui::MouseButton::Left, Modifiers::none());
    draw(visual);
    ui.read_with(visual, |u, _| assert_eq!(u.outline(), None));
}

#[gpui::test]
fn structural_edits_anchor_after_prefix_edits_and_keep_adjacent_prose_outside(
    cx: &mut TestAppContext,
) {
    // structural-edits.test.ts case 0: adds row and column and moves caret into the new cell.
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
        assert_eq!(v.text().lines().count(), 5);
        let caret = v.state().selection.head;
        let line_idx = v.state().doc.line_index(caret);
        assert_eq!(line_idx, 4, "caret placed in newly appended row");
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
        assert_eq!(header.matches('|').count(), 5, "{header:?}");
        assert_eq!(v.state().doc.line_index(v.state().selection.head), 0);
    });

    // structural-edits.test.ts cases 1 & 2: after an earlier edit outside the table's
    // patch, both structural operations and cell edits target the shifted table range.
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
        assert!(v.text().contains("Paragraph two"));
        assert!(v.text().contains("Outro"));
        assert_eq!(v.text().matches('|').count(), 20);
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
        assert!(v.text().contains("Paragraph two"));
        assert!(v.text().contains("| updated"));
    });

    // adjacent-prose.test.ts case 0: adjacent prose stays normal editor text outside the table.
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
        assert_eq!(blocks, vec![(true, 0..4), (false, 4..5)]);
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
        assert_eq!(v.text().lines().filter(|l| *l == prose).count(), 1);
        assert!(v.text().ends_with(prose));
    });

    // adjacent-prose.test.ts case 1: typing prose directly after a table keeps
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
                .expect("table plan stays mounted");
            assert_eq!(table_plan.source, 0..TABLE_SOURCE.len(), "after {ch}");
        });
    }
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), format!("{TABLE_SOURCE}\n{typed}"));
    });
}

#[gpui::test]
fn semantic_column_tracks_stay_stable_fit_reading_column_and_hug_short_tables(
    cx: &mut TestAppContext,
) {
    // column-widths.test.ts case 0: stable semantic column tracks before/during/after rich cell edit.
    let rich = "| **Name** | Value |\n| --- | --- |\n| Alpha | Beta |";
    let (view, ui, visual) = mount_table(cx, rich);
    let widths_before = ui.read_with(visual, |u, _| {
        u.frame.as_ref().unwrap().geometry.columns.clone()
    });
    assert_eq!(widths_before.len(), 2);
    // Focus inside `**Name**`, then leave: column geometry must not jump.
    view.update_in(visual, |v, _, cx| {
        v.set_selection(Selection::cursor(rich.find("Name").unwrap() + 1), cx);
    });
    draw(visual);
    let widths_editing = ui.read_with(visual, |u, _| {
        u.frame.as_ref().unwrap().geometry.columns.clone()
    });
    assert_eq!(widths_editing, widths_before);
    view.update_in(visual, |v, _, cx| {
        v.set_selection(Selection::cursor(rich.len()), cx);
    });
    draw(visual);
    let widths_after = ui.read_with(visual, |u, _| {
        u.frame.as_ref().unwrap().geometry.columns.clone()
    });
    assert_eq!(widths_after, widths_before);

    // column-widths.test.ts case 1: fits automatic tracks to the 640px reading column
    // by content and auto-fits within it.
    let wide_src = format!(
        "| {} | B |\n| --- | --- |\n| Alpha | Beta |",
        "wide ".repeat(80)
    );
    let doc = crate::editor::text::buffer::Buffer::new(&wide_src);
    let table = table_block(&doc, &(0..doc.len())).unwrap();
    let widths = table_layout::column_widths(&table, 640., 13., 21.);
    assert_eq!(widths[0] + widths[1], 638.);
    assert!(widths[0] > 500., "{widths:?}");
    assert!(widths[1] < 80., "{widths:?}");
    assert_eq!(table_layout::natural_width(&table, 0, 640., 13., 21.), 638.);

    // column-widths.test.ts case 2: short table hugs its content instead of stretching.
    let short_src = "| 字段 | 值 |\n| --- | --- |\n| Title | puppyone |";
    let short_doc = crate::editor::text::buffer::Buffer::new(short_src);
    let short_table = table_block(&short_doc, &(0..short_doc.len())).unwrap();
    let short_widths = table_layout::column_widths(&short_table, 640., 13., 21.);
    assert_eq!(short_widths.len(), 2);
    assert!(
        short_widths[0] + short_widths[1] < 240.,
        "short table should hug content: {short_widths:?}"
    );
    let _ = size(0., 0.);
}
