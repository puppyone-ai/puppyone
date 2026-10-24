//! The add-row / add-column rails (shared table controls) and the
//! expansion corner (`CsvTableResizeControl`).
use super::*;
use crate::editor::table::controls;
use crate::localization::t as t_;

impl CsvEditor {
    /// The add-row / add-column rails (`.po-editable-table-structure-button`)
    /// and the expansion corner (`.csv-table-editor__resize-control`), shown
    /// while the table is hovered.
    pub(super) fn structure_controls(&self, group: &'static str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let t = &self.theme;
        let (tx, ty) = self.table_origin();
        let (tw, th) = self.table_size();
        let g = t.table.action_gutter;
        let (add_row, add_column) = (cx.entity().downgrade(), cx.entity().downgrade());
        let mut out = controls::rails(
            &t.table,
            "csv",
            group.into(),
            Draw::rect(tx, ty, tw, th),
            Rc::new(move |window, cx| {
                let _ = add_row.update(cx, |this, cx| this.add_row(window, cx));
            }),
            Rc::new(move |window, cx| {
                let _ = add_column.update(cx, |this, cx| this.add_column(window, cx));
            }),
        );
        let (hover_bg, hover_border, hover_color) = (t.table.structure_hover_background, t.table.structure_hover_border, t.table.structure_hover_color);
        let corner_visual = 15.;
        // `.is-resizing` / `[aria-expanded]` keep the corner revealed and lit.
        let active = self.expansion.drag.is_some_and(|d| d.moved) || self.expansion.picker.is_some();
        let corner = div()
            .id("csv-resize-handle")
            .group("csv-resize-handle")
            .absolute()
            .left(px(tx + tw))
            .top(px(ty + th))
            .w(px(g))
            .h(px(g))
            .cursor(CursorStyle::ResizeUpLeftDownRight)
            .opacity(if active { 1. } else { 0. })
            .group_hover(group, |s| s.opacity(1.))
            .tooltip(crate::ui::components::tooltip(t_("editor.csv.expandTableHint")))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, e: &MouseDownEvent, window, cx| {
                    cx.stop_propagation();
                    this.start_expand(e.position, window, cx);
                }),
            )
            .child(
                div()
                    .absolute()
                    .left(px((g - corner_visual) / 2.))
                    .top(px((g - corner_visual) / 2.))
                    .w(px(corner_visual))
                    .h(px(corner_visual))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(7.))
                    .border_1()
                    .border_color(Rgba::default())
                    .bg(if active { hover_bg } else { t.table.structure_background })
                    .when(active, |s| s.border_color(hover_border))
                    .group_hover("csv-resize-handle", move |s| s.bg(hover_bg).border_color(hover_border))
                    .child(svg().path("icons/arrow-down-right.svg").size(px(12.)).text_color(if active { hover_color } else { Rgba::default() }).group_hover("csv-resize-handle", move |s| s.text_color(hover_color))),
            );
        out.push(corner.into_any_element());
        out
    }
}
