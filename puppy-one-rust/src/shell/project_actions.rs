//! `ProjectRowActions` and `ProjectMenuHeader`: what can be done to one
//! project entry, and the dialogs behind it. A folder and its Cloud project
//! are two projects (ADR-001), so each menu speaks for its own entry: a
//! folder's menu leads with where it is and Copy path, then Rename and
//! Unlink (the files stay); a Cloud project offers Rename and Delete, and
//! only what this account may do.
use super::*;
use crate::{
    localization::{t as tr, tf},
    ui::{
        components::{AnchoredMenu, Button, ButtonVariant, Dialog, Menu, MenuItem},
        form_input::{InputEvent, TextInput},
    },
    workspace::cloud::catalog::Item,
};
use gpui_kit::base::{Disableable as _, v_flex};

/// `PROJECT_ACTION_MENU_WIDTH`: the local menu carries the folder's path.
const MENU_WIDTH_LOCAL: f32 = 224.;
const MENU_WIDTH_CLOUD: f32 = 184.;
/// `PROJECT_NAME_MAX_LENGTH`.
const NAME_MAX_LOCAL: usize = 120;
const NAME_MAX_CLOUD: usize = 200;
/// `SIDEBAR_ACTION_MENU_GAP` and its viewport margin.
const MENU_GAP: f32 = 4.;
const MENU_MARGIN: f32 = 12.;
/// `PROJECT_ACTION_MENU_ESTIMATED_HEIGHT`.
const MENU_ESTIMATED_HEIGHT: f32 = 180.;

/// One entry's changes.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::shell) enum Target {
    Local {
        path: PathBuf,
        name: String,
    },
    Cloud {
        project: String,
        name: String,
        rename: bool,
        delete: bool,
    },
}
impl Target {
    /// `offeredProjectChanges`; `None` when nothing is offered.
    pub fn of(item: &Item) -> Option<Self> {
        let name = super::home::item_name_or(item, tr("onboarding.projects.untitled"));
        if let Some(path) = &item.local_path {
            return Some(Self::Local {
                path: PathBuf::from(path),
                name,
            });
        }
        let actions = item.actions.unwrap_or_default();
        let project = item.cloud_project.clone()?;
        (actions.rename || actions.delete).then_some(Self::Cloud {
            project,
            name,
            rename: actions.rename,
            delete: actions.delete,
        })
    }
    pub fn name(&self) -> &str {
        match self {
            Self::Local { name, .. } | Self::Cloud { name, .. } => name,
        }
    }
    fn width(&self) -> f32 {
        match self {
            Self::Local { .. } => MENU_WIDTH_LOCAL,
            Self::Cloud { .. } => MENU_WIDTH_CLOUD,
        }
    }
}

/// `"menu" | "rename" | "unlink" | "delete"` for one entry.
pub(in crate::shell) struct ProjectRename {
    pub target: Target,
    pub input: Entity<TextInput>,
    pub pending: bool,
    pub error: Option<String>,
}
/// Unlinking a folder or deleting a Cloud project, confirmed.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::shell) struct ProjectConfirm {
    pub target: Target,
    pub pending: bool,
    pub error: Option<String>,
}
/// The open actions menu: its entry, where it hangs, and whether Copy path
/// just copied.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::shell) struct ActionsMenu {
    pub target: Target,
    pub position: Point<Pixels>,
    pub copied: Option<bool>,
}

