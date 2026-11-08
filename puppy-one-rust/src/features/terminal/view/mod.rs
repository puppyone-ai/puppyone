//! `TerminalView`: one PTY session as a GPUI view.
use super::*;
mod input;

pub struct TerminalView {
    terminal: Terminal,
    parser: vt100::Parser,
    queries: queries::Queries,
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
    /// `launcher`: `shell`, or the local Agent id whose CLI `executable` is.
    pub fn new(
        root: PathBuf,
        executable: Option<PathBuf>,
        launcher: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let agent = executable.is_some();
        let owner = crate::features::agent_presence::owner(window);
        Self::start(
            move |wake| Terminal::spawn(root, executable, launcher, wake, owner),
            agent,
            window,
            cx,
        )
    }
    /// A session `begin` starts with the view's wake: a local PTY, or one
    /// bridged to a process elsewhere (another computer's folder).
    pub fn start(
        begin: impl FnOnce(Wake) -> Terminal,
        agent: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
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
        let terminal = begin(wake);
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
            queries: queries::Queries::default(),
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
        view.lab_output = Some(include_bytes!("../../../../fixtures/terminal-session.ansi"));
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
pub(super) fn mouse_button(button: MouseButton) -> Option<u8> {
    match button {
        MouseButton::Left => Some(0),
        MouseButton::Middle => Some(1),
        MouseButton::Right => Some(2),
        _ => None,
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

/// Window tests read the screen and type into the session.
#[cfg(test)]
impl TerminalView {
    pub fn screen_text(&self) -> String {
        self.parser.screen().contents()
    }
    pub fn type_text(&self, text: &str) {
        let _ = self.terminal.input(text.as_bytes().to_vec());
    }
}
#[cfg(test)]
mod tests;
