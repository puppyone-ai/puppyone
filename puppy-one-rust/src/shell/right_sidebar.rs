//! What the right sidebar shows (`desktop-right-sidebar-stack`,
//! `useGitPresentation`, `useCloudWorkspaceSidebar`): the Agent workbench,
//! Changes / History and a hosted Project's History, all kept mounted; which
//! one is the surface (`rightSidebarSurface`), what the Header entries do
//! with it, and storing it.
//!
//! Whether the sidebar is open, and how wide, is the pane layout's
//! ([`super::panes`]): every entry here takes whether it is open and answers
//! whether it should be, and the shell opens or closes the pane.
use crate::features::{
    settings::{preference_types::RightSidebarSurface, preferences_store::PreferencesStore},
    source_control::{CloudHistory, SourceControl},
    workbench::Workbench,
};
use gpui::*;

/// The surface the sidebar shows, or shows when it reopens.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Surface {
    /// The auxiliary workbench: Agent chats and terminals (`chat`).
    #[default]
    Agent,
    /// Changes, or History inside it (`changes` / `history`).
    Git,
    /// A hosted Project's History (`CloudWorkspaceHistorySidebar`). It and
    /// the Agent replace each other.
    CloudHistory,
}

pub(super) struct RightSidebar {
    pub workbench: Entity<Workbench>,
    pub source_control: Entity<SourceControl>,
    pub cloud_history: Entity<CloudHistory>,
    surface: Surface,
    /// The stored surface has been applied (once, when preferences load).
    restored: bool,
}

impl RightSidebar {
    pub fn new(surface: Surface, window: &mut Window, cx: &mut App) -> Self {
        Self {
            workbench: cx.new(|cx| Workbench::new(window, cx)),
            source_control: cx.new(|cx| SourceControl::new(window, cx)),
            cloud_history: cx.new(CloudHistory::new),
            surface,
            restored: false,
        }
    }
    /// The sidebar, open or not, shows `surface`.
    pub fn is(&self, surface: Surface) -> bool {
        self.surface == surface
    }

    // ------------------------------------------------------- Header entries
    /// ⌘J and the Agent entry (`handleToggleAgentWorkbench`): close the
    /// Agent when it shows, else show it. Returns whether the sidebar is open.
    pub fn toggle_agent(
        &mut self,
        open: bool,
        preferences: &Entity<PreferencesStore>,
        cx: &mut App,
    ) -> bool {
        if open && self.surface == Surface::Agent {
            return false;
        }
        self.surface = Surface::Agent;
        self.store(preferences, cx);
        true
    }
    /// The Changes entry (`useGitPresentation.toggle`): close Git when it
    /// shows (Changes or History), else reveal the Changes list.
    pub fn toggle_git(
        &mut self,
        open: bool,
        preferences: &Entity<PreferencesStore>,
        cx: &mut App,
    ) -> bool {
        if open && self.surface == Surface::Git {
            return false;
        }
        self.surface = Surface::Git;
        self.source_control.update(cx, |s, cx| {
            s.show_changes(cx);
            s.refresh(cx);
        });
        self.store(preferences, cx);
        true
    }
    /// The Cloud Header's History: close it when it shows, else open it on
    /// `project`. Returns whether the sidebar is open (an opening that cannot
    /// start leaves it closed).
    pub fn toggle_cloud_history(&mut self, open: bool, project: &str, cx: &mut App) -> bool {
        if open && self.surface == Surface::CloudHistory {
            self.cloud_history.update(cx, |h, cx| h.close(cx));
            return false;
        }
        self.surface = Surface::CloudHistory;
        self.cloud_history.update(cx, |h, cx| h.open(project, cx))
    }
    /// History closed itself (Close, Back, a scope that ended): its reads go.
    pub fn close_cloud_history(&mut self, cx: &mut App) {
        self.cloud_history.update(cx, |h, cx| h.close(cx));
    }
    /// Pulled out from the window edge, the sidebar opens on its surface; a
    /// hosted Project's History only opens from its Header entry.
    pub fn pulled_out(&mut self) {
        if self.surface == Surface::CloudHistory {
            self.surface = Surface::Agent;
        }
    }
    /// `useCloudWorkspaceSidebar`: History lives only in the scope it opened
    /// in (Project, account, session generation, API) and only while the
    /// sidebar is open. `true` when it has to close (its reads are gone).
    pub fn guard_cloud_history(&mut self, open: bool, project: Option<&str>, cx: &mut App) -> bool {
        // Already closed: the sidebar only keeps History as what it showed.
        if self.surface != Surface::CloudHistory || !(open || self.cloud_history.read(cx).is_open())
        {
            return false;
        }
        if open && self.cloud_history.read(cx).matches(project, cx) {
            return false;
        }
        self.close_cloud_history(cx);
        true
    }

    // ------------------------------------------------------- stored surface
    /// `rightSidebarSurface` as stored: History while Changes shows it. A
    /// hosted Project's History is not a stored surface.
    pub fn stored(&self, cx: &App) -> Option<RightSidebarSurface> {
        match self.surface {
            Surface::Agent => Some(RightSidebarSurface::Chat),
            Surface::Git if self.source_control.read(cx).history_open() => {
                Some(RightSidebarSurface::History)
            }
            Surface::Git => Some(RightSidebarSurface::Changes),
            Surface::CloudHistory => None,
        }
    }
    /// Store the surface (`setRightSidebarSurface`).
    pub fn store(&self, preferences: &Entity<PreferencesStore>, cx: &mut App) {
        let Some(surface) = self.stored(cx) else {
            return;
        };
        preferences.update(cx, |store, cx| {
            store.change(|p| p.right_sidebar_surface = surface, cx)
        });
    }
    /// The stored surface arriving (`readInitialRightSidebarSurface`): once,
    /// and only onto a closed sidebar; later loads are this window's own
    /// writes.
    pub fn restore(&mut self, stored: RightSidebarSurface, open: bool, cx: &mut App) {
        if std::mem::replace(&mut self.restored, true) || open {
            return;
        }
        self.surface = match stored {
            RightSidebarSurface::Chat => Surface::Agent,
            RightSidebarSurface::Changes | RightSidebarSurface::History => Surface::Git,
        };
        let history = stored == RightSidebarSurface::History;
        self.source_control
            .update(cx, |s, cx| s.restore_history(history, cx));
    }

    /// The surface's view, as the sidebar frame paints it.
    pub fn content(&self) -> AnyElement {
        use super::fill;
        match self.surface {
            Surface::Git => self
                .source_control
                .clone()
                .cached(fill())
                .into_any_element(),
            Surface::CloudHistory => self.cloud_history.clone().cached(fill()).into_any_element(),
            Surface::Agent => self.workbench.clone().cached(fill()).into_any_element(),
        }
    }
}
