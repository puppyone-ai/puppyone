//! What the single empty editor pane shows (`editor_workbench.rs`): for a
//! project with no files, its start list; for one with files but none open,
//! the recently opened ones. Both are the `+ New` menu's rows laid on the
//! canvas — the same file glyphs, labels, control height and hover — under a
//! one-line heading, in two text sizes and the canvas greys. A file kind's
//! row makes an `Untitled` file at once and opens it.
use super::editor_area::{EditorArea, EditorEvent};
use crate::{
    features::{
        cloud::{CloudAgents, CopyStatus, InvitePhase},
        create_new::Entry,
    },
    localization::{t as tr, tf},
    theme::{self, Theme, metric},
    ui::{
        agent_brand_mark::{AgentMark, brand_image},
        agent_brands,
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, FileIcon, Icon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
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
    /// Where handing a Cloud project to an Agent stands.
    pub invite: StartInvite,
    /// What went wrong copying or answering, as a catalog key.
    pub invite_alert: Option<&'static str>,
}

/// The empty Cloud project's hand-off, as the Agents' invite stands.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) enum StartInvite {
    /// Nothing copied yet.
    #[default]
    Give,
    /// The invite is being made.
    Copying,
    /// The message is out; no Agent has asked yet.
    Waiting,
    /// The message lapsed with nobody asking.
    Lapsed,
    /// An Agent asks to join.
    Knocking {
        request: String,
        name: String,
        deciding: bool,
    },
    /// Let in, not connected yet.
    Connecting(String),
    /// In the project: the hand-off is done.
    Joined(String),
}
impl StartInvite {
    pub(super) fn of(agents: &CloudAgents) -> Self {
        let joined = || {
            agents
                .joined()
                .map(|a| a.agent.name.clone())
                .unwrap_or_default()
        };
        match agents.invite_phase() {
            InvitePhase::Joined => Self::Joined(joined()),
            InvitePhase::Connecting => Self::Connecting(joined()),
            InvitePhase::Knocking => {
                agents
                    .requests
                    .first()
                    .map_or(Self::Waiting, |r| Self::Knocking {
                        request: r.id.clone(),
                        name: r.name.clone(),
                        deciding: agents.deciding.contains(&r.id),
                    })
            }
            InvitePhase::Waiting => Self::Waiting,
            InvitePhase::Give if agents.copy == CopyStatus::Copying => Self::Copying,
            // An Agent already in the project ends the hand-off, whenever
            // it came.
            InvitePhase::Give | InvitePhase::Lapsed if !agents.agents.is_empty() => Self::Joined(
                agents
                    .agents
                    .iter()
                    .find(|a| a.active)
                    .or(agents.agents.first())
                    .map(|a| a.agent.name.clone())
                    .unwrap_or_default(),
            ),
            InvitePhase::Give => Self::Give,
            InvitePhase::Lapsed => Self::Lapsed,
        }
    }
}
/// A failed copy or answer, said under the hand-off.
pub(super) fn invite_alert(agents: &CloudAgents) -> Option<&'static str> {
    match agents.copy {
        CopyStatus::Failed => Some("cloud.share.agent.failed"),
        CopyStatus::NotOwner => Some("cloud.share.agent.notOwner"),
        _ => agents
            .decision_failed
            .then_some("cloud.share.agent.changeFailed"),
    }
}

/// The cloud Agents a Cloud project is handed to (the README's table).
const HANDOFF_BRANDS: [&str; 6] = ["chatgpt", "claude", "grok-bot", "manus", "muse", "viktor"];
const MARK: f32 = 24.;
const MARK_STEP: f32 = 17.;

/// The marks side by side, each over the last, in a box sized for them:
/// overlapping children made with negative margins do not size their flex
/// parent in GPUI, so each is placed absolutely. Every mark sits on the
/// same white disc (most are drawn for white), a ring of canvas between
/// neighbours; full-bleed artwork fills its disc.
fn brand_stack(t: Theme) -> Div {
    let brands: Vec<_> = HANDOFF_BRANDS
        .iter()
        .filter_map(|id| agent_brands::get(id))
        .collect();
    let width = MARK + MARK_STEP * (brands.len().max(1) - 1) as f32;
    div()
        .relative()
        .flex_none()
        .w(px(width))
        .h(px(MARK))
        .children(brands.into_iter().enumerate().map(|(i, brand)| {
            let fills = agent_brands::tile(brand) || matches!(brand.id, "muse" | "viktor");
            let mark: AnyElement = if fills {
                agent_brands::artwork(brand, false, MARK)
                    .rounded_full()
                    .into_any_element()
            } else if brand.id == "claude" {
                // Claude's own orange mark, as on the README, not Claude Code's.
                img("agents/claude.png")
                    .size(px(MARK * 0.86))
                    .flex_none()
                    .into_any_element()
            } else if let Some(path) = agent_brands::monochrome(brand) {
                svg()
                    .path(path)
                    .size(px(MARK * 0.58))
                    .text_color(theme::brand_disc_ink())
                    .into_any_element()
            } else {
                agent_brands::artwork(brand, false, MARK * 0.62 * brand.scale).into_any_element()
            };
            div()
                .absolute()
                .left(px(i as f32 * MARK_STEP - 1.5))
                .top(px(-1.5))
                .size(px(MARK + 3.))
                .rounded_full()
                .bg(t.canvas)
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .size(px(MARK))
                        .rounded_full()
                        .overflow_hidden()
                        .bg(theme::brand_disc_surface())
                        .border_1()
                        .border_color(theme::alpha(t.text, 0.12))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(mark),
                )
        }))
}

