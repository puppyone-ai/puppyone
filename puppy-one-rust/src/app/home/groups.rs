//! `OnboardingProjectGroups`, `onboardingBaseGroups`, `useCloudProjectGroups`
//! and the place half of `HomepageComputers`: the Homepage's projects by the
//! place that holds them. This computer leads with every registered folder
//! (shared ones and Cloud checkouts too), then every space the account
//! reaches, each shown even when empty, then Cloud projects whose space is
//! unknown, then the owner's other computers. A folder joins a space by
//! being dragged onto it; New project starts one anywhere.
use crate::localization::t as tr;
use crate::workspace::cloud::{catalog::Item, spaces::Space};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(in crate::app) enum GroupId {
    LocalOnly,
    Space(String),
    SharedUnresolved,
    OtherComputers,
}
impl GroupId {
    /// `data-project-group`.
    pub fn key(&self) -> String {
        match self {
            Self::LocalOnly => "local-only".into(),
            Self::Space(id) => format!("space:{id}"),
            Self::SharedUnresolved => "shared-unresolved".into(),
            Self::OtherComputers => "other-computers".into(),
        }
    }
    /// `placeGroupId`: the group a navigation place brings into view.
    pub fn of_place(place: &str) -> Self {
        if place == crate::app::chrome::navigation::LOCAL_PLACE {
            Self::LocalOnly
        } else {
            Self::Space(place.to_owned())
        }
    }
    /// Projects outside this computer's group say where they live.
    pub fn marks_places(&self) -> bool {
        *self != Self::LocalOnly
    }
}

/// What letting go of a dragged folder over a group does.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum DropAction {
    /// Copy it to this space (the confirmed first publication).
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
/// The place's shape before its name.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum Mark {
    Computer,
    Space(Space),
}
/// `OnboardingProjectGroup`.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) struct Group {
    pub id: GroupId,
    pub title: String,
    pub mark: Option<Mark>,
    pub items: Vec<Item>,
    /// The line an empty destination shows in place of projects.
    pub empty_text: Option<String>,
    pub empty: bool,
    pub keep_empty: bool,
    pub drop: Option<DropTarget>,
    /// A space's heading: the plan its projects use, and whether this
    /// account owns a shared space.
    pub plan: Option<String>,
    pub owner: bool,
    /// "Members & plan" opens Settings on this space.
    pub manage: Option<String>,
    /// This computer's sharing, said at the end of its heading
    /// (`ThisComputerDetail`), and whether it offers Resume.
    pub presence: Option<(String, bool)>,
}
impl Group {
    fn new(id: GroupId, title: String) -> Self {
        Self {
            id,
            title,
            mark: None,
            items: vec![],
            empty_text: None,
            empty: false,
            keep_empty: false,
            drop: None,
            plan: None,
            owner: false,
            manage: None,
            presence: None,
        }
    }
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
    /// Each space's heading opens its members and plan.
    pub can_manage: bool,
    /// Folders this computer already offers its other computers.
    pub shared: &'a dyn Fn(&Item) -> bool,
    /// Opening a folder to my other computers is offered.
    pub local_share: bool,
    /// The folders my other computers offer, each computer's by name.
    pub remote: Vec<Item>,
    /// This computer's sharing, when it shares anything.
    pub presence: Option<(String, bool)>,
}

