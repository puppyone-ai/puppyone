//! Wide tables scroll horizontally and keep their viewport and column
//! sessions (`tables/viewport.test.ts` #0–#5, `markdownEditorLayout.test.ts`
//! #25, `tables/column-widths.test.ts` #3; gaps
//! `markdown-table-horizontal-scroll` and
//! `markdown-table-column-width-sessions`).
use super::{MarkdownExtension, setup};
use crate::editor::{
    markdown::{
        features::table::{
            interaction::TableUi,
            structure_command,
            widget::{clear_last_table_ui_for_tests, last_table_ui_for_tests},
        },
        platform::sessions::{
            column_layout,
            inline_viewport::{self, Lifecycle, Position},
        },
    },
    table::operation::Operation,
    text::{
        change::ChangeSet,
        selection::Selection,
        state::{Transaction, UserEvent},
    },
    view::EditorView,
};
use gpui::{
    Entity, Modifiers, Pixels, Point, ScrollDelta, ScrollWheelEvent, TestAppContext, TouchPhase,
    VisualTestContext, point, px,
};
use gpui_kit::base::ScrollbarHandle;

/// Eight columns of long words: wider than the reading column at the
/// smallest readable tracks.
fn wide() -> String {
    let row = |cell: &dyn Fn(usize) -> String| {
        format!("| {} |", (0..8).map(cell).collect::<Vec<_>>().join(" | "))
    };
    [
        row(&|c| format!("Heading{c}abcdefghijklmnop")),
        row(&|_| "---".into()),
        row(&|c| format!("value{c}qrstuvwxyzabcdefghij")),
        row(&|c| format!("other{c}klmnopqrstuvwxyzabcd")),
    ]
    .join("\n")
}

fn draw(cx: &mut VisualTestContext) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update(|w, cx| w.draw(cx).clear(cx));
    }
}

fn mount<'a>(
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
    let ui = last_table_ui_for_tests().expect("the table mounts its state");
    (view, ui, visual)
}