/// `resolveDesktopActionMenuPositionBeside`: to the right of the trigger,
/// else under (or over) it, inside a 12px margin.
pub(in crate::shell) fn beside(
    trigger: Bounds<Pixels>,
    width: f32,
    viewport: Size<Pixels>,
) -> Point<Pixels> {
    let (vw, vh) = (f32::from(viewport.width), f32::from(viewport.height));
    let max_left = (vw - width - MENU_MARGIN).max(MENU_MARGIN);
    let max_top = (vh - MENU_ESTIMATED_HEIGHT - MENU_MARGIN).max(MENU_MARGIN);
    let clamp = |v: f32, lo: f32, hi: f32| v.max(lo).min(hi);
    let right = f32::from(trigger.right());
    let next_to = right + MENU_GAP;
    if next_to <= max_left {
        return point(
            px(next_to),
            px(clamp(f32::from(trigger.top()), MENU_MARGIN, max_top)),
        );
    }
    let below = f32::from(trigger.bottom()) + MENU_GAP;
    let above = f32::from(trigger.top()) - MENU_GAP - MENU_ESTIMATED_HEIGHT;
    point(
        px(clamp(right - width, MENU_MARGIN, max_left)),
        px(clamp(
            if below <= max_top { below } else { above },
            MENU_MARGIN,
            max_top,
        )),
    )
}

