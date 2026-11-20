//! The CSV table in a window (GPUI test platform): cell activation, typing,
//! Tab order, history through the model, structure rails, source mode and
//! sticky hit testing.
use super::{
    CsvEditor, CsvEvent, Hit, MenuEvent, expand::Expansion, handles::Axis, menu::MenuKind,
};
use crate::{
    editor::view::{bind_keys, style},
    typography::Scale,
};
use gpui::{
    AppContext as _, Entity, EntityInputHandler, TestAppContext, VisualTestContext, point, px, size,
};
use std::{cell::RefCell, rc::Rc};

fn setup<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
) -> (
    Entity<CsvEditor>,
    Rc<RefCell<usize>>,
    &'a mut VisualTestContext,
) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
        super::bind_keys(cx);
    });
    let text = text.to_owned();
    let (view, cx) = cx
        .add_window_view(move |_, cx| CsvEditor::new("", "t.csv", &text, true, Scale::Medium, cx));
    let changes = Rc::new(RefCell::new(0));
    let counter = changes.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event: &CsvEvent, _| {
            if *event == CsvEvent::Changed {
                *counter.borrow_mut() += 1;
            }
        })
        .detach();
    });
    cx.run_until_parked();
    (view, changes, cx)
}

fn active(view: &Entity<CsvEditor>, cx: &mut VisualTestContext) -> Option<(usize, usize, String)> {
    view.update(cx, |v, cx| {
        v.cell
            .as_ref()
            .map(|c| (c.row, c.column, c.editor.read(cx).text().to_owned()))
    })
}

fn text(view: &Entity<CsvEditor>, cx: &mut VisualTestContext) -> String {
    view.update(cx, |v, cx| v.text(cx))
}

#[gpui::test]
fn typing_replaces_the_selected_value_and_history_belongs_to_the_table(cx: &mut TestAppContext) {
    let (view, changes, cx) = setup(cx, "id,name\n1,alice\n");
    view.update_in(cx, |v, w, cx| v.activate(1, 1, None, w, cx));
    assert_eq!(active(&view, cx), Some((1, 1, "alice".into())));
    cx.simulate_input("bob");
    assert_eq!(text(&view, cx), "id,name\n1,bob\n");
    assert_eq!(*changes.borrow(), 3);
    // Edits stay in the cell session until committed (`CS-03`).
    view.update(cx, |v, _| assert_eq!(v.model.undo_len(), 0));
    // `Enter` commits the session as one table-level undo step and returns focus to the table.
    cx.simulate_keystrokes("enter");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), None);
    view.update_in(cx, |v, w, _| {
        assert_eq!(v.model.undo_len(), 1);
        assert!(v.focus.is_focused(w));
    });
    // ⌘Z on the table undoes the entire cell session in one step!
    cx.simulate_keystrokes("cmd-z");
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1,alice\n");
    cx.simulate_keystrokes("cmd-shift-z");
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1,bob\n");
    // ⌘Z inside an untouched active cell also delegates to the table history.
    view.update_in(cx, |v, w, cx| v.activate(1, 0, None, w, cx));
    cx.simulate_keystrokes("cmd-z");
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1,alice\n");
}

#[gpui::test]
fn tab_walks_cells_in_reading_order_and_stops_at_the_ends(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "a,b\nc,d\n");
    view.update_in(cx, |v, w, cx| v.activate(0, 1, None, w, cx));
    cx.simulate_keystrokes("tab");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), Some((1, 0, "c".into())));
    cx.simulate_keystrokes("tab tab");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), Some((1, 1, "d".into())));
    cx.simulate_keystrokes("shift-tab shift-tab shift-tab shift-tab");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), Some((0, 0, "a".into())));
    // Tab selects the whole value: typing replaces it.
    cx.simulate_input("z");
    assert_eq!(text(&view, cx), "z,b\nc,d\n");
}

#[gpui::test]
fn multiline_cells_preserve_newlines_support_alt_enter_and_render_badge(cx: &mut TestAppContext) {
    let original = "note,tag\n\"line1\nline2\",ok\n";
    let (view, changes, cx) = setup(cx, original);
    // Clicking into a multi-line cell and leaving without typing MUST NOT dirty or alter the model (`CS-06`)!
    view.update_in(cx, |v, w, cx| v.activate(1, 0, Some(2), w, cx));
    assert_eq!(active(&view, cx), Some((1, 0, "line1\nline2".into())));
    view.update_in(cx, |v, w, cx| v.activate(1, 1, None, w, cx));
    cx.run_until_parked();
    assert_eq!(*changes.borrow(), 0);
    view.update(cx, |v, _| assert_eq!(v.model.undo_len(), 0));
    assert_eq!(text(&view, cx), original);

    // Static grid draw renders first line plus the `↵` multi-line badge.
    view.update_in(cx, |v, w, _| {
        let mut out = Vec::new();
        v.draw_cell(1, 0, gpui::Rgba::default(), w, &mut out);
        let texts: Vec<&str> = out
            .iter()
            .filter_map(|d| match d {
                crate::editor::table::paint::Draw::Text { text, .. } => Some(text.as_ref()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, vec!["line1", "↵"]);
    });

    // `alt-enter` (`⌥Enter`) inserts `\n`, while plain `enter` commits the cell session.
    cx.simulate_input("first");
    cx.simulate_keystrokes("alt-enter");
    cx.simulate_input("second");
    assert_eq!(active(&view, cx), Some((1, 1, "first\nsecond".into())));
    cx.simulate_keystrokes("enter");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), None);
    assert_eq!(
        text(&view, cx),
        "note,tag\n\"line1\nline2\",\"first\nsecond\"\n"
    );
}

#[gpui::test]
fn rails_append_a_record_or_a_field_and_focus_its_first_cell(cx: &mut TestAppContext) {
    let (view, changes, cx) = setup(cx, "id,name\n1,a\n");
    view.update_in(cx, |v, w, cx| v.add_row(w, cx));
    assert_eq!(text(&view, cx), "id,name\n1,a\n,\n");
    assert_eq!(active(&view, cx).map(|(r, c, _)| (r, c)), Some((2, 0)));
    view.update_in(cx, |v, w, cx| v.add_column(w, cx));
    assert_eq!(text(&view, cx).lines().next(), Some("id,name,"));
    assert_eq!(*changes.borrow(), 2);
    view.update(cx, |v, _| assert_eq!(v.layout.widths.len(), 3));
}

#[gpui::test]
fn source_mode_edits_the_raw_text_and_returns_it_to_the_table(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "a,b\n");
    // The table viewer has no source view (`hideSourceView`): the command
    // does nothing until a host offers one.
    view.update_in(cx, |v, w, cx| v.toggle_mode(w, cx));
    view.update(cx, |v, _| assert!(v.live && v.source.is_none()));
    view.update(cx, |v, _| v.source_view = true);
    view.update_in(cx, |v, w, cx| v.toggle_mode(w, cx));
    cx.run_until_parked();
    view.update(cx, |v, _| assert!(!v.live && v.source.is_some()));
    cx.simulate_keystrokes("cmd-down");
    cx.simulate_input("c,d\n");
    assert_eq!(text(&view, cx), "a,b\nc,d\n");
    view.update_in(cx, |v, w, cx| v.toggle_mode(w, cx));
    view.update(cx, |v, _| {
        assert!(v.live);
        assert_eq!(v.model.rows().len(), 2);
    });
    assert_eq!(text(&view, cx), "a,b\nc,d\n");
}

#[gpui::test]
fn sticky_bands_take_the_pointer_first(cx: &mut TestAppContext) {
    let rows: String = (0..40).map(|i| format!("{i},v{i}\n")).collect();
    let (view, _, cx) = setup(cx, &format!("id,name\n{rows}"));
    view.update(cx, |v, _| {
        assert!(v.header);
        v.port.size = size(400., 300.);
        // Resting: the first body cell lies under its own box.
        let (x, y) = (v.column_x(0) + 5., v.row_y(1) + 5.);
        assert_eq!(v.hit(x, y), Some(Hit::Cell(1, 0)));
        assert_eq!(v.hit(v.index_x() + 3., y), Some(Hit::Index(1)));
        assert_eq!(v.hit(10., 10.), None);
        // Scrolled both ways: the header record and the gutter stick.
        v.port.scroll = point(120., 400.);
        let header_y = v.header_y();
        assert_eq!(header_y, 400.);
        assert_eq!(
            v.hit(v.column_x(1) + 5., header_y + 5.),
            Some(Hit::Cell(0, 1))
        );
        assert_eq!(v.hit(v.index_x() + 3., header_y + 5.), Some(Hit::Corner));
        assert_eq!(v.index_x(), 120.);
        assert!(v.inline_scrolled());
        let row = ((400. + 40. - v.row_y(0)) / v.theme.table.row_min_height).floor() as usize;
        assert_eq!(v.hit(v.index_x() + 3., 440.), Some(Hit::Index(row)));
    });
    let _ = px(0.);
}

