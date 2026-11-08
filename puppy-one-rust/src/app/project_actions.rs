//! `ProjectRowActions` and `ProjectMenuHeader`: what can be done to one
//! project entry, and the dialogs behind it. A folder and its Cloud project
//! are two projects (ADR-001), so each menu speaks for its own entry: a
//! folder's menu leads with Copy path (the raw path is not printed), then
//! Rename, who can open it ([`super::audience`]) and Unlink (the files
//! stay); a Cloud project offers Rename and Delete, and only what this
//! account may do.
//!
//! [`ProjectActions`] is one entity per window: the Homepage's rows, the
//! project rail and the Header's project menu open it beside their entry.
//! It draws the menu, owns the rename and confirm dialogs (on the dialog
//! layer) and tells the window what changed ([`ActionsEvent`]).
use super::dialogs::{DialogKey, DialogLayer};
use crate::features::cloud::CloudCatalog;
use crate::features::settings::PreferencesStore;
use crate::localization::t as tr;
use crate::localization::tf;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::AnchoredMenu;
use crate::ui::components::Button;
use crate::ui::components::ButtonVariant;
use crate::ui::components::Dialog;
use crate::ui::components::Menu;
use crate::ui::components::MenuItem;
use crate::ui::form_input::InputEvent;
use crate::ui::form_input::TextInput;
use crate::workspace::cloud::catalog::Item;
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, v_flex};
use std::path::PathBuf;

/// `PROJECT_ACTION_MENU_WIDTH`: the local menu has room for its folder's
/// commands and who can open it.
const MENU_WIDTH_LOCAL: f32 = 260.;
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
pub(in crate::app) enum Target {
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
pub(in crate::app) struct ProjectRename {
    pub target: Target,
    pub input: Entity<TextInput>,
    pub pending: bool,
    pub error: Option<String>,
}
/// Unlinking a folder or deleting a Cloud project, confirmed.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) struct ProjectConfirm {
    pub target: Target,
    pub pending: bool,
    pub error: Option<String>,
}
/// The open actions menu: its entry, where it hangs, and whether Copy path
/// just copied.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) struct ActionsMenu {
    pub target: Target,
    pub position: Point<Pixels>,
    pub copied: Option<bool>,
    /// The Homepage entry it opened from (that entry stays lit).
    pub item: Option<String>,
    /// Who can open the project, and the way to change it, as the Header's
    /// place menu says.
    pub audience: Option<super::audience::ProjectAudience>,
}

/// What the window does about a change made here.
pub(in crate::app) enum ActionsEvent {
    /// The menu opened: the Header's popovers give way.
    Opened,
    /// A folder took a new shown name.
    Renamed { path: PathBuf, name: String },
    /// A row of "Who can open it" asks for this.
    Audience(super::audience::AudienceAction),
}

pub(in crate::app) struct ProjectActions {
    preferences: Entity<PreferencesStore>,
    catalog: Entity<CloudCatalog>,
    dialogs: WeakEntity<DialogLayer>,
    /// The dialog layer's focus, which the dialogs here keep.
    dialog_focus: FocusHandle,
    /// The window's own focus, which takes the keyboard back.
    window_focus: FocusHandle,
    weak: WeakEntity<Self>,
    pub(in crate::app) menu: Option<ActionsMenu>,
    pub(in crate::app) rename: Option<ProjectRename>,
    pub(in crate::app) confirm: Option<ProjectConfirm>,
}
impl EventEmitter<ActionsEvent> for ProjectActions {}

