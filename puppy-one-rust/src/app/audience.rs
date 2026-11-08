//! `components/project-audience`: who can open a project, in the
//! Homepage's three audiences — this computer, all my devices, and a team.
//! The Cloud is not a fourth audience but one way to reach one: a folder is
//! opened to my other computers directly, and reaches a team only as a copy
//! in the Cloud, which is its own project (puppy-issues ADR-001) and gets
//! this folder's changes only when they are sent.
//!
//! The Header's place menu and the Homepage's project menu read the same
//! shape and draw the same rows ([`rows`]), so the two can never describe
//! one project differently. The rows only name what to do
//! ([`AudienceAction`]); their owner does it.
use crate::{
    localization::{t as tr, tf},
    ui::components::{Icon, Menu, MenuItem, ProductIcon},
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use std::path::PathBuf;

/// What a row asks its owner to do.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum AudienceAction {
    /// Open this folder to my other computers (after the owner's own
    /// confirmation).
    TurnOnDevices {
        path: PathBuf,
    },
    /// Keep this folder to this computer again.
    StopDevices {
        folder: String,
        path: PathBuf,
    },
    /// The folder's sharing settings on this computer.
    DeviceSettings {
        folder: String,
        name: String,
        path: PathBuf,
    },
    /// Copy this folder to a team's Cloud space (the first publication).
    CopyToTeam {
        path: PathBuf,
        space: String,
    },
    /// Open the Cloud copy.
    OpenCloud(String),
    SignIn,
    /// Check the copy's link again.
    Retry,
    /// End a link that cannot be used from here.
    Disconnect,
    /// Send the commits the copy has not had.
    Send,
}

/// `DevicesAudience`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::app) struct Devices {
    /// This folder itself is open to my other computers.
    pub on: bool,
    /// Who can open it once it is on (`OtherComputersLabel`).
    pub detail: Option<String>,
    pub turn_on: Option<AudienceAction>,
    pub stop: Option<AudienceAction>,
    pub settings: Option<AudienceAction>,
}
/// `CloudCopy`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::app) struct CloudCopy {
    pub open: Option<AudienceAction>,
    /// Why the copy cannot be used as it is, and what helps.
    pub problem: Option<String>,
    pub resolve: Option<(String, AudienceAction)>,
    /// Commits here that the copy has not had yet.
    pub unsent: u32,
    pub send: Option<AudienceAction>,
}
/// `TeamAudience`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::app) struct Team {
    pub copy: Option<CloudCopy>,
    /// Copies this folder to a team's Cloud space; absent where it cannot be
    /// offered.
    pub on_copy: Option<AudienceAction>,
}
/// `ProjectAudience`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::app) struct ProjectAudience {
    /// Absent where opening folders to my other computers is not available.
    pub devices: Option<Devices>,
    /// A copy of this folder in my own Cloud space.
    pub devices_copy: Option<CloudCopy>,
    /// Absent where no team can take a project.
    pub team: Option<Team>,
}
impl ProjectAudience {
    /// `reachesOnlyThisComputer`.
    pub fn only_this_computer(&self) -> bool {
        !self.devices.as_ref().is_some_and(|d| d.on)
            && self.devices_copy.is_none()
            && !self.team.as_ref().is_some_and(|t| t.copy.is_some())
    }
    /// `hasProjectAudience`: there is something to say beyond this computer.
    pub fn any(&self) -> bool {
        self.devices.is_some() || self.devices_copy.is_some() || self.team.is_some()
    }
}

/// `OtherComputersLabel`: "Studio Mac and 2 others", or the general words
/// before any is known; paused sharing says so.
pub(in crate::app) fn other_computers(names: &[String], paused: bool) -> String {
    let text = match names {
        [] => tr("shell.projectAudience.devicesOn").to_owned(),
        [one] => one.clone(),
        [first, rest @ ..] => tf(
            "shell.projectAudience.otherComputers",
            &[
                ("name", first.clone().into()),
                ("count", (rest.len() as i64).into()),
            ],
        ),
    };
    if paused {
        format!("{text} · {}", tr("hosts.sharing.paused"))
    } else {
        text
    }
}

