//! Where the open project is (`project-place/projectPlaceMenuState.ts`,
//! `ProjectPlaceMenu.tsx`) and what a local folder's Cloud project means
//! (`localFolderCloudNoticeState.ts`, `LocalFolderCloudNotice.tsx`).
//!
//! A local folder and its Cloud project are two projects (puppy-issues
//! ADR-001). The Header's place menu states where the open project is and
//! offers the one action that applies: put a folder in the Cloud, or open
//! the other project of a linked pair. It never moves one project between
//! this computer and the Cloud. Inviting a person and connecting an agent
//! sit under putting it in the Cloud; a Cloud project's History follows.
use super::*;
use crate::{
    localization::{t as tr, tf},
    ui::components::{
        Button, ButtonVariant, Dialog, FloatingNotice, Icon, MenuItem, NoticeAction, NoticeTone,
        ProductIcon,
    },
    workspace::cloud::repository::Context as Association,
};
use gpui_kit::{base::Disableable as _, component::Sizable as _};

/// `preferredWidth={280}` (content width, at most 320).
pub(super) const PLACE_MENU_WIDTH: f32 = 280.;

/// What a local folder's Cloud association means for the person.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Notice {
    /// `openable` is false for a scoped checkout.
    Linked {
        project: String,
        name: Option<String>,
        openable: bool,
    },
    SignIn,
    OtherEnvironment {
        origin: Option<String>,
    },
    Missing,
    NoAccess,
    Ambiguous,
    /// The readable cause, when the Cloud gave one.
    Unreachable {
        cause: Option<&'static str>,
    },
}
/// `resolveLocalFolderCloudNotice`.
pub(super) fn notice_of(context: &Association) -> Option<Notice> {
    Some(match context {
        Association::LocalOnly | Association::Resolving => return None,
        Association::Resolved { project, name } => Notice::Linked {
            project: project.clone(),
            name: Some(name.trim().to_owned()).filter(|n| !n.is_empty()),
            openable: true,
        },
        Association::WrongAccount => Notice::SignIn,
        Association::WrongHost { origin } => Notice::OtherEnvironment {
            origin: Some(origin.trim().to_owned()).filter(|o| !o.is_empty()),
        },
        Association::NotFound { .. } => Notice::Missing,
        Association::NotAuthorized => Notice::NoAccess,
        Association::LocatorConflict => Notice::Ambiguous,
        Association::TemporarilyUnavailable | Association::Mismatch | Association::Unresolvable => {
            Notice::Unreachable {
                cause: context.message().map(|(key, _)| key),
            }
        }
    })
}
/// `localFolderCloudNoticeKey`: a new folder or a new meaning shows again.
pub(super) fn notice_key(root: &std::path::Path, notice: &Notice) -> String {
    let kind = match notice {
        Notice::Linked { project, .. } => return format!("{}\nlinked\n{project}", root.display()),
        Notice::SignIn => "sign-in",
        Notice::OtherEnvironment { .. } => "other-environment",
        Notice::Missing => "missing",
        Notice::NoAccess => "no-access",
        Notice::Ambiguous => "ambiguous",
        Notice::Unreachable { .. } => "unreachable",
    };
    format!("{}\n{kind}", root.display())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Place {
    Local,
    Cloud,
}
/// `ProjectPlaceAction`.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Action {
    /// A folder without a Cloud project; the conversion entry.
    PutInCloud {
        continuing: bool,
    },
    OpenCloudProject {
        project: String,
        name: Option<String>,
    },
    SignIn,
    PutInCloudAgain,
    OpenLocalFolder {
        path: PathBuf,
        name: String,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PlaceMenu {
    pub place: Place,
    pub action: Option<Action>,
}
/// `resolveProjectPlaceMenu`.
pub(super) fn resolve(
    place: Place,
    unhosted: bool,
    publish_pending: bool,
    notice: Option<&Notice>,
    missing_replaceable: bool,
    linked_folder: Option<(PathBuf, String)>,
) -> PlaceMenu {
    let action = if place == Place::Cloud {
        linked_folder.map(|(path, name)| Action::OpenLocalFolder { path, name })
    } else if publish_pending {
        Some(Action::PutInCloud { continuing: true })
    } else if unhosted {
        Some(Action::PutInCloud { continuing: false })
    } else {
        match notice {
            Some(Notice::Linked {
                project,
                name,
                openable: true,
            }) => Some(Action::OpenCloudProject {
                project: project.clone(),
                name: name.clone(),
            }),
            Some(Notice::SignIn) => Some(Action::SignIn),
            Some(Notice::Missing) if missing_replaceable => Some(Action::PutInCloudAgain),
            // The folder's notice explains the rest; nothing that cannot work.
            _ => None,
        }
    };
    PlaceMenu { place, action }
}
/// `sharesThroughCloud`: inviting and connecting reach this folder's Cloud
/// project, new or existing.
fn shares_through_cloud(action: &Action) -> bool {
    matches!(
        action,
        Action::PutInCloud { .. } | Action::OpenCloudProject { .. }
    )
}
fn place_label(place: Place) -> &'static str {
    match place {
        Place::Cloud => tr("cloud.home.location.cloud"),
        Place::Local if cfg!(target_os = "macos") => tr("shell.workspaceSwitcher.location.thisMac"),
        Place::Local => tr("shell.workspaceSwitcher.location.thisComputer"),
    }
}
fn place_icon(place: Place) -> Icon {
    Icon::product(match place {
        Place::Local => ProductIcon::Local,
        Place::Cloud => ProductIcon::Cloud,
    })
}

impl Shell {
    /// The open local folder's notice, while Cloud is on.
    pub(super) fn local_folder_notice(&self, cx: &App) -> Option<Notice> {
        if !crate::features::flags::cloud_enabled(&self.preferences, cx)
            || self.file_mode()
            || self.hosted_project().is_some()
            || self.workspace_root().is_none()
        {
            return None;
        }
        notice_of(&self.cloud.repository.read(cx).context)
    }
    /// `canReplaceMissingCloudProject`: signed in, the Project is gone, and
    /// the checkout has exactly the reviewed `puppyone` remote.
    fn missing_replaceable(&self, cx: &App) -> bool {
        crate::features::cloud_account::has_account(cx)
            && matches!(
                self.cloud.repository.read(cx).context,
                Association::NotFound { .. }
            )
            && self.workspace_root().is_some()
    }
    /// The Header place menu's state (`placeMenu`), absent without Cloud.
    pub(super) fn place_menu(&self, cx: &App) -> Option<PlaceMenu> {
        if !crate::features::flags::cloud_enabled(&self.preferences, cx) {
            return None;
        }
        let hosted = self.hosted_project();
        let place = if hosted.is_some() {
            Place::Cloud
        } else {
            Place::Local
        };
        let linked_folder = hosted.as_ref().and_then(|project| {
            self.project_items(cx)
                .into_iter()
                .find(|i| i.linked.as_ref().is_some_and(|l| &l.id == project))
                .and_then(|i| Some((PathBuf::from(i.local_path?), i.label)))
        });
        let unhosted = matches!(
            self.cloud.repository.read(cx).context,
            Association::LocalOnly
        );
        let publish_pending = self.cloud.publish.read(cx).header_status().is_some()
            && self.cloud.publish.read(cx).published.is_none();
        Some(resolve(
            place,
            unhosted,
            publish_pending,
            self.local_folder_notice(cx).as_ref(),
            self.missing_replaceable(cx),
            linked_folder,
        ))
    }
    /// `.desktop-titlebar-place-button`: the place's mark and name.
    pub(super) fn place_control(&self, menu: &PlaceMenu, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().header;
        let label = place_label(menu.place);
        let button = Button::new("project-place")
            .variant(ButtonVariant::Titlebar)
            .icon(place_icon(menu.place).with_size(px(16.)).stroke(1.75))
            .label(label)
            .accessibility_label(format!("{label}, {}", tr("cloud.placeMenu.label")))
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .font_weight(FontWeight::MEDIUM);
        self.header_popover(Popover::Place, button, cx)
            .into_any_element()
    }
    /// `ProjectPlaceRows`: the current place as a fact, then the Cloud
    /// action with inviting and connecting under it, then History.
    pub(super) fn place_rows(
        &self,
        menu: PlaceMenu,
        cx: &App,
    ) -> impl FnOnce(crate::ui::components::Menu) -> crate::ui::components::Menu + 'static {
        let t = cx.palette();
        let host = self.weak.clone();
        let sharing = crate::features::flags::share_enabled(&self.preferences, cx)
            && menu.action.as_ref().is_some_and(shares_through_cloud);
        let history =
            self.hosted_project().is_some() && crate::features::cloud_account::has_account(cx);
        let current = MenuItem::new(place_label(menu.place))
            .icon_sized(place_icon(menu.place).with_size(px(15.)).stroke(1.75))
            .selected(true)
            .trailing(Icon::new("check").small());
        let action = menu.action.clone().map(|action| {
            let (place, icon, label, detail) = match &action {
                Action::PutInCloud { continuing } => (
                    Place::Cloud,
                    Icon::product(ProductIcon::CloudUpload),
                    tr(if *continuing {
                        "cloud.placeMenu.continuePutInCloud"
                    } else {
                        "cloud.placeMenu.putInCloud"
                    }),
                    None,
                ),
                Action::OpenCloudProject { name, .. } => (
                    Place::Cloud,
                    Icon::product(ProductIcon::Cloud),
                    tr("cloud.localFolderNotice.openProject"),
                    name.clone(),
                ),
                Action::SignIn => (
                    Place::Cloud,
                    Icon::product(ProductIcon::Cloud),
                    tr("cloud.auth.signIn"),
                    None,
                ),
                Action::PutInCloudAgain => (
                    Place::Cloud,
                    Icon::product(ProductIcon::CloudUpload),
                    tr("cloud.localFolderNotice.putInCloud"),
                    None,
                ),
                Action::OpenLocalFolder { name, .. } => (
                    Place::Local,
                    Icon::product(ProductIcon::Local),
                    tr(if cfg!(target_os = "macos") {
                        "cloud.placeMenu.openFolder.mac"
                    } else {
                        "cloud.placeMenu.openFolder.computer"
                    }),
                    Some(name.clone()),
                ),
            };
            // The action that reaches the Cloud carries the product blue.
            let icon = icon.with_size(px(15.)).stroke(1.75);
            let icon = if place == Place::Cloud {
                icon.color(t.brand_blue)
            } else {
                icon
            };
            let host = host.clone();
            let mut row = MenuItem::new(label)
                .icon_sized(icon)
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| s.run_place_action(action.clone(), w, cx));
                });
            if let Some(detail) = detail {
                row = row.detail_below(detail);
            }
            row
        });
        let invite = sharing.then(|| {
            let host = host.clone();
            MenuItem::new(tr("shell.projectReach.invitePerson"))
                .icon_sized(Icon::new("user-plus").small().stroke(1.8))
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| s.open_cloud_share(String::new(), w, cx));
                })
        });
        let connect = sharing.then(|| {
            let host = host.clone();
            MenuItem::new(tr("shell.projectReach.connectAgent"))
                .icon_sized(Icon::new("plug").small().stroke(1.8))
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| s.open_cloud_share(String::new(), w, cx));
                })
        });
        let history = history.then(|| {
            let host = host.clone();
            MenuItem::new(tr("source-control.history.title"))
                .icon_sized(Icon::new("history").with_size(px(15.)).stroke(1.75))
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| s.command(Command::CloudHistory, w, cx));
                })
        });
        move |surface| {
            let mut surface = surface.list(2., [current]);
            if let Some(action) = action {
                surface = surface
                    .separator()
                    .list(2., std::iter::once(action).chain(invite).chain(connect));
            }
            if let Some(history) = history {
                surface = surface.separator().item(history);
            }
            surface
        }
    }
    /// The place menu's one action.
    pub(super) fn run_place_action(
        &mut self,
        action: Action,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.popover = None;
        match action {
            Action::PutInCloud { .. } => self.put_in_cloud(window, cx),
            Action::OpenCloudProject { project, .. } => self.open_cloud(project, cx),
            Action::SignIn => self.sign_in_for_cloud(window, cx),
            Action::PutInCloudAgain => self.replace_cloud_connection(window, cx),
            Action::OpenLocalFolder { path, .. } => self.open_project(path, window, cx),
        }
        cx.notify();
    }
    /// `onSignIn`: Account settings with a session, else the browser.
    pub(super) fn sign_in_for_cloud(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if crate::features::cloud_account::has_account(cx) {
            self.command(Command::Settings, window, cx);
            self.task_ui.settings.update(cx, |settings, cx| {
                settings.select_page(crate::features::settings::Page::Account, cx)
            });
        } else {
            crate::features::cloud_account::sign_in(cx);
        }
    }
    /// `openCloudDialogAt("initialize")`: the first publication of this
    /// folder, which creates its own Cloud project.
    pub(super) fn put_in_cloud(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.workspace_root().is_none() {
            return;
        }
        self.popover = None;
        if !self.modals.iter().any(|m| matches!(m, Modal::CloudPublish)) {
            self.modals.open(Modal::CloudPublish);
        }
        self.modal_focus.focus(window, cx);
        cx.notify();
    }
    /// `setReplacingMissingCloudProject(true)`.
    pub(super) fn replace_cloud_connection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Association::NotFound { project } = self.cloud.repository.read(cx).context.clone()
        else {
            return;
        };
        self.modals.open(Modal::ReplaceCloud(ReplaceCloud {
            project,
            busy: false,
            failed: false,
        }));
        self.modal_focus.focus(window, cx);
        self.begin_replace(cx);
    }
    /// `LocalFolderCloudNotice`: the folder stays usable; this only says
    /// what its Cloud project means and offers the one action that helps.
    pub(super) fn local_folder_notice_view(
        &self,
        cx: &mut Context<Self>,
    ) -> Option<FloatingNotice> {
        let notice = self.local_folder_notice(cx)?;
        let root = self.workspace_root()?;
        let key = notice_key(&root, &notice);
        if self.cloud.dismissed_notice.as_deref() == Some(key.as_str()) {
            return None;
        }
        let host = self.weak.clone();
        let action = |id: &'static str,
                      label: &'static str,
                      run: fn(&mut Shell, &mut Window, &mut Context<Shell>)| {
            let host = host.clone();
            NoticeAction::new(id, label, move |w, cx| {
                let _ = host.update(cx, |s, cx| run(s, w, cx));
            })
        };
        let replaceable = self.missing_replaceable(cx);
        let (tone, message, action) = match &notice {
            Notice::Linked {
                project,
                name,
                openable,
            } => {
                let message = match name {
                    Some(name) => tf(
                        "cloud.localFolderNotice.linked",
                        &[("name", name.clone().into())],
                    ),
                    None => tr("cloud.localFolderNotice.linkedUnnamed").to_owned(),
                };
                let project = project.clone();
                let host = host.clone();
                let open = openable.then(|| {
                    NoticeAction::new(
                        "local-folder-notice-open",
                        tr("cloud.localFolderNotice.openProject"),
                        move |_, cx| {
                            let _ = host.update(cx, |s, cx| s.open_cloud(project.clone(), cx));
                        },
                    )
                });
                (NoticeTone::Info, message, open)
            }
            Notice::SignIn => (
                NoticeTone::Info,
                tr("cloud.localFolderNotice.signIn").to_owned(),
                Some(action(
                    "local-folder-notice-sign-in",
                    tr("cloud.auth.signIn"),
                    |s, w, cx| s.sign_in_for_cloud(w, cx),
                )),
            ),
            Notice::OtherEnvironment { origin } => (
                NoticeTone::Info,
                match origin {
                    Some(origin) => tf(
                        "cloud.localFolderNotice.otherEnvironment",
                        &[("origin", origin.clone().into())],
                    ),
                    None => tr("cloud.localFolderNotice.otherEnvironmentUnknown").to_owned(),
                },
                None,
            ),
            Notice::Missing => (
                NoticeTone::Warning,
                tr(if replaceable {
                    "cloud.localFolderNotice.missing"
                } else {
                    "cloud.localFolderNotice.missingNoAction"
                })
                .to_owned(),
                replaceable.then(|| {
                    action(
                        "local-folder-notice-put",
                        tr("cloud.localFolderNotice.putInCloud"),
                        |s, w, cx| s.replace_cloud_connection(w, cx),
                    )
                }),
            ),
            Notice::NoAccess => (
                NoticeTone::Warning,
                tr("cloud.localFolderNotice.noAccess").to_owned(),
                None,
            ),
            Notice::Ambiguous => (
                NoticeTone::Warning,
                tr("cloud.localFolderNotice.ambiguous").to_owned(),
                None,
            ),
            Notice::Unreachable { cause } => (
                NoticeTone::Warning,
                match cause {
                    Some(cause) => format!(
                        "{} {}",
                        tr("cloud.localFolderNotice.unreachable"),
                        tr(cause)
                    ),
                    None => tr("cloud.localFolderNotice.unreachable").to_owned(),
                },
                Some(action(
                    "local-folder-notice-retry",
                    tr("common.action.retry"),
                    |s, _, cx| {
                        s.cloud.repository.update(cx, |r, cx| r.retry(cx));
                    },
                )),
            ),
        };
        let dismiss = self.weak.clone();
        let mut notice = FloatingNotice::new("local-folder-cloud-notice", message)
            .tone(tone)
            .on_dismiss(move |_, cx| {
                let _ = dismiss.update(cx, |s, cx| {
                    s.cloud.dismissed_notice = Some(key.clone());
                    cx.notify();
                });
            });
        if let Some(action) = action {
            notice = notice.action(action);
        }
        Some(notice)
    }
    /// `CloudPublishConfirmationDialog`: the new Cloud project is another
    /// project; it is said before it exists.
    pub(super) fn publish_confirmation_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let name = self.project_display_name();
        let host = self.weak.clone();
        Dialog::new("cloud-publish-confirmation")
            .width(400.)
            .title(tr("cloud.initialize.title"))
            .leading(
                Icon::product(ProductIcon::CloudUpload)
                    .with_size(px(17.))
                    .stroke(1.8),
                t.brand_blue,
            )
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.modals.remove(|m| matches!(m, Modal::ConfirmPublish));
                    cx.notify();
                });
            })
            .child(
                div()
                    .text_size(px(theme::ty().ui.body))
                    .line_height(relative(1.5))
                    .text_color(t.muted)
                    .child(if name.trim().is_empty() {
                        tr("cloud.initialize.gitIgnoreNote").to_owned()
                    } else {
                        tf(
                            "cloud.initialize.separateProjectNote",
                            &[("name", name.into())],
                        )
                    }),
            )
            .footer(
                Button::new("cloud-publish-confirm-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("cloud.common.cancel"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.modals.remove(|m| matches!(m, Modal::ConfirmPublish));
                        cx.notify();
                    })),
            )
            .footer(
                Button::new("cloud-publish-confirm")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.common.confirm"))
                    .track_focus(&self.modal_focus)
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.modals.remove(|m| matches!(m, Modal::ConfirmPublish));
                        s.cloud.publish.update(cx, |p, cx| {
                            p.start(crate::cloud_publication::Action::Initialize, cx)
                        });
                        cx.notify();
                    })),
            )
    }
    /// `MissingCloudProjectReplacement`: retire the folder's link to the
    /// Cloud project that no longer exists, then continue to the first
    /// publication. If the project is reachable again, the link stays.
    pub(super) fn replace_cloud_dialog(
        &self,
        replace: &ReplaceCloud,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let host = self.weak.clone();
        let busy = replace.busy;
        let project = replace.project.clone();
        Dialog::new("cloud-replace")
            .width(400.)
            .title(tr("cloud.activation.project.replaceTitle"))
            .leading(
                Icon::product(ProductIcon::CloudUpload)
                    .with_size(px(17.))
                    .stroke(1.8),
                t.brand_blue,
            )
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| {
                    if !busy {
                        s.modals.remove(|m| matches!(m, Modal::ReplaceCloud(_)));
                        cx.notify();
                    }
                });
            })
            .child(
                div()
                    .text_size(px(theme::ty().ui.body))
                    .line_height(relative(1.5))
                    .text_color(t.muted)
                    .child(tr("cloud.activation.project.replaceDescription")),
            )
            .when(replace.failed, |d| {
                d.child(
                    div()
                        .pt(px(8.))
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(tr("cloud.activation.project.replaceFailed")),
                )
            })
            .footer(
                Button::new("cloud-replace-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("cloud.common.cancel"))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.modals.remove(|m| matches!(m, Modal::ReplaceCloud(_)));
                        cx.notify();
                    })),
            )
            .footer(
                Button::new("cloud-replace-confirm")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.activation.project.replaceConfirm"))
                    .disabled(busy || self.cloud.replace_url.is_none())
                    .track_focus(&self.modal_focus)
                    .on_click(
                        cx.listener(move |s, _, _, cx| s.confirm_replace(project.clone(), cx)),
                    ),
            )
    }
}