#[gpui::test]
fn reveal_keeps_the_active_cell_clear_of_the_sticky_header(cx: &mut TestAppContext) {
    let rows: String = (0..40).map(|i| format!("{i},v{i}\n")).collect();
    let (view, _, cx) = setup(cx, &format!("id,name\n{rows}"));
    view.update(cx, |v, _| {
        v.port.size = size(400., 300.);
        v.reveal(30, 1);
        let bottom = v.row_y(30) + v.theme.table.row_min_height;
        assert_eq!(v.port.scroll.y, bottom - 300.);
        v.reveal(2, 0);
        // Above: the row lands just under the stuck header record.
        assert_eq!(v.port.scroll.y, v.row_y(2) - v.theme.table.row_min_height);
    });
}

#[gpui::test]
fn column_resize_clamps_cancels_and_auto_fits(cx: &mut TestAppContext) {
    let (view, changes, cx) = setup(cx, "id,name\n1,a much longer value than the column\n");
    view.update(cx, |v, cx| {
        let start = v.layout.widths[1];
        v.start_resize(1, 100., cx);
        v.drag_resize(130.4, cx);
        assert_eq!(v.layout.widths[1], start + 30.);
        v.drag_resize(5000., cx);
        assert_eq!(v.layout.widths[1], 560.);
        v.drag_resize(-5000., cx);
        assert_eq!(v.layout.widths[1], 96.);
        // Escape restores the starting width.
        v.end_resize(true, cx);
        assert_eq!(v.layout.widths[1], start);
        assert!(v.gestures.resizing.is_none());
        // Double-click: the content estimate without the initial 220px cap
        // (28 + 7 × 35 units).
        v.auto_fit(1, cx);
        assert_eq!(v.layout.widths[1], 273.);
    });
    // Column geometry is view state: the document did not change.
    assert_eq!(*changes.borrow(), 0);
}

#[gpui::test]
fn view_items_toggle_the_header_and_row_numbers_and_fit_columns(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "id,name\n1,alice\n");
    let ids = view.update(cx, |v, _| {
        v.view_items()
            .iter()
            .map(|i| (i.id, i.checked))
            .collect::<Vec<_>>()
    });
    assert_eq!(
        ids,
        vec![
            ("csv-header-row", Some(true)),
            ("csv-row-numbers", Some(true)),
            ("csv-fit-columns-to-viewport", None),
            ("csv-reset-column-widths", None)
        ]
    );
    view.update_in(cx, |v, w, cx| {
        v.activate(0, 1, None, w, cx);
        v.view_command("csv-header-row", w, cx);
        assert!(!v.header);
        // The first record is data now: its cell is re-opened in body style.
        let cell = v.cell.as_ref().unwrap();
        assert_eq!((cell.row, cell.column), (0, 1));
        assert_eq!(v.style(0).weight, v.theme.body.weight);
        v.view_command("csv-row-numbers", w, cx);
        assert_eq!(v.index_width(), 0.);
        v.port.size = size(600., 400.);
        v.view_command("csv-fit-columns-to-viewport", w, cx);
        // 600 − 32 − 32 − 18 = 518 across both columns.
        assert_eq!(v.layout.widths.iter().sum::<f32>(), 518.);
        v.view_command("csv-reset-column-widths", w, cx);
        assert_eq!(v.layout.widths, vec![96., 96.]);
    });
}

fn press_point(v: &CsvEditor, x: f32, y: f32) -> gpui::Point<gpui::Pixels> {
    point(px(x - v.port.scroll.x), px(y - v.port.scroll.y))
}

#[gpui::test]
fn the_context_menu_targets_cells_columns_and_rows(cx: &mut TestAppContext) {
    let (view, changes, cx) = setup(cx, "id,name\n1,a\n2,b\n");
    view.update_in(cx, |v, w, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);
        // A body cell: rows, columns and layout.
        let at = press_point(v, v.column_x(1) + 5., v.row_y(1) + 5.);
        v.context_menu(at, w, cx);
        let m = v.menu.as_ref().unwrap();
        assert_eq!((m.row, m.column), (1, 1));
        let sections = v.menu_sections(MenuKind::Cell, 1, 1);
        assert_eq!(
            sections.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![6, 5, 1]
        );
        // The first data row cannot move up past the header.
        assert!(sections[0][3].disabled && !sections[0][4].disabled);
        // The header record: column actions only.
        let at = press_point(v, v.column_x(0) + 5., v.row_y(0) + 5.);
        v.context_menu(at, w, cx);
        assert_eq!(v.menu.as_ref().map(|m| (m.row, m.column)), Some((0, 0)));
        assert_eq!(v.menu_sections(MenuKind::Column, 0, 0).len(), 2);
        // The header's record-number corner has no menu; data rows do.
        v.menu = None;
        let at = press_point(v, v.index_x() + 3., v.row_y(0) + 5.);
        v.context_menu(at, w, cx);
        assert!(v.menu.is_none());
        let at = press_point(v, v.index_x() + 3., v.row_y(2) + 5.);
        v.context_menu(at, w, cx);
        assert_eq!(v.menu.as_ref().map(|m| m.row), Some(2));
    });
    // Running an item applies it at the target and focuses the new cell.
    view.update_in(cx, |v, w, cx| {
        v.menu_event(MenuEvent::Run("insert-row-below"), w, cx);
        v.menu_event(
            MenuEvent::Dismiss {
                restore_focus: false,
            },
            w,
            cx,
        );
        assert!(v.menu.is_none());
        assert_eq!(v.cell.as_ref().map(|c| (c.row, c.column)), Some((3, 0)));
    });
    assert_eq!(text(&view, cx), "id,name\n1,a\n2,b\n,\n");
    // Reordering ends the edit session instead of focusing a cell.
    view.update_in(cx, |v, w, cx| {
        let at = press_point(v, v.column_x(0) + 5., v.row_y(1) + 5.);
        v.context_menu(at, w, cx);
        v.menu_event(MenuEvent::Run("move-row-down"), w, cx);
        assert!(v.cell.is_none());
    });
    assert_eq!(text(&view, cx), "id,name\n2,b\n1,a\n,\n");
    assert_eq!(*changes.borrow(), 2);
}

