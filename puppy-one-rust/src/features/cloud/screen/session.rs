//! Session lifecycle, 3× auto-reconnect, GPU frame swapping, and input
//! forwarding for [`super::CloudScreen`].
use super::{
    CloudScreen, StreamPhase,
    keys::button_bit,
    motion,
    rfb::{self, Frame, FrameSlot, RfbCommand},
};
use crate::{
    cloud::auth::{Cancellation, ScreenSocket},
    workspace::cloud::sandbox::{
        CLOUD_SCREEN_RECONNECTS, SandboxSettings, SandboxTarget, ScreenConnectError,
    },
};
use gpui::{
    Bounds, Context, KeyDownEvent, KeyUpEvent, ModifiersChangedEvent, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, Pixels, RenderImage, ScrollWheelEvent, Window, px,
};
use image::{Frame as ImageFrame, RgbaImage};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

/// Where a session's display comes from: a Cloud Computer's screen
/// session, or the loopback VNC port of a computer on this computer.
#[derive(Clone)]
enum Connector {
    Cloud(SandboxTarget),
    Local(u16),
}
impl Connector {
    fn connect(&self, cancel: &Cancellation) -> Result<ScreenSocket, ScreenConnectError> {
        match self {
            Self::Cloud(target) => target.connect_screen(cancel),
            Self::Local(port) => {
                cancel.check().map_err(|_| ScreenConnectError::Failed)?;
                let address = std::net::SocketAddr::from(([127, 0, 0, 1], *port));
                let stream = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(3))
                    .map_err(|_| ScreenConnectError::Failed)?;
                let _ = stream.set_nodelay(true);
                ScreenSocket::tcp(stream).map_err(|_| ScreenConnectError::Failed)
            }
        }
    }
}

