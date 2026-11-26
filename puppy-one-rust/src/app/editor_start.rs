//! What the single empty editor pane shows (`editor_workbench.rs`): for a
//! project with no files, its start list; for one with files but none open,
//! the recently opened ones. Both are the `+ New` menu's rows laid on the
//! canvas — the same file glyphs, labels, control height and hover — under a
//! one-line heading, in two text sizes and the canvas greys. A file kind's
//! row makes an `Untitled` file at once and opens it.
use super::editor_area::{EditorArea, EditorEvent};
use crate::{
    features::create_new::Entry,
    localization::{t as tr, tf},
    theme::{self, Theme, metric},
    ui::{
        agent_brand_mark::{AgentMark, brand_image},
        appearance::ActiveAppearance,
        components::{FileIcon, Icon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
use std::path::{Path, PathBuf};

/// One detected local Agent offered on the local empty-project start view.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct StartAgent {
    pub runtime_id: String,
    pub icon_key: &'static str,
    pub label: String,
}

/// Window state the empty editor pane reads without holding handles to Cloud
/// or the right sidebar.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct StartContext {
    pub hosted: bool,
    pub loading: bool,
    pub cloud_agents_manageable: bool,
    pub local_agents: Vec<StartAgent>,
}

fn kind_selector(entry: Entry) -> &'static str {
    match entry {
        Entry::Markdown => "md",
        Entry::Csv => "csv",
        Entry::Html => "html",
        Entry::Whiteboard => "whiteboard",
        Entry::ContextMap => "context-map",
        Entry::Text => "txt",
        Entry::Json => "json",
        Entry::Slides => "slides",
        Entry::App => "app",
        Entry::Puppyflow => "puppyflow",
        Entry::Folder => "folder",
        Entry::CustomFiles => "custom",
    }
}

/// The start list's width: a menu's, wide enough for its longest row.
const LIST_WIDTH: f32 = 340.;

/// A row in the `+ New` menu's grammar: an 18px glyph slot and a label at
/// control size and height, the hover fill, the control radius.
fn start_row(id: impl Into<ElementId>, selector: String, t: Theme) -> Stateful<Div> {
    h_flex()
        .id(id)
        .debug_selector(move || selector.clone())
        .w_full()
        .h(px(theme::control()))
        .px(px(metric::MENU_ITEM_PADDING_INLINE))
        .gap(px(metric::MENU_ITEM_GAP))
        .items_center()
        .rounded(px(metric::CONTROL_RADIUS))
        .text_size(px(theme::ty().ui.control))
        .line_height(px(18.))
        .text_color(t.text)
        .cursor(theme::clickable_cursor())
        .hover(move |d| d.bg(t.hover))
}

fn glyph_slot(glyph: impl IntoElement) -> Div {
    div()
        .size(px(metric::MENU_ICON_SLOT))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .child(glyph)
}

