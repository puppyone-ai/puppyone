//! GPUI paints the terminal grid. PTY and VT state survive hiding, resizing, and tab moves.
use super::terminal_activity::TerminalActivity;
use crate::ui::appearance::ActiveAppearance;
use crate::{
    localization::{t as tr, tf},
    platform::terminal::{Event, Terminal},
    theme::Theme,
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use std::{
    ops::Range,
    path::PathBuf,
    time::{Duration, Instant},
};
#[path = "terminal_glyphs.rs"]
mod glyphs;
#[path = "terminal_interaction.rs"]
mod interaction;
#[path = "terminal_queries.rs"]
mod terminal_queries;
use interaction::{CellPoint, Link, MouseAction, MouseModifiers, Selection};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionStatus {
    Running,
    Exited,
    Error,
}
impl SessionStatus {
    pub fn label_key(self) -> &'static str {
        match self {
            Self::Running => "terminal.status.running",
            Self::Exited => "terminal.status.exited",
            Self::Error => "terminal.status.error",
        }
    }
}
/// `terminalPathLabel`: a session's tab title is its folder's name.
pub fn path_label(path: &std::path::Path) -> String {
    let value = path.to_string_lossy();
    let value = value.trim();
    if value.is_empty() {
        return "—".into();
    }
    let trimmed = value.trim_end_matches(['/', '\\']);
    let trimmed = if trimmed.is_empty() { value } else { trimmed };
    trimmed
        .split(['/', '\\'])
        .rfind(|s| !s.is_empty())
        .unwrap_or(trimmed)
        .to_owned()
}
/// `.desktop-terminal-session` padding: `14px 0 16px 16px`.
const PAD_TOP: f32 = 14.;
const PAD_LEFT: f32 = 16.;
const PAD_BOTTOM: f32 = 16.;
/// FitAddon keeps xterm's scrollbar width out of the columns.
const FIT_SCROLLBAR: f32 = 14.;
/// The scrollbar lane and its active thumb (`--po-scrollbar-size`,
/// `--po-scrollbar-thumb-active-size`, `--po-scrollbar-thumb-active-inset`);
/// at rest the thumb is transparent.
const SCROLLBAR_LANE: f32 = 12.;
const THUMB_WIDTH: f32 = 8.;
const THUMB_INSET: f32 = 2.;
/// The scrollable element's minimum slider length.
const THUMB_MIN: f32 = 20.;
/// `po-scrollbar-active` lingers this long after a scroll.
const SCROLLBAR_IDLE: Duration = Duration::from_millis(900);
/// `lineHeight`, `scrollback`, `fontWeight` and `fontWeightBold`
/// (terminalRuntime.ts).
const LINE_HEIGHT: f32 = 1.24;
const SCROLLBACK: usize = 6000;
const WEIGHT: FontWeight = FontWeight(450.);
/// xterm's cursor blink: the phase, and the idle time after which the
/// cursor stops blinking and stays shown.
const BLINK: Duration = Duration::from_millis(600);
const BLINK_IDLE: Duration = Duration::from_secs(5 * 60);

