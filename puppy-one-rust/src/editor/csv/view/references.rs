//! Reference cells (CsvCellEditor.tsx, csv-table-editor.css): a value that is
//! wholly a link shows its label instead of the raw text while the cell is
//! not being edited. External links are underlined buttons that open on
//! click; workspace links show their label, a link action on hover (unlink
//! when missing) and a source preview below the cell. ⌘-click in the cell
//! opens it too.
use super::*;
use crate::{
    editor::{
        navigation::{self, Reference, Resolution, Status},
        table::paint,
    },
    theme::Theme,
};

/// `padding-inline-end: 29px` of a workspace reference's input.
pub(super) const WORKSPACE_END_PADDING: f32 = 29.;

pub(super) type Resolver = Rc<dyn Fn(&str) -> Option<Resolution>>;

/// Reference cells' state: the host's workspace resolver, references by
/// cell value, and the external label under the pointer.
#[derive(Default)]
pub(super) struct ReferenceCells {
    pub(super) resolver: Option<Resolver>,
    pub(super) cache: std::cell::RefCell<std::collections::HashMap<String, Option<Reference>>>,
    pub(super) hovered_label: Option<(usize, usize)>,
}

impl CsvEditor {
    #[cfg(test)]
    pub(crate) fn activate_reference(
        &mut self,
        row: usize,
        column: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        self.press_reference(
            row,
            column,
            0.,
            Modifiers {
                platform: true,
                ..Default::default()
            },
            window,
            cx,
        )
    }
    /// Resolve workspace targets through the host (`resolveWorkspaceReference`).
    pub fn set_reference_resolver(&mut self, resolver: Option<Resolver>, cx: &mut Context<Self>) {
        self.refs.resolver = resolver;
        self.refs.cache.borrow_mut().clear();
        cx.notify();
    }

    /// The reference a cell's value is, if any (cached by value).
    pub(crate) fn reference(&self, row: usize, column: usize) -> Option<Reference> {
        let value = self.model.rows().get(row)?.cells.get(column)?;
        if value.is_empty() {
            return None;
        }
        if let Some(found) = self.refs.cache.borrow().get(value) {
            return found.clone();
        }
        let resolver = self.refs.resolver.clone();
        let found = navigation::resolve(
            value,
            resolver
                .as_ref()
                .map(|r| r.as_ref() as &dyn Fn(&str) -> Option<Resolution>),
        );
        let mut cache = self.refs.cache.borrow_mut();
        if cache.len() > 4096 {
            cache.clear();
        }
        cache.insert(value.clone(), found.clone());
        found
    }

    /// Workspace references keep room for their action in the editor.
    pub(super) fn end_padding(&self, row: usize, column: usize) -> f32 {
        match self.reference(row, column) {
            Some(Reference::Workspace { .. }) => WORKSPACE_END_PADDING,
            _ => self.theme.table.cell_padding.right,
        }
    }

    /// The label's line: `line-height: inherit` (the table's) centred in the
    /// cell's content box, from the cell's inline-start padding.
    fn label_line(&self, row: usize) -> (TextStyle, f32) {
        let style = self.style(row).clone();
        let content = self.theme.table.row_min_height - self.cell_bottom_border(row);
        let top = (content - style.line_height_px()) / 2.;
        (style, top)
    }

