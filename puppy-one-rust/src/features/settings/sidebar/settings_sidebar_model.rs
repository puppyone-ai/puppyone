//! Port of `settings/sidebar/settingsSidebarModel.ts`: page order and
//! visibility only, independent from the GPUI sidebar.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Page {
    Account,
    /// The Settings space's members (`space`).
    Space,
    Plan,
    #[default]
    General,
    Appearance,
    Typography,
    CreateNew,
    OtherAppImports,
    Privacy,
    Experimental,
    LocalAgents,
    ModelConnections,
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
    pub items: Vec<Item>,
}
#[derive(Clone, Copy, Default)]
pub struct Visibility {
    pub local_workspace: bool,
    pub other_app_imports: bool,
    /// `useCloudEnabled()`: Plan and the "Cloud" heading.
    pub cloud_enabled: bool,
    /// `useAccountAvailable()`: Account, with or without Cloud.
    pub account_available: bool,
    /// Settings manages a space (`currentSpaceAvailable`): Members.
    pub current_space_available: bool,
}
impl Page {
    /// `SettingsSectionHeader` title of the page.
    pub fn title(self) -> &'static str {
        match self {
            Self::Account => "settings.account.title",
            Self::Space => "settings.space.membersAndSettings",
            Self::Plan => "settings.seats.title",
            Self::General => "settings.general.title",
            Self::Appearance => "settings.appearance.title",
            Self::Typography => "settings.typography.title",
            Self::CreateNew => "settings.createNew.title",
            Self::OtherAppImports => "settings.experimental.otherAppImports.title",
            Self::Privacy => "settings.privacy.title",
            Self::Experimental => "settings.experimental.title",
            Self::LocalAgents => "settings.localAgents.title",
            Self::ModelConnections => "settings.modelConnections.title",
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
pub fn groups(visibility: Visibility) -> Vec<Group> {
    use Page::*;
    let mut desktop = vec![
        item(General, "settings.sidebar.general", "settings"),
        item(Appearance, "settings.sidebar.appearance", "monitor"),
        item(Typography, "settings.sidebar.typography", "type"),
        item(CreateNew, "settings.sidebar.createNew", "list-plus"),
    ];
    if visibility.other_app_imports {
        desktop.push(item(
            OtherAppImports,
            "settings.sidebar.otherAppImports",
            "folder-input",
        ));
    }
    desktop.extend([
        item(Privacy, "settings.sidebar.privacy", "shield-check"),
        item(
            Experimental,
            "settings.sidebar.experimental",
            "flask-conical",
        ),
    ]);
    // Identity, the current space and the application stay at the same
    // level: Account wherever the build has accounts; the space's Members
    // and Plan with Cloud on, Members once a space is chosen.
    let mut account = vec![];
    if visibility.account_available {
        account.push(item(Account, "settings.sidebar.account", "user-round"));
    }
    let mut space = vec![];
    if visibility.cloud_enabled {
        if visibility.current_space_available {
            space.push(item(Space, "settings.space.membersAndSettings", "users"));
        }
        space.push(item(Plan, "settings.sidebar.seats", "credit-card"));
    }
    let mut groups = vec![
        Group {
            key: "settings.sidebar.accountGroup",
            items: account,
        },
        Group {
            key: "settings.space.group",
            items: space,
        },
        Group {
            key: "settings.sidebar.desktopApp",
            items: desktop,
        },
        Group {
            key: "settings.sidebar.agents",
            items: vec![
                item(LocalAgents, "settings.sidebar.localAgents", "bot"),
                item(ModelConnections, "settings.modelConnections.title", "plug"),
            ],
        },
    ];
    if visibility.local_workspace {
        groups.push(Group {
            key: "settings.sidebar.localProject",
            items: vec![
                item(Project, "settings.sidebar.projectInfo", "folder-cog"),
                item(Host, "settings.sidebar.hostServer", "server"),
                item(Git, "settings.sidebar.git", "git-branch"),
                item(Files, "settings.sidebar.gitIgnore", "file-text"),
            ],
        });
    }
    groups.retain(|g| !g.items.is_empty());
    groups
}
/// `isSettingsSectionAvailable`: an unavailable page falls back to General.
pub fn available(page: Page, visibility: Visibility) -> bool {
    groups(visibility)
        .iter()
        .any(|g| g.items.iter().any(|i| i.page == page))
}
#[cfg(test)]
mod tests {
    use super::*;
    /// `settingsSidebarModel.ts` (v0.4.4): the account, then the space.
    #[test]
    fn account_follows_the_build_and_the_space_group_follows_cloud() {
        let off = Visibility {
            account_available: true,
            ..Default::default()
        };
        assert_eq!(groups(off)[0].key, "settings.sidebar.accountGroup");
        assert!(available(Page::Account, off) && !available(Page::Plan, off));
        assert_eq!(groups(off)[1].key, "settings.sidebar.desktopApp");
        let on = Visibility {
            cloud_enabled: true,
            ..off
        };
        assert_eq!(groups(on)[1].key, "settings.space.group");
        assert!(available(Page::Plan, on) && !available(Page::Space, on));
        let space = Visibility {
            current_space_available: true,
            ..on
        };
        assert_eq!(
            groups(space)[1]
                .items
                .iter()
                .map(|i| i.page)
                .collect::<Vec<_>>(),
            [Page::Space, Page::Plan]
        );
        // No account in this build: the group disappears.
        assert_eq!(
            groups(Visibility::default())[0].key,
            "settings.sidebar.desktopApp"
        );
    }
    #[test]
    fn project_and_import_pages_follow_visibility() {
        let none = Visibility::default();
        assert!(!available(Page::Git, none));
        assert!(!available(Page::OtherAppImports, none));
        let all = Visibility {
            local_workspace: true,
            other_app_imports: true,
            cloud_enabled: true,
            account_available: true,
            current_space_available: true,
        };
        assert!(available(Page::Git, all) && available(Page::OtherAppImports, all));
        assert_eq!(groups(all)[0].key, "settings.sidebar.accountGroup");
    }
}
