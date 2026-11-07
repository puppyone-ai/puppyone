//! What the view takes from the person: keys, paste and IME text, the
//! pointer's selection, links and mouse reporting, the wheel, and copying.
use super::*;

impl TerminalView {
    pub(super) fn input(&mut self, bytes: Vec<u8>, cx: &mut Context<Self>) {
        self.selection = None;
        self.selecting = false;
        self.restart_blink(cx);
        self.parser.set_scrollback(0);
        if let Err(e) = self.terminal.input(bytes) {
            self.failure = Some(e);
        }
        cx.notify();
    }
    pub(super) fn copy(&self, cx: &mut Context<Self>) {
        let selected = self.selection.map(|s| s.text(self.parser.screen()));
        let text = selected
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| self.parser.screen().contents());
        cx.write_to_clipboard(ClipboardItem::new_string(text));
    }
    pub(super) fn select_all(&mut self, cx: &mut Context<Self>) {
        let (rows, cols) = self.parser.screen().size();
        self.selection = Some(Selection {
            anchor: CellPoint::default(),
            head: CellPoint {
                row: rows - 1,
                col: cols,
            },
        });
        cx.notify();
    }
    pub(super) fn cell_at(&self, position: Point<Pixels>, boundary: bool) -> CellPoint {
        let p = position - self.bounds.origin;
        let (rows, cols) = self.parser.screen().size();
        CellPoint {
            row: ((f32::from(p.y) - PAD_TOP) / self.grid.cell_h)
                .floor()
                .clamp(0., f32::from(rows - 1)) as u16,
            col: ((f32::from(p.x) - PAD_LEFT) / self.grid.cell_w + if boundary { 0.5 } else { 0. })
                .floor()
                .clamp(0., f32::from(if boundary { cols } else { cols - 1 }))
                as u16,
        }
    }
    pub(super) fn send_mouse(
        &mut self,
        action: MouseAction,
        point: CellPoint,
        m: Modifiers,
        cx: &mut Context<Self>,
    ) {
        if let Some(bytes) = interaction::mouse_report(
            self.parser.screen(),
            action,
            point,
            MouseModifiers {
                shift: m.shift,
                alt: m.alt,
                control: m.control,
            },
        ) {
            self.input(bytes, cx);
        }
    }
    pub(super) fn mouse_down(
        &mut self,
        e: &MouseDownEvent,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus.focus(w, cx);
        if e.button == MouseButton::Left && self.in_lane(e.position) {
            // The scrollbar: grab the thumb, or centre it on the pointer and
            // keep dragging (the scrollable element's track press).
            let y = f32::from(e.position.y);
            if let Some((top, length)) = self.thumb_rect() {
                let offset = if (top..top + length).contains(&y) {
                    y - top
                } else {
                    self.drag_thumb(y - length / 2.);
                    length / 2.
                };
                self.thumb_drag = Some(offset);
                self.mark_scrolled(cx);
            }
            cx.notify();
            cx.stop_propagation();
            return;
        }
        let cell = self.cell_at(e.position, false);
        let captured = !e.modifiers.shift
            && self.parser.screen().scrollback() == 0
            && self.parser.screen().mouse_protocol_mode() != vt100::MouseProtocolMode::None;
        self.pressed_link = (e.button == MouseButton::Left && !captured)
            .then(|| interaction::link_at(self.parser.screen(), cell))
            .flatten();
        if e.button == MouseButton::Left && e.modifiers.platform {
            if let Some(link) = interaction::link_at(self.parser.screen(), cell) {
                self.pressed_link = None;
                cx.open_url(&link.url);
            }
        } else if !e.modifiers.shift
            && self.parser.screen().scrollback() == 0
            && self.parser.screen().mouse_protocol_mode() != vt100::MouseProtocolMode::None
        {
            if let Some(button) = mouse_button(e.button) {
                self.mouse_button = Some(button);
                self.last_mouse = Some(cell);
                self.send_mouse(MouseAction::Press(button), cell, e.modifiers, cx);
            }
        } else if e.button == MouseButton::Left {
            let point = self.cell_at(e.position, true);
            self.selection = Some(match e.click_count {
                2 => Selection::word(self.parser.screen(), cell),
                3.. => Selection {
                    anchor: CellPoint {
                        row: cell.row,
                        col: 0,
                    },
                    head: CellPoint {
                        row: cell.row,
                        col: self.parser.screen().size().1,
                    },
                },
                _ => Selection {
                    anchor: point,
                    head: point,
                },
            });
            self.selecting = e.click_count < 2;
        }
        cx.notify();
        cx.stop_propagation();
    }
    pub(super) fn mouse_up(&mut self, e: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if e.button == MouseButton::Left && self.thumb_drag.take().is_some() {
            self.mark_scrolled(cx);
            cx.notify();
            return;
        }
        // `WebLinksAddon`: a click that starts and ends on the same link
        // opens it, unless it became a selection.
        if e.button == MouseButton::Left
            && let Some(link) = self.pressed_link.take()
        {
            let cell = self.cell_at(e.position, false);
            let selected = self
                .selection
                .is_some_and(|s| !s.text(self.parser.screen()).is_empty());
            if link.contains(cell.row, cell.col) && !selected {
                self.selection = None;
                self.selecting = false;
                cx.open_url(&link.url);
                cx.notify();
                return;
            }
        }
        if self.mouse_button == mouse_button(e.button)
            && let Some(button) = self.mouse_button.take()
        {
            self.send_mouse(
                MouseAction::Release(button),
                self.cell_at(e.position, false),
                e.modifiers,
                cx,
            );
        }
        if e.button == MouseButton::Left {
            self.selecting = false;
        }
        cx.notify();
    }
    pub(super) fn mouse_move(
        &mut self,
        e: &MouseMoveEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(offset) = self.thumb_drag {
            self.drag_thumb(f32::from(e.position.y) - offset);
            self.scrolled_at = Some(Instant::now());
            cx.notify();
            return;
        }
        let over_thumb = self.in_lane(e.position)
            && self.thumb_rect().is_some_and(|(top, length)| {
                (top..top + length).contains(&f32::from(e.position.y))
            });
        if over_thumb != self.thumb_hover {
            self.thumb_hover = over_thumb;
            cx.notify();
        }
        if self.selecting && e.dragging() {
            let head = self.cell_at(e.position, true);
            if let Some(selection) = self.selection.as_mut() {
                selection.head = head;
            }
            cx.notify();
        } else if !e.dragging() {
            self.selecting = false;
        }
        let point = self.cell_at(e.position, false);
        if self.last_mouse == Some(point) {
            return;
        }
        self.last_mouse = Some(point);
        self.hover_link = interaction::link_at(self.parser.screen(), point);
        if !self.selecting && !e.modifiers.shift && self.parser.screen().scrollback() == 0 {
            // A drag that began outside this surface is not an application mouse press.
            self.send_mouse(MouseAction::Move(self.mouse_button), point, e.modifiers, cx);
        }
        cx.notify();
    }
    pub(super) fn scroll(&mut self, e: &ScrollWheelEvent, _: &mut Window, cx: &mut Context<Self>) {
        let cell_h = self.grid.cell_h;
        self.scroll_pixels += f32::from(e.delta.pixel_delta(px(cell_h)).y);
        let steps = (self.scroll_pixels / cell_h).trunc().clamp(-50., 50.) as i32;
        self.scroll_pixels -= steps as f32 * cell_h;
        if steps != 0 {
            self.selection = None;
            self.selecting = false;
            self.hover_link = None;
            self.last_mouse = None;
            if !e.modifiers.shift
                && self.parser.screen().scrollback() == 0
                && self.parser.screen().mouse_protocol_mode() != vt100::MouseProtocolMode::None
            {
                let point = self.cell_at(e.position, false);
                for _ in 0..steps.unsigned_abs() {
                    self.send_mouse(MouseAction::Wheel(steps > 0), point, e.modifiers, cx);
                }
            } else {
                let offset = self.parser.screen().scrollback() as i64;
                self.parser
                    .set_scrollback((offset + i64::from(steps)).max(0) as usize);
                if self.history > 0 {
                    self.mark_scrolled(cx);
                }
            }
            cx.notify();
        }
        cx.stop_propagation();
    }
    pub(super) fn paste(&mut self, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|c| c.text()) {
            let text = text.replace('\u{1b}', "");
            let bytes = if self.parser.screen().bracketed_paste() {
                format!("\x1b[200~{text}\x1b[201~").into_bytes()
            } else {
                text.into_bytes()
            };
            self.input(bytes, cx);
        }
    }
    pub(super) fn key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let key = &event.keystroke.key;
        let m = event.keystroke.modifiers;
        if m.platform {
            match key.as_str() {
                "v" => self.paste(cx),
                "c" => self.copy(cx),
                "a" => self.select_all(cx),
                _ => return,
            }
            cx.stop_propagation();
            return;
        }
        if !self.marked.is_empty() {
            return;
        }
        let bytes = interaction::key_bytes(
            key,
            MouseModifiers {
                shift: m.shift,
                alt: m.alt,
                control: m.control,
            },
            self.parser.screen().application_cursor(),
        );
        if let Some(bytes) = bytes {
            self.input(bytes, cx);
            cx.stop_propagation();
        }
    }
}