impl Shell {
    /// Opens `target`'s actions; `trigger` is the control it hangs beside,
    /// or the pointer of a right click.
    pub(in crate::shell) fn open_project_actions(
        &mut self,
        target: Target,
        trigger: Bounds<Pixels>,
        beside: bool,
        viewport: Size<Pixels>,
        cx: &mut Context<Self>,
    ) {
        self.popover = None;
        let position = if beside {
            self::beside(trigger, target.width(), viewport)
        } else {
            trigger.origin
        };
        self.project_actions = Some(ActionsMenu {
            target,
            position,
            copied: None,
        });
        cx.notify();
    }
    fn close_project_actions(&mut self, cx: &mut Context<Self>) {
        self.project_actions = None;
        self.homepage.actions = None;
        cx.notify();
    }
    pub(in crate::shell) fn project_actions_menu(
        &self,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let open = self.project_actions.clone()?;
        let t = cx.palette();
        let host = self.weak.clone();
        let target = open.target.clone();
        let mut menu = Menu::new("project-actions")
            .variant(crate::ui::components::MenuVariant::SidebarAction)
            .w(px(target.width()));
        let (can_rename, can_unlink, can_delete) = match &target {
            Target::Local { .. } => (true, true, false),
            Target::Cloud { rename, delete, .. } => (*rename, false, *delete),
        };
        if let Target::Local { path, .. } = &target {
            // `ProjectMenuHeader`: one quiet line of where it is, then Copy path.
            let shown = super::home::path_for_display(path);
            menu = menu.child_element(
                div()
                    .flex_shrink_0()
                    .pt(px(5.))
                    .px(px(9.))
                    .pb(px(3.))
                    .truncate()
                    .text_size(px(theme::ty().left.meta))
                    .text_color(t.muted)
                    .child(shown),
            );
            let copied = open.copied;
            let full = path.to_string_lossy().into_owned();
            let host = host.clone();
            menu = menu.item(
                MenuItem::new(tr(if copied == Some(true) {
                    "common.action.copied"
                } else {
                    "shell.workspaceSwitcher.copyPath"
                }))
                .icon(if copied == Some(true) {
                    "check"
                } else {
                    "copy"
                })
                .stay_open()
                .on_click(move |_, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(full.clone()));
                    let _ = host.update(cx, |s, cx| {
                        if let Some(open) = &mut s.project_actions {
                            open.copied = Some(true);
                        }
                        cx.notify();
                    });
                }),
            );
            if copied == Some(false) {
                menu = menu.child_element(
                    div()
                        .px(px(9.))
                        .text_size(px(theme::ty().left.meta))
                        .text_color(t.danger)
                        .child(tr("shell.workspaceSwitcher.copyPathFailed")),
                );
            }
        }
        if can_rename {
            let host = host.clone();
            let target = target.clone();
            menu = menu.item(
                MenuItem::new(tr("shell.workspaceSwitcher.renameProject"))
                    .icon("pencil")
                    .on_click(move |w, cx| {
                        let _ =
                            host.update(cx, |s, cx| s.begin_project_rename(target.clone(), w, cx));
                    }),
            );
        }
        if can_rename && (can_unlink || can_delete) {
            menu = menu.separator();
        }
        if can_unlink || can_delete {
            let host = host.clone();
            let target = target.clone();
            menu = menu.item(
                MenuItem::new(tr(if can_unlink {
                    "shell.workspaceSwitcher.unlinkProject"
                } else {
                    "shell.workspaceSwitcher.deleteProject"
                }))
                .icon(if can_unlink { "unlink" } else { "trash-2" })
                .danger()
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.project_actions = None;
                        s.modals.open(Modal::ConfirmProject(ProjectConfirm {
                            target: target.clone(),
                            pending: false,
                            error: None,
                        }));
                        s.modal_focus.focus(w, cx);
                        cx.notify();
                    });
                }),
            );
        }
        let dismiss = host.clone();
        let menu = menu.on_dismiss(move |_, cx| {
            let _ = dismiss.update(cx, |s, cx| s.close_project_actions(cx));
        });
        Some(
            AnchoredMenu::new("project-actions-menu", open.position, menu)
                .on_dismiss(move |_, cx| {
                    let _ = host.update(cx, |s, cx| s.close_project_actions(cx));
                })
                .into_any_element(),
        )
    }
    pub(in crate::shell) fn begin_project_rename(
        &mut self,
        target: Target,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.project_actions = None;
        let max = match target {
            Target::Local { .. } => NAME_MAX_LOCAL,
            Target::Cloud { .. } => NAME_MAX_CLOUD,
        };
        let name = target.name().to_owned();
        let input = cx.new(|cx| {
            let mut input = TextInput::new("", false, max, window, cx);
            input.submit_on_enter = true;
            input.set_text(name.clone(), cx);
            input
        });
        cx.subscribe_in(&input, window, |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                s.submit_project_rename(w, cx)
            } else {
                // Save follows the edited name; an error clears with an edit.
                if let Some(Modal::RenameProject(rename)) = s.modals.top_mut() {
                    rename.error = None;
                }
                cx.notify();
            }
        })
        .detach();
        input.read(cx).focus_handle(cx).focus(window, cx);
        self.modals.open(Modal::RenameProject(ProjectRename {
            target,
            input,
            pending: false,
            error: None,
        }));
        cx.notify();
    }
    /// `renameProject` (the shown name; the folder keeps its own) or
    /// `renameCloudProject` (the Project's name, for everyone).
    pub(in crate::shell) fn submit_project_rename(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(Modal::RenameProject(rename)) = self.modals.top() else {
            return;
        };
        if rename.pending {
            return;
        }
        let name = rename.input.read(cx).text().trim().to_owned();
        if name.is_empty() || name == rename.target.name() {
            return;
        }
        match rename.target.clone() {
            Target::Local { path, .. } => {
                self.modals.remove(|m| matches!(m, Modal::RenameProject(_)));
                self.homepage.actions = None;
                self.preferences
                    .update(cx, |p, cx| p.change(|p| p.rename_project(&path, &name), cx));
                if self.workspace_root().as_deref() == Some(path.as_path()) {
                    self.session.project.name = name;
                }
                self.focus.focus(window, cx);
            }
            Target::Cloud { project, .. } => {
                let Some(client) = crate::features::cloud::services::services_client(cx) else {
                    return;
                };
                if let Some(Modal::RenameProject(rename)) = self.modals.top_mut() {
                    rename.pending = true;
                }
                let update = crate::workspace::cloud::services::ProjectUpdate {
                    name: Some(name.clone()),
                    ..Default::default()
                };
                let id = project.clone();
                let task = cx
                    .background_executor()
                    .spawn(async move { client.update_project(&id, update) });
                cx.spawn_in(window, async move |this, cx| {
                    let result = task.await;
                    let _ = this.update_in(cx, |s, w, cx| {
                        match result {
                            Ok(updated) => {
                                s.modals.remove(|m| matches!(m, Modal::RenameProject(_)));
                                s.homepage.actions = None;
                                let catalog = s.cloud.catalog.clone();
                                catalog.update(cx, |c, cx| {
                                    c.apply_rename(&project, &updated.name, cx)
                                });
                                s.focus.focus(w, cx);
                            }
                            Err(error) => {
                                if let Some(Modal::RenameProject(rename)) = s.modals.top_mut() {
                                    rename.pending = false;
                                    rename.error = Some(project_change_error(&error));
                                }
                            }
                        }
                        cx.notify();
                    });
                })
                .detach();
            }
        }
        cx.notify();
    }
    fn close_project_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.modals.remove(|m| {
            matches!(
                m,
                Modal::RenameProject(ProjectRename { pending: false, .. })
                    | Modal::ConfirmProject(ProjectConfirm { pending: false, .. })
            )
        });
        self.homepage.actions = None;
        self.focus.focus(window, cx);
        cx.notify();
    }
    pub(in crate::shell) fn project_rename_dialog(
        &self,
        rename: &ProjectRename,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let host = self.weak.clone();
        let text = rename.input.read(cx).text().trim().to_owned();
        let unchanged = text.is_empty() || text == rename.target.name();
        let pending = rename.pending;
        Dialog::new("project-rename")
            .width(420.)
            .title(tr("shell.workspaceSwitcher.renameProjectTitle"))
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_project_dialog(w, cx));
            })
            .child(
                v_flex()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.subtle)
                            .child(tr("shell.workspaceSwitcher.projectName")),
                    )
                    .child(rename.input.clone())
                    .child(
                        div()
                            .pt(px(6.))
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.muted)
                            .child(tr(match rename.target {
                                Target::Local { .. } => {
                                    "shell.workspaceSwitcher.renameProjectDescription"
                                }
                                Target::Cloud { .. } => {
                                    "shell.workspaceSwitcher.renameCloudProjectDescription"
                                }
                            })),
                    )
                    .children(rename.error.clone().map(|error| {
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.danger)
                            .child(error)
                    })),
            )
            .footer(
                Button::new("project-rename-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(pending)
                    .on_click(cx.listener(|s, _, w, cx| s.close_project_dialog(w, cx))),
            )
            .footer(
                Button::new("project-rename-save")
                    .variant(ButtonVariant::Solid)
                    .label(tr(if pending {
                        "shell.workspaceSwitcher.renameProjectProgress"
                    } else {
                        "common.action.save"
                    }))
                    .disabled(unchanged || pending)
                    .on_click(cx.listener(|s, _, w, cx| s.submit_project_rename(w, cx))),
            )
    }
    /// `ProjectRowConfirmDialog`: Cancel holds the focus; neither unlinking
    /// nor deleting is one Enter away.
    pub(in crate::shell) fn project_confirm_dialog(
        &self,
        confirm: &ProjectConfirm,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let host = self.weak.clone();
        let unlink = matches!(confirm.target, Target::Local { .. });
        let key = |part: &str| {
            format!(
                "shell.workspaceSwitcher.{}Project{part}",
                if unlink { "unlink" } else { "delete" }
            )
        };
        let pending = confirm.pending;
        Dialog::new("project-confirm")
            .width(420.)
            .title(tr(&key("Title")))
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_project_dialog(w, cx));
            })
            .child(
                v_flex()
                    .gap(px(8.))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.body))
                            .line_height(relative(1.5))
                            .text_color(t.muted)
                            .child(tf(
                                &key("Description"),
                                &[("project", confirm.target.name().to_owned().into())],
                            )),
                    )
                    .children(confirm.error.clone().map(|error| {
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.danger)
                            .child(error)
                    })),
            )
            .footer(
                Button::new("project-confirm-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(pending)
                    .track_focus(&self.modal_focus)
                    .on_click(cx.listener(|s, _, w, cx| s.close_project_dialog(w, cx))),
            )
            .footer(
                Button::new("project-confirm-run")
                    .variant(ButtonVariant::SolidDanger)
                    .label(tr(&key(if pending { "Progress" } else { "Action" })))
                    .disabled(pending)
                    .on_click(cx.listener(|s, _, w, cx| s.confirm_project_change(w, cx))),
            )
    }
    /// Unlink forgets the folder (its files stay); Delete removes the Cloud
    /// project for everyone. The dialog stays, with the reason, when the
    /// project refuses.
    pub(in crate::shell) fn confirm_project_change(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(Modal::ConfirmProject(confirm)) = self.modals.top() else {
            return;
        };
        if confirm.pending {
            return;
        }
        match confirm.target.clone() {
            Target::Local { path, .. } => {
                self.modals
                    .remove(|m| matches!(m, Modal::ConfirmProject(_)));
                self.homepage.actions = None;
                self.preferences
                    .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
                self.focus.focus(window, cx);
            }
            Target::Cloud { project, .. } => {
                let Some(client) = crate::features::cloud::services::services_client(cx) else {
                    return;
                };
                if let Some(Modal::ConfirmProject(confirm)) = self.modals.top_mut() {
                    confirm.pending = true;
                    confirm.error = None;
                }
                let id = project.clone();
                let task = cx
                    .background_executor()
                    .spawn(async move { client.delete_project(&id) });
                cx.spawn_in(window, async move |this, cx| {
                    let result = task.await;
                    let _ = this.update_in(cx, |s, w, cx| {
                        match result {
                            Ok(()) => {
                                s.modals.remove(|m| matches!(m, Modal::ConfirmProject(_)));
                                s.homepage.actions = None;
                                let catalog = s.cloud.catalog.clone();
                                catalog.update(cx, |c, cx| c.apply_delete(&project, cx));
                                s.focus.focus(w, cx);
                            }
                            Err(error) => {
                                if let Some(Modal::ConfirmProject(confirm)) = s.modals.top_mut() {
                                    confirm.pending = false;
                                    confirm.error = Some(project_change_error(&error));
                                }
                            }
                        }
                        cx.notify();
                    });
                })
                .detach();
            }
        }
        cx.notify();
    }
}

