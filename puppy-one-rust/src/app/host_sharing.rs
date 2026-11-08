//! `HostFolderSharingDialog`: what the owner's other computers may do with
//! one folder on this computer. Every choice applies at once; the person is
//! asked in plain words before anything is widened (`native.host.*`), so
//! the dialog never asks a second time. Stopping asks first, too.
use super::window_cloud::WindowCloud;
use super::*;
use crate::features::hosts::{HostLink, SharedFolder};
use crate::localization::{bidi_isolate, t as tr, tf};
use crate::ui::components::{Button, ButtonVariant, Dialog, Switch};
use crate::workspace::hosts::registry::Execution;
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Target {
    /// Open a folder that is not shared yet.
    Share { root: PathBuf, name: String },
    /// A shared folder's settings.
    Settings { folder: String, name: String },
}
/// The question before a change takes effect.
#[derive(Clone, Debug, PartialEq)]
enum Ask {
    Share,
    Widen {
        writable: bool,
        execution: Execution,
    },
    Stop,
}
#[derive(Clone, Debug, PartialEq)]
pub(super) struct HostSharing {
    target: Target,
    writable: bool,
    pending: bool,
    error: Option<String>,
    ask: Option<Ask>,
}

impl WindowCloud {
    /// Opens the dialog; `stop` goes straight to "Stop access to this folder?".
    pub(super) fn open_host_sharing(
        &mut self,
        target: Target,
        stop: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let link = crate::features::hosts::host_link(cx);
        link.update(cx, |l, cx| {
            l.ensure(true, cx);
            l.refresh(cx);
        });
        self.host_sharing = Some(HostSharing {
            target,
            writable: false,
            pending: false,
            error: None,
            ask: stop.then_some(Ask::Stop),
        });
        self.open_dialog(DialogKey::HostSharing, cx);
        self.dialog_focus.focus(window, cx);
        cx.notify();
    }
    pub(super) fn close_host_sharing(&mut self, cx: &mut Context<Self>) {
        if self.host_sharing.as_ref().is_some_and(|s| s.pending) {
            return;
        }
        self.host_sharing = None;
        self.close_dialog(DialogKey::HostSharing, cx);
        cx.notify();
    }
    fn shared_folder(&self, cx: &App) -> Option<SharedFolder> {
        let Target::Settings { folder, .. } = &self.host_sharing.as_ref()?.target else {
            return None;
        };
        crate::features::hosts::read_link(cx)?
            .status
            .as_ref()?
            .folders
            .iter()
            .find(|f| &f.folder_id == folder)
            .cloned()
    }
    fn sharing_done(&mut self, result: Result<(), String>, close: bool, cx: &mut Context<Self>) {
        let Some(sharing) = self.host_sharing.as_mut() else {
            return;
        };
        sharing.pending = false;
        sharing.ask = None;
        match result {
            Ok(()) if close => self.close_host_sharing(cx),
            Ok(()) => {}
            Err(error) => sharing.error = Some(error),
        }
        cx.notify();
    }
    /// The answer to the question on screen.
    fn sharing_allow(&mut self, cx: &mut Context<Self>) {
        let Some(sharing) = self.host_sharing.clone() else {
            return;
        };
        let Some(ask) = sharing.ask.clone() else {
            return;
        };
        if let Some(s) = self.host_sharing.as_mut() {
            s.pending = true;
            s.error = None;
        }
        let link = crate::features::hosts::host_link(cx);
        let this = cx.weak_entity();
        let finish = move |close: bool| {
            let this = this.clone();
            move |_: &mut HostLink, result: Result<(), String>, cx: &mut Context<HostLink>| {
                let _ = this.update(cx, |s, cx| s.sharing_done(result, close, cx));
            }
        };
        match (ask, sharing.target) {
            (Ask::Share, Target::Share { root, .. }) => {
                let writable = sharing.writable;
                link.update(cx, |l, cx| {
                    let done = finish(true);
                    l.share(root, writable, cx, move |l, result, cx| {
                        done(l, result.map(|_| ()), cx)
                    })
                });
            }
            (Ask::Stop, Target::Settings { folder, .. }) => {
                link.update(cx, |l, cx| l.stop(folder, cx, finish(true)));
            }
            (
                Ask::Widen {
                    writable,
                    execution,
                },
                Target::Settings { .. },
            ) => {
                if let Some(folder) = self.shared_folder(cx) {
                    link.update(cx, |l, cx| {
                        l.set_access(&folder, writable, execution, cx, finish(false))
                    });
                }
            }
            _ => self.sharing_done(Ok(()), false, cx),
        }
        cx.notify();
    }
    /// A choice in the dialog: asked first when it widens, applied at once
    /// when it narrows.
    fn sharing_choose(&mut self, writable: bool, execution: Execution, cx: &mut Context<Self>) {
        let Some(sharing) = self.host_sharing.as_mut() else {
            return;
        };
        if sharing.pending {
            return;
        }
        if matches!(sharing.target, Target::Share { .. }) {
            sharing.writable = writable;
            return cx.notify();
        }
        let Some(folder) = self.shared_folder(cx) else {
            return;
        };
        let widening = (writable && !folder.writable)
            || (execution.terminal && !folder.execution.terminal)
            || (execution.git && !folder.execution.git)
            || (execution.agent && !folder.execution.agent);
        let sharing = self.host_sharing.as_mut().unwrap();
        sharing.error = None;
        sharing.ask = Some(Ask::Widen {
            writable,
            execution,
        });
        if !widening {
            self.sharing_allow(cx);
        }
        cx.notify();
    }

