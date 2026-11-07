//! The window's Cloud (`useCloudWorkspace*`, `useWorkspaceAgents`,
//! `useProjectCloudContext`, the share and publish flows): the account's
//! catalog, the open checkout's association and first publication, who is
//! in a hosted Project, the Share card and the notices the person put away.
//! What a hosted Project is, and whether the window shows one, is the
//! window's project record ([`super::window_project`]).
use super::{cloud_agents_ui::AgentsAnchor, share_panel::SharePanel};
use crate::features::{
    cloud::agents::CloudAgents, cloud::catalog::CloudCatalog, cloud::publish::CloudPublish,
    cloud::repository::RepositoryCloud,
};
use gpui::Entity;

pub(super) struct WindowCloud {
    /// The shared Cloud account catalog (Homepage / Header rows).
    pub catalog: Entity<CloudCatalog>,
    /// The first publication of this window's checkout.
    pub publish: Entity<CloudPublish>,
    /// The published Project the association was last refreshed for.
    pub publish_reported: Option<String>,
    /// The open checkout's Cloud association (Header location).
    pub repository: Entity<RepositoryCloud>,
    /// Who is in the hosted Project (`useWorkspaceAgents`).
    pub agents: Entity<CloudAgents>,
    pub agents_anchor: AgentsAnchor,
    /// Captures: the Header shows the Cloud tools over a local folder.
    #[cfg(feature = "dev-capture")]
    pub capture_hosted: bool,
    /// A project path the Header menu just copied, and when.
    pub copied_path: Option<(String, std::time::Instant)>,
    /// The Share card's links, captured when it opened.
    pub share_panel: SharePanel,
    /// `dismissedCloudNoticeKey`: the local folder notice put away.
    pub dismissed_notice: Option<String>,
    /// The `puppyone` remote as reviewed when replacing a vanished
    /// Project's connection was chosen.
    pub replace_url: Option<String>,
    /// `MissingCloudProjectReplacement`, while it is open.
    pub replace: Option<super::project_place::ReplaceCloud>,
    /// A Cloud opening that failed: the Project and why, while its
    /// recovery shows.
    pub recovery: Option<(String, crate::workspace::cloud::opening::Failure)>,
}

impl WindowCloud {
    pub fn new(
        catalog: Entity<CloudCatalog>,
        publish: Entity<CloudPublish>,
        repository: Entity<RepositoryCloud>,
        agents: Entity<CloudAgents>,
    ) -> Self {
        Self {
            catalog,
            publish,
            publish_reported: None,
            repository,
            agents,
            agents_anchor: Default::default(),
            #[cfg(feature = "dev-capture")]
            capture_hosted: false,
            copied_path: None,
            share_panel: Default::default(),
            dismissed_notice: None,
            replace_url: None,
            replace: None,
            recovery: None,
        }
    }
}
