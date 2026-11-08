//! What the right sidebar shows (`desktop-right-sidebar-stack`,
//! `useGitPresentation`, `useCloudWorkspaceSidebar`): the Agent workbench,
//! Changes / History and a hosted Project's History, all kept mounted; which
//! one is the surface (`rightSidebarSurface`), what the Header entries do
//! with it, and storing it.
//!
//! [`RightSidebar`] is an entity. Whether the sidebar is open, and how wide,
//! is the pane layout's ([`super::panes`]): an entry here decides whether
//! it should be open and sets the pane. Each surface takes its own part of
//! the preferences; what a surface asks of the window leaves as a
//! [`SidebarEvent`].
use super::panes::PaneLayout;
use crate::features::settings::{
    Page, Preferences, PreferencesStore, RightSidebarSurface, observe_slice,
};
use crate::features::source_control::CloudHistory;
use crate::features::source_control::CloudHistoryEvent;
use crate::features::source_control::SourceControl;
use crate::features::source_control::SourceControlEvent;
use crate::features::workbench::Workbench;
use crate::features::workbench::WorkbenchEvent;
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use std::path::PathBuf;

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
    /// What runs on the other computer for its folder: a terminal, an
    /// Agent and its Changes (`desktop-host-tools`).
    HostTools,
}

/// What a surface asks of the window.
pub(super) enum SidebarEvent {
    /// Changes "Open file" (`onOpenFile`), a path in the project.
    OpenFile(PathBuf),
    /// `handleAgentOpenFile`: a path the Agent named in `root`.
    OpenAgentFile { root: PathBuf, path: String },
    /// `openSettingsDialog(page)`.
    OpenSettings(Page),
    /// A hosted run's changes were accepted.
    CloudPublished,
    /// History closed itself: the window takes the focus back.
    Closed,
}

/// The parts of the preferences the surfaces show.
#[derive(Clone, PartialEq)]
struct Shown {
    hidden: Vec<String>,
    routing: crate::features::settings::AgentRoutingPreferences,
    payments: bool,
    layout: crate::features::settings::GitSidebarLayout,
    icons: String,
}
impl Shown {
    fn of(p: &Preferences) -> Self {
        Self {
            hidden: p.local_agents.hidden_agent_ids.clone(),
            routing: p.agent_routing.clone(),
            payments: p.experimental.payments,
            layout: p.git_sidebar_layout,
            icons: p.file_icon_theme.clone(),
        }
    }
}

pub(super) struct RightSidebar {
    pub workbench: Entity<Workbench>,
    pub source_control: Entity<SourceControl>,
    pub cloud_history: Entity<CloudHistory>,
    pub host_tools: Entity<crate::features::hosts::HostTools>,
    preferences: Entity<PreferencesStore>,
    panes: Entity<PaneLayout>,
    surface: Surface,
    /// The stored surface has been applied (once, when preferences load).
    restored: bool,
}
impl EventEmitter<SidebarEvent> for RightSidebar {}

