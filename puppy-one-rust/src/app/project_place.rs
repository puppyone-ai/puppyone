//! Where the open project is (`project-place/projectPlaceMenuState.ts`,
//! `ProjectPlaceMenu.tsx`) and what a local folder's Cloud project means
//! (`localFolderCloudNoticeState.ts`, `LocalFolderCloudNotice.tsx`).
//!
//! The Header reads like a path from the place to the folder: the space that
//! holds a Cloud folder, this computer, or another computer. A small cloud
//! after this computer says the folder has a copy in the Cloud. The place's
//! menu is the window's way elsewhere and nothing more (`navigation`): back
//! to Home, to another place, and to the account; who can open a folder is
//! set on the Homepage. A local folder and its Cloud project are two
//! projects (puppy-issues ADR-001). A folder's link that cannot be used from
//! here can be ended from its notice (`CloudLinkDisconnectDialog`).
use super::window_cloud::{CloudEvent, WindowCloud};
use super::*;
use crate::workspace::cloud::catalog::Item;
use crate::{
    localization::{t as tr, tf},
    ui::components::{
        Button, ButtonVariant, Dialog, FloatingNotice, Icon, NoticeAction, NoticeTone, ProductIcon,
    },
    workspace::cloud::repository::Context as Association,
};
use gpui_kit::{
    base::{Disableable as _, h_flex},
    component::Sizable as _,
};

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
    /// Another of the owner's computers (`place: "computer"`).
    Computer,
}
/// `ProjectPlaceAddress`: where exactly the open project is: a local
/// project's folder from the home folder, or the organization that holds a
/// Cloud project.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Address {
    pub short: String,
    pub full: String,
}
/// `ProjectPlaceMenu`.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PlaceMenu {
    pub place: Place,
    /// A named computer, rather than this computer or a Cloud organization.
    pub label: Option<String>,
    /// Access to a folder on another computer, spoken with its name.
    pub detail: Option<String>,
    /// Absent while it is unknown; the Header then names the kind of place.
    pub address: Option<Address>,
    /// The space that holds a Cloud project, once the account's catalog
    /// names it; the Header then names the space.
    pub space: Option<crate::workspace::cloud::spaces::Space>,
    /// The open local folder's Cloud link: what it means, and whether this
    /// app can end it.
    pub link: Option<(Notice, bool)>,
}
/// `resolveProjectPlaceMenu`: without Cloud, a local folder's place alone.
pub(super) fn resolve(
    place: Place,
    address: Option<Address>,
    space: Option<crate::workspace::cloud::spaces::Space>,
    cloud_enabled: bool,
    notice: Option<Notice>,
    disconnectable: bool,
) -> PlaceMenu {
    let menu = PlaceMenu {
        place: Place::Local,
        label: None,
        detail: None,
        address,
        space: None,
        link: None,
    };
    if !cloud_enabled {
        return menu;
    }
    match place {
        Place::Cloud => PlaceMenu {
            place,
            space,
            ..menu
        },
        _ => PlaceMenu {
            place,
            link: notice.map(|n| (n, disconnectable)),
            ..menu
        },
    }
}
/// `cloudLinkProblemMessage`: what keeps a Cloud link from opening, said
/// in the place button's name; `None` when it opens.
pub(super) fn link_problem(notice: &Notice) -> Option<String> {
    Some(match notice {
        Notice::Linked { .. } => return None,
        Notice::SignIn => tr("cloud.placeMenu.link.signIn").to_owned(),
        Notice::Unreachable { .. } => tr("cloud.placeMenu.link.unreachable").to_owned(),
        Notice::OtherEnvironment {
            origin: Some(origin),
        } => tf(
            "cloud.placeMenu.link.otherEnvironment",
            &[(
                "origin",
                url::Url::parse(origin)
                    .ok()
                    .and_then(|u| {
                        u.host_str()
                            .map(|h| u.port().map_or(h.to_owned(), |p| format!("{h}:{p}")))
                    })
                    .unwrap_or_else(|| origin.clone())
                    .into(),
            )],
        ),
        Notice::OtherEnvironment { origin: None } => {
            tr("cloud.placeMenu.link.otherEnvironmentUnknown").to_owned()
        }
        Notice::Missing => tr("cloud.placeMenu.link.missing").to_owned(),
        Notice::NoAccess => tr("cloud.placeMenu.link.noAccess").to_owned(),
        Notice::Ambiguous => tr("cloud.placeMenu.link.ambiguous").to_owned(),
    })
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
/// `useProjectPlaceName`: the place as the Header names it, and as it is
/// spoken: a space and the account's role in it, a named computer and its
/// access, the organization that holds a Cloud folder until its space is
/// known, or this computer and the folder's path.
pub(super) fn place_name(menu: &PlaceMenu) -> (String, Vec<String>) {
    if let Some(space) = &menu.space {
        let name = crate::features::cloud::space_name(space);
        let role = space
            .role
            .as_deref()
            .filter(|r| matches!(*r, "owner" | "member" | "viewer"))
            .map(|r| tr(&format!("settings.space.role.{r}")).to_owned());
        let spoken = std::iter::once(name.clone()).chain(role).collect();
        return (name, spoken);
    }
    match menu.place {
        Place::Computer => {
            let name = menu
                .label
                .clone()
                .or_else(|| menu.address.as_ref().map(|a| a.short.clone()))
                .unwrap_or_default();
            let spoken = std::iter::once(name.clone())
                .chain(menu.detail.clone())
                .collect();
            (name, spoken)
        }
        Place::Cloud => {
            let kind = tr("cloud.home.location.cloud").to_owned();
            match &menu.address {
                Some(address) => (address.short.clone(), vec![kind, address.full.clone()]),
                None => (kind.clone(), vec![kind]),
            }
        }
        Place::Local => {
            let name = tr(if cfg!(target_os = "macos") {
                "shell.workspaceSwitcher.location.thisMac"
            } else {
                "shell.workspaceSwitcher.location.thisComputer"
            })
            .to_owned();
            let spoken = std::iter::once(name.clone())
                .chain(menu.address.as_ref().map(|a| a.full.clone()))
                .collect();
            (name, spoken)
        }
    }
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
    /// The Header place menu's state (`placeMenu`): another computer's
    /// folder, the space that holds a Cloud project, or this computer with
    /// its folder's Cloud link. `items` is the shared project list, where a
    /// hosted Project finds its space.
    pub(super) fn place_menu(&self, items: &[Item], cx: &App) -> Option<PlaceMenu> {
        // `DeviceFolderHeader`: the computer it lives on, and what that
        // computer allows.
        if let Some(remote) = &self.session().device {
            let host = remote.host.clone();
            return Some(PlaceMenu {
                place: Place::Computer,
                label: Some(host.clone()),
                detail: Some(
                    tr(if remote.writable {
                        "hosts.catalog.editable"
                    } else {
                        "hosts.catalog.readOnly"
                    })
                    .to_owned(),
                ),
                address: Some(Address {
                    short: host.clone(),
                    full: host,
                }),
                space: None,
                link: None,
            });
        }
        let cloud = crate::features::flags::cloud_enabled(&self.preferences, cx);
        let hosted = self.hosted();
        let spaces = crate::features::cloud::global_spaces_read(cx)
            .filter(|_| cloud)
            .map(|s| s.spaces().to_vec())
            .unwrap_or_default();
        let (place, address, space) = match &hosted {
            Some(project) => {
                let space = crate::workspace::cloud::spaces::project_space(
                    &spaces,
                    Some(project.as_str()),
                    items,
                )
                .cloned();
                let org = space.as_ref().map(|s| s.name.clone());
                (Place::Cloud, cloud_address(org.as_deref()), space)
            }
            None => (
                Place::Local,
                self.root().and_then(|root| local_address(&root)),
                None,
            ),
        };
        Some(resolve(
            place,
            address,
            space,
            cloud,
            self.local_folder_notice(cx),
            self.disconnectable(cx),
        ))
    }
    /// `.desktop-titlebar-place-button`: the place's mark (a space's square,
    /// the Cloud while its space is unknown, else a computer), its name, at
    /// most 160px with an ellipsis, and a small cloud after this computer
    /// when the folder has a copy in the Cloud: blue while the link works,
    /// the warning tone when it cannot be used from here. Its name says the
    /// place, the role or path, the link, then what the menu is.
    pub(super) fn place_button(&self, menu: &PlaceMenu, cx: &App) -> Button {
        let t = cx.palette();
        let ty = theme::ty().header;
        let (name, spoken) = place_name(menu);
        let link = menu.link.as_ref().map(|link| {
            link_problem(&link.0)
                .filter(|_| link_has_problem(Some(link)))
                .unwrap_or_else(|| tr("cloud.placeMenu.link.linked").to_owned())
        });
        let accessible = spoken
            .into_iter()
            .chain(link)
            .chain([tr("shell.placeMenu.label").to_owned()])
            .collect::<Vec<_>>()
            .join(", ");
        let mark: AnyElement = match (&menu.space, menu.place) {
            (Some(space), _) => crate::features::cloud::space_mark(space).into_any_element(),
            (None, Place::Cloud) => Icon::product(ProductIcon::Cloud)
                .with_size(px(16.))
                .stroke(1.75)
                .color(t.brand_blue)
                .into_any_element(),
            (None, _) => Icon::product(ProductIcon::Local)
                .with_size(px(16.))
                .stroke(1.75)
                .into_any_element(),
        };
        let mut button = Button::new("project-place")
            .variant(ButtonVariant::Titlebar)
            .accessibility_label(accessible)
            .px(px(6.))
            .min_w_0()
            .flex_shrink(4.)
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .font_weight(FontWeight::MEDIUM)
            .trailing(
                h_flex()
                    .min_w_0()
                    .gap(px(6.))
                    .child(mark)
                    .child(div().min_w_0().max_w(px(160.)).truncate().child(name)),
            );
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

    /// `resolveProjectPlaceMenu` and `useProjectPlaceName` (v0.4.4): a Cloud
    /// project names the space that holds it once it is known, a folder
    /// states its link, and without Cloud a folder's place stands alone.
    #[test]
    fn the_place_names_a_space_or_this_computer_and_states_a_link() {
        crate::localization::set_current("en");
        let space = crate::workspace::cloud::spaces::Space {
            id: "s".into(),
            name: "Design".into(),
            role: Some("owner".into()),
            can_create_projects: true,
            ..Default::default()
        };
        let cloud = resolve(
            Place::Cloud,
            cloud_address(Some("Design")),
            Some(space),
            true,
            None,
            false,
        );
        assert_eq!(
            place_name(&cloud),
            (
                "Design".to_owned(),
                vec!["Design".to_owned(), "Owner".to_owned()]
            )
        );
        let unknown = resolve(Place::Cloud, None, None, true, None, false);
        assert_eq!(place_name(&unknown).0, "Cloud project");
        let local = resolve(Place::Local, None, None, true, Some(Notice::Missing), true);
        assert!(link_has_problem(local.link.as_ref()));
        assert!(!link_has_problem(Some(&(Notice::SignIn, false))));
        assert_eq!(
            link_problem(&Notice::OtherEnvironment {
                origin: Some("http://localhost:9090".into())
            })
            .as_deref(),
            Some("In another environment: localhost:9090")
        );
        let off = resolve(Place::Local, None, None, false, Some(Notice::Missing), true);
        assert_eq!((off.place, &off.link), (Place::Local, &None));
        assert!(place_name(&off).0.starts_with("This "));
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
