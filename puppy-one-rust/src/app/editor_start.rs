//! Empty-project start view (Scheme B) and quiet no-open-file list (Scheme A)
//! rendered inside the single empty editor pane (`editor_workbench.rs`).
//!
//! Only two text sizes (`ty.meta` 13px and `ty.caption` 12px) and the canvas
//! grey palette are used — no accent colours or badges.
use super::{
    editor_area::{EditorArea, EditorEvent},
    file_sheet::{self, SheetKind},
};
use crate::{
    features::create_new::Entry,
    localization::t as tr,
    theme::{self, Theme},
    ui::{
        agent_brand_mark::{AgentMark, brand_image},
        appearance::ActiveAppearance,
        components::{FileIcon, Icon, tooltip},
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

/// Compact extension caption shown beside the tile's kind label (omitted for
/// long extensions like `.excalidraw`, matching the reference).
fn tile_extension(entry: Entry) -> Option<&'static str> {
    match entry {
        Entry::Markdown | Entry::Csv | Entry::Html | Entry::Text | Entry::Json => {
            Some(entry.extension())
        }
        _ => None,
    }
}

fn mini_icon(entry: Entry) -> &'static str {
    match entry {
        Entry::Markdown | Entry::Text => "file-text",
        Entry::Csv => "table-2",
        Entry::Html | Entry::Json => "code-xml",
        Entry::Whiteboard => "pencil",
        Entry::ContextMap => "context-map-canvas",
        Entry::Puppyflow => "workflow",
        _ => "file",
    }
}

fn chip_surface(t: Theme) -> Div {
    h_flex()
        .h(px(26.))
        .pl(px(6.))
        .pr(px(10.))
        .gap(px(6.))
        .items_center()
        .rounded(px(13.))
        .bg(t.canvas)
        .border_1()
        .border_color(t.divider)
        .text_size(px(theme::ty().ui.meta))
        .line_height(px(18.))
        .text_color(t.text)
        .cursor(theme::clickable_cursor())
        .hover(move |d| d.bg(t.hover))
}

