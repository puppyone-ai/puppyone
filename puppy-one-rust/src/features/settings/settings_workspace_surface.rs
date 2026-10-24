//! Settings page composition (`SettingsView.tsx` inside `SettingsDialog.tsx`).
//! Shell owns only the dialog placement.
use super::{
    preferences_store::{PreferencesChanged, PreferencesStore},
    repository_settings::RepositorySettings,
    sidebar::settings_sidebar_model::{Page, Visibility, available},
};
use crate::{
    localization::t as tr,
    theme::{self, Theme, metric},
    ui::{column, icon_sized, row},
};
use gpui::{prelude::*, *};
use std::path::PathBuf;
#[derive(Clone)]
pub enum SettingsEvent {
    Close,
    ModelConfigurationChanged,
    /// Remove the project from the open history (`onUnlinkWorkspace`).
    ForgetProject(PathBuf),
}
pub struct SettingsWorkspaceSurface {
    pub preferences: Entity<PreferencesStore>,
    pub root: Option<PathBuf>,
    pub dark_override: Option<bool>,
    pub(super) page: Page,
    pub(super) models: Entity<crate::features::model_connections::ModelConnections>,
    pub(super) agents: Entity<crate::features::agent_settings::AgentSettings>,
    pub(super) repository: Entity<RepositorySettings>,
    pub(super) patterns: Entity<crate::ui::form_input::TextInput>,
    /// Transient "Copied" feedback keyed by the copied control.
    pub(super) copied: Option<(SharedString, std::time::Instant)>,
    /// Host Server draft of `.puppyone/config.json`, the saved document it
    /// was derived from, and its branch fields.
    pub(super) hosting_draft: super::workspace_config::WorkspaceConfig,
    pub(super) hosting_base: Option<super::workspace_config::WorkspaceConfig>,
    pub(super) hosting_branch: Entity<crate::ui::form_input::TextInput>,
    pub(super) hosting_backup_branch: Entity<crate::ui::form_input::TextInput>,
    /// The page scroller and whether its content overflowed at the last
    /// layout: product scrollbars then reserve their 12px gutter.
    content_scroll: ScrollHandle,
    content_overflows: bool,
    /// Screenshot-only page request, applied once the page becomes available
    /// (project pages wait for the asynchronously opened folder).
    capture_page: Option<Page>,
}
impl EventEmitter<SettingsEvent> for SettingsWorkspaceSurface {}
impl SettingsWorkspaceSurface {
    pub fn select_page(&mut self, page: Page, cx: &mut Context<Self>) {
        self.page = page;
        if matches!(page, Page::Git | Page::Host) {
            self.repository.update(cx, |r, cx| r.refresh(cx));
        }
        cx.notify();
    }
    pub fn new(
        preferences: Entity<PreferencesStore>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.subscribe(&preferences, |s, _, _: &PreferencesChanged, cx| {
            s.sync_patterns(cx);
            cx.notify()
        })
        .detach();
        cx.observe(&preferences, |_, _, cx| cx.notify()).detach();
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
            cx.new(|cx| {
                crate::features::agent_settings::AgentSettings::new(preferences, window, cx)
            })
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
        let mut s = Self {
            preferences,
            root: None,
            dark_override: Some(true),
            page: Page::General,
            models,
            agents,
            repository,
            patterns,
            copied: None,
            hosting_draft: Default::default(),
            hosting_base: None,
            hosting_branch: cx
                .new(|cx| crate::ui::form_input::TextInput::new("", false, 200, window, cx)),
            hosting_backup_branch: cx
                .new(|cx| crate::ui::form_input::TextInput::new("", false, 200, window, cx)),
            content_scroll: ScrollHandle::new(),
            content_overflows: false,
            capture_page: None,
        };
        s.sync_patterns(cx);
        // Screenshot-only hook for visual review of a specific page.
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
            && let Ok(name) = std::env::var("PUPPYONE_CAPTURE_SETTINGS_PAGE")
        {
            use super::sidebar::settings_sidebar_model::groups;
            let all = Visibility {
                local_workspace: true,
                other_app_imports: true,
            };
            if let Some(item) = groups(all)
                .into_iter()
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
        self.agents.update(cx, |a, _| a.lab_fixture());
        self.set_root(Some(root), cx);
        self.select_page(page, cx);
        self.repository
            .update(cx, |r, cx| r.lab_fixture(with_remotes, cx));
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
    pub(super) fn dark(&self) -> bool {
        self.dark_override.unwrap_or(true)
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
        let t = Theme::new(self.dark());
        // `grid-template-columns: clamp(164px, 24vw, 196px)` of the window width.
        let width = (f32::from(window.viewport_size().width) * 0.24).clamp(164., 196.);
        if let Some(page) = self.capture_page
            && available(page, self.visibility(cx))
        {
            self.capture_page = None;
            self.select_page(page, cx);
        }
        if !available(self.page, self.visibility(cx)) {
            self.page = Page::General;
        }
        let content = if !self.preferences.read(cx).loaded {
            super::components::section(tr(self.page.title()), t)
                .child(super::components::muted_row(tr("settings.git.reading"), t))
        } else {
            self.page_content(window, cx)
        };
        let mut content = content;
        if let Some(error) = &self.preferences.read(cx).error {
            content = content
                .child(super::components::danger_row(error.clone(), t))
                .child(
                    crate::ui::action_button(
                        "retry-preferences",
                        tr("common.action.retry"),
                        Some("rotate-ccw"),
                        crate::ui::Tone::Default,
                        false,
                        t,
                    )
                    .on_click(
                        cx.listener(|s, _, _, cx| s.preferences.update(cx, |p, cx| p.retry(cx))),
                    ),
                )
        }
        column()
            .size_full()
            .bg(t.canvas)
            .font_weight(FontWeight::NORMAL)
            .text_color(t.text)
            .child(
                row()
                    .relative()
                    .h(px(metric::CHROME_HEIGHT))
                    .flex_shrink_0()
                    .pl(px(10.))
                    .pr(px(6.))
                    .gap(px(6.))
                    .bg(t.header)
                    .child(
                        div()
                            .size(px(20.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(icon_sized("settings", 15., t.muted)),
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
                        div()
                            .id("settings-close")
                            .w(px(theme::control()))
                            .h(px(theme::control_compact()))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                            .text_color(t.muted)
                            .hover(move |s| s.bg(t.hover).text_color(t.text))
                            .cursor(theme::clickable_cursor())
                            .tooltip(crate::ui::tooltip(tr("common.action.close")))
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(SettingsEvent::Close)))
                            .child(
                                svg()
                                    .path("icons/dialog-close.svg")
                                    .size(px(14.))
                                    .text_color(t.muted),
                            ),
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
                row()
                    .flex_1()
                    .min_h_0()
                    .items_start()
                    .child(self.sidebar(width, cx))
                    .child(
                        column()
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
                            }),
                    ),
            )
    }
}
