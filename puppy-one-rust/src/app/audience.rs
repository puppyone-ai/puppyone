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