impl CloudScreen {
    pub(super) fn apply_setting(&mut self, patch: SandboxSettings, cx: &mut Context<Self>) {
        let Some(target) = self.target.clone() else {
            return;
        };
        if self.saving {
            return;
        }
        self.saving = true;
        cx.notify();
        let project = target.project_id().to_owned();
        let cancel = Cancellation::default();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { target.update(patch, &cancel) })
                .await;
            let _ = this.update(cx, |s, cx| {
                s.saving = false;
                if let Ok(updated) = result {
                    s.sync_sandbox(&project, updated, cx);
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn start_stream(&mut self, cx: &mut Context<Self>) {
        let target = match (self.local_port(cx), self.target.clone()) {
            (Some(port), _) => Connector::Local(port),
            (None, Some(target)) if !self.is_local() => Connector::Cloud(target),
            _ => return,
        };
        self.teardown_session(cx);
        self.generation = self.generation.wrapping_add(1);
        let generation = self.generation;
        self.phase = StreamPhase::Connecting;
        let delay = self.reconnect_delay;

        self.session_task = Some(cx.spawn(async move |this, cx| {
            let mut drops: u32 = 0;
            loop {
                let stream_cancel = Cancellation::default();
                let current = this
                    .update(cx, |s, _| {
                        if s.generation != generation {
                            return false;
                        }
                        if let Some(prev) = s.stream_cancel.replace(stream_cancel.clone()) {
                            prev.cancel();
                        }
                        true
                    })
                    .unwrap_or(false);
                if !current {
                    return;
                }
                let connect_target = target.clone();
                let connect_cancel = stream_cancel.clone();
                let opened = cx
                    .background_executor()
                    .spawn(async move { connect_target.connect(&connect_cancel) })
                    .await;
                let socket = match opened {
                    Ok(socket) => socket,
                    Err(ScreenConnectError::Asleep) => {
                        let _ = this.update(cx, |s, cx| {
                            if s.generation == generation {
                                s.teardown_active_handles(cx);
                                s.phase = StreamPhase::Asleep;
                                cx.notify();
                            }
                        });
                        return;
                    }
                    Err(ScreenConnectError::Failed) => {
                        let _ = this.update(cx, |s, cx| {
                            if s.generation == generation {
                                s.teardown_active_handles(cx);
                                s.phase = StreamPhase::Failed;
                                cx.notify();
                            }
                        });
                        return;
                    }
                };

                let (cmd_tx, cmd_rx) = async_channel::bounded::<RfbCommand>(256);
                let (slot, wake_rx) = FrameSlot::pair();
                let initial_size = this
                    .update(cx, |s, _| {
                        if s.generation != generation {
                            return None;
                        }
                        s.command_tx = Some(cmd_tx.clone());
                        s.phase = StreamPhase::Connecting;
                        // One fixed desktop, whatever the window.
                        Some(motion::DESKTOP)
                    })
                    .ok()
                    .flatten();
                if let Some((w, h)) = initial_size {
                    let _ = cmd_tx.try_send(RfbCommand::Resize {
                        width: w,
                        height: h,
                    });
                }

                let connected_flag = Arc::new(AtomicBool::new(false));
                let connected_mark = connected_flag.clone();
                let rfb_slot = slot.clone();
                let rfb_job = cx.background_executor().spawn(async move {
                    rfb::run_session(
                        socket,
                        cmd_rx,
                        move || connected_mark.store(true, Ordering::Release),
                        rfb_slot,
                    )
                    .await
                });

                let ui_this = this.clone();
                let ui_flag = connected_flag.clone();
                let pump = cx.spawn(async move |cx| {
                    while wake_rx.recv().await.is_ok() {
                        let Some(frame) = slot.take() else {
                            continue;
                        };
                        let ok = ui_this.update(cx, |s, cx| {
                            if s.generation == generation {
                                if ui_flag.load(Ordering::Acquire) {
                                    s.phase = StreamPhase::Connected;
                                }
                                s.present_frame(frame, cx);
                            }
                        });
                        if ok.is_err() {
                            break;
                        }
                    }
                });

                let _ = rfb_job.await;
                drop(pump);

                let still_current = this
                    .update(cx, |s, _| s.generation == generation)
                    .unwrap_or(false);
                if !still_current {
                    return;
                }
                if connected_flag.load(Ordering::Acquire) {
                    drops = 0;
                }
                if drops < CLOUD_SCREEN_RECONNECTS {
                    drops += 1;
                    let _ = this.update(cx, |s, cx| {
                        if s.generation == generation {
                            s.command_tx = None;
                            s.phase = StreamPhase::Connecting;
                            cx.notify();
                        }
                    });
                    cx.background_executor().timer(delay).await;
                    let alive = this
                        .update(cx, |s, _| s.generation == generation)
                        .unwrap_or(false);
                    if !alive {
                        return;
                    }
                    continue;
                }

                let _ = this.update(cx, |s, cx| {
                    if s.generation == generation {
                        s.teardown_active_handles(cx);
                        s.phase = StreamPhase::Failed;
                        cx.notify();
                    }
                });
                return;
            }
        }));
    }

    pub(super) fn present_frame(&mut self, frame: Frame, cx: &mut Context<Self>) {
        let Some(rgba) = RgbaImage::from_raw(frame.width, frame.height, frame.bgra) else {
            return;
        };
        let image = Arc::new(RenderImage::new(vec![ImageFrame::new(rgba)]));
        let old = self.frame_image.replace(image);
        self.frame_dims = Some((frame.width, frame.height));
        if let Some(old) = old {
            cx.drop_image(old, None);
        }
        cx.notify();
    }

    pub(super) fn teardown_active_handles(&mut self, cx: &mut Context<Self>) {
        self.release_inputs();
        self.interactive = false;
        self.command_tx = None;
        if let Some(cancel) = self.stream_cancel.take() {
            cancel.cancel();
        }
        self.frame_dims = None;
        if let Some(old) = self.frame_image.take() {
            cx.drop_image(old, None);
        }
    }

    pub(super) fn teardown_session(&mut self, cx: &mut Context<Self>) {
        self.generation = self.generation.wrapping_add(1);
        self.session_task = None;
        self.phase = StreamPhase::Idle;
        self.teardown_active_handles(cx);
    }

    pub(super) fn send_cmd(&self, cmd: RfbCommand) {
        if let Some(tx) = &self.command_tx {
            let _ = tx.try_send(cmd);
        }
    }

    pub(super) fn release_inputs(&mut self) {
        for cmd in self.input.release_all() {
            self.send_cmd(cmd);
        }
    }

    /// Where the main area is, so the pointer lands on the right desktop
    /// pixel. The desktop never follows it: its size is [`motion::DESKTOP`].
    pub(super) fn update_viewport_bounds(&mut self, bounds: Bounds<Pixels>, _: &mut Context<Self>) {
        self.viewport_bounds = Some(bounds);
    }

    pub(super) fn on_mouse_down(
        &mut self,
        e: &MouseDownEvent,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.interactive || !self.shown {
            return;
        }
        self.focus.focus(w, cx);
        if let Some((x, y)) = self.pointer_at(e.position)
            && let Some(bit) = button_bit(e.button)
        {
            self.input.buttons |= bit;
            self.input.last_pos = (x, y);
            self.send_cmd(RfbCommand::Pointer {
                mask: self.input.buttons,
                x,
                y,
            });
        }
        cx.stop_propagation();
    }

    pub(super) fn on_mouse_up(&mut self, e: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.interactive || !self.shown {
            return;
        }
        // Only a press the desktop saw is released there (not one in the
        // margin around it).
        if let Some(bit) = button_bit(e.button)
            && self.input.buttons & bit != 0
        {
            self.input.buttons &= !bit;
            let (x, y) = self.pointer_at(e.position).unwrap_or(self.input.last_pos);
            self.input.last_pos = (x, y);
            self.send_cmd(RfbCommand::Pointer {
                mask: self.input.buttons,
                x,
                y,
            });
        }
        cx.stop_propagation();
    }

    pub(super) fn on_mouse_move(
        &mut self,
        e: &MouseMoveEvent,
        _: &mut Window,
        _: &mut Context<Self>,
    ) {
        if !self.interactive || !self.shown {
            return;
        }
        if let Some((x, y)) = self.pointer_at(e.position)
            && self.input.last_pos != (x, y)
        {
            self.input.last_pos = (x, y);
            self.send_cmd(RfbCommand::Pointer {
                mask: self.input.buttons,
                x,
                y,
            });
        }
    }

    pub(super) fn on_scroll(
        &mut self,
        e: &ScrollWheelEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.interactive || !self.shown {
            return;
        }
        if let Some((x, y)) = self.pointer_at(e.position) {
            self.input.last_pos = (x, y);
            let delta = e.delta.pixel_delta(px(24.));
            self.input.scroll_accum_y += f32::from(delta.y);
            self.input.scroll_accum_x += f32::from(delta.x);
            let steps_y = (self.input.scroll_accum_y / 24.).trunc().clamp(-16., 16.) as i32;
            self.input.scroll_accum_y -= (steps_y as f32) * 24.;
            let bit_y = if steps_y > 0 { 1 << 3 } else { 1 << 4 };
            for _ in 0..steps_y.unsigned_abs() {
                self.send_cmd(RfbCommand::Pointer {
                    mask: self.input.buttons | bit_y,
                    x,
                    y,
                });
                self.send_cmd(RfbCommand::Pointer {
                    mask: self.input.buttons,
                    x,
                    y,
                });
            }
            let steps_x = (self.input.scroll_accum_x / 24.).trunc().clamp(-16., 16.) as i32;
            self.input.scroll_accum_x -= (steps_x as f32) * 24.;
            let bit_x = if steps_x > 0 { 1 << 5 } else { 1 << 6 };
            for _ in 0..steps_x.unsigned_abs() {
                self.send_cmd(RfbCommand::Pointer {
                    mask: self.input.buttons | bit_x,
                    x,
                    y,
                });
                self.send_cmd(RfbCommand::Pointer {
                    mask: self.input.buttons,
                    x,
                    y,
                });
            }
        }
        cx.stop_propagation();
    }

    pub(super) fn on_key_down(&mut self, e: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.interactive || !self.shown {
            return;
        }
        if e.keystroke.modifiers.platform {
            return;
        }
        if e.keystroke.key.eq_ignore_ascii_case("escape")
            && !e.keystroke.modifiers.control
            && !e.keystroke.modifiers.alt
            && !e.keystroke.modifiers.shift
        {
            self.release_control(cx);
            cx.stop_propagation();
            return;
        }
        for cmd in self.input.key_down(&e.keystroke) {
            self.send_cmd(cmd);
        }
        cx.stop_propagation();
    }

    pub(super) fn on_key_up(&mut self, e: &KeyUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.interactive || !self.shown {
            return;
        }
        if e.keystroke.modifiers.platform {
            return;
        }
        for cmd in self.input.key_up(&e.keystroke) {
            self.send_cmd(cmd);
        }
        cx.stop_propagation();
    }

    pub(super) fn on_modifiers(
        &mut self,
        e: &ModifiersChangedEvent,
        _: &mut Window,
        _: &mut Context<Self>,
    ) {
        if !self.interactive || !self.shown {
            return;
        }
        let mut cmds = Vec::new();
        self.input.sync_modifiers(e.modifiers, &mut cmds);
        for cmd in cmds {
            self.send_cmd(cmd);
        }
    }
}