/// xterm's cell for the terminal font (WebGL renderer): the "W" advance
/// floored to device pixels, and the canvas font box — Blink rounds the
/// ascent and descent to whole pixels — rounded up to device pixels,
/// multiplied by the line height and floored.
#[derive(Clone)]
struct Grid {
    font: Font,
    size: f32,
    cell_w: f32,
    cell_h: f32,
    /// The glyph baseline below the cell top.
    baseline: f32,
}
impl Default for Grid {
    fn default() -> Self {
        let size = crate::theme::ty().right.terminal;
        let (cell_w, cell_h, baseline) =
            cell_metrics(size * 0.6, size.round(), (size * 0.25).round(), 2.);
        let mut font = font(crate::theme::MONO);
        font.weight = WEIGHT;
        Self {
            font,
            size,
            cell_w,
            cell_h,
            baseline,
        }
    }
}
impl Grid {
    fn measure(window: &Window, cx: &App) -> Self {
        let mut font = crate::ui::fonts::font(crate::typography::fonts::Role::Terminal, cx);
        font.weight = WEIGHT;
        let size = crate::theme::ty().right.terminal;
        let text = window.text_system();
        let id = text.resolve_font(&font);
        let advance = text
            .advance(id, px(size), 'W')
            .map(|a| f32::from(a.width))
            .unwrap_or(size * 0.6);
        let ascent = f32::from(text.ascent(id, px(size)));
        let descent = f32::from(text.descent(id, px(size))).abs();
        let (cell_w, cell_h, baseline) =
            cell_metrics(advance, ascent, descent, window.scale_factor());
        Self {
            font,
            size,
            cell_w,
            cell_h,
            baseline,
        }
    }
}
/// The cell width, height and baseline in pixels. The glyph box (Blink's
/// whole-pixel ascent plus descent) is centred in the cell on device
/// pixels, and glyphs stand on its ideographic baseline (the box bottom
/// less the descent at device size), as xterm's texture atlas draws them.
fn cell_metrics(advance: f32, ascent: f32, descent: f32, scale: f32) -> (f32, f32, f32) {
    let width = (advance * scale).floor().max(1.);
    let char_height = ((ascent.round() + descent.round()) * scale).ceil().max(1.);
    let height = (char_height * LINE_HEIGHT).floor().max(1.);
    let top = ((height - char_height) / 2.).round();
    let baseline = top + char_height - (descent * scale).round();
    (width / scale, height / scale, baseline / scale)
}
/// FitAddon: rows and columns that fit the session inside its padding.
fn fit(width: f32, height: f32, grid: &Grid) -> (u16, u16) {
    let rows = ((height - PAD_TOP - PAD_BOTTOM).max(0.) / grid.cell_h).floor();
    let cols = ((width - PAD_LEFT - FIT_SCROLLBAR).max(0.) / grid.cell_w).floor();
    (rows.clamp(1., 500.) as u16, cols.clamp(2., 1000.) as u16)
}
/// The vertical scrollbar over `lane` (top and height): the thumb's top
/// and length for `offset` lines above the bottom of `history`.
fn thumb(lane: (f32, f32), rows: u16, history: usize, offset: usize) -> Option<(f32, f32)> {
    if history == 0 {
        return None;
    }
    let (top, height) = lane;
    let ratio = f32::from(rows) / (f32::from(rows) + history as f32);
    let length = (ratio * height).round().max(THUMB_MIN).min(height);
    let position = (history - offset.min(history)) as f32 / history as f32;
    Some((top + position * (height - length), length))
}
/// The scrollback length (vt100 clamps an out-of-range offset to it).
fn history(parser: &mut vt100::Parser) -> usize {
    let at = parser.screen().scrollback();
    parser.set_scrollback(usize::MAX);
    let length = parser.screen().scrollback();
    parser.set_scrollback(at);
    length
}
/// `writeSystemLine`: product messages in xterm palette grey 244.
fn system_line(message: &str) -> Vec<u8> {
    format!("\x1b[38;5;244m{message}\x1b[0m\r\n").into_bytes()
}
pub struct TerminalView {
    terminal: Terminal,
    parser: vt100::Parser,
    queries: terminal_queries::Queries,
    focus: FocusHandle,
    pub running: bool,
    /// A launch or write failure, shown as a dismissible notice
    /// (`launchError`); exits are written into the grid instead.
    failure: Option<String>,
    marked: String,
    grid: Grid,
    /// Scrollback lines above the screen, and when the view last scrolled.
    history: usize,
    scrolled_at: Option<Instant>,
    scrollbar_timer: bool,
    hovered: bool,
    thumb_hover: bool,
    /// Pointer offset into the thumb while it is dragged.
    thumb_drag: Option<f32>,
    /// The link under a plain press, opened if the release lands on it.
    pressed_link: Option<Link>,
    /// Dev-capture output replayed after the first fit.
    #[cfg(feature = "dev-capture")]
    lab_output: Option<&'static [u8]>,
    focused: bool,
    /// xterm shows no cursor until the session is first focused or switches
    /// screens (`isCursorInitialized`).
    cursor_initialized: bool,
    /// The blink phase starts here (focus, input and output restart it).
    blink_since: Instant,
    blinking: bool,
    bounds: Bounds<Pixels>,
    selection: Option<Selection>,
    selecting: bool,
    mouse_button: Option<u8>,
    last_mouse: Option<CellPoint>,
    hover_link: Option<Link>,
    scroll_pixels: f32,
    /// Agent CLI activity (`TerminalActivityController`), its pending idle
    /// timer and the last OSC title seen.
    activity: TerminalActivity,
    activity_timer: bool,
    title: String,
    /// The shell hosting the session (`inputShell`), for path quoting.
    shell: String,
    /// `terminal.dropFailed` after a refused drop, until dismissed.
    drop_failed: bool,
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
                                    s.restart_blink(cx);
                                    let screen = s.parser.screen().alternate_screen();
                                    s.parser.process(&bytes);
                                    if s.parser.screen().alternate_screen() != screen {
                                        s.cursor_initialized = true;
                                    }
                                    let history = history(&mut s.parser);
                                    if history != s.history {
                                        s.history = history;
                                        s.mark_scrolled(cx);
                                    }
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
                                    s.parser.process(&system_line(&e));
                                    s.failure = Some(e);
                                    s.running = false;
                                    s.activity.reset();
                                }
                                Event::Exit(code) => {
                                    s.activity.reset();
                                    let text = tf(
                                        "terminal.processExitedCode",
                                        &[("code", (code as i64).into())],
                                    );
                                    s.parser.process(b"\r\n");
                                    s.parser.process(&system_line(&text));
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
        let terminal = Terminal::spawn(
            root,
            executable,
            wake,
            format!("window:{:?}", window.window_handle().window_id()),
        );
        let view = Self::assemble(terminal, agent, true, cx);
        cx.on_focus(&view.focus, window, |s, _, cx| {
            s.focused = true;
            s.cursor_initialized = true;
            s.restart_blink(cx);
        })
        .detach();
        cx.on_blur(&view.focus, window, |s, _, cx| {
            s.focused = false;
            cx.notify();
        })
        .detach();
        view
    }
    fn assemble(terminal: Terminal, agent: bool, running: bool, cx: &mut Context<Self>) -> Self {
        Self {
            terminal,
            parser: vt100::Parser::new(24, 80, SCROLLBACK),
            queries: terminal_queries::Queries::default(),
            focus: cx.focus_handle(),
            #[cfg(feature = "dev-capture")]
            lab_output: None,
            focused: false,
            cursor_initialized: false,
            blink_since: Instant::now(),
            blinking: false,
            running,
            failure: None,
            marked: String::new(),
            grid: Grid::default(),
            history: 0,
            scrolled_at: None,
            scrollbar_timer: false,
            hovered: false,
            thumb_hover: false,
            thumb_drag: None,
            pressed_link: None,
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
            // Agent CLIs run inside the same login shell host.
            shell: std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()),
            drop_failed: false,
        }
    }
    /// Show the cursor and blink from now while focused.
    fn restart_blink(&mut self, cx: &mut Context<Self>) {
        self.blink_since = Instant::now();
        if !self.focused || std::mem::replace(&mut self.blinking, true) {
            return;
        }
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(BLINK).await;
                let keep = this
                    .update(cx, |s, cx| {
                        cx.notify();
                        s.focused && s.blink_since.elapsed() < BLINK_IDLE
                    })
                    .unwrap_or(false);
                if !keep {
                    break;
                }
            }
            let _ = this.update(cx, |s, cx| {
                s.blinking = false;
                cx.notify();
            });
        })
        .detach();
    }
    fn cursor_shown(&self) -> bool {
        let elapsed = self.blink_since.elapsed();
        elapsed >= BLINK_IDLE || (elapsed.as_millis() / BLINK.as_millis()).is_multiple_of(2)
    }
    /// `markScrollbarActive`: the thumb shows, then fades after the idle
    /// delay.
    fn mark_scrolled(&mut self, cx: &mut Context<Self>) {
        self.scrolled_at = Some(Instant::now());
        if std::mem::replace(&mut self.scrollbar_timer, true) {
            return;
        }
        cx.spawn(async move |this, cx| {
            loop {
                let Ok(Some(at)) = this.read_with(cx, |s, _| s.scrolled_at) else {
                    break;
                };
                let deadline = at + SCROLLBAR_IDLE;
                let now = Instant::now();
                if deadline <= now {
                    break;
                }
                cx.background_executor().timer(deadline - now).await;
            }
            let _ = this.update(cx, |s, cx| {
                s.scrollbar_timer = false;
                cx.notify();
            });
        })
        .detach();
    }
    fn scrollbar_active(&self) -> bool {
        self.hovered
            || self.thumb_drag.is_some()
            || self
                .scrolled_at
                .is_some_and(|at| at.elapsed() < SCROLLBAR_IDLE)
    }
    /// The scrollbar lane: the session's right edge, inside the vertical
    /// padding.
    fn lane(&self) -> (f32, f32) {
        (
            f32::from(self.bounds.origin.y) + PAD_TOP,
            (f32::from(self.bounds.size.height) - PAD_TOP - PAD_BOTTOM).max(0.),
        )
    }
    fn in_lane(&self, position: Point<Pixels>) -> bool {
        self.history > 0
            && f32::from(position.x) >= f32::from(self.bounds.right()) - SCROLLBAR_LANE
            && self.bounds.contains(&position)
    }
    fn thumb_rect(&self) -> Option<(f32, f32)> {
        let rows = self.parser.screen().size().0;
        thumb(
            self.lane(),
            rows,
            self.history,
            self.parser.screen().scrollback(),
        )
    }
    /// Scroll so the thumb's top sits at `top`.
    fn drag_thumb(&mut self, top: f32) {
        let (lane_top, height) = self.lane();
        let Some((_, length)) = self.thumb_rect() else {
            return;
        };
        let travel = (height - length).max(1.);
        let position = ((top - lane_top) / travel).clamp(0., 1.);
        let offset = ((1. - position) * self.history as f32).round() as usize;
        self.parser.set_scrollback(offset);
        self.selection = None;
        self.hover_link = None;
    }
    /// `resolveTerminalDropPaths` + `quoteTerminalPaths`: dropped files and
    /// workspace entries become literal arguments at the prompt (no Enter).
    pub fn insert_paths(
        &mut self,
        paths: Option<Vec<PathBuf>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let quoted = paths
            .filter(|paths| !paths.is_empty() && self.running)
            .and_then(|paths| interaction::quote_paths(&paths, &self.shell).ok());
        match quoted {
            Some(text) => {
                self.drop_failed = false;
                self.input(text.into_bytes(), cx);
                self.focus.focus(window, cx);
            }
            None => {
                self.drop_failed = true;
                cx.notify();
            }
        }
    }
    /// Dev-capture: a shell session replaying `fixtures/terminal-session.ansi`
    /// (the product reference streams the same bytes) once the first fit
    /// has sized the grid, as a PTY's output would arrive.
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(cx: &mut Context<Self>) -> Self {
        let mut view = Self::assemble(Terminal::disconnected_for_test(), false, true, cx);
        view.lab_output = Some(include_bytes!("../../fixtures/terminal-session.ansi"));
        view
    }
    /// Dev-capture: an Agent CLI whose title reports work.
    #[cfg(feature = "dev-capture")]
    pub fn lab_busy_agent(&mut self) {
        self.activity = TerminalActivity::new(true);
        self.activity.note_title("⠋ claude");
        self.running = true;
    }
    /// The session status (`DesktopTerminalSessionStatus` past `starting`).
    pub fn status(&self) -> SessionStatus {
        match (self.running, self.failure.is_some()) {
            (true, _) => SessionStatus::Running,
            (false, true) => SessionStatus::Error,
            (false, false) => SessionStatus::Exited,
        }
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
        self.restart_blink(cx);
        self.parser.set_scrollback(0);
        if let Err(e) = self.terminal.input(bytes) {
            self.failure = Some(e);
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
            row: ((f32::from(p.y) - PAD_TOP) / self.grid.cell_h)
                .floor()
                .clamp(0., f32::from(rows - 1)) as u16,
            col: ((f32::from(p.x) - PAD_LEFT) / self.grid.cell_w + if boundary { 0.5 } else { 0. })
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
    fn mouse_up(&mut self, e: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
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
    fn mouse_move(&mut self, e: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
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
    fn scroll(&mut self, e: &ScrollWheelEvent, _: &mut Window, cx: &mut Context<Self>) {
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
impl TerminalView {
    /// `FloatingNoticeStack placement="top"` in the Right Sidebar meta role.
    fn notices(&self, cx: &mut Context<Self>) -> impl IntoElement {
        use crate::ui::components::{FloatingNotice, NoticePlacement, NoticeStack, NoticeTone};
        let ty = crate::theme::ty();
        let (size, line) = (ty.right.meta, ty.right.meta_line_height);
        let entity = cx.entity();
        let mut stack = NoticeStack::new(NoticePlacement::Top, 8., 12., 0.);
        if let Some(failure) = self.failure.clone() {
            let entity = entity.clone();
            stack = stack.child(
                FloatingNotice::new("terminal-launch-failed", failure)
                    .tone(NoticeTone::Danger)
                    .text(size, line)
                    .on_dismiss(move |_, cx| {
                        entity.update(cx, |s, cx| {
                            s.failure = None;
                            cx.notify();
                        })
                    }),
            );
        }
        if self.drop_failed {
            stack = stack.child(
                FloatingNotice::new("terminal-drop-failed", tr("terminal.dropFailed"))
                    .tone(NoticeTone::Danger)
                    .text(size, line)
                    .on_dismiss(move |_, cx| {
                        entity.update(cx, |s, cx| {
                            s.drop_failed = false;
                            cx.notify();
                        })
                    }),
            );
        }
        stack
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
            .relative()
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
                div()
                    .id("terminal-surface")
                    .relative()
                    .drag_over::<ExternalPaths>(move |s, _, _, _| {
                        s.bg(crate::theme::alpha(t.accent, 0.06))
                    })
                    .drag_over::<crate::ui::resource_drag::ResourceDrag>(move |s, _, _, _| {
                        s.bg(crate::theme::alpha(t.accent, 0.06))
                    })
                    .on_drop(cx.listener(|s, paths: &ExternalPaths, window, cx| {
                        s.insert_paths(Some(paths.paths().to_vec()), window, cx);
                        cx.stop_propagation();
                    }))
                    .on_drop(cx.listener(
                        |s, drag: &crate::ui::resource_drag::ResourceDrag, window, cx| {
                            s.insert_paths(drag.local_paths(), window, cx);
                            cx.stop_propagation();
                        },
                    ))
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .when(self.hover_link.is_some(), |d| d.cursor_pointer())
                    .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                        s.hovered = *hovered;
                        if !*hovered {
                            s.thumb_hover = false;
                        }
                        cx.notify();
                    }))
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
                            move |bounds, window, cx| {
                                let grid = Grid::measure(window, cx);
                                entity.update(cx, |s, _| {
                                    s.bounds = bounds;
                                    let (rows, cols) = fit(
                                        f32::from(bounds.size.width),
                                        f32::from(bounds.size.height),
                                        &grid,
                                    );
                                    s.grid = grid;
                                    if s.parser.screen().size() != (rows, cols) {
                                        s.activity.begin_presentation_refresh(Instant::now());
                                        s.selection = None;
                                        s.hover_link = None;
                                        s.parser.set_size(rows, cols);
                                        s.terminal.resize(rows, cols);
                                    }
                                    #[cfg(feature = "dev-capture")]
                                    if let Some(output) = s.lab_output.take() {
                                        s.parser.process(output);
                                        s.history = history(&mut s.parser);
                                    }
                                });
                            },
                            move |bounds, _, window, cx| {
                                let s = paint_entity.read(cx);
                                let focus = s.focus.clone();
                                let screen = s.parser.screen();
                                let marked = s.marked.clone();
                                let grid = s.grid.clone();
                                let scrollbar =
                                    s.scrollbar_active().then(|| s.thumb_rect()).flatten().map(
                                        |thumb| (thumb, s.thumb_hover || s.thumb_drag.is_some()),
                                    );
                                // xterm's canvas sits on whole device pixels, so
                                // every row and glyph does too.
                                let scale = window.scale_factor();
                                let snap = |v: Pixels| px((f32::from(v) * scale).round() / scale);
                                let origin = point(
                                    snap(bounds.origin.x) + px(PAD_LEFT),
                                    snap(bounds.origin.y) + px(PAD_TOP),
                                );
                                let (rows, cols) = screen.size();
                                let painted: Vec<Vec<CellPaint>> = (0..rows)
                                    .map(|r| {
                                        (0..cols)
                                            .filter_map(|c| {
                                                CellPaint::of(
                                                    &t,
                                                    &grid,
                                                    screen,
                                                    r,
                                                    c,
                                                    s.selection.is_some_and(|selection| {
                                                        selection.contains(screen, r, c)
                                                    }),
                                                    s.hover_link
                                                        .as_ref()
                                                        .is_some_and(|l| l.contains(r, c)),
                                                )
                                            })
                                            .collect()
                                    })
                                    .collect();
                                let (cursor_row, cursor_col) = screen.cursor_position();
                                let blink_shown = s.cursor_shown();
                                // xterm block cursor: the covered glyph is
                                // redrawn in the background colour.
                                let cursor = (s.cursor_initialized
                                    && screen.scrollback() == 0
                                    && !screen.hide_cursor())
                                .then(|| {
                                    CellPaint::of(
                                        &t, &grid, screen, cursor_row, cursor_col, false, false,
                                    )
                                    .map(|cell| CellPaint {
                                        fg: t.terminal_bg,
                                        bg: None,
                                        underline: false,
                                        ..cell
                                    })
                                });
                                window.handle_input(
                                    &focus,
                                    ElementInputHandler::new(bounds, paint_entity.clone()),
                                    cx,
                                );
                                for (r, cells) in painted.iter().enumerate() {
                                    paint_cells(
                                        window,
                                        &grid,
                                        origin + point(px(0.), px(r as f32 * grid.cell_h)),
                                        cells,
                                    );
                                }
                                if let Some(cursor) = cursor {
                                    let row =
                                        origin + point(px(0.), px(cursor_row as f32 * grid.cell_h));
                                    let block = Bounds::new(
                                        row + point(px(cursor_col as f32 * grid.cell_w), px(0.)),
                                        size(px(grid.cell_w), px(grid.cell_h)),
                                    );
                                    if !focus.is_focused(window) {
                                        // `cursorInactiveStyle: outline`.
                                        window.paint_quad(outline(
                                            block,
                                            t.terminal_cursor,
                                            BorderStyle::Solid,
                                        ));
                                    } else if blink_shown {
                                        window.paint_quad(fill(block, t.terminal_cursor));
                                        if let Some(cell) = cursor {
                                            paint_cells(window, &grid, row, &[cell]);
                                        }
                                    }
                                }
                                let (r, c) = (cursor_row, cursor_col);
                                if !marked.is_empty() {
                                    let text = marked.clone();
                                    let line = window.text_system().shape_line(
                                        text.into(),
                                        px(grid.size),
                                        &[TextRun {
                                            len: marked.len(),
                                            font: grid.font.clone(),
                                            color: t.focus.into(),
                                            background_color: Some(t.terminal_bg.into()),
                                            underline: None,
                                            strikethrough: None,
                                        }],
                                        None,
                                    );
                                    let _ = line.paint(
                                        origin
                                            + point(
                                                px(c as f32 * grid.cell_w),
                                                px(r as f32 * grid.cell_h),
                                            ),
                                        px(grid.cell_h),
                                        TextAlign::Left,
                                        None,
                                        window,
                                        cx,
                                    );
                                }
                                if let Some(((top, length), hot)) = scrollbar {
                                    window.paint_quad(
                                        fill(
                                            Bounds::new(
                                                point(
                                                    bounds.right() - px(THUMB_INSET + THUMB_WIDTH),
                                                    px(top),
                                                ),
                                                size(px(THUMB_WIDTH), px(length)),
                                            ),
                                            if hot {
                                                t.scrollbar_thumb_hover
                                            } else {
                                                t.scrollbar_thumb
                                            },
                                        )
                                        .corner_radii(px(THUMB_WIDTH / 2.)),
                                    );
                                }
                            },
                        )
                        .size_full(),
                    ),
            )
            .child(self.notices(cx))
    }
}
/// One visible cell of a row, ready to paint.
struct CellPaint {
    col: u16,
    /// Columns covered (wide characters take two).
    span: u16,
    text: String,
    font: Font,
    fg: Rgba,
    /// `None` is the terminal background (left unpainted).
    bg: Option<Rgba>,
    underline: bool,
}
impl CellPaint {
    #[allow(clippy::too_many_arguments)]
    fn of(
        t: &Theme,
        grid: &Grid,
        screen: &vt100::Screen,
        row: u16,
        col: u16,
        selected: bool,
        linked: bool,
    ) -> Option<Self> {
        let cell = screen.cell(row, col)?;
        if cell.is_wide_continuation() {
            return None;
        }
        let mut font = grid.font.clone();
        if cell.bold() {
            font.weight = FontWeight::BOLD;
        }
        if cell.italic() {
            font.style = FontStyle::Italic;
        }
        let fg = color(t, cell.fgcolor(), t.terminal_fg);
        let bg = color(t, cell.bgcolor(), t.terminal_bg);
        let (fg, bg) = if cell.inverse() { (bg, fg) } else { (fg, bg) };
        let bg = if selected { t.selection } else { bg };
        let text = cell.contents();
        Some(Self {
            col,
            span: if cell.is_wide() { 2 } else { 1 },
            text: if text.is_empty() { " ".into() } else { text },
            font,
            fg,
            bg: (bg != t.terminal_bg).then_some(bg),
            // The hovered link is underlined (`WebLinksAddon` decoration).
            underline: cell.underline() || linked,
        })
    }
}
/// xterm's renderer: backgrounds and decorations per cell, and every glyph
/// at its cell's left edge, so the font's natural advance never moves the
/// grid. The row is shaped once for fallback faces and clusters.
fn paint_cells(window: &mut Window, grid: &Grid, origin: Point<Pixels>, cells: &[CellPaint]) {
    let cell_x = |cell: &CellPaint| origin.x + px(f32::from(cell.col) * grid.cell_w);
    let cell_width = |cell: &CellPaint| px(f32::from(cell.span) * grid.cell_w);
    for cell in cells {
        if let Some(bg) = cell.bg {
            window.paint_quad(fill(
                Bounds::new(
                    point(cell_x(cell), origin.y),
                    size(cell_width(cell), px(grid.cell_h)),
                ),
                bg,
            ));
        }
    }
    // Box drawing, blocks, shades and Powerline fill their whole cell.
    let custom: Vec<bool> = cells.iter().map(|c| glyphs::is_custom(&c.text)).collect();
    for (cell, _) in cells.iter().zip(&custom).filter(|(_, custom)| **custom) {
        glyphs::paint(
            window,
            &cell.text,
            Bounds::new(
                point(cell_x(cell), origin.y),
                size(cell_width(cell), px(grid.cell_h)),
            ),
            grid.size,
            cell.fg,
        );
    }
    let mut text = String::new();
    let mut starts = Vec::with_capacity(cells.len());
    let runs: Vec<TextRun> = cells
        .iter()
        .zip(&custom)
        .map(|(cell, custom)| {
            starts.push(text.len());
            let shown = if *custom { " " } else { cell.text.as_str() };
            text.push_str(shown);
            TextRun {
                len: shown.len(),
                font: cell.font.clone(),
                color: cell.fg.into(),
                background_color: None,
                underline: None,
                strikethrough: None,
            }
        })
        .collect();
    if text.trim().is_empty() {
        return;
    }
    let size = px(grid.size);
    let line = window
        .text_system()
        .shape_line(text.into(), size, &runs, None);
    let baseline = origin.y + px(grid.baseline);
    // A cell's later glyphs (combining marks) keep their offset from its first.
    let mut first: Vec<Option<Pixels>> = vec![None; cells.len()];
    for run in line.runs.iter() {
        for glyph in &run.glyphs {
            let i = starts
                .partition_point(|s| *s <= glyph.index)
                .saturating_sub(1);
            let lead = *first[i].get_or_insert(glyph.position.x);
            let at = point(cell_x(&cells[i]) + glyph.position.x - lead, baseline);
            if glyph.is_emoji {
                window.paint_emoji(at, run.font_id, glyph.id, size).ok();
            } else {
                window
                    .paint_glyph(at, run.font_id, glyph.id, size, cells[i].fg.into())
                    .ok();
            }
        }
    }
    for cell in cells.iter().filter(|c| c.underline) {
        window.paint_quad(fill(
            Bounds::new(
                point(cell_x(cell), baseline + px(1.)),
                gpui::size(cell_width(cell), px(1.)),
            ),
            cell.fg,
        ));
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
                    px(PAD_LEFT + c as f32 * self.grid.cell_w),
                    px(PAD_TOP + r as f32 * self.grid.cell_h),
                ),
            size(px(self.grid.cell_w), px(self.grid.cell_h)),
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

    #[test]
    fn a_session_is_titled_by_its_folder() {
        use std::path::Path;
        assert_eq!(path_label(Path::new("/Users/me/project/")), "project");
        assert_eq!(path_label(Path::new("/Users/me/project")), "project");
        assert_eq!(path_label(Path::new("C:\\work\\site\\")), "site");
        assert_eq!(path_label(Path::new("/")), "/");
        assert_eq!(path_label(Path::new("")), "—");
    }

    #[test]
    fn cells_follow_xterm_for_menlo_at_one_and_two_device_pixels() {
        // Menlo 13px: "W" advances 7.8267; ascent 12.0669, descent 3.0659.
        assert_eq!(
            cell_metrics(7.82666, 12.066895, 3.065918, 2.),
            (7.5, 18.5, 14.)
        );
        assert_eq!(
            cell_metrics(7.82666, 12.066895, 3.065918, 1.),
            (7., 18., 14.)
        );
    }

    #[test]
    fn the_grid_fits_inside_the_session_padding_like_fit_addon() {
        let grid = Grid {
            cell_w: 7.5,
            cell_h: 18.5,
            ..Grid::default()
        };
        // 420 − 16 left − 14 scrollbar = 390 → 52 columns; 464 − 30 → 23 rows.
        assert_eq!(fit(420., 464., &grid), (23, 52));
        assert_eq!(fit(10., 10., &grid), (1, 2), "FitAddon's minimum");
    }

    #[test]
    fn the_thumb_tracks_the_scrollback_offset() {
        let lane = (100., 400.);
        assert_eq!(thumb(lane, 20, 0, 0), None, "nothing to scroll");
        // 20 rows over 80 lines: a 100px thumb at the bottom, then the top.
        assert_eq!(thumb(lane, 20, 60, 0), Some((400., 100.)));
        assert_eq!(thumb(lane, 20, 60, 60), Some((100., 100.)));
        assert_eq!(thumb(lane, 20, 60, 30), Some((250., 100.)));
        // Long scrollback keeps the minimum slider.
        assert_eq!(thumb(lane, 20, 6000, 0).unwrap().1, THUMB_MIN);
    }

    #[gpui::test]
    fn a_click_on_a_link_opens_it_and_a_selection_does_not(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            TerminalView::assemble(Terminal::disconnected_for_test(), false, false, cx)
        });
        view.update(cx, |s, cx| {
            s.parser
                .process(b"see https://example.com/x now\r\nhttps://example.org/y\r\n");
            cx.notify();
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        let (origin, grid) = view.read_with(cx, |s, _| (s.bounds.origin, s.grid.clone()));
        let at = |row: f32, col: f32| {
            origin
                + point(
                    px(PAD_LEFT + (col + 0.5) * grid.cell_w),
                    px(PAD_TOP + (row + 0.5) * grid.cell_h),
                )
        };
        // Hovering underlines the link and points.
        cx.simulate_mouse_move(at(0., 6.), None, Modifiers::none());
        view.read_with(cx, |s, _| {
            assert_eq!(
                s.hover_link.as_ref().map(|l| l.url.as_str()),
                Some("https://example.com/x")
            )
        });
        // A drag across the second link selects it instead of opening it.
        cx.simulate_mouse_down(at(1., 0.), MouseButton::Left, Modifiers::none());
        cx.simulate_mouse_move(at(1., 8.), MouseButton::Left, Modifiers::none());
        cx.simulate_mouse_up(at(1., 8.), MouseButton::Left, Modifiers::none());
        assert_eq!(cx.opened_url(), None);
        cx.simulate_mouse_down(at(0., 6.), MouseButton::Left, Modifiers::none());
        cx.simulate_mouse_up(at(0., 6.), MouseButton::Left, Modifiers::none());
        assert_eq!(cx.opened_url().as_deref(), Some("https://example.com/x"));
    }
    #[gpui::test]
    fn native_pointer_selection_copy_and_shift_override(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut view =
                TerminalView::assemble(Terminal::disconnected_for_test(), false, false, cx);
            view.parser = vt100::Parser::new(24, 80, 10);
            view.shell = "/bin/zsh".into();
            view
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        // A drop on an exited session, or from a workspace without local
        // paths, is refused with the product notice.
        view.update_in(cx, |s, w, cx| {
            s.insert_paths(Some(vec!["/tmp/a.md".into()]), w, cx);
            assert!(s.drop_failed);
            s.drop_failed = false;
            s.insert_paths(None, w, cx);
            assert!(s.drop_failed);
            s.drop_failed = false;
        });
        let origin = view.update(cx, |s, cx| {
            s.parser.process(b"hello world");
            cx.notify();
            s.bounds.origin
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        let cell_w = view.read_with(cx, |s, _| s.grid.cell_w);
        let start = origin + point(px(PAD_LEFT), px(PAD_TOP + 4.));
        let end = start + point(px(5. * cell_w), px(0.));
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
                s.failure.is_none(),
                "selection must not write to the disconnected PTY"
            );
        });
    }
}