/// `Copy message` with the Agents it works with: the prompt itself stays
/// out of sight.
fn handoff_pill(label: impl Into<SharedString>, enabled: bool, t: Theme) -> Stateful<Div> {
    h_flex()
        .id("editor-start-copy-invite")
        .debug_selector(|| "editor-start-copy-invite".into())
        .h(px(38.))
        .pl(px(7.))
        .pr(px(16.))
        .gap(px(10.))
        .items_center()
        .rounded(px(19.))
        .border_1()
        .border_color(t.divider)
        .bg(t.canvas)
        .text_size(px(theme::ty().ui.control))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.text)
        .when(enabled, |d| {
            d.cursor(theme::clickable_cursor())
                .hover(move |d| d.bg(t.hover))
        })
        .when(!enabled, |d| d.opacity(0.6))
        .child(brand_stack(t))
        .child(label.into())
}

/// One quiet status line in the hand-off: a dot in `dot`, then the text.
fn status_line(text: impl Into<SharedString>, dot: Rgba, t: Theme) -> Div {
    h_flex()
        .gap(px(8.))
        .items_center()
        .text_size(px(theme::ty().ui.control))
        .line_height(px(18.))
        .text_color(t.text)
        .child(div().size(px(7.)).flex_none().rounded_full().bg(dot))
        .child(text.into())
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
        self.empty_start_visible(cx)
            && self
                .explorer
                .read(cx)
                .workspace()
                .is_some_and(|ws| ws.capabilities().import)
    }

    /// Whether the empty Cloud project's hand-off is on screen, answering
    /// the Agents' requests in place of the Header.
    pub(super) fn shows_cloud_handoff(&self, cx: &App) -> bool {
        self.start.hosted && self.start.cloud_agents_manageable && self.empty_start_visible(cx)
    }

    /// The empty-project start view is on screen.
    fn empty_start_visible(&self, cx: &App) -> bool {
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
        rows == 0 && !loading && listed
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
        if hosted && self.start.cloud_agents_manageable {
            return self.render_cloud_empty(takes_files, t, cx);
        }
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

    /// The local Agent rows: this computer's detected Agents, each starting
    /// a chat in the right sidebar. A Cloud project has its hand-off instead.
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
            return None;
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

    /// The empty Cloud project as drawn in the onboarding mockup: the
    /// project's empty folder (the Home folder's outline, flat and faint),
    /// one title and one line, the hand-off, then the drop hint, all
    /// centred.
    fn render_cloud_empty(
        &self,
        takes_files: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        let ghost = theme::mix(t.text, t.canvas, 0.065);
        let (w, h) = (84., 63.);
        let layer = |path: &'static str| {
            svg()
                .path(path)
                .absolute()
                .top_0()
                .left_0()
                .w(px(w))
                .h(px(h))
                .text_color(ghost)
        };
        v_flex()
            .id("editor-start-empty")
            .debug_selector(|| "editor-start-empty".into())
            .mt(px(-30.))
            .items_center()
            .child(
                div()
                    .relative()
                    .w(px(w))
                    .h(px(h))
                    .child(layer("home/folder-back.svg"))
                    .child(layer("home/folder-front.svg")),
            )
            .child(
                div()
                    .mt(px(18.))
                    .text_size(px(ty.body))
                    .line_height(px(20.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(tr("native.start.handTitle")),
            )
            // Once an Agent is let in, how to bring one is said.
            .when(
                !matches!(
                    self.start.invite,
                    StartInvite::Connecting(_) | StartInvite::Joined(_)
                ),
                |d| {
                    d.child(
                        div()
                            .mt(px(4.))
                            .text_size(px(ty.meta))
                            .line_height(px(18.))
                            .text_color(t.subtle)
                            .child(tr("native.agentInvite.sendHint")),
                    )
                },
            )
            .child(self.render_handoff(t, cx))
            .when(takes_files, |d| {
                d.child(
                    div()
                        .id("editor-start-drop")
                        .debug_selector(|| "editor-start-drop".into())
                        .mt(px(18.))
                        .text_size(px(ty.meta))
                        .line_height(px(17.))
                        .text_color(t.subtle)
                        .child(tr("native.start.dropCloud")),
                )
            })
            .into_any_element()
    }

    /// The empty Cloud project's hand-off, in place: `Copy message` with the
    /// Agents it works with, then the wait, the Agent asking to join and
    /// answered here, and the Agent in. Letting it in ends the onboarding;
    /// its first file ends this view.
    fn render_handoff(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let copy = |key: &'static str, cx: &mut Context<Self>| {
            handoff_pill(tr(key), true, t).on_click(cx.listener(|_, _, _, cx| {
                cx.emit(EditorEvent::CopyInvite);
            }))
        };
        let body: AnyElement = match &self.start.invite {
            StartInvite::Give => copy("native.agentInvite.copy", cx).into_any_element(),
            StartInvite::Copying => {
                handoff_pill(tr("native.agentInvite.copy"), false, t).into_any_element()
            }
            StartInvite::Waiting => v_flex()
                .gap(px(12.))
                .items_center()
                .child(copy("native.agentInvite.copyAgain", cx))
                .child(
                    v_flex()
                        .id("editor-start-waiting")
                        .debug_selector(|| "editor-start-waiting".into())
                        .gap(px(2.))
                        .items_center()
                        .child(status_line(tr("native.agentInvite.paste"), t.accent, t))
                        .child(
                            div()
                                .pl(px(15.))
                                .child(note(tr("native.agentInvite.waiting"), t).px_0()),
                        ),
                )
                .into_any_element(),
            StartInvite::Lapsed => v_flex()
                .gap(px(10.))
                .items_center()
                .child(note(tr("native.agentInvite.lapsed"), t).px_0())
                .child(copy("native.agentInvite.renew", cx))
                .into_any_element(),
            StartInvite::Knocking {
                request,
                name,
                deciding,
            } => {
                let answer = |allow: bool, request: String| {
                    cx.listener(move |_, _, _, cx| {
                        cx.emit(EditorEvent::AnswerAgent {
                            request: request.clone(),
                            allow,
                        });
                    })
                };
                v_flex()
                    .id("editor-start-knock")
                    .debug_selector(|| "editor-start-knock".into())
                    .w(px(380.))
                    .p(px(12.))
                    .rounded(px(10.))
                    .bg(theme::alpha(t.accent, 0.08))
                    .border_1()
                    .border_color(theme::alpha(t.accent, 0.35))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.control))
                            .line_height(px(18.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tf(
                                "native.agentInvite.wants",
                                &[("name", name.clone().into())],
                            )),
                    )
                    .child(note(tr("native.agentInvite.access"), t).px_0().mt(px(2.)))
                    .child(
                        h_flex()
                            .mt(px(10.))
                            .justify_end()
                            .gap(px(8.))
                            .child(
                                Button::new("editor-start-deny")
                                    .debug_selector(|| "editor-start-deny".into())
                                    .variant(ButtonVariant::Ghost)
                                    .label(tr("cloud.share.agent.request.deny"))
                                    .disabled(*deciding)
                                    .on_click(answer(false, request.clone())),
                            )
                            .child(
                                Button::new("editor-start-allow")
                                    .debug_selector(|| "editor-start-allow".into())
                                    .variant(ButtonVariant::FilledPrimary)
                                    .label(tr("native.agentInvite.letIn"))
                                    .disabled(*deciding)
                                    .on_click(answer(true, request.clone())),
                            ),
                    )
                    .into_any_element()
            }
            StartInvite::Connecting(name) => v_flex()
                .id("editor-start-connecting")
                .debug_selector(|| "editor-start-connecting".into())
                .gap(px(2.))
                .items_center()
                .child(status_line(
                    tf(
                        "native.agentInvite.connecting",
                        &[("name", name.clone().into())],
                    ),
                    t.accent,
                    t,
                ))
                .child(
                    div()
                        .pl(px(15.))
                        .child(note(tr("native.agentInvite.connectingHint"), t).px_0()),
                )
                .into_any_element(),
            StartInvite::Joined(name) => v_flex()
                .id("editor-start-joined")
                .debug_selector(|| "editor-start-joined".into())
                .gap(px(2.))
                .items_center()
                .child(status_line(
                    tf(
                        "native.agentInvite.joined",
                        &[("name", name.clone().into())],
                    ),
                    t.success,
                    t,
                ))
                .child(
                    div()
                        .pl(px(15.))
                        .child(note(tr("native.start.joinedHint"), t).px_0()),
                )
                .into_any_element(),
        };
        v_flex()
            .id("editor-start-handoff")
            .debug_selector(|| "editor-start-handoff".into())
            .mt(px(20.))
            .items_center()
            .child(body)
            .when_some(self.start.invite_alert, |d, key| {
                d.child(
                    div()
                        .mt(px(8.))
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(tr(key)),
                )
            })
            .into_any_element()
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