impl RightSidebar {
    pub fn new(
        surface: Surface,
        preferences: Entity<PreferencesStore>,
        panes: Entity<PaneLayout>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let workbench = cx.new(|cx| Workbench::new(window, cx));
        let source_control = cx.new(|cx| SourceControl::new(window, cx));
        let cloud_history = cx.new(CloudHistory::new);
        let host_tools = cx.new(|cx| crate::features::hosts::HostTools::new(window, cx));
        cx.observe(&host_tools, |_, _, cx| cx.notify()).detach();
        let store = preferences.clone();
        workbench.update(cx, |workbench, _| workbench.set_preference_store(store));
        cx.subscribe(&workbench, |_, _, event, cx| {
            cx.emit(match event {
                WorkbenchEvent::OpenModelConnections => {
                    SidebarEvent::OpenSettings(Page::ModelConnections)
                }
                WorkbenchEvent::OpenAccount => SidebarEvent::OpenSettings(Page::Account),
                WorkbenchEvent::OpenAgentFile { root, path } => SidebarEvent::OpenAgentFile {
                    root: root.clone(),
                    path: path.clone(),
                },
                WorkbenchEvent::CloudPublished => SidebarEvent::CloudPublished,
            })
        })
        .detach();
        // History and Back store the surface (`rightSidebarSurface`).
        cx.subscribe(&source_control, |s, _, event, cx| match event {
            SourceControlEvent::OpenFile(path) => {
                cx.emit(SidebarEvent::OpenFile(PathBuf::from(path)))
            }
            SourceControlEvent::Surface => s.store(cx),
        })
        .detach();
        // History's Close and Back leave the sidebar closed on the workbench.
        cx.subscribe(&cloud_history, |s, _, event, cx| {
            let CloudHistoryEvent::Close = event;
            s.close_cloud_history(cx);
            cx.emit(SidebarEvent::Closed);
        })
        .detach();
        cx.observe(&source_control, |_, _, cx| cx.notify()).detach();
        // Each surface takes its part of the preferences when it changes.
        observe_slice(
            &preferences,
            |store| Shown::of(&store.state),
            |s: &mut Self, shown, cx| s.show(shown, cx),
            cx,
        )
        .detach();
        // The surface the closed sidebar opens on, once the stored one loads.
        cx.observe(&preferences, |s, preferences, cx| {
            let store = preferences.read(cx);
            if store.loaded {
                let surface = store.state.right_sidebar_surface;
                s.restore(surface, cx);
            }
        })
        .detach();
        let mut sidebar = Self {
            workbench,
            source_control,
            cloud_history,
            host_tools,
            preferences: preferences.clone(),
            panes,
            surface,
            restored: false,
        };
        let shown = Shown::of(&preferences.read(cx).state);
        sidebar.show(&shown, cx);
        sidebar
    }
    fn show(&mut self, shown: &Shown, cx: &mut Context<Self>) {
        let Shown {
            hidden,
            routing,
            payments,
            layout,
            icons,
        } = shown.clone();
        self.workbench
            .update(cx, |w, cx| w.set_preferences(hidden, routing, payments, cx));
        let history_icons = icons.clone();
        self.cloud_history
            .update(cx, |h, cx| h.set_icon_theme(history_icons, cx));
        self.source_control
            .update(cx, |s, cx| s.set_presentation(layout, icons, cx));
    }
    fn open(&self, cx: &App) -> bool {
        self.panes.read(cx).right().open
    }
    fn set_open(&self, open: bool, cx: &mut App) {
        self.panes.update(cx, |p, cx| p.set_right_open(open, cx));
    }
    /// The sidebar, open or not, shows `surface`.
    #[cfg(test)]
    pub fn is(&self, surface: Surface) -> bool {
        self.surface == surface
    }
    /// The sidebar is open on `surface`.
    pub fn shows(&self, surface: Surface, cx: &App) -> bool {
        self.open(cx) && self.surface == surface
    }

    /// A project was entered: a local folder's Agent and Git, or a hosted
    /// Project's own Agent (`CloudAgentSidebar`), not this machine's.
    pub fn enter(&mut self, workspace: &crate::workspace::Workspace, cx: &mut Context<Self>) {
        if let Some(root) = workspace.local_root() {
            let root = root.to_owned();
            self.workbench
                .update(cx, |s, cx| s.set_workspace(root.clone(), cx));
            self.source_control
                .update(cx, |s, cx| s.set_workspace(root, cx));
        } else if let Some(target) = workspace.agent_target() {
            self.workbench
                .update(cx, |s, cx| s.set_cloud_workspace(target, cx));
        }
    }

