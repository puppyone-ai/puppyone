//! GPUI paints the terminal grid. PTY and VT state survive hiding, resizing, and tab moves.
use super::terminal_activity::TerminalActivity;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::IconButton;
use crate::{
    localization::{t as tr, tf},
    platform::terminal::{Event, Terminal},
    theme::Theme,
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use std::{ops::Range, path::PathBuf, time::Instant};
#[path = "terminal_interaction.rs"]
mod interaction;
#[path = "terminal_queries.rs"]
mod terminal_queries;
use interaction::{CellPoint, MouseAction, MouseModifiers, Selection};
fn cell_width() -> f32 {
    crate::theme::font_size(13.) * (7.83 / 13.)
}
fn cell_height() -> f32 {
    crate::theme::font_size(13.) * (18. / 13.)
}
pub struct TerminalView {
    terminal: Terminal,
    parser: vt100::Parser,
    queries: terminal_queries::Queries,
    focus: FocusHandle,
    pub running: bool,
    error: Option<String>,
    marked: String,
    bounds: Bounds<Pixels>,
    selection: Option<Selection>,
    selecting: bool,
    mouse_button: Option<u8>,
    last_mouse: Option<CellPoint>,
    hover_link: Option<String>,
    scroll_pixels: f32,
    /// Agent CLI activity (`TerminalActivityController`), its pending idle
    /// timer and the last OSC title seen.
    activity: TerminalActivity,
    activity_timer: bool,
    title: String,
}
impl TerminalView {
    pub fn new(
        root: PathBuf,
        executable: Option<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let agent = executable.is_some();
        let (wake, rx) = Wake::channel();
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, _, cx| {
                        while let Ok(e) = s.terminal.events.try_recv() {
                            match e {
                                Event::Data(bytes) => {
                                    s.selection = None;
                                    s.selecting = false;
                                    s.hover_link = None;
                                    s.parser.process(&bytes);
                                    for reply in s.queries.process(&bytes, s.parser.screen()) {
                                        let _ = s.terminal.input(reply);
                                    }
                                    if s.activity.note_output(Instant::now(), bytes.len()) {
                                        s.watch_activity(cx);
                                    }
                                    if s.parser.screen().title() != s.title {
                                        s.title = s.parser.screen().title().to_owned();
                                        s.activity.note_title(&s.title);
                                    }
                                }
                                Event::Error(e) => {
                                    s.error = Some(e);
                                    s.running = false;
                                    s.activity.reset();
                                }
                                Event::Exit(code) => {
                                    s.activity.reset();
                                    s.error = Some(tf(
                                        "terminal.processExitedCode",
                                        &[("code", (code as i64).into())],
                                    ));
                                    s.running = false;
                                }
                            }
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        Self {
            terminal: Terminal::spawn(root, executable, wake),
            parser: vt100::Parser::new(24, 80, 5000),
            queries: terminal_queries::Queries::default(),
            focus: cx.focus_handle(),
            running: true,
            error: None,
            marked: String::new(),
            bounds: Bounds::default(),
            selection: None,
            selecting: false,
            mouse_button: None,
            last_mouse: None,
            hover_link: None,
            scroll_pixels: 0.,
            activity: TerminalActivity::new(agent),
            activity_timer: false,
            title: String::new(),
        }
    }
    /// Dev-capture: an Agent CLI whose title reports work.
    #[cfg(feature = "dev-capture")]
    pub fn lab_busy_agent(&mut self) {
        self.activity = TerminalActivity::new(true);
        self.activity.note_title("⠋ claude");
        self.running = true;
    }
    /// `TerminalSessionHeaderStatus`: an Agent CLI that is running and busy.
    pub fn agent_active(&self) -> bool {
        self.running && self.activity.active(Instant::now())
    }
    /// Re-render once the output signal lapses (`OUTPUT_IDLE_MS`).
    fn watch_activity(&mut self, cx: &mut Context<Self>) {
        if std::mem::replace(&mut self.activity_timer, true) {
            return;
        }
        cx.spawn(async move |this, cx| {
            loop {
                let Ok(deadline) = this.read_with(cx, |s, _| s.activity.output_deadline()) else {
                    return;
                };
                let now = Instant::now();
                match deadline {
                    Some(deadline) if deadline > now => {
                        cx.background_executor().timer(deadline - now).await;
                    }
                    _ => break,
                }
            }
            let _ = this.update(cx, |s, cx| {
                s.activity_timer = false;
                cx.notify();
            });
        })
        .detach();
    }
    fn input(&mut self, bytes: Vec<u8>, cx: &mut Context<Self>) {
        self.selection = None;
        self.selecting = false;
        self.parser.set_scrollback(0);
        if let Err(e) = self.terminal.input(bytes) {
            self.error = Some(e);
        }
        cx.notify();
    }
    fn copy(&self, cx: &mut Context<Self>) {
        let selected = self.selection.map(|s| s.text(self.parser.screen()));
        let text = selected
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| self.parser.screen().contents());
        cx.write_to_clipboard(ClipboardItem::new_string(text));
    }
    fn select_all(&mut self, cx: &mut Context<Self>) {
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
    fn cell_at(&self, position: Point<Pixels>, boundary: bool) -> CellPoint {
        let p = position - self.bounds.origin;
        let (rows, cols) = self.parser.screen().size();
        CellPoint {
            row: ((f32::from(p.y) - 4.) / cell_height())
                .floor()
                .clamp(0., f32::from(rows - 1)) as u16,
            col: ((f32::from(p.x) - 6.) / cell_width() + if boundary { 0.5 } else { 0. })
                .floor()
                .clamp(0., f32::from(if boundary { cols } else { cols - 1 }))
                as u16,
        }
    }
    fn send_mouse(
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
    fn mouse_down(&mut self, e: &MouseDownEvent, w: &mut Window, cx: &mut Context<Self>) {
        self.focus.focus(w, cx);
        let cell = self.cell_at(e.position, false);
        if e.button == MouseButton::Left && e.modifiers.platform {
            if let Some(url) = interaction::link_at(self.parser.screen(), cell) {
                cx.open_url(&url);
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
    fn mouse_up(&mut self, e: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
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
    fn mouse_move(&mut self, e: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
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
    fn scroll(&mut self, e: &ScrollWheelEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_pixels += f32::from(e.delta.pixel_delta(px(cell_height())).y);
        let steps = (self.scroll_pixels / cell_height())
            .trunc()
            .clamp(-50., 50.) as i32;
        self.scroll_pixels -= steps as f32 * cell_height();
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
            }
            cx.notify();
        }
        cx.stop_propagation();
    }
    fn paste(&mut self, cx: &mut Context<Self>) {
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
    fn key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
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
impl Focusable for TerminalView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for TerminalView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let entity = cx.entity();
        let paint_entity = entity.clone();
        v_flex()
            .size_full()
            .min_h_0()
            .bg(t.terminal_bg)
            .text_color(t.terminal_fg)
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::key))
            .on_action(cx.listener(|s, _: &crate::ui::input::Paste, _, cx| s.paste(cx)))
            .on_action(cx.listener(|s, _: &crate::ui::input::Copy, _, cx| s.copy(cx)))
            .on_action(cx.listener(|s, _: &crate::ui::input::SelectAll, _, cx| s.select_all(cx)))
            .on_action(|_: &crate::ui::input::Undo, _, _| {})
            .on_action(|_: &crate::ui::input::Redo, _, _| {})
            .child(
                h_flex()
                    .h(px(28.))
                    .flex_shrink_0()
                    .px(px(8.))
                    .text_size(px(crate::theme::font_size(10.)))
                    .text_color(t.muted)
                    .child(
                        div().flex_1().min_w_0().truncate().child(
                            self.error
                                .clone()
                                .or_else(|| {
                                    self.hover_link.as_ref().map(|url| {
                                        tf(
                                            "native.terminal.openLink",
                                            &[("url", url.clone().into())],
                                        )
                                    })
                                })
                                .unwrap_or_else(|| {
                                    format!(
                                        "{} · {}",
                                        tr("terminal.title"),
                                        tr("native.terminal.hint")
                                    )
                                }),
                        ),
                    )
                    .child(
                        IconButton::new("terminal-bottom", "arrow-down")
                            .label(tr("native.terminal.scrollBottom"))
                            .with_size(px(22.))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.parser.set_scrollback(0);
                                s.selection = None;
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .id("terminal-surface")
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
                    .on_mouse_down(MouseButton::Middle, cx.listener(Self::mouse_down))
                    .on_mouse_down(MouseButton::Right, cx.listener(Self::mouse_down))
                    .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
                    .on_mouse_up(MouseButton::Middle, cx.listener(Self::mouse_up))
                    .on_mouse_up(MouseButton::Right, cx.listener(Self::mouse_up))
                    .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
                    .on_mouse_up_out(MouseButton::Middle, cx.listener(Self::mouse_up))
                    .on_mouse_up_out(MouseButton::Right, cx.listener(Self::mouse_up))
                    .on_mouse_move(cx.listener(Self::mouse_move))
                    .on_scroll_wheel(cx.listener(Self::scroll))
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                entity.update(cx, |s, _| {
                                    s.bounds = bounds;
                                    let rows = ((f32::from(bounds.size.height) - 8.)
                                        / cell_height())
                                    .floor()
                                    .clamp(2., 160.)
                                        as u16;
                                    let cols = ((f32::from(bounds.size.width) - 12.) / cell_width())
                                        .floor()
                                        .clamp(8., 300.)
                                        as u16;
                                    if s.parser.screen().size() != (rows, cols) {
                                        s.activity.begin_presentation_refresh(Instant::now());
                                        s.selection = None;
                                        s.hover_link = None;
                                        s.parser.set_size(rows, cols);
                                        s.terminal.resize(rows, cols);
                                    }
                                });
                            },
                            move |bounds, _, window, cx| {
                                let s = paint_entity.read(cx);
                                let focus = s.focus.clone();
                                let screen = s.parser.screen().clone();
                                let marked = s.marked.clone();
                                let selection = s.selection;
                                window.handle_input(
                                    &focus,
                                    ElementInputHandler::new(bounds, paint_entity.clone()),
                                    cx,
                                );
                                let (rows, cols) = screen.size();
                                for r in 0..rows {
                                    let mut text = String::new();
                                    let mut runs = Vec::new();
                                    for c in 0..cols {
                                        let cell = screen.cell(r, c).unwrap();
                                        if cell.is_wide_continuation() {
                                            continue;
                                        }
                                        let value = if cell.contents().is_empty() {
                                            " ".into()
                                        } else {
                                            cell.contents()
                                        };
                                        let mut font = font("Menlo");
                                        if cell.bold() {
                                            font.weight = FontWeight::BOLD;
                                        }
                                        if cell.italic() {
                                            font.style = FontStyle::Italic;
                                        }
                                        let fg = color(&t, cell.fgcolor(), t.terminal_fg);
                                        let bg = color(&t, cell.bgcolor(), t.terminal_bg);
                                        let (fg, bg) =
                                            if cell.inverse() { (bg, fg) } else { (fg, bg) };
                                        let bg = if selection.is_some_and(|selection| {
                                            selection.contains(&screen, r, c)
                                        }) {
                                            t.selection
                                        } else {
                                            bg
                                        };
                                        runs.push(TextRun {
                                            len: value.len(),
                                            font,
                                            color: fg.into(),
                                            background_color: Some(bg.into()),
                                            underline: cell.underline().then_some(UnderlineStyle {
                                                thickness: px(1.),
                                                color: Some(fg.into()),
                                                wavy: false,
                                            }),
                                            strikethrough: None,
                                        });
                                        text.push_str(&value);
                                    }
                                    let line = window.text_system().shape_line(
                                        text.into(),
                                        px(crate::theme::font_size(13.)),
                                        &runs,
                                        None,
                                    );
                                    let _ = line.paint(
                                        bounds.origin
                                            + point(px(6.), px(4. + r as f32 * cell_height())),
                                        px(cell_height()),
                                        TextAlign::Left,
                                        None,
                                        window,
                                        cx,
                                    );
                                }
                                if focus.is_focused(window)
                                    && screen.scrollback() == 0
                                    && !screen.hide_cursor()
                                {
                                    let (r, c) = screen.cursor_position();
                                    let origin = bounds.origin
                                        + point(
                                            px(6. + c as f32 * cell_width()),
                                            px(4. + r as f32 * cell_height()),
                                        );
                                    window.paint_quad(fill(
                                        Bounds::new(
                                            origin,
                                            size(px(cell_width()), px(cell_height())),
                                        ),
                                        t.terminal_cursor,
                                    ));
                                    // xterm block cursor: the covered glyph is
                                    // redrawn in the background colour.
                                    if let Some(cell) = screen.cell(r, c)
                                        && !cell.contents().is_empty()
                                    {
                                        let value: SharedString = cell.contents().into();
                                        let mut font = font("Menlo");
                                        if cell.bold() {
                                            font.weight = FontWeight::BOLD;
                                        }
                                        let glyph = window.text_system().shape_line(
                                            value.clone(),
                                            px(crate::theme::font_size(13.)),
                                            &[TextRun {
                                                len: value.len(),
                                                font,
                                                color: t.terminal_bg.into(),
                                                background_color: None,
                                                underline: None,
                                                strikethrough: None,
                                            }],
                                            None,
                                        );
                                        let _ = glyph.paint(
                                            origin,
                                            px(cell_height()),
                                            TextAlign::Left,
                                            None,
                                            window,
                                            cx,
                                        );
                                    }
                                }
                                if !marked.is_empty() {
                                    let text = marked.clone();
                                    let line = window.text_system().shape_line(
                                        text.into(),
                                        px(crate::theme::font_size(13.)),
                                        &[TextRun {
                                            len: marked.len(),
                                            font: font("Menlo"),
                                            color: t.focus.into(),
                                            background_color: Some(t.terminal_bg.into()),
                                            underline: None,
                                            strikethrough: None,
                                        }],
                                        None,
                                    );
                                    let (r, c) = screen.cursor_position();
                                    let _ = line.paint(
                                        bounds.origin
                                            + point(
                                                px(6. + c as f32 * cell_width()),
                                                px(4. + r as f32 * cell_height()),
                                            ),
                                        px(cell_height()),
                                        TextAlign::Left,
                                        None,
                                        window,
                                        cx,
                                    );
                                }
                            },
                        )
                        .size_full(),
                    ),
            )
    }
}
fn mouse_button(button: MouseButton) -> Option<u8> {
    match button {
        MouseButton::Left => Some(0),
        MouseButton::Middle => Some(1),
        MouseButton::Right => Some(2),
        _ => None,
    }
}
fn color(t: &Theme, color: vt100::Color, default: Rgba) -> Rgba {
    match color {
        vt100::Color::Default => default,
        vt100::Color::Rgb(r, g, b) => Theme::true_color(r, g, b),
        vt100::Color::Idx(i) => t.ansi_index(i),
    }
}
impl EntityInputHandler for TerminalView {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        *actual = Some(range);
        Some(self.marked.clone())
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let n = self.marked.encode_utf16().count();
        Some(UTF16Selection {
            range: n..n,
            reversed: false,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        (!self.marked.is_empty()).then(|| 0..self.marked.encode_utf16().count())
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.marked.clear();
        cx.notify();
    }
    fn replace_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // Function-key text is the key itself, replayed as its escape
        // sequence through key dispatch, never bytes for the shell.
        if crate::ui::ime::intercept_function_key(text, window, cx) {
            return;
        }
        self.marked.clear();
        self.input(text.as_bytes().to_vec(), cx);
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if crate::ui::ime::intercept_function_key(text, window, cx) {
            return;
        }
        self.marked = text.into();
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        _: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let (r, c) = self.parser.screen().cursor_position();
        Some(Bounds::new(
            self.bounds.origin
                + point(
                    px(6. + c as f32 * cell_width()),
                    px(4. + r as f32 * cell_height()),
                ),
            size(px(cell_width()), px(cell_height())),
        ))
    }
    fn character_index_for_point(
        &mut self,
        _: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        Some(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn native_pointer_selection_copy_and_shift_override(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| TerminalView {
            terminal: Terminal::disconnected_for_test(),
            parser: vt100::Parser::new(24, 80, 10),
            queries: terminal_queries::Queries::default(),
            focus: cx.focus_handle(),
            running: false,
            error: None,
            marked: String::new(),
            bounds: Bounds::default(),
            selection: None,
            selecting: false,
            mouse_button: None,
            last_mouse: None,
            hover_link: None,
            scroll_pixels: 0.,
            activity: TerminalActivity::new(false),
            activity_timer: false,
            title: String::new(),
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        let origin = view.update(cx, |s, cx| {
            s.parser.process(b"hello world");
            cx.notify();
            s.bounds.origin
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        let start = origin + point(px(6.), px(12.));
        let end = start + point(px(5. * cell_width()), px(0.));
        cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::none());
        cx.simulate_mouse_move(end, MouseButton::Left, Modifiers::none());
        cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::none());
        cx.simulate_keystrokes("cmd-c");
        cx.update(|_, cx| {
            assert_eq!(
                cx.read_from_clipboard().and_then(|c| c.text()).as_deref(),
                Some("hello")
            )
        });
        view.update(cx, |s, cx| {
            s.parser.process(b"\x1b[?1002h\x1b[?1006h");
            cx.notify();
        });
        let shift = Modifiers {
            shift: true,
            ..Modifiers::none()
        };
        cx.simulate_mouse_down(end, MouseButton::Left, shift);
        cx.simulate_mouse_move(start, MouseButton::Left, shift);
        cx.simulate_mouse_up(start, MouseButton::Left, shift);
        view.update(cx, |s, _| {
            assert_eq!(s.selection.unwrap().text(s.parser.screen()), "hello");
            assert_eq!(s.mouse_button, None);
            assert!(!s.selecting);
            assert!(
                s.error.is_none(),
                "selection must not write to the disconnected PTY"
            );
        });
    }
}