    /// Paint a reference cell's label in place of its value; false for
    /// values that are not (admitted) references.
    pub(super) fn draw_reference(&self, row: usize, column: usize, out: &mut Vec<Draw>) -> bool {
        let reference = match self.reference(row, column) {
            Some(r @ (Reference::External { .. } | Reference::Workspace { .. })) => r,
            _ => return false,
        };
        let t = &self.theme;
        let (x, y, w) = (
            self.column_x(column),
            self.row_top(row),
            self.column_width(column),
        );
        let content_w = w - self.cell_end_border(column);
        let content_h = t.table.row_min_height - self.cell_bottom_border(row);
        let (base, top) = self.label_line(row);
        let p = t.table.cell_padding;
        let hovered = self.gestures.hover
            == Hover {
                row: Some(row),
                column: Some(column),
            }
            && self.refs.hovered_label == Some((row, column));
        let (color, end) = match &reference {
            // `.csv-table-editor__external-reference`: max-content, at most
            // the cell less 20px.
            Reference::External { .. } => (t.link, content_w - p.left - (content_w - 20.).max(0.)),
            _ => (t.link, WORKSPACE_END_PADDING),
        };
        let underline = Rgba {
            a: color.a * if hovered { 1. } else { 0.42 },
            ..color
        };
        let style = TextStyle { color, ..base };
        let clip = Draw::rect(x + p.left, y, (content_w - p.left - end).max(0.), content_h);
        out.push(Draw::Text {
            text: reference.label().to_owned().into(),
            style,
            x: x + p.left,
            line_top: y + top,
            center: None,
            clip,
            ellipsis: true,
            underline: Some(underline),
        });
        true
    }

    /// The external label's extent in content x (its button).
    fn external_label_span(
        &self,
        row: usize,
        column: usize,
        label: &str,
        window: &Window,
    ) -> (f32, f32) {
        let (style, _) = self.label_line(row);
        let width = f32::from(paint::shape(window, label.to_owned().into(), &style).width());
        let left = self.column_x(column) + self.theme.table.cell_padding.left;
        let max = (self.column_width(column) - self.cell_end_border(column) - 20.).max(0.);
        (left, left + width.min(max))
    }

    /// A press on a reference: the external label opens it (and does not
    /// focus the cell); ⌘-click opens any openable reference. Returns
    /// whether the press was consumed.
    pub(super) fn press_reference(
        &mut self,
        row: usize,
        column: usize,
        x: f32,
        modifiers: Modifiers,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(reference) = self.reference(row, column) else {
            return false;
        };
        let editing = self
            .cell
            .as_ref()
            .is_some_and(|c| c.row == row && c.column == column);
        let on_label = match &reference {
            Reference::External { label, .. } if !editing => {
                let (from, to) = self.external_label_span(row, column, label, window);
                x >= from && x < to
            }
            _ => false,
        };
        let command = modifiers.platform && !modifiers.alt && !modifiers.shift;
        if (on_label || command) && navigation::can_open(&reference) {
            self.open_reference(&reference, cx);
            return true;
        }
        false
    }

    pub(super) fn open_reference(&mut self, reference: &Reference, cx: &mut Context<Self>) {
        match reference {
            Reference::External { href, .. } => cx.open_url(href),
            Reference::Workspace { candidates, .. } if navigation::can_open(reference) => {
                cx.emit(CsvEvent::OpenReference(candidates.clone()))
            }
            _ => {}
        }
    }

    /// Track whether the pointer is over an external label (its hover
    /// underline and pointer cursor).
    pub(super) fn hover_label(&mut self, x: f32, window: &Window, cx: &mut Context<Self>) {
        let over = match (self.gestures.hover.row, self.gestures.hover.column) {
            (Some(row), Some(column)) => match self.reference(row, column) {
                Some(Reference::External { label, .. })
                    if !self
                        .cell
                        .as_ref()
                        .is_some_and(|c| c.row == row && c.column == column) =>
                {
                    let (from, to) = self.external_label_span(row, column, &label, window);
                    (x >= from && x < to).then_some((row, column))
                }
                _ => None,
            },
            _ => None,
        };
        if over != self.refs.hovered_label {
            self.refs.hovered_label = over;
            cx.notify();
        }
    }

