//! Pointer selection (click, shift-click, double/triple click, drag by
//! granularity) and wheel scrolling. Hotspots handle their own presses.
use super::editor::{Drag, EditorView, Granularity};
use crate::editor::text::{selection::Selection, state::Transaction, words};
use gpui::*;

pub(super) struct LinkPress {
    activation: super::extension::LinkActivation,
    position: Point<Pixels>,
    revision: u64,
    anchor: usize,
}

impl EditorView {
    fn link_for(
        &mut self,
        position: Point<Pixels>,
        release: bool,
    ) -> Option<super::extension::LinkActivation> {
        let layout = self.layout.as_ref()?;
        if layout.revision != self.state.revision || !layout.bounds.contains(&position) {
            return None;
        }
        let point = layout.to_layout(position, self.scroll_y);
        let (offset, _) = layout.offset_at(point);
        // Nearest-caret hit testing can return the label's end or clamp empty
        // margin to its start. Require an actual label box under the pointer.
        for offset in [offset, self.state.doc.clamp(offset.saturating_sub(1))] {
            if let Some(link) = self.extension.link_at(&self.state, offset, release)
                && layout
                    .range_boxes(link.label.clone())
                    .iter()
                    .any(|bounds| bounds.contains(&point))
            {
                return Some(link);
            }
        }
        None
    }
    fn offset_for(&self, position: Point<Pixels>) -> Option<(usize, bool)> {
        let layout = self.layout.as_ref()?;
        Some(layout.offset_at(layout.to_layout(position, self.scroll_y)))
    }

    pub(super) fn mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus.focus(window, cx);
        if event.button != MouseButton::Left {
            return;
        }
        let Some((offset, upstream)) = self.offset_for(event.position) else {
            return;
        };
        self.link_press = None;
        if event.click_count == 1
            && self.state.selection.is_empty()
            && !self.composing()
            && !self.read_only()
        {
            self.link_press = self
                .link_for(event.position, false)
                .map(|activation| LinkPress {
                    activation,
                    position: event.position,
                    revision: self.state.revision,
                    anchor: self.state.selection.anchor,
                });
        }
        let text = self.state.doc.as_str();
        let granularity = match event.click_count {
            2 => {
                let r = words::group_at(text, offset);
                Granularity::Word(r.start, r.end)
            }
            n if n >= 3 => {
                let line = self.state.doc.line_index(offset);
                let r = self.state.doc.line_range(line);
                let end = if line + 1 < self.state.doc.line_count() {
                    r.end + 1
                } else {
                    r.end
                };
                Granularity::Line(r.start, end)
            }
            _ => Granularity::Char,
        };
        let selection = match granularity {
            Granularity::Char if event.modifiers.shift => {
                Selection::range(self.state.selection.anchor, offset)
            }
            Granularity::Char => Selection {
                upstream,
                ..Selection::cursor(offset)
            },
            Granularity::Word(a, b) | Granularity::Line(a, b) => Selection::range(a, b),
        };
        let anchor = if event.modifiers.shift {
            self.state.selection.anchor
        } else {
            selection.anchor
        };
        self.drag = Some(Drag {
            anchor,
            granularity,
        });
        self.dispatch(Transaction::select(selection), cx);
    }

    pub(super) fn mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.link_press.as_ref().is_some_and(|press| {
            (press.position.x - event.position.x).abs() > px(4.)
                || (press.position.y - event.position.y).abs() > px(4.)
                || event.pressed_button != Some(MouseButton::Left)
        }) {
            self.link_press = None;
        }
        let Some(drag) = self.drag else { return };
        if event.pressed_button != Some(MouseButton::Left) {
            return;
        }
        let Some((offset, upstream)) = self.offset_for(event.position) else {
            return;
        };
        let selection = match drag.granularity {
            Granularity::Char => Selection {
                upstream,
                ..Selection::range(drag.anchor, offset)
            },
            Granularity::Word(a, b) | Granularity::Line(a, b) => {
                let text = self.state.doc.as_str();
                let unit = match drag.granularity {
                    Granularity::Word(..) => words::group_at(text, offset),
                    _ => {
                        let r = self.state.doc.line_range(self.state.doc.line_index(offset));
                        r.start..(r.end + 1).min(text.len())
                    }
                };
                if offset < a {
                    Selection::range(b, unit.start)
                } else {
                    Selection::range(a, unit.end.max(b))
                }
            }
        };
        if selection != self.state.selection {
            let mut tr = Transaction::select(selection);
            tr.scroll_into_view = true;
            self.dispatch(tr, cx);
        }
    }

    pub(super) fn mouse_up(
        &mut self,
        event: &MouseUpEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if event.button != MouseButton::Left {
            return;
        }
        if let Some(press) = self.link_press.take()
            && press.revision == self.state.revision
            && self.state.selection.is_empty()
            && !self.composing()
            && !self.read_only()
            && (press.position.x - event.position.x).abs() <= px(4.)
            && (press.position.y - event.position.y).abs() <= px(4.)
            && let Some(release) = self.link_for(event.position, true)
            && release.key == press.activation.key
        {
            use super::extension::LinkAction;
            // Navigation is a selection-only action: no dirty event/history entry.
            let position = if let LinkAction::Position(position) = release.action {
                position
            } else {
                press.anchor
            };
            let mut transaction = Transaction::select(Selection::cursor(position));
            transaction.scroll_into_view = matches!(release.action, LinkAction::Position(_));
            self.dispatch(transaction, cx);
            match release.action {
                LinkAction::Workspace(paths) => {
                    cx.emit(super::editor::EditorEvent::OpenPaths(paths))
                }
                LinkAction::External(href) => cx.open_url(&href),
                LinkAction::Position(_) => {}
            }
        }
        if self.drag.take().is_some() {
            // Releasing the pointer lets formats reconcile reveal state.
            let (state, focused) = (&self.state, true);
            self.extension.selection_changed(state, focused, false);
            cx.notify();
        }
    }

    pub(super) fn scroll_wheel(
        &mut self,
        event: &ScrollWheelEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let line = self
            .layout
            .as_ref()
            .and_then(|l| l.leaves.first())
            .map_or(px(20.), |l| px(l.entry.style.line_height_px()));
        let delta = event.delta.pixel_delta(line);
        self.scroll_by(-f32::from(delta.y), window, cx);
    }

    pub(super) fn scroll_by(&mut self, dy: f32, _: &mut Window, cx: &mut Context<Self>) {
        let max = self.max_scroll();
        let next = (self.scroll_y + dy).clamp(0., max);
        if next != self.scroll_y {
            self.scroll_y = next;
            cx.notify();
        }
    }

    pub(super) fn max_scroll(&self) -> f32 {
        self.layout.as_ref().map_or(0., |l| l.max_scroll())
    }
}
