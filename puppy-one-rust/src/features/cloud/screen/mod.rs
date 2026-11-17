//! Cloud Computer Screen (`computer-mode-experiment/workbench-redesign-v4.html`):
//! one live screen that lives in the sidebar card — folded to a row, or
//! unfolded to a preview while an Agent works there — and moves onto the
//! main area when opened, over a persistent VNC/RFB stream with explicit
//! `Take control` input gating.
//!
//! In Computer Mode the same screen shows a computer on this computer
//! (`DesktopLocalComputerWorkspace`): its desktop's display over loopback
//! VNC, or what keeps it from showing — asleep, starting, or no desktop yet.
mod glyph;
mod keys;
mod motion;
mod rfb;
mod session;
mod stage;

use crate::{
    cloud::auth::Cancellation,
    features::{
        computer_mode, flags,
        settings::{PreferencesChanged, PreferencesStore},
    },
    geometry::Rect,
    localization::t as tr,
    platform::local_computers::Record,
    theme::{self, metric},
    ui::appearance::ActiveAppearance,
    workspace::cloud::sandbox::{CloudSandbox, SandboxSettings, SandboxTarget, ScreenAvailability},
};
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use keys::{InputState, map_pointer};
use motion::{Card, Place, Pose, ScreenMotion, Shown};
use rfb::RfbCommand;
use std::{cell::RefCell, sync::Arc, time::Duration};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudScreenEvent {
    /// User clicked `Wake it` on a sleeping Cloud Computer.
    WakeWorkspace,
    /// Screen visibility changed (`open` / `close` / experiment toggled).
    VisibilityChanged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StreamPhase {
    Idle,
    Connecting,
    Connected,
    Asleep,
    Failed,
}

/// The screen's places in one frame of the window.
pub struct ScreenLayout {
    /// The sidebar card, while the Explorer shows.
    card: Option<Card>,
    /// The main area.
    stage: Rect,
    /// The Explorer's start edge (the main area's while it is closed): the
    /// moving screen is never drawn past it.
    clip_x: f32,
    /// The live screen, while there is a picture.
    shown: Option<Shown>,
}
impl ScreenLayout {
    /// The screen is moving: the window draws the next frame.
    pub fn moving(&self) -> bool {
        self.shown.is_some_and(|s| s.moving)
    }
    /// The screen moves to or from the main area: native web content there
    /// hides until it lands.
    pub fn crossing(&self) -> bool {
        self.shown.is_some_and(|s| s.moving && s.crosses)
    }
}

pub struct CloudScreen {
    preferences: Entity<PreferencesStore>,
    focus: FocusHandle,
    target: Option<SandboxTarget>,
    /// Computer Mode: the window's workspace folder, and the computer it is
    /// on this computer, when it is one.
    local_path: Option<std::path::PathBuf>,
    local: Option<Record>,
    sandbox: CloudSandbox,
    shown: bool,
    interactive: bool,
    /// The Agent at work in this computer now, by name.
    operator: Option<SharedString>,
    /// The card folded or unfolded by hand; the next Agent to start or stop
    /// working hands it back.
    fold: Option<bool>,
    /// Sampled once per painted frame by the window (`ScreenMotion`).
    motion: RefCell<ScreenMotion>,
    saving: bool,
    phase: StreamPhase,
    generation: u64,
    reconnect_delay: Duration,
    session_task: Option<Task<()>>,
    stream_cancel: Option<Cancellation>,
    command_tx: Option<async_channel::Sender<RfbCommand>>,
    frame_image: Option<Arc<RenderImage>>,
    frame_dims: Option<(u32, u32)>,
    viewport_bounds: Option<Bounds<Pixels>>,
    input: InputState,
}

impl EventEmitter<CloudScreenEvent> for CloudScreen {}

impl CloudScreen {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle();
        cx.on_blur(&focus, window, |s, _, cx| {
            s.release_control(cx);
        })
        .detach();
        cx.subscribe(&preferences, |s, _, _: &PreferencesChanged, cx| {
            s.on_preferences_changed(cx);
        })
        .detach();
        cx.on_release(|s, cx| {
            if let Some(old) = s.frame_image.take() {
                cx.drop_image(old, None);
            }
        })
        .detach();
        let computers = computer_mode::global(&preferences, cx);
        cx.observe(&computers, |s, _, cx| s.refresh_local(cx))
            .detach();

        Self {
            preferences,
            focus,
            target: None,
            local_path: None,
            local: None,
            sandbox: CloudSandbox::default(),
            shown: false,
            interactive: false,
            operator: None,
            fold: None,
            motion: RefCell::default(),
            saving: false,
            phase: StreamPhase::Idle,
            generation: 0,
            reconnect_delay: Duration::from_secs(1),
            session_task: None,
            stream_cancel: None,
            command_tx: None,
            frame_image: None,
            frame_dims: None,
            viewport_bounds: None,
            input: InputState::default(),
        }
    }

    pub fn is_shown(&self, cx: &App) -> bool {
        self.shown && self.entry_available(cx)
    }

    pub fn is_interactive(&self, cx: &App) -> bool {
        self.interactive && self.is_shown(cx)
    }

    pub(super) fn entry_available(&self, cx: &App) -> bool {
        if self.local.is_some() {
            return flags::computer_mode_enabled(&self.preferences, cx);
        }
        self.target.is_some()
            && self.sandbox.screen_present()
            && flags::cloud_screen_enabled(&self.preferences, cx)
    }

    /// What the computer on this computer can show now.
    pub(super) fn local_screen(&self, cx: &App) -> Option<computer_mode::Screen> {
        let record = self.local.as_ref()?;
        Some(computer_mode::read(cx)?.screen(record))
    }

    /// There is a display to stream: the Cloud Computer's, or the desktop of
    /// the computer on this computer.
    fn streams(&self, cx: &App) -> bool {
        match self.local_screen(cx) {
            Some(screen) => matches!(screen, computer_mode::Screen::Desktop { .. }),
            None => {
                self.local.is_none()
                    && matches!(
                        self.sandbox.availability(),
                        ScreenAvailability::Stream { .. }
                    )
            }
        }
    }

    /// Computer Mode: the window shows the workspace at `path` (or none).
    pub fn set_local_workspace(
        &mut self,
        path: Option<std::path::PathBuf>,
        cx: &mut Context<Self>,
    ) {
        if self.local_path != path {
            self.local_path = path;
            self.refresh_local(cx);
        }
    }

    /// The computer of the window's workspace, as the registry has it now.
    fn refresh_local(&mut self, cx: &mut Context<Self>) {
        let record = self
            .local_path
            .as_deref()
            .and_then(|path| computer_mode::read(cx)?.for_path(path));
        if record == self.local {
            return;
        }
        let was_shown = self.is_shown(cx);
        let same = record.as_ref().map(|r| &r.id) == self.local.as_ref().map(|r| &r.id);
        if !same {
            self.teardown_session(cx);
            self.shown = false;
            self.interactive = false;
            self.fold = None;
        }
        let port = |r: &Option<Record>| {
            r.as_ref()
                .and_then(|r| r.vnc_port.filter(|_| r.desktop_ready))
        };
        let restream = same && port(&record) != port(&self.local);
        self.local = record;
        if restream {
            self.teardown_session(cx);
        }
        self.settle_visibility(was_shown, cx);
        cx.notify();
    }

    fn settle_visibility(&mut self, was_shown: bool, cx: &mut Context<Self>) {
        if !self.entry_available(cx) {
            self.shown = false;
            self.interactive = false;
        }
        self.reconcile_stream(cx);
        if was_shown != self.is_shown(cx) {
            cx.emit(CloudScreenEvent::VisibilityChanged);
        }
    }

    pub fn set_target(&mut self, target: Option<SandboxTarget>, cx: &mut Context<Self>) {
        match (&self.target, &target) {
            (None, None) => return,
            (Some(prev), Some(next)) if prev.same_instance(next) => {
                let latest = next.sandbox();
                if self.sandbox != latest {
                    let was_shown = self.is_shown(cx);
                    self.sandbox = latest;
                    self.settle_visibility(was_shown, cx);
                    cx.notify();
                }
                return;
            }
            _ => {}
        }
        let same_project = match (&self.target, &target) {
            (Some(prev), Some(next)) => prev.project_id() == next.project_id(),
            _ => false,
        };
        let was_shown = self.is_shown(cx);
        self.teardown_session(cx);
        self.saving = false;
        self.fold = None;
        self.sandbox = target
            .as_ref()
            .map(SandboxTarget::sandbox)
            .unwrap_or_default();
        self.target = target;
        if !same_project {
            self.shown = false;
            self.interactive = false;
        }
        self.settle_visibility(was_shown, cx);
        cx.notify();
    }

    pub fn sync_sandbox(
        &mut self,
        project_id: &str,
        sandbox: CloudSandbox,
        cx: &mut Context<Self>,
    ) {
        let Some(target) = &self.target else {
            return;
        };
        if target.project_id() != project_id {
            return;
        }
        target.set_cached(sandbox.clone());
        let was_shown = self.is_shown(cx);
        self.sandbox = sandbox;
        self.settle_visibility(was_shown, cx);
        cx.notify();
    }

    pub fn open(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.show(cx);
    }

    fn show(&mut self, cx: &mut Context<Self>) {
        if !self.entry_available(cx) {
            return;
        }
        let changed = !self.shown;
        self.shown = true;
        if changed {
            self.interactive = false;
        }
        if matches!(self.phase, StreamPhase::Failed) {
            self.retry(cx);
        } else {
            self.reconcile_stream(cx);
        }
        if changed {
            cx.emit(CloudScreenEvent::VisibilityChanged);
        }
        cx.notify();
    }

    pub fn close(&mut self, cx: &mut Context<Self>) {
        if !self.shown {
            return;
        }
        self.shown = false;
        self.release_control(cx);
        self.reconcile_stream(cx);
        cx.emit(CloudScreenEvent::VisibilityChanged);
        cx.notify();
    }

    pub fn take_control(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.is_shown(cx) || self.phase != StreamPhase::Connected {
            return;
        }
        self.interactive = true;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn release_control(&mut self, cx: &mut Context<Self>) {
        self.release_inputs();
        if self.interactive {
            self.interactive = false;
            cx.notify();
        }
    }

    /// The Agent at work in this computer (`WorkspaceAgent::active`): the
    /// card unfolds to watch it, and folds again when it stops.
    pub fn set_operator(&mut self, operator: Option<SharedString>, cx: &mut Context<Self>) {
        if self.operator == operator {
            return;
        }
        if self.operator.is_some() != operator.is_some() {
            self.fold = None;
        }
        self.operator = operator;
        cx.notify();
    }

    /// The card's fold toggle.
    pub(super) fn toggle_fold(&mut self, cx: &mut Context<Self>) {
        self.fold = Some(!self.unfolded());
        cx.notify();
    }

    /// A picture of the screen to show: streaming, with a frame.
    pub(super) fn live(&self, cx: &App) -> bool {
        self.entry_available(cx)
            && self.streams(cx)
            && matches!(self.phase, StreamPhase::Connecting | StreamPhase::Connected)
            && self.frame_image.is_some()
    }

    /// The card shows the live preview: off the main area, and unfolded by
    /// hand or while an Agent works.
    fn unfolded(&self) -> bool {
        !self.shown && self.frame_image.is_some() && self.fold.unwrap_or(self.operator.is_some())
    }

    /// Where the screen is this frame: its card at the top of the Explorer's
    /// `plane` (when the Explorer shows) and the main area at `stage`.
    /// Samples the motion, so the window calls it once per frame.
    pub fn layout(
        &self,
        plane: Option<Rect>,
        stage: Rect,
        animate: bool,
        cx: &App,
    ) -> ScreenLayout {
        let aspect = motion::aspect(self.frame_dims);
        let card = plane
            .filter(|_| self.entry_available(cx))
            .map(|plane| Card::new(plane, aspect));
        let shown = if self.live(cx) {
            let place = if self.shown {
                Place::Stage
            } else if card.is_some() {
                Place::Card {
                    unfolded: self.unfolded(),
                }
            } else {
                Place::Away
            };
            let target = Pose::at(place, card, stage, aspect);
            Some(
                self.motion
                    .borrow_mut()
                    .frame(place, target, animate, std::time::Instant::now()),
            )
        } else {
            self.motion.borrow_mut().forget();
            None
        };
        ScreenLayout {
            card,
            clip_x: plane.map_or(stage.x, |plane| plane.x),
            stage,
            shown,
        }
    }

    fn on_preferences_changed(&mut self, cx: &mut Context<Self>) {
        let enabled = if self.local.is_some() {
            flags::computer_mode_enabled(&self.preferences, cx)
        } else {
            flags::cloud_screen_enabled(&self.preferences, cx)
        };
        if !enabled {
            let was_shown = self.shown;
            self.shown = false;
            self.interactive = false;
            self.teardown_session(cx);
            if was_shown {
                cx.emit(CloudScreenEvent::VisibilityChanged);
            }
        } else {
            self.reconcile_stream(cx);
        }
        cx.notify();
    }

    fn reconcile_stream(&mut self, cx: &mut Context<Self>) {
        let wants_stream = self.entry_available(cx) && self.streams(cx);
        if !wants_stream {
            self.teardown_session(cx);
            return;
        }
        if matches!(self.phase, StreamPhase::Idle) {
            self.start_stream(cx);
        }
    }

    pub(super) fn retry(&mut self, cx: &mut Context<Self>) {
        self.teardown_session(cx);
        if self.entry_available(cx) && self.streams(cx) {
            self.start_stream(cx);
        }
        cx.notify();
    }

    pub(super) fn wake(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.local.as_ref().map(|r| r.id.clone()) {
            computer_mode::global(&self.preferences, cx).update(cx, |c, cx| c.wake(&id, cx));
            return;
        }
        cx.emit(CloudScreenEvent::WakeWorkspace);
        self.retry(cx);
    }

    /// `Put to sleep` (the computer on this computer).
    pub(super) fn sleep_local(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.local.as_ref().map(|r| r.id.clone()) {
            self.close(cx);
            computer_mode::global(&self.preferences, cx).update(cx, |c, cx| c.sleep(&id, cx));
        }
    }

    /// `Start desktop screen` (the computer on this computer).
    fn start_local_desktop(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.local.as_ref().map(|r| r.id.clone()) {
            computer_mode::global(&self.preferences, cx)
                .update(cx, |c, cx| c.provision_desktop(&id, cx));
        }
    }

    /// The display's address: its loopback port on this computer.
    pub(super) fn local_port(&self, cx: &App) -> Option<u16> {
        match self.local_screen(cx)? {
            computer_mode::Screen::Desktop { port } => Some(port),
            _ => None,
        }
    }

    /// The open screen where the main area measured last (window
    /// coordinates).
    pub(super) fn screen_bounds(&self) -> Option<Rect> {
        let stage = self.viewport_bounds?;
        let stage = Rect::new(
            f32::from(stage.origin.x),
            f32::from(stage.origin.y),
            f32::from(stage.size.width),
            f32::from(stage.size.height),
        );
        Some(motion::on_stage(stage, motion::aspect(self.frame_dims)))
    }

    /// The desktop pixel under `position`; none in the margin around it.
    pub(super) fn pointer_at(&self, position: Point<Pixels>) -> Option<(u16, u16)> {
        let screen = self.screen_bounds()?;
        let (x, y) = (f32::from(position.x), f32::from(position.y));
        if x < screen.x || y < screen.y || x >= screen.right() || y >= screen.bottom() {
            return None;
        }
        let (fw, fh) = self.frame_dims?;
        let bounds = Bounds {
            origin: point(px(screen.x), px(screen.y)),
            size: size(px(screen.w), px(screen.h)),
        };
        map_pointer(bounds, position, fw, fh)
    }

    fn render_notice(
        &self,
        t: crate::theme::Theme,
        message: &'static str,
        button: Option<AnyElement>,
    ) -> AnyElement {
        let meta = theme::ty().ui.meta;
        let mut view = v_flex()
            .id("cloud-screen-notice")
            .debug_selector(|| "cloud-screen-notice".into())
            .size_full()
            .p(px(24.))
            .gap(px(14.))
            .items_center()
            .justify_center()
            .bg(t.canvas)
            .child(glyph::screen_glyph(40., 32., t.subtle, false))
            .child(
                div()
                    .max_w(px(320.))
                    .text_size(px(meta))
                    .line_height(relative(1.45))
                    .text_color(t.subtle)
                    .text_center()
                    .child(message),
            );
        if let Some(button) = button {
            view = view.child(button);
        }
        view.into_any_element()
    }

    fn notice_button(
        &self,
        id: &'static str,
        label: &'static str,
        disabled: bool,
        t: crate::theme::Theme,
        on_click: impl Fn(&mut Self, &ClickEvent, &mut Window, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let meta = theme::ty().ui.meta;
        div()
            .id(id)
            .debug_selector(move || id.to_string())
            .px(px(12.))
            .py(px(4.))
            .rounded(px(metric::CONTROL_RADIUS))
            .border_1()
            .border_color(t.border_subtle)
            .text_size(px(meta))
            .line_height(relative(1.45))
            .text_color(if disabled { t.text_disabled } else { t.text })
            .when(!disabled, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(|s| s.bg(t.hover))
                    .on_click(cx.listener(on_click))
            })
            .child(label)
            .into_any_element()
    }

    /// What keeps the computer on this computer from showing its desktop
    /// (`LocalComputerScreenView`): asleep, starting, or no desktop yet.
    fn render_local_notice(
        &self,
        t: crate::theme::Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        use computer_mode::Screen;
        let notice = match self.local_screen(cx)? {
            Screen::Desktop { .. } => return None,
            Screen::Asleep => {
                let btn = self.notice_button(
                    "local-screen-wake",
                    tr("onboarding.computerMode.screen.wakeAction"),
                    false,
                    t,
                    |s, _, _, cx| s.wake(cx),
                    cx,
                );
                self.render_notice(
                    t,
                    tr("onboarding.computerMode.screen.asleepNote"),
                    Some(btn),
                )
            }
            Screen::Starting => self.render_notice(
                t,
                tr("onboarding.computerMode.screen.provisioningNote"),
                None,
            ),
            Screen::Workspace { can_start } => {
                let btn = can_start.then(|| {
                    self.notice_button(
                        "local-screen-start-desktop",
                        tr("onboarding.computerMode.screen.startDesktopAction"),
                        false,
                        t,
                        |s, _, _, cx| s.start_local_desktop(cx),
                        cx,
                    )
                });
                self.render_notice(
                    t,
                    tr("onboarding.computerMode.screen.workspaceReadyNote"),
                    btn,
                )
            }
        };
        Some(notice)
    }

    /// The computer on this computer this screen shows, if it is one.
    pub(super) fn is_local(&self) -> bool {
        self.local.is_some()
    }

    #[cfg(test)]
    pub fn local_for_test(&self) -> Option<&Record> {
        self.local.as_ref()
    }

    #[cfg(test)]
    pub fn local_screen_for_test(&self, cx: &App) -> Option<computer_mode::Screen> {
        self.local_screen(cx)
    }

    #[cfg(test)]
    pub fn set_reconnect_delay_for_test(&mut self, delay: Duration) {
        self.reconnect_delay = delay;
    }

    #[cfg(any(test, feature = "dev-capture"))]
    pub fn has_live_frame(&self) -> bool {
        self.frame_image.is_some()
    }

    #[cfg(feature = "dev-capture")]
    pub fn open_for_lab(&mut self, cx: &mut Context<Self>) {
        self.show(cx);
    }

    #[cfg(feature = "dev-capture")]
    pub fn is_asleep_for_lab(&self) -> bool {
        self.phase == StreamPhase::Asleep
    }

    #[cfg(any(test, feature = "dev-capture"))]
    pub fn operator_for_lab(&self) -> Option<&SharedString> {
        self.operator.as_ref()
    }

    /// The screen is still on its way somewhere.
    #[cfg(feature = "dev-capture")]
    pub fn moving_for_lab(&self) -> bool {
        self.motion.borrow().moving()
    }

    #[cfg(test)]
    pub fn frame_dimensions(&self) -> Option<(u32, u32)> {
        self.frame_dims
    }

    #[cfg(test)]
    pub fn availability_for_test(&self) -> ScreenAvailability {
        self.sandbox.availability()
    }

    #[cfg(test)]
    pub fn is_asleep_for_test(&self) -> bool {
        self.phase == StreamPhase::Asleep
    }

    #[cfg(test)]
    pub fn is_failed_for_test(&self) -> bool {
        self.phase == StreamPhase::Failed
    }
}

impl Render for CloudScreen {
    /// The main area while the screen is open: what keeps it from showing
    /// (desktop off, asleep, disconnected), or the surface that takes the
    /// pointer and keys. The picture itself is the moving screen above it.
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        if let Some(notice) = self.render_local_notice(t, cx) {
            return notice;
        }
        match self.sandbox.availability() {
            ScreenAvailability::Preview => {
                return self.render_notice(t, tr("cloud.sandbox.screen.preview-note"), None);
            }
            ScreenAvailability::Install { pending: true } => {
                return self.render_notice(t, tr("cloud.sandbox.screen.install-pending"), None);
            }
            ScreenAvailability::Install { pending: false } => {
                let btn = self.notice_button(
                    "cloud-screen-install",
                    tr("cloud.sandbox.screen.install"),
                    self.saving,
                    t,
                    |s, _, _, cx| {
                        s.apply_setting(
                            SandboxSettings {
                                desktop: Some(true),
                                screen_stream: None,
                            },
                            cx,
                        );
                    },
                    cx,
                );
                return self.render_notice(t, tr("cloud.sandbox.screen.not-installed"), Some(btn));
            }
            ScreenAvailability::StreamOff => {
                let btn = self.notice_button(
                    "cloud-screen-stream-on",
                    tr("cloud.sandbox.screen.stream-on"),
                    self.saving,
                    t,
                    |s, _, _, cx| {
                        s.apply_setting(
                            SandboxSettings {
                                desktop: None,
                                screen_stream: Some(true),
                            },
                            cx,
                        );
                    },
                    cx,
                );
                return self.render_notice(t, tr("cloud.sandbox.screen.stream-off"), Some(btn));
            }
            ScreenAvailability::Unavailable => {
                return self.render_notice(t, tr("cloud.sandbox.screen.unavailable"), None);
            }
            ScreenAvailability::Stream { .. } => {}
        }

        if self.phase == StreamPhase::Asleep {
            let btn = self.notice_button(
                "cloud-screen-wake",
                tr("cloud.sandbox.screen.wake"),
                false,
                t,
                |s, _, _, cx| s.wake(cx),
                cx,
            );
            return self.render_notice(t, tr("cloud.sandbox.screen.asleep"), Some(btn));
        }
        if self.phase == StreamPhase::Failed {
            let btn = self.notice_button(
                "cloud-screen-retry",
                tr("cloud.sandbox.screen.retry"),
                false,
                t,
                |s, _, _, cx| s.retry(cx),
                cx,
            );
            return self.render_notice(t, tr("cloud.sandbox.screen.disconnected"), Some(btn));
        }

        let meta = theme::ty().ui.meta;
        let entity = cx.entity();
        div()
            .id("cloud-screen-stage")
            .debug_selector(|| "cloud-screen-stage".into())
            .track_focus(&self.focus)
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(t.canvas)
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_down(MouseButton::Right, cx.listener(Self::on_mouse_down))
            .on_mouse_down(MouseButton::Middle, cx.listener(Self::on_mouse_down))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up(MouseButton::Right, cx.listener(Self::on_mouse_up))
            .on_mouse_up(MouseButton::Middle, cx.listener(Self::on_mouse_up))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_scroll_wheel(cx.listener(Self::on_scroll))
            .on_key_down(cx.listener(Self::on_key_down))
            .on_key_up(cx.listener(Self::on_key_up))
            .on_modifiers_changed(cx.listener(Self::on_modifiers))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        entity.update(cx, |s, cx| s.update_viewport_bounds(bounds, cx));
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0(),
            )
            // Before the first picture, the screen's empty shape where it
            // will show.
            .when(self.frame_image.is_none(), |d| {
                let place = self.screen_bounds().zip(self.viewport_bounds);
                let label = div()
                    .text_size(px(meta))
                    .line_height(relative(1.45))
                    .child(tr("cloud.sandbox.screen.connecting"));
                d.child(match place {
                    Some((screen, stage)) => div()
                        .id("cloud-screen-connecting")
                        .absolute()
                        .left(px(screen.x - f32::from(stage.origin.x)))
                        .top(px(screen.y - f32::from(stage.origin.y)))
                        .w(px(screen.w))
                        .h(px(screen.h))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(motion::STAGE_RADIUS))
                        .bg(theme::screen_surface())
                        .border_1()
                        .border_color(theme::alpha(t.text, 0.08))
                        .text_color(theme::screen_overlay_muted())
                        .child(label),
                    None => div()
                        .id("cloud-screen-connecting")
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(t.subtle)
                        .child(label),
                })
            })
            .into_any_element()
    }
}