#[gpui::test]
fn grips_drag_rows_and_columns_and_leave_a_structural_selection(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "h1,h2,h3\na,b,c\nd,e,f\ng,h,i\n");
    view.update_in(cx, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);
        // Hovering a body cell shows both grips.
        v.pointer_moved(press_point(v, v.column_x(1) + 5., v.row_y(1) + 5.), cx);
        assert_eq!(
            (v.column_grip_shown(), v.row_grip_shown()),
            (Some(1), Some(1))
        );
        // Header cells have no row grip; record numbers have no column grip.
        v.pointer_moved(press_point(v, v.column_x(0) + 5., v.row_y(0) + 5.), cx);
        assert_eq!((v.column_grip_shown(), v.row_grip_shown()), (Some(0), None));
        v.pointer_moved(press_point(v, v.index_x() + 3., v.row_y(2) + 5.), cx);
        assert_eq!((v.column_grip_shown(), v.row_grip_shown()), (None, Some(2)));
        // Drag record "a,b,c" (row 1) below "g,h,i": within slop nothing moves.
        let start = press_point(v, v.index_x() - 2., v.row_y(1) + 15.);
        v.pointer_moved(press_point(v, v.index_x() + 3., v.row_y(1) + 5.), cx);
        v.start_structure_drag(Axis::Row, start, w, cx);
        v.drag_structure(point(start.x + px(3.), start.y + px(3.)), cx);
        assert!(!v.gestures.drag.unwrap().moved);
        v.drag_structure(press_point(v, v.index_x(), v.row_y(3) + 20.), cx);
        let drag = v.gestures.drag.unwrap();
        assert!(drag.moved && drag.boundary == Some(3));
        assert_eq!(drag.target(&super::handles::CsvTracks(v)), Some(3));
        assert!(v.drop_indicator().is_some());
        // The drag source is outlined; the rails hide.
        assert_eq!(v.structure_outline(), Some((Axis::Row, 1)));
        v.end_structure_drag(false, w, cx);
        assert_eq!(v.gestures.structural, Some((Axis::Row, 3)));
    });
    assert_eq!(text(&view, cx), "h1,h2,h3\nd,e,f\ng,h,i\na,b,c\n");
    view.update_in(cx, |v, w, cx| {
        // Dropping onto its own boundary does nothing.
        v.pointer_moved(press_point(v, v.column_x(2) + 5., v.row_y(2) + 5.), cx);
        let start = press_point(v, v.column_x(2) + 40., v.row_y(0) - 2.);
        v.start_structure_drag(Axis::Column, start, w, cx);
        v.drag_structure(press_point(v, v.column_x(2) + 60., v.row_y(0)), cx);
        assert_eq!(
            v.gestures
                .drag
                .unwrap()
                .target(&super::handles::CsvTracks(v)),
            None
        );
        assert!(v.drop_indicator().is_none());
        // Column 2 to the front.
        v.drag_structure(press_point(v, v.column_x(0) + 3., v.row_y(0)), cx);
        v.end_structure_drag(false, w, cx);
        assert_eq!(v.gestures.structural, Some((Axis::Column, 0)));
        // Pressing a cell clears the selection.
        v.press(
            press_point(v, v.column_x(1) + 5., v.row_y(1) + 5.),
            gpui::Modifiers::default(),
            w,
            cx,
        );
        assert_eq!(v.gestures.structural, None);
    });
    assert_eq!(text(&view, cx), "h3,h1,h2\nf,d,e\ni,g,h\nc,a,b\n");
}

#[gpui::test]
fn a_grip_click_opens_its_axis_menu_and_escape_cancels_a_drag(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "h1,h2\na,b\nc,d\n");
    view.update_in(cx, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);
        v.pointer_moved(press_point(v, v.column_x(1) + 5., v.row_y(2) + 5.), cx);
        let start = press_point(v, v.column_x(1) + 40., v.row_y(0));
        v.start_structure_drag(Axis::Column, start, w, cx);
        v.end_structure_drag(false, w, cx);
        let menu = v.menu.as_ref().unwrap();
        assert_eq!(
            (menu.row, menu.column, menu.source),
            (2, 1, Some((Axis::Column, 1)))
        );
        assert_eq!(v.structure_outline(), Some((Axis::Column, 1)));
        // The menu holds the grips while the pointer wanders.
        v.pointer_moved(press_point(v, v.column_x(0) + 5., v.row_y(1) + 5.), cx);
        assert_eq!(v.column_grip_shown(), Some(1));
        v.close_menu(false, w, cx);
        assert_eq!(v.structure_outline(), None);
        // Escape (lost capture) drops a drag without moving anything.
        v.pointer_moved(press_point(v, v.index_x() + 3., v.row_y(1) + 5.), cx);
        v.start_structure_drag(Axis::Row, start, w, cx);
        v.drag_structure(press_point(v, v.index_x(), v.row_y(2) + 25.), cx);
        v.end_structure_drag(true, w, cx);
        assert!(v.gestures.drag.is_none() && v.gestures.structural.is_none());
    });
    assert_eq!(text(&view, cx), "h1,h2\na,b\nc,d\n");
}

#[gpui::test]
fn grips_dock_inside_the_stuck_header_and_gutter(cx: &mut TestAppContext) {
    let rows: String = (0..40).map(|i| format!("{i},v{i}\n")).collect();
    let (view, _, cx) = setup(cx, &format!("id,name\n{rows}"));
    view.update(cx, |v, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(300., 300.);
        v.pointer_moved(press_point(v, v.column_x(1) + 5., v.row_y(3) + 5.), cx);
        // At rest the grips straddle the outer edges.
        assert!(!v.column_grip(1).1 && !v.row_grip(3).1);
        assert_eq!(v.grip_covered_header(), None);
        // Scrolled: the header record and the gutter stick, the grips dock and
        // cover the header text / record number.
        v.port.scroll = point(40., 200.);
        v.pointer_moved(press_point(v, v.column_x(1) + 5., v.row_y(9) + 5.), cx);
        let (bounds, docked) = v.column_grip(1);
        assert!(docked);
        assert_eq!(bounds.origin.y, v.header_y() + 4.);
        assert_eq!(v.grip_covered_header(), Some(1));
        let (bounds, docked) = v.row_grip(9);
        assert!(docked);
        assert_eq!(bounds.origin.x, v.index_x() + 4.);
        assert_eq!(v.grip_covered_index(), Some(9));
    });
}

#[gpui::test]
fn dragging_the_corner_previews_and_grows_the_table(cx: &mut TestAppContext) {
    let (view, changes, cx) = setup(cx, "h1,h2\na,b\n");
    view.update_in(cx, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 400.);
        let (tw, th) = v.table_size();
        let corner = press_point(v, 32. + tw + 9., 32. + th + 9.);
        v.start_expand(corner, w, cx);
        // Under the activation distance nothing previews.
        v.drag_expand(point(corner.x + px(5.), corner.y), cx);
        assert_eq!(v.preview(), Expansion::default());
        // 2 rows (≥ 1.5 × 31) and 1 column (≥ 0.5 × 96).
        v.drag_expand(point(corner.x + px(60.), corner.y + px(50.)), cx);
        assert_eq!(
            v.preview(),
            Expansion {
                rows: 2,
                columns: 1
            }
        );
        assert_eq!(v.table_size(), (tw + 96., th + 62.));
        assert_eq!((v.total_rows(), v.total_columns()), (4, 3));
        // The real last row / column gain their borders; the preview cells close the table.
        assert_eq!((v.cell_bottom_border(1), v.cell_end_border(1)), (1., 1.));
        assert!(v.expand_status().is_some());
        v.end_expand(false, w, cx);
        assert_eq!(v.preview(), Expansion::default());
    });
    assert_eq!(text(&view, cx), "h1,h2,\na,b,\n,,\n,,\n");
    assert_eq!(*changes.borrow(), 1);
}

#[gpui::test]
fn clicking_the_corner_opens_the_size_picker(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "h1,h2\na,b\n");
    view.update_in(cx, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 400.);
        let corner = point(px(700.), px(150.));
        v.start_expand(corner, w, cx);
        v.end_expand(false, w, cx);
        assert_eq!(
            v.expansion.picker.as_ref().map(|p| p.selection),
            Some(Expansion {
                rows: 1,
                columns: 1
            })
        );
        // A cancelled drag restores the scroll and adds nothing.
        v.start_expand(corner, w, cx);
        assert!(v.expansion.picker.is_none());
        v.drag_expand(point(corner.x + px(200.), corner.y + px(100.)), cx);
        v.end_expand(true, w, cx);
        assert_eq!(v.rows(), 2);
        v.start_expand(corner, w, cx);
        v.end_expand(false, w, cx);
        let focus = v.expansion.picker.as_ref().unwrap().focus.clone();
        focus.focus(w, cx);
    });
    cx.simulate_keystrokes("down down right left left right enter");
    view.update(cx, |v, _| assert!(v.expansion.picker.is_none()));
    // 1 data row + 3 rows, 2 + 2 columns.
    assert_eq!(text(&view, cx), "h1,h2,,\na,b,,\n,,,\n,,,\n,,,\n");
}