    // ------------------------------------------------------- Header entries
    /// ⌘J and the Agent entry (`handleToggleAgentWorkbench`): close the
    /// Agent when it shows, else show it.
    pub fn toggle_agent(&mut self, cx: &mut Context<Self>) {
        if self.open(cx) && self.surface == Surface::Agent {
            return self.set_open(false, cx);
        }
        self.surface = Surface::Agent;
        self.store(cx);
        self.set_open(true, cx);
        cx.notify();
    }
    /// The Changes entry (`useGitPresentation.toggle`): close Git when it
    /// shows (Changes or History), else reveal the Changes list.
    pub fn toggle_git(&mut self, cx: &mut Context<Self>) {
        if self.open(cx) && self.surface == Surface::Git {
            return self.set_open(false, cx);
        }
        self.surface = Surface::Git;
        self.source_control.update(cx, |s, cx| {
            s.show_changes(cx);
            s.refresh(cx);
        });
        self.store(cx);
        self.set_open(true, cx);
        cx.notify();
    }
    /// The Cloud Header's History: close it when it shows, else open it on
    /// `project`. Returns whether the sidebar is open (an opening that cannot
    /// start leaves it closed).
    pub fn toggle_cloud_history(&mut self, project: &str, cx: &mut Context<Self>) -> bool {
        let open = if self.open(cx) && self.surface == Surface::CloudHistory {
            self.cloud_history.update(cx, |h, cx| h.close(cx));
            false
        } else {
            self.surface = Surface::CloudHistory;
            self.cloud_history.update(cx, |h, cx| h.open(project, cx))
        };
        self.set_open(open, cx);
        cx.notify();
        open
    }
    /// A tool of the other computer's folder: close it when it shows, else
    /// show it (`DeviceFolderHeaderActions`).
    pub fn toggle_host_tool(
        &mut self,
        tool: crate::features::hosts::Tool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.shows_host_tool(tool, cx) {
            return self.set_open(false, cx);
        }
        let shown = self.host_tools.update(cx, |h, cx| h.show(tool, window, cx));
        if shown {
            self.surface = Surface::HostTools;
            self.set_open(true, cx);
        }
        cx.notify();
    }
    pub fn shows_host_tool(&self, tool: crate::features::hosts::Tool, cx: &App) -> bool {
        self.shows(Surface::HostTools, cx) && self.host_tools.read(cx).tool == Some(tool)
    }
    /// The other computer's folder left: its tools close with it.
    pub fn leave_host_tools(&mut self, cx: &mut Context<Self>) {
        if self.surface == Surface::HostTools {
            self.set_open(false, cx);
            self.surface = Surface::Agent;
        }
    }
    /// History closed itself (Close, Back): the sidebar closes on it and
    /// its reads go.
    pub fn close_cloud_history(&mut self, cx: &mut Context<Self>) {
        if self.surface == Surface::CloudHistory {
            self.set_open(false, cx);
        }
        self.cloud_history.update(cx, |h, cx| h.close(cx));
    }
    /// `closeWorkspaceSidebars`: the sidebar collapses; drafts, widths and
    /// sessions stay.
    pub fn collapse(&mut self, cx: &mut Context<Self>) {
        if self.surface == Surface::CloudHistory {
            self.cloud_history.update(cx, |h, cx| h.close(cx));
        }
        self.set_open(false, cx);
    }
    /// Pulled out from the window edge, the sidebar opens on its surface; a
    /// hosted Project's History only opens from its Header entry.
    pub fn pulled_out(&mut self) {
        if matches!(self.surface, Surface::CloudHistory | Surface::HostTools) {
            self.surface = Surface::Agent;
        }
    }
    /// `useCloudWorkspaceSidebar`: History lives only in the scope it opened
    /// in (Project, account, session generation, API) and only while the
    /// sidebar is open; out of it, it closes (its reads are gone).
    pub fn guard_cloud_history(&mut self, project: Option<&str>, cx: &mut Context<Self>) {
        let open = self.open(cx);
        // Already closed: the sidebar only keeps History as what it showed.
        if self.surface != Surface::CloudHistory || !(open || self.cloud_history.read(cx).is_open())
        {
            return;
        }
        if open && self.cloud_history.read(cx).matches(project, cx) {
            return;
        }
        self.cloud_history.update(cx, |h, cx| h.close(cx));
        self.set_open(false, cx);
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
            Surface::CloudHistory | Surface::HostTools => None,
        }
    }
    /// Store the surface (`setRightSidebarSurface`).
    pub fn store(&self, cx: &mut App) {
        let Some(surface) = self.stored(cx) else {
            return;
        };
        self.preferences.update(cx, |store, cx| {
            store.change(|p| p.right_sidebar_surface = surface, cx)
        });
    }
    /// The stored surface arriving (`readInitialRightSidebarSurface`): once,
    /// and only onto a closed sidebar; later loads are this window's own
    /// writes.
    pub(super) fn restore(&mut self, stored: RightSidebarSurface, cx: &mut Context<Self>) {
        if std::mem::replace(&mut self.restored, true) || self.open(cx) {
            return;
        }
        self.surface = match stored {
            RightSidebarSurface::Chat => Surface::Agent,
            RightSidebarSurface::Changes | RightSidebarSurface::History => Surface::Git,
        };
        let history = stored == RightSidebarSurface::History;
        self.source_control
            .update(cx, |s, cx| s.restore_history(history, cx));
        cx.notify();
    }
}

impl Render for RightSidebar {
    /// The surface's view, as the sidebar frame paints it.
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        use super::fill;
        let content = match self.surface {
            Surface::Git => self
                .source_control
                .clone()
                .cached(fill())
                .into_any_element(),
            Surface::CloudHistory => self.cloud_history.clone().cached(fill()).into_any_element(),
            Surface::Agent => self.workbench.clone().cached(fill()).into_any_element(),
            Surface::HostTools => self.host_tools.clone().into_any_element(),
        };
        div()
            .size_full()
            .bg(cx.palette().auxiliary())
            .child(content)
    }
}