    /// The hovered workspace reference's action (`.csv-table-editor__reference-action`)
    /// and source preview (`.csv-table-editor__reference-preview`).
    pub(super) fn reference_overlays(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let (Some(row), Some(column)) = (self.gestures.hover.row, self.gestures.hover.column)
        else {
            return Vec::new();
        };
        let Some(reference @ Reference::Workspace { .. }) = self.reference(row, column) else {
            return Vec::new();
        };
        let Reference::Workspace { raw, status, .. } = &reference else {
            return Vec::new();
        };
        let t = &self.theme;
        let app = Theme::new(t.dark);
        let (x, y, w) = (
            self.column_x(column),
            self.row_top(row),
            self.column_width(column),
        );
        let content_w = w - self.cell_end_border(column);
        let content_h = t.table.row_min_height - self.cell_bottom_border(row);
        let openable = navigation::can_open(&reference);
        let link = t.link;
        let (icon, color) = if *status != Status::Missing {
            ("link-2", crate::theme::mix(link, t.text_muted, 0.76))
        } else {
            ("unlink", t.text_muted)
        };
        let opened = reference.clone();
        let action = div()
            .id("csv-reference-action")
            .group("csv-reference-action")
            .absolute()
            .left(px(x + content_w - 4. - 22.))
            .top(px(y + content_h / 2. - 11.))
            .size(px(22.))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(5.))
            .when(!openable, |d| d.opacity(0.62))
            .when(openable, |d| {
                d.cursor(crate::theme::clickable_cursor())
                    .hover(move |s| {
                        s.bg(Rgba {
                            a: link.a * 0.12,
                            ..link
                        })
                    })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        cx.stop_propagation();
                        this.open_reference(&opened, cx);
                    }))
            })
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .tooltip(crate::ui::components::tooltip(if openable {
                crate::localization::tf(
                    "editor.csv.reference.open",
                    &[(
                        "target",
                        crate::localization::Arg::Text(raw.trim().to_owned()),
                    )],
                )
            } else {
                crate::localization::tf(
                    "editor.csv.reference.unavailable",
                    &[(
                        "target",
                        crate::localization::Arg::Text(raw.trim().to_owned()),
                    )],
                )
            }))
            .child(
                svg()
                    .path(format!("icons/{icon}.svg"))
                    .size(px(13.))
                    .text_color(color)
                    .when(openable, |s| {
                        s.group_hover("csv-reference-action", move |s| s.text_color(link))
                    }),
            );
        // The preview: kind and raw source, 5px below the cell.
        let kind_style = TextStyle {
            size: 11.,
            weight: 600.,
            italic: false,
            mono: false,
            color: t.text_muted,
            tabular: false,
            line_height: LineHeight::Factor(1.2),
        };
        let source_style = TextStyle {
            size: 11.,
            weight: 400.,
            italic: false,
            mono: true,
            color: app.text,
            tabular: false,
            line_height: LineHeight::Factor(1.35),
        };
        let text = |style: &TextStyle| {
            let mut d = div().whitespace_nowrap().overflow_hidden().text_ellipsis();
            style.apply(d.style());
            d
        };
        let preview = div()
            .absolute()
            .left(px(x + 4.))
            .top(px(y + t.table.row_min_height + 5.))
            .max_w(px(360.))
            .flex()
            .flex_col()
            .gap(px(3.))
            .px(px(9.))
            .py(px(7.))
            .border_1()
            .border_color(crate::theme::mix(app.divider, app.muted, 0.82))
            .rounded(px(7.))
            .bg(crate::theme::mix(app.panel, app.control, 0.96))
            .shadow(vec![BoxShadow {
                color: crate::theme::alpha(app.shadow, 0.2).into(),
                offset: point(px(0.), px(5.)),
                blur_radius: px(18.),
                spread_radius: px(0.),
                inset: false,
            }])
            .child(text(&kind_style).child(t_("editor.csv.reference.workspace")))
            .child(text(&source_style).child(raw.clone()));
        vec![action.into_any_element(), preview.into_any_element()]
    }
}

use crate::localization::t as t_;
