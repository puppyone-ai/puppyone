use super::*;
use crate::{
    features::settings::{SettingsWorkspaceSurface, preferences_store::PreferencesStore},
    ui::components::{Button, ButtonVariant, Dialog, Icon},
};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
pub struct TaskUi {
    pub settings: Entity<SettingsWorkspaceSurface>,
}
impl TaskUi {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        window: &mut Window,
        cx: &mut Context<Shell>,
    ) -> Self {
        Self {
            settings: cx.new(|cx| SettingsWorkspaceSurface::new(preferences, window, cx)),
        }
    }
}
/// `CloudWorkspaceSharePreview`'s entries: what the Explorer already holds,
/// without service files. Opening or copying a share sends no request.
pub(super) fn share_preview_entries(
    nodes: &[crate::model::Node],
    open: Option<&str>,
) -> Vec<(String, bool)> {
    let mut entries: Vec<(String, bool)> = nodes
        .iter()
        .filter(|n| ![".DS_Store", "Thumbs.db", ".git"].contains(&n.name.as_str()))
        .take(8)
        .map(|n| (n.name.clone(), n.folder))
        .collect();
    if let Some(open) = open
        && !entries.iter().any(|(name, _)| name == open)
    {
        entries.push((open.to_owned(), false));
    }
    entries
}
/// The reduced, inert illustration: half the Explorer's width and type beside
/// the open document's first lines, fading out at the bottom. GPUI has no
/// element transform, so it is drawn at this size; it takes no pointer.
pub(crate) fn share_preview(
    entries: Vec<(String, bool)>,
    document: Option<(String, String)>,
    t: Theme,
) -> Div {
    let line = |width: f32| {
        div()
            .h(px(6.))
            .w(px(width))
            .rounded(px(3.))
            .bg(theme::alpha(t.muted, 0.16))
    };
    let open = document.as_ref().map(|(name, _)| name.clone());
    let rail = if entries.is_empty() {
        // `ExplorerTreeSkeleton`.
        v_flex()
            .gap(px(8.))
            .p(px(8.))
            .children([70., 92., 58., 84., 66.].map(line))
    } else {
        v_flex()
            .p(px(4.))
            .children(entries.into_iter().map(|(name, folder)| {
                let active = open.as_deref() == Some(name.as_str());
                h_flex()
                    .h(px(14.))
                    .px(px(4.))
                    .gap(px(3.))
                    .rounded(px(3.))
                    .when(active, |d| d.bg(t.selected))
                    .text_size(px(7.))
                    .text_color(t.text)
                    .child(
                        (if folder {
                            Icon::product(crate::ui::components::ProductIcon::Folder)
                        } else {
                            Icon::new("file")
                        })
                        .with_size(px(8.))
                        .color(t.muted),
                    )
                    .child(div().min_w_0().truncate().child(name))
            }))
    };
    let text =
        document.map(|(_, text)| text.lines().take(24).map(str::to_owned).collect::<Vec<_>>());
    let page = match text {
        Some(lines) => v_flex()
            .p(px(8.))
            .gap(px(1.))
            .text_size(px(7.))
            .line_height(px(10.))
            .text_color(t.text)
            .children(lines.into_iter().map(|line| div().truncate().child(line))),
        None => v_flex()
            .p(px(10.))
            .gap(px(8.))
            .children([180., 240., 210., 150.].map(line)),
    };
    let fade = div()
        .absolute()
        .left_0()
        .right_0()
        .bottom_0()
        .h(px(48.))
        .bg(linear_gradient(
            180.,
            linear_color_stop(theme::alpha(t.overlay, 0.), 0.),
            linear_color_stop(t.overlay, 1.),
        ));
    h_flex()
        .relative()
        .items_start()
        .h(px(186.))
        .overflow_hidden()
        .border_1()
        .border_color(t.border_subtle)
        .rounded(px(8.))
        .child(
            div()
                .w(px(120.))
                .h_full()
                .flex_shrink_0()
                .border_r_1()
                .border_color(t.border_subtle)
                .child(rail),
        )
        .child(div().flex_1().min_w_0().overflow_hidden().child(page))
        .child(fade)
}
/// `.desktop-settings-dialog-backdrop`: `color-mix(var(--po-backdrop) 84%,
/// transparent)` (the product's 1.5px backdrop blur has no GPUI equivalent).
pub(crate) fn task_backdrop(t: Theme) -> Rgba {
    Rgba {
        a: t.backdrop.a * 0.84,
        ..t.backdrop
    }
}
/// `DesktopDialogSurface` (`.desktop-dialog-surface`) at `r`.
pub(crate) fn modal_card(r: Rect, t: Theme) -> Stateful<Div> {
    div()
        .absolute()
        .left(px(r.x))
        .top(px(r.y))
        .w(px(r.w))
        .h(px(r.h))
        .id("modal-card")
        .bg(t.overlay)
        .border_1()
        .border_color(t.divider)
        .rounded(px(crate::theme::metric::DIALOG_RADIUS))
        .shadow(vec![BoxShadow {
            inset: false,
            color: t.shadow.into(),
            offset: point(px(0.), px(24.)),
            blur_radius: px(48.),
            spread_radius: px(0.),
        }])
        .overflow_hidden()
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
}
/// `SettingsDialog` (`.desktop-settings-dialog`): the task dialog centred in
/// a `w`×`h` window. Shared by the shell and the pixel lab.
pub(crate) fn settings_dialog(
    settings: Entity<SettingsWorkspaceSurface>,
    w: f32,
    h: f32,
    t: Theme,
) -> Stateful<Div> {
    let (width, height) = settings_size(w, h);
    modal_card(
        Rect::new((w - width) / 2., (h - height) / 2., width, height),
        t,
    )
    .rounded(px(crate::theme::metric::TASK_DIALOG_RADIUS))
    .bg(t.canvas)
    .child(settings)
}
pub fn settings_size(w: f32, h: f32) -> (f32, f32) {
    let inset = 2. * crate::theme::metric::TASK_DIALOG_INSET;
    ((w - inset).clamp(280., 960.), (h - inset).clamp(240., 760.))
}
impl Shell {
    pub(super) fn dialog_host(&self, cx: &mut Context<Self>) -> gpui_kit::base::Dialog {
        gpui_kit::base::Dialog::new(cx)
            .focus_handle(self.modal_focus.clone())
            .close_on_escape(false)
            .close_on_backdrop_press(false)
            .on_ok(|_, _, _| false)
            .backdrop(div().size_full().bg(cx.palette().backdrop))
    }
    pub(super) fn modal_card(&self, r: Rect, cx: &App) -> Stateful<Div> {
        modal_card(r, cx.palette())
    }
    /// A notice or confirmation: title, message and footer actions. Escape
    /// and the close button run the first action (the cancel or dismiss).
    pub(super) fn simple_modal(
        &self,
        title: &str,
        message: &str,
        actions: Vec<(&'static str, Command, ButtonVariant)>,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let cancel = actions.first().map(|(_, command, _)| *command);
        let mut dialog = Dialog::new("simple-modal")
            .width(440.)
            .title(title.to_owned())
            .focus_handle(self.modal_focus.clone())
            .keep_on_backdrop()
            .child(message.to_owned());
        if let Some(command) = cancel {
            let host = cx.weak_entity();
            dialog = dialog.on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.command(command, w, cx));
            });
        }
        for (label, command, variant) in actions {
            dialog = dialog.footer(
                Button::new(label)
                    .variant(variant)
                    .label(label)
                    .on_click(cx.listener(move |s, _, w, cx| s.command(command, w, cx))),
            );
        }
        dialog
    }
    /// Manage Running Sessions: this window's Agent and terminal hosts from
    /// the host budget, so they stay manageable after their tabs close.
    pub(super) fn executions_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        use crate::localization::t as tr;
        use crate::platform::host_budget::{Budget, Cleanup};
        let t = cx.palette();
        let rows: Vec<_> = Budget::global()
            .snapshot()
            .into_iter()
            .filter(|r| r.owner == self.window_key || r.owner == "application")
            .collect();
        let host = cx.weak_entity();
        let mut list = div().flex().flex_col().gap(px(8.));
        if rows.is_empty() {
            list = list.child(tr("native.execution.empty"));
        } else {
            list = list.child(tr("native.execution.inventory"));
        }
        for (index, row) in rows.into_iter().enumerate() {
            let state = tr(match row.cleanup {
                Cleanup::Pending => "native.execution.state.pending",
                Cleanup::Running => "native.execution.state.running",
                Cleanup::Unconfirmed => "native.execution.state.unconfirmed",
            });
            let action = tr(if row.cleanup == Cleanup::Unconfirmed {
                "native.execution.retry"
            } else {
                "native.execution.terminate"
            });
            let key = row.key.clone();
            let short: String = row.key.chars().take(12 + row.kind.len()).collect();
            list = list.child(
                div()
                    .id(("execution-row", index))
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .child(div().text_color(t.text).child(short))
                            .child(
                                div()
                                    .text_size(px(theme::ty().ui.meta))
                                    .text_color(t.subtle)
                                    .child(state),
                            ),
                    )
                    .child(
                        Button::new(("execution-terminate", index))
                            .variant(ButtonVariant::OutlineDanger)
                            .label(action)
                            .on_click(cx.listener(move |_, _, _, cx| {
                                Budget::global().terminate(&key);
                                cx.notify();
                            })),
                    ),
            );
        }
        Dialog::new("executions")
            .width(480.)
            .title(tr("native.execution.title").to_owned())
            .focus_handle(self.modal_focus.clone())
            .keep_on_backdrop()
            .child(list)
            .child(
                div()
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(t.subtle)
                    .child(tr("native.execution.consequence")),
            )
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.command(Command::CloseExecutions, w, cx));
            })
            .footer(
                Button::new("execution-refresh")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("native.execution.refresh"))
                    .on_click(cx.listener(|_, _, _, cx| cx.notify())),
            )
            .footer(
                Button::new("execution-done")
                    .variant(ButtonVariant::Solid)
                    .label(tr("native.execution.done"))
                    .on_click(
                        cx.listener(|s, _, w, cx| s.command(Command::CloseExecutions, w, cx)),
                    ),
            )
    }
    /// `CloudWorkspaceShareDialog`: title, the URL row with an icon-only Copy
    /// (a check after copying), and the unavailable / copy-failed notes. The
    /// locator grants nothing; recipients sign in with their own access.
    pub(super) fn share_dialog(
        &self,
        url: Option<String>,
        copied: Option<bool>,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let host = cx.weak_entity();
        let mut body = div().flex().flex_col().gap(px(10.));
        match url {
            Some(url) => {
                body = body.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .px(px(10.))
                                .py(px(6.))
                                .rounded(px(6.))
                                .border_1()
                                .border_color(t.border_subtle)
                                .bg(t.input)
                                .text_size(px(theme::ty().ui.meta))
                                .text_color(t.text)
                                .truncate()
                                .child(url),
                        )
                        .child(
                            crate::ui::components::IconButton::new(
                                "share-copy",
                                if copied == Some(true) {
                                    "check"
                                } else {
                                    "copy"
                                },
                            )
                            .label(crate::localization::tf(
                                "cloud.share.action.copyLabel",
                                &[(
                                    "label",
                                    crate::localization::t("cloud.share.handoff.link").into(),
                                )],
                            ))
                            .on_click(
                                cx.listener(|s, _, w, cx| s.command(Command::CopyShareLink, w, cx)),
                            ),
                        ),
                );
                if copied == Some(false) {
                    body = body.child(
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.danger)
                            .child(crate::localization::t("cloud.share.copyFailed")),
                    );
                }
                let document = self.files.document.as_ref().map(|d| {
                    let name = d
                        .relative
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    (name, d.text.clone())
                });
                let entries = share_preview_entries(
                    self.explorer.read(cx).root_nodes(),
                    document.as_ref().map(|(name, _)| name.as_str()),
                );
                body = body.child(share_preview(entries, document, t));
            }
            None => {
                body = body.child(
                    div()
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(crate::localization::t("cloud.share.publish.unavailable")),
                );
            }
        }
        Dialog::new("cloud-share")
            .width(520.)
            .title(crate::localization::t("cloud.share.thisProject").to_owned())
            .focus_handle(self.modal_focus.clone())
            .child(body)
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.command(Command::CloseShare, w, cx));
            })
    }
    /// About PuppyOne: brand mark, name and version (`role: "about"`).
    pub(super) fn about_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let host = cx.weak_entity();
        let version = crate::localization::tf(
            "native.about.version",
            &[("version", env!("CARGO_PKG_VERSION").into())],
        );
        Dialog::new("about")
            .width(320.)
            .focus_handle(self.modal_focus.clone())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(8.))
                    .py(px(8.))
                    .child(
                        img(SharedString::from(if t.dark {
                            "brand/puppy-dark-onboarding.svg"
                        } else {
                            "brand/puppy-lite.svg"
                        }))
                        .size(px(48.))
                        .object_fit(ObjectFit::Contain),
                    )
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.title))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child("PuppyOne"),
                    )
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.subtle)
                            .child(version),
                    ),
            )
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.command(Command::CloseAbout, w, cx));
            })
    }
    pub(super) fn settings_view(
        &self,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let root = self
            .files
            .workspace
            .as_ref()
            .and_then(|ws| ws.local_root().map(PathBuf::from));
        self.task_ui.settings.update(cx, |s, cx| {
            s.set_root(root, cx);
        });
        let host = cx.weak_entity();
        self.dialog_host(cx)
            .backdrop(div().size_full().bg(task_backdrop(cx.palette())))
            .close_on_backdrop_press(true)
            .on_cancel(move |_, w, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.close_tasks(w, cx);
                    cx.notify()
                });
                true
            })
            .popup(settings_dialog(
                self.task_ui.settings.clone(),
                w,
                h,
                cx.palette(),
            ))
    }
    pub(super) fn create_entry_view(
        &self,
        form: Entity<crate::features::create_new::create_entry_dialog::CreateEntryDialog>,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> gpui_kit::base::Dialog {
        let width = (w - 64.).clamp(280., 420.);
        let height = 240.;
        let card = self.modal_card(
            Rect::new((w - width) / 2., (h - height) / 2., width, height),
            cx,
        );
        self.dialog_host(cx).popup(card.child(form))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn product_settings_geometry_is_bounded() {
        assert_eq!(settings_size(1280., 800.), (960., 736.));
        assert_eq!(settings_size(640., 480.), (576., 416.));
        assert_eq!(settings_size(1920., 1080.), (960., 760.));
    }
}