/// The audience's state for one link of a local folder to its Cloud copy
/// (`useLocalProjectAudience`): sign in, retry, a problem with Disconnect,
/// or the copy to open and send to.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum Link {
    Linked { project: String, openable: bool },
    SignIn,
    Unreachable,
    OtherEnvironment(Option<String>),
    Missing,
    NoAccess,
    Ambiguous,
}
/// What a link says as the copy's rows. `disconnectable`: this app can end
/// the link by itself.
pub(in crate::app) fn cloud_copy(link: &Link, disconnectable: bool, unsent: u32) -> CloudCopy {
    let disconnect = || {
        disconnectable.then(|| {
            (
                tr("shell.projectAudience.disconnect").to_owned(),
                AudienceAction::Disconnect,
            )
        })
    };
    match link {
        Link::Linked { project, openable } => CloudCopy {
            open: openable.then(|| AudienceAction::OpenCloud(project.clone())),
            unsent,
            send: (unsent > 0).then_some(AudienceAction::Send),
            ..Default::default()
        },
        Link::SignIn => CloudCopy {
            problem: Some(tr("cloud.placeMenu.link.signIn").to_owned()),
            resolve: Some((tr("cloud.auth.signIn").to_owned(), AudienceAction::SignIn)),
            ..Default::default()
        },
        Link::Unreachable => CloudCopy {
            problem: Some(tr("cloud.placeMenu.link.unreachable").to_owned()),
            resolve: Some((tr("common.action.retry").to_owned(), AudienceAction::Retry)),
            ..Default::default()
        },
        Link::OtherEnvironment(origin) => CloudCopy {
            problem: Some(match origin {
                Some(origin) => tf(
                    "cloud.placeMenu.link.otherEnvironment",
                    &[("origin", host_of(origin).into())],
                ),
                None => tr("cloud.placeMenu.link.otherEnvironmentUnknown").to_owned(),
            }),
            resolve: disconnect(),
            ..Default::default()
        },
        Link::Missing => CloudCopy {
            problem: Some(tr("cloud.placeMenu.link.missing").to_owned()),
            resolve: disconnect(),
            ..Default::default()
        },
        Link::NoAccess => CloudCopy {
            problem: Some(tr("cloud.placeMenu.link.noAccess").to_owned()),
            resolve: disconnect(),
            ..Default::default()
        },
        Link::Ambiguous => CloudCopy {
            problem: Some(tr("cloud.placeMenu.link.ambiguous").to_owned()),
            ..Default::default()
        },
    }
}
/// `http://localhost:9090` reads as `localhost:9090`.
fn host_of(origin: &str) -> String {
    url::Url::parse(origin)
        .ok()
        .and_then(|u| {
            let host = u.host_str()?.to_owned();
            Some(match u.port() {
                Some(port) => format!("{host}:{port}"),
                None => host,
            })
        })
        .unwrap_or_else(|| origin.to_owned())
}

/// `useLocalProjectAudience`: who can open a local folder, from its devices,
/// its link and the teams this account can add projects to.
#[allow(clippy::too_many_arguments)]
pub(in crate::app) fn local(
    cloud_enabled: bool,
    devices: Option<Devices>,
    link: Option<(Link, bool)>,
    unhosted: bool,
    publish_pending: bool,
    linked_space_personal: bool,
    copy_team: Option<(PathBuf, String)>,
    unsent: u32,
) -> Option<ProjectAudience> {
    let copy = link
        .filter(|_| cloud_enabled)
        .map(|(link, disconnectable)| cloud_copy(&link, disconnectable, unsent));
    let personal = copy.is_some() && linked_space_personal;
    let copyable = cloud_enabled && (publish_pending || (unhosted && copy_team.is_some()));
    let team = (copyable || (copy.is_some() && !personal)).then(|| Team {
        copy: if personal { None } else { copy.clone() },
        on_copy: copy_team
            .filter(|_| copyable)
            .map(|(path, space)| AudienceAction::CopyToTeam { path, space }),
    });
    if devices.is_none() && team.is_none() && !personal {
        return None;
    }
    Some(ProjectAudience {
        devices,
        devices_copy: if personal { copy } else { None },
        team,
    })
}

