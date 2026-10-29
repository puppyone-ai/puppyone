//! `ProjectRowActions`: a remembered Project's menu (its name and path,
//! Rename, Unlink) and the two dialogs behind it. Renaming changes only the
//! name PuppyOne shows; unlinking forgets the Project and leaves its files.
use super::*;
use crate::{
    localization::{t as tr, tf},
    ui::{
        components::{AnchoredMenu, Button, ButtonVariant, Dialog, Menu, MenuItem},
        form_input::{InputEvent, TextInput},
    },
};
use gpui_kit::base::{Disableable as _, v_flex};

/// `PROJECT_ACTION_MENU_WIDTH`.
const MENU_WIDTH: f32 = 288.;

pub(in crate::shell) struct ProjectRename {
    pub path: PathBuf,
    pub name: String,
    pub input: Entity<TextInput>,
}

impl Shell {
    /// Opens the actions of the remembered Project at `path` at `position`.
    pub(in crate::shell) fn open_project_actions(
        &mut self,
        path: PathBuf,
        position: Point<Pixels>,
        cx: &mut Context<Self>,
    ) {
        self.popover = None;
        self.project_actions = Some((path, position));
        cx.notify();
    }
    pub(in crate::shell) fn project_actions_menu(
        &self,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let (path, position) = self.project_actions.clone()?;
        let project = self
            .recent_projects
            .iter()
            .find(|p| p.path == path)?
            .clone();
        let t = cx.palette();
        let host = self.weak.clone();
        let rename = {
            let host = host.clone();
            let path = path.clone();
            MenuItem::new(tr("shell.workspaceSwitcher.renameProject"))
                .icon("pencil")
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| s.begin_project_rename(path.clone(), w, cx));
                })
        };
        let unlink = {
            let host = host.clone();
            let path = path.clone();
            MenuItem::new(tr("shell.workspaceSwitcher.unlinkProject"))
                .icon("unlink")
                .danger()
                .on_click(move |_, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.project_actions = None;
                        s.modals.open(Modal::UnlinkProject(path.clone()));
                        cx.notify();
                    });
                })
        };
        // `ProjectMenuHeader`: the name over its path.
        let header = v_flex()
            .px(px(8.))
            .py(px(6.))
            .gap(px(2.))
            .min_w_0()
            .child(
                div()
                    .truncate()
                    .text_size(px(theme::ty().ui.control))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(project.name.clone()),
            )
            .child(
                div()
                    .truncate()
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(t.subtle)
                    .child(project.path.display().to_string()),
            );
        let menu = Menu::new("project-actions")
            .w(px(MENU_WIDTH))
            .child_element(header)
            .separator()
            .item(rename)
            .separator()
            .item(unlink)
            .on_dismiss({
                let host = host.clone();
                move |_, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.project_actions = None;
                        cx.notify();
                    });
                }
            });
        Some(
            AnchoredMenu::new("project-actions-menu", position, menu)
                .on_dismiss(move |_, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.project_actions = None;
                        cx.notify();
                    });
                })
                .into_any_element(),
        )
    }
    pub(in crate::shell) fn begin_project_rename(
        &mut self,
        path: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.project_actions = None;
        let Some(project) = self.recent_projects.iter().find(|p| p.path == path) else {
            return;
        };
        let name = project.name.clone();
        let input = cx.new(|cx| {
            let mut input = TextInput::new("", false, 120, window, cx);
            input.submit_on_enter = true;
            input.set_text(name.clone(), cx);
            input
        });
        cx.subscribe_in(&input, window, |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                s.submit_project_rename(w, cx)
            } else {
                // Save follows the edited name.
                cx.notify();
            }
        })
        .detach();
        input.read(cx).focus_handle(cx).focus(window, cx);
        self.modals
            .open(Modal::RenameProject(ProjectRename { path, name, input }));
        cx.notify();
    }
    /// `renameProject`: the shown name only; the folder keeps its name.
    pub(in crate::shell) fn submit_project_rename(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(Modal::RenameProject(rename)) = self
            .modals
            .top()
            .filter(|m| matches!(m, Modal::RenameProject(_)))
        else {
            return;
        };
        let name = rename.input.read(cx).text().trim().to_owned();
        if name.is_empty() || name == rename.name {
            return;
        }
        let path = rename.path.clone();
        self.modals.remove(|m| matches!(m, Modal::RenameProject(_)));
        self.preferences
            .update(cx, |p, cx| p.change(|p| p.rename_project(&path, &name), cx));
        if self.workspace_root().as_deref() == Some(path.as_path()) {
            self.project = name;
        }
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
        let unchanged = text.is_empty() || text == rename.name;
        Dialog::new("project-rename")
            .width(420.)
            .title(tr("shell.workspaceSwitcher.renameProjectTitle"))
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.modals.remove(|m| matches!(m, Modal::RenameProject(_)));
                    s.focus.focus(w, cx);
                    cx.notify();
                });
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
                            .child(tr("shell.workspaceSwitcher.renameProjectDescription")),
                    ),
            )
            .footer(
                Button::new("project-rename-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .on_click(cx.listener(|s, _, w, cx| {
                        s.modals.remove(|m| matches!(m, Modal::RenameProject(_)));
                        s.focus.focus(w, cx);
                        cx.notify();
                    })),
            )
            .footer(
                Button::new("project-rename-save")
                    .variant(ButtonVariant::Solid)
                    .label(tr("common.action.save"))
                    .disabled(unchanged)
                    .on_click(cx.listener(|s, _, w, cx| s.submit_project_rename(w, cx))),
            )
    }
    pub(in crate::shell) fn project_unlink_dialog(
        &self,
        path: &std::path::Path,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let name = self
            .recent_projects
            .iter()
            .find(|p| p.path == path)
            .map(|p| p.name.clone())
            .unwrap_or_default();
        let host = self.weak.clone();
        let unlink = path.to_path_buf();
        Dialog::new("project-unlink")
            .width(420.)
            .title(tr("shell.workspaceSwitcher.unlinkProjectTitle"))
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.modals.remove(|m| matches!(m, Modal::UnlinkProject(_)));
                    cx.notify();
                });
            })
            .child(
                div()
                    .text_size(px(theme::ty().ui.body))
                    .line_height(relative(1.5))
                    .text_color(t.muted)
                    .child(tf(
                        "shell.workspaceSwitcher.unlinkProjectDescription",
                        &[("project", name.into())],
                    )),
            )
            .footer(
                Button::new("project-unlink-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.modals.remove(|m| matches!(m, Modal::UnlinkProject(_)));
                        cx.notify();
                    })),
            )
            .footer(
                Button::new("project-unlink-confirm")
                    .variant(ButtonVariant::SolidDanger)
                    .label(tr("shell.workspaceSwitcher.unlinkProject"))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.modals.remove(|m| matches!(m, Modal::UnlinkProject(_)));
                        let path = unlink.clone();
                        s.preferences
                            .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
                        cx.notify();
                    })),
            )
    }
}