    /// Tests: the dialog's buttons, by what they say.
    #[cfg(test)]
    pub(super) fn sharing_press(&mut self, what: &str, cx: &mut Context<Self>) {
        match what {
            "share" | "stop" => {
                if let Some(sharing) = self.host_sharing.as_mut() {
                    sharing.ask = Some(if what == "share" {
                        Ask::Share
                    } else {
                        Ask::Stop
                    });
                }
            }
            "allow" => self.sharing_allow(cx),
            _ => {}
        }
        cx.notify();
    }
    #[cfg(test)]
    pub(super) fn sharing_set(
        &mut self,
        writable: bool,
        execution: Execution,
        cx: &mut Context<Self>,
    ) {
        self.sharing_choose(writable, execution, cx);
    }
    #[cfg(test)]
    pub(super) fn sharing_state(&self) -> Option<(bool, Option<String>)> {
        self.host_sharing
            .as_ref()
            .map(|s| (s.ask.is_some(), s.error.clone()))
    }
    pub(super) fn host_sharing_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let host = self.weak.clone();
        let sharing = self.host_sharing.clone().expect("open sharing dialog");
        let (name, share) = match &sharing.target {
            Target::Share { name, .. } => (name.clone(), true),
            Target::Settings { name, .. } => (name.clone(), false),
        };
        let shown = bidi_isolate(&name);
        let folder = self.shared_folder(cx);
        let link = crate::features::hosts::read_link(cx);
        let sandboxed = link
            .and_then(|l| l.status.as_ref())
            .is_some_and(|s| s.sandbox.is_some());
        let pending = sharing.pending;
        let close = {
            let host = host.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.close_host_sharing(cx));
            }
        };
        // The person's own answer, in the system's words.
        if let Some(ask) = &sharing.ask {
            let (title, message, detail, allow) = match ask {
                Ask::Share => (
                    tr("native.host.share.title").to_owned(),
                    tf(
                        if sharing.writable {
                            "native.host.share.write"
                        } else {
                            "native.host.share.read"
                        },
                        &[("name", shown.as_str().into())],
                    ),
                    Some(format!(
                        "{}\n\n{}",
                        tr("native.host.share.detail"),
                        tr("native.host.share.background")
                    )),
                    tr("native.host.allow"),
                ),
                Ask::Widen {
                    writable,
                    execution,
                } => {
                    let run = execution.terminal || execution.git || execution.agent;
                    let current = folder.as_ref().map(|f| f.execution).unwrap_or_default();
                    let more_run = (execution.terminal && !current.terminal)
                        || (execution.git && !current.git)
                        || (execution.agent && !current.agent);
                    if run && more_run {
                        (
                            tr("native.host.execution.title").to_owned(),
                            tf(
                                "native.host.execution.sandboxed",
                                &[("name", shown.as_str().into())],
                            ),
                            Some(tr("native.host.execution.sandboxedDetail").to_owned()),
                            tr("native.host.allow"),
                        )
                    } else {
                        let _ = writable;
                        (
                            tr("native.host.share.title").to_owned(),
                            tf(
                                "native.host.share.write",
                                &[("name", shown.as_str().into())],
                            ),
                            None,
                            tr("native.host.allow"),
                        )
                    }
                }
                Ask::Stop => (
                    tr("native.host.remove.title").to_owned(),
                    tr("native.host.remove.message").to_owned(),
                    None,
                    tr("native.host.remove"),
                ),
            };
            let danger = matches!(ask, Ask::Stop);
            return Dialog::new("host-sharing-ask")
                .width(420.)
                .title(title)
                .on_close(close.clone())
                .child(
                    v_flex()
                        .gap(px(8.))
                        .text_size(px(ty.body))
                        .line_height(relative(1.5))
                        .text_color(t.muted)
                        .child(message)
                        .children(detail.map(|d| div().text_size(px(ty.meta)).child(d)))
                        .children(sharing.error.clone().map(|e| {
                            div()
                                .debug_selector(|| "host-sharing-error".into())
                                .text_color(t.danger)
                                .child(e)
                        })),
                )
                .footer(
                    // Cancel holds the focus: nothing widens on one Enter.
                    Button::new("host-sharing-cancel")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("native.host.cancel"))
                        .disabled(pending)
                        .track_focus(&self.dialog_focus.clone())
                        .on_click(cx.listener(|s, _, _, cx| {
                            let stopping = s.host_sharing.as_ref().is_some_and(|h| {
                                h.ask == Some(Ask::Stop)
                                    && matches!(h.target, Target::Settings { .. })
                            });
                            if let Some(sharing) = s.host_sharing.as_mut() {
                                sharing.ask = None;
                            }
                            if stopping {
                                s.close_host_sharing(cx);
                            }
                            cx.notify();
                        })),
                )
                .footer(
                    Button::new("host-sharing-allow")
                        .variant(if danger {
                            ButtonVariant::SolidDanger
                        } else {
                            ButtonVariant::Solid
                        })
                        .label(allow)
                        .disabled(pending)
                        .on_click(cx.listener(|s, _, _, cx| s.sharing_allow(cx))),
                );
        }
        let writable = folder.as_ref().map_or(sharing.writable, |f| f.writable);
        let execution = folder.as_ref().map(|f| f.execution).unwrap_or_default();
        let unavailable = !share && folder.is_none();
        let option = |id: &'static str,
                      value: bool,
                      label: &'static str,
                      detail: &'static str,
                      cx: &mut Context<Self>| {
            let selected = writable == value;
            h_flex()
                .id(id)
                .debug_selector(move || id.into())
                .gap(px(10.))
                .items_start()
                .p(px(10.))
                .rounded(px(8.))
                .border_1()
                .border_color(if selected { t.accent } else { t.border })
                .when(selected, |d| d.bg(theme::alpha(t.accent, 0.06)))
                .when(!pending, |d| {
                    d.cursor(theme::clickable_cursor())
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.sharing_choose(
                                value,
                                if value {
                                    execution
                                } else {
                                    Execution::default()
                                },
                                cx,
                            )
                        }))
                })
                .child(
                    div()
                        .mt(px(3.))
                        .size(px(12.))
                        .flex_none()
                        .rounded_full()
                        .border_1()
                        .border_color(if selected { t.accent } else { t.border })
                        .when(selected, |d| d.border_4()),
                )
                .child(
                    v_flex()
                        .gap(px(2.))
                        .child(
                            div()
                                .text_size(px(ty.body))
                                .text_color(t.text)
                                .child(tr(label)),
                        )
                        .child(
                            div()
                                .text_size(px(ty.meta))
                                .text_color(t.muted)
                                .child(tr(detail)),
                        ),
                )
        };
        let run_row = |kind: &'static str, on: bool, change: fn(Execution, bool) -> Execution| {
            let host = host.clone();
            h_flex()
                .justify_between()
                .items_center()
                .py(px(4.))
                .child(div().text_size(px(ty.body)).child(tr(kind)))
                .child(
                    Switch::new(SharedString::from(format!("host-run-{kind}")), tr(kind))
                        .checked(on)
                        .disabled(pending || !sandboxed)
                        .on_change(move |next, _, cx| {
                            let _ = host.update(cx, |s, cx| {
                                s.sharing_choose(true, change(execution, next), cx)
                            });
                        }),
                )
                .into_any_element()
        };
        let mut dialog = Dialog::new("host-sharing")
            .width(460.)
            .title(tf(
                if share {
                    "hosts.dialog.shareTitle"
                } else {
                    "hosts.dialog.settingsTitle"
                },
                &[("name", shown.as_str().into())],
            ))
            .on_close(close.clone());
        let mut body = v_flex()
            .gap(px(12.))
            .text_size(px(ty.body))
            .line_height(relative(1.5))
            .child(
                div()
                    .text_color(t.muted)
                    .child(tf("hosts.dialog.intro", &[("name", shown.as_str().into())])),
            );
        if unavailable {
            let loaded = link.is_some_and(|l| l.status.is_some());
            body = body.child(div().text_color(t.muted).child(tr(if loaded {
                "hosts.folder.revoked"
            } else {
                "hosts.sharing.connecting"
            })));
        } else {
            body = body.child(
                v_flex()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.subtle)
                            .child(tr("hosts.dialog.access")),
                    )
                    .child(option(
                        "host-access-view",
                        false,
                        "hosts.register.readOnly",
                        "hosts.dialog.viewDetail",
                        cx,
                    ))
                    .child(option(
                        "host-access-edit",
                        true,
                        "hosts.register.editable",
                        "hosts.dialog.editDetail",
                        cx,
                    )),
            );
            if folder.is_some() && writable {
                body = body.child(
                    v_flex()
                        .gap(px(2.))
                        .child(
                            div()
                                .text_size(px(ty.meta))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.subtle)
                                .child(tr("hosts.dialog.run")),
                        )
                        .child(run_row(
                            "hosts.execution.terminal",
                            execution.terminal,
                            |e, on| Execution { terminal: on, ..e },
                        ))
                        .child(run_row("hosts.execution.git", execution.git, |e, on| {
                            Execution { git: on, ..e }
                        }))
                        .child(run_row(
                            "hosts.execution.agent",
                            execution.agent,
                            |e, on| Execution { agent: on, ..e },
                        ))
                        .child(
                            div()
                                .pt(px(4.))
                                .text_size(px(ty.meta))
                                .text_color(t.muted)
                                .child(tr(if sandboxed {
                                    "hosts.execution.sandboxed"
                                } else {
                                    "hosts.execution.noSandbox"
                                })),
                        ),
                );
            }
        }
        if let Some(error) = sharing.error.clone() {
            body = body.child(
                div()
                    .debug_selector(|| "host-sharing-error".into())
                    .text_size(px(ty.meta))
                    .text_color(t.danger)
                    .child(error),
            );
        }
        dialog = dialog.child(body);
        if share {
            dialog = dialog
                .footer(
                    Button::new("host-sharing-close")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("common.action.cancel"))
                        .disabled(pending)
                        .on_click(cx.listener(|s, _, _, cx| s.close_host_sharing(cx))),
                )
                .footer(
                    Button::new("host-sharing-share")
                        .variant(ButtonVariant::Solid)
                        .label(tr("hosts.dialog.share"))
                        .disabled(pending)
                        .track_focus(&self.dialog_focus.clone())
                        .on_click(cx.listener(|s, _, _, cx| {
                            if let Some(sharing) = s.host_sharing.as_mut() {
                                sharing.ask = Some(Ask::Share);
                                sharing.error = None;
                            }
                            cx.notify();
                        })),
                );
        } else {
            if folder.is_some() {
                dialog = dialog.footer(
                    Button::new("host-sharing-stop")
                        .variant(ButtonVariant::SolidDanger)
                        .label(tr("hosts.dialog.stop"))
                        .disabled(pending)
                        .on_click(cx.listener(|s, _, _, cx| {
                            if let Some(sharing) = s.host_sharing.as_mut() {
                                sharing.ask = Some(Ask::Stop);
                            }
                            cx.notify();
                        })),
                );
            }
            dialog = dialog.footer(
                Button::new("host-sharing-done")
                    .variant(ButtonVariant::Solid)
                    .label(tr("hosts.dialog.done"))
                    .disabled(pending)
                    .track_focus(&self.dialog_focus.clone())
                    .on_click(cx.listener(|s, _, _, cx| s.close_host_sharing(cx))),
            );
        }
        dialog
    }
}