fn agent_row_frame(label: &'static str, t: Theme) -> Stateful<Div> {
    h_flex()
        .id("editor-start-agent-row")
        .debug_selector(|| "editor-start-agent-row".into())
        .mt(px(18.))
        .items_center()
        .justify_center()
        .gap(px(8.))
        .flex_wrap()
        .text_size(px(theme::ty().ui.caption))
        .line_height(px(17.))
        .text_color(t.subtle)
        .child(tr(label))
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

    /// Renders either the empty-project start view (when `rows == 0`) or the
    /// quiet no-open-file list (when `rows > 0`), waiting until the file list
    /// has arrived so the view never flashes during project entry.
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
                .child(content)
                .into_any_element(),
        )
    }

    fn render_empty_project(
        &self,
        can_create: bool,
        takes_files: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        // Read-only project: one quiet sentence, no buttons.
        if !can_create && !takes_files {
            return div()
                .id("editor-start-readonly")
                .debug_selector(|| "editor-start-readonly".into())
                .mt(px(-24.))
                .text_size(px(ty.meta))
                .line_height(px(19.))
                .text_color(t.subtle)
                .child(tr("native.start.emptyProject"))
                .into_any_element();
        }
        let hosted = self.start.hosted;
        let kinds = if can_create {
            self.start_kinds(cx)
        } else {
            Vec::new()
        };
        let tiles = (!kinds.is_empty()).then(|| {
            h_flex()
                .mt(px(18.))
                .gap(px(14.))
                .flex_wrap()
                .justify_center()
                .children(kinds.into_iter().enumerate().map(|(i, entry)| {
                    let group = format!("editor-start-tile-{i}");
                    let selector = format!("editor-start-create:{}", kind_selector(entry));
                    let ext = tile_extension(entry);
                    v_flex()
                        .id(("editor-start-tile", i))
                        .debug_selector(move || selector.clone())
                        .group(group.clone())
                        .min_w(px(112.))
                        .px(px(8.))
                        .pt(px(12.))
                        .pb(px(10.))
                        .items_center()
                        .gap(px(9.))
                        .rounded(px(10.))
                        .text_size(px(ty.meta))
                        .line_height(px(18.))
                        .text_color(t.muted)
                        .cursor(theme::clickable_cursor())
                        .hover(move |d| d.bg(t.hover).text_color(t.text))
                        .child(file_sheet::render_start_sheet(
                            SheetKind::from(entry),
                            &group,
                            t,
                        ))
                        .child(
                            h_flex()
                                .items_baseline()
                                .gap(px(3.))
                                .child(tr(entry.label_key()))
                                .when_some(ext, |d, ext| {
                                    d.child(
                                        div()
                                            .text_size(px(ty.caption))
                                            .text_color(t.subtle)
                                            .child(ext),
                                    )
                                }),
                        )
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(EditorEvent::StartCreate(entry));
                        }))
                }))
        });

        let drop_zone = takes_files.then(|| {
            let border = theme::alpha(t.text, if t.dark { 0.24 } else { 0.22 });
            let border_active = theme::alpha(t.text, if t.dark { 0.46 } else { 0.42 });
            h_flex()
                .id("editor-start-drop")
                .debug_selector(|| "editor-start-drop".into())
                .mt(px(14.))
                .w(px(488.))
                .max_w_full()
                .h(px(44.))
                .px(px(14.))
                .items_center()
                .justify_center()
                .gap(px(8.))
                .rounded(px(10.))
                .border_1()
                .border_dashed()
                .border_color(border)
                .text_size(px(ty.meta))
                .line_height(px(18.))
                .text_color(t.muted)
                .hover(move |d| d.bg(t.hover).text_color(t.text))
                .drag_over::<ExternalPaths>(move |d, _, _, _| {
                    d.bg(t.hover).border_color(border_active)
                })
                .on_drop(cx.listener(|s, paths: &ExternalPaths, _, cx| {
                    cx.stop_propagation();
                    s.drop = None;
                    cx.emit(EditorEvent::DropExternal(paths.paths().to_vec()));
                }))
                .child(
                    Icon::new("download")
                        .with_size(px(15.))
                        .stroke(1.6)
                        .color(t.subtle),
                )
                .child(tr(if hosted {
                    "native.start.dropCloud"
                } else {
                    "native.start.dropLocal"
                }))
        });

        let agent_row = self.render_start_agent_row(hosted, t, cx);

        v_flex()
            .id("editor-start-empty")
            .debug_selector(|| "editor-start-empty".into())
            .mt(px(-24.))
            .items_center()
            .child(
                div()
                    .text_size(px(ty.meta))
                    .line_height(px(19.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tr("native.start.heading")),
            )
            .child(
                div()
                    .mt(px(2.))
                    .text_size(px(ty.caption))
                    .line_height(px(17.))
                    .text_color(t.subtle)
                    .child(tr(if hosted {
                        "native.start.subtitleCloud"
                    } else {
                        "native.start.subtitleLocal"
                    })),
            )
            .children(tiles)
            .children(drop_zone)
            .children(agent_row)
            .into_any_element()
    }

    fn render_start_agent_row(
        &self,
        hosted: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if hosted {
            return self.start.cloud_agents_manageable.then(|| {
                agent_row_frame("native.start.agentCloud", t)
                    .child(
                        chip_surface(t)
                            .id("editor-start-invite-agent")
                            .debug_selector(|| "editor-start-invite-agent".into())
                            .child(
                                div()
                                    .size(px(16.))
                                    .flex_none()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded(px(4.))
                                    .border_1()
                                    .border_dashed()
                                    .border_color(t.subtle)
                                    .text_color(t.subtle)
                                    .child(Icon::new("plus").with_size(px(10.)).stroke(2.)),
                            )
                            .child(tr("native.start.addAgent"))
                            .on_click(cx.listener(|_, _, _, cx| {
                                cx.emit(EditorEvent::InviteCloudAgent);
                            })),
                    )
                    .into_any_element()
            });
        }
        (!self.start.local_agents.is_empty()).then(|| {
            let chips = self
                .start
                .local_agents
                .iter()
                .enumerate()
                .map(|(i, agent)| {
                    let runtime_id = agent.runtime_id.clone();
                    let selector = format!("editor-start-agent:{}", agent.runtime_id);
                    let icon: AnyElement = match AgentMark::from_icon_key(agent.icon_key) {
                        Some(mark) => brand_image(mark, t.dark, 16.)
                            .rounded(px(4.))
                            .into_any_element(),
                        None => Icon::new("bot")
                            .with_size(px(14.))
                            .color(t.muted)
                            .into_any_element(),
                    };
                    chip_surface(t)
                        .id(("editor-start-agent", i))
                        .debug_selector(move || selector.clone())
                        .child(icon)
                        .child(agent.label.clone())
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(EditorEvent::LaunchLocalAgent(runtime_id.clone()));
                        }))
                });
            agent_row_frame("native.start.agentLocal", t)
                .children(chips)
                .into_any_element()
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

        let recent_section = (!recent.is_empty()).then(|| {
            v_flex()
                .mt(px(12.))
                .w(px(300.))
                .max_w_full()
                .gap(px(1.))
                .child(
                    div()
                        .px(px(12.))
                        .pb(px(4.))
                        .text_size(px(ty.caption))
                        .line_height(px(17.))
                        .text_color(t.subtle)
                        .child(tr("native.start.recent")),
                )
                .children(recent.into_iter().enumerate().map(|(i, path)| {
                    let file_name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| path.to_string_lossy().into_owned());
                    let parent = path
                        .parent()
                        .filter(|p| !p.as_os_str().is_empty())
                        .map(|p| p.to_string_lossy().replace('\\', "/"));
                    let selector = format!("editor-start-recent:{i}");
                    let open_path = path.clone();
                    h_flex()
                        .id(("editor-start-recent", i))
                        .debug_selector(move || selector.clone())
                        .h(px(30.))
                        .px(px(12.))
                        .gap(px(9.))
                        .items_center()
                        .rounded(px(7.))
                        .text_size(px(ty.meta))
                        .line_height(px(18.))
                        .text_color(t.text)
                        .cursor(theme::clickable_cursor())
                        .hover(move |d| d.bg(t.hover))
                        .child(FileIcon::file(file_name.clone(), icon_theme.clone()))
                        .child(div().min_w_0().truncate().child(file_name))
                        .when_some(parent, |d, where_at| {
                            d.child(
                                div()
                                    .ml_auto()
                                    .flex_none()
                                    .max_w(px(120.))
                                    .truncate()
                                    .text_size(px(ty.caption))
                                    .text_color(t.subtle)
                                    .child(where_at),
                            )
                        })
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(EditorEvent::OpenFile(open_path.clone()));
                        }))
                }))
        });

        let kinds = if can_create {
            self.start_kinds(cx)
        } else {
            Vec::new()
        };
        let or_new = (!kinds.is_empty()).then(|| {
            h_flex()
                .mt(px(14.))
                .items_center()
                .gap(px(8.))
                .text_size(px(ty.caption))
                .line_height(px(17.))
                .text_color(t.subtle)
                .child(tr("native.start.orNew"))
                .child(
                    h_flex()
                        .gap(px(6.))
                        .children(kinds.into_iter().enumerate().map(|(i, entry)| {
                            let selector =
                                format!("editor-start-mini-create:{}", kind_selector(entry));
                            let label = tr(entry.label_key());
                            div()
                                .id(("editor-start-mini", i))
                                .debug_selector(move || selector.clone())
                                .size(px(30.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(px(7.))
                                .text_color(t.subtle)
                                .cursor(theme::clickable_cursor())
                                .hover(move |d| d.bg(t.hover).text_color(t.text))
                                .tooltip(tooltip(label))
                                .child(Icon::new(mini_icon(entry)).with_size(px(16.)).stroke(1.6))
                                .on_click(cx.listener(move |_, _, _, cx| {
                                    cx.emit(EditorEvent::StartCreate(entry));
                                }))
                        })),
                )
        });

        v_flex()
            .id("editor-start-closed")
            .debug_selector(|| "editor-start-closed".into())
            .mt(px(-40.))
            .items_center()
            .child(
                div()
                    .text_size(px(ty.meta))
                    .line_height(px(19.))
                    .text_color(t.subtle)
                    .child(tr("native.start.noOpenFile")),
            )
            .children(recent_section)
            .children(or_new)
            .into_any_element()
    }
}