/// The reason a Cloud project refused a change, as the dialog states it.
fn project_change_error(error: &crate::workspace::cloud::services::Error) -> String {
    use crate::workspace::cloud::services::Error;
    match error {
        Error::Status(403) => tr("cloud.message.project-access-denied").into(),
        Error::Status(404) => tr("cloud.message.project-unavailable").into(),
        Error::Unavailable | Error::Unknown => tr("cloud.message.connection-unreachable").into(),
        _ => tr("cloud.message.update-config-failed").into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_menu_hangs_beside_its_trigger_else_under_it() {
        let viewport = size(px(1280.), px(800.));
        let trigger = Bounds::new(point(px(600.), px(200.)), size(px(22.), px(22.)));
        assert_eq!(beside(trigger, 224., viewport), point(px(626.), px(200.)));
        let edge = Bounds::new(point(px(1200.), px(200.)), size(px(22.), px(22.)));
        assert_eq!(beside(edge, 224., viewport), point(px(998.), px(226.)));
        let low = Bounds::new(point(px(1200.), px(700.)), size(px(22.), px(22.)));
        assert_eq!(beside(low, 224., viewport).y, px(516.));
    }

    #[test]
    fn a_cloud_entry_offers_only_its_permitted_changes() {
        use crate::workspace::cloud::catalog::{Actions, Item};
        let mut item = Item {
            id: "cloud:p".into(),
            label: "P".into(),
            local_path: None,
            cloud_project: Some("p".into()),
            linked: None,
            actions: Some(Actions::default()),
            modified: None,
        };
        assert_eq!(Target::of(&item), None);
        item.actions = Some(Actions {
            rename: false,
            delete: true,
        });
        assert!(matches!(
            Target::of(&item),
            Some(Target::Cloud {
                rename: false,
                delete: true,
                ..
            })
        ));
    }
}
