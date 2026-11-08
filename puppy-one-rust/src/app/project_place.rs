//! Where the open project is (`project-place/projectPlaceMenuState.ts`,
//! `ProjectPlaceMenu.tsx`) and what a local folder's Cloud project means
//! (`localFolderCloudNoticeState.ts`, `LocalFolderCloudNotice.tsx`).
//!
//! A local folder and its Cloud project are two projects (puppy-issues
//! ADR-001). The Header's place menu states where the open project is and
//! offers the one action that applies: put a folder in the Cloud, or open
//! the other project of a linked pair. It never moves one project between
//! this computer and the Cloud. A Cloud project's History follows. A
//! folder's link that cannot be used from here can be ended
//! (`CloudLinkDisconnectDialog`).
use super::window_cloud::{CloudEvent, WindowCloud};
use super::*;
use crate::workspace::cloud::catalog::Item;
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
            // The folder's notice explains the rest; nothing that cannot work.
            _ => None,
        }
    };
    PlaceMenu { place, action }
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

impl WindowCloud {
    /// The open local folder's notice, while Cloud is on.
    pub(super) fn local_folder_notice(&self, cx: &App) -> Option<Notice> {
        if !crate::features::flags::cloud_enabled(&self.preferences, cx)
            || self.session().file_mode
            || self.hosted().is_some()
            || self.root().is_none()
        {
            return None;
        }
        notice_of(&self.repository.read(cx).context)
    }
    /// The Header place menu's state (`placeMenu`), absent without Cloud.
    /// `items` is the shared project list, where a hosted Project finds the
    /// folder linked to it.
    pub(super) fn place_menu(&self, items: &[Item], cx: &App) -> Option<PlaceMenu> {
        if !crate::features::flags::cloud_enabled(&self.preferences, cx) {
            return None;
        }
        let hosted = self.hosted();
        let place = if hosted.is_some() {
            Place::Cloud
        } else {
            Place::Local
        };
        let linked_folder = hosted.as_ref().and_then(|project| {
            items
                .iter()
                .find(|i| i.linked.as_ref().is_some_and(|l| &l.id == project))
                .and_then(|i| Some((PathBuf::from(i.local_path.clone()?), i.label.clone())))
        });
        let unhosted = matches!(self.repository.read(cx).context, Association::LocalOnly);
        let publish_pending = self.publish.read(cx).header_status().is_some()
            && self.publish.read(cx).published.is_none();
        Some(resolve(
            place,
            unhosted,
            publish_pending,
            self.local_folder_notice(cx).as_ref(),
            linked_folder,
        ))
    }
    /// `.desktop-titlebar-place-button`: the place's mark and name.
    pub(super) fn place_button(&self, menu: &PlaceMenu) -> Button {
        let ty = theme::ty().header;
        let label = place_label(menu.place);
        Button::new("project-place")
            .variant(ButtonVariant::Titlebar)
            .icon(place_icon(menu.place).with_size(px(16.)).stroke(1.75))
            .label(label)
            .accessibility_label(format!("{label}, {}", tr("cloud.placeMenu.label")))
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .font_weight(FontWeight::MEDIUM)
    }
    /// `ProjectPlaceRows`: the current place as a fact, then the Cloud
    /// action, then History.
    pub(super) fn place_rows(
        &self,
        menu: PlaceMenu,
        cx: &App,
    ) -> impl FnOnce(crate::ui::components::Menu) -> crate::ui::components::Menu + 'static {
        let t = cx.palette();
        let host = self.weak.clone();
        let history = self.hosted().is_some() && crate::features::cloud::account::has_account(cx);
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
        let history = history.then(|| {
            let host = host.clone();
            MenuItem::new(tr("source-control.history.title"))
                .icon_sized(Icon::new("history").with_size(px(15.)).stroke(1.75))
                .on_click(move |_, cx| {
                    let _ = host.update(cx, |_, cx| {
                        cx.emit(CloudEvent::Command(Command::CloudHistory))
                    });
                })
        });
        move |surface| {
            let mut surface = surface.list(2., [current]);
            if let Some(action) = action {
                surface = surface.separator().list(2., std::iter::once(action));
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
        self.show_popover(None, cx);
        match action {
            Action::PutInCloud { .. } => self.put_in_cloud(window, cx),
            Action::OpenCloudProject { project, .. } => cx.emit(CloudEvent::OpenCloud(project)),
            Action::SignIn => self.sign_in_for_cloud(window, cx),
            Action::OpenLocalFolder { path, .. } => cx.emit(CloudEvent::OpenProject(path)),
        }
        cx.notify();
    }
    /// `onSignIn`: Account settings with a session, else the browser.
    pub(super) fn sign_in_for_cloud(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if crate::features::cloud::account::has_account(cx) {
            cx.emit(CloudEvent::OpenSettings(
                crate::features::settings::Page::Account,
            ));
        } else {
            crate::features::cloud::account::sign_in(cx);
        }
    }
    /// `openCloudDialogAt("initialize")`: the first publication of this
    /// folder, which creates its own Cloud project.
    pub(super) fn put_in_cloud(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.root().is_none() {
            return;
        }
        self.show_popover(None, cx);
        if !self.dialog_open(DialogKey::CloudPublish, cx) {
            self.open_dialog(DialogKey::CloudPublish, cx);
            // The activation page asks for the owning organization.
            self.refresh(cx);
        }
        self.dialog_focus.focus(window, cx);
        cx.notify();
    }
    /// `LocalFolderCloudNotice`: the folder stays usable; this only says
    /// what its Cloud project means and offers the one action that helps.
    pub(super) fn local_folder_notice_view(&self, cx: &App) -> Option<FloatingNotice> {
        let notice = self.local_folder_notice(cx)?;
        let root = self.root()?;
        let key = notice_key(&root, &notice);
        if self.dismissed_notice.as_deref() == Some(key.as_str()) {
            return None;
        }
        let host = self.weak.clone();
        let action =
            |id: &'static str,
             label: &'static str,
             run: fn(&mut WindowCloud, &mut Window, &mut Context<WindowCloud>)| {
                let host = host.clone();
                NoticeAction::new(id, label, move |w, cx| {
                    let _ = host.update(cx, |s, cx| run(s, w, cx));
                })
            };
        let disconnect = self.disconnectable(cx).then(|| {
            action(
                "local-folder-notice-disconnect",
                tr("cloud.localFolderNotice.disconnect"),
                |s, w, cx| s.open_disconnect(w, cx),
            )
        });
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
                            let _ = host.update(cx, |_, cx| {
                                cx.emit(CloudEvent::OpenCloud(project.clone()))
                            });
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
                disconnect,
            ),
            Notice::Missing => (
                NoticeTone::Warning,
                tr("cloud.localFolderNotice.missing").to_owned(),
                disconnect,
            ),
            Notice::NoAccess => (
                NoticeTone::Warning,
                tr("cloud.localFolderNotice.noAccess").to_owned(),
                disconnect,
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
                        s.repository.update(cx, |r, cx| r.retry(cx));
                    },
                )),
            ),
        };
        let dismiss = self.weak.clone();
        let mut notice = FloatingNotice::new("local-folder-cloud-notice", message)
            .tone(tone)
            .on_dismiss(move |_, cx| {
                let _ = dismiss.update(cx, |s, cx| {
                    s.dismissed_notice = Some(key.clone());
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
        let name = self.project_display_name(cx);
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
                    s.close_dialog(DialogKey::ConfirmPublish, cx);
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
                        s.close_dialog(DialogKey::ConfirmPublish, cx);
                        cx.notify();
                    })),
            )
            .footer(
                Button::new("cloud-publish-confirm")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.common.confirm"))
                    .track_focus(&self.dialog_focus.clone())
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.close_dialog(DialogKey::ConfirmPublish, cx);
                        s.publish.update(cx, |p, cx| {
                            p.start(crate::cloud::publication::Action::Initialize, cx)
                        });
                        cx.notify();
                    })),
            )
    }
    /// `canDisconnectCloudLink`: the folder's link can be ended from here —
    /// exactly one `puppyone` remote — whatever state it is in, except while
    /// a first publication owns it.
    pub(super) fn disconnectable(&self, cx: &App) -> bool {
        self.local_folder_notice(cx).is_some()
            && self
                .cloud_remote
                .as_ref()
                .is_some_and(|(root, _)| Some(root) == self.root().as_ref())
            && self.publish.read(cx).header_status().is_none()
    }
    /// Opens `CloudLinkDisconnectDialog` on the remote as it was reviewed.
    pub(super) fn open_disconnect(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((_, url)) = self.cloud_remote.clone() else {
            return;
        };
        if !self.disconnectable(cx) {
            return;
        }
        let project_name = match self.local_folder_notice(cx) {
            Some(Notice::Linked { name, .. }) => name,
            _ => None,
        };
        self.show_popover(None, cx);
        self.disconnect = Some(Disconnect {
            project_name,
            unsent: self.unsent(cx),
            url,
            busy: false,
            failed: false,
        });
        self.open_dialog(DialogKey::CloudDisconnect, cx);
        self.dialog_focus.focus(window, cx);
        cx.notify();
    }
    pub(super) fn close_disconnect(&mut self, cx: &mut Context<Self>) {
        self.disconnect = None;
        self.close_dialog(DialogKey::CloudDisconnect, cx);
    }
    /// Native Detach: only the folder's Git connection goes, and only if the
    /// remote is still the one reviewed. The Cloud project and the files
    /// stay; the folder is then an ordinary local project.
    pub(super) fn confirm_disconnect(&mut self, cx: &mut Context<Self>) {
        let (Some(root), Some(url)) =
            (self.root(), self.disconnect.as_ref().map(|d| d.url.clone()))
        else {
            return;
        };
        if let Some(d) = self.disconnect.as_mut() {
            if d.busy {
                return;
            }
            d.busy = true;
            d.failed = false;
        }
        cx.notify();
        let task = cx
            .background_executor()
            .spawn(async move { crate::cloud::publication::git::detach(&root, &url) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                match result {
                    Ok(()) => {
                        s.close_disconnect(cx);
                        s.cloud_remote = None;
                        s.repository.update(cx, |r, cx| r.retry(cx));
                    }
                    Err(_) => {
                        if let Some(d) = s.disconnect.as_mut() {
                            d.busy = false;
                            d.failed = true;
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
    /// `CloudLinkDisconnectDialog`: what ending the link does, Cancel first.
    pub(super) fn disconnect_dialog(&self, d: &Disconnect, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let host = self.weak.clone();
        let busy = d.busy;
        let mut text = match &d.project_name {
            Some(name) => tf(
                "cloud.disconnect.description",
                &[("project", crate::localization::bidi_isolate(name).into())],
            ),
            None => tr("cloud.disconnect.descriptionUnnamed").to_owned(),
        };
        if d.unsent > 0 {
            text.push(' ');
            text.push_str(&tf(
                "cloud.disconnect.unsent",
                &[("count", d.unsent.into())],
            ));
        }
        Dialog::new("cloud-disconnect")
            .width(420.)
            .title(tr("cloud.disconnect.title"))
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| {
                    if !busy {
                        s.close_disconnect(cx);
                        cx.notify();
                    }
                });
            })
            .child(
                div()
                    .text_size(px(theme::ty().ui.body))
                    .line_height(relative(1.5))
                    .text_color(t.muted)
                    .child(text),
            )
            .when(d.failed, |dialog| {
                dialog.child(
                    div()
                        .pt(px(8.))
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(tr("cloud.disconnect.failed")),
                )
            })
            .footer(
                // Cancel holds the focus: ending a link is not one Enter away.
                Button::new("cloud-disconnect-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(busy)
                    .track_focus(&self.dialog_focus.clone())
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.close_disconnect(cx);
                        cx.notify();
                    })),
            )
            .footer(
                Button::new("cloud-disconnect-confirm")
                    .variant(ButtonVariant::SolidDanger)
                    .label(tr(if busy {
                        "cloud.disconnect.progress"
                    } else {
                        "cloud.disconnect.confirm"
                    }))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, _, cx| s.confirm_disconnect(cx))),
            )
    }
}