#[gpui::test]
fn reference_cells_show_labels_and_open_from_their_label(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(
        cx,
        "name,link\ndocs,[Docs](https://example.com/docs)\nnote,[[Roadmap]]\nplain,see https://x.y\n",
    );
    view.update_in(cx, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);
        let mut out = Vec::new();
        assert!(v.draw_reference(1, 1, &mut out));
        assert!(matches!(&out[0], crate::editor::table::paint::Draw::Text { text, underline: Some(_), ellipsis: true, .. } if text.as_ref() == "Docs"));
        // Workspace links without a host resolver are missing, keep their
        // label and reserve room for the action in the editor.
        assert!(v.draw_reference(2, 1, &mut out));
        assert_eq!(v.end_padding(2, 1), 29.);
        assert!(!v.draw_reference(3, 1, &mut out));
        assert_eq!(v.end_padding(3, 1), 10.);
        // A press on the external label opens it instead of editing; beside
        // it, the cell is edited.
        let on_label = press_point(v, v.column_x(1) + 12., v.row_y(1) + 10.);
        v.press(on_label, gpui::Modifiers::default(), w, cx);
        assert!(v.cell.is_none());
        let beside = press_point(v, v.column_x(1) + 90., v.row_y(1) + 10.);
        v.press(beside, gpui::Modifiers::default(), w, cx);
        assert_eq!(v.cell.as_ref().map(|c| (c.row, c.column)), Some((1, 1)));
        // While editing, the raw value shows (no label is drawn for it).
        let mut out = Vec::new();
        v.draw_cell(1, 1, gpui::Rgba::default(), w, &mut out);
        assert_eq!(out.len(), 1);
    });
    // The host resolver turns the wiki link into an openable reference.
    let opened = Rc::new(RefCell::new(Vec::new()));
    let sink = opened.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event: &CsvEvent, _| {
            if let CsvEvent::OpenReference(paths) = event {
                sink.borrow_mut().push(paths.clone());
            }
        })
        .detach();
    });
    view.update_in(cx, |v, w, cx| {
        let resolver: super::references::Resolver = Rc::new(|target: &str| {
            (target == "Roadmap").then(|| crate::editor::navigation::Resolution {
                exists: true,
                ambiguous: false,
                path: Some("plans/Roadmap.md".into()),
                candidates: vec![],
            })
        });
        v.set_reference_resolver(Some(resolver), cx);
        let at = press_point(v, v.column_x(1) + 12., v.row_y(2) + 10.);
        let command = gpui::Modifiers {
            platform: true,
            ..Default::default()
        };
        v.press(at, command, w, cx);
    });
    assert_eq!(*opened.borrow(), vec![vec!["plans/Roadmap.md".to_string()]]);
}

#[gpui::test]
fn find_walks_matching_cells_and_follows_edits(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "name,city\nAnna,Oslo\nBo,Lisbon\nanne,Bonn\n");
    view.update_in(cx, |v, w, cx| {
        v.port.size = size(800., 600.);
        let r = v.find_query("AN", cx);
        assert_eq!((r.current, r.total), (1, 2));
        assert_eq!(v.find.matches, vec![(1, 0), (3, 0)]);
        assert_eq!(v.find_move(true, cx).current, 2);
        assert_eq!(v.find_move(true, cx).current, 1);
        assert_eq!(v.find_move(false, cx).current, 2);
        let mut out = Vec::new();
        v.draw_find(3, 0, &mut out);
        v.draw_find(1, 1, &mut out);
        // Current match: its 2px ring and tint; non-matches draw nothing.
        assert_eq!(out.len(), 2);
        // Editing the current match into a non-match keeps a valid current.
        v.find_focus_editor(w, cx);
        assert_eq!(v.cell.as_ref().map(|c| (c.row, c.column)), Some((3, 0)));
    });
    cx.simulate_input("Zed");
    view.update(cx, |v, cx| {
        assert_eq!(v.find.matches, vec![(1, 0)]);
        assert_eq!(v.find.current, Some(0));
        v.find_clear(cx);
        assert!(v.find.matches.is_empty());
    });
}

#[gpui::test]
fn an_ime_composition_in_a_cell_reaches_the_model_once(cx: &mut TestAppContext) {
    let (view, changes, cx) = setup(cx, "id,name\n1,alice\n");
    view.update_in(cx, |v, w, cx| v.activate(1, 1, Some(5), w, cx));
    let cell = view.update(cx, |v, _| v.cell.as_ref().unwrap().editor.clone());
    for preedit in ["n", "ni", "nihao"] {
        let end = preedit.len();
        cell.update_in(cx, |e, w, cx| {
            e.replace_and_mark_text_in_range(None, preedit, Some(end..end), w, cx)
        });
        cx.run_until_parked();
        // Provisional text stays in the cell editor.
        assert_eq!(text(&view, cx), "id,name\n1,alice\n");
        assert_eq!(active(&view, cx), Some((1, 1, format!("alice{preedit}"))));
    }
    assert!(view.update(cx, |v, cx| v.composing(cx)));
    assert_eq!(*changes.borrow(), 0);
    cell.update_in(cx, |e, w, cx| e.replace_text_in_range(None, "你好", w, cx));
    cx.run_until_parked();
    assert_eq!(
        (text(&view, cx).as_str(), *changes.borrow()),
        ("id,name\n1,alice你好\n", 1)
    );
    // One table history step for the whole composition.
    cx.simulate_keystrokes("cmd-z");
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1,alice\n");
    assert_eq!(active(&view, cx), Some((1, 1, "alice".into())));
}

fn compose_in_cell(view: &Entity<CsvEditor>, cx: &mut VisualTestContext, preedit: &str) {
    let cell = view.update(cx, |v, _| v.cell.as_ref().unwrap().editor.clone());
    let end = preedit.encode_utf16().count();
    cell.update_in(cx, |e, w, cx| {
        e.replace_and_mark_text_in_range(None, preedit, Some(end..end), w, cx)
    });
    cx.run_until_parked();
}

#[gpui::test]
fn leaving_a_cell_mid_composition_keeps_the_typed_text(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "id,name\n1,alice\n");
    // A click on another cell.
    view.update_in(cx, |v, w, cx| v.activate(1, 1, Some(5), w, cx));
    compose_in_cell(&view, cx, "ni");
    view.update_in(cx, |v, w, cx| v.activate(1, 0, None, w, cx));
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1,aliceni\n");
    assert!(!view.update(cx, |v, cx| v.composing(cx)));
    // Tab handed back by the input method: commit, then move on.
    view.update_in(cx, |v, w, cx| v.activate(1, 0, Some(1), w, cx));
    compose_in_cell(&view, cx, "ka");
    cx.simulate_keystrokes("tab");
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1ka,aliceni\n");
    assert_eq!(active(&view, cx).map(|(r, c, _)| (r, c)), Some((1, 1)));
}

#[gpui::test]
fn a_structure_change_keeps_pending_input_in_its_own_cell(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "a,b\n1,2\n3,4\n");
    view.update_in(cx, |v, w, cx| v.activate(1, 0, Some(1), w, cx));
    compose_in_cell(&view, cx, "ni");
    // A new record above the edited one: the committed value moves down with
    // its record; the new record stays empty.
    view.update_in(cx, |v, w, cx| {
        v.apply_operation(super::Operation::InsertRowAbove, 1, 0, w, cx)
    });
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "a,b\n,\n1ni,2\n3,4\n");
    assert_eq!(active(&view, cx), Some((1, 0, String::new())));
    // Typing (no composition) then the same operation.
    cx.simulate_input("x");
    view.update_in(cx, |v, w, cx| {
        v.apply_operation(super::Operation::InsertRowAbove, 1, 0, w, cx)
    });
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "a,b\n,\nx,\n1ni,2\n3,4\n");
}

