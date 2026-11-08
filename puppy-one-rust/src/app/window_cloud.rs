//! The window's Cloud (`useCloudWorkspace*`, `useWorkspaceAgents`,
//! `useProjectCloudContext`, the publish flow): the account's catalog, the
//! open checkout's association and first publication, who is in a hosted
//! Project, ending a folder's Cloud link and the notices the person put
//! away.
//!
//! [`WindowCloud`] is an entity. What the window shows reaches it as a
//! [`SessionView`] (and which Header card is open); it keeps the Cloud
//! entities current when those change, and asks the window for what is
//! the window's ([`CloudEvent`]). Its Header parts and notice are drawn
//! from a read (`cloud.read(cx).agents_control(..)`), its dialogs on the
//! dialog layer.
use super::{
    Command, Popover,
    cloud_agents_ui::AgentsAnchor,
    dialogs::{DialogKey, DialogLayer},
    project_place::Disconnect,
    session::SessionView,
};
use crate::features::cloud::CloudAgents;
use crate::features::cloud::CloudCatalog;
use crate::features::cloud::CloudPublish;
use crate::features::cloud::RepositoryCloud;
use crate::features::settings::{Page, PreferencesStore};
use crate::features::source_control::SourceControl;
use crate::workspace::cloud::opening::Failure;
use gpui::{prelude::*, *};
use std::path::{Path, PathBuf};

/// What the Cloud asks of the window.
pub(super) enum CloudEvent {
    OpenProject(PathBuf),
    OpenCloud(String),
    Command(Command),
    OpenSettings(Page),
    /// A Header card opened or closed.
    Popover(Option<Popover>),
    Error(String),
}

pub(super) struct WindowCloud {
    session: SessionView,
    /// The Header card open in this window (the window decides).
    pub popover: Option<Popover>,
    pub(super) preferences: Entity<PreferencesStore>,
    dialogs: WeakEntity<DialogLayer>,
    /// The dialog layer's focus, which the dialogs here keep.
    pub(super) dialog_focus: FocusHandle,
    /// The window's own focus, which takes the keyboard back.
    window_focus: FocusHandle,
    pub(super) weak: WeakEntity<Self>,
    /// The shared Cloud account catalog (Homepage / Header rows).
    pub catalog: Entity<CloudCatalog>,
    /// The first publication of this window's checkout.
    pub publish: Entity<CloudPublish>,
    /// The published Project the association was last refreshed for.
    publish_reported: Option<String>,
    /// The open checkout's Cloud association (Header location).
    pub repository: Entity<RepositoryCloud>,
    /// Who is in the hosted Project (`useWorkspaceAgents`).
    pub agents: Entity<CloudAgents>,
    pub agents_anchor: AgentsAnchor,
    /// Captures: the Header shows the Cloud tools over a local folder.
    #[cfg(feature = "dev-capture")]
    pub capture_hosted: bool,
    /// `dismissedCloudNoticeKey`: the local folder notice put away.
    pub dismissed_notice: Option<String>,
    /// `CloudLinkDisconnectDialog`, while it is open.
    pub disconnect: Option<Disconnect>,
    /// The open folder's one `puppyone` remote (`canDisconnectCloudLink`),
    /// read on a worker for the folder it names.
    pub(super) cloud_remote: Option<(PathBuf, String)>,
    /// The window's Git status: commits here the Cloud copy has not had.
    source_control: Entity<SourceControl>,
    /// A Cloud opening that failed: the Project and why, while its
    /// recovery shows.
    pub recovery: Option<(String, Failure)>,
}
impl EventEmitter<CloudEvent> for WindowCloud {}