/// Ending a folder's Cloud link, as reviewed when the dialog opened.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Disconnect {
    pub project_name: Option<String>,
    /// Commits here that the Cloud project has not had.
    pub unsent: u32,
    /// The `puppyone` remote's URL, compared again under the lock.
    pub url: String,
    pub busy: bool,
    pub failed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_place_menu_offers_the_one_action_that_applies() {
        let local = |unhosted, pending, notice: Option<Notice>| {
            resolve(Place::Local, unhosted, pending, notice.as_ref(), None).action
        };
        assert_eq!(
            local(true, false, None),
            Some(Action::PutInCloud { continuing: false })
        );
        assert_eq!(
            local(false, true, None),
            Some(Action::PutInCloud { continuing: true })
        );
        let linked = Notice::Linked {
            project: "p".into(),
            name: Some("P".into()),
            openable: true,
        };
        assert_eq!(
            local(false, false, Some(linked)),
            Some(Action::OpenCloudProject {
                project: "p".into(),
                name: Some("P".into())
            })
        );
        assert_eq!(
            local(false, false, Some(Notice::SignIn)),
            Some(Action::SignIn)
        );
        // A vanished project is ended from its notice, never replaced.
        assert_eq!(local(false, false, Some(Notice::Missing)), None);
        assert_eq!(local(false, false, Some(Notice::NoAccess)), None);
        let cloud = resolve(
            Place::Cloud,
            false,
            false,
            None,
            Some(("/x/a".into(), "A".into())),
        );
        assert_eq!(
            cloud.action,
            Some(Action::OpenLocalFolder {
                path: "/x/a".into(),
                name: "A".into()
            })
        );
        assert_eq!(resolve(Place::Cloud, false, false, None, None).action, None);
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