#[gpui::test]
fn cell_session_undo_granularity_across_enter_tab_click_and_blur(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "h1,h2\na,b\nc,d\n");

    // 1. Multi-step edits inside one cell session use EditorView's local history, then commit as 1 step on Tab.
    view.update_in(cx, |v, w, cx| v.activate(1, 0, None, w, cx));
    cx.simulate_input("hello");
    // Paste creates a separate local step in EditorView history.
    view.update(cx, |v, cx| {
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(" world".into()));
        let editor = v.cell.as_ref().unwrap().editor.clone();
        editor.update(cx, |e, cx| {
            e.insert(" world", crate::editor::text::state::UserEvent::Paste, cx)
        });
    });
    assert_eq!(active(&view, cx), Some((1, 0, "hello world".into())));
    view.update(cx, |v, _| assert_eq!(v.model.undo_len(), 0));
    // Local ⌘Z undoes only the paste inside the cell!
    cx.simulate_keystrokes("cmd-z");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), Some((1, 0, "hello".into())));
    cx.simulate_keystrokes("cmd-shift-z");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), Some((1, 0, "hello world".into())));
    // Tab commits 1 table-level undo step and moves to (1, 1).
    cx.simulate_keystrokes("tab");
    cx.run_until_parked();
    view.update(cx, |v, _| assert_eq!(v.model.undo_len(), 1));

    // 2. Typing in (1, 1) and pressing Enter commits 1 table-level undo step.
    cx.simulate_input("there");
    cx.simulate_keystrokes("enter");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), None);
    view.update(cx, |v, _| assert_eq!(v.model.undo_len(), 2));

    // 3. Typing in (2, 0) and clicking another cell commits 1 table-level undo step.
    view.update_in(cx, |v, w, cx| v.activate(2, 0, None, w, cx));
    cx.simulate_input("clicked");
    view.update_in(cx, |v, w, cx| v.activate(2, 1, None, w, cx));
    cx.run_until_parked();
    view.update(cx, |v, _| assert_eq!(v.model.undo_len(), 3));

    // 4. Typing in (2, 1) and blurring focus commits 1 table-level undo step.
    // GPUI dispatches focus/blur listeners on the active window.
    cx.update(|w, _| w.activate_window());
    cx.run_until_parked();
    cx.simulate_input("blurred");
    cx.update(|w, cx| w.blur(cx));
    cx.run_until_parked();
    view.update(cx, |v, _| assert_eq!(v.model.undo_len(), 4));

    // Stepping ⌘Z four times undoes each session as a whole!
    view.update_in(cx, |v, w, cx| v.undo(false, w, cx));
    assert_eq!(text(&view, cx), "h1,h2\nhello world,there\nclicked,d\n");
    view.update_in(cx, |v, w, cx| v.undo(false, w, cx));
    assert_eq!(text(&view, cx), "h1,h2\nhello world,there\nc,d\n");
    view.update_in(cx, |v, w, cx| v.undo(false, w, cx));
    assert_eq!(text(&view, cx), "h1,h2\nhello world,b\nc,d\n");
    view.update_in(cx, |v, w, cx| v.undo(false, w, cx));
    assert_eq!(text(&view, cx), "h1,h2\na,b\nc,d\n");
}

#[gpui::test]
fn unclosed_quote_locks_grid_highlights_offending_row_and_repairs_in_source(
    cx: &mut TestAppContext,
) {
    let broken = "id,name\n1,\"alice\n2,bob\n";
    let (view, _, cx) = setup(cx, broken);
    view.update_in(cx, |v, w, cx| {
        assert_eq!(v.has_unclosed_quote(), Some(1));
        assert!(v.grid_read_only());
        assert!(v.notice_banner(cx).is_some());
        // Offending row 1 paints warning highlight layers.
        let mut normal_draws = Vec::new();
        v.draw_cell(0, 0, gpui::Rgba::default(), w, &mut normal_draws);
        let mut offending_draws = Vec::new();
        v.draw_cell(1, 0, gpui::Rgba::default(), w, &mut offending_draws);
        assert!(offending_draws.len() > normal_draws.len());
        v.activate(0, 0, None, w, cx);
    });
    // Grid is read-only: typing does not alter or auto-close quotes!
    cx.simulate_input("blocked");
    assert_eq!(text(&view, cx), broken);

    // Switch to Source mode (as the banner button does) and repair the quote.
    view.update_in(cx, |v, w, cx| v.set_live(false, w, cx));
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        let src = v.source_editor_entity().unwrap();
        src.update(cx, |e, cx| e.sync_text("id,name\n1,\"alice\"\n2,bob\n", cx));
    });
    view.update_in(cx, |v, w, cx| v.set_live(true, w, cx));
    view.update(cx, |v, _| {
        assert_eq!(v.has_unclosed_quote(), None);
        assert!(!v.grid_read_only());
        assert_eq!(v.rows(), 3);
    });
    assert_eq!(text(&view, cx), "id,name\n1,\"alice\"\n2,bob\n");
}

#[gpui::test]
fn source_return_and_external_reload_diff_preserve_ids_widths_selection_and_undo(
    cx: &mut TestAppContext,
) {
    let (view, _, cx) = setup(cx, "id,name\n1,alice\n2,bob\n");
    let (col_ids, row2_id) = view.update_in(cx, |v, w, cx| {
        v.source_view = true;
        v.layout.set_width(1, 240.);
        v.gestures.structural = Some((Axis::Row, 2));
        let cols = v.model.content().columns.clone();
        let r2 = v.model.rows()[2].id;
        v.activate(1, 1, None, w, cx);
        (cols, r2)
    });
    cx.simulate_input("alicia");
    cx.simulate_keystrokes("enter");
    cx.run_until_parked();

    // Edit in Source mode and return to live table (`CS-10`).
    view.update_in(cx, |v, w, cx| v.toggle_mode(w, cx));
    view.update(cx, |v, cx| {
        let src = v.source_editor_entity().unwrap();
        src.update(cx, |e, cx| {
            e.sync_text("id,name\n1,alicia\n9,inserted\n2,bob\n", cx)
        });
    });
    view.update_in(cx, |v, w, cx| v.toggle_mode(w, cx));
    view.update(cx, |v, _| {
        assert_eq!(v.model.content().columns, col_ids);
        assert_eq!(v.layout.widths[1], 240., "custom column width preserved");
        assert_eq!(v.model.rows()[3].id, row2_id, "unchanged row ID preserved");
        assert_eq!(
            v.gestures.structural,
            Some((Axis::Row, 3)),
            "structural selection followed moved row ID"
        );
        assert_eq!(v.model.undo_len(), 2);
    });

    // External reload mid-edit when target row is deleted keeps uncommitted text (`DP-04`).
    view.update_in(cx, |v, w, cx| v.activate(2, 1, None, w, cx));
    cx.simulate_input("unsaved_draft");
    view.update(cx, |v, cx| v.replace_text("id,name\n1,alicia\n2,bob\n", cx));
    assert!(text(&view, cx).contains("unsaved_draft"));
    view.update_in(cx, |v, w, cx| v.undo(false, w, cx));
    view.update_in(cx, |v, w, cx| v.undo(false, w, cx));
    assert_eq!(text(&view, cx), "id,name\n1,alicia\n9,inserted\n2,bob\n");
}

#[gpui::test]
fn transient_gestures_cancel_header_clears_row0_selection_and_scroll_clamps(
    cx: &mut TestAppContext,
) {
    let rows: String = (0..30).map(|i| format!("{i},val{i}\n")).collect();
    let (view, _, cx) = setup(cx, &format!("id,name\n{rows}"));
    view.update_in(cx, |v, w, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(300., 200.);
        v.port.scroll = point(50., 500.);
        let start_w = v.layout.widths[0];
        v.start_resize(0, 100., cx);
        v.drag_resize(180., cx);
        let at = press_point(v, v.column_x(0) + 5., v.row_y(1) + 5.);
        v.context_menu(at, w, cx);
        v.start_expand(point(px(200.), px(150.)), w, cx);
        assert!(v.menu.is_some() || v.expansion.drag.is_some());

        // `replace_text` cancels transient gestures, restores resize width and clamps scroll!
        v.replace_text("id,name\n1,short\n", cx);
        assert!(v.menu.is_none());
        assert!(v.gestures.resizing.is_none());
        assert!(v.expansion.drag.is_none());
        assert!(v.expansion.picker.is_none());
        assert_eq!(v.layout.widths[0], start_w);
        let max_x = (v.content_size().0 - 300.).max(0.);
        assert_eq!(v.port.scroll, point(max_x, 0.));
        // Widening viewport clamps remaining horizontal scroll to 0.
        v.port.size = size(400., 200.);
        v.clamp_scroll();
        assert_eq!(v.port.scroll, point(0., 0.));

        // `set_appearance` and `set_live` also cancel transient gestures (`CS-11`).
        v.start_resize(0, 100., cx);
        v.drag_resize(160., cx);
        v.set_appearance(false, Scale::Medium, cx);
        assert!(v.gestures.resizing.is_none());
        assert_eq!(v.layout.widths[0], start_w);

        // `set_header(true)` clears structural selection on row 0 (`TODO-93`).
        v.set_header(false, w, cx);
        v.gestures.structural = Some((Axis::Row, 0));
        v.set_header(true, w, cx);
        assert_eq!(v.gestures.structural, None);
    });
}

