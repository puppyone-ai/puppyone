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
    /// The Cloud project's name, for its card.
    pub project_name: String,
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

/// How an Agent reaches a Cloud project: by where it works, not by brand.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Handoff {
    /// ChatGPT, Claude: no computer of their own; a connector, not yet.
    Chat,
    /// Grok Bot, Manus, Muse: their own cloud computer runs the invite.
    #[default]
    Cloud,
    /// Viktor: lives in Slack, where the invite is sent to it.
    Team,
}
impl Handoff {
    const ALL: [Handoff; 3] = [Handoff::Chat, Handoff::Cloud, Handoff::Team];
    fn id(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Cloud => "cloud",
            Self::Team => "team",
        }
    }
    /// The README's marks of the Agents in this kind.
    fn logos(self) -> &'static [&'static str] {
        match self {
            Self::Chat => &["chatgpt", "claude"],
            Self::Cloud => &["grok", "manus", "muse"],
            Self::Team => &["viktor"],
        }
    }
    /// `(kind, who, how)` catalog keys.
    fn copy(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Chat => (
                "native.start.chatKind",
                "native.start.chatWho",
                "native.start.chatHow",
            ),
            Self::Cloud => (
                "native.start.cloudKind",
                "native.start.cloudWho",
                "native.start.cloudHow",
            ),
            Self::Team => (
                "native.start.teamKind",
                "native.start.teamWho",
                "native.start.teamHow",
            ),
        }
    }
    /// The invite works for Agents with a computer to run it on.
    fn ready(self) -> bool {
        self != Self::Chat
    }
}

const LOGO: f32 = 24.;
const LOGO_STEP: f32 = 19.;
/// Where a row's text starts: the widest logo stack and its gap.
const ROW_TEXT: f32 = 14. + LOGO + LOGO_STEP * 2. + 12.;

/// A kind's marks, each over the last on its white tile, in a box sized
/// for them (GPUI does not size a flex parent to negative-margin overlap).
fn logo_stack(logos: &[&str], ring: Rgba) -> Div {
    let width = LOGO + LOGO_STEP * 2.;
    div()
        .relative()
        .flex_none()
        .w(px(width))
        .h(px(LOGO))
        .children(logos.iter().enumerate().map(|(i, name)| {
            div()
                .absolute()
                .left(px(i as f32 * LOGO_STEP))
                .top_0()
                .size(px(LOGO))
                .rounded(px(7.))
                .overflow_hidden()
                .bg(theme::brand_disc_surface())
                .border_2()
                .border_color(ring)
                .child(
                    img(SharedString::from(format!("agents/handoff-{name}.png")))
                        .size_full()
                        .object_fit(ObjectFit::Cover),
                )
        }))
}

