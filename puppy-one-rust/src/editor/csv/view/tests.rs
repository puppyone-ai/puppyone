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
use gpui::{Entity, EntityInputHandler, TestAppContext, VisualTestContext, point, px, size};
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
    // Enter and Escape leave an `<input>` alone.
    cx.simulate_keystrokes("enter escape");
    assert_eq!(active(&view, cx), Some((1, 1, "bob".into())));
    // ⌘Z in the cell undoes through the model (one step per edit).
    cx.simulate_keystrokes("cmd-z cmd-z cmd-z");
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1,alice\n");
    assert_eq!(active(&view, cx), Some((1, 1, "alice".into())));
    cx.simulate_keystrokes("cmd-shift-z");
    cx.run_until_parked();
    assert_eq!(text(&view, cx), "id,name\n1,b\n");
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
fn pasted_line_breaks_are_dropped(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "a,b\n");
    view.update_in(cx, |v, w, cx| v.activate(0, 0, Some(1), w, cx));
    cx.simulate_input("x\ny");
    assert_eq!(active(&view, cx), Some((0, 0, "axy".into())));
    assert_eq!(text(&view, cx), "axy,b\n");
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
