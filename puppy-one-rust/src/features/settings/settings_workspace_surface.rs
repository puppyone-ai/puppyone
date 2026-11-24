//! Settings page composition (`SettingsView.tsx` inside `SettingsDialog.tsx`).
//! Shell owns only the dialog placement.
use super::{
    preferences_store::{PreferencesChanged, PreferencesStore},
    repository_settings::RepositorySettings,
    sidebar::settings_sidebar_model::{Page, Scope, Visibility, available, fallback, first_page},
};
use crate::{
    localization::t as tr,
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, Icon, IconButton, MutedRow, SettingsSection, SurfaceCorners, SurfaceStyledExt,
        },
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
use std::path::PathBuf;
#[derive(Clone)]
pub enum SettingsEvent {
    Close,
    ModelConfigurationChanged,
    /// Remove the project from the open history (`onUnlinkWorkspace`).
    ForgetProject(PathBuf),
    /// `onOpenImport`: Settings closes for the import dialog.
    OpenImport,
    /// Computer access: a folder this computer shares, its settings.
    FolderSharing {
        folder: String,
        name: String,
    },
    /// `CloudComputerSettings`: updated sandbox choices for an open Cloud project.
    CloudSandboxChanged {
        project: String,
        sandbox: crate::workspace::cloud::sandbox::CloudSandbox,
    },
    /// The scope switcher's "Create space": the window's dialog makes it,
    /// and Settings opens on its Members.
    CreateSpace,
}
pub struct SettingsWorkspaceSurface {
    pub preferences: Entity<PreferencesStore>,
    pub root: Option<PathBuf>,
    pub(super) page: Page,
    pub(super) models: Entity<crate::features::model_connections::ModelConnections>,
    pub(super) agents: Entity<crate::features::local_agents::AgentSettings>,
    pub(super) cloud: Option<Entity<crate::features::cloud::account::CloudAccount>>,
    pub(super) plan_page: super::main::PlanPage,
    pub(super) space_page: super::main::SpacePage,
    pub(super) computer_page: super::main::ComputerPage,
    /// The hosted Project this window shows, whose space Settings manages
    /// unless its opener named another (`resolveSettingsSpace`).
    pub(super) cloud_project: Option<String>,
    /// The space the control that opened Settings named.
    pub(super) requested_space: Option<String>,
    pub(super) repository: Entity<RepositorySettings>,
    pub(super) patterns: Entity<crate::ui::form_input::TextInput>,
    /// Transient "Copied" feedback keyed by the copied control.
    pub(super) copied: Option<(SharedString, std::time::Instant)>,
    /// The New-menu page's open row context menu.
    pub(super) create_new_menu: Option<super::main::CreateNewMenu>,
    /// Computer access: the computer whose actions are open (id, name,
    /// this computer, where), and the catalog and host it follows.
    pub(super) computer_menu: Option<(String, String, bool, Point<Pixels>)>,
    pub(super) computers: Vec<Subscription>,
    /// Host Server draft of `.puppyone/config.json`, the saved document it
    /// was derived from, and its branch fields.
    pub(super) hosting_draft: super::workspace_config::WorkspaceConfig,
    pub(super) hosting_base: Option<super::workspace_config::WorkspaceConfig>,
    pub(super) hosting_branch: Entity<crate::ui::form_input::TextInput>,
    pub(super) hosting_backup_branch: Entity<crate::ui::form_input::TextInput>,
    /// The page scroller and whether its content overflowed at the last
    /// layout: product scrollbars then reserve their 12px gutter.
    content_scroll: ScrollHandle,
    pub(super) sidebar_scroll: ScrollHandle,
    content_overflows: bool,
    /// The wallet's 30 s reread while Account shows.
    compute_timer: Option<Task<()>>,
    /// Screenshot-only page request, applied once the page becomes available
    /// (project pages wait for the asynchronously opened folder).
    capture_page: Option<Page>,
}
impl EventEmitter<SettingsEvent> for SettingsWorkspaceSurface {}
impl SettingsWorkspaceSurface {
    pub fn select_page(&mut self, page: Page, cx: &mut Context<Self>) {
        // Account is Personal's: asked for from a team space, Settings
        // turns to Personal.
        if page == Page::Account
            && let Some(personal) = self.personal_space(cx)
            && self.settings_space(cx).is_some_and(|s| s.id != personal)
        {
            self.requested_space = Some(personal);
            self.follow_space(cx);
        }
        self.page = page;
        if matches!(page, Page::Git | Page::Host) {
            self.repository.update(cx, |r, cx| r.refresh(cx));
        }
        if page == Page::Account {
            self.refresh_compute(cx);
        }
        if page == Page::Plan {
            self.load_plan(false, cx);
        }
        if matches!(page, Page::Space | Page::SpaceSettings) {
            self.load_space(cx);
        }
        if page == Page::OtherComputers {
            self.read_computers(cx);
        }
        if page == Page::CloudComputer {
            self.load_cloud_computer(cx);
        }
        cx.notify();
    }
    /// Keep Settings' open Cloud project aligned with the window's session.
    pub fn set_cloud_project(&mut self, cloud_project: Option<String>, cx: &mut Context<Self>) {
        if self.cloud_project != cloud_project {
            self.cloud_project = cloud_project;
            if self.page == Page::CloudComputer {
                self.load_cloud_computer(cx);
            }
            self.follow_space(cx);
        }
    }
    /// The scope switcher chose `space`: Settings manages it now, on the
    /// same page when that space has it, else on its first.
    pub(in crate::features::settings) fn switch_scope(
        &mut self,
        space: String,
        cx: &mut Context<Self>,
    ) {
        self.requested_space = Some(space);
        self.follow_space(cx);
        let visibility = self.visibility(cx);
        let page = if available(self.page, visibility) {
            self.page
        } else {
            first_page(visibility)
        };
        self.select_page(page, cx);
    }
    /// The account's own space, once the spaces are known.
    fn personal_space(&self, cx: &App) -> Option<String> {
        crate::features::cloud::global_spaces_read(cx)?
            .spaces()
            .iter()
            .find(|s| s.is_default)
            .map(|s| s.id.clone())
    }
    /// What the window opening Settings shows and which space, if any, the
    /// control that opened it named; `invite` (a space just made) puts the
    /// keyboard in Members' invitation field once it shows.
    pub fn set_space_context(
        &mut self,
        cloud_project: Option<String>,
        requested: Option<String>,
        invite: Option<AnyWindowHandle>,
        cx: &mut Context<Self>,
    ) {
        let project_changed = self.cloud_project != cloud_project;
        self.cloud_project = cloud_project;
        self.requested_space = requested;
        self.space_page.focus_invite = invite;
        if project_changed && self.page == Page::CloudComputer {
            self.load_cloud_computer(cx);
        }
        self.follow_space(cx);
    }
    /// Keeps `Space`, `Plan` and `Account` aligned with the active account,
    /// flags, and resolved `settings_space`, clearing stale org data when
    /// signed out or when Cloud / Payments turns off.
    fn follow_space(&mut self, cx: &mut Context<Self>) {
        let expected_space = self.settings_space(cx).and_then(|space| {
            let (_, binding) = crate::features::cloud::account::broker_and_binding(cx)?;
            Some((
                crate::features::cloud::billing_namespace(&binding),
                space.id,
            ))
        });
        // Members are read for the space's own pages, and for Personal to
        // know whether anyone else is in it (`Scope::Personal`).
        let personal = self.settings_space(cx).is_some_and(|s| s.is_default);
        if expected_space.is_none() && self.space_page.org().is_some() {
            self.space_page.reset(cx);
        } else if (personal || matches!(self.page, Page::Space | Page::SpaceSettings))
            && self.space_page.context() != expected_space.as_ref()
        {
            self.load_space(cx);
        }
        let expected_plan = self.plan_scope_context(cx);
        if expected_plan.is_none() && self.plan_context().is_some() {
            self.reset_plan();
        } else if self.page == Page::Plan && self.plan_context() != expected_plan.as_ref() {
            self.load_plan(false, cx);
        }
        cx.notify();
    }
    /// `resolveSettingsSpace`: the one space Settings manages, while the
    /// account is signed in and its spaces are known.
    pub fn settings_space(&self, cx: &App) -> Option<crate::workspace::cloud::spaces::Space> {
        // The Space group follows Cloud (`requiresCloud`).
        if !crate::features::flags::cloud_enabled(&self.preferences, cx) {
            return None;
        }
        let signed_in = crate::features::cloud::account::broker_and_binding(cx).is_some();
        let spaces = crate::features::cloud::global_spaces_read(cx)?.spaces();
        let owner = self
            .cloud_project
            .as_deref()
            .and_then(|project| crate::features::cloud::owner_of(project, cx));
        crate::workspace::cloud::spaces::settings_space(
            signed_in,
            spaces,
            owner.as_deref(),
            self.requested_space.as_deref(),
        )
        .cloned()
    }
    /// `AccountAICredits`: read the wallet when Account shows, then every
    /// 30 s while it stays on screen.
    pub(super) fn refresh_compute(&mut self, cx: &mut Context<Self>) {
        if !crate::features::flags::payments_enabled(&self.preferences, cx) {
            return;
        }
        let compute = crate::features::model_connections::global_compute(cx);
        compute.update(cx, |c, cx| c.refresh(false, cx));
        if self.compute_timer.is_none() {
            self.compute_timer = Some(cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor()
                        .timer(std::time::Duration::from_secs(30))
                        .await;
                    let alive = this.update(cx, |s, cx| {
                        if s.page == Page::Account {
                            crate::features::model_connections::global_compute(cx)
                                .update(cx, |c, cx| c.refresh(true, cx));
                        }
                    });
                    if alive.is_err() {
                        break;
                    }
                }
            }));
        }
    }
    pub fn new(
        preferences: Entity<PreferencesStore>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let compute = crate::features::model_connections::global_compute(cx);
        cx.observe(&compute, |_, _, cx| cx.notify()).detach();
        // Product Analytics follows the process-wide telemetry state.
        if let Some(telemetry) = crate::features::telemetry::global(cx) {
            cx.observe(&telemetry, |_, _, cx| cx.notify()).detach();
        }
        cx.subscribe(&preferences, |s, _, _: &PreferencesChanged, cx| {
            s.sync_patterns(cx);
            if s.page == Page::Account {
                s.refresh_compute(cx);
            }
            s.follow_space(cx);
        })
        .detach();
        cx.observe(&preferences, |s, _, cx| {
            s.follow_space(cx);
        })
        .detach();
        let models =
            cx.new(|cx| crate::features::model_connections::ModelConnections::new(window, cx));
        cx.subscribe(
            &models,
            |_, _, _: &crate::features::model_connections::Saved, cx| {
                cx.emit(SettingsEvent::ModelConfigurationChanged)
            },
        )
        .detach();
        let agents = {
            let preferences = preferences.clone();
            cx.new(|cx| crate::features::local_agents::AgentSettings::new(preferences, window, cx))
        };
        let repository = cx.new(|cx| RepositorySettings::new(window, cx));
        cx.observe(&repository, |_, _, cx| cx.notify()).detach();
        let patterns = cx.new(|cx| {
            let mut input = crate::ui::form_input::TextInput::new("", true, 8000, window, cx);
            input.min_height = 96.;
            input
        });
        cx.subscribe(
            &patterns,
            |_, _, _: &crate::ui::form_input::InputEvent, cx| cx.notify(),
        )
        .detach();
        let cloud = crate::features::cloud::account::account(cx);
        if let Some(cloud) = &cloud {
            cx.observe(cloud, |s, _, cx| {
                if s.page == Page::Account {
                    s.refresh_compute(cx);
                }
                s.follow_space(cx);
            })
            .detach();
        }
        // `useAccountPlan`: coming back to the window reads Plan again.
        cx.observe_window_activation(window, |s, window, cx| {
            if window.is_window_active() && s.page == Page::Plan {
                s.activate_plan(cx);
            }
        })
        .detach();
        // `useDesktopUpdates`: General shows the update service's state.
        if let Some(updates) = crate::features::updates::global(cx) {
            cx.observe(&updates, |_, _, cx| cx.notify()).detach();
        }
        let spaces = crate::features::cloud::global_spaces(cx);
        cx.observe(&spaces, |s, _, cx| s.follow_space(cx)).detach();
        let space_page = super::main::SpacePage::new(window, cx);
        cx.subscribe(
            &space_page.name,
            |s, _, event: &crate::ui::form_input::InputEvent, cx| match event {
                crate::ui::form_input::InputEvent::Changed => cx.notify(),
                crate::ui::form_input::InputEvent::Submit => s.submit_space_rename(cx),
            },
        )
        .detach();
        cx.subscribe(
            &space_page.email,
            |s, _, event: &crate::ui::form_input::InputEvent, cx| match event {
                crate::ui::form_input::InputEvent::Changed => cx.notify(),
                crate::ui::form_input::InputEvent::Submit => s.submit_space_invite(cx),
            },
        )
        .detach();
        let mut s = Self {
            plan_page: Default::default(),
            space_page,
            computer_page: Default::default(),
            cloud_project: None,
            requested_space: None,
            cloud,
            preferences,
            root: None,
            page: Page::General,
            models,
            agents,
            repository,
            patterns,
            copied: None,
            create_new_menu: None,
            computer_menu: None,
            computers: Vec::new(),
            hosting_draft: Default::default(),
            hosting_base: None,
            hosting_branch: cx
                .new(|cx| crate::ui::form_input::TextInput::new("", false, 200, window, cx)),
            hosting_backup_branch: cx
                .new(|cx| crate::ui::form_input::TextInput::new("", false, 200, window, cx)),
            content_scroll: ScrollHandle::new(),
            sidebar_scroll: ScrollHandle::new(),
            content_overflows: false,
            compute_timer: None,
            capture_page: None,
        };
        s.sync_patterns(cx);
        // Screenshot-only hook for visual review of a specific page.
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
            && let Ok(name) = std::env::var("PUPPYONE_CAPTURE_SETTINGS_PAGE")
        {
            use super::sidebar::settings_sidebar_model::groups;
            let all = |scope| Visibility {
                local_workspace: true,
                other_app_imports: true,
                host_devices: crate::workspace::hosts::AVAILABLE,
                cloud_enabled: true,
                account_available: true,
                scope: Some(scope),
                cloud_computer_available: true,
            };
            if let Some(item) = [
                all(Scope::Personal { members: true }),
                all(Scope::Team { owner: true }),
            ]
            .into_iter()
            .flat_map(groups)
            .flat_map(|g| g.items)
            .find(|i| format!("{:?}", i.page).eq_ignore_ascii_case(&name))
            {
                s.capture_page = Some(item.page);
            }
        }
        s
    }
    /// Dev-capture: a project at `root` with `page` open
    /// (`tools/reference-settings-entry.tsx`); `with_remotes` adds the
    /// `git-remotes` case's two remotes.
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(
        &mut self,
        root: PathBuf,
        page: Page,
        with_remotes: bool,
        cx: &mut Context<Self>,
    ) {
        self.agents.update(cx, |a, cx| a.lab_fixture(cx));
        self.set_root(Some(root), cx);
        self.select_page(page, cx);
        self.repository
            .update(cx, |r, cx| r.lab_fixture(with_remotes, cx));
    }
    /// Dev-capture: the Local Agents scenarios (`agent-hooks`,
    /// `agent-activation`).
    #[cfg(feature = "dev-capture")]
    pub fn lab_agents(&mut self, scenario: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.agents
            .update(cx, |a, cx| a.lab_scenario(scenario, window, cx));
        // The setup section ends the page; the reference scrolls to it.
        if matches!(
            scenario,
            "settings-agent-hooks" | "settings-agent-activation"
        ) {
            self.content_scroll.scroll_to_bottom();
        }
    }
    /// Dev-capture: follow an account a fixture installed after Settings was
    /// made (the app's own account lives as long as the app).
    #[cfg(feature = "dev-capture")]
    pub fn lab_follow_account(&mut self, cx: &mut Context<Self>) {
        self.cloud = crate::features::cloud::account::account(cx);
        if let Some(cloud) = &self.cloud {
            cx.observe(cloud, |s, _, cx| s.follow_space(cx)).detach();
        }
        self.follow_space(cx);
    }
    /// Track the open project; Settings reads repository facts lazily.
    pub fn set_root(&mut self, root: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.root != root {
            self.root = root.clone();
            self.repository.update(cx, |r, cx| r.set_root(root, cx));
        }
    }
    /// Reset the pattern editor to the saved value (`useEffect(setPatternDraft)`).
    pub(super) fn sync_patterns(&mut self, cx: &mut Context<Self>) {
        let saved = self
            .preferences
            .read(cx)
            .state
            .files
            .exclude_patterns
            .join("\n");
        self.patterns.update(cx, |input, cx| {
            if input.text() != saved {
                input.set_text(saved, cx)
            }
        });
    }
    /// The scope switcher's choice, as its menu makes it.
    #[cfg(test)]
    pub fn switch_scope_for_test(&mut self, space: &str, cx: &mut Context<Self>) {
        self.switch_scope(space.to_owned(), cx);
    }
    #[cfg(test)]
    pub fn page_shown(&self, page: Page) -> bool {
        self.page == page
    }
    #[cfg(test)]
    pub fn page_available(&self, page: Page, cx: &App) -> bool {
        available(page, self.visibility(cx))
    }
    pub(super) fn visibility(&self, cx: &App) -> Visibility {
        Visibility {
            local_workspace: self.root.is_some(),
            other_app_imports: self
                .preferences
                .read(cx)
                .state
                .experimental
                .other_app_imports,
            host_devices: crate::workspace::hosts::AVAILABLE,
            cloud_enabled: crate::features::flags::cloud_enabled(&self.preferences, cx),
            account_available: crate::features::flags::account_available(cx),
            scope: self.settings_space(cx).map(|space| {
                if space.is_default {
                    Scope::Personal {
                        members: self.space_page.others_in(&space.id),
                    }
                } else {
                    Scope::Team {
                        owner: space.role.as_deref() == Some("owner") || space.can_manage_space,
                    }
                }
            }),
            cloud_computer_available: crate::features::flags::cloud_screen_enabled(
                &self.preferences,
                cx,
            ) && self.cloud_project.is_some()
                && crate::features::cloud::account::broker_and_binding(cx).is_some(),
        }
    }
    /// Copy text and show transient feedback on the triggering control.
    pub(super) fn copy(&mut self, key: SharedString, text: String, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        self.copied = Some((key, std::time::Instant::now()));
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(1500))
                .await;
            let _ = this.update(cx, |s, cx| {
                if s.copied
                    .as_ref()
                    .is_some_and(|(_, at)| at.elapsed().as_millis() >= 1400)
                {
                    s.copied = None;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn is_copied(&self, key: &str) -> bool {
        self.copied.as_ref().is_some_and(|(k, _)| k == key)
    }
}
impl Render for SettingsWorkspaceSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        // `grid-template-columns: clamp(164px, 24vw, 196px)` of the window width.
        let width = (f32::from(window.viewport_size().width) * 0.24).clamp(164., 196.);
        if let Some(page) = self.capture_page
            && available(page, self.visibility(cx))
        {
            self.capture_page = None;
            self.select_page(page, cx);
        }
        // An unavailable page falls back: a space's pages to its Plan, the
        // rest to Account where the build has accounts, else General.
        let visibility = self.visibility(cx);
        if !available(self.page, visibility) {
            self.page = fallback(self.page, visibility);
        }
        let content = if !self.preferences.read(cx).loaded {
            SettingsSection::new(tr(self.page.title()))
                .child(MutedRow::new(tr("settings.git.reading")))
                .into_any_element()
        } else {
            self.page_content(window, cx)
        };
        let error =
            self.preferences.read(cx).error.clone().map(|error| {
                v_flex()
                    .w_full()
                    .child(MutedRow::new(error).danger())
                    .child(
                        Button::new("retry-preferences")
                            .icon("rotate-ccw")
                            .label(tr("common.action.retry"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.preferences.update(cx, |p, cx| p.retry(cx))
                            })),
                    )
            });
        v_flex()
            .size_full()
            .font_weight(FontWeight::NORMAL)
            .text_color(t.text)
            .child(
                h_flex()
                    .relative()
                    .h(px(metric::CHROME_HEIGHT))
                    .flex_shrink_0()
                    .pl(px(10.))
                    .pr(px(6.))
                    .gap(px(6.))
                    .bg(t.header)
                    .surface_corners(metric::TASK_DIALOG_RADIUS, SurfaceCorners::top())
                    .child(
                        div()
                            .size(px(20.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(Icon::new("settings").color(t.muted)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(theme::ty().header.content))
                            .line_height(px(theme::ty().header.line_height))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted)
                            .child(tr("shell.navigation.settings")),
                    )
                    .child(
                        // `DesktopDialogCloseButton` in the task header: 32×28,
                        // its own 16-unit cross drawn at 14px.
                        IconButton::new("settings-close", Icon::new("dialog-close").small())
                            .label(tr("common.action.close"))
                            .color(t.muted)
                            .w(px(theme::control()))
                            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(SettingsEvent::Close))),
                    )
                    .child(
                        div()
                            .absolute()
                            .left(px(1.))
                            .right(px(1.))
                            .bottom_0()
                            .h(px(1.))
                            .bg(t.shell_divider),
                    ),
            )
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .items_start()
                    .child(self.sidebar(width, cx))
                    .child(
                        v_flex()
                            .id(SharedString::from(format!(
                                "settings-content-{:?}",
                                self.page
                            )))
                            .relative()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .pt(px(48.))
                            .pb(px(metric::UTILITY_PADDING_BOTTOM))
                            .pl(px(metric::UTILITY_PADDING_INLINE))
                            // `data-po-scrollbar="content"`: an overflowing page
                            // gives its 12px scrollbar a gutter.
                            .pr(px(metric::UTILITY_PADDING_INLINE
                                + if self.content_overflows { 12. } else { 0. }))
                            .overflow_y_scroll()
                            .track_scroll(&self.content_scroll)
                            .child(content)
                            .children(error)
                            .child({
                                let entity = cx.entity();
                                let scroll = self.content_scroll.clone();
                                canvas(
                                    move |_, _, cx| {
                                        let overflows = f32::from(scroll.max_offset().y) > 0.5;
                                        entity.update(cx, |s, cx| {
                                            if s.content_overflows != overflows {
                                                s.content_overflows = overflows;
                                                cx.notify();
                                            }
                                        });
                                    },
                                    |_, _, _, _| {},
                                )
                                .absolute()
                                .size_0()
                            })
                            .child(crate::ui::scrollbar::vertical(
                                "settings-content-scrollbar",
                                &self.content_scroll,
                            )),
                    ),
            )
    }
}