/// The mounted viewport session.
fn viewport(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> inline_viewport::Session {
    view.update(cx, |v, _| {
        let md = v.extension_mut::<MarkdownExtension>().unwrap();
        let mounted: Vec<_> = md
            .sessions()
            .unwrap()
            .viewports
            .borrow_mut()
            .values()
            .into_iter()
            .filter(|s| s.lifecycle == Lifecycle::Mounted)
            .collect();
        let all = md.sessions().unwrap().viewports.borrow_mut().values();
        assert_eq!(mounted.len(), 1, "{all:?}");
        mounted[0].clone()
    })
}

/// The mounted column layout session.
fn layout(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> column_layout::Session {
    view.update(cx, |v, _| {
        let md = v.extension_mut::<MarkdownExtension>().unwrap();
        let mounted: Vec<_> = md
            .sessions()
            .unwrap()
            .layouts
            .borrow_mut()
            .values()
            .into_iter()
            .filter(|s| s.lifecycle == column_layout::Lifecycle::Mounted)
            .collect();
        assert_eq!(mounted.len(), 1, "{mounted:?}");
        mounted[0].clone()
    })
}

/// The table's logical offset: how far its start moved left of the
/// reading column.
fn offset(ui: &Entity<TableUi>, cx: &mut VisualTestContext) -> f32 {
    ui.read_with(cx, |u, _| {
        -u.frame.as_ref().unwrap().geometry.table.origin.x
    })
}

/// Each column's track.
fn tracks(ui: &Entity<TableUi>, cx: &mut VisualTestContext) -> Vec<f32> {
    ui.read_with(cx, |u, _| {
        u.frame
            .as_ref()
            .unwrap()
            .geometry
            .columns
            .iter()
            .map(|(_, w)| *w)
            .collect()
    })
}

/// The reading column's left edge and width, in window coordinates.
fn column(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> (f32, f32) {
    view.read_with(cx, |v, _| {
        let block = &v.layout().unwrap().blocks[0];
        (
            f32::from(block.bounds.origin.x),
            f32::from(block.bounds.size.width),
        )
    })
}

fn wheel(cx: &mut VisualTestContext, at: Point<Pixels>, delta: Point<Pixels>, shift: bool) {
    cx.simulate_event(ScrollWheelEvent {
        position: at,
        delta: ScrollDelta::Pixels(delta),
        modifiers: if shift {
            Modifiers::shift()
        } else {
            Modifiers::none()
        },
        touch_phase: TouchPhase::Moved,
    });
    draw(cx);
}

fn scroll_y(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> f32 {
    view.read_with(cx, |v, _| v.scroll_top())
}

/// A point over the table's body.
fn over_table(cx: &mut VisualTestContext) -> Point<Pixels> {
    cx.debug_bounds("md-table-surface")
        .expect("the table surface")
        .center()
}

/// `markdownEditorLayout.test.ts` #25: the scrollport reaches the editor's
/// edges while the table starts at the reading column and its scrollbar
/// stays on the reading rail; horizontal input scrolls the table, vertical
/// input stays with the document.
#[gpui::test]
fn a_wide_table_scrolls_in_an_editor_edge_scrollport_with_a_reading_rail_scrollbar(
    cx: &mut TestAppContext,
) {
    let source = format!("{}\n\n{}", wide(), "Paragraph\n\n".repeat(80));
    let (view, ui, visual) = mount(cx, &source);
    let (left, width) = column(&view, visual);
    let surface = visual.debug_bounds("md-table-surface").unwrap();
    assert_eq!(
        f32::from(surface.origin.x),
        left,
        "the table starts at the reading column"
    );
    assert!(
        f32::from(surface.size.width) > width,
        "the table is wider than the column"
    );
    let rail = visual
        .debug_bounds("md-table-scrollbar-rail")
        .expect("a reading-rail scrollbar");
    assert_eq!(
        (f32::from(rail.origin.x), f32::from(rail.size.width)),
        (left, width)
    );
    assert_eq!(f32::from(rail.size.height), 12.);
    assert!(rail.origin.y > surface.origin.y + surface.size.height);

    // A horizontal gesture scrolls the table, not the document.
    let at = over_table(visual);
    let before = scroll_y(&view, visual);
    wheel(visual, at, point(px(-120.), px(0.)), false);
    assert_eq!(offset(&ui, visual), 120.);
    assert_eq!(scroll_y(&view, visual), before);
    // Shift with a vertical wheel scrolls it too.
    wheel(visual, at, point(px(0.), px(-30.)), true);
    assert_eq!(offset(&ui, visual), 150.);
    assert_eq!(scroll_y(&view, visual), before);
    // A vertical wheel over the table scrolls the document.
    wheel(visual, at, point(px(0.), px(-40.)), false);
    assert_eq!(offset(&ui, visual), 150.);
    assert!(scroll_y(&view, visual) > before);
    // The range ends with the table's end at the reading column's end.
    let at = over_table(visual);
    wheel(visual, at, point(px(-100_000.), px(0.)), false);
    let surface = visual.debug_bounds("md-table-surface").unwrap();
    assert!(
        (f32::from(surface.origin.x + surface.size.width) - (left + width)).abs() < 0.5,
        "the table ends at the reading column's end"
    );

    // Control: a table that fits has no scrollbar and no scrolling.
    let (_, ui, visual) = mount(cx, "| A | B |\n| --- | --- |\n| one | two |");
    assert!(visual.debug_bounds("md-table-scrollbar-rail").is_none());
    let at = over_table(visual);
    wheel(visual, at, point(px(-120.), px(0.)), false);
    assert_eq!(offset(&ui, visual), 0.);
}

/// `tables/viewport.test.ts` #1: the reading-rail scrollbar and the wider
/// table viewport follow each other, mapped over their ranges.
#[gpui::test]
fn the_reading_rail_scrollbar_and_the_table_follow_each_other(cx: &mut TestAppContext) {
    let (_, ui, visual) = mount(cx, &wide());
    let rail = ui
        .read_with(visual, |u, _| u.rail.clone())
        .expect("the rail");
    let (bounds, content) = (rail.viewport_bounds(), rail.content_size());
    let max = ui.read_with(visual, |u, _| {
        let g = &u.frame.as_ref().unwrap().geometry;
        g.table.size.width - f32::from(bounds.size.width)
    });
    assert!(max > 0.);
    assert!((f32::from(content.width - bounds.size.width) - max).abs() < 0.5);
    // Dragging the rail scrolls the table.
    rail.set_offset(point(px(-42.), px(0.)));
    draw(visual);
    assert!((offset(&ui, visual) - 42.).abs() < 0.01);
    // Scrolling the table moves the rail.
    let at = over_table(visual);
    wheel(visual, at, point(px(-31.), px(0.)), false);
    let rail = ui.read_with(visual, |u, _| u.rail.clone()).unwrap();
    assert!((f32::from(-rail.offset().x) - 73.).abs() < 0.01);
}

/// #0: the viewport and column layout sessions survive a structural
/// replacement, its undo and its redo; existing tracks keep their widths and
/// the scroll anchor follows its column.
#[gpui::test]
fn sessions_survive_a_structural_replacement_its_undo_and_redo(cx: &mut TestAppContext) {
    let (view, ui, visual) = mount(cx, &wide());
    // An explicit track (resized) and a scroll into column 3.
    ui.update(visual, |u, cx| {
        let widths: Vec<f32> = tracks_of(u);
        u.set_width(0, 300., &widths);
        cx.notify();
    });
    draw(visual);
    let at = over_table(visual);
    wheel(visual, at, point(px(-700.), px(0.)), false);
    let (first, columns) = (viewport(&view, visual), layout(&view, visual));
    let Position::Anchored { item, within, .. } = first.position else {
        panic!("scrolled: {first:?}");
    };
    let widths = tracks(&ui, visual);
    let before = offset(&ui, visual);

    view.update_in(visual, |v, w, cx| {
        v.run_command(
            &structure_command(0, Operation::InsertColumnLeft, 0, 0),
            w,
            cx,
        );
    });
    draw(visual);
    let replaced = viewport(&view, visual);
    assert_eq!(replaced.id, first.id);
    assert_eq!(layout(&view, visual).id, columns.id);
    // The new column 0 starts at the floor; every other track is kept.
    let after = tracks(&ui, visual);
    assert_eq!(after[0], column_layout::MIN_WIDTH);
    assert_eq!(after[1..], widths[..]);
    // The anchor moved with its column, so the same content shows.
    assert_eq!(
        replaced.position,
        Position::Anchored {
            item: item + 1,
            within,
            fallback: before,
        }
    );
    assert!((offset(&ui, visual) - (before + column_layout::MIN_WIDTH)).abs() < 0.01);

    view.update(visual, |v, cx| v.undo(false, cx));
    draw(visual);
    assert_eq!(viewport(&view, visual).id, first.id);
    assert_eq!(layout(&view, visual).id, columns.id);
    assert_eq!(tracks(&ui, visual), widths);
    assert!((offset(&ui, visual) - before).abs() < 0.01);

    view.update(visual, |v, cx| v.undo(true, cx));
    draw(visual);
    assert_eq!(viewport(&view, visual).id, first.id);
    assert_eq!(layout(&view, visual).id, columns.id);
}

fn tracks_of(u: &TableUi) -> Vec<f32> {
    u.frame
        .as_ref()
        .unwrap()
        .geometry
        .columns
        .iter()
        .map(|(_, w)| *w)
        .collect()
}

/// #2 and #3: an unrelated edit before the table and a cell edit keep the
/// viewport lineage and its offset.
#[gpui::test]
fn an_edit_before_the_table_and_a_cell_edit_keep_the_viewport(cx: &mut TestAppContext) {
    let (view, ui, visual) = mount(cx, &wide());
    let at = over_table(visual);
    wheel(visual, at, point(px(-260.), px(0.)), false);
    let first = viewport(&view, visual);
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(0..0, "intro\n\n"),
                Some(Selection::cursor(2)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    let mapped = viewport(&view, visual);
    assert_eq!(mapped.id, first.id);
    assert_eq!(mapped.range.start, first.range.start + "intro\n\n".len());
    assert_eq!(offset(&ui, visual), 260.);

    let cell = view.read_with(visual, |v, _| v.text().find("value1").unwrap());
    view.update_in(visual, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(cell), cx);
    });
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(cell..cell, "updated "),
                Some(Selection::cursor(cell + 8)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    assert!(view.read_with(visual, |v, _| v.text().contains("updated value1")));
    assert_eq!(viewport(&view, visual).id, first.id);
}

/// #4: a different table replacing the document does not inherit the
/// viewport.
#[gpui::test]
fn an_unrelated_replacement_table_starts_its_own_viewport(cx: &mut TestAppContext) {
    let (view, ui, visual) = mount(cx, &wide());
    let at = over_table(visual);
    wheel(visual, at, point(px(-260.), px(0.)), false);
    let first = viewport(&view, visual);
    let other = wide().replace("value", "seven");
    view.update(visual, |v, cx| {
        let len = v.text().len();
        v.dispatch(
            Transaction::edit(ChangeSet::replace(0..len, &other), None, UserEvent::Input),
            cx,
        );
    });
    draw(visual);
    let replacement = viewport(&view, visual);
    assert_ne!(replacement.id, first.id);
    assert_eq!(replacement.position, Position::Start);
    assert_eq!(offset(&ui, visual), 0.);
}

/// #5: moving the caret into a column outside the scrollport scrolls the
/// table to it; the editor itself never scrolls horizontally.
#[gpui::test]
fn the_caret_column_comes_into_view(cx: &mut TestAppContext) {
    let (view, ui, visual) = mount(cx, &wide());
    let (left, width) = column(&view, visual);
    assert_eq!(offset(&ui, visual), 0.);
    let cell = view.read_with(visual, |v, _| v.text().find("value7").unwrap());
    view.update_in(visual, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(cell + 2), cx);
    });
    draw(visual);
    assert!(offset(&ui, visual) > 0.);
    // Column 7 now lies inside the scrollport, which spans the reading
    // column and both gutters (the editor starts at window x 0).
    let (start, w) = ui.read_with(visual, |u, _| u.frame.as_ref().unwrap().geometry.columns[7]);
    let shown = left + start;
    assert!(
        shown >= 0. && shown + w <= 2. * left + width + 0.5,
        "{shown} {w}"
    );
    // The editor itself did not move sideways.
    assert_eq!(column(&view, visual), (left, width));
    view.read_with(visual, |v, _| {
        assert_eq!(v.state().selection.head, cell + 2)
    });
}

/// A view of `source` opened as `notes/table.md`, its explicit tracks kept
/// in `persistence` (the person's preference file).
fn open<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
    persistence: Option<std::rc::Rc<dyn column_layout::Persistence>>,
) -> (
    Entity<EditorView>,
    Entity<TableUi>,
    &'a mut VisualTestContext,
) {
    clear_last_table_ui_for_tests();
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system()
            .add_fonts(crate::editor::view::style::font_bytes())
            .unwrap();
        crate::editor::view::bind_keys(cx);
    });
    let text = source.to_owned();
    let (view, visual) = cx.add_window_view(move |_, cx| {
        let mut md = MarkdownExtension::new(true, crate::typography::Scale::Medium);
        md.assets = Some(crate::editor::registry::DocumentAssets {
            workspace: "workspace:tables".into(),
            document: "notes/table.md".into(),
            read: std::sync::Arc::new(|_| None),
        });
        if let Some(p) = persistence {
            md.sessions()
                .unwrap()
                .layouts
                .borrow_mut()
                .set_persistence(Some(p));
        }
        EditorView::new(&text, Box::new(md), cx)
    });
    visual.update(|w, _| w.activate_window());
    draw(visual);
    let ui = last_table_ui_for_tests().expect("the table mounts its state");
    (view, ui, visual)
}

