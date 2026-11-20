//! Settings' pages by scope, as Vercel scopes a dashboard: the first group
//! belongs to the space Settings manages (its switcher heads it), and the
//! groups under it belong to this computer and the open project, whichever
//! space is chosen. Personal is the person: their account and plan. A team
//! space has its members, its plan and, for its owner, its settings. Page
//! order and visibility only, independent from the GPUI sidebar.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Page {
    Account,
    /// The Settings space's members (`space`).
    Space,
    Plan,
    /// The Settings space's name and owner.
    SpaceSettings,
    #[default]
    General,
    Appearance,
    Typography,
    CreateNew,
    OtherAppImports,
    Privacy,
    /// Computer access (`other-computers`), behind `HOST_DEVICES_AVAILABLE`.
    OtherComputers,
    Experimental,
    LocalAgents,
    ModelConnections,
    CloudComputer,
    Project,
    Host,
    Git,
    Files,
}
#[derive(Clone, Copy)]
pub struct Item {
    pub page: Page,
    pub key: &'static str,
    pub icon: &'static str,
}
pub struct Group {
    pub key: &'static str,
    /// Headed by the scope switcher instead of a title.
    pub switcher: bool,
    pub items: Vec<Item>,
}
/// The space Settings manages, as its pages see it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// The account's own space. It lists Members only while someone else is
    /// already in it, so nobody already invited is stranded.
    Personal { members: bool },
    /// A space people share; its settings are its owner's.
    Team { owner: bool },
}
#[derive(Clone, Copy, Default)]
pub struct Visibility {
    pub local_workspace: bool,
    pub other_app_imports: bool,
    /// `hostDevicesEnabled`: the other computers' release gate.
    pub host_devices: bool,
    /// `useCloudEnabled()`: Plan and the "Cloud" heading.
    pub cloud_enabled: bool,
    /// `useAccountAvailable()`: Account, with or without Cloud.
    pub account_available: bool,
    /// The space Settings manages, once it is known.
    pub scope: Option<Scope>,
    /// Open Cloud project with Cloud Computer Screen enabled (`CloudComputerSettings`).
    pub cloud_computer_available: bool,
}
impl Page {
    /// `SettingsSectionHeader` title of the page.
    pub fn title(self) -> &'static str {
        match self {
            Self::Account => "settings.account.title",
            Self::Space => "settings.space.membersAndSettings",
            Self::Plan => "settings.seats.title",
            Self::SpaceSettings => "settings.space.settings",
            Self::General => "settings.general.title",
            Self::Appearance => "settings.appearance.title",
            Self::Typography => "settings.typography.title",
            Self::CreateNew => "settings.createNew.title",
            Self::OtherAppImports => "settings.experimental.otherAppImports.title",
            Self::Privacy => "settings.privacy.title",
            Self::OtherComputers => "hosts.settings.title",
            Self::Experimental => "settings.experimental.title",
            Self::LocalAgents => "settings.localAgents.title",
            Self::ModelConnections => "settings.modelConnections.title",
            Self::CloudComputer => "cloud.settings.computer.title",
            Self::Project => "settings.localProject.title",
            Self::Host => "settings.cloud.title",
            Self::Git => "settings.git.title",
            Self::Files => "settings.files.title",
        }
    }
}
const fn item(page: Page, key: &'static str, icon: &'static str) -> Item {
    Item { page, key, icon }
}
/// "This Mac" (or "This computer"): what applies to this computer in every
/// space.
pub const THIS_COMPUTER: &str = if cfg!(target_os = "macos") {
    "shell.workspaceSwitcher.location.thisMac"
} else {
    "shell.workspaceSwitcher.location.thisComputer"
};
pub fn groups(visibility: Visibility) -> Vec<Group> {
    use Page::*;
    let mut groups = vec![];
    match visibility.scope.filter(|_| visibility.cloud_enabled) {
        Some(scope) => {
            let mut items = vec![];
            match scope {
                Scope::Personal { members } => {
                    if visibility.account_available {
                        items.push(item(Account, "settings.sidebar.account", "user-round"));
                    }
                    if members {
                        items.push(item(Space, "settings.space.membersAndSettings", "users"));
                    }
                    items.push(item(Plan, "settings.sidebar.seats", "credit-card"));
                }
                Scope::Team { owner } => {
                    items.push(item(Space, "settings.space.membersAndSettings", "users"));
                    items.push(item(Plan, "settings.sidebar.seats", "credit-card"));
                    if owner {
                        items.push(item(
                            SpaceSettings,
                            "settings.space.settings",
                            "sliders-horizontal",
                        ));
                    }
                }
            }
            groups.push(Group {
                key: "settings.space.group",
                switcher: true,
                items,
            });
        }
        // No space to scope by yet: the account, and with Cloud the plans
        // (signed out, they read as prices with a way to sign in).
        None => {
            let mut items = vec![];
            if visibility.account_available {
                items.push(item(Account, "settings.sidebar.account", "user-round"));
            }
            if visibility.cloud_enabled {
                items.push(item(Plan, "settings.sidebar.seats", "credit-card"));
            }
            groups.push(Group {
                key: "settings.sidebar.accountGroup",
                switcher: false,
                items,
            });
        }
    }
    let mut computer = vec![
        item(General, "settings.sidebar.general", "settings"),
        item(Appearance, "settings.sidebar.appearance", "monitor"),
        item(Typography, "settings.sidebar.typography", "type"),
        item(CreateNew, "settings.sidebar.createNew", "list-plus"),
    ];
    if visibility.other_app_imports {
        computer.push(item(
            OtherAppImports,
            "settings.sidebar.otherAppImports",
            "folder-input",
        ));
    }
    computer.push(item(LocalAgents, "settings.sidebar.localAgents", "bot"));
    computer.push(item(
        ModelConnections,
        "settings.modelConnections.title",
        "plug",
    ));
    computer.push(item(Privacy, "settings.sidebar.privacy", "shield-check"));
    if visibility.host_devices {
        computer.push(item(
            OtherComputers,
            "settings.sidebar.otherComputers",
            "product-local",
        ));
    }
    computer.push(item(
        Experimental,
        "settings.sidebar.experimental",
        "flask-conical",
    ));
    groups.push(Group {
        key: THIS_COMPUTER,
        switcher: false,
        items: computer,
    });
    if visibility.cloud_computer_available {
        groups.push(Group {
            key: "settings.sidebar.cloud",
            switcher: false,
            items: vec![item(
                CloudComputer,
                "cloud.settings.tab.computer",
                "monitor",
            )],
        });
    }
    if visibility.local_workspace {
        groups.push(Group {
            key: "settings.sidebar.localProject",
            switcher: false,
            items: vec![
                item(Project, "settings.sidebar.projectInfo", "folder-cog"),
                item(Host, "settings.sidebar.hostServer", "server"),
                item(Git, "settings.sidebar.git", "git-branch"),
                item(Files, "settings.sidebar.gitIgnore", "file-text"),
            ],
        });
    }
    groups.retain(|g| g.switcher || !g.items.is_empty());
    groups
}
/// `isSettingsSectionAvailable`.
pub fn available(page: Page, visibility: Visibility) -> bool {
    groups(visibility)
        .iter()
        .any(|g| g.items.iter().any(|i| i.page == page))
}
/// Where an unavailable page lands: a space's pages fall to its Plan (the
/// one every scope has), the rest to Account where the build has accounts,
/// else General.
pub fn fallback(page: Page, visibility: Visibility) -> Page {
    if matches!(page, Page::Space | Page::SpaceSettings) && available(Page::Plan, visibility) {
        Page::Plan
    } else if available(Page::Account, visibility) {
        Page::Account
    } else {
        Page::General
    }
}
/// The page a scope opens on when it is chosen: its first.
pub fn first_page(visibility: Visibility) -> Page {
    groups(visibility)
        .first()
        .and_then(|g| g.items.first())
        .map_or(Page::General, |i| i.page)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pages(groups: &[Group], index: usize) -> Vec<Page> {
        groups[index].items.iter().map(|i| i.page).collect()
    }
    #[test]
    fn plan_navigation_keeps_price_reachable_without_a_project_and_follows_cloud() {
        let on = Visibility {
            cloud_enabled: true,
            account_available: true,
            ..Default::default()
        };
        let all: Vec<_> = groups(on)
            .into_iter()
            .flat_map(|g| g.items.into_iter().map(|i| i.page))
            .collect();
        assert!(all.contains(&Page::Account));
        assert!(all.contains(&Page::Plan));
        assert!(!all.contains(&Page::Host));
        let off = Visibility {
            cloud_enabled: false,
            ..on
        };
        assert!(available(Page::Account, off));
        assert!(!available(Page::Plan, off));
        assert!(!available(
            Page::Account,
            Visibility {
                account_available: false,
                ..off
            }
        ));
    }
    /// Personal is the person: their account and plan, no members, no
    /// space settings; the switcher heads the group.
    #[test]
    fn personal_scope_is_the_account_and_its_plan() {
        let personal = Visibility {
            cloud_enabled: true,
            account_available: true,
            scope: Some(Scope::Personal { members: false }),
            ..Default::default()
        };
        let groups = groups(personal);
        assert!(groups[0].switcher);
        assert_eq!(pages(&groups, 0), [Page::Account, Page::Plan]);
        assert!(!available(Page::Space, personal));
        assert_eq!(fallback(Page::Space, personal), Page::Plan);
        assert_eq!(first_page(personal), Page::Account);
        // Someone already invited keeps a way to be managed.
        let shared = Visibility {
            scope: Some(Scope::Personal { members: true }),
            ..personal
        };
        assert_eq!(
            pages(&super::groups(shared), 0),
            [Page::Account, Page::Space, Page::Plan]
        );
    }
    /// A team space: its members and plan, and its settings for its owner;
    /// the account is Personal's, so it is not here.
    #[test]
    fn team_scope_is_members_plan_and_the_owners_settings() {
        let member = Visibility {
            cloud_enabled: true,
            account_available: true,
            scope: Some(Scope::Team { owner: false }),
            ..Default::default()
        };
        assert_eq!(pages(&groups(member), 0), [Page::Space, Page::Plan]);
        assert!(!available(Page::Account, member));
        assert_eq!(fallback(Page::SpaceSettings, member), Page::Plan);
        assert_eq!(first_page(member), Page::Space);
        let owner = Visibility {
            scope: Some(Scope::Team { owner: true }),
            ..member
        };
        assert_eq!(
            pages(&groups(owner), 0),
            [Page::Space, Page::Plan, Page::SpaceSettings]
        );
    }
    /// Without a space (no Cloud, signed out, or spaces still unknown) the
    /// first group is the account's, as before.
    #[test]
    fn account_follows_the_build_without_a_scope() {
        let off = Visibility {
            account_available: true,
            ..Default::default()
        };
        let first = &groups(off)[0];
        assert_eq!(first.key, "settings.sidebar.accountGroup");
        assert!(!first.switcher);
        assert!(available(Page::Account, off) && !available(Page::Plan, off));
        assert_eq!(groups(off)[1].key, THIS_COMPUTER);
        let on = Visibility {
            cloud_enabled: true,
            ..off
        };
        assert_eq!(pages(&groups(on), 0), [Page::Account, Page::Plan]);
        assert!(!available(Page::Space, on));
        // No account in this build: the group disappears.
        assert_eq!(groups(Visibility::default())[0].key, THIS_COMPUTER);
    }
    /// This computer's group holds its agents too, whichever space is chosen.
    #[test]
    fn project_and_import_pages_follow_visibility() {
        let none = Visibility::default();
        assert!(!available(Page::Git, none));
        assert!(!available(Page::OtherAppImports, none));
        assert!(!available(Page::OtherComputers, none));
        let all = Visibility {
            local_workspace: true,
            other_app_imports: true,
            host_devices: true,
            cloud_enabled: true,
            account_available: true,
            scope: Some(Scope::Team { owner: true }),
            cloud_computer_available: true,
        };
        assert!(
            available(Page::Git, all)
                && available(Page::OtherAppImports, all)
                && available(Page::CloudComputer, all)
        );
        let computer: Vec<_> = groups(all)
            .into_iter()
            .find(|g| g.key == THIS_COMPUTER)
            .unwrap()
            .items
            .iter()
            .map(|i| i.page)
            .collect();
        assert_eq!(
            computer,
            [
                Page::General,
                Page::Appearance,
                Page::Typography,
                Page::CreateNew,
                Page::OtherAppImports,
                Page::LocalAgents,
                Page::ModelConnections,
                Page::Privacy,
                Page::OtherComputers,
                Page::Experimental
            ]
        );
        assert!(groups(all)[0].switcher);
    }
}
