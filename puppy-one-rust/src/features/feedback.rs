//! The Help launcher's feedback dialog (`DesktopHelpLauncher.tsx`,
//! `desktop-help-launcher.css`): a required message (2000 characters), a
//! required contact email and an optional screenshot (chosen, pasted into
//! the message or dropped on the form; PNG, JPEG or WebP, compressed above
//! 3 MiB), sent to the public feedback form off the UI thread. Only the
//! close button dismisses it (Escape and backdrop presses keep the draft);
//! closing discards everything. Send shows Sending…, then Sent — thank you.
//! (the form locks) or Couldn’t send (editing re-arms it).
use crate::{
    localization::t as tr,
    platform::feedback::{self as service, PrepareError, Screenshot},
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{Dialog, Icon, tooltip},
        form_input::{InputEvent, TextInput},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
use std::{path::PathBuf, sync::Arc};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Submission {
    Idle,
    Sending,
    Sent,
    Error,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Attachment {
    Idle,
    Processing,
    Error(SharedString),
}

/// The dialog asked to close (the owner removes it).
pub struct Close;

pub struct Feedback {
    pub message: Entity<TextInput>,
    pub email: Entity<TextInput>,
    focus: FocusHandle,
    pub submission: Submission,
    pub attachment: Attachment,
    screenshot: Option<(Screenshot, Arc<Image>)>,
    dragging: bool,
    /// Results of superseded work are ignored (`submissionIdRef`, `attachmentIdRef`).
    submission_id: u64,
    attachment_id: u64,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<Close> for Feedback {}

impl Feedback {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = |placeholder: SharedString,
                     multiline: bool,
                     max: usize,
                     window: &mut Window,
                     cx: &mut Context<Self>| {
            cx.new(|cx| {
                let mut input = TextInput::new(placeholder, multiline, max, window, cx);
                input.appearance = false;
                input
            })
        };
        let message = field(
            tr("shell.feedback.placeholder").into(),
            true,
            service::MAX_MESSAGE,
            window,
            cx,
        );
        message.update(cx, |input, _| {
            // `.desktop-feedback-composer textarea`: 14px over 20.3px lines,
            // 130px tall with its 10px block padding.
            input.prompt_text = Some((theme::ty().ui.body, theme::ty().ui.body * 1.45));
            input.min_height = 110.;
        });
        let email = field(
            tr("shell.feedback.contactPlaceholder").into(),
            false,
            service::MAX_EMAIL,
            window,
            cx,
        );
        email.update(cx, |input, _| {
            input.prompt_text = Some((theme::ty().ui.body, theme::ty().ui.body * 1.45));
        });
        // Editing after a failure re-arms Send (`if (submissionState === "error")`).
        let rearm =
            |this: &mut Self, _: Entity<TextInput>, event: &InputEvent, cx: &mut Context<Self>| {
                if matches!(event, InputEvent::Changed) {
                    if this.submission == Submission::Error {
                        this.submission = Submission::Idle;
                    }
                    cx.notify();
                }
            };
        let subscriptions = vec![cx.subscribe(&message, rearm), cx.subscribe(&email, rearm)];
        Self {
            message,
            email,
            focus: cx.focus_handle(),
            submission: Submission::Idle,
            attachment: Attachment::Idle,
            screenshot: None,
            dragging: false,
            submission_id: 0,
            attachment_id: 0,
            _subscriptions: subscriptions,
        }
    }

    #[cfg(test)]
    pub fn contains_focused(&self, window: &Window, cx: &App) -> bool {
        self.focus.contains_focused(window, cx)
    }

    /// The close button: forget the draft and ask the owner to remove it.
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.reset(cx);
        cx.emit(Close);
    }
    /// `close()`: abandon pending work and forget the draft.
    pub fn reset(&mut self, cx: &mut Context<Self>) {
        self.submission_id += 1;
        self.attachment_id += 1;
        self.submission = Submission::Idle;
        self.attachment = Attachment::Idle;
        self.screenshot = None;
        self.dragging = false;
        self.message.update(cx, |i, cx| i.clear(cx));
        self.email.update(cx, |i, cx| i.clear(cx));
        cx.notify();
    }

    fn locked(&self) -> bool {
        matches!(self.submission, Submission::Sending | Submission::Sent)
    }
    /// `canSend`.
    pub fn can_send(&self, cx: &App) -> bool {
        !self.email.read(cx).text().trim().is_empty()
            && !self.message.read(cx).text().trim().is_empty()
            && !self.locked()
            && self.attachment != Attachment::Processing
    }
    #[cfg(test)]
    pub fn has_screenshot(&self) -> bool {
        self.screenshot.is_some()
    }

    /// Prepare a screenshot off the UI thread; a newer one supersedes it.
    fn attach(
        &mut self,
        prepare: impl FnOnce() -> Result<Screenshot, PrepareError> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        self.attachment_id += 1;
        let id = self.attachment_id;
        self.attachment = Attachment::Processing;
        cx.notify();
        let task = cx.background_spawn(async move { prepare() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.attachment_id != id {
                    return;
                }
                match result {
                    Ok(shot) => s.install_screenshot(shot),
                    Err(error) => {
                        s.attachment = Attachment::Error(
                            tr(match error {
                                PrepareError::Unsupported => "shell.feedback.screenshotUnsupported",
                                PrepareError::TooLarge => "shell.feedback.screenshotTooLarge",
                            })
                            .into(),
                        )
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn install_screenshot(&mut self, shot: Screenshot) {
        let format = match shot.mime {
            service::Mime::Png => ImageFormat::Png,
            service::Mime::Jpeg => ImageFormat::Jpeg,
            service::Mime::Webp => ImageFormat::Webp,
        };
        let preview = Arc::new(Image::from_bytes(format, shot.bytes.clone()));
        self.screenshot = Some((shot, preview));
        self.attachment = Attachment::Idle;
    }
    /// A chosen or dropped file: at most 20 MiB is read.
    pub fn attach_path(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.attach(
            move || {
                let size = std::fs::metadata(&path)
                    .map_err(|_| PrepareError::Unsupported)?
                    .len();
                if size == 0 || size > service::MAX_SOURCE_SCREENSHOT {
                    // Type first, like the product's MIME check.
                    let head = std::fs::read(&path)
                        .ok()
                        .map(|b| b.into_iter().take(16).collect::<Vec<_>>());
                    return Err(match head.as_deref().and_then(service::Mime::sniff) {
                        Some(_) => PrepareError::TooLarge,
                        None => PrepareError::Unsupported,
                    });
                }
                service::prepare(std::fs::read(&path).map_err(|_| PrepareError::Unsupported)?)
            },
            cx,
        );
    }
    /// An image pasted into the message.
    pub fn attach_pasted(&mut self, bytes: Vec<u8>, cx: &mut Context<Self>) {
        self.attach(move || service::prepare_pasted(bytes), cx);
    }
    #[cfg(feature = "dev-capture")]
    pub fn attach_now(&mut self, bytes: Vec<u8>, cx: &mut Context<Self>) {
        if let Ok(shot) = service::prepare(bytes) {
            self.install_screenshot(shot);
            cx.notify();
        }
    }
    fn remove_screenshot(&mut self, cx: &mut Context<Self>) {
        self.screenshot = None;
        self.attachment = Attachment::Idle;
        cx.notify();
    }
    fn choose_screenshot(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: None,
        });
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(Some(paths))) = paths.await
                && let Some(path) = paths.into_iter().next()
            {
                this.update(cx, |s, cx| s.attach_path(path, cx)).ok();
            }
        })
        .detach();
    }

    /// `handleSubmit`.
    pub fn submit(&mut self, cx: &mut Context<Self>) {
        let message = self.message.read(cx).text().trim().to_string();
        let email = self.email.read(cx).text().trim().to_string();
        if !service::valid_email(&email) || message.is_empty() {
            self.submission = Submission::Error;
            cx.notify();
            return;
        }
        if !self.can_send(cx) {
            return;
        }
        self.submission_id += 1;
        let id = self.submission_id;
        self.submission = Submission::Sending;
        cx.notify();
        let request = service::Request {
            message,
            email,
            locale: crate::localization::current_code(),
            screenshot: self.screenshot.as_ref().map(|(shot, _)| shot.clone()),
        };
        let task = cx
            .background_spawn(async move { service::submit(&request, env!("CARGO_PKG_VERSION")) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.submission_id != id {
                    return;
                }
                s.submission = if result.is_ok() {
                    Submission::Sent
                } else {
                    Submission::Error
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// The pixel lab's states (`tools/shell-scenarios.json`).
    #[cfg(feature = "dev-capture")]
    pub fn lab_state(&mut self, scenario: &str, cx: &mut Context<Self>) {
        if scenario == "feedback" {
            return;
        }
        self.message.update(cx, |i, cx| {
            i.set_text("The sidebar flickers when I resize the window.", cx)
        });
        self.email
            .update(cx, |i, cx| i.set_text("person@example.com", cx));
        if scenario != "feedback-error" {
            self.attach_now(
                include_bytes!("../../fixtures/feedback/screenshot.png").to_vec(),
                cx,
            );
        }
        self.submission = match scenario {
            "feedback-sent" => Submission::Sent,
            "feedback-error" => Submission::Error,
            _ => Submission::Idle,
        };
    }
}

impl Render for Feedback {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        if !cx.has_active_drag() {
            self.dragging = false;
        }
        let locked = self.locked();
        for input in [&self.message, &self.email] {
            input.update(cx, |i, _| {
                i.disabled = locked;
                i.placeholder_color = Some(t.subtle);
            });
        }
        let ty = theme::ty().ui;
        let message_focused = self.message.focus_handle(cx).contains_focused(window, cx);
        let email_focused = self.email.focus_handle(cx).contains_focused(window, cx);
        let email = self.email.read(cx).text().trim().to_string();
        let email_invalid = !email.is_empty() && !service::valid_email(&email);

        // `.desktop-feedback-field-label` with its red required marker.
        let label = |key: &str| {
            h_flex()
                .gap(px(4.))
                .pb(px(8.))
                .text_size(px(ty.meta))
                .line_height(px(ty.meta * 1.25))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.muted)
                .child(tr(key))
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .line_height(px(ty.meta))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(t.danger)
                        .child("*"),
                )
        };
        let composer = div()
            .id("feedback-composer")
            .min_h(px(132.))
            .overflow_hidden()
            .border_1()
            .rounded(px(6.))
            .map(|d| {
                if self.dragging {
                    d.border_color(theme::mix(t.accent, t.border, 0.62))
                        .bg(theme::mix(t.accent, t.canvas, 0.05))
                } else {
                    d.border_color(if message_focused {
                        t.border_strong
                    } else {
                        t.divider
                    })
                    .bg(t.input)
                }
            })
            // Kit's editor keeps 4px of its own inline padding.
            .pt(px(10.))
            .pb(px(10.))
            .px(px(7.))
            .when(locked, |d| d.opacity(0.74))
            .capture_action(cx.listener(|s, _: &gpui_kit::base::input::Paste, _, cx| {
                // An image on the clipboard becomes the screenshot; text pastes.
                let image = cx.read_from_clipboard().and_then(|item| {
                    item.entries().iter().find_map(|entry| match entry {
                        ClipboardEntry::Image(image) => Some(image.bytes.clone()),
                        _ => None,
                    })
                });
                if let Some(bytes) = image {
                    s.attach_pasted(bytes, cx);
                    cx.stop_propagation();
                }
            }))
            .child(self.message.clone());
        let attachment_row = h_flex()
            .min_h(px(theme::control()))
            .mt(px(6.))
            .items_center()
            .child(
                h_flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(4.))
                    .child(match &self.screenshot {
                        Some((_, preview)) => self.screenshot_button(preview.clone(), t, cx),
                        None => self.attach_button(t, cx),
                    })
                    .when(matches!(self.attachment, Attachment::Error(_)), |d| {
                        // `.desktop-feedback-attachment-error`.
                        d.child(
                            div()
                                .flex()
                                .w(px(20.))
                                .h(px(28.))
                                .items_center()
                                .justify_center()
                                .child(
                                    Icon::new("circle-alert")
                                        .stroke(1.8)
                                        .with_size(px(14.))
                                        .color(t.danger),
                                ),
                        )
                    }),
            );
        let contact = div()
            .h(px(theme::control()))
            .flex()
            .items_center()
            .border_1()
            .rounded(px(6.))
            .bg(t.input)
            .border_color(if email_invalid {
                theme::mix(t.danger, t.border, 0.62)
            } else if email_focused {
                t.border_strong
            } else {
                t.divider
            })
            .px(px(5.))
            .when(locked, |d| d.opacity(0.74))
            .child(self.email.clone());
        let form = v_flex()
            .id("feedback-form")
            .min_w_0()
            .on_drag_move::<ExternalPaths>(cx.listener(
                |s, e: &DragMoveEvent<ExternalPaths>, _, cx| {
                    let inside = e.bounds.contains(&e.event.position);
                    if s.dragging != inside {
                        s.dragging = inside;
                        cx.notify();
                    }
                },
            ))
            .on_drop(cx.listener(|s, paths: &ExternalPaths, _, cx| {
                s.dragging = false;
                let image = paths.paths().iter().find(|p| {
                    p.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                        matches!(
                            e.to_ascii_lowercase().as_str(),
                            "png"
                                | "jpg"
                                | "jpeg"
                                | "webp"
                                | "gif"
                                | "heic"
                                | "tif"
                                | "tiff"
                                | "bmp"
                                | "avif"
                                | "svg"
                        )
                    })
                });
                if let Some(path) = image.cloned() {
                    s.attach_path(path, cx);
                } else {
                    cx.notify();
                }
            }))
            .child(
                v_flex()
                    .min_w_0()
                    .pt(px(2.))
                    .px(px(20.))
                    .pb(px(16.))
                    .child(label("shell.feedback.messageLabel"))
                    .child(composer)
                    .child(attachment_row),
            )
            .child(
                v_flex()
                    .min_w_0()
                    .px(px(20.))
                    .pb(px(16.))
                    .child(label("shell.feedback.contactLabel"))
                    .child(contact),
            );
        let status = div()
            .flex_1()
            .min_w_0()
            .overflow_hidden()
            .text_ellipsis()
            .whitespace_nowrap()
            .text_size(px(ty.meta))
            .line_height(px(ty.meta * 1.3))
            .text_color(t.subtle)
            .when_some(
                match &self.attachment {
                    Attachment::Error(text) => Some(text.clone()),
                    _ => None,
                },
                |d, text| d.child(text),
            );
        let footer = h_flex()
            .w_full()
            .min_h(px(theme::control()))
            .items_center()
            .justify_between()
            .gap(px(10.))
            .child(status)
            .child(self.submit_button(t, cx));
        let host = cx.entity().downgrade();
        Dialog::new("feedback")
            .width(400.)
            .heading(
                div()
                    .text_size(px(ty.body))
                    .line_height(px(18.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tr("shell.feedback.label")),
            )
            .center_header()
            .header_bottom(10.)
            .body_inline(0.)
            .body_padding(0., 0.)
            .focus_handle(self.focus.clone())
            .keep_on_backdrop()
            .keep_on_escape()
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| s.close(cx));
            })
            .child(form)
            .footer(footer)
    }
}

