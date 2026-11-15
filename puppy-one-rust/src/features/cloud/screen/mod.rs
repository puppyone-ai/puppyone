//! Cloud Computer Screen (`CloudComputerScreen.tsx`): top fixed-height sidebar
//! entry (`CloudScreenSidebarEntry`), persistent VNC/RFB streaming with Full-Pane
//! ↔ bottom-right PiP (`288×180`), and explicit `Take control` input gating.
mod glyph;
mod keys;
mod rfb;
mod session;
mod stage;

use crate::{
    cloud::auth::Cancellation,
    features::{
        flags,
        settings::{PreferencesChanged, PreferencesStore},
    },
    localization::t as tr,
    theme::{self, metric},
    ui::appearance::ActiveAppearance,
    workspace::cloud::sandbox::{CloudSandbox, SandboxSettings, SandboxTarget, ScreenAvailability},
};
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use keys::{InputState, fit_bounds, map_pointer};
use rfb::RfbCommand;
use stage::{PIP_HEIGHT, PIP_INSET, PIP_RADIUS, PIP_WIDTH};
use std::{sync::Arc, time::Duration};

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

pub struct CloudScreen {
    preferences: Entity<PreferencesStore>,
    focus: FocusHandle,
    target: Option<SandboxTarget>,
    sandbox: CloudSandbox,
    shown: bool,
    interactive: bool,
    pip_hidden: bool,
    transition_seq: usize,
    transition_from_pip: bool,
    saving: bool,
    phase: StreamPhase,
    generation: u64,
    reconnect_delay: Duration,
    session_task: Option<Task<()>>,
    resize_task: Option<Task<()>>,
    stream_cancel: Option<Cancellation>,
    command_tx: Option<async_channel::Sender<RfbCommand>>,
    frame_image: Option<Arc<RenderImage>>,
    frame_dims: Option<(u32, u32)>,
    viewport_bounds: Option<Bounds<Pixels>>,
    last_sent_size: Option<(u16, u16)>,
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

        Self {
            preferences,
            focus,
            target: None,
            sandbox: CloudSandbox::default(),
            shown: false,
            interactive: false,
            pip_hidden: false,
            transition_seq: 0,
            transition_from_pip: false,
            saving: false,
            phase: StreamPhase::Idle,
            generation: 0,
            reconnect_delay: Duration::from_secs(1),
            session_task: None,
            resize_task: None,
            stream_cancel: None,
            command_tx: None,
            frame_image: None,
            frame_dims: None,
            viewport_bounds: None,
            last_sent_size: None,
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
        self.target.is_some()
            && self.sandbox.screen_present()
            && flags::cloud_screen_enabled(&self.preferences, cx)
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
        self.pip_hidden = false;
        self.transition_seq = 0;
        self.transition_from_pip = false;
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
        if !self.entry_available(cx) {
            return;
        }
        let was_pip = self.pip_visible(cx);
        let changed = !self.shown;
        self.shown = true;
        self.pip_hidden = false;
        if changed {
            self.interactive = false;
            self.transition_seq = self.transition_seq.wrapping_add(1);
            self.transition_from_pip = was_pip;
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
        self.transition_seq = self.transition_seq.wrapping_add(1);
        self.transition_from_pip = false;
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

    pub(super) fn hide_pip(&mut self, cx: &mut Context<Self>) {
        if !self.pip_hidden {
            self.pip_hidden = true;
            cx.notify();
        }
    }

    fn on_preferences_changed(&mut self, cx: &mut Context<Self>) {
        if !flags::cloud_screen_enabled(&self.preferences, cx) {
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
        let wants_stream = self.entry_available(cx)
            && matches!(
                self.sandbox.availability(),
                ScreenAvailability::Stream { .. }
            );
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
        if self.entry_available(cx)
            && matches!(
                self.sandbox.availability(),
                ScreenAvailability::Stream { .. }
            )
        {
            self.start_stream(cx);
        }
        cx.notify();
    }

    pub(super) fn wake(&mut self, cx: &mut Context<Self>) {
        cx.emit(CloudScreenEvent::WakeWorkspace);
        self.retry(cx);
    }

    pub(super) fn pointer_at(&self, position: Point<Pixels>) -> Option<(u16, u16)> {
        let bounds = self.viewport_bounds?;
        let (fw, fh) = self.frame_dims?;
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

    #[cfg(test)]
    pub fn set_reconnect_delay_for_test(&mut self, delay: Duration) {
        self.reconnect_delay = delay;
    }

    #[cfg(test)]
    pub fn has_live_frame(&self) -> bool {
        self.frame_image.is_some()
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
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
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

        let connecting = self.phase != StreamPhase::Connected || self.frame_image.is_none();
        let meta = theme::ty().ui.meta;
        let entity = cx.entity();
        let fullscreen = window.is_fullscreen();
        let controls = (!connecting).then(|| self.render_stage_controls(fullscreen, cx));
        let fitted = match (
            self.viewport_bounds,
            self.frame_dims,
            self.frame_image.clone(),
        ) {
            (Some(vp), Some((fw, fh)), Some(image)) => {
                fit_bounds(vp, fw, fh).map(|rect| (rect, vp.origin, image))
            }
            _ => None,
        };

        let stage = div()
            .id("cloud-screen-live")
            .debug_selector(|| "cloud-screen-live".into())
            .group("cloud-screen-stage")
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
            .when_some(fitted, |d, (rect, origin, image)| {
                d.child(
                    img(image)
                        .absolute()
                        .left(rect.origin.x - origin.x)
                        .top(rect.origin.y - origin.y)
                        .w(rect.size.width)
                        .h(rect.size.height),
                )
            })
            .when_some(controls, |d, controls| d.child(controls))
            .when(connecting, |d| {
                d.child(
                    div()
                        .id("cloud-screen-connecting")
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(meta))
                        .line_height(relative(1.45))
                        .text_color(t.subtle)
                        .child(tr("cloud.sandbox.screen.connecting")),
                )
            });

        if self.transition_from_pip
            && self.transition_seq > 0
            && !cfg!(test)
            && !cx.reduce_motion()
            && let Some(vp) = self.viewport_bounds
        {
            let ew = f32::from(vp.size.width).max(PIP_WIDTH);
            let eh = f32::from(vp.size.height).max(PIP_HEIGHT);
            let start_x = (ew - PIP_WIDTH - PIP_INSET).max(PIP_INSET);
            let start_y = (eh - PIP_HEIGHT - PIP_INSET).max(PIP_INSET);
            div()
                .relative()
                .size_full()
                .overflow_hidden()
                .child(stage.with_animation(
                    ("cloud-screen-expand-morph", self.transition_seq),
                    Animation::new(Duration::from_millis(320)),
                    move |d, delta| {
                        let k = 1. - (1. - delta).powi(3);
                        let x = start_x * (1. - k);
                        let y = start_y * (1. - k);
                        let w = PIP_WIDTH + (ew - PIP_WIDTH) * k;
                        let h = PIP_HEIGHT + (eh - PIP_HEIGHT) * k;
                        let r = PIP_RADIUS * (1. - k);
                        d.absolute()
                            .left(px(x))
                            .top(px(y))
                            .w(px(w))
                            .h(px(h))
                            .rounded(px(r))
                    },
                ))
                .into_any_element()
        } else {
            stage.into_any_element()
        }
    }
}