#[gpui::test]
fn large_table_find_scans_in_background_cancels_stale_queries_and_routes_source_find(
    cx: &mut TestAppContext,
) {
    // 2,600 × 20 = 52,000 cells (> 50,000 threshold for background scan, `CS-12`).
    let mut csv = String::with_capacity(600_000);
    for r in 0..2_600 {
        for c in 0..20 {
            if c > 0 {
                csv.push(',');
            }
            if r == 2_500 && c == 15 {
                csv.push_str("needle_final");
            } else if r == 100 && c == 3 {
                csv.push_str("needle_stale");
            } else {
                csv.push_str("cell");
            }
        }
        csv.push('\n');
    }
    let (view, _, cx) = setup(cx, &csv);
    view.update(cx, |v, cx| {
        let _ = v.find_query("needle_stale", cx);
        assert!(v.find.task.is_some(), "initial scan spawned in background");
        // Immediately supersede with a new query before background task settles!
        let _ = v.find_query("needle_final", cx);
    });
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        assert_eq!(v.find.matches, vec![(2_500, 15)]);
        assert_eq!(v.find.index.len(), 1);
        // Incremental cell update adds a second match in O(1) without background rescan.
        v.find_cell_changed(10, 2, "another needle_final here", cx);
        assert!(v.find.task.is_none());
        assert_eq!(v.find.matches, vec![(10, 2), (2_500, 15)]);
    });

    // Source mode find routing in `CsvSurface` (`src/editor/viewers/csv.rs`, `CS-12`).
    let surface = crate::editor::viewers::csv::CsvSurface {
        editor: view.clone(),
    };
    view.update_in(cx, |v, w, cx| {
        v.source_view = true;
        v.set_live(false, w, cx);
    });
    let res = cx.update(|w, cx| {
        use crate::editor::registry::ViewerSurface;
        surface.find(
            crate::editor::workbench::find::FindEvent::Query("needle_stale".into()),
            w,
            cx,
        )
    });
    assert_eq!(res, Some((1, 1)));
}

#[gpui::test]
fn large_csv_parses_in_background_while_showing_readonly_preview_and_respects_replace_text(
    cx: &mut TestAppContext,
) {
    // > 256 KiB CSV (~320 KiB, 6,000 rows).
    let mut big = String::from("id,title,notes\n");
    for i in 0..6_000 {
        big.push_str(&format!(
            "{i},item_{i},some_longer_description_payload_for_row_{i:05}\n"
        ));
    }
    assert!(big.len() > super::BACKGROUND_PARSE_BYTES);
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
        super::bind_keys(cx);
    });
    let full_copy = big.clone();
    let view = cx.update(|cx| {
        cx.new(|cx| CsvEditor::new("", "big.csv", &full_copy, true, Scale::Medium, cx))
    });
    // Immediately after construction (before background executor parks):
    view.read_with(cx, |v, cx| {
        assert!(v.is_loading());
        assert!(v.grid_read_only());
        assert_eq!(
            v.rows(),
            100,
            "first screen (~100 lines) shown synchronously"
        );
        assert_eq!(v.text(cx).len(), big.len(), "snapshot keeps full file text");
    });
    cx.executor().run_until_parked();
    view.read_with(cx, |v, _| {
        assert!(!v.is_loading());
        assert!(!v.grid_read_only());
        assert_eq!(v.rows(), 6_001);
    });

    // If `replace_text` arrives while loading, stale background parse is discarded!
    let big2 = big.clone();
    let view2 =
        cx.update(|cx| cx.new(|cx| CsvEditor::new("", "big2.csv", &big2, true, Scale::Medium, cx)));
    view2.update(cx, |v, cx| {
        assert!(v.is_loading());
        v.replace_text("id,title\n1,fresh\n", cx);
        assert!(!v.is_loading());
    });
    cx.executor().run_until_parked();
    view2.read_with(cx, |v, cx| {
        assert_eq!(v.text(cx), "id,title\n1,fresh\n");
    });
}

#[gpui::test]
fn escape_exits_cell_to_table_and_focusable_grips_open_menu_from_keyboard(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "h1,h2\na,b\nc,d\n");
    view.update_in(cx, |v, w, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);
        v.activate(1, 0, None, w, cx);
    });
    cx.simulate_input("edited");
    cx.simulate_keystrokes("escape");
    cx.run_until_parked();
    assert_eq!(active(&view, cx), None);
    assert_eq!(text(&view, cx), "h1,h2\nedited,b\nc,d\n");
    view.update_in(cx, |v, w, _| assert!(v.focus.is_focused(w)));

    // Focus column grip and press Enter -> opens Column menu (`CS-14`).
    view.update_in(cx, |v, w, cx| v.focus_grip(Axis::Column, 1, w, cx));
    cx.run_until_parked();
    cx.simulate_keystrokes("enter");
    cx.run_until_parked();
    view.update_in(cx, |v, w, cx| {
        assert_eq!(
            v.menu.as_ref().and_then(|m| m.source),
            Some((Axis::Column, 1))
        );
        v.close_menu(false, w, cx);
        v.focus_grip(Axis::Row, 2, w, cx);
    });
    cx.run_until_parked();
    cx.simulate_keystrokes("space");
    cx.run_until_parked();
    view.update(cx, |v, _| {
        assert_eq!(v.menu.as_ref().and_then(|m| m.source), Some((Axis::Row, 2)));
    });
}

fn setup_doc<'a>(
    cx: &'a mut TestAppContext,
    doc_id: &str,
    text: &str,
) -> (
    Entity<CsvEditor>,
    Rc<RefCell<usize>>,
    &'a mut VisualTestContext,
) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
        super::bind_keys(cx);
    });
    let doc_id = doc_id.to_owned();
    let text = text.to_owned();
    let (view, cx) = cx.add_window_view(move |_, cx| {
        CsvEditor::new(&doc_id, "t.csv", &text, true, Scale::Medium, cx)
    });
    let changes = Rc::new(RefCell::new(0));
    let counter = changes.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event: &CsvEvent, _| {
            if *event == CsvEvent::Changed {
                *counter.borrow_mut() += 1;
            }
        })
        .detach();
    });
    cx.update(|w, cx| {
        w.activate_window();
        w.draw(cx).clear(cx);
    });
    cx.run_until_parked();
    (view, changes, cx)
}

#[gpui::test]
fn csv_column_width_persists_across_remount_without_changing_content(cx: &mut TestAppContext) {
    let source = "Name,Score\nAda,1\nLin,2\n";
    let doc_id = "csv-parity-persist-width";
    let (view, changes, visual) = setup_doc(cx, doc_id, source);
    let expected_width = view.update(visual, |v, cx| {
        let start = v.layout.widths[0];
        v.start_resize(0, 100., cx);
        v.drag_resize(240., cx);
        v.end_resize(false, cx);
        assert_eq!(v.layout.widths[0], start + 140.);
        v.layout.widths[0]
    });
    assert_eq!(*changes.borrow(), 0);
    assert_eq!(text(&view, visual), source);

    let (remounted, _, visual2) = setup_doc(cx, doc_id, source);
    remounted.read_with(visual2, |v, _| {
        assert_eq!(v.layout.widths[0], expected_width);
    });
}

