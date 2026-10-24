//! Column resizing (`CsvColumnResizeLayer`): the rail on the hovered column's
//! end edge, pointer-captured drags, Escape to cancel, double-click to fit.
use super::*;

pub(super) use crate::editor::table::interaction::Resizing;
use crate::editor::table::controls::{self, ResizeHandlers};

impl CsvEditor {
    // --- column resizing ----------------------------------------------------------

    pub(super) fn start_resize(&mut self, column: usize, x: f32, cx: &mut Context<Self>) {
        self.gestures.resizing = Some(Resizing { column, start_x: x, start_width: self.layout.widths[column] });
        cx.notify();
    }

    pub(super) fn drag_resize(&mut self, x: f32, cx: &mut Context<Self>) {
        let Some(r) = self.gestures.resizing else { return };
        let width = r.width(x, COLUMN_MIN_WIDTH, MAX_WIDTH);
        if self.layout.set_width(r.column, width) {
            cx.notify();
        }
    }

    pub(super) fn end_resize(&mut self, cancel: bool, cx: &mut Context<Self>) {
        let Some(r) = self.gestures.resizing.take() else { return };
        if cancel {
            self.layout.set_width(r.column, r.start_width);
        } else {
            self.commit_widths();
        }
        cx.notify();
    }

    pub(super) fn auto_fit(&mut self, column: usize, cx: &mut Context<Self>) {
        self.layout.auto_fit(&self.model, column);
        self.commit_widths();
        cx.notify();
    }


    /// `.csv-table-editor__column-resize-handle`: a 9px rail centred on the
    /// hovered column's end edge over the table's height; its 1px accent line
    /// shows on hover and while resizing. Double-click auto-fits.
    pub(super) fn resize_rail(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let column = self.gestures.resizing.map(|r| r.column).or(self.gestures.resize_hover).filter(|c| *c < self.columns())?;
        let t = &self.theme;
        let (_, ty) = self.table_origin();
        let (_, th) = self.table_size();
        let edge = self.column_x(column) + self.column_width(column);
        let (press, fit) = (cx.entity().downgrade(), cx.entity().downgrade());
        let handlers = ResizeHandlers {
            press: Rc::new(move |x, _, cx| {
                let _ = press.update(cx, |this, cx| this.start_resize(column, x, cx));
            }),
            auto_fit: Rc::new(move |_, cx| {
                let _ = fit.update(cx, |this, cx| {
                    this.end_resize(false, cx);
                    this.auto_fit(column, cx);
                });
            }),
        };
        Some(controls::resize_rail(&t.table, "csv-column-resize".into(), edge, ty, th, self.gestures.resizing.is_some(), handlers))
    }
}