/// `ProjectAudienceRows`: the quiet label, then three rows with a tick and
/// the lines a Cloud copy or my devices hang under their row. A row's action
/// is the word at its end and the row itself is the control.
pub(in crate::app) fn rows(
    menu: Menu,
    audience: &ProjectAudience,
    run: impl Fn(AudienceAction, &mut Window, &mut App) + Clone + 'static,
    t: crate::theme::Theme,
) -> Menu {
    let ty = crate::theme::ty();
    let title = div()
        .flex_shrink_0()
        .px(px(crate::theme::metric::MENU_ITEM_PADDING_INLINE))
        .pt(px(4.))
        .pb(px(2.))
        .text_color(t.subtle)
        .text_size(px(ty.ui.meta))
        .line_height(px(15.))
        .font_weight(FontWeight::MEDIUM)
        .child(tr("shell.projectAudience.title"));
    let action_word = move |word: String| {
        div()
            .flex()
            .items_center()
            .gap(px(3.))
            .text_size(px(ty.ui.meta))
            .child(word)
    };
    let tier = |label: &str, checked: bool, action: Option<(String, AudienceAction)>| {
        let mut row = MenuItem::new(label.to_owned())
            .icon_element(if checked {
                Icon::new("check").small().stroke(1.85).into_any_element()
            } else {
                div().size(px(14.)).into_any_element()
            })
            .color(if checked { t.text } else { t.muted });
        match action {
            Some((word, action)) => {
                let run = run.clone();
                row = row
                    .trailing(action_word(word))
                    .on_click(move |w, cx| run(action.clone(), w, cx));
            }
            None => row = row.fact(true),
        }
        row
    };
    let line = |icon: Icon,
                label: String,
                action: Option<AudienceAction>,
                trailing: Option<AnyElement>| {
        let mut row = MenuItem::new(label)
            .line()
            .icon_sized(icon.with_size(px(13.)).stroke(1.85));
        if let Some(trailing) = trailing {
            row = row.trailing(trailing);
        }
        if let Some(action) = action {
            let run = run.clone();
            row = row.on_click(move |w, cx| run(action.clone(), w, cx));
        }
        row
    };
    let copy_lines = |copy: &CloudCopy| {
        let mut rows = vec![line(
            Icon::product(ProductIcon::Cloud),
            tr("shell.projectAudience.cloudCopy").to_owned(),
            copy.open.clone(),
            copy.open.as_ref().map(|_| {
                action_word(tr("shell.projectAudience.open").to_owned())
                    .child(Icon::new("arrow-up-right").with_size(px(12.)).stroke(1.85))
                    .into_any_element()
            }),
        )];
        if let Some(problem) = &copy.problem {
            rows.push(
                line(
                    Icon::new("triangle-alert"),
                    problem.clone(),
                    copy.resolve.as_ref().map(|(_, a)| a.clone()),
                    copy.resolve
                        .as_ref()
                        .map(|(word, _)| action_word(word.clone()).into_any_element()),
                )
                .color(t.warning),
            );
        } else if copy.unsent > 0 {
            rows.push(line(
                Icon::new("arrow-up"),
                tf(
                    "shell.projectAudience.unsent",
                    &[("count", (copy.unsent as i64).into())],
                ),
                copy.send.clone(),
                copy.send.as_ref().map(|_| {
                    action_word(tr("shell.projectAudience.send").to_owned()).into_any_element()
                }),
            ));
        }
        rows
    };
    let mut items = vec![tier(
        tr("shell.projectAudience.onlyThisComputer"),
        audience.only_this_computer(),
        None,
    )];
    if audience.devices.is_some() || audience.devices_copy.is_some() {
        let devices = audience.devices.clone().unwrap_or_default();
        let checked = devices.on || audience.devices_copy.is_some();
        let action = if devices.on {
            devices
                .stop
                .clone()
                .map(|a| (tr("shell.projectAudience.stop").to_owned(), a))
        } else {
            devices
                .turn_on
                .clone()
                .map(|a| (tr("shell.projectAudience.turnOn").to_owned(), a))
        };
        items.push(tier(tr("shell.projectAudience.devices"), checked, action));
        if devices.on {
            items.push(line(
                Icon::product(ProductIcon::Local),
                devices
                    .detail
                    .clone()
                    .unwrap_or_else(|| tr("shell.projectAudience.devicesOn").to_owned()),
                devices.settings.clone(),
                devices.settings.as_ref().map(|_| {
                    Icon::new("settings")
                        .with_size(px(13.))
                        .stroke(1.85)
                        .into_any_element()
                }),
            ));
        }
        if let Some(copy) = &audience.devices_copy {
            items.extend(copy_lines(copy));
        }
    }
    if let Some(team) = &audience.team {
        let action = team
            .copy
            .is_none()
            .then(|| team.on_copy.clone())
            .flatten()
            .map(|a| (tr("shell.projectAudience.copy").to_owned(), a));
        items.push(tier(
            tr("shell.projectAudience.team"),
            team.copy.is_some(),
            action,
        ));
        if let Some(copy) = &team.copy {
            items.extend(copy_lines(copy));
        }
    }
    menu.child_element(title).list(2., items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn team(path: &str) -> Option<(PathBuf, String)> {
        Some((PathBuf::from(path), "t".into()))
    }

    #[test]
    fn an_unlinked_folder_can_be_copied_to_a_team_and_reaches_only_this_computer() {
        let audience = local(true, None, None, true, false, false, team("/x"), 0).unwrap();
        assert!(audience.only_this_computer());
        assert_eq!(
            audience.team.unwrap().on_copy,
            Some(AudienceAction::CopyToTeam {
                path: "/x".into(),
                space: "t".into()
            })
        );
    }

    #[test]
    fn a_linked_copy_hangs_under_the_audience_whose_space_holds_it() {
        let link = Link::Linked {
            project: "p".into(),
            openable: true,
        };
        // A team's copy: under Team, with Open and Send.
        let audience = local(
            true,
            None,
            Some((link.clone(), true)),
            false,
            false,
            false,
            None,
            2,
        )
        .unwrap();
        let copy = audience.team.as_ref().unwrap().copy.clone().unwrap();
        assert_eq!(copy.open, Some(AudienceAction::OpenCloud("p".into())));
        assert_eq!(copy.send, Some(AudienceAction::Send));
        assert!(audience.devices_copy.is_none());
        assert!(!audience.only_this_computer());
        // My own space's copy: under all my devices.
        let audience = local(true, None, Some((link, true)), false, false, true, None, 0).unwrap();
        assert!(audience.team.is_none());
        assert!(audience.devices_copy.unwrap().send.is_none());
    }

    #[test]
    fn a_broken_link_offers_its_remedy_and_disconnect_only_when_possible() {
        let missing = cloud_copy(&Link::Missing, true, 0);
        assert_eq!(missing.resolve.unwrap().1, AudienceAction::Disconnect);
        assert!(cloud_copy(&Link::Missing, false, 0).resolve.is_none());
        assert_eq!(
            cloud_copy(&Link::SignIn, false, 0).resolve.unwrap().1,
            AudienceAction::SignIn
        );
        assert!(cloud_copy(&Link::Ambiguous, true, 0).resolve.is_none());
        assert_eq!(host_of("http://localhost:9090"), "localhost:9090");
    }

    #[test]
    fn nothing_to_say_is_no_audience() {
        assert!(local(false, None, None, true, false, false, team("/x"), 0).is_none());
        assert!(local(true, None, None, false, false, false, None, 0).is_none());
        let devices = Devices::default();
        assert!(
            local(false, Some(devices), None, true, false, false, None, 0)
                .unwrap()
                .any()
        );
    }
}