/// The list's one heading, level with the rows' glyphs.
fn heading(text: impl Into<SharedString>, t: Theme) -> Div {
    div()
        .px(px(metric::MENU_ITEM_PADDING_INLINE))
        .text_size(px(theme::ty().ui.control))
        .line_height(px(18.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.text)
        .child(text.into())
}

/// A quiet line at the secondary size.
fn note(text: impl Into<SharedString>, t: Theme) -> Div {
    div()
        .px(px(metric::MENU_ITEM_PADDING_INLINE))
        .text_size(px(theme::ty().ui.meta))
        .line_height(px(17.))
        .text_color(t.subtle)
        .child(text.into())
}

/// A menu separator, between kinds of rows.
fn separator(t: Theme) -> Div {
    div()
        .mx(px(metric::MENU_ITEM_PADDING_INLINE))
        .my(px(6.))
        .h(px(1.))
        .bg(t.divider)
}

impl EditorArea {
    /// Enabled file kinds from the `+ New` menu settings, in the user's
    /// configured order, excluding Folder / CustomFiles and unavailable kinds.
    fn start_kinds(&self, cx: &App) -> Vec<Entry> {
        let prefs = &self.preferences.read(cx).state;
        let (main, _) = prefs
            .create_new
            .visible(prefs.experimental.puppy_flow_files);
        main.into_iter()
            .filter(|e| !matches!(e, Entry::Folder | Entry::CustomFiles) && e.available())
            .collect()
    }

    /// Whether the empty-project start view is currently active and accepting
    /// file drops into the project root (suppresses the WB-21 split preview).
    pub(super) fn shows_empty_start(&self, cx: &App) -> bool {
        if self.file_mode {
            return false;
        }
        let docs = self.docs.read(cx);
        let split = docs
            .state()
            .is_some_and(|s| s.layout.root.panes().len() > 1);
        if split || docs.opened().is_some() || docs.awaiting_initial_open() {
            return false;
        }
        let explorer = self.explorer.read(cx);
        let listed = explorer.workspace().is_some();
        let rows = explorer.tree().rows.len();
        let loading = self.start.loading
            || (rows == 0 && (docs.folder_busy || docs.cloud_opening().is_some()));
        let takes_files = explorer
            .workspace()
            .is_some_and(|ws| ws.capabilities().import);
        rows == 0 && !loading && listed && takes_files
    }

    /// The start list for a project with no files (`rows == 0`), or the
    /// recently opened files for one with files and none open. It waits for
    /// the file list, so it never flashes while a project opens. An empty
    /// project's whole pane takes files dropped from outside.
    pub(super) fn start_view(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.file_mode {
            return None;
        }
        let docs = self.docs.read(cx);
        if docs.awaiting_initial_open() {
            return None;
        }
        let explorer = self.explorer.read(cx);
        let listed = explorer.workspace().is_some();
        let rows = explorer.tree().rows.len();
        let loading = self.start.loading
            || (rows == 0 && (docs.folder_busy || docs.cloud_opening().is_some()));
        if !listed || loading {
            return None;
        }
        let caps = explorer.capabilities();
        let t = cx.palette();
        let takes_files = rows == 0 && caps.import;
        let content = if rows == 0 {
            self.render_empty_project(caps.create, caps.import, t, cx)
        } else {
            self.render_no_open_file(caps.create, t, cx)
        };
        Some(
            div()
                .id("editor-start-view")
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .px(px(24.))
                .when(takes_files, |d| {
                    d.drag_over::<ExternalPaths>(move |d, _, _, _| d.bg(t.hover))
                        .on_drop(cx.listener(|s, paths: &ExternalPaths, _, cx| {
                            cx.stop_propagation();
                            s.drop = None;
                            cx.emit(EditorEvent::DropExternal(paths.paths().to_vec()));
                        }))
                })
                .child(content)
                .into_any_element(),
        )
    }

    /// One row per file kind of the `+ New` menu, each making its file.
    fn create_rows(&self, kinds: Vec<Entry>, t: Theme, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let icon_theme: SharedString = self
            .preferences
            .read(cx)
            .state
            .file_icon_theme
            .clone()
            .into();
        kinds
            .into_iter()
            .enumerate()
            .map(|(i, entry)| {
                let selector = format!("editor-start-create:{}", kind_selector(entry));
                start_row(("editor-start-create", i), selector, t)
                    .child(glyph_slot(FileIcon::file(
                        format!("x{}", entry.extension()),
                        icon_theme.clone(),
                    )))
                    .child(tr(entry.label_key()))
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(EditorEvent::StartCreate(entry));
                    }))
                    .into_any_element()
            })
            .collect()
    }

    fn render_empty_project(
        &self,
        can_create: bool,
        takes_files: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let list = v_flex()
            .w(px(LIST_WIDTH))
            .max_w_full()
            .mt(px(-40.))
            .child(heading(tr("native.start.emptyProject"), t));
        // Read-only project: the heading alone.
        if !can_create && !takes_files {
            return list
                .id("editor-start-readonly")
                .debug_selector(|| "editor-start-readonly".into())
                .into_any_element();
        }
        let hosted = self.start.hosted;
        let kinds = if can_create {
            self.start_kinds(cx)
        } else {
            Vec::new()
        };
        let creates = !kinds.is_empty();
        let rows = self.create_rows(kinds, t, cx);
        let agents = self.render_start_agents(hosted, t, cx);
        list.id("editor-start-empty")
            .debug_selector(|| "editor-start-empty".into())
            .when(creates, |d| {
                d.child(
                    note(tr("native.start.renameLater"), t)
                        .mt(px(2.))
                        .mb(px(10.)),
                )
            })
            .children(rows)
            .when_some(agents, |d, agents| d.child(separator(t)).child(agents))
            .when(takes_files, |d| {
                d.child(
                    note(
                        tr(if hosted {
                            "native.start.dropCloud"
                        } else {
                            "native.start.dropLocal"
                        }),
                        t,
                    )
                    .id("editor-start-drop")
                    .debug_selector(|| "editor-start-drop".into())
                    .mt(px(14.)),
                )
            })
            .into_any_element()
    }

    /// The Agent rows: a Cloud project's Add an agent, or this computer's
    /// detected Agents, each starting a chat in the right sidebar.
    fn render_start_agents(
        &self,
        hosted: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let frame = || {
            v_flex()
                .id("editor-start-agent-row")
                .debug_selector(|| "editor-start-agent-row".into())
                .w_full()
        };
        if hosted {
            return self.start.cloud_agents_manageable.then(|| {
                frame()
                    .child(
                        start_row(
                            "editor-start-invite-agent",
                            "editor-start-invite-agent".into(),
                            t,
                        )
                        .child(glyph_slot(
                            Icon::new("bot")
                                .with_size(px(15.))
                                .stroke(1.6)
                                .color(t.muted),
                        ))
                        .child(tr("native.start.addAgent"))
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(EditorEvent::InviteCloudAgent);
                        })),
                    )
                    .into_any_element()
            });
        }
        (!self.start.local_agents.is_empty()).then(|| {
            let rows = self
                .start
                .local_agents
                .iter()
                .take(3)
                .enumerate()
                .map(|(i, agent)| {
                    let runtime_id = agent.runtime_id.clone();
                    let mark: AnyElement = match AgentMark::from_icon_key(agent.icon_key) {
                        Some(mark) => brand_image(mark, t.dark, 16.)
                            .rounded(px(4.))
                            .into_any_element(),
                        None => Icon::new("bot")
                            .with_size(px(15.))
                            .color(t.muted)
                            .into_any_element(),
                    };
                    start_row(
                        ("editor-start-agent", i),
                        format!("editor-start-agent:{}", agent.runtime_id),
                        t,
                    )
                    .child(glyph_slot(mark))
                    .child(tf(
                        "native.start.askAgent",
                        &[("name", agent.label.clone().into())],
                    ))
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(EditorEvent::LaunchLocalAgent(runtime_id.clone()));
                    }))
                });
            frame().children(rows).into_any_element()
        })
    }

    fn render_no_open_file(
        &self,
        can_create: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        let icon_theme = self.preferences.read(cx).state.file_icon_theme.clone();
        let tree = self.explorer.read(cx).tree();
        // Up to 3 recent files, filtering out any removed from loaded tree dirs.
        let recent: Vec<PathBuf> = self
            .docs
            .read(cx)
            .recent_files()
            .into_iter()
            .filter(|path| {
                if tree.visibility.excluded(path) {
                    return false;
                }
                let parent = path.parent().unwrap_or(Path::new(""));
                match tree.loaded_children(parent) {
                    Some(children) => children.iter().any(|n| !n.folder && n.path == *path),
                    None => true,
                }
            })
            .take(3)
            .collect();
        let has_recent = !recent.is_empty();
        let recent_rows: Vec<AnyElement> = recent
            .into_iter()
            .enumerate()
            .map(|(i, path)| {
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.to_string_lossy().into_owned());
                let parent = path
                    .parent()
                    .filter(|p| !p.as_os_str().is_empty())
                    .map(|p| p.to_string_lossy().replace('\\', "/"));
                let open_path = path.clone();
                start_row(
                    ("editor-start-recent", i),
                    format!("editor-start-recent:{i}"),
                    t,
                )
                .child(glyph_slot(FileIcon::file(
                    file_name.clone(),
                    icon_theme.clone(),
                )))
                .child(div().min_w_0().truncate().child(file_name))
                .when_some(parent, |d, where_at| {
                    d.child(
                        div()
                            .ml_auto()
                            .flex_none()
                            .max_w(px(96.))
                            .truncate()
                            .text_size(px(ty.meta))
                            .text_color(t.subtle)
                            .child(where_at),
                    )
                })
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.emit(EditorEvent::OpenFile(open_path.clone()));
                }))
                .into_any_element()
            })
            .collect();
        let kinds = if can_create {
            self.start_kinds(cx)
        } else {
            Vec::new()
        };
        let creates = !kinds.is_empty();
        let create_rows = self.create_rows(kinds, t, cx);
        v_flex()
            .id("editor-start-closed")
            .debug_selector(|| "editor-start-closed".into())
            .w(px(LIST_WIDTH))
            .max_w_full()
            .mt(px(-40.))
            .child(heading(tr("native.start.noOpenFile"), t).mb(px(8.)))
            .when(has_recent, |d| {
                d.child(note(tr("native.start.recent"), t).mb(px(2.)))
                    .children(recent_rows)
            })
            .when(has_recent && creates, |d| d.child(separator(t)))
            .children(create_rows)
            .into_any_element()
    }
}
