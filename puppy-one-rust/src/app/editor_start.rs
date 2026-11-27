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

/// The Agents the first card names, as the README draws them.
const HAVE_LOGOS: [&str; 5] = ["claude", "manus", "grok", "muse", "viktor"];
/// Where the second card's Agent would live.
const GROUP_LOGOS: [&str; 3] = ["slack", "feishu", "wecom"];
const LOGO: f32 = 32.;
const CARD_WIDTH: f32 = 266.;

/// Marks side by side, each over the last, in a box sized for them (GPUI
/// does not size a flex parent to negative-margin overlap). `paths` are
/// asset paths; each mark sits on a white tile ringed in `ring`.
fn logo_stack(paths: &[String], step: f32, ring: Rgba) -> Div {
    let width = LOGO + step * (paths.len().max(1) - 1) as f32;
    div()
        .relative()
        .flex_none()
        .w(px(width))
        .h(px(LOGO))
        .children(paths.iter().enumerate().map(|(i, path)| {
            div()
                .absolute()
                .left(px(i as f32 * step))
                .top_0()
                .size(px(LOGO))
                .rounded(px(9.))
                .overflow_hidden()
                .bg(theme::brand_disc_surface())
                .border_2()
                .border_color(ring)
                .flex()
                .items_center()
                .justify_center()
                .child(
                    img(SharedString::from(path.clone()))
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

    /// The empty Cloud project (`handoff-options` E): one question — do
    /// you already have an Agent? — and two cards. Yes: copy the message
    /// and give it to that Agent; the wait, its asking to join (answered
    /// here) and its arrival follow under the cards. No: make one in your
    /// team's chat, with this project in it (not yet).
    fn render_cloud_empty(
        &self,
        takes_files: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        let fill = theme::mix(t.text, t.canvas, 0.035);
        let invite = &self.start.invite;
        let busy = matches!(
            invite,
            StartInvite::Waiting | StartInvite::Knocking { .. } | StartInvite::Connecting(_)
        );
        let joined = match invite {
            StartInvite::Joined(name) => Some(name.clone()),
            _ => None,
        };
        let (title, ask): (SharedString, SharedString) = match &joined {
            Some(name) => (
                tf("native.start.joinedTitle", &[("name", name.clone().into())]).into(),
                tr("native.start.joinedHint").into(),
            ),
            None => (
                tr("native.start.handTitle").into(),
                tr("native.start.handAsk").into(),
            ),
        };
        let card = |active: bool| {
            v_flex()
                .w(px(CARD_WIDTH))
                .flex_none()
                .min_h(px(214.))
                .pt(px(18.))
                .px(px(16.))
                .pb(px(14.))
                .rounded(px(14.))
                .bg(fill)
                .border_1()
                .border_color(if active {
                    theme::alpha(t.accent, 0.9)
                } else {
                    t.divider
                })
        };
        let card_title = |key: &'static str| {
            div()
                .mt(px(16.))
                .text_size(px(ty.control))
                .line_height(px(18.))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(t.text)
                .child(tr(key))
        };
        let card_how = |key: &'static str| {
            div()
                .mt(px(8.))
                .flex_1()
                .text_size(px(ty.meta))
                .line_height(px(18.))
                .text_color(t.muted)
                .child(tr(key))
        };
        // Yes: the message, and where it stands.
        let copy = |key: &'static str, cx: &mut Context<Self>| {
            Button::new("editor-start-copy-invite")
                .debug_selector(|| "editor-start-copy-invite".into())
                .variant(ButtonVariant::FilledPrimary)
                .icon(Icon::new("copy").stroke(1.75))
                .label(tr(key))
                .w_full()
                .on_click(cx.listener(|_, _, _, cx| cx.emit(EditorEvent::CopyInvite)))
                .into_any_element()
        };
        let quiet = |label: SharedString, color: Rgba| {
            h_flex()
                .id("editor-start-have-status")
                .h(px(32.))
                .w_full()
                .gap(px(6.))
                .items_center()
                .justify_center()
                .rounded(px(8.))
                .bg(t.hover)
                .text_size(px(ty.meta))
                .font_weight(FontWeight::MEDIUM)
                .text_color(color)
                .child(label)
                .into_any_element()
        };
        let have_action = match invite {
            StartInvite::Give => copy("native.agentInvite.copy", cx),
            StartInvite::Lapsed => copy("native.agentInvite.renew", cx),
            StartInvite::Copying => quiet(tr("native.agentInvite.copy").into(), t.subtle),
            StartInvite::Waiting => quiet(tr("native.start.copied").into(), t.text),
            StartInvite::Knocking { .. } => quiet(tr("native.start.waitKnock").into(), t.text),
            StartInvite::Connecting(name) => quiet(
                tf(
                    "native.agentInvite.connecting",
                    &[("name", name.clone().into())],
                )
                .into(),
                t.text,
            ),
            StartInvite::Joined(name) => quiet(
                tf(
                    "native.agentInvite.joined",
                    &[("name", name.clone().into())],
                )
                .into(),
                t.success,
            ),
        };
        let have_logos: Vec<String> = HAVE_LOGOS
            .iter()
            .map(|n| format!("agents/handoff-{n}.png"))
            .collect();
        let have = card(busy)
            .id("editor-start-have")
            .debug_selector(|| "editor-start-have".into())
            .child(logo_stack(&have_logos, 27., fill))
            .child(card_title("native.start.haveTitle"))
            .child(card_how("native.start.haveHow").flex_none())
            .child(
                div()
                    .mt(px(2.))
                    .flex_1()
                    .text_size(px(ty.meta))
                    .line_height(px(18.))
                    .text_color(t.subtle)
                    .child(tr("native.start.haveWho")),
            )
            .child(div().mt(px(14.)).w_full().child(have_action));
        // No: an Agent in the team's chat, with this project in it.
        let group_logos: Vec<String> = GROUP_LOGOS
            .iter()
            .map(|n| format!("integrations/{n}.svg"))
            .collect();
        let group = card(false)
            .id("editor-start-group")
            .debug_selector(|| "editor-start-group".into())
            .when(busy, |d| d.opacity(0.42))
            .child(logo_stack(&group_logos, 30., fill))
            .child(card_title("native.start.groupTitle"))
            .child(card_how("native.start.groupHow"))
            .child(
                div().mt(px(14.)).w_full().child(
                    Button::new("editor-start-group-soon")
                        .variant(ButtonVariant::Outline)
                        .label(tr("native.start.soon"))
                        .disabled(true)
                        .w_full(),
                ),
            );
        let follow = self.handoff_follow(t, cx);
        let foot: SharedString = if takes_files {
            // No space after a full-width stop.
            let note = tr("native.start.webNote");
            let gap = if note.ends_with('。') { "" } else { " " };
            format!("{note}{gap}{}", tr("native.start.dropHint")).into()
        } else {
            tr("native.start.webNote").into()
        };
        v_flex()
            .id("editor-start-empty")
            .debug_selector(|| "editor-start-empty".into())
            .w(px(CARD_WIDTH * 2. + 12.))
            .mt(px(-24.))
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
                    .child(ask),
            )
            .child(
                h_flex()
                    .id("editor-start-handoff")
                    .debug_selector(|| "editor-start-handoff".into())
                    .mt(px(18.))
                    .gap(px(12.))
                    .items_stretch()
                    .child(have)
                    .child(group),
            )
            .children(follow)
            .when_some(self.start.invite_alert, |d, key| {
                d.child(
                    div()
                        .mt(px(8.))
                        .text_size(px(ty.meta))
                        .text_color(t.danger)
                        .child(tr(key)),
                )
            })
            .child(
                div()
                    .id("editor-start-drop")
                    .debug_selector(|| "editor-start-drop".into())
                    .mt(px(12.))
                    .text_size(px(ty.meta))
                    .line_height(px(17.))
                    .text_color(t.subtle)
                    .child(foot),
            )
            .into_any_element()
    }

    /// What follows the copy, in one bar under the cards: the wait, the
    /// Agent asking to join (answered here), or the lapse.
    fn handoff_follow(&self, t: Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
        let ty = theme::ty().ui;
        let small = |text: SharedString| {
            div()
                .text_size(px(ty.meta))
                .line_height(px(17.))
                .text_color(t.subtle)
                .child(text)
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
                .child(
                    div()
                        .id("editor-start-copy-again")
                        .debug_selector(|| "editor-start-copy-again".into())
                        .text_size(px(ty.meta))
                        .text_color(t.muted)
                        .cursor(theme::clickable_cursor())
                        .hover(move |d| d.text_color(t.text))
                        .child(tr("native.agentInvite.copyAgain"))
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(EditorEvent::CopyInvite))),
                )
                .into_any_element(),
            StartInvite::Lapsed => small(tr("native.agentInvite.lapsed").into()).into_any_element(),
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
                .mt(px(12.))
                .px(px(14.))
                .py(px(12.))
                .rounded(px(12.))
                .bg(theme::alpha(t.accent, 0.07))
                .border_1()
                .border_color(theme::alpha(t.accent, 0.3))
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