#[gpui::test]
fn csv_drag_and_resize_cancel_on_escape_and_window_blur(cx: &mut TestAppContext) {
    let source = "h1,h2,h3\na,b,c\nd,e,f\n";
    let (view, changes, visual) = setup_doc(cx, "csv-parity-cancel", source);
    view.update_in(visual, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);
        v.focus.focus(w, cx);
    });

    // Escape cancels active column drag without changing CSV or opening a menu.
    view.update_in(visual, |v, w, cx| {
        v.pointer_moved(press_point(v, v.column_x(0) + 5., v.row_y(1) + 5.), cx);
        let start = press_point(v, v.column_x(0) + 20., v.row_y(0));
        v.start_structure_drag(Axis::Column, start, w, cx);
        v.drag_structure(press_point(v, v.column_x(2) + 20., v.row_y(0)), cx);
        assert!(v.gestures.drag.unwrap().moved);
    });
    visual.simulate_keystrokes("escape");
    visual.run_until_parked();
    view.read_with(visual, |v, _| {
        assert!(v.gestures.drag.is_none());
        assert!(v.menu.is_none());
        assert_eq!(v.structure_outline(), None);
    });
    assert_eq!(text(&view, visual), source);
    assert_eq!(*changes.borrow(), 0);

    // Window blur cancels active drag and resize without editing or opening a menu.
    view.update_in(visual, |v, w, cx| {
        let start_w = v.layout.widths[1];
        v.start_resize(1, 100., cx);
        v.drag_resize(190., cx);
        assert_eq!(v.layout.widths[1], start_w + 90.);
        v.cancel_transient_gestures();
        assert!(v.gestures.resizing.is_none());
        assert_eq!(v.layout.widths[1], start_w);

        v.pointer_moved(press_point(v, v.index_x() + 3., v.row_y(1) + 5.), cx);
        let start = press_point(v, v.index_x(), v.row_y(1) + 12.);
        v.start_structure_drag(Axis::Row, start, w, cx);
        v.drag_structure(press_point(v, v.index_x(), v.row_y(2) + 20.), cx);
        assert!(v.gestures.drag.is_some());
        v.cancel_transient_gestures();
        assert!(v.gestures.drag.is_none());
        assert!(v.menu.is_none());
        assert_eq!(v.structure_outline(), None);
    });
    assert_eq!(text(&view, visual), source);
    assert_eq!(*changes.borrow(), 0);

    // Clicking the row hover handle opens a row-scoped menu with row outline.
    view.update_in(visual, |v, w, cx| {
        v.pointer_moved(press_point(v, v.index_x() + 3., v.row_y(1) + 5.), cx);
        let start = press_point(v, v.index_x(), v.row_y(1) + 12.);
        v.start_structure_drag(Axis::Row, start, w, cx);
        v.end_structure_drag(false, w, cx);
        let menu = v.menu.as_ref().expect("row grip click opens menu");
        assert_eq!(menu.source, Some((Axis::Row, 1)));
        assert_eq!(v.structure_outline(), Some((Axis::Row, 1)));
        assert_eq!(v.menu_sections(MenuKind::Row, 1, 0).len(), 1);
    });
}

#[gpui::test]
fn csv_menu_moves_keep_structural_selection_and_clear_on_escape_or_cell_click(
    cx: &mut TestAppContext,
) {
    let (view, _, visual) = setup_doc(cx, "csv-parity-menu-moves", "Name,Score\nAda,1\nLin,2\n");
    view.update_in(visual, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);

        // Move row 1 down -> row 2 structurally selected, no active cell.
        let at = press_point(v, v.column_x(0) + 5., v.row_y(1) + 5.);
        v.context_menu(at, w, cx);
        v.menu_event(MenuEvent::Run("move-row-down"), w, cx);
        v.close_menu(false, w, cx);
        assert_eq!(v.gestures.structural, Some((Axis::Row, 2)));
        assert_eq!(v.structure_outline(), Some((Axis::Row, 2)));
        assert!(v.cell.is_none());

        // Move row 2 up -> row 1 structurally selected.
        let at = press_point(v, v.column_x(0) + 5., v.row_y(2) + 5.);
        v.context_menu(at, w, cx);
        v.menu_event(MenuEvent::Run("move-row-up"), w, cx);
        v.close_menu(false, w, cx);
        assert_eq!(v.gestures.structural, Some((Axis::Row, 1)));
        assert!(v.cell.is_none());

        // Move column 0 right -> column 1 structurally selected.
        let at = press_point(v, v.column_x(0) + 5., v.row_y(0) + 5.);
        v.context_menu(at, w, cx);
        v.menu_event(MenuEvent::Run("move-column-right"), w, cx);
        v.close_menu(false, w, cx);
        assert_eq!(v.gestures.structural, Some((Axis::Column, 1)));
        assert!(v.cell.is_none());

        // Move column 1 left -> column 0 structurally selected.
        let at = press_point(v, v.column_x(1) + 5., v.row_y(0) + 5.);
        v.context_menu(at, w, cx);
        v.menu_event(MenuEvent::Run("move-column-left"), w, cx);
        v.close_menu(false, w, cx);
        assert_eq!(v.gestures.structural, Some((Axis::Column, 0)));
        assert!(v.cell.is_none());
        v.focus.focus(w, cx);
    });
    assert_eq!(text(&view, visual), "Name,Score\nAda,1\nLin,2\n");
    visual.simulate_keystrokes("escape");
    visual.run_until_parked();
    view.read_with(visual, |v, _| {
        assert_eq!(v.gestures.structural, None);
    });
}

#[gpui::test]
fn csv_corner_expansion_grows_rows_columns_and_both_with_single_undo(cx: &mut TestAppContext) {
    let source = "h1,h2\na,b\nc,d\n";
    for (dx, dy, add_rows, add_cols, expected_rows, expected_cols) in [
        (0., 93., 3usize, 0usize, 6usize, 2usize),
        (288., 0., 0, 3, 3, 5),
        (288., 93., 3, 3, 6, 5),
    ] {
        let (view, changes, visual) = setup_doc(cx, "csv-parity-expand-axes", source);
        view.update_in(visual, |v, w, cx| {
            v.header = true;
            v.port.origin = Some(point(px(0.), px(0.)));
            v.port.size = size(900., 600.);
            let (tw, th) = v.table_size();
            let corner = press_point(v, 32. + tw + 9., 32. + th + 9.);
            v.start_expand(corner, w, cx);
            v.drag_expand(point(corner.x + px(dx), corner.y + px(dy)), cx);
            assert_eq!(
                v.preview(),
                Expansion {
                    rows: add_rows,
                    columns: add_cols
                }
            );
            assert_eq!(
                (v.total_rows(), v.total_columns()),
                (expected_rows, expected_cols)
            );
            v.end_expand(false, w, cx);
            assert_eq!((v.rows(), v.columns()), (expected_rows, expected_cols));
            assert_eq!(v.model.undo_len(), 1);
            v.undo(false, w, cx);
        });
        assert_eq!(*changes.borrow(), 2);
        assert_eq!(text(&view, visual), source);
        view.update_in(visual, |v, w, cx| {
            v.undo(true, w, cx);
            assert_eq!((v.rows(), v.columns()), (expected_rows, expected_cols));
        });
    }
}

#[gpui::test]
fn csv_header_and_row_number_settings_persist_and_keep_edge_row_handle(cx: &mut TestAppContext) {
    let source = "Name,Score\nAda,1\nLin,2\n";
    let doc_id = "csv-parity-persist-settings";
    let (view, changes, visual) = setup_doc(cx, doc_id, source);
    view.update_in(visual, |v, w, cx| {
        assert!(v.header);
        assert!(v.row_numbers);
        assert!(v.index_width() > 0.);
        v.view_command("csv-header-row", w, cx);
        assert!(!v.header);
        assert_eq!(v.first_movable(), 0);
        v.view_command("csv-row-numbers", w, cx);
        assert!(!v.row_numbers);
        assert_eq!(v.index_width(), 0.);
    });
    assert_eq!(*changes.borrow(), 0);
    assert_eq!(text(&view, visual), source);

    // Persisted preferences survive remount, and row handle stays reachable without gutter.
    let (remounted, _, visual2) = setup_doc(cx, doc_id, source);
    remounted.update_in(visual2, |v, w, cx| {
        assert!(!v.header);
        assert!(!v.row_numbers);
        assert_eq!(v.index_width(), 0.);
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 600.);
        v.pointer_moved(press_point(v, v.column_x(0) + 5., v.row_y(1) + 5.), cx);
        assert_eq!(v.row_grip_shown(), Some(1));
        let (grip, docked) = v.row_grip(1);
        assert!(!docked);
        assert_eq!(grip.origin.x, v.column_x(0) - 12.);
        let start = press_point(v, grip.origin.x + 12., grip.origin.y + 16.);
        v.start_structure_drag(Axis::Row, start, w, cx);
        v.end_structure_drag(false, w, cx);
        assert_eq!(v.menu.as_ref().and_then(|m| m.source), Some((Axis::Row, 1)));
    });
}

#[gpui::test]
fn csv_ambiguous_all_text_defaults_to_data_and_3x3_template_has_header(cx: &mut TestAppContext) {
    let (ambiguous, _, visual) = setup_doc(
        cx,
        "csv-parity-ambiguous",
        "Name,City\nAda,London\nBob,Paris\n",
    );
    ambiguous.read_with(visual, |v, _| {
        assert!(!v.header);
        assert_eq!(v.first_movable(), 0);
        assert_eq!((v.rows(), v.columns()), (3, 2));
    });

    let (template, _, visual2) =
        setup_doc(cx, "csv-parity-3x3", "Column 1,Column 2,Column 3\n,,\n,,\n");
    template.update_in(visual2, |v, w, cx| {
        assert!(v.header);
        assert_eq!((v.rows(), v.columns(), v.data_rows()), (3, 3, 2));
        v.activate(1, 0, None, w, cx);
    });
    visual2.simulate_input("val");
    visual2.simulate_keystrokes("enter");
    visual2.run_until_parked();
    assert_eq!(
        text(&template, visual2),
        "Column 1,Column 2,Column 3\nval,,\n,,\n"
    );
}

