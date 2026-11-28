//! `components/project-audience`: who can open a project, in the
//! Homepage's three audiences — this computer, all my devices, and a team.
//! The Cloud is not a fourth audience but one way to reach one: a folder is
//! opened to my other computers directly, and reaches a team only as a copy
//! in the Cloud, which is its own project (puppy-issues ADR-001) and gets
//! this folder's changes only when they are sent.
//!
//! The Homepage's project menu draws it ([`rows`]), the same shape the
//! place menu once read; v0.4.4's place menu only navigates. The rows only
//! name what to do ([`AudienceAction`]); their owner does it.
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
    TurnOnDevices { path: PathBuf },
    /// Keep this folder to this computer again.
    StopDevices { folder: String, path: PathBuf },
    /// The folder's sharing settings on this computer.
    DeviceSettings {
        folder: String,
        name: String,
        path: PathBuf,
    },
    /// Copy this folder to a team's Cloud space (the first publication).
    CopyToTeam { path: PathBuf, space: String },
    /// Open the Cloud copy.
    OpenCloud(String),
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
/// One destination Space offered under `Move to ▸`.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) struct SpaceTarget {
    pub id: String,
    pub name: String,
    pub tone: usize,
    pub action: AudienceAction,
}
/// `ProjectAudience`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::app) struct ProjectAudience {
    /// Writable Cloud Spaces this folder can move to (`Move to ▸`).
    pub spaces: Vec<SpaceTarget>,
    /// Absent where opening folders to my other computers is not available.
    pub devices: Option<Devices>,
    /// A copy of this folder in my own Cloud space.
    pub devices_copy: Option<CloudCopy>,
    /// Absent where no team can take a project.
    pub team: Option<Team>,
}
impl ProjectAudience {
    /// `reachesOnlyThisComputer`.
    #[cfg(test)]
    pub fn only_this_computer(&self) -> bool {
        !self.devices.as_ref().is_some_and(|d| d.on)
            && self.devices_copy.is_none()
            && !self.team.as_ref().is_some_and(|t| t.copy.is_some())
    }
    /// `hasProjectAudience`: there is something to say beyond this computer.
    pub fn any(&self) -> bool {
        !self.spaces.is_empty()
            || self.devices.is_some()
            || self.devices_copy.is_some()
            || self.team.is_some()
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

/// Space-first actions in a project's `⋯` menu:
/// - `Move to ▸` submenu listing every writable Cloud Space (with its colour
///   dot) and, when enabled, My other computers.
/// - For a folder that already has a Cloud copy, a direct `Cloud copy · Open`
///   row (plus any unsent/problem status), without the legacy "Who can open
///   it" section.
pub(in crate::app) fn rows(
    menu: Menu,
    audience: &ProjectAudience,
    run: impl Fn(AudienceAction, &mut Window, &mut App) + Clone + 'static,
    t: crate::theme::Theme,
) -> Menu {
    let ty = crate::theme::ty();
    let action_word = move |word: String| {
        div()
            .flex()
            .items_center()
            .gap(px(3.))
            .text_size(px(ty.ui.meta))
            .child(word)
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

    let mut items: Vec<MenuItem> = Vec::new();
    let turn_on_devices = audience
        .devices
        .as_ref()
        .filter(|d| !d.on)
        .and_then(|d| d.turn_on.clone());

    if !audience.spaces.is_empty() || turn_on_devices.is_some() {
        let spaces = audience.spaces.clone();
        let turn_on = turn_on_devices.clone();
        let run_sub = run.clone();
        let dark = t.dark;
        items.push(
            MenuItem::new(tr("home.project.moveTo"))
                .id("project-move-to")
                .icon("folder-input")
                .submenu(move |_, _| {
                    let mut sub = Menu::new("project-move-to-menu")
                        .variant(crate::ui::components::MenuVariant::SidebarAction)
                        .min_w(px(176.));
                    let space_items: Vec<MenuItem> = spaces
                        .iter()
                        .map(|space| {
                            let run = run_sub.clone();
                            let action = space.action.clone();
                            let dot = div()
                                .flex_none()
                                .size(px(7.))
                                .rounded_full()
                                .bg(crate::theme::space_dot(space.tone, dark))
                                .into_any_element();
                            MenuItem::new(space.name.clone())
                                .id(SharedString::from(format!("move-to-space:{}", space.id)))
                                .icon_element(dot)
                                .on_click(move |w, cx| run(action.clone(), w, cx))
                        })
                        .collect();
                    let has_spaces = !space_items.is_empty();
                    if has_spaces {
                        sub = sub.items(space_items);
                    }
                    if let Some(action) = turn_on.clone() {
                        if has_spaces {
                            sub = sub.separator();
                        }
                        let run = run_sub.clone();
                        sub = sub.item(
                            MenuItem::new(tr("shell.projectAudience.devices"))
                                .id("move-to-devices")
                                .icon_element(
                                    Icon::product(ProductIcon::Local)
                                        .with_size(px(14.))
                                        .stroke(1.75)
                                        .into_any_element(),
                                )
                                .on_click(move |w, cx| run(action.clone(), w, cx)),
                        );
                    }
                    sub
                }),
        );
    }

    if let Some(devices) = audience.devices.as_ref().filter(|d| d.on) {
        let action = devices.settings.clone().or_else(|| devices.stop.clone());
        let trailing = if devices.settings.is_some() {
            Some(
                Icon::new("settings")
                    .with_size(px(13.))
                    .stroke(1.85)
                    .into_any_element(),
            )
        } else {
            devices.stop.as_ref().map(|_| {
                action_word(tr("shell.projectAudience.stop").to_owned()).into_any_element()
            })
        };
        items.push(line(
            Icon::product(ProductIcon::Local),
            devices
                .detail
                .clone()
                .unwrap_or_else(|| tr("shell.projectAudience.devicesOn").to_owned()),
            action,
            trailing,
        ));
    }
    if let Some(copy) = &audience.devices_copy {
        items.extend(copy_lines(copy));
    }
    if let Some(copy) = audience.team.as_ref().and_then(|team| team.copy.as_ref()) {
        items.extend(copy_lines(copy));
    }
    if items.is_empty() {
        return menu;
    }
    menu.list(2., items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_folder_reaches_beyond_this_computer_only_through_devices_or_a_copy() {
        let mut audience = ProjectAudience {
            team: Some(Team {
                copy: None,
                on_copy: Some(AudienceAction::CopyToTeam {
                    path: "/x".into(),
                    space: "t".into(),
                }),
            }),
            ..Default::default()
        };
        assert!(audience.any());
        assert!(audience.only_this_computer());
        audience.team = Some(Team {
            copy: Some(CloudCopy {
                open: Some(AudienceAction::OpenCloud("p".into())),
                ..Default::default()
            }),
            on_copy: None,
        });
        assert!(!audience.only_this_computer());
        let devices = ProjectAudience {
            devices: Some(Devices {
                on: true,
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(!devices.only_this_computer());
    }

    /// `OtherComputersLabel`: the general words before any computer is
    /// known, then the one, then the first and how many others; paused
    /// sharing says so.
    #[test]
    fn the_other_computers_are_named_as_a_person_says_them() {
        crate::localization::set_current("en");
        let names = |list: &[&str]| list.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        assert_eq!(other_computers(&[], false), "Your other computers");
        assert_eq!(
            other_computers(&names(&["Studio Mac"]), false),
            "Studio Mac"
        );
        assert_eq!(
            other_computers(&names(&["Studio Mac", "Office PC"]), false),
            "Studio Mac and 1 other"
        );
        assert_eq!(
            other_computers(&names(&["Studio Mac", "Office PC", "Mini"]), true),
            "Studio Mac and 2 others · Paused"
        );
    }

    #[test]
    fn nothing_to_say_is_no_audience() {
        assert!(!ProjectAudience::default().any());
        let devices = ProjectAudience {
            devices: Some(Devices::default()),
            ..Default::default()
        };
        assert!(devices.any());
        assert!(devices.only_this_computer());
    }
}