impl Feedback {
    /// `.desktop-feedback-attach`: 28px, the image-plus glyph (a turning
    /// loader while a screenshot is prepared).
    fn attach_button(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let processing = self.attachment == Attachment::Processing;
        let disabled = processing || self.locked();
        let label = tr("shell.feedback.attachScreenshot");
        let icon = if processing {
            Icon::new("loader-circle")
                .stroke(1.8)
                .with_size(px(16.))
                .spinning("feedback-attach-spinner")
        } else {
            Icon::new("image-plus").stroke(1.7).with_size(px(16.))
        };
        let color = if disabled {
            t.text_disabled
        } else if self.dragging {
            t.accent
        } else {
            t.subtle
        };
        div()
            .id("feedback-attach")
            .flex()
            .flex_shrink_0()
            .size(px(theme::control_compact()))
            .items_center()
            .justify_center()
            .rounded(px(7.))
            .text_color(color)
            .tooltip(tooltip(label))
            .when(!disabled, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(t.muted))
                    .on_click(cx.listener(|s, _, _, cx| s.choose_screenshot(cx)))
            })
            .child(icon.color(color))
            .into_any_element()
    }
    /// `.desktop-feedback-screenshot`: the 32px thumbnail; hovering shows the
    /// remove affordance.
    fn screenshot_button(
        &self,
        preview: Arc<Image>,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let locked = self.locked();
        div()
            .id("feedback-screenshot")
            .group("feedback-screenshot")
            .relative()
            .flex_shrink_0()
            .size(px(theme::control()))
            .overflow_hidden()
            .border_1()
            .border_color(t.border)
            .rounded(px(7.))
            .bg(t.canvas)
            .tooltip(tooltip(tr("shell.feedback.removeScreenshot")))
            .when(locked, |d| d.opacity(0.7))
            .when(!locked, |d| {
                d.cursor(theme::clickable_cursor())
                    .on_click(cx.listener(|s, _, _, cx| s.remove_screenshot(cx)))
            })
            .child(img(preview).size_full().object_fit(ObjectFit::Cover))
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(theme::alpha(t.text, 0.56))
                    .invisible()
                    .when(!locked, |d| {
                        d.group_hover("feedback-screenshot", |s| s.visible())
                    })
                    .child(
                        Icon::new("trash-2")
                            .stroke(1.9)
                            .with_size(px(12.))
                            .color(t.text_inverse),
                    ),
            )
            .into_any_element()
    }
    /// `.desktop-dialog-button.primary.desktop-feedback-submit` and its
    /// sending / sent / error states.
    fn submit_button(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let can_send = self.can_send(cx);
        let (label, icon) = match self.submission {
            Submission::Idle => ("shell.feedback.send", None),
            Submission::Sending => (
                "shell.feedback.sending",
                Some(
                    Icon::new("loader-circle")
                        .stroke(1.9)
                        .spinning("feedback-send-spinner"),
                ),
            ),
            Submission::Sent => ("shell.feedback.sent", Some(Icon::new("check").stroke(2.))),
            Submission::Error => (
                "shell.feedback.error",
                Some(Icon::new("circle-alert").stroke(1.9)),
            ),
        };
        let (border, bg, fg) = if self.submission == Submission::Sent {
            (t.success, t.success, theme::success_contrast(t.dark))
        } else if !can_send {
            (t.border, t.control, t.text_disabled)
        } else {
            (t.text, t.text, t.text_inverse)
        };
        let hover = theme::mix(t.text, t.panel, 0.88);
        div()
            .id("feedback-send")
            .flex()
            .flex_shrink_0()
            .min_w(px(78.))
            .h(px(theme::control()))
            .px(px(14.))
            .gap(px(6.))
            .items_center()
            .justify_center()
            .border_1()
            .rounded(px(6.))
            .border_color(border)
            .bg(bg)
            .text_color(fg)
            .text_size(px(theme::ty().ui.body))
            .line_height(px(theme::ty().ui.body))
            .font_weight(FontWeight::SEMIBOLD)
            .whitespace_nowrap()
            .when(can_send, |d| {
                d.cursor(theme::clickable_cursor())
                    .when(self.submission != Submission::Sent, |d| {
                        d.hover(move |s| s.bg(hover).border_color(hover))
                    })
                    .on_click(cx.listener(|s, _, _, cx| s.submit(cx)))
            })
            .children(icon.map(|i| i.with_size(px(14.)).color(fg)))
            .child(tr(label))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn open(cx: &mut TestAppContext) -> (Entity<Feedback>, &mut VisualTestContext) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            crate::ui::form_input::bind_keys(cx);
        });
        let mut entity = None;
        let (_, cx) = cx.add_window_view(|w, cx| {
            let view = cx.new(|cx| Feedback::new(w, cx));
            entity = Some(view.clone());
            gpui_kit::base::Root::new(view, w, cx)
        });
        (entity.unwrap(), cx)
    }

    #[gpui::test]
    fn send_needs_a_message_and_an_email_and_a_failure_rearms_on_edit(cx: &mut TestAppContext) {
        let (view, cx) = open(cx);
        view.update(cx, |f, cx| assert!(!f.can_send(cx)));
        view.update(cx, |f, cx| {
            f.message.update(cx, |i, cx| i.set_text("  hi  ", cx));
        });
        view.update(cx, |f, cx| assert!(!f.can_send(cx)));
        view.update(cx, |f, cx| {
            f.email.update(cx, |i, cx| i.set_text("not an email", cx));
        });
        // Send is offered, but an invalid address fails without a request.
        view.update(cx, |f, cx| {
            assert!(f.can_send(cx));
            f.submit(cx);
            assert_eq!(f.submission, Submission::Error);
        });
        // Typing re-arms it.
        view.update_in(cx, |f, w, cx| {
            f.email.update(cx, |i, cx| {
                use gpui::EntityInputHandler as _;
                i.replace_text_in_range(None, "x", w, cx)
            });
        });
        cx.run_until_parked();
        view.update(cx, |f, _| assert_eq!(f.submission, Submission::Idle));
    }

    #[gpui::test]
    fn screenshots_attach_replace_and_report_unsupported_files(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let (view, cx) = open(cx);
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("shot.png");
        std::fs::write(
            &png,
            include_bytes!("../../fixtures/feedback/screenshot.png"),
        )
        .unwrap();
        let text = dir.path().join("notes.txt");
        std::fs::write(&text, "not an image").unwrap();
        view.update(cx, |f, cx| f.attach_path(text, cx));
        view.update(cx, |f, _| assert_eq!(f.attachment, Attachment::Processing));
        cx.run_until_parked();
        view.update(cx, |f, cx| {
            assert_eq!(
                f.attachment,
                Attachment::Error(tr("shell.feedback.screenshotUnsupported").into())
            );
            assert!(!f.has_screenshot());
            f.attach_path(png, cx);
        });
        cx.run_until_parked();
        view.update(cx, |f, cx| {
            assert_eq!(f.attachment, Attachment::Idle);
            assert!(f.has_screenshot());
            f.remove_screenshot(cx);
            assert!(!f.has_screenshot());
        });
        // A paste that arrives after the dialog closed is ignored.
        view.update(cx, |f, cx| {
            f.attach_pasted(
                include_bytes!("../../fixtures/feedback/screenshot.png").to_vec(),
                cx,
            );
            f.reset(cx);
        });
        cx.run_until_parked();
        view.update(cx, |f, _| {
            assert!(!f.has_screenshot());
            assert_eq!(f.attachment, Attachment::Idle);
        });
    }

    #[gpui::test]
    fn a_pasted_image_becomes_the_screenshot_and_text_still_pastes(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let (view, cx) = open(cx);
        cx.update(|w, cx| {
            let message = view.read(cx).message.focus_handle(cx);
            message.focus(w, cx);
            let _ = w.draw(cx);
        });
        cx.write_to_clipboard(ClipboardItem::new_string("typed via paste".into()));
        cx.dispatch_action(gpui_kit::base::input::Paste);
        cx.run_until_parked();
        view.update(cx, |f, cx| {
            assert_eq!(f.message.read(cx).text(), "typed via paste");
            assert!(!f.has_screenshot());
        });
        let image = Image::from_bytes(
            ImageFormat::Png,
            include_bytes!("../../fixtures/feedback/screenshot.png").to_vec(),
        );
        cx.write_to_clipboard(ClipboardItem {
            entries: vec![ClipboardEntry::Image(image)],
        });
        cx.dispatch_action(gpui_kit::base::input::Paste);
        cx.run_until_parked();
        view.update(cx, |f, cx| {
            assert!(f.has_screenshot());
            assert_eq!(f.message.read(cx).text(), "typed via paste");
        });
    }
}
