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
    /// Another of the owner's computers (`place: "computer"`): its name is
    /// the address, what it allows the detail.
    Computer,
}
/// `ProjectPlaceAction`: from a Cloud project, the folder it was made from.
/// It never moves one project between this computer and the Cloud.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Action {
    OpenLocalFolder { path: PathBuf, name: String },
}
/// `ProjectPlaceAddress`: where exactly the open project is. The icon says
/// which kind of place, so the words say where: a local project's folder
/// from the home folder, or the organization that holds a Cloud project.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Address {
    pub short: String,
    pub full: String,
}
/// `ProjectPlaceMenu`.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PlaceMenu {
    pub place: Place,
    /// Absent while it is unknown; the Header then names the kind of place.
    pub address: Option<Address>,
    pub action: Option<Action>,
    /// The open local folder's Cloud link: what it means, and whether this
    /// app can end it.
    pub link: Option<(Notice, bool)>,
    /// Another computer's folder: what that computer allows in it.
    pub detail: Option<String>,
}
/// `resolveProjectPlaceMenu`.
pub(super) fn resolve(
    place: Place,
    address: Option<Address>,
    notice: Option<Notice>,
    disconnectable: bool,
    linked_folder: Option<(PathBuf, String)>,
) -> PlaceMenu {
    match place {
        Place::Cloud => PlaceMenu {
            place,
            address,
            action: linked_folder.map(|(path, name)| Action::OpenLocalFolder { path, name }),
            link: None,
            detail: None,
        },
        Place::Local => PlaceMenu {
            place,
            address,
            action: None,
            link: notice.map(|n| (n, disconnectable)),
            detail: None,
        },
        Place::Computer => PlaceMenu {
            place,
            address,
            action: None,
            link: None,
            detail: None,
        },
    }
}
/// `cloudLinkHasProblem`: the link exists but cannot be used from here.
pub(super) fn link_has_problem(link: Option<&(Notice, bool)>) -> bool {
    link.is_some_and(|(n, _)| !matches!(n, Notice::Linked { .. } | Notice::SignIn))
}
/// `compactDisplayPath`: a display path short enough for one line: its
/// root and its last `tail` folders, with the ones between elided.
pub(super) fn compact_display_path(path: &str, tail: usize) -> String {
    let separator = if path.contains('\\') && !path.contains('/') {
        '\\'
    } else {
        '/'
    };
    let parts: Vec<&str> = path.split(separator).collect();
    if parts.len() <= tail + 2 {
        return path.to_owned();
    }
    let mut kept = vec![parts[0], "…"];
    kept.extend(&parts[parts.len() - tail..]);
    kept.join(&separator.to_string())
}
/// `localProjectAddress`: the folder that holds a local project, from the
/// home folder, shortened.
pub(super) fn local_address(path: &std::path::Path) -> Option<Address> {
    let full = super::home::path_for_display(path);
    let trimmed = full.trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let parent = match trimmed.rfind('/') {
        Some(0) if trimmed.len() > 1 => "/".to_owned(),
        Some(cut) if cut > 0 => trimmed[..cut].to_owned(),
        _ => trimmed.to_owned(),
    };
    Some(Address {
        short: compact_display_path(&parent, 2),
        full: trimmed.to_owned(),
    })
}
/// `cloudProjectAddress`: the organization that holds a Cloud project.
pub(super) fn cloud_address(organization: Option<&str>) -> Option<Address> {
    let name = organization?.trim();
    (!name.is_empty()).then(|| Address {
        short: name.to_owned(),
        full: name.to_owned(),
    })
}
/// The audience's view of a folder's link (`useLocalProjectAudience`).
fn audience_link(notice: &Notice) -> super::audience::Link {
    use super::audience::Link;
    match notice {
        Notice::Linked {
            project, openable, ..
        } => Link::Linked {
            project: project.clone(),
            openable: *openable,
        },
        Notice::SignIn => Link::SignIn,
        Notice::OtherEnvironment { origin } => Link::OtherEnvironment(origin.clone()),
        Notice::Missing => Link::Missing,
        Notice::NoAccess => Link::NoAccess,
        Notice::Ambiguous => Link::Ambiguous,
        Notice::Unreachable { .. } => Link::Unreachable,
    }
}
fn place_label(place: Place) -> &'static str {
    match place {
        Place::Cloud => tr("cloud.home.location.cloud"),
        Place::Local if cfg!(target_os = "macos") => tr("shell.workspaceSwitcher.location.thisMac"),
        Place::Local | Place::Computer => tr("shell.workspaceSwitcher.location.thisComputer"),
    }
}
fn place_icon(place: Place) -> Icon {
    Icon::product(match place {
        Place::Local | Place::Computer => ProductIcon::Local,
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
    /// folder linked to it and its space.
    pub(super) fn place_menu(&self, items: &[Item], cx: &App) -> Option<PlaceMenu> {
        // `DeviceFolderHeader`: the computer it lives on, and what that
        // computer allows; nothing to do from here.
        if let Some(remote) = &self.session().device {
            let host = remote.host.clone();
            return Some(PlaceMenu {
                detail: Some(
                    tr(if remote.writable {
                        "hosts.catalog.editable"
                    } else {
                        "hosts.catalog.readOnly"
                    })
                    .to_owned(),
                ),
                ..resolve(
                    Place::Computer,
                    Some(Address {
                        short: host.clone(),
                        full: host,
                    }),
                    None,
                    false,
                    None,
                )
            });
        }
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
        let address = match &hosted {
            Some(project) => {
                let org = items
                    .iter()
                    .find(|i| i.cloud_project.as_deref() == Some(project.as_str()))
                    .and_then(|i| i.cloud_organization.clone());
                let name = org.and_then(|org| {
                    crate::features::cloud::global_spaces_read(cx)
                        .and_then(|s| s.space(&org).map(|space| space.name.clone()))
                });
                cloud_address(name.as_deref())
            }
            None => self.root().and_then(|root| local_address(&root)),
        };
        Some(resolve(
            place,
            address,
            self.local_folder_notice(cx),
            self.disconnectable(cx),
            linked_folder,
        ))
    }
    /// `useLocalProjectAudience`: who can open the open local folder.
    pub(super) fn local_audience(
        &self,
        menu: &PlaceMenu,
        items: &[Item],
        cx: &App,
    ) -> Option<super::audience::ProjectAudience> {
        if menu.place != Place::Local {
            return None;
        }
        let root = self.root()?;
        let spaces = crate::features::cloud::global_spaces_read(cx);
        let linked_project = match &menu.link {
            Some((Notice::Linked { project, .. }, _)) => Some(project.clone()),
            _ => None,
        };
        let linked_space_personal = linked_project
            .and_then(|project| {
                items
                    .iter()
                    .find(|i| i.cloud_project.as_deref() == Some(project.as_str()))
                    .and_then(|i| i.cloud_organization.clone())
            })
            .and_then(|org| spaces.and_then(|s| s.space(&org).map(|s| s.is_default)))
            == Some(true);
        let copy_team = spaces
            .and_then(|s| {
                s.spaces()
                    .iter()
                    .find(|s| !s.is_default && s.can_create_projects)
            })
            .map(|team| (root.clone(), team.id.clone()));
        let unhosted = matches!(self.repository.read(cx).context, Association::LocalOnly);
        let publish_pending = self.publish.read(cx).header_status().is_some()
            && self.publish.read(cx).published.is_none();
        super::audience::local(
            true,
            self.devices_audience(&root, cx),
            menu.link
                .as_ref()
                .map(|(notice, disconnectable)| (audience_link(notice), *disconnectable)),
            unhosted,
            publish_pending,
            linked_space_personal,
            copy_team,
            self.unsent(cx),
        )
    }
    /// The open folder's other computers (`useHostFolderPlace`); the hosts
    /// fill this in.
    pub(super) fn devices_audience(
        &self,
        root: &std::path::Path,
        cx: &App,
    ) -> Option<super::audience::Devices> {
        use super::audience::{AudienceAction as A, Devices};
        if !crate::features::flags::host_devices_enabled(&self.preferences, cx)
            || !crate::features::cloud::account::has_account(cx)
            || self.session().file_mode
        {
            return None;
        }
        let link = crate::features::hosts::read_link(cx);
        let status = link.and_then(|l| l.status.as_ref());
        let recorded = self
            .preferences
            .read(cx)
            .state
            .recent_projects
            .iter()
            .find(|p| p.path == root)
            .and_then(|p| p.host_folder.clone());
        let folder = link
            .and_then(|l| l.folder_of(root))
            .map(|f| f.folder_id.clone())
            .or(recorded);
        // Until this computer's own host answers, a recorded share is taken
        // at its word.
        let shared = folder
            .as_ref()
            .is_some_and(|id| status.is_none_or(|s| s.folders.iter().any(|f| &f.folder_id == id)));
        let names: Vec<String> = crate::features::hosts::read(cx)
            .map(|c| c.others().map(|d| d.name.clone()).collect())
            .unwrap_or_default();
        let path = root.to_path_buf();
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Some(Devices {
            on: shared,
            detail: shared.then(|| {
                super::audience::other_computers(&names, status.is_some_and(|s| s.paused))
            }),
            turn_on: (!shared).then(|| A::TurnOnDevices { path: path.clone() }),
            stop: folder
                .clone()
                .filter(|_| shared && status.is_some())
                .map(|folder| A::StopDevices {
                    folder,
                    path: path.clone(),
                }),
            settings: folder.filter(|_| shared).map(|folder| A::DeviceSettings {
                folder,
                name,
                path,
            }),
        })
    }
    /// `.desktop-titlebar-place-button`: the place's mark, then its address
    /// (or the kind of place while the address is unknown), and a small
    /// cloud after a folder's address when the folder has a copy in the
    /// Cloud.
    pub(super) fn place_button(&self, menu: &PlaceMenu, cx: &App) -> Button {
        let t = cx.palette();
        let ty = theme::ty().header;
        let label = match (&menu.place, &menu.address) {
            (Place::Computer, Some(address)) => tf(
                "hosts.folder.onHost",
                &[("host", address.full.as_str().into())],
            ),
            _ => place_label(menu.place).to_owned(),
        };
        let text = menu
            .address
            .as_ref()
            .map_or_else(|| label.clone(), |a| a.short.clone());
        let accessible = [
            Some(label.clone()),
            menu.address
                .as_ref()
                .map(|a| a.full.clone())
                .filter(|full| *full != label && menu.place != Place::Computer),
            menu.detail.clone(),
            menu.link
                .as_ref()
                .map(|_| tr("cloud.placeMenu.link.linked").to_owned()),
            Some(tr("cloud.placeMenu.label").to_owned()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(", ");
        let icon = place_icon(menu.place).with_size(px(16.)).stroke(1.75);
        let icon = if menu.place == Place::Cloud {
            icon.color(t.brand_blue)
        } else {
            icon
        };
        let mut button = Button::new("project-place")
            .variant(ButtonVariant::Titlebar)
            .icon(icon)
            .label(text)
            .accessibility_label(accessible)
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .font_weight(FontWeight::MEDIUM);
        if menu.link.is_some() {
            let color = if link_has_problem(menu.link.as_ref()) {
                t.warning
            } else {
                t.brand_blue
            };
            button = button.trailing(
                Icon::product(ProductIcon::Cloud)
                    .with_size(px(13.))
                    .stroke(1.9)
                    .color(color),
            );
        }
        button
    }
    /// `ProjectPlaceRows`: where the project is, as a fact; then who can
    /// open a local project, in the Homepage's three audiences; a Cloud
    /// project offers the folder linked to it; History follows.
    pub(super) fn place_rows(
        &self,
        menu: PlaceMenu,
        items: &[Item],
        cx: &App,
    ) -> impl FnOnce(crate::ui::components::Menu) -> crate::ui::components::Menu + 'static {
        let t = cx.palette();
        let host = self.weak.clone();
        let history = self.hosted().is_some() && crate::features::cloud::account::has_account(cx);
        let label = match (&menu.place, &menu.address) {
            (Place::Computer, Some(address)) => address.full.clone(),
            _ => place_label(menu.place).to_owned(),
        };
        let mut current = MenuItem::new(label)
            .icon_sized({
                let icon = place_icon(menu.place).with_size(px(15.)).stroke(1.75);
                if menu.place == Place::Cloud {
                    icon.color(t.brand_blue)
                } else {
                    icon
                }
            })
            .selected(true)
            .fact(true);
        if let Some(detail) = &menu.detail {
            current = current.detail_below(detail.clone());
        } else if let Some(address) = &menu.address {
            current = current.detail_below(address.full.clone());
        }
        let audience = self.local_audience(&menu, items, cx);
        let action = menu.action.clone().map(|action| {
            let Action::OpenLocalFolder { name, .. } = &action;
            let host = host.clone();
            let name = name.clone();
            MenuItem::new(tr(if cfg!(target_os = "macos") {
                "cloud.placeMenu.openFolder.mac"
            } else {
                "cloud.placeMenu.openFolder.computer"
            }))
            .icon_sized(
                Icon::product(ProductIcon::Local)
                    .with_size(px(15.))
                    .stroke(1.75),
            )
            .detail_below(crate::localization::bidi_isolate(&name))
            .on_click(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.run_place_action(action.clone(), w, cx));
            })
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
        let run = {
            let host = host.clone();
            move |action: super::audience::AudienceAction, w: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.run_audience_action(action, w, cx));
            }
        };
        move |surface| {
            let mut surface = surface.item(current);
            if let Some(audience) = audience {
                surface = super::audience::rows(surface.separator(), &audience, run, t);
            }
            if let Some(action) = action {
                surface = surface.separator().item(action);
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
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.show_popover(None, cx);
        match action {
            Action::OpenLocalFolder { path, .. } => cx.emit(CloudEvent::OpenProject(path)),
        }
        cx.notify();
    }
    /// What a row of "Who can open it" asks for.
    pub(super) fn run_audience_action(
        &mut self,
        action: super::audience::AudienceAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use super::audience::AudienceAction as A;
        self.show_popover(None, cx);
        match action {
            A::CopyToTeam { path, space } => self.request_publish(path, space, cx),
            A::OpenCloud(project) => cx.emit(CloudEvent::OpenCloud(project)),
            A::SignIn => self.sign_in_for_cloud(window, cx),
            A::Retry => self.repository.update(cx, |r, cx| r.retry(cx)),
            A::Disconnect => self.open_disconnect(window, cx),
            A::Send => self.source_control.update(cx, |s, cx| s.push(cx)),
            A::TurnOnDevices { path } => self.request_device_sharing(path, window, cx),
            A::StopDevices { folder, path } => {
                self.device_settings(folder, &path, true, window, cx)
            }
            A::DeviceSettings { folder, path, .. } => {
                self.device_settings(folder, &path, false, window, cx)
            }
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
        // The page's own choice of organization, unless a run already
        // carries its space.
        if self.publish.read(cx).header_status().is_none() {
            self.publish.update(cx, |p, cx| p.set_target(None, cx));
        }
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
        // What a confirmed publication to a chosen space includes and who
        // sees it (`CloudGitPrerequisite` details).
        let publish = self.publish.read(cx);
        let destination = publish.destination().flatten().map(|org| {
            tf(
                "cloud.initialize.destinationNote",
                &[("name", crate::localization::bidi_isolate(&org.name).into())],
            )
        });
        let details: Vec<String> = destination
            .into_iter()
            .chain([
                tr(if publish.has_head {
                    "cloud.initialize.committedScopeNote"
                } else {
                    "cloud.initialize.initialScopeNote"
                })
                .to_owned(),
                tr("cloud.initialize.spaceVisibilityNote").to_owned(),
            ])
            .collect();
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
            .children(details.into_iter().map(|detail| {
                div()
                    .pt(px(8.))
                    .text_size(px(theme::ty().ui.body))
                    .line_height(relative(1.5))
                    .text_color(t.muted)
                    .child(detail)
            }))
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
    fn a_cloud_project_offers_its_folder_and_a_folder_states_its_link() {
        let cloud = resolve(
            Place::Cloud,
            cloud_address(Some("Design")),
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
        assert_eq!(cloud.address.unwrap().short, "Design");
        assert_eq!(resolve(Place::Cloud, None, None, false, None).action, None);
        let local = resolve(Place::Local, None, Some(Notice::Missing), true, None);
        assert_eq!(local.action, None);
        assert!(link_has_problem(local.link.as_ref()));
        assert!(!link_has_problem(Some(&(Notice::SignIn, false))));
    }

    #[test]
    fn a_local_address_is_the_folder_that_holds_it_shortened() {
        let home = std::env::var("HOME").unwrap_or_default();
        if home.starts_with("/Users/") {
            let address =
                local_address(&std::path::Path::new(&home).join("Documents/Clients/Acme")).unwrap();
            assert_eq!(address.short, "~/Documents/Clients");
            assert_eq!(address.full, "~/Documents/Clients/Acme");
        }
        assert_eq!(compact_display_path("~/a/b/c/d", 2), "~/…/c/d");
        assert_eq!(compact_display_path("~/a/b", 2), "~/a/b");
        assert_eq!(compact_display_path("/x/y/z/w", 2), "/…/z/w");
        assert_eq!(
            local_address(std::path::Path::new("/x")).unwrap().short,
            "/"
        );
        assert!(cloud_address(Some("  ")).is_none());
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