/// The groups in page order, without the empty ones that do not stay.
pub(in crate::app) fn groups(inputs: Inputs) -> Vec<Group> {
    let (local, cloud): (Vec<Item>, Vec<Item>) = inputs
        .items
        .into_iter()
        .partition(|item| item.local_path.is_some());
    let dragging = inputs.dragging_path.map(str::trim);
    let mut groups = vec![];
    // Every registered local folder stays on this computer.
    if !local.is_empty() {
        let mut group = Group::new(
            GroupId::LocalOnly,
            tr(if cfg!(target_os = "macos") {
                "onboarding.sharing.thisMac"
            } else {
                "onboarding.sharing.localOnly"
            })
            .to_owned(),
        );
        group.mark = Some(Mark::Computer);
        group.items = local.clone();
        group.presence = inputs.presence;
        groups.push(group);
    }
    // `useCloudProjectGroups`: one group per space, always shown.
    let source = dragging.filter(|path| {
        local.iter().any(|item| {
            item.local_path.as_deref().map(str::trim) == Some(*path) && item.linked.is_none()
        })
    });
    for space in inputs.spaces {
        let items: Vec<Item> = cloud
            .iter()
            .filter(|item| item.cloud_organization.as_deref() == Some(space.id.as_str()))
            .cloned()
            .collect();
        let writable = space.can_create_projects && !inputs.busy && inputs.can_publish;
        let mut group = Group::new(
            GroupId::Space(space.id.clone()),
            crate::features::cloud::space_name(space),
        );
        group.mark = Some(Mark::Space(space.clone()));
        group.empty = items.is_empty();
        group.empty_text = group.empty.then(|| {
            tr(if space.can_create_projects {
                "onboarding.spaces.empty"
            } else {
                "onboarding.spaces.readOnly"
            })
            .to_owned()
        });
        group.items = items;
        group.keep_empty = true;
        group.drop = dragging.map(|_| DropTarget {
            enabled: writable && source.is_some(),
            hint: tr("onboarding.drop.team").to_owned(),
            action: DropAction::Publish {
                space: space.id.clone(),
            },
        });
        group.plan = space.plan_id.clone();
        group.owner = !space.is_default && space.role.as_deref() == Some("owner");
        group.manage = inputs.can_manage.then(|| space.id.clone());
        groups.push(group);
    }
    // Unresolved ownership is not evidence of a place: keep it reachable
    // without guessing.
    let unknown: Vec<Item> = cloud
        .into_iter()
        .filter(|item| {
            !inputs
                .spaces
                .iter()
                .any(|s| item.cloud_organization.as_deref() == Some(s.id.as_str()))
        })
        .collect();
    if !unknown.is_empty() {
        let mut group = Group::new(
            GroupId::SharedUnresolved,
            tr("onboarding.sharing.unresolved").to_owned(),
        );
        group.items = unknown;
        groups.push(group);
    }
    // `HomepageComputers`: my other computers' folders, and the place a
    // folder is dragged to open it to them.
    if !inputs.remote.is_empty() || inputs.local_share {
        let source = dragging.filter(|path| {
            local.iter().any(|item| {
                item.local_path.as_deref().map(str::trim) == Some(*path) && !(inputs.shared)(item)
            })
        });
        let mut group = Group::new(
            GroupId::OtherComputers,
            tr("hosts.settings.others").to_owned(),
        );
        group.items = inputs.remote;
        group.drop = dragging.filter(|_| inputs.local_share).map(|_| DropTarget {
            enabled: source.is_some() && !inputs.busy,
            hint: tr("onboarding.drop.personal").to_owned(),
            action: DropAction::ShareDevices,
        });
        groups.push(group);
    }
    groups
        .into_iter()
        .filter(|g| !g.empty || g.keep_empty)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn item(id: &str, local: Option<&str>, project: Option<&str>, org: Option<&str>) -> Item {
        Item {
            id: id.into(),
            label: id.into(),
            local_path: local.map(Into::into),
            cloud_project: project.map(Into::into),
            linked: None,
            actions: None,
            modified: None,
            cloud_organization: org.map(Into::into),
            host_folder: None,
            remote: None,
        }
    }
    fn space(id: &str, name: &str, create: bool) -> Space {
        Space {
            id: id.into(),
            name: name.into(),
            can_create_projects: create,
            ..Default::default()
        }
    }
    fn spaces() -> Vec<Space> {
        vec![
            space("personal", "Alex", true),
            space("team", "Design", true),
            space("read", "Guests", false),
        ]
    }
    fn items() -> Vec<Item> {
        let mut linked = item("linked", Some("/fixture/linked"), None, None);
        linked.linked = Some(crate::workspace::cloud::catalog::Linked {
            id: "remote".into(),
            name: "Remote".into(),
        });
        vec![
            item("local", Some("/fixture/draft"), None, None),
            linked,
            item("cloud", None, Some("remote"), Some("team")),
        ]
    }
    fn inputs<'a>(spaces: &'a [Space], items: Vec<Item>, dragging: Option<&'a str>) -> Inputs<'a> {
        Inputs {
            spaces,
            items,
            dragging_path: dragging,
            busy: false,
            can_publish: true,
            can_manage: false,
            shared: &|_| false,
            local_share: false,
            remote: vec![],
            presence: None,
        }
    }
    fn keys(groups: &[Group]) -> Vec<String> {
        groups.iter().map(|g| g.id.key()).collect()
    }

    /// `homepageCloudSpaces.test.tsx`: every space together, empty and
    /// read-only ones included, after this computer.
    #[test]
    fn every_space_shows_after_this_computer_even_empty_or_read_only() {
        crate::localization::set_current("en");
        let spaces = spaces();
        let groups = groups(inputs(&spaces, items(), None));
        assert_eq!(
            keys(&groups),
            ["local-only", "space:personal", "space:team", "space:read"]
        );
        assert_eq!(groups[0].items.len(), 2);
        assert_eq!(groups[2].items[0].id, "cloud");
        assert_eq!(
            groups[3].empty_text.as_deref(),
            Some(tr("onboarding.spaces.readOnly"))
        );
        // No projects at all: the spaces still stand.
        assert_eq!(keys(&super::groups(inputs(&spaces, vec![], None))).len(), 3);
    }

    #[test]
    fn a_space_heading_names_its_plan_and_says_which_shared_spaces_this_account_owns() {
        crate::localization::set_current("en");
        let mut spaces = spaces();
        spaces[0].is_default = true;
        spaces[0].role = Some("owner".into());
        spaces[0].plan_id = Some("free".into());
        spaces[1].role = Some("owner".into());
        spaces[1].plan_id = Some("team_v2".into());
        spaces[2].role = Some("viewer".into());
        let mut input = inputs(&spaces, vec![], None);
        input.can_manage = true;
        let groups = groups(input);
        assert_eq!(
            groups
                .iter()
                .map(|g| (g.title.clone(), g.owner, g.plan.clone()))
                .collect::<Vec<_>>(),
            [
                ("Personal".to_owned(), false, Some("free".to_owned())),
                ("Design".to_owned(), true, Some("team_v2".to_owned())),
                ("Guests".to_owned(), false, None)
            ]
        );
        assert_eq!(groups[1].manage.as_deref(), Some("team"));
    }

    /// A trusted local drag takes the exact space; a read-only space, a
    /// folder that already has a Cloud copy and a foreign path do not.
    #[test]
    fn a_dragged_folder_publishes_to_the_writable_space_it_is_dropped_on() {
        let spaces = spaces();
        let groups = groups(inputs(&spaces, items(), Some("/fixture/draft")));
        let drop = |key: &str| {
            groups
                .iter()
                .find(|g| g.id.key() == key)
                .and_then(|g| g.drop.clone())
                .unwrap()
        };
        assert!(drop("space:team").enabled);
        assert_eq!(
            drop("space:team").action,
            DropAction::Publish {
                space: "team".into()
            }
        );
        assert!(drop("space:personal").enabled);
        assert!(!drop("space:read").enabled);
        let linked = super::groups(inputs(&spaces, items(), Some("/fixture/linked")));
        assert!(
            linked
                .iter()
                .filter_map(|g| g.drop.as_ref())
                .all(|d| !d.enabled)
        );
        let foreign = super::groups(inputs(&spaces, items(), Some("/forged/path")));
        assert!(
            foreign
                .iter()
                .filter_map(|g| g.drop.as_ref())
                .all(|d| !d.enabled)
        );
    }

    /// Unresolved ownership stays reachable without a guessed destination.
    #[test]
    fn unresolved_cloud_projects_keep_their_own_group() {
        let groups = groups(inputs(&[], items(), None));
        assert_eq!(keys(&groups), ["local-only", "shared-unresolved"]);
        assert!(groups[1].drop.is_none());
    }

    /// `homepageHostGroups.test.tsx`: shared folders stay on this computer;
    /// the other computers' folders and the place to share to follow.
    #[test]
    fn shared_folders_stay_here_and_other_computers_follow() {
        let mut shared = item("shared", Some("/fixture/shared"), None, None);
        shared.host_folder = Some("f1".into());
        let mut remote = item("remote-folder", None, None, None);
        remote.id = "device:f2".into();
        let mut input = inputs(&[], vec![shared], Some("/fixture/shared"));
        input.shared = &|i: &Item| i.host_folder.is_some();
        input.local_share = true;
        input.remote = vec![remote];
        let groups = groups(input);
        assert_eq!(keys(&groups), ["local-only", "other-computers"]);
        assert_eq!(groups[0].items[0].id, "shared");
        // Already offered: the drag is not taken again.
        assert!(!groups[1].drop.as_ref().unwrap().enabled);
    }
}
