//! `useCloudProjectGroups`, `onboardingBaseGroups` and the audience half of
//! `HomepageComputers`: the Homepage's projects by who can open them, not
//! by where they are stored. Team Share Project, then My Share Project,
//! then (while ownership is unknown) Shared projects, then On this
//! computer. A team's name is a selector inside its group, never another
//! heading. Known sharing survives offline, paused or unreadable states;
//! empty destinations appear only during an explicit drag.
use crate::localization::t as tr;
use crate::workspace::cloud::{
    catalog::Item,
    spaces::{Kind, Space},
};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(in crate::app) enum GroupId {
    TeamShared,
    PersonalShared,
    SharedUnresolved,
    LocalOnly,
}
impl GroupId {
    /// `data-project-group`.
    pub fn key(self) -> &'static str {
        match self {
            Self::TeamShared => "team-shared",
            Self::PersonalShared => "personal-shared",
            Self::SharedUnresolved => "shared-unresolved",
            Self::LocalOnly => "local-only",
        }
    }
    /// `audienceOrder`.
    fn order(self) -> u8 {
        match self {
            Self::TeamShared => 0,
            Self::PersonalShared => 1,
            Self::SharedUnresolved => 2,
            Self::LocalOnly => 3,
        }
    }
    /// The shared groups mark where each project lives; the local group
    /// needs no mark.
    pub fn marks_places(self) -> bool {
        self != Self::LocalOnly
    }
}

/// What letting go of a dragged folder over a group does.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum DropAction {
    /// Copy it to this team's Cloud space (the confirmed first publication).
    Publish { space: String },
    /// Open it to my other computers (the confirmed Host sharing).
    ShareDevices,
}
/// `dropTarget`: present only for a trusted in-page drag.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) struct DropTarget {
    pub enabled: bool,
    /// What letting go here does, said at the end of the heading.
    pub hint: String,
    pub action: DropAction,
}
/// `OnboardingProjectGroup`.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) struct Group {
    pub id: GroupId,
    pub title: String,
    pub items: Vec<Item>,
    /// The line an empty destination shows in place of projects.
    pub empty_text: Option<String>,
    /// Empty destinations appear only during an explicit publication gesture.
    pub empty: bool,
    pub keep_empty: bool,
    pub drop: Option<DropTarget>,
    /// Several teams: which one the group shows (`id`, name), and the chosen.
    pub teams: Option<(Vec<(String, String)>, String)>,
}

/// What the groups are made from.
pub(in crate::app) struct Inputs<'a> {
    pub spaces: &'a [Space],
    /// The visible projects, in the order the page shows them.
    pub items: Vec<Item>,
    /// The local folder being dragged in the page, by its absolute path.
    pub dragging_path: Option<&'a str>,
    pub busy: bool,
    /// Publishing to a space is offered (signed in, Cloud on).
    pub can_publish: bool,
    /// The team chosen in the selector, if any.
    pub chosen_team: Option<&'a str>,
    /// This computer's shared folder ids, when its sharing state is known;
    /// `None` keeps every recorded offer (a failed or absent read).
    pub shared_ids: Option<&'a HashSet<String>>,
    /// Opening a folder to my other computers is offered.
    pub local_share: bool,
}