impl WindowCloud {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        catalog: Entity<CloudCatalog>,
        source_control: Entity<SourceControl>,
        dialogs: &Entity<DialogLayer>,
        window_focus: FocusHandle,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let publish = cx.new(|_| CloudPublish::default());
        cx.observe(&publish, |s, publish, cx| {
            // A finished publication resolves the association again; a
            // waiting Header switch then continues to the new Project.
            let published = publish.read(cx).published.clone();
            if published.is_some() && s.publish_reported != published {
                s.publish_reported = published;
                s.repository.update(cx, |r, cx| r.retry(cx));
            }
            cx.notify()
        })
        .detach();
        let repository = cx.new(|_| RepositoryCloud::new());
        cx.observe(&repository, |s, _, cx| s.refresh(cx)).detach();
        let agents = cx.new(|_| CloudAgents::new());
        cx.observe(&agents, |s, _, cx| s.refresh(cx)).detach();
        cx.observe(&catalog, |_, _, cx| cx.notify()).detach();
        cx.observe(&source_control, |_, _, cx| cx.notify()).detach();
        // Cloud turned on or off, Share, the account: everything follows.
        cx.observe(&preferences, |s, _, cx| s.refresh(cx)).detach();
        crate::features::cloud::account::observe(window, cx, |s, _, cx| s.refresh(cx)).detach();
        // A hidden window is not polled for its Agents, and catches up
        // when it returns.
        let hidden = agents.downgrade();
        window
            .observe_window_visibility(move |visibility, _, cx| {
                let _ = hidden.update(cx, |a, cx| a.set_visible(visibility.is_visible(), cx));
            })
            .detach();
        Self {
            session: SessionView::default(),
            popover: None,
            preferences,
            dialogs: dialogs.downgrade(),
            dialog_focus: dialogs.read(cx).focus_handle().clone(),
            window_focus,
            weak: cx.weak_entity(),
            catalog,
            publish,
            publish_reported: None,
            repository,
            agents,
            agents_anchor: Default::default(),
            #[cfg(feature = "dev-capture")]
            capture_hosted: false,
            dismissed_notice: None,
            disconnect: None,
            cloud_remote: None,
            source_control,
            recovery: None,
        }
    }
    /// What the window shows changed.
    pub fn set_session(&mut self, session: SessionView, cx: &mut Context<Self>) {
        if self.session != session {
            self.session = session;
            self.refresh(cx);
        }
    }
    /// The Header card the window shows changed.
    pub fn set_popover(&mut self, popover: Option<Popover>, cx: &mut Context<Self>) {
        if self.popover != popover {
            self.popover = popover;
            self.refresh(cx);
        }
    }
    /// Opens or closes a Header card: the window decides.
    pub(super) fn show_popover(&mut self, popover: Option<Popover>, cx: &mut Context<Self>) {
        self.popover = popover;
        cx.emit(CloudEvent::Popover(popover));
        cx.notify();
    }
    /// The association, the publication and the Agents follow the window,
    /// the account and the preferences.
    pub(super) fn refresh(&mut self, cx: &mut Context<Self>) {
        self.sync_repository_cloud(cx);
        self.sync_cloud_remote(cx);
        self.sync_cloud_publish(cx);
        self.sync_cloud_agents(cx);
        cx.notify();
    }
    pub(super) fn cloud_enabled(&self, cx: &App) -> bool {
        crate::features::flags::cloud_enabled(&self.preferences, cx)
    }
    pub(super) fn root(&self) -> Option<PathBuf> {
        self.session.root.clone()
    }
    pub(super) fn hosted(&self) -> Option<String> {
        self.session.hosted.clone()
    }
    pub(super) fn session(&self) -> &SessionView {
        &self.session
    }
    /// Commits here that the open folder's upstream has not had
    /// (`gitTitlebarStatus.outgoing`).
    pub(super) fn unsent(&self, cx: &App) -> u32 {
        self.source_control
            .read(cx)
            .snapshot
            .as_ref()
            .map_or(0, |s| s.ahead)
    }
    /// Reads the open folder's `puppyone` remote again when the folder or
    /// its association changed; a late answer for another folder is dropped.
    fn sync_cloud_remote(&mut self, cx: &mut Context<Self>) {
        let Some(root) = self
            .root()
            .filter(|_| self.local_folder_notice(cx).is_some())
        else {
            self.cloud_remote = None;
            return;
        };
        let task = cx.background_executor().spawn({
            let root = root.clone();
            async move {
                use crate::cloud::publication::git::{Cli, GitOps as _, Remote};
                match (Cli { helper: None }).remote(&root) {
                    Ok(Remote::Exact(url)) => Some(url),
                    _ => None,
                }
            }
        });
        cx.spawn(async move |this, cx| {
            let url = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.root().as_ref() == Some(&root) {
                    let next = url.map(|url| (root, url));
                    if s.cloud_remote != next {
                        s.cloud_remote = next;
                        cx.notify();
                    }
                }
            });
        })
        .detach();
    }
    /// A handler for a part drawn from a read (the Header, the notices).
    pub(super) fn listener<E: ?Sized>(
        &self,
        f: impl Fn(&mut Self, &E, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl Fn(&E, &mut Window, &mut App) + 'static {
        crate::ui::listener(&self.weak, f)
    }
    pub(super) fn focus_window(&self, window: &mut Window, cx: &mut App) {
        self.window_focus.focus(window, cx);
    }
    /// Captures: the Header shows the Cloud tools.
    pub fn capture_hosted(&self) -> bool {
        #[cfg(feature = "dev-capture")]
        return self.capture_hosted;
        #[cfg(not(feature = "dev-capture"))]
        false
    }
    /// `useHomepageCloudProjects`: load or revalidate the account catalog.
    pub fn refresh_catalog(&mut self, retry: bool, cx: &mut Context<Self>) {
        let enabled = self.cloud_enabled(cx);
        self.catalog
            .update(cx, |c, cx| c.ensure(enabled, retry, cx));
    }
    /// A returning window may probe the Cloud association once.
    pub fn probe(&mut self, cx: &mut Context<Self>) {
        self.repository.update(cx, |r, cx| r.probe(cx));
    }

    // -------------------------------------------------------------- dialogs
    pub(super) fn open_dialog(&mut self, key: DialogKey, cx: &mut Context<Self>) {
        let owner = self.weak.clone();
        let _ = self.dialogs.update(cx, |d, cx| {
            d.open_for(key, owner, Self::render_dialog, Self::dismiss_dialog, cx)
        });
    }
    pub(super) fn close_dialog(&mut self, key: DialogKey, cx: &mut Context<Self>) -> bool {
        self.dialogs
            .update(cx, |d, cx| d.close(key, cx))
            .unwrap_or(false)
    }
    pub(super) fn dialog_open(&self, key: DialogKey, cx: &App) -> bool {
        self.dialogs
            .upgrade()
            .is_some_and(|d| d.read(cx).contains(key))
    }
    fn render_dialog(
        &mut self,
        key: DialogKey,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match key {
            DialogKey::CloudPublish => Some(self.cloud_publish_dialog(cx).into_any_element()),
            DialogKey::ConfirmPublish => {
                Some(self.publish_confirmation_dialog(cx).into_any_element())
            }
            DialogKey::CloudDisconnect => self
                .disconnect
                .as_ref()
                .map(|d| self.disconnect_dialog(d, cx).into_any_element()),
            DialogKey::CloudRecovery => self.recovery.as_ref().map(|(project, failure)| {
                self.cloud_open_recovery_dialog(project, failure, cx)
                    .into_any_element()
            }),
            DialogKey::ManageAgents => Some(self.manage_agents_dialog(cx).into_any_element()),
            _ => None,
        }
        .unwrap_or_else(|| Empty.into_any_element())
    }
    /// Escape on one of the Cloud's dialogs, each with its own cancel.
    fn dismiss_dialog(&mut self, key: DialogKey, window: &mut Window, cx: &mut Context<Self>) {
        match key {
            DialogKey::CloudPublish | DialogKey::ConfirmPublish => {
                self.close_dialog(key, cx);
            }
            // Ending a link on its way cannot be dismissed.
            DialogKey::CloudDisconnect => {
                if !self.disconnect.as_ref().is_some_and(|d| d.busy) {
                    self.close_disconnect(cx);
                }
            }
            DialogKey::CloudRecovery => self.close_cloud_recovery(cx),
            DialogKey::ManageAgents => self.close_manage_agents(window, cx),
            _ => {}
        }
        cx.notify();
    }
    /// `ProjectNavigationFailure` for a Cloud opening of `project`.
    pub fn show_recovery(&mut self, project: String, failure: Failure, cx: &mut Context<Self>) {
        self.recovery = Some((project, failure));
        self.open_dialog(DialogKey::CloudRecovery, cx);
    }

    // ----------------------------------------------------------------- links
    /// `cloudWorkspaceShareResource`: the selected folder, else the active
    /// document, else the authorized root.
    pub fn copy_link(&mut self, path: &Path, folder: bool, cx: &mut Context<Self>) {
        let link = crate::features::cloud::account::broker_and_binding(cx)
            .zip(self.session.cloud_project.clone())
            .ok_or("Cloud link unavailable")
            .and_then(|((_, binding), project)| {
                crate::workspace::cloud::locator::resource_url(
                    binding.environment.web(),
                    &project,
                    &path.to_string_lossy(),
                    folder,
                )
            });
        match link {
            Ok(link) => cx.write_to_clipboard(ClipboardItem::new_string(link)),
            Err(detail) => cx.emit(CloudEvent::Error(crate::localization::tf(
                "workspace.node.error.operationFailedDetail",
                &[("detail", detail.into())],
            ))),
        }
    }
}
