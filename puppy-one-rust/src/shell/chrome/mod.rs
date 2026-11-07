//! The window's chrome (`DesktopWindowChrome`): the Header with its project
//! switcher, place menu, Cloud tools, Changes and Agent entries; the
//! project rail (`ProjectSwitcherRail`); the one Header popover that is
//! open; and the owners of what hangs off them — the project actions menu
//! and the Header introductions.
//!
//! [`WindowChrome`] is an entity: it renders the Header as its view and the
//! rail from a read ([`WindowChrome::rail`]), reads the window's other
//! owners while it draws, takes what the window shows as a
//! [`SessionView`], and asks the window for everything else
//! ([`ChromeEvent`]).
mod project_menu;
mod rail;

use super::{
    Command, Popover,
    coachmarks::{Coachmark, HeaderCoachmarks},
    editor_area::EditorArea,
    header,
    home::Homepage,
    panes::PaneLayout,
    project::ProjectLifecycle,
    project_actions::ProjectActions,
    right_sidebar::{RightSidebar, Surface},
    session::{DocumentSession, SessionView},
    window_cloud::WindowCloud,
};
use crate::{
    features::settings::preferences_store::{PreferencesStore, observe_slice},
    theme,
    ui::components::{ButtonVariant, IconButton},
    workspace::cloud::catalog::Item,
};
use gpui::{prelude::*, *};
use std::path::PathBuf;

/// What the chrome asks of the window.
pub(super) enum ChromeEvent {
    Command(Command),
    /// A Header popover opened or closed.
    Popover(Option<Popover>),
    /// The project menu's entry: enter it here.
    OpenItem(Item),
    /// A rail project: enter it here.
    OpenProject(PathBuf),
    /// The account's catalog, loaded again (`Retry`).
    RefreshCatalog,
    OpenSettings(crate::features::settings::Page),
    /// The project rail came or went: the panes share another width.
    RailChanged,
}

/// The window's other owners, read while the chrome draws.
pub(super) struct Owners {
    pub preferences: Entity<PreferencesStore>,
    pub docs: Entity<DocumentSession>,
    pub project: Entity<ProjectLifecycle>,
    pub panes: Entity<PaneLayout>,
    pub sidebar: Entity<RightSidebar>,
    pub home: Entity<Homepage>,
    pub cloud: Entity<WindowCloud>,
    pub editor: Entity<EditorArea>,
}

pub(super) struct WindowChrome {
    session: SessionView,
    owners: Owners,
    /// `ProjectRowActions`, opened from the Homepage, the rail and the menu.
    pub project_actions: Entity<ProjectActions>,
    /// The Header introductions.
    pub coachmarks: Entity<HeaderCoachmarks>,
    /// The Header popover that is open: one at a time.
    pub popover: Option<Popover>,
    /// The project button's focus.
    pub project_focus: FocusHandle,
    /// A project path the Header menu just copied, and when.
    copied_path: Option<(String, std::time::Instant)>,
    /// The project rail replaces the Header's project button.
    rail: bool,
    weak: WeakEntity<Self>,
}
impl EventEmitter<ChromeEvent> for WindowChrome {}