/// The groups in page order, without the empty ones that do not stay.
pub(in crate::app) fn groups(inputs: Inputs) -> Vec<Group> {
    let (local, cloud): (Vec<Item>, Vec<Item>) = inputs
        .items
        .into_iter()
        .partition(|item| item.local_path.is_some());
    let dragging = inputs.dragging_path.map(str::trim);
    let mut groups = cloud_groups(
        inputs.spaces,
        &cloud,
        &local,
        dragging,
        inputs.busy,
        inputs.can_publish,
        inputs.chosen_team,
    );
    // `onboardingBaseGroups`: offered folders join the personal audience.
    let shared = |item: &Item| {
        item.host_folder
            .as_ref()
            .is_some_and(|id| inputs.shared_ids.is_none_or(|ids| ids.contains(id)))
    };
    let (offered, local_only): (Vec<Item>, Vec<Item>) =
        local.iter().cloned().partition(|item| shared(item));
    let personal_title = tr("onboarding.sharing.personal").to_owned();
    if !offered.is_empty() {
        match groups.iter_mut().find(|g| g.id == GroupId::PersonalShared) {
            Some(personal) => {
                if personal.empty {
                    personal.items.clear();
                }
                personal.items.extend(offered);
                personal.empty = false;
                personal.empty_text = None;
            }
            None => groups.insert(
                0,
                Group {
                    id: GroupId::PersonalShared,
                    title: personal_title.clone(),
                    items: offered,
                    empty_text: None,
                    empty: false,
                    keep_empty: false,
                    drop: None,
                    teams: None,
                },
            ),
        }
    }
    if !local_only.is_empty() {
        groups.push(Group {
            id: GroupId::LocalOnly,
            title: tr("onboarding.sharing.localOnly").to_owned(),
            items: local_only,
            empty_text: None,
            empty: false,
            keep_empty: false,
            drop: None,
            teams: None,
        });
    }
    // `HomepageComputers`' local share: the personal area is always there
    // to drop into, since dragging a folder in is how it is shared.
    if inputs.local_share {
        let source = dragging.filter(|path| {
            local.iter().any(|item| {
                item.local_path.as_deref().map(str::trim) == Some(*path) && !shared(item)
            })
        });
        let drop = dragging.map(|_| DropTarget {
            enabled: source.is_some() && !inputs.busy,
            hint: tr("onboarding.drop.personal").to_owned(),
            action: DropAction::ShareDevices,
        });
        match groups.iter_mut().find(|g| g.id == GroupId::PersonalShared) {
            Some(personal) => {
                personal.drop = drop;
                if personal.empty {
                    personal.empty = false;
                    personal.empty_text = Some(tr("onboarding.spaces.empty").to_owned());
                }
            }
            None => groups.push(Group {
                id: GroupId::PersonalShared,
                title: personal_title,
                items: vec![],
                empty_text: Some(tr("onboarding.spaces.empty").to_owned()),
                empty: false,
                keep_empty: false,
                drop,
                teams: None,
            }),
        }
    }
    let mut groups: Vec<Group> = groups
        .into_iter()
        .filter(|g| !g.empty || g.keep_empty)
        .collect();
    groups.sort_by_key(|g| g.id.order());
    groups
}