/// The replacement in progress.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct ReplaceCloud {
    pub project: String,
    pub busy: bool,
    pub failed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_place_menu_offers_the_one_action_that_applies() {
        let local = |unhosted, pending, notice: Option<Notice>, replaceable| {
            resolve(
                Place::Local,
                unhosted,
                pending,
                notice.as_ref(),
                replaceable,
                None,
            )
            .action
        };
        assert_eq!(
            local(true, false, None, false),
            Some(Action::PutInCloud { continuing: false })
        );
        assert_eq!(
            local(false, true, None, false),
            Some(Action::PutInCloud { continuing: true })
        );
        let linked = Notice::Linked {
            project: "p".into(),
            name: Some("P".into()),
            openable: true,
        };
        assert_eq!(
            local(false, false, Some(linked), false),
            Some(Action::OpenCloudProject {
                project: "p".into(),
                name: Some("P".into())
            })
        );
        assert_eq!(
            local(false, false, Some(Notice::SignIn), false),
            Some(Action::SignIn)
        );
        assert_eq!(local(false, false, Some(Notice::Missing), false), None);
        assert_eq!(
            local(false, false, Some(Notice::Missing), true),
            Some(Action::PutInCloudAgain)
        );
        assert_eq!(local(false, false, Some(Notice::NoAccess), false), None);
        let cloud = resolve(
            Place::Cloud,
            false,
            false,
            None,
            false,
            Some(("/x/a".into(), "A".into())),
        );
        assert_eq!(
            cloud.action,
            Some(Action::OpenLocalFolder {
                path: "/x/a".into(),
                name: "A".into()
            })
        );
        assert_eq!(
            resolve(Place::Cloud, false, false, None, false, None).action,
            None
        );
    }

    #[test]
    fn notices_follow_the_association() {
        assert_eq!(notice_of(&Association::LocalOnly), None);
        assert_eq!(notice_of(&Association::Resolving), None);
        assert_eq!(notice_of(&Association::WrongAccount), Some(Notice::SignIn));
        assert_eq!(
            notice_of(&Association::Resolved {
                project: "p".into(),
                name: "  ".into()
            }),
            Some(Notice::Linked {
                project: "p".into(),
                name: None,
                openable: true
            })
        );
        assert!(matches!(
            notice_of(&Association::TemporarilyUnavailable),
            Some(Notice::Unreachable { .. })
        ));
        let root = std::path::Path::new("/x/a");
        assert_ne!(
            notice_key(root, &Notice::SignIn),
            notice_key(root, &Notice::Missing)
        );
    }
}