impl WindowChrome {
    pub fn new(
        owners: Owners,
        project_actions: Entity<ProjectActions>,
        coachmarks: Entity<HeaderCoachmarks>,
        cx: &mut Context<Self>,
    ) -> Self {
        // A project's actions take the place of any Header popover.
        cx.subscribe(&project_actions, |s, _, event, cx| {
            if let super::project_actions::ActionsEvent::Opened = event {
                s.show_popover(None, cx);
            }
        })
        .detach();
        cx.observe(&coachmarks, |_, _, cx| cx.notify()).detach();
        // The project rail takes room from the panes.
        observe_slice(
            &owners.preferences,
            |store| store.state.project_switcher_rail,
            |s: &mut Self, rail, cx| {
                s.rail = *rail;
                cx.emit(ChromeEvent::RailChanged);
                cx.notify();
            },
            cx,
        )
        .detach();
        let rail = owners.preferences.read(cx).state.project_switcher_rail;
        Self {
            session: SessionView::default(),
            owners,
            project_actions,
            coachmarks,
            popover: None,
            project_focus: cx.focus_handle(),
            copied_path: None,
            rail,
            weak: cx.weak_entity(),
        }
    }
    /// What the window shows changed.
    pub fn set_session(&mut self, session: SessionView, cx: &mut Context<Self>) {
        if self.session != session {
            self.coachmarks
                .update(cx, |c, cx| c.set_session(session.clone(), cx));
            self.session = session;
            cx.notify();
        }
    }
    /// The window opened or closed a popover.
    pub fn set_popover(&mut self, popover: Option<Popover>, cx: &mut Context<Self>) {
        if self.popover != popover {
            self.popover = popover;
            cx.notify();
        }
    }
    /// A popover of the chrome's own opened or closed: the window decides.
    fn show_popover(&mut self, popover: Option<Popover>, cx: &mut Context<Self>) {
        cx.emit(ChromeEvent::Popover(popover));
    }
    fn command(&self, command: Command, cx: &mut Context<Self>) {
        cx.emit(ChromeEvent::Command(command));
    }
    /// The width the panes share: the window, less the project rail.
    pub fn rail_width(&self) -> f32 {
        if self.rail {
            theme::metric::PROJECT_RAIL_WIDTH
        } else {
            0.
        }
    }
    pub fn rail_shown(&self) -> bool {
        self.rail
    }
    /// A handler for a part drawn from a read (the rail).
    fn listener<E: ?Sized>(
        &self,
        f: impl Fn(&mut Self, &E, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl Fn(&E, &mut Window, &mut App) + 'static {
        crate::ui::listener(&self.weak, f)
    }

    /// The project being entered in this window, named as its Header will
    /// name it (`projectOpening.projectName`).
    pub(in crate::shell) fn opening_project_name(&self, cx: &App) -> Option<String> {
        let o = &self.owners;
        let docs = o.docs.read(cx);
        if docs.cloud_opening().is_some() {
            let project = o.project.read(cx).record.cloud.clone()?;
            return Some(
                o.home
                    .read(cx)
                    .project_items(cx)
                    .into_iter()
                    .find(|i| i.cloud_project.as_deref() == Some(project.as_str()))
                    .map(|i| i.label)
                    .unwrap_or(project),
            );
        }
        let root = docs.preparing_root()?;
        Some(
            o.preferences
                .read(cx)
                .state
                .recent_projects
                .iter()
                .find(|p| p.path == root)
                .map(|p| p.name.clone())
                .or_else(|| root.file_name().map(|n| n.to_string_lossy().into_owned()))
                .unwrap_or_default(),
        )
    }

    /// The Header (`DesktopWindowChrome`).
    ///
    /// - The Homepage names the product (once there are projects) and holds
    ///   the account (`HomepageCloudStatus`).
    /// - A local folder: the Explorer's expand button while it is closed,
    ///   the project and its place, then the app status, Share, Changes and
    ///   the Agent entry, each group set off by a rule.
    /// - A Cloud project (`CloudWorkspaceHeaderTools`): Share, a rule and
    ///   the Agent entry, on the Cloud's own Header tint.
    fn header(&self, cx: &mut Context<Self>) -> header::TitleBar {
        use crate::localization::t as tr;
        let o = &self.owners;
        let session = &self.session;
        if session.home {
            let mut bar = header::TitleBar::new();
            let home = o.home.read(cx);
            let empty = home.project_items(cx).is_empty();
            if !empty || home.list_held() {
                bar = bar.leading(header::brand_name(cx));
            }
            if crate::features::flags::cloud_enabled(&o.preferences, cx) {
                let (retry, account) = (self.weak.clone(), self.weak.clone());
                bar = bar.action(header::cloud_status(
                    &o.cloud.read(cx).catalog,
                    session.cloud_opening,
                    empty,
                    move |_, cx| {
                        let _ = retry.update(cx, |_, cx| cx.emit(ChromeEvent::RefreshCatalog));
                    },
                    move |_, cx| {
                        let _ = account.update(cx, |_, cx| {
                            cx.emit(ChromeEvent::OpenSettings(
                                crate::features::settings::Page::Account,
                            ))
                        });
                    },
                    cx,
                ));
            }
            return bar;
        }
        // `ProjectWindow` while another project is on its way in: the
        // Header states that project and its location, and what belongs to
        // the project on screen steps out of it.
        let opening = session.opening;
        let hosted = if opening {
            session.cloud_opening
        } else {
            session.hosted.is_some() || o.cloud.read(cx).capture_hosted()
        };
        let (changes, agent, tabs) = {
            let p = &o.preferences.read(cx).state;
            (
                !hosted && session.root.is_some() && p.header_changes,
                p.header_terminal || hosted,
                p.experimental.editor_tabs_in_header,
            )
        };
        let project = !self.rail && (session.workspace || session.fixture || opening);
        let mut bar = header::TitleBar::new().cloud(hosted);
        if !o.panes.read(cx).explorer().open {
            bar = bar.leading(
                IconButton::new("expand-explorer", "panel-left")
                    .label(tr("shared-ui.explorer.expandSidebar"))
                    .w(px(theme::control()))
                    .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                    .on_click(cx.listener(|s, _, _, cx| s.command(Command::ToggleExplorer, cx))),
            );
        }
        if project {
            bar = bar.leading(self.project_context(cx));
        }
        if opening {
            return bar;
        }
        // `enableEditorTabsInHeader`: the editor's tabs move into the Header.
        if tabs && o.docs.read(cx).state().is_some() {
            bar = bar.tabs(o.editor.read(cx).tabs(cx));
        }
        let sidebar = o.sidebar.read(cx);
        let coachmarks = self.coachmarks.read(cx);
        if hosted {
            let cloud = o.cloud.read(cx);
            if let Some(agents) = cloud.agents_control(cx) {
                bar = bar.action(agents);
            }
            bar = bar.action(cloud.share_control(cx)).divider(cx);
        } else {
            // `cloudEnabled && shareEnabled`: a local folder's Cloud services.
            let share =
                session.root.is_some() && crate::features::flags::share_enabled(&o.preferences, cx);
            if share {
                bar = bar
                    .action(header::share_entry().on_click(
                        cx.listener(|s, _, _, cx| s.command(Command::CloudServices, cx)),
                    ));
                if changes || agent {
                    bar = bar.divider(cx);
                }
            }
            if changes {
                use gpui_kit::base::Selectable as _;
                let status = header::GitTitlebarStatus::of(sidebar.source_control.read(cx));
                let introduced = coachmarks.active() == Some(Coachmark::Changes);
                let button = header::ChangesButton::new(status)
                    .selected(sidebar.shows(Surface::Git, cx))
                    .coachmark(introduced)
                    .on_click(cx.listener(|s, _, _, cx| s.command(Command::Changes, cx)))
                    .into_any_element();
                bar = bar.action(coachmarks.anchor(Coachmark::Changes, button));
                if agent {
                    bar = bar.divider(cx);
                }
            }
        }
        if agent {
            let introduced = coachmarks.active() == Some(Coachmark::Agent);
            let button = header::agent_entry(sidebar.shows(Surface::Agent, cx))
                .when(introduced, |b| b.variant(ButtonVariant::TitlebarCoachmark))
                .on_click(cx.listener(|s, _, _, cx| s.command(Command::ToggleRightSidebar, cx)))
                .into_any_element();
            bar = bar.action(coachmarks.anchor(Coachmark::Agent, button));
        }
        bar
    }
}

impl Render for WindowChrome {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(self.header(cx))
    }
}
