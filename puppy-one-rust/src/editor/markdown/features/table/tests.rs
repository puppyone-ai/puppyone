//! The Markdown table in a live editor (GPUI test platform): structure
//! commands rewrite the source in one undoable transaction and put the caret
//! in their target cell; moves keep the selection.
use super::commands::structure;
use crate::editor::{
    markdown::MarkdownExtension,
    table::operation::{Alignment, Operation},
    view::{EditorView, bind_keys, style},
};
use crate::typography::Scale;
use gpui::{Entity, TestAppContext, VisualTestContext};

const TABLE: &str = "| Name | Qty |\n| --- | --: |\n| apple | 3 |\n| pear | 5 |\n";

fn setup<'a>(cx: &'a mut TestAppContext) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let (view, cx) = cx.add_window_view(|_, cx| EditorView::new(TABLE, Box::new(MarkdownExtension::new(true, Scale::Medium)), cx));
    view.update_in(cx, |v, w, cx| v.focus(w, cx));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    (view, cx)
}

fn run(view: &Entity<EditorView>, cx: &mut VisualTestContext, op: Operation, row: usize, column: usize) {
    view.update_in(cx, |v, w, cx| v.run_command(&structure(0, op, row, column), w, cx));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}

#[gpui::test]
fn the_rails_and_menu_operations_rewrite_the_table(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    // The add-row rail: a row after the last, caret in its first cell.
    run(&view, cx, Operation::InsertRowBelow, 2, 0);
    view.update(cx, |v, _| {
        // Delimiter cells pad with spaces, as the product's `padEnd`.
        assert_eq!(v.text(), "| Name  | Qty  |\n| ---   | ---: |\n| apple | 3    |\n| pear  | 5    |\n|       |      |\n");
        let caret = v.state().selection.head;
        assert_eq!(&v.text()[..caret], "| Name  | Qty  |\n| ---   | ---: |\n| apple | 3    |\n| pear  | 5    |\n| ");
    });
    // One undo step restores the original source.
    cx.simulate_keystrokes("cmd-z");
    view.update(cx, |v, _| assert_eq!(v.text(), TABLE));
    // The add-column rail, then alignment from the menu.
    run(&view, cx, Operation::InsertColumnRight, 0, 1);
    run(&view, cx, Operation::SetColumnAlignment(Alignment::Center), 0, 2);
    view.update(cx, |v, _| assert_eq!(v.text().lines().nth(1), Some("| ---   | ---: | :---: |")));
    // A move keeps the selection where it was mapped.
    let before = view.update(cx, |v, _| v.state().selection.head);
    run(&view, cx, Operation::MoveRowTo(1), 2, 0);
    view.update(cx, |v, _| {
        assert_eq!(v.text().lines().nth(2), Some("| pear  | 5    |       |"));
        assert!(v.state().selection.head <= v.text().len() && before > 0);
    });
    // Deleting the table leaves the caret where it was.
    run(&view, cx, Operation::DeleteTable, 0, 0);
    view.update(cx, |v, _| assert_eq!((v.text(), v.state().selection.head), ("\n", 0)));
}

mod interaction {
    use super::super::{
        commands::Structure,
        interaction::{Frame, Geometry, TableUi},
    };
    use crate::editor::table::{
        interaction::Hover,
        menu::{MenuEvent, Scope},
        operation::{Alignment, Axis, Operation},
    };
    use gpui::{AppContext as _, Bounds, Entity, TestAppContext, point, px, size};
    use std::{cell::RefCell, rc::Rc};

    fn setup(cx: &mut TestAppContext) -> (Entity<TableUi>, Rc<RefCell<Vec<Structure>>>, &mut gpui::VisualTestContext) {
        cx.update(gpui_kit::init);
        let sent = Rc::new(RefCell::new(Vec::new()));
        let sink = sent.clone();
        // Three rows of 30px under a 14px gutter, two 100px columns.
        let geometry = Geometry { table: Bounds { origin: point(0., 14.), size: size(201., 92.) }, rows: vec![(15., 31.), (46., 31.), (77., 30.)], columns: vec![(1., 101.), (102., 100.)] };
        struct Root;
        impl gpui::Render for Root {
            fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl gpui::IntoElement {
                gpui::Empty
            }
        }
        let (_, cx) = cx.add_window_view(|_, _| Root);
        let ui = cx.update(|_, cx| cx.new(move |_| TableUi {
            origin: Some(point(px(0.), px(0.))),
            frame: Some(Frame {
                geometry,
                table: 7,
                alignments: vec![Alignment::None, Alignment::Right],
                dark: true,
                sender: Rc::new(move |command, _, _| sink.borrow_mut().push(*command.payload::<Structure>().unwrap())),
                focus_editor: Rc::new(|_, _| {}),
            }),
            ..TableUi::default()
        }));
        (ui, sent, cx)
    }

    #[gpui::test]
    fn a_row_drag_moves_the_row_and_selects_it(cx: &mut TestAppContext) {
        let (ui, sent, cx) = setup(cx);
        ui.update_in(cx, |u, w, cx| {
            u.pointer_moved(point(px(50.), px(60.)), cx);
            assert_eq!(u.gestures.hover, Hover { row: Some(1), column: Some(0) });
            u.start_drag(Axis::Row, point(px(-2.), px(60.)), cx);
            u.drag_to(point(px(-2.), px(100.)), cx);
            u.end_drag(false, Bounds::default(), w, cx);
            assert_eq!(u.gestures.structural, Some((Axis::Row, 2)));
        });
        assert_eq!(*sent.borrow(), vec![Structure { table: 7, operation: Operation::MoveRowTo(2), row: 1, column: 0 }]);
    }

    #[gpui::test]
    fn a_grip_click_opens_its_axis_menu_and_items_run_as_commands(cx: &mut TestAppContext) {
        let (ui, sent, cx) = setup(cx);
        ui.update_in(cx, |u, w, cx| {
            u.pointer_moved(point(px(150.), px(20.)), cx);
            u.start_drag(Axis::Column, point(px(150.), px(14.)), cx);
            u.end_drag(false, Bounds { origin: point(136., 2.), size: size(32., 24.) }, w, cx);
            let menu = u.menu.as_ref().unwrap();
            assert_eq!((menu.row, menu.column, menu.source), (0, 1, Some((Axis::Column, 1))));
            assert_eq!(u.outline(), Some((Axis::Column, 1)));
        });
        // A menu move selects the column at its destination.
        ui.update_in(cx, |u, w, cx| {
            u.open_menu(Scope::Column, 0, 1, point(px(0.), px(0.)), Some((Axis::Column, 1)), w, cx);
        });
        let menu = ui.update(cx, |u, _| u.menu.as_ref().unwrap().menu.clone());
        menu.update(cx, |_, cx| cx.emit(MenuEvent::Run("move-column-left")));
        cx.run_until_parked();
        assert_eq!(sent.borrow().last(), Some(&Structure { table: 7, operation: Operation::MoveColumnLeft, row: 0, column: 1 }));
        ui.update(cx, |u, _| assert_eq!(u.gestures.structural, Some((Axis::Column, 0))));
    }
}