/// A quiet dot before a line of status.
fn dot(color: Rgba) -> Div {
    div().size(px(6.)).flex_none().rounded_full().bg(color)
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

    /// The empty Cloud project (`handoff-v4`): its card on the left, and
    /// one list on the right of the ways to hand it to an Agent, by where
    /// the Agent works. What follows a copy happens in the chosen row.
    fn render_cloud_empty(
        &self,
        takes_files: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        let card_fill = theme::mix(t.text, t.canvas, 0.035);
        // The project's card: its empty folder, its name, room for files.
        let ghost = theme::mix(t.text, t.canvas, 0.07);
        let (w, h) = (112., 84.);
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
        let card = v_flex()
            .w(px(232.))
            .flex_none()
            .items_center()
            .pt(px(30.))
            .pb(px(22.))
            .px(px(20.))
            .rounded(px(16.))
            .bg(card_fill)
            .border_1()
            .border_color(t.divider)
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
                    .mt(px(16.))
                    .max_w_full()
                    .truncate()
                    .text_size(px(ty.body))
                    .line_height(px(20.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(self.start.project_name.clone()),
            )
            .when(takes_files, |d| {
                d.child(
                    div()
                        .id("editor-start-drop")
                        .debug_selector(|| "editor-start-drop".into())
                        .mt(px(4.))
                        .text_size(px(ty.meta))
                        .line_height(px(17.))
                        .text_color(t.subtle)
                        .child(tr("native.start.cardEmpty")),
                )
            });
        let joined = match &self.start.invite {
            StartInvite::Joined(name) => Some(name.clone()),
            _ => None,
        };
        let (title, hint): (SharedString, SharedString) = match &joined {
            Some(name) => (
                tf("native.start.joinedTitle", &[("name", name.clone().into())]).into(),
                tr("native.start.joinedHint").into(),
            ),
            None => (
                tr("native.start.handTitle").into(),
                tr("native.start.handHint").into(),
            ),
        };
        let rows: Vec<AnyElement> = Handoff::ALL
            .iter()
            .enumerate()
            .map(|(i, kind)| self.handoff_row(*kind, i > 0, card_fill, t, cx))
            .collect();
        let list = v_flex()
            .id("editor-start-handoff")
            .debug_selector(|| "editor-start-handoff".into())
            .mt(px(16.))
            .w_full()
            .rounded(px(12.))
            .overflow_hidden()
            .bg(card_fill)
            .border_1()
            .border_color(t.divider)
            .children(rows);
        let right = v_flex()
            .w(px(440.))
            .flex_none()
            .child(
                div()
                    .text_size(px(ty.body))
                    .line_height(px(20.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .debug_selector({
                        let selector = if joined.is_some() {
                            "editor-start-joined"
                        } else {
                            "editor-start-title"
                        };
                        move || selector.into()
                    })
                    .child(title),
            )
            .child(
                div()
                    .mt(px(3.))
                    .text_size(px(ty.meta))
                    .line_height(px(17.))
                    .text_color(t.subtle)
                    .child(hint),
            )
            .child(list)
            .when_some(self.start.invite_alert, |d, key| {
                d.child(
                    div()
                        .mt(px(8.))
                        .text_size(px(ty.meta))
                        .text_color(t.danger)
                        .child(tr(key)),
                )
            });
        h_flex()
            .id("editor-start-empty")
            .debug_selector(|| "editor-start-empty".into())
            .mt(px(-18.))
            .gap(px(40.))
            .items_start()
            .child(card)
            .child(right)
            .into_any_element()
    }

    /// One way to hand the project over: the kind's marks, what it is and
    /// how it connects, and its action; the chosen row carries what
    /// follows the copy.
    fn handoff_row(
        &self,
        kind: Handoff,
        rule: bool,
        fill: Rgba,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        let invite = &self.start.invite;
        let busy = matches!(
            invite,
            StartInvite::Waiting | StartInvite::Knocking { .. } | StartInvite::Connecting(_)
        );
        let chosen = kind == self.handoff_pick && !matches!(invite, StartInvite::Give);
        let dim = busy && !chosen;
        let (kind_key, who_key, how_key) = kind.copy();
        let group = format!("editor-start-handoff-{}", kind.id());
        let trailing: AnyElement = if !kind.ready() {
            div().child(tr("native.start.soon")).into_any_element()
        } else if chosen && matches!(invite, StartInvite::Joined(_)) {
            h_flex()
                .gap(px(6.))
                .items_center()
                .text_color(t.success)
                .child(dot(t.success))
                .child(tr("native.start.joinedTag"))
                .into_any_element()
        } else if chosen && matches!(invite, StartInvite::Waiting) {
            div().child(tr("native.start.copied")).into_any_element()
        } else if chosen && busy {
            div().into_any_element()
        } else {
            div()
                .group_hover(SharedString::from(group.clone()), |d| {
                    d.text_color(t.accent)
                })
                .child(tr("native.agentInvite.copy"))
                .into_any_element()
        };
        let enabled = kind.ready() && !busy && !matches!(invite, StartInvite::Copying);
        let head = h_flex()
            .id(SharedString::from(group.clone()))
            .group(SharedString::from(group.clone()))
            .debug_selector({
                let selector = if kind == Handoff::Cloud {
                    "editor-start-copy-invite".to_owned()
                } else {
                    format!("editor-start-copy-invite:{}", kind.id())
                };
                move || selector.clone()
            })
            .h(px(64.))
            .px(px(14.))
            .gap(px(12.))
            .items_center()
            .child(logo_stack(kind.logos(), fill))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .child(
                        h_flex()
                            .gap(px(8.))
                            .items_baseline()
                            .child(
                                div()
                                    .text_size(px(ty.control))
                                    .line_height(px(18.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(tr(kind_key)),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(ty.meta))
                                    .text_color(t.subtle)
                                    .child(tr(who_key)),
                            ),
                    )
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .line_height(px(17.))
                            .text_color(t.subtle)
                            .child(tr(how_key)),
                    ),
            )
            .child(
                div()
                    .flex_none()
                    .text_size(px(ty.meta))
                    .text_color(t.subtle)
                    .child(trailing),
            )
            .when(enabled, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |d| d.bg(t.hover))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.handoff_pick = kind;
                        cx.emit(EditorEvent::CopyInvite);
                        cx.notify();
                    }))
            });
        let follow = chosen.then(|| self.handoff_follow(t, cx)).flatten();
        v_flex()
            .relative()
            .when(chosen && busy, |d| d.bg(theme::alpha(t.accent, 0.07)))
            .when(dim, |d| d.opacity(0.42))
            .when(rule, |d| {
                d.child(
                    div()
                        .absolute()
                        .top_0()
                        .left(px(ROW_TEXT))
                        .right_0()
                        .h(px(1.))
                        .bg(t.divider),
                )
            })
            .child(head)
            .children(follow)
            .when(!chosen || !busy, |d| d.bg(fill))
            .into_any_element()
    }

    /// What follows the copy, under the chosen row: the wait, the Agent
    /// asking to join (answered here), or the lapse.
    fn handoff_follow(&self, t: Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
        let ty = theme::ty().ui;
        let small = |text: SharedString| {
            div()
                .text_size(px(ty.meta))
                .line_height(px(17.))
                .text_color(t.subtle)
                .child(text)
        };
        let link = |id: &'static str, key: &'static str, cx: &mut Context<Self>| {
            div()
                .id(id)
                .debug_selector(move || id.into())
                .text_size(px(ty.meta))
                .text_color(t.muted)
                .cursor(theme::clickable_cursor())
                .hover(move |d| d.text_color(t.text))
                .child(tr(key))
                .on_click(cx.listener(|_, _, _, cx| cx.emit(EditorEvent::CopyInvite)))
        };
        let body: AnyElement = match &self.start.invite {
            StartInvite::Waiting => h_flex()
                .id("editor-start-waiting")
                .debug_selector(|| "editor-start-waiting".into())
                .gap(px(8.))
                .items_center()
                .child(dot(t.accent))
                .child(
                    div()
                        .flex_1()
                        .text_size(px(ty.meta))
                        .text_color(t.text)
                        .child(tr("native.start.pasteWait")),
                )
                .child(link(
                    "editor-start-copy-again",
                    "native.agentInvite.copyAgain",
                    cx,
                ))
                .into_any_element(),
            StartInvite::Lapsed => h_flex()
                .gap(px(8.))
                .items_center()
                .child(
                    div()
                        .flex_1()
                        .child(small(tr("native.agentInvite.lapsed").into())),
                )
                .child(link("editor-start-renew", "native.agentInvite.renew", cx))
                .into_any_element(),
            StartInvite::Connecting(name) => h_flex()
                .id("editor-start-connecting")
                .debug_selector(|| "editor-start-connecting".into())
                .gap(px(8.))
                .items_center()
                .child(dot(t.accent))
                .child(small(
                    tf(
                        "native.agentInvite.connecting",
                        &[("name", name.clone().into())],
                    )
                    .into(),
                ))
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
                h_flex()
                    .id("editor-start-knock")
                    .debug_selector(|| "editor-start-knock".into())
                    .gap(px(8.))
                    .items_center()
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(tf(
                                        "native.agentInvite.wants",
                                        &[("name", name.clone().into())],
                                    )),
                            )
                            .child(small(tr("native.start.access").into())),
                    )
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
                    )
                    .into_any_element()
            }
            _ => return None,
        };
        Some(
            div()
                .pl(px(ROW_TEXT))
                .pr(px(14.))
                .pb(px(14.))
                .child(body)
                .into_any_element(),
        )
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
