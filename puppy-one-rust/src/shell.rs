use crate::{
    documents::{ClientMessage, Documents, Intent},
    geometry::Rect,
    localization::Locale,
    model::Tree,
    theme::{self, Layout, Theme},
    ui::{self, column, row},
    wake::Wake,
};
use gpui::{prelude::*, *};
use std::{cell::RefCell, path::PathBuf, rc::Rc};
#[path = "create_new_ui.rs"]
mod create_new_ui;
#[path = "explorer_ui.rs"]
mod explorer_ui;
#[path = "header_ui.rs"]
mod header_ui;
#[path = "home_ui.rs"]
mod home_ui;
#[path = "project_ui.rs"]
mod project_ui;
#[path = "task_ui.rs"]
mod task_ui;
use explorer_ui::{ExplorerMenu, FileClipboard, FileOp, GitMark, OpOutcome};
use task_ui::TaskUi;
/// Anchored popovers owned by the shell, each with a known rectangle.
#[derive(Clone, Debug, PartialEq)]
pub enum Popover {
    Project,
    Location,
    Explorer(ExplorerMenu),
}
/// Last painted bounds of popover triggers, keyed by trigger name.
pub type Anchors = Rc<RefCell<std::collections::HashMap<&'static str, Bounds<Pixels>>>>;
#[derive(Clone, PartialEq, serde::Deserialize, Action)]
#[action(no_json)]
pub struct HostAction {
    pub name: String,
}
impl HostAction {
    pub fn new(name: &str) -> Self {
        Self { name: name.into() }
    }
}
pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        for (key, action) in [
            ("b", "toggle-explorer"),
            ("j", "toggle-right"),
            (",", "settings"),
            ("o", "open-folder"),
            ("s", "save"),
            ("w", "close-file"),
            ("q", "quit"),
        ] {
            cx.bind_keys([KeyBinding::new(
                &format!("{modifier}-{key}"),
                HostAction::new(action),
                None,
            )]);
        }
    }
    cx.bind_keys([KeyBinding::new("escape", HostAction::new("escape"), None)]);
}
/// Native menu bar in the current locale; rebuilt when the locale changes.
pub fn app_menus() -> Vec<Menu> {
    use crate::localization::t as tr;
    vec![
        Menu {
            disabled: false,
            name: "PuppyOne".into(),
            items: vec![
                MenuItem::action(tr("native.menu.settings"), HostAction::new("settings")),
                MenuItem::separator(),
                MenuItem::action(tr("native.menu.quit"), HostAction::new("quit")),
            ],
        },
        Menu {
            disabled: false,
            name: tr("native.menu.file").into(),
            items: vec![
                MenuItem::action(
                    tr("shell.workspaceSwitcher.openFolder"),
                    HostAction::new("open-folder"),
                ),
                MenuItem::action(tr("native.menu.reload"), HostAction::new("reload")),
                MenuItem::action(tr("native.menu.closeFile"), HostAction::new("close-file")),
            ],
        },
        ui::input::edit_menu(|id| tr(&format!("native.menu.edit.{id}")).into()),
        crate::native_editor::format_menu(|id| tr(&format!("native.menu.format.{id}")).into()),
        Menu {
            disabled: false,
            name: tr("native.menu.view").into(),
            items: vec![MenuItem::action(
                tr("native.menu.toggleSource"),
                HostAction::new("preview"),
            )],
        },
    ]
}
pub struct Shell {
    tree: Tree,
    project: String,
    dark: bool,
    locale: Locale,
    left_open: bool,
    right_open: bool,
    left_width: f32,
    right_width: f32,
    rail: bool,
    settings: bool,
    help: bool,
    changes: bool,
    workbench: Entity<crate::features::workbench::Workbench>,
    source_control: Entity<crate::features::source_control::SourceControl>,
    confirm_quit: bool,
    popover: Option<Popover>,
    /// Homepage requested from the project menu (`goToHomepage`).
    home: bool,
    anchors: Anchors,
    recent_projects: Vec<crate::features::settings::preference_types::RecentProject>,
    weak: WeakEntity<Shell>,
    explorer_focus: FocusHandle,
    clipboard: Option<FileClipboard>,
    file_op: Option<std::sync::mpsc::Receiver<OpOutcome>>,
    queued_op: Option<FileOp>,
    reopen: Option<PathBuf>,
    rename: Option<(PathBuf, Entity<ui::form_input::TextInput>)>,
    git_marks: std::collections::HashMap<PathBuf, GitMark>,
    create_entry:
        Option<Entity<crate::features::create_new::create_entry_dialog::CreateEntryDialog>>,
    task_ui: TaskUi,
    preferences: Entity<crate::features::settings::preferences_store::PreferencesStore>,
    error: Option<String>,
    pending: bool,
    files: Documents,
    native: Entity<crate::editor::host::DocumentEditor>,
    fixture: bool,
    startup_file: Option<PathBuf>,
    wake: Wake,
    focus: FocusHandle,
    project_focus: FocusHandle,
    modal_focus: FocusHandle,
    scroll: UniformListScrollHandle,
    captured: bool,
    drag: Option<bool>,
    layout: Layout,
    #[cfg(test)]
    painted_rows: usize,
    #[cfg(test)]
    frames: usize,
}
fn at(r: Rect) -> Div {
    div()
        .absolute()
        .left(px(r.x))
        .top(px(r.y))
        .w(px(r.w))
        .h(px(r.h))
}
impl Shell {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (wake, rx) = Wake::channel();
        let fixture = cfg!(test)
            || std::env::var_os("PUPPYONE_FIXTURE").is_some()
            || std::env::var_os("PUPPYONE_SCREENSHOT").is_some();
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let weak = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            weak.update(cx, |s, cx| {
                if s.files.allow_quit
                    && s.preferences.read(cx).drained()
                    && !s.create_entry.as_ref().is_some_and(|f| f.read(cx).busy())
                {
                    true
                } else {
                    s.command("quit", window, cx);
                    false
                }
            })
            .unwrap_or(true)
        });
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, w, cx| {
                        let before = (
                            s.files.presentation_key(),
                            s.tree.rows.len(),
                            s.project.clone(),
                        );
                        s.receive(w, cx);
                        let after = (
                            s.files.presentation_key(),
                            s.tree.rows.len(),
                            s.project.clone(),
                        );
                        if before != after {
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        let preferences = cx.new(|cx| {
            if fixture {
                crate::features::settings::preferences_store::PreferencesStore::memory()
            } else {
                crate::features::settings::preferences_store::PreferencesStore::new(cx)
            }
        });
        let mut s = Self {
            tree: if fixture {
                Tree::fixture()
            } else {
                Tree::new()
            },
            project: if fixture {
                "puppyone".into()
            } else {
                String::new()
            },
            dark: std::env::var("PUPPYONE_THEME").as_deref() != Ok("light"),
            locale: Locale::default(),
            left_open: true,
            right_open: std::env::var("PUPPYONE_RIGHT").as_deref() == Ok("1"),
            left_width: theme::SIDEBAR,
            right_width: 360.,
            rail: false,
            settings: std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("settings"),
            help: std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("feedback"),
            changes: std::env::var("PUPPYONE_CAPTURE_SURFACE").as_deref() == Ok("changes"),
            workbench: cx.new(|cx| crate::features::workbench::Workbench::new(window, cx)),
            source_control: cx
                .new(|cx| crate::features::source_control::SourceControl::new(window, cx)),
            confirm_quit: false,
            popover: None,
            home: false,
            anchors: Rc::new(RefCell::new(Default::default())),
            recent_projects: vec![],
            weak: cx.weak_entity(),
            explorer_focus: cx.focus_handle(),
            clipboard: None,
            file_op: None,
            queued_op: None,
            reopen: None,
            rename: None,
            git_marks: Default::default(),
            create_entry: None,
            task_ui: TaskUi::new(preferences.clone(), window, cx),
            preferences,
            error: None,
            pending: false,
            files: Documents::default(),
            native: cx.new(crate::editor::host::DocumentEditor::new),
            fixture,
            startup_file: if cfg!(test) {
                None
            } else {
                std::env::var_os("PUPPYONE_FILE").map(PathBuf::from)
            },
            wake,
            focus,
            project_focus: cx.focus_handle(),
            modal_focus: cx.focus_handle(),
            scroll: UniformListScrollHandle::new(),
            captured: false,
            drag: None,
            layout: Layout::new(1280., 800., 220., 0., 0.),
            #[cfg(test)]
            painted_rows: 0,
            #[cfg(test)]
            frames: 0,
        };
        cx.subscribe_in(
            &s.preferences,
            window,
            |s, _, _: &crate::features::settings::preferences_store::PreferencesChanged, w, cx| {
                s.apply_preferences(w, cx);
            },
        )
        .detach();
        cx.observe_window_appearance(window, |s, w, cx| s.apply_preferences(w, cx))
            .detach();
        cx.observe(&s.preferences, |s, _, cx| {
            s.wake.notify();
            cx.notify()
        })
        .detach();
        cx.subscribe_in(&s.task_ui.settings, window, |s, _, event, w, cx| {
            use crate::features::settings::SettingsEvent;
            match event {
                SettingsEvent::Close => s.close_tasks(w, cx),
                SettingsEvent::ModelConfigurationChanged => s
                    .workbench
                    .update(cx, |s, cx| s.reload_agent_configuration(cx)),
                SettingsEvent::ForgetProject(path) => {
                    let path = path.clone();
                    s.preferences
                        .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
                    s.close_tasks(w, cx);
                    if s.files.workspace.as_ref().is_some_and(|ws| ws.path == path) {
                        s.command("home", w, cx);
                    }
                }
            }
            cx.notify();
        })
        .detach();
        cx.subscribe_in(
            &s.workbench,
            window,
            |s, _, event: &crate::features::workbench::WorkbenchEvent, w, cx| match event {
                crate::features::workbench::WorkbenchEvent::OpenModelConnections => {
                    s.task_ui.settings.update(cx, |settings, cx| {
                        settings.select_page(crate::features::settings::Page::ModelConnections, cx)
                    });
                    s.command("settings", w, cx);
                }
            },
        )
        .detach();
        cx.observe(&s.source_control, |s, sc, cx| {
            s.git_marks = explorer_ui::git_marks(sc.read(cx).snapshot.as_ref());
            cx.notify()
        })
        .detach();
        cx.subscribe_in(&s.native, window, |s, _, event, window, cx| {
            // Pane menu commands (open in default app, close) are the shell's.
            if let ClientMessage::Action { action } = event {
                s.command(action, window, cx);
                return;
            }
            s.files.client(event.clone(), &s.wake);
            cx.notify();
        })
        .detach();
        cx.subscribe_in(&s.task_ui.message, window, |_, _, event, _, cx| {
            if matches!(event, ui::form_input::InputEvent::Changed) {
                cx.notify();
            }
        })
        .detach();
        let mut args = if cfg!(test) {
            vec![]
        } else {
            std::env::args_os().skip(1).collect::<Vec<_>>()
        }
        .into_iter();
        let mut workspace = if cfg!(test) {
            None
        } else {
            std::env::var_os("PUPPYONE_WORKSPACE").map(PathBuf::from)
        };
        while let Some(arg) = args.next() {
            if arg == "--workspace" {
                workspace = args.next().map(PathBuf::from);
            } else if arg == "--file" {
                s.startup_file = args.next().map(PathBuf::from);
            } else if !arg.to_string_lossy().starts_with('-') && workspace.is_none() {
                workspace = Some(PathBuf::from(arg));
            } else {
                s.error = Some(crate::localization::t("native.usage").into());
            }
        }
        #[cfg(feature = "dev-capture")]
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
            let surface = std::env::var("PUPPYONE_CAPTURE_SURFACE").unwrap_or_default();
            if surface == "changes" {
                s.right_open = true;
            }
            if surface == "agent-empty"
                || surface == "agent-transcript"
                || surface == "agent-failed"
            {
                s.right_open = true;
                s.workbench.update(cx, |workbench, cx| {
                    workbench.visual_fixture(surface == "agent-transcript", window, cx)
                });
            }
        }
        if let Some(path) = workspace {
            s.files.begin(Intent::OpenFolder(path), &s.wake);
        }
        s
    }
    /// Project persisted appearance/locale preferences onto the process-wide
    /// theme, type scale and catalog. `System` follows the window appearance.
    fn apply_preferences(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use crate::features::settings::preference_types::ThemeMode;
        let p = self.preferences.read(cx).state.clone();
        self.dark = match p.theme_mode {
            ThemeMode::Dark => true,
            ThemeMode::Light => false,
            ThemeMode::System => matches!(
                window.appearance(),
                WindowAppearance::Dark | WindowAppearance::VibrantDark
            ),
        };
        // Captures pin the appearance (`PUPPYONE_THEME=light|dark`).
        if let Ok(theme) = std::env::var("PUPPYONE_THEME")
            && std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
        {
            self.dark = theme != "light";
        }
        let mut scale = p.text_scale;
        // Captures pin the text size (`PUPPYONE_TEXT_SCALE=small|medium|large`).
        if std::env::var_os("PUPPYONE_SCREENSHOT").is_some() {
            match std::env::var("PUPPYONE_TEXT_SCALE").as_deref() {
                Ok("small") => scale = crate::typography::Scale::Small,
                Ok("large") => scale = crate::typography::Scale::Large,
                Ok("medium") => scale = crate::typography::Scale::Medium,
                _ => {}
            }
        }
        theme::set_scale(scale);
        theme::set_pack(&p.theme_pack);
        theme::set_pointer_cursors(p.pointer_cursors);
        let visibility = crate::model::Visibility {
            show_hidden: p.files.show_hidden_files,
            patterns: p.files.exclude_patterns.clone(),
        };
        if self.tree.visibility != visibility {
            self.tree.visibility = visibility;
            self.tree.rebuild();
        }
        self.recent_projects = p.recent_projects.clone();
        let hidden = p.local_agents.hidden_agent_ids.clone();
        let loading = p.loading_animation.clone();
        self.workbench
            .update(cx, |w, cx| w.set_preferences(hidden, loading, cx));
        let (layout, icons) = (p.git_sidebar_layout, p.file_icon_theme.clone());
        self.source_control
            .update(cx, |s, cx| s.set_presentation(layout, icons, cx));
        self.rail = p.project_switcher_rail;
        let code = crate::localization::resolve_preference(
            &p.locale,
            crate::platform::environment::system_languages(),
        );
        crate::localization::set_current(code);
        if self.locale.set(code) {
            cx.set_menus(app_menus());
        }
        cx.notify();
    }
    fn modal(&self) -> bool {
        self.rename.is_some()
            || self.create_entry.is_some()
            || self.settings
            || self.help
            || self.confirm_quit
            || self.error.is_some()
            || self.files.error.is_some()
    }
    fn pick_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.pending || self.files.busy() {
            return;
        }
        self.pending = true;
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(crate::localization::t("onboarding.action.openLocalFolder").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = prompt.await;
            let _ = this.update_in(cx, |s, w, cx| {
                s.pending = false;
                match result {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            s.files.begin(Intent::OpenFolder(path), &s.wake);
                        }
                    }
                    Ok(Err(e)) => s.error = Some(e.to_string()),
                    Err(e) => s.error = Some(e.to_string()),
                    _ => {}
                }
                s.receive(w, cx);
                cx.notify();
            });
        })
        .detach();
    }
    pub fn command(&mut self, action: &str, window: &mut Window, cx: &mut Context<Self>) {
        if action == "quit" && self.workbench.read(cx).has_running(cx) {
            self.confirm_quit = true;
            self.focus.focus(window, cx);
            cx.notify();
            return;
        }
        if action == "quit-with-processes" {
            self.confirm_quit = false;
            self.files.begin(Intent::Quit, &self.wake);
            self.receive(window, cx);
            cx.notify();
            return;
        }
        if action == "cancel-process-quit" {
            self.confirm_quit = false;
            cx.notify();
            return;
        }
        if self.create_entry.is_some() && matches!(action, "close-file" | "escape") {
            if self
                .create_entry
                .as_ref()
                .is_some_and(|e| e.read(cx).busy())
            {
                return;
            }
            self.create_entry = None;
            self.focus.focus(window, cx);
            cx.notify();
            return;
        }
        if self.settings || self.help {
            match action {
                "close-file" | "escape" => {
                    self.close_tasks(window, cx);
                }
                "settings" => {
                    if self.help {
                        self.task_ui.clear(cx);
                    }
                    self.help = false;
                    self.settings = !self.settings;
                    self.focus.focus(window, cx);
                }
                "quit" => self.files.begin(Intent::Quit, &self.wake),
                _ => {}
            }
            self.receive(window, cx);
            cx.notify();
            return;
        }
        match action {
            "undo" | "redo" => {
                if !self.modal()
                    && !self.files.busy()
                    && let Some(doc) = &self.files.document
                {
                    self.files
                        .outgoing
                        .push(serde_json::json!({"kind":"history","id":doc.id,"direction":action}));
                }
            }
            "save" => self.files.begin(Intent::Save, &self.wake),
            "reload" => self.files.begin(Intent::Reload, &self.wake),
            "close-file" => self.files.begin(Intent::CloseFile, &self.wake),
            // Pane menu "Open in default app" (`EditorPaneActionsMenu`).
            "open-external" => {
                if let (Some(ws), Some(doc)) = (&self.files.workspace, &self.files.document) {
                    match ws.absolute(&doc.relative) {
                        Ok(path) => {
                            if let Err(e) = crate::platform::desktop::open(&path) {
                                self.error = Some(e);
                            }
                        }
                        Err(e) => self.error = Some(e),
                    }
                }
            }
            "quit" => self.files.begin(Intent::Quit, &self.wake),
            "open-folder" => self.pick_workspace(window, cx),
            "toggle-explorer" => self.left_open = !self.left_open,
            "toggle-right" => {
                self.right_open = self.changes || !self.right_open;
                self.changes = false;
            }
            "settings" => {
                self.popover = None;
                self.settings = true;
                self.modal_focus.focus(window, cx);
            }
            "feedback" => {
                self.popover = None;
                self.help = true;
                self.task_ui.message.focus_handle(cx).focus(window, cx);
            }
            "project-menu" => {
                self.popover = if self.popover == Some(Popover::Project) {
                    None
                } else {
                    Some(Popover::Project)
                };
                self.project_focus.focus(window, cx);
            }
            "location-menu" => {
                self.popover = if self.popover == Some(Popover::Location) {
                    None
                } else {
                    Some(Popover::Location)
                };
            }
            "home" => {
                self.popover = None;
                self.home = true;
            }
            "dismiss-popovers" => self.popover = None,
            "escape" => {
                if self.rename.is_some() {
                    self.rename = None;
                    self.focus.focus(window, cx);
                } else if self.popover.is_some() {
                    let header = matches!(self.popover, Some(Popover::Project | Popover::Location));
                    self.popover = None;
                    if header {
                        self.project_focus.focus(window, cx);
                    }
                } else if self.confirm_quit {
                    self.confirm_quit = false;
                } else if self.error.is_some() || self.files.error.is_some() {
                    self.error = None;
                    self.files.error = None;
                }
            }
            "preview" => {
                if !self.files.busy() && !self.modal() {
                    self.native
                        .update(cx, |s, cx| s.command("source", window, cx));
                }
            }
            "clear-error" => {
                self.error = None;
                self.files.error = None;
            }
            "changes" => {
                if self.files.workspace.is_none() {
                    return;
                }
                self.right_open = !self.right_open || !self.changes;
                self.changes = self.right_open;
                if self.changes {
                    self.source_control.update(cx, |s, cx| s.refresh(cx));
                }
                self.focus.focus(window, cx);
            }
            _ => {}
        }
        self.receive(window, cx);
        cx.notify();
    }
    fn close_tasks(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.help {
            self.task_ui.clear(cx);
        }
        self.settings = false;
        self.help = false;
        self.focus.focus(window, cx);
    }
    fn receive(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let previous = self.files.document.as_ref().map(|d| d.id.clone());
        self.files.poll(&self.wake);
        self.poll_file_ops(window, cx);
        if let Some(nodes) = self.files.tree_update.take() {
            let ws = self.files.workspace.as_ref().unwrap();
            let root = ws.path.clone();
            self.workbench
                .update(cx, |s, cx| s.set_workspace(root.clone(), cx));
            self.source_control
                .update(cx, |s, cx| s.set_workspace(root, cx));
            self.project = ws
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let visibility = self.tree.visibility.clone();
            self.tree = Tree {
                roots: nodes,
                visibility,
                ..Tree::new()
            };
            self.tree.rebuild();
            self.scroll = UniformListScrollHandle::new();
            self.fixture = false;
            self.error = None;
            self.home = false;
            self.clipboard = None;
            let opened = ws.path.clone();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or_default();
            if !cfg!(test) {
                self.preferences.update(cx, |p, cx| {
                    p.change(|p| p.remember_project(&opened, now), cx)
                });
            }
        }
        if let Some((path, result)) = self.files.children_update.take() {
            match result {
                Ok(nodes) => self.tree.attach_children(&path, nodes),
                Err(e) => self.tree.fail_children(&path, e),
            }
        }
        if let Some(doc) = &self.files.document
            && previous.as_ref() != Some(&doc.id)
        {
            self.tree.selected = doc.relative.clone();
        }
        if self.files.workspace.is_some()
            && !self.files.busy()
            && let Some(path) = self.startup_file.take()
        {
            self.files.begin(Intent::OpenFile(path), &self.wake);
        }
        self.sync_editor(window, cx);
        if self.files.allow_quit
            && self
                .create_entry
                .as_ref()
                .is_some_and(|f| f.read(cx).busy())
        {
            return;
        }
        if self.files.allow_quit && !self.preferences.read(cx).drained() {
            if let Some(error) = &self.preferences.read(cx).error {
                self.error = Some(error.clone());
                self.files.allow_quit = false;
            }
            return;
        }
        if self.files.allow_quit {
            self.workbench.update(cx, |s, cx| s.shutdown(cx));
            window.remove_window();
        }
    }
    fn sync_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mut focus_native = false;
        // Snapshot -> open -> loaded -> thaw settle synchronously with the
        // native editor; a few rounds cover replies that queue new messages.
        for _ in 0..4 {
            if self.files.outgoing.is_empty() {
                break;
            }
            let messages = std::mem::take(&mut self.files.outgoing);
            for message in messages {
                focus_native |= message["kind"] == "open";
                let replies = self
                    .native
                    .update(cx, |s, cx| s.receive(&message, window, cx));
                for reply in replies {
                    self.files.client(reply, &self.wake);
                }
            }
        }
        let modal = self.modal();
        let home = self.home_visible();
        self.native.update(cx, |s, cx| {
            s.gate(modal || home || self.files.busy(), self.dark, cx)
        });
        if focus_native && !modal && !self.files.busy() {
            self.native
                .update(cx, |editor, cx| editor.focus_document(window, cx));
        }
    }
    fn open_row(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if self.pending || self.files.busy() || self.files.folder_busy {
            return;
        }
        let Some(item) = self.tree.rows.get(index).cloned() else {
            return;
        };
        self.tree.selected = item.path.clone();
        if item.folder {
            if self.tree.toggle(&item.path) {
                self.files.load_children(item.path, &self.wake);
            }
        } else if !self.fixture {
            self.files.begin(Intent::OpenFile(item.path), &self.wake);
        }
        self.receive(window, cx);
        cx.notify();
    }
    /// Switch to a remembered project (`onSelectProject`).
    pub(super) fn open_project(
        &mut self,
        path: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.popover = None;
        if self
            .files
            .workspace
            .as_ref()
            .is_some_and(|ws| ws.path == path)
        {
            self.home = false;
        } else if !self.pending && !self.files.busy() {
            self.files.begin(Intent::OpenFolder(path), &self.wake);
        }
        self.receive(window, cx);
        cx.notify();
    }
    fn editor(&self, _: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let r = self.layout.editor;
        let mut content = at(r);
        if self.files.document.is_some() {
            let body = self.layout.content();
            content = content.bg(t.canvas).child(
                at(Rect::new(body.x - r.x, body.y - r.y, body.w, body.h))
                    .child(self.native.clone()),
            );
        } else {
            // A project with no open document shows the quiet editor canvas.
            content = content.bg(t.canvas);
        }
        content
    }
    /// Compact `ProjectSwitcherRail`: one mark per remembered project.
    fn project_rail(&self, h: f32, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let current = self.files.workspace.as_ref().map(|ws| ws.path.clone());
        let mut rail = at(Rect::new(0., theme::HEADER, 56., h - theme::HEADER))
            .bg(t.sidebar)
            .border_r_1()
            .border_color(t.sidebar_divider)
            .flex()
            .flex_col()
            .items_center()
            .pt(px(12.))
            .gap(px(6.));
        for (index, project) in self.recent_projects.iter().take(12).enumerate() {
            let active = current.as_ref() == Some(&project.path);
            let initial = project
                .name
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            let path = project.path.clone();
            rail = rail.child(
                gpui_kit::base::Button::new(("rail-project", index))
                    .accessibility_label(crate::localization::tf(
                        "shell.workspaceSwitcher.projectTitle",
                        &[("project", project.name.clone().into())],
                    ))
                    .selected(active)
                    .size(px(theme::control()))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(8.))
                    .border_1()
                    .border_color(if active {
                        t.border_strong
                    } else {
                        t.border_subtle
                    })
                    .bg(if active { t.selected } else { t.control })
                    .text_size(px(theme::ty().ui.label))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if active { t.text } else { t.muted })
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover))
                    .tooltip(ui::tooltip(project.name.clone()))
                    .child(initial)
                    .on_click(cx.listener(move |s, _, w, cx| s.open_project(path.clone(), w, cx))),
            );
        }
        rail.child(
            ui::labelled_icon_button(
                "rail-plus",
                "plus",
                crate::localization::t("shell.workspaceSwitcher.addProject"),
                t,
            )
            .size(px(theme::control()))
            .on_click(cx.listener(|s, _, w, cx| s.command("open-folder", w, cx))),
        )
    }
    /// `.po-pane-edge-resize-handle` + `.po-pane-edge-chrome`: an 8px
    /// transparent hit lane whose only paint is the 1px divider, plus the
    /// adjacent hover / active stroke (and ring while dragging).
    fn sash(&self, left: bool, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = Theme::new(self.dark);
        let x = if left {
            self.layout.editor.x
        } else {
            self.layout.auxiliary.x
        };
        let resizing = self.drag == Some(left);
        let group = SharedString::from(if left { "left-sash" } else { "right-sash" });
        let hover = theme::mix(t.focus, t.divider, 0.55);
        at(Rect::new(
            x,
            self.layout.editor.y,
            theme::metric::PANE_SASH,
            self.layout.editor.h,
        ))
        .id(group.clone())
        .group(group.clone())
        .cursor(CursorStyle::ResizeLeftRight)
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                if e.click_count == 2 {
                    if left {
                        s.left_open = false;
                    } else {
                        s.right_open = false;
                    }
                } else {
                    s.drag = Some(left);
                }
                cx.notify();
            }),
        )
        .child(
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left_0()
                .w(px(1.))
                .bg(t.sidebar_divider),
        )
        .child(
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left(px(1.))
                .w(px(1.))
                .when(resizing, |d| {
                    d.bg(t.focus).shadow(vec![BoxShadow {
                        inset: false,
                        color: theme::alpha(t.focus, 0.24).into(),
                        offset: point(px(0.), px(0.)),
                        blur_radius: px(0.),
                        spread_radius: px(1.),
                    }])
                })
                .when(!resizing, |d| d.group_hover(group, move |s| s.bg(hover))),
        )
        .into_element()
    }
}
impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(test)]
        {
            self.frames += 1;
            self.painted_rows = 0;
        }
        theme::sync_kit(self.dark, window, cx);
        let size = window.viewport_size();
        let w = f32::from(size.width);
        let h = f32::from(size.height);
        self.layout = Layout::new(
            w,
            h,
            if self.left_open { self.left_width } else { 0. },
            if self.right_open {
                self.right_width
            } else {
                0.
            },
            if self.rail { 56. } else { 0. },
        );
        self.sync_editor(window, cx);
        if !self.captured
            && let Some(path) = std::env::var_os("PUPPYONE_SCREENSHOT")
        {
            self.captured = true;
            let rect = |r: Rect| [r.x, r.y, r.w, r.h];
            let geometry = serde_json::json!({"framework":"GPUI","header":rect(self.layout.header),"explorer":rect(self.layout.explorer),"footer":rect(self.layout.footer),"editor":rect(self.layout.editor),"auxiliary":rect(self.layout.auxiliary),"pixelsPerPoint":window.scale_factor()});
            if let Err(error) = crate::capture::schedule(window, cx, PathBuf::from(path), geometry)
            {
                self.error = Some(error.to_string());
            }
        }
        let t = Theme::new(self.dark);
        let mut root = div()
            .id("gpui-shell")
            .relative()
            .size_full()
            .font_family("Geist")
            .font_weight(FontWeight::NORMAL)
            .text_size(px(theme::font_size(theme::FONT)))
            .text_color(t.text)
            .track_focus(&self.focus)
            .on_action(cx.listener(|s, a: &HostAction, w, cx| s.command(&a.name, w, cx)))
            .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                if let Some(left) = s.drag {
                    let x = f32::from(e.position.x);
                    if left {
                        s.left_width = (x - if s.rail { 56. } else { 0. }).clamp(160., 480.);
                    } else {
                        s.right_width = (s.layout.header.w - x).clamp(240., 640.);
                    }
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|s, _, _, cx| {
                    if s.drag.take().is_some() {
                        cx.notify();
                    }
                }),
            )
            .child(self.editor(cx));
        let home = self.home_visible();
        if home {
            root = root.child(self.home_view(cx));
        }
        if self.left_open && !home {
            root = root.child(self.explorer(cx)).child(self.footer(cx));
        }
        if self.right_open && !home {
            self.workbench.update(cx, |s, _| s.dark = self.dark);
            self.source_control.update(cx, |s, _| s.dark = self.dark);
            root = root.child(
                at(self.layout.auxiliary)
                    .bg(t.auxiliary())
                    .pl(px(theme::metric::PANE_SASH))
                    .child(if self.changes {
                        self.source_control.clone().into_any_element()
                    } else {
                        self.workbench.clone().into_any_element()
                    }),
            );
        }
        if self.rail && !home {
            root = root.child(self.project_rail(h, cx));
        }
        root = root.child(self.header(cx));
        if self.left_open && !home {
            root = root.child(self.sash(true, cx));
        }
        if self.right_open && !home {
            root = root.child(self.sash(false, cx));
        }
        match &self.popover {
            Some(Popover::Explorer(menu)) => {
                let menu = menu.clone();
                root = root.child(self.explorer_popup(&menu, cx));
            }
            Some(_) => root = root.child(self.project_popup(cx)),
            None => {}
        }
        if self.rename.is_some() {
            root = root.child(self.rename_view(w, h, cx));
        }
        if self.create_entry.is_some() {
            root = root.child(self.create_entry_view(w, h, cx));
        }
        if self.settings {
            root = root.child(self.settings_view(w, h, cx));
        }
        if self.help {
            root = root.child(self.feedback_view(w, h, cx));
        }
        if self.confirm_quit {
            use crate::localization::t as tr;
            root = root.child(self.simple_modal(
                tr("native.quit.title"),
                tr("native.quit.detail"),
                vec![
                    (
                        tr("native.quit.cancel"),
                        "cancel-process-quit",
                        ui::Tone::Default,
                    ),
                    (
                        tr("native.quit.confirm"),
                        "quit-with-processes",
                        ui::Tone::Danger,
                    ),
                ],
                cx,
            ));
        }
        if let Some(error) = self.error.clone().or_else(|| self.files.error.clone()) {
            root = root.child(self.simple_modal(
                crate::localization::t("native.error.title"),
                &error,
                vec![(
                    crate::localization::t("common.action.close"),
                    "clear-error",
                    ui::Tone::Primary,
                )],
                cx,
            ));
        }
        root
    }
}

#[cfg(test)]
mod tests;