/// `resolveDesktopActionMenuPositionBeside`: to the right of the trigger,
/// else under (or over) it, inside a 12px margin.
pub(in crate::app) fn beside(
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

impl ProjectActions {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        catalog: Entity<CloudCatalog>,
        dialogs: &Entity<DialogLayer>,
        window_focus: FocusHandle,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            preferences,
            catalog,
            dialogs: dialogs.downgrade(),
            dialog_focus: dialogs.read(cx).focus_handle().clone(),
            window_focus,
            weak: cx.weak_entity(),
            menu: None,
            rename: None,
            confirm: None,
        }
    }
    /// Opens `target`'s actions; `trigger` is the control it hangs beside,
    /// or the pointer of a right click; `item` is the Homepage entry.
    pub(in crate::app) fn open(
        &mut self,
        target: Target,
        trigger: Bounds<Pixels>,
        beside: bool,
        viewport: Size<Pixels>,
        item: Option<String>,
        cx: &mut Context<Self>,
    ) {
        let position = if beside {
            self::beside(trigger, target.width(), viewport)
        } else {
            trigger.origin
        };
        self.menu = Some(ActionsMenu {
            target,
            position,
            copied: None,
            item,
            audience: None,
        });
        cx.emit(ActionsEvent::Opened);
        cx.notify();
    }
    /// Who can open the project the open menu is for.
    pub(in crate::app) fn set_audience(
        &mut self,
        audience: Option<super::audience::ProjectAudience>,
        cx: &mut Context<Self>,
    ) {
        if let Some(menu) = &mut self.menu {
            menu.audience = audience.filter(|a| a.any());
            cx.notify();
        }
    }
    pub(in crate::app) fn close(&mut self, cx: &mut Context<Self>) {
        if self.menu.take().is_some() {
            cx.notify();
        }
    }
    /// The Homepage entry whose actions are open.
    pub(in crate::app) fn item(&self) -> Option<&str> {
        self.menu.as_ref()?.item.as_deref()
    }
    fn open_dialog(&mut self, key: DialogKey, cx: &mut Context<Self>) {
        let owner = self.weak.clone();
        let _ = self.dialogs.update(cx, |d, cx| {
            d.open_for(key, owner, Self::render_dialog, Self::dismiss_dialog, cx)
        });
    }
    fn close_dialog(&mut self, key: DialogKey, cx: &mut Context<Self>) {
        let _ = self.dialogs.update(cx, |d, cx| d.close(key, cx));
    }
    fn render_dialog(
        &mut self,
        key: DialogKey,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match key {
            DialogKey::RenameProject => self
                .rename
                .as_ref()
                .map(|r| self.project_rename_dialog(r, cx).into_any_element()),
            _ => self
                .confirm
                .as_ref()
                .map(|c| self.project_confirm_dialog(c, cx).into_any_element()),
        }
        .unwrap_or_else(|| Empty.into_any_element())
    }
    fn dismiss_dialog(&mut self, _: DialogKey, window: &mut Window, cx: &mut Context<Self>) {
        self.close_project_dialog(window, cx);
    }
    fn project_actions_menu(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let open = self.menu.clone()?;
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
            // `ProjectMenuHeader`: Copy path, first; the path itself is not
            // printed.
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
                        if let Some(open) = &mut s.menu {
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
        let audience = open.audience.clone();
        if let Some(audience) = &audience {
            let host = host.clone();
            menu = super::audience::rows(
                menu.separator(),
                audience,
                move |action, _, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.close(cx);
                        cx.emit(ActionsEvent::Audience(action));
                    });
                },
                t,
            );
        }
        if (can_rename || audience.is_some()) && (can_unlink || can_delete) {
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
                    let _ = host.update(cx, |s, cx| s.ask_confirm(target.clone(), w, cx));
                }),
            );
        }
        let dismiss = host.clone();
        let menu = menu.on_dismiss(move |_, cx| {
            let _ = dismiss.update(cx, |s, cx| s.close(cx));
        });
        Some(
            AnchoredMenu::new("project-actions-menu", open.position, menu)
                .on_dismiss(move |_, cx| {
                    let _ = host.update(cx, |s, cx| s.close(cx));
                })
                .into_any_element(),
        )
    }
    /// `ProjectRowConfirmDialog` for `target`'s unlink or delete.
    pub(in crate::app) fn ask_confirm(
        &mut self,
        target: Target,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.menu = None;
        self.confirm = Some(ProjectConfirm {
            target,
            pending: false,
            error: None,
        });
        self.open_dialog(DialogKey::ConfirmProject, cx);
        self.dialog_focus.focus(window, cx);
        cx.notify();
    }
    pub(in crate::app) fn begin_project_rename(
        &mut self,
        target: Target,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.menu = None;
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
                if let Some(rename) = s.rename.as_mut() {
                    rename.error = None;
                }
                cx.notify();
            }
        })
        .detach();
        input.read(cx).focus_handle(cx).focus(window, cx);
        self.rename = Some(ProjectRename {
            target,
            input,
            pending: false,
            error: None,
        });
        self.open_dialog(DialogKey::RenameProject, cx);
        cx.notify();
    }
    /// `renameProject` (the shown name; the folder keeps its own) or
    /// `renameCloudProject` (the Project's name, for everyone).
    pub(in crate::app) fn submit_project_rename(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(rename) = self.rename.as_ref() else {
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
                self.rename = None;
                self.close_dialog(DialogKey::RenameProject, cx);
                self.preferences
                    .update(cx, |p, cx| p.change(|p| p.rename_project(&path, &name), cx));
                cx.emit(ActionsEvent::Renamed { path, name });
                self.window_focus.focus(window, cx);
            }
            Target::Cloud { project, .. } => {
                let Some(client) = crate::features::cloud::services_client(cx) else {
                    return;
                };
                if let Some(rename) = self.rename.as_mut() {
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
                                s.rename = None;
                                s.close_dialog(DialogKey::RenameProject, cx);
                                let catalog = s.catalog.clone();
                                catalog.update(cx, |c, cx| {
                                    c.apply_rename(&project, &updated.name, cx)
                                });
                                s.window_focus.focus(w, cx);
                            }
                            Err(error) => {
                                if let Some(rename) = s.rename.as_mut() {
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
    pub(in crate::app) fn close_project_dialog(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // A change on its way cannot be dismissed (`onClose` is withheld).
        if self.rename.as_ref().is_some_and(|r| !r.pending) {
            self.rename = None;
            self.close_dialog(DialogKey::RenameProject, cx);
        }
        if self.confirm.as_ref().is_some_and(|c| !c.pending) {
            self.confirm = None;
            self.close_dialog(DialogKey::ConfirmProject, cx);
        }
        self.menu = None;
        self.window_focus.focus(window, cx);
        cx.notify();
    }
    pub(in crate::app) fn project_rename_dialog(
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
    pub(in crate::app) fn project_confirm_dialog(
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
                    .track_focus(&self.dialog_focus)
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
    pub(in crate::app) fn confirm_project_change(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(confirm) = self.confirm.as_ref() else {
            return;
        };
        if confirm.pending {
            return;
        }
        match confirm.target.clone() {
            Target::Local { path, .. } => {
                self.confirm = None;
                self.close_dialog(DialogKey::ConfirmProject, cx);
                self.preferences
                    .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
                self.window_focus.focus(window, cx);
            }
            Target::Cloud { project, .. } => {
                let Some(client) = crate::features::cloud::services_client(cx) else {
                    return;
                };
                if let Some(confirm) = self.confirm.as_mut() {
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
                                s.confirm = None;
                                s.close_dialog(DialogKey::ConfirmProject, cx);
                                let catalog = s.catalog.clone();
                                catalog.update(cx, |c, cx| c.apply_delete(&project, cx));
                                s.window_focus.focus(w, cx);
                            }
                            Err(error) => {
                                if let Some(confirm) = s.confirm.as_mut() {
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

impl Render for ProjectActions {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().children(self.project_actions_menu(cx))
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
            cloud_organization: None,
            host_folder: None,
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