/// `useCloudProjectGroups`: space identity chooses the audience.
fn cloud_groups(
    spaces: &[Space],
    cloud: &[Item],
    local: &[Item],
    dragging: Option<&str>,
    busy: bool,
    can_publish: bool,
    chosen_team: Option<&str>,
) -> Vec<Group> {
    let source = dragging.filter(|path| {
        local.iter().any(|item| {
            item.local_path.as_deref().map(str::trim) == Some(*path) && item.linked.is_none()
        })
    });
    let personal = spaces.iter().find(|s| s.kind == Kind::Personal);
    let teams: Vec<&Space> = spaces.iter().filter(|s| s.kind == Kind::Team).collect();
    let held_by = |space: &Space| {
        cloud
            .iter()
            .any(|item| item.cloud_organization.as_deref() == Some(space.id.as_str()))
    };
    let team = chosen_team
        .and_then(|id| teams.iter().find(|s| s.id == id))
        .or_else(|| teams.iter().find(|s| held_by(s)))
        .or_else(|| teams.first())
        .copied();
    let destination = |space: &Space, id: GroupId, title: String| {
        let items: Vec<Item> = cloud
            .iter()
            .filter(|item| item.cloud_organization.as_deref() == Some(space.id.as_str()))
            .cloned()
            .collect();
        let writable = space.can_create_projects && !busy && can_publish;
        let is_team = space.kind == Kind::Team;
        Group {
            id,
            title,
            empty: items.is_empty(),
            empty_text: items.is_empty().then(|| {
                tr(if space.can_create_projects {
                    "onboarding.spaces.empty"
                } else {
                    "onboarding.spaces.readOnly"
                })
                .to_owned()
            }),
            items,
            // A team one can add projects to stays, empty or not; an empty
            // personal space takes no drop here (only device sharing).
            keep_empty: is_team && (space.can_create_projects || (source.is_some() && can_publish)),
            drop: dragging.map(|_| DropTarget {
                enabled: is_team && writable && source.is_some(),
                hint: tr("onboarding.drop.team").to_owned(),
                action: DropAction::Publish {
                    space: space.id.clone(),
                },
            }),
            teams: None,
        }
    };
    let mut groups = vec![];
    if let Some(personal) = personal {
        groups.push(destination(
            personal,
            GroupId::PersonalShared,
            tr("onboarding.sharing.personal").to_owned(),
        ));
    }
    if let Some(team) = team {
        let mut group = destination(
            team,
            GroupId::TeamShared,
            tr("onboarding.sharing.team").to_owned(),
        );
        group.keep_empty |= cloud
            .iter()
            .any(|item| teams.iter().any(|s| held_by_id(item, s)));
        // One team needs no name beside the heading; several need choosing.
        if teams.len() > 1 {
            group.teams = Some((
                teams
                    .iter()
                    .map(|s| (s.id.clone(), s.name.clone()))
                    .collect(),
                team.id.clone(),
            ));
        }
        groups.push(group);
    }
    // Unresolved ownership is not evidence of an audience: keep it
    // reachable without guessing.
    let unknown: Vec<Item> = cloud
        .iter()
        .filter(|item| {
            !spaces
                .iter()
                .any(|s| item.cloud_organization.as_deref() == Some(s.id.as_str()))
        })
        .cloned()
        .collect();
    if !unknown.is_empty() {
        groups.push(Group {
            id: GroupId::SharedUnresolved,
            title: tr("onboarding.sharing.unresolved").to_owned(),
            items: unknown,
            empty_text: None,
            empty: false,
            keep_empty: false,
            drop: None,
            teams: None,
        });
    }
    groups
}
fn held_by_id(item: &Item, space: &Space) -> bool {
    item.cloud_organization.as_deref() == Some(space.id.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn local(id: &str) -> Item {
        Item {
            id: format!("local:{id}"),
            label: id.into(),
            local_path: Some(format!("/x/{id}")),
            cloud_project: None,
            linked: None,
            actions: None,
            modified: None,
            cloud_organization: None,
            host_folder: None,
        }
    }
    fn cloud(id: &str, org: Option<&str>) -> Item {
        Item {
            id: format!("cloud:{id}"),
            label: id.into(),
            local_path: None,
            cloud_project: Some(id.into()),
            linked: None,
            actions: None,
            modified: None,
            cloud_organization: org.map(Into::into),
            host_folder: None,
        }
    }
    fn space(id: &str, kind: Kind, create: bool) -> Space {
        Space {
            id: id.into(),
            name: id.to_uppercase(),
            kind,
            can_create_projects: create,
        }
    }
    fn inputs<'a>(spaces: &'a [Space], items: Vec<Item>) -> Inputs<'a> {
        Inputs {
            spaces,
            items,
            dragging_path: None,
            busy: false,
            can_publish: true,
            chosen_team: None,
            shared_ids: None,
            local_share: false,
        }
    }
    fn ids(groups: &[Group]) -> Vec<&'static str> {
        groups.iter().map(|g| g.id.key()).collect()
    }

    #[test]
    fn shared_projects_group_by_audience_team_first() {
        let spaces = [
            space("me", Kind::Personal, true),
            space("design", Kind::Team, true),
        ];
        let items = vec![
            local("notes"),
            cloud("todo", Some("me")),
            cloud("issues", Some("design")),
        ];
        let shown = groups(inputs(&spaces, items));
        assert_eq!(
            ids(&shown),
            ["team-shared", "personal-shared", "local-only"]
        );
        assert_eq!(shown[0].items[0].label, "issues");
        assert_eq!(shown[1].items[0].label, "todo");
        assert_eq!(shown[2].items[0].label, "notes");
        assert!(shown[0].teams.is_none(), "a lone team is not named");
    }

    #[test]
    fn unresolved_ownership_stays_reachable_and_folders_stay_local() {
        let mut linked = local("site");
        linked.linked = Some(crate::workspace::cloud::catalog::Linked {
            id: "cloud-site".into(),
            name: "site".into(),
        });
        let shown = groups(inputs(
            &[],
            vec![local("notes"), linked, cloud("shared", None)],
        ));
        assert_eq!(ids(&shown), ["shared-unresolved", "local-only"]);
        assert_eq!(
            shown[1].items.len(),
            2,
            "a linked folder is still a folder here"
        );
    }

    #[test]
    fn the_local_audience_is_stated_even_alone() {
        let shown = groups(inputs(&[], vec![local("notes")]));
        assert_eq!(ids(&shown), ["local-only"]);
        assert_eq!(shown[0].title, tr("onboarding.sharing.localOnly"));
    }

    #[test]
    fn a_writable_team_stays_empty_and_takes_a_dragged_unlinked_folder() {
        let spaces = [
            space("me", Kind::Personal, true),
            space("t1", Kind::Team, true),
            space("t2", Kind::Team, false),
        ];
        let mut input = inputs(&spaces, vec![local("notes")]);
        let resting = groups(Inputs { ..input });
        // An empty writable team stays to drop into; the empty personal
        // space does not.
        assert_eq!(ids(&resting), ["team-shared", "local-only"]);
        assert_eq!(resting[0].teams.as_ref().unwrap().0.len(), 2);
        input = inputs(&spaces, vec![local("notes")]);
        input.dragging_path = Some("/x/notes");
        let dragging = groups(input);
        let team = &dragging[0];
        assert!(team.drop.as_ref().unwrap().enabled);
        assert_eq!(
            team.drop.as_ref().unwrap().action,
            DropAction::Publish { space: "t1".into() }
        );
        // A chosen team that cannot take projects refuses the drop.
        let mut input = inputs(&spaces, vec![local("notes")]);
        input.dragging_path = Some("/x/notes");
        input.chosen_team = Some("t2");
        let refused = groups(input);
        assert!(!refused[0].drop.as_ref().unwrap().enabled);
    }

    #[test]
    fn known_sharing_survives_and_the_personal_area_takes_a_drop() {
        let mut shared = local("vault");
        shared.host_folder = Some("f1".into());
        // No sharing state read: a recorded offer still counts.
        let shown = groups(inputs(&[], vec![shared.clone(), local("notes")]));
        assert_eq!(ids(&shown), ["personal-shared", "local-only"]);
        // Read, and the folder is no longer offered: local again.
        let none = HashSet::new();
        let mut input = inputs(&[], vec![shared.clone(), local("notes")]);
        input.shared_ids = Some(&none);
        assert_eq!(ids(&groups(input)), ["local-only"]);
        // With device sharing, the personal area is a drop target for an
        // unshared folder, never for one already shared.
        let mut input = inputs(&[], vec![shared, local("notes")]);
        input.local_share = true;
        input.dragging_path = Some("/x/notes");
        let dragging = groups(input);
        let personal = dragging
            .iter()
            .find(|g| g.id == GroupId::PersonalShared)
            .unwrap();
        assert!(personal.drop.as_ref().unwrap().enabled);
        assert_eq!(
            personal.drop.as_ref().unwrap().action,
            DropAction::ShareDevices
        );
        let mut input = inputs(&[], vec![local("notes")]);
        input.local_share = true;
        input.dragging_path = Some("/x/vault-missing");
        let personal = groups(input)
            .into_iter()
            .find(|g| g.id == GroupId::PersonalShared)
            .unwrap();
        assert!(!personal.drop.unwrap().enabled);
    }

    #[test]
    fn without_device_sharing_an_empty_personal_space_offers_no_drop() {
        let spaces = [space("me", Kind::Personal, true)];
        let mut input = inputs(&spaces, vec![local("notes")]);
        input.dragging_path = Some("/x/notes");
        let shown = groups(input);
        assert_eq!(ids(&shown), ["local-only"]);
    }
}