#[gpui::test]
fn csv_horizontal_edge_expansion_scrolls_stops_caps_and_cancels(cx: &mut TestAppContext) {
    let source = "h1,h2\na,b\n";
    let (view, changes, visual) = setup_doc(cx, "csv-parity-edge-expand", source);
    view.update_in(visual, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(300., 300.);
        v.focus.focus(w, cx);
        let (tw, th) = v.table_size();
        let corner = press_point(v, 32. + tw + 9., 32. + th + 9.);
        v.start_expand(corner, w, cx);
        // Drag into the trailing edge zone and advance synthetic animation frames.
        v.drag_expand(point(px(295.), corner.y), cx);
        for _ in 0..45 {
            if let Some(drag) = v.expansion.drag.as_mut() {
                drag.last_frame = None;
            }
            assert!(v.advance_expand_scroll(cx));
        }
        assert!(v.preview().columns >= 4, "{:?}", v.preview());
        assert!(v.port.scroll.x > 0., "scroll={}", v.port.scroll.x);

        // Returning the pointer to the middle stops automatic growth.
        v.drag_expand(point(px(150.), corner.y), cx);
        assert!(!v.advance_expand_scroll(cx));
    });

    // Escape cancels edge expansion and restores scroll without editing.
    visual.simulate_keystrokes("escape");
    visual.run_until_parked();
    view.read_with(visual, |v, _| {
        assert!(v.expansion.drag.is_none());
        assert_eq!(v.port.scroll.x, 0.);
    });
    assert_eq!(text(&view, visual), source);
    assert_eq!(*changes.borrow(), 0);

    // Blur also cancels and restores scroll without editing.
    view.update_in(visual, |v, w, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(300., 300.);
        let (tw, th) = v.table_size();
        let corner = press_point(v, 32. + tw + 9., 32. + th + 9.);
        v.start_expand(corner, w, cx);
        v.drag_expand(point(px(295.), corner.y), cx);
        for _ in 0..20 {
            if let Some(drag) = v.expansion.drag.as_mut() {
                drag.last_frame = None;
            }
            v.advance_expand_scroll(cx);
        }
        assert!(v.port.scroll.x > 0.);
        v.cancel_transient_gestures();
        assert!(v.expansion.drag.is_none());
        assert_eq!(v.port.scroll.x, 0.);
    });
    assert_eq!(text(&view, visual), source);
    assert_eq!(*changes.borrow(), 0);

    // Committing after edge expansion applies a single undoable edit.
    let added = view.update_in(visual, |v, w, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(300., 300.);
        let (tw, th) = v.table_size();
        let corner = press_point(v, 32. + tw + 9., 32. + th + 9.);
        v.start_expand(corner, w, cx);
        v.drag_expand(point(px(295.), corner.y), cx);
        for _ in 0..45 {
            if let Some(drag) = v.expansion.drag.as_mut() {
                drag.last_frame = None;
            }
            v.advance_expand_scroll(cx);
        }
        let cols = v.preview().columns;
        assert!(cols >= 4);
        v.end_expand(false, w, cx);
        assert_eq!(v.columns(), 2 + cols);
        assert_eq!(v.model.undo_len(), 1);
        cols
    });
    assert_eq!(*changes.borrow(), 1);
    assert_eq!(
        text(&view, visual)
            .lines()
            .next()
            .unwrap()
            .matches(',')
            .count(),
        1 + added
    );

    // Column safety limit (256): edge expansion stops cleanly at MAX_COLUMNS.
    let header_254 = (0..254)
        .map(|i| format!("c{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let row_254 = vec!["1"; 254].join(",");
    let wide = format!("{header_254}\n{row_254}\n");
    let (wide_view, _, visual2) = setup_doc(cx, "csv-parity-edge-cap", &wide);
    wide_view.update_in(visual2, |v, w, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(300., 300.);
        let corner = point(px(260.), px(120.));
        v.start_expand(corner, w, cx);
        v.drag_expand(point(px(295.), corner.y), cx);
        for _ in 0..40 {
            if let Some(drag) = v.expansion.drag.as_mut() {
                drag.last_frame = None;
            }
            if !v.advance_expand_scroll(cx) {
                break;
            }
        }
        assert_eq!(v.preview().columns, 2);
        assert!(!v.advance_expand_scroll(cx));
    });
}

#[gpui::test]
fn csv_corner_picker_jitter_inward_cancel_viewport_clamp_and_column_cap(cx: &mut TestAppContext) {
    let source = "h1,h2\na,b\n";
    let (view, changes, visual) = setup_doc(cx, "csv-parity-picker", source);
    view.update_in(visual, |v, w, cx| {
        v.header = true;
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 220.);

        // Small jitter (< 8px) stays a click and opens the picker instead of dragging.
        let (tw, th) = v.table_size();
        let corner = press_point(v, 32. + tw + 9., 32. + th + 9.);
        v.start_expand(corner, w, cx);
        v.drag_expand(point(corner.x + px(4.), corner.y + px(3.)), cx);
        assert_eq!(v.preview(), Expansion::default());
        v.end_expand(false, w, cx);
        assert!(v.expansion.picker.is_some());

        // Picker expands 2x3 in one snapshot; undo restores the original table.
        v.expand_to(v.data_rows() + 2, v.columns() + 3, w, cx);
        assert_eq!((v.rows(), v.columns(), v.model.undo_len()), (4, 5, 1));
        v.undo(false, w, cx);
        assert_eq!((v.rows(), v.columns()), (2, 2));
    });
    assert_eq!(text(&view, visual), source);

    // Outward preview followed by inward drag commits nothing; viewport bottom clamps rows;
    // downward preview keeps existing column tracks and gutter alignment.
    let changes_before = *changes.borrow();
    view.update_in(visual, |v, w, cx| {
        v.port.origin = Some(point(px(0.), px(0.)));
        v.port.size = size(800., 220.);
        v.layout.set_width(1, 180.);
        let (tw, th) = v.table_size();
        let corner = press_point(v, 32. + tw + 9., 32. + th + 9.);
        v.start_expand(corner, w, cx);
        let max_rows = v.expansion.drag.unwrap().max_rows;
        assert!(max_rows > 0 && max_rows < 10);
        // Dragging far beyond editor height clamps vertical preview to max_rows.
        v.drag_expand(point(corner.x, corner.y + px(2000.)), cx);
        assert_eq!(v.preview().rows, max_rows);
        assert_eq!(v.column_width(1), 180.);
        assert_eq!(v.index_width(), v.theme.index_width);
        // Dragging inward returns preview to 0x0 and release is non-destructive.
        v.drag_expand(point(corner.x - px(40.), corner.y - px(40.)), cx);
        assert_eq!(v.preview(), Expansion::default());
        v.end_expand(false, w, cx);
        assert_eq!((v.rows(), v.columns()), (2, 2));

        // Blur cancels an active expansion preview.
        v.start_expand(corner, w, cx);
        v.drag_expand(point(corner.x + px(120.), corner.y + px(60.)), cx);
        assert_ne!(v.preview(), Expansion::default());
        v.cancel_transient_gestures();
        assert!(v.expansion.drag.is_none());
        assert_eq!(v.preview(), Expansion::default());
    });
    assert_eq!(*changes.borrow(), changes_before);
    assert_eq!(text(&view, visual), source);

    // 254-column table keeps 6 picker rows and caps picker columns to remaining 2.
    let header_254 = (0..254)
        .map(|i| format!("c{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let row_254 = vec!["1"; 254].join(",");
    let wide = format!("{header_254}\n{row_254}\n");
    let (wide_view, _, visual2) = setup_doc(cx, "csv-parity-picker-cap", &wide);
    wide_view.read_with(visual2, |v, _| {
        assert_eq!(v.picker_size(), (6, 2));
    });
}