/// `tables/column-widths.test.ts` #3: a resized track stays through cell
/// commits and returns when the document opens again.
#[gpui::test]
fn a_resized_track_stays_through_cell_commits_and_reopening(cx: &mut TestAppContext) {
    let source = "| Name | Value |\n| --- | --- |\n| Alpha | Beta |";
    let (view, ui, visual) = open(cx, source, None);
    ui.update(visual, |u, cx| {
        let widths = tracks_of(u);
        u.set_width(1, 260., &widths);
        cx.notify();
    });
    draw(visual);
    assert_eq!(tracks(&ui, visual)[1], 260.);
    let automatic = tracks(&ui, visual)[0];
    let persistence = view.update(visual, |v, _| {
        let md = v.extension_mut::<MarkdownExtension>().unwrap();
        md.sessions().unwrap().layouts.borrow().persistence()
    });
    // A cell commit keeps the explicit track, and the automatic one too.
    let cell = source.find("Beta").unwrap();
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(cell..cell, "much longer content "),
                None,
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    assert_eq!(tracks(&ui, visual), [automatic, 260.]);
    assert!(layout(&view, visual).explicit);
    view.update(visual, |v, cx| v.undo(false, cx));
    draw(visual);
    assert_eq!(tracks(&ui, visual)[1], 260.);

    // The same document, content and position open again in a new view.
    let (view, ui, visual) = open(cx, source, persistence);
    assert_eq!(tracks(&ui, visual)[1], 260.);
    assert!(layout(&view, visual).explicit);
    // Other content does not inherit the tracks.
    let (_, ui, visual) = open(cx, &source.replace("Alpha", "Gamma"), None);
    assert_ne!(tracks(&ui, visual)[1], 260.);
}
