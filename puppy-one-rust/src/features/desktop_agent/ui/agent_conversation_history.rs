//! Port of `workbench/AgentChatHistoryBrowser`, `AgentConversationHistory`
//! and `useAgentConversationHistory` (`styles/launcher.css`): the launcher's
//! cross-runtime History over the project's `ConversationHistoryController`.
//! Discovery waits for the explicit permission; rows are locators only, and
//! opening one is the workbench's job (`HistoryBrowserEvent::Open`).
use super::agent_brand_mark::{monochrome_mark, runtime_for_icon_key};
use super::agent_theme::AgentTheme;
use crate::agent::contract::dto::{RuntimeDescriptor, SessionDiscovery, SessionMetadata};
use crate::features::desktop_agent::application::conversation_history_controller::{
    ConversationHistoryController, ConversationHistoryState,
};
use crate::features::desktop_agent::domain::agent_chat_history_target::{
    AuxiliaryWorkbenchHistoryTarget, create_agent_chat_history_target,
};
use crate::features::desktop_agent::infrastructure::cloud::{Hub, LABEL};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, tooltip};
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::form_input::TextInput,
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;

/// `--desktop-chrome-height` in the right sidebar.
const TOOLBAR: f32 = 40.;
/// `.desktop-agent-history-toolbar-button` / search: `--po-control-size-compact`.
const BUTTON: f32 = 28.;
/// `.desktop-agent-history-option`: row height and its 1px block margins.
const ROW: f32 = 32.;

pub enum HistoryBrowserEvent {
    Back,
    /// "I understand": persist `chatHistoryDiscoveryEnabled`.
    Allow,
    /// `onOpen(createAgentChatHistoryTarget(session))`.
    Open(AuxiliaryWorkbenchHistoryTarget),
}

/// `useAgentConversationHistory(...)`: the controller's state with the
/// sessions already open in a tab left out.
struct History {
    state: ConversationHistoryState,
    sessions: Vec<SessionMetadata>,
    excluded_count: usize,
    has_more: bool,
}

impl History {
    fn new(state: ConversationHistoryState, excluded: &[String]) -> Self {
        let sessions: Vec<SessionMetadata> = state
            .sessions
            .iter()
            .filter(|s| !excluded.iter().any(|id| s.id == *id))
            .cloned()
            .collect();
        Self {
            excluded_count: state.sessions.len() - sessions.len(),
            has_more: state.catalog_next_cursor.is_some() || !state.next_cursors.is_empty(),
            sessions,
            state,
        }
    }

    fn runtime_label(&self, session: &SessionMetadata) -> String {
        let id = runtime_id(session);
        session
            .runtime
            .as_ref()
            .map(|r| r.display_name.clone())
            .filter(|l| !l.is_empty())
            .or_else(|| self.runtime_name(&id))
            .unwrap_or(id)
    }

    fn runtime_name(&self, id: &str) -> Option<String> {
        self.state
            .runtimes
            .iter()
            .find(|entry| entry.descriptor.id == id)
            .map(|entry| entry.descriptor.display_name.clone())
    }

    fn icon_key(&self, session: &SessionMetadata) -> String {
        let id = runtime_id(session);
        session
            .runtime
            .as_ref()
            .and_then(|r| r.icon_key.clone())
            .filter(|k| !k.is_empty())
            .or_else(|| {
                self.state
                    .runtimes
                    .iter()
                    .find(|entry| entry.descriptor.id == id)
                    .and_then(|entry| entry.descriptor.icon_key.clone())
            })
            .unwrap_or(id)
    }

    fn source_failed(&self) -> bool {
        self.state
            .sources
            .iter()
            .any(|(_, source)| source.status == "failed")
    }

    /// Every source listed to its end: an empty projection is not proof of
    /// an empty native history.
    fn complete(&self) -> bool {
        let truncated = self
            .state
            .catalog_coverage
            .as_ref()
            .is_some_and(|c| c.truncated);
        !self.state.sources.is_empty()
            && !truncated
            && !self.has_more
            && self
                .state
                .sources
                .iter()
                .all(|(_, s)| s.status == "complete" && complete_coverage(s))
            && self.state.runtimes.iter().all(|runtime| {
                self.state
                    .source(&runtime.descriptor.id)
                    .is_some_and(complete_coverage)
            })
    }

    /// `sourceNotes`.
    fn source_notes(&self) -> Vec<(String, &'static str)> {
        self.state
            .sources
            .iter()
            .filter_map(|(id, source)| {
                let message = match source.status.as_str() {
                    "unsupported" => Some("agent.history.sourceUnsupported"),
                    "partial" => Some("agent.history.sourcePartial"),
                    "failed" => None,
                    _ if !complete_coverage(source) => Some("agent.history.sourceUnverified"),
                    _ => None,
                }?;
                Some((id.clone(), message))
            })
            .collect()
    }

    fn label_for(&self, runtime_id: &str) -> String {
        self.runtime_name(runtime_id)
            .unwrap_or_else(|| runtime_id.to_string())
    }
}

fn runtime_id(session: &SessionMetadata) -> String {
    session
        .runtime_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .or_else(|| session.runtime.as_ref().map(|r| r.id.as_str()))
        .unwrap_or_default()
        .to_string()
}

fn complete_coverage(source: &SessionDiscovery) -> bool {
    source.coverage.as_deref() == Some("complete")
}

/// Where the conversations come from.
#[derive(Clone)]
pub enum HistorySource {
    /// The project's Agent service history.
    Agent(ConversationHistoryController),
    /// `CloudAgentHistory`: the hosted target's shared locators.
    Hosted(std::sync::Arc<Hub>),
}

impl HistorySource {
    fn snapshot(&self) -> ConversationHistoryState {
        match self {
            Self::Agent(controller) => controller.get_snapshot(),
            Self::Hosted(hub) => hosted_history(hub),
        }
    }
    fn refresh(&self) {
        match self {
            Self::Agent(controller) => drop(controller.refresh()),
            Self::Hosted(hub) => hub.refresh_history(),
        }
    }
}

/// `CloudAgentHistory`: server locators adapted, never transcripts.
fn hosted_history(hub: &Hub) -> ConversationHistoryState {
    let history = hub.history();
    let sessions: Vec<SessionMetadata> = history
        .sessions
        .iter()
        .map(|session| {
            let title = session
                .title
                .clone()
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| tr("agent.header.newChat").to_string());
            SessionMetadata {
                id: session.id.clone(),
                provider: "cloud-pi".into(),
                runtime_id: Some("cloud-pi".into()),
                runtime: Some(RuntimeDescriptor {
                    id: "cloud-pi".into(),
                    display_name: LABEL.into(),
                    icon_key: Some("puppyone-agent".into()),
                    ..RuntimeDescriptor::default()
                }),
                provider_session_id: Some(session.id.clone()),
                title,
                created_at: session.updated_at.clone(),
                updated_at: session.updated_at.clone(),
                terminal_state: Some("idle".into()),
                ..SessionMetadata::default()
            }
        })
        .collect();
    let status = if history.error.is_some() {
        "failed"
    } else if history.loaded {
        "complete"
    } else {
        "not-requested"
    };
    ConversationHistoryState {
        sources: vec![(
            "cloud-pi".into(),
            SessionDiscovery {
                runtime_id: Some("cloud-pi".into()),
                status: status.into(),
                coverage: Some(
                    if history.sessions.len() < 200 {
                        "complete"
                    } else {
                        "unknown"
                    }
                    .into(),
                ),
                indexed: history.sessions.len() as i64,
                ..SessionDiscovery::default()
            },
        )],
        sessions,
        loading: !history.loaded && history.loading,
        loaded: history.loaded || history.error.is_some(),
        refreshing: history.loaded && history.loading,
        error: history.error,
        ..Default::default()
    }
}

pub struct HistoryBrowser {
    source: HistorySource,
    /// Discovery has the user's permission (`historyDiscoveryEnabled`).
    enabled: bool,
    excluded: Vec<String>,
    search_open: bool,
    search: Entity<TextInput>,
    focus: FocusHandle,
    details_open: bool,
    /// `.desktop-agent-history-search:focus-within`, sampled each frame.
    search_focused: bool,
    /// The locator being opened (`openingTargetId`).
    pub opening: Option<String>,
    list_scroll: ScrollHandle,
    _subscription: Box<dyn FnOnce()>,
}

impl EventEmitter<HistoryBrowserEvent> for HistoryBrowser {}

impl HistoryBrowser {
    /// The browser over `source` (retained while hidden).
    pub fn new(
        source: HistorySource,
        enabled: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search = cx.new(|cx| {
            let mut input = TextInput::new(tr("agent.history.search"), false, 200, window, cx);
            input.appearance = false;
            input
        });
        cx.observe(&search, |_, _, cx| cx.notify()).detach();
        let (notify, mut changes) = tokio::sync::mpsc::unbounded_channel::<()>();
        let unsubscribe: Box<dyn FnOnce()> = match &source {
            HistorySource::Agent(controller) => {
                Box::new(controller.subscribe(std::rc::Rc::new(move || {
                    let _ = notify.send(());
                })))
            }
            HistorySource::Hosted(hub) => {
                let (wake, woken) = crate::wake::Wake::channel();
                let id = hub.watch_history(wake);
                cx.spawn(async move |_, _| {
                    while woken.recv().await.is_ok() {
                        if notify.send(()).is_err() {
                            break;
                        }
                    }
                })
                .detach();
                let hub = hub.clone();
                Box::new(move || hub.unwatch(id))
            }
        };
        cx.spawn(async move |this, cx| {
            while changes.recv().await.is_some() {
                while changes.try_recv().is_ok() {}
                if this.update(cx, |_, cx| cx.notify()).is_err() {
                    break;
                }
            }
        })
        .detach();
        let mut browser = Self {
            source,
            enabled: false,
            excluded: vec![],
            search_open: false,
            search,
            focus: cx.focus_handle(),
            details_open: false,
            search_focused: false,
            opening: None,
            list_scroll: ScrollHandle::new(),
            _subscription: unsubscribe,
        };
        if enabled {
            browser.enable(cx);
        }
        browser
    }
    pub fn enabled(&self) -> bool {
        self.enabled
    }
    /// Start discovery once permission exists (`useAgentConversationHistory active`).
    pub fn enable(&mut self, cx: &mut Context<Self>) {
        if self.enabled {
            return;
        }
        self.enabled = true;
        match &self.source {
            HistorySource::Agent(controller) => controller.activate(),
            // `useEffect(() => void workbench.refreshHistory())`.
            HistorySource::Hosted(hub) => hub.refresh_history(),
        }
        cx.notify();
    }
    /// Sessions already open in a tab (`excludedResourceIds`).
    pub fn set_excluded(&mut self, ids: Vec<String>, cx: &mut Context<Self>) {
        if self.excluded != ids {
            self.excluded = ids;
            cx.notify();
        }
    }
    /// Dev captures: the first listed chat's target.
    #[cfg(feature = "dev-capture")]
    pub fn capture_first_target(&self) -> Option<AuxiliaryWorkbenchHistoryTarget> {
        self.history()
            .sessions
            .first()
            .map(create_agent_chat_history_target)
    }
    fn history(&self) -> History {
        History::new(self.source.snapshot(), &self.excluded)
    }
    fn back(&mut self, cx: &mut Context<Self>) {
        if self.opening.is_none() {
            cx.emit(HistoryBrowserEvent::Back);
        }
    }
    fn close_search(&mut self, cx: &mut Context<Self>) {
        self.search.update(cx, |s, cx| s.clear(cx));
        self.search_open = false;
        cx.notify();
    }

    fn toolbar_button(
        &self,
        id: &'static str,
        label: &'static str,
        icon: AnyElement,
        disabled: bool,
        a: AgentTheme,
    ) -> Stateful<Div> {
        div()
            .id(id)
            .size(px(BUTTON))
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(6.))
            .border_1()
            .border_color(theme::alpha(a.text, 0.))
            .text_color(a.text_subtle)
            .when(disabled, |d| d.opacity(0.5))
            .when(!disabled, |d| {
                d.hover(move |s| s.bg(a.row_hover).text_color(a.text))
            })
            .tooltip(tooltip(label))
            .child(icon)
    }

    fn toolbar(&mut self, permission: bool, a: AgentTheme, cx: &mut Context<Self>) -> Div {
        let back = self
            .toolbar_button(
                "history-back",
                tr("agent.history.back"),
                Icon::new("arrow-left")
                    .stroke(1.7)
                    .color(a.text_subtle)
                    .into_any_element(),
                false,
                a,
            )
            .on_click(cx.listener(|s, _, _, cx| s.back(cx)));
        let mut bar = div()
            .h(px(TOOLBAR))
            .flex_shrink_0()
            .w_full()
            .px(px(12.))
            .flex()
            .items_center()
            .gap(px(6.))
            .child(back);
        if permission {
            return bar;
        }
        let state = self.source.snapshot();
        let busy = (state.sessions.is_empty() && (state.loading || !state.loaded))
            || state.refreshing
            || state.loading_more;
        let refreshing = state.refreshing;
        let slot = div().flex_1().min_w_0().flex().justify_end().map(|slot| {
            if self.search_open {
                // `.desktop-agent-history-search`.
                let focused = self.search_focused;
                slot.child(
                    div()
                        .id("history-search")
                        .w_full()
                        .h(px(BUTTON))
                        .pl(px(6.))
                        .pr(px(6.))
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .rounded(px(6.))
                        .border_1()
                        .border_color(if focused {
                            a.launcher_focus_border
                        } else {
                            theme::alpha(a.text, 0.)
                        })
                        .bg(if focused {
                            a.control_surface
                        } else {
                            a.launcher_placeholder_surface
                        })
                        .child(
                            div().w(px(16.)).flex().justify_center().child(
                                Icon::new("search")
                                    .with_size(px(13.))
                                    .stroke(1.7)
                                    .color(a.launcher_placeholder_text),
                            ),
                        )
                        .child(div().flex_1().min_w_0().child(self.search.clone())),
                )
            } else {
                slot.child(
                    self.toolbar_button(
                        "history-search-open",
                        tr("agent.history.search"),
                        Icon::new("search")
                            .stroke(1.7)
                            .color(a.text_subtle)
                            .into_any_element(),
                        false,
                        a,
                    )
                    .on_click(cx.listener(|s, _, window, cx| {
                        s.search_open = true;
                        s.search.read(cx).focus_handle(cx).focus(window, cx);
                        cx.notify();
                    })),
                )
            }
        });
        let icon = if refreshing {
            spinning(
                "history-refresh-spin",
                "refresh-cw",
                12.,
                1.7,
                a.text_subtle,
            )
        } else {
            Icon::new("refresh-cw")
                .xsmall()
                .stroke(1.7)
                .color(a.text_subtle)
                .into_any_element()
        };
        let refresh = self
            .toolbar_button(
                "history-refresh",
                tr("agent.history.refresh"),
                icon,
                busy,
                a,
            )
            .when(!busy, |d| {
                d.on_click(cx.listener(|s, _, _, cx| {
                    s.source.refresh();
                    cx.notify();
                }))
            });
        bar = bar.child(slot).child(refresh);
        bar
    }

    fn permission(&mut self, a: AgentTheme, t: Theme, cx: &mut Context<Self>) -> Div {
        let question = tr("agent.history.permission.question");
        let selected = theme::mix(a.text, t.canvas, 0.86);
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(self.toolbar(true, a, cx))
            .child(
                // `.desktop-agent-history-permission-content`.
                div()
                    .flex_1()
                    .min_h_0()
                    .p(px(30.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(20.))
                    .child(
                        div()
                            .w_full()
                            .text_center()
                            .text_color(a.text_muted)
                            .text_size(px(14.))
                            .line_height(px(22.4))
                            .child(question),
                    )
                    .child(
                        div()
                            .id("history-permission-allow")
                            .h(px(theme::control()))
                            .px(px(14.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(6.))
                            .border_1()
                            .border_color(a.text)
                            .bg(a.text)
                            .text_color(t.canvas)
                            .text_size(px(14.))
                            .line_height(px(14.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .hover(move |s| s.border_color(selected).bg(selected))
                            .tooltip(tooltip(tr("agent.history.permission.allowAria")))
                            .on_click(
                                cx.listener(|_, _, _, cx| cx.emit(HistoryBrowserEvent::Allow)),
                            )
                            .child(tr("agent.history.permission.allow")),
                    ),
            )
    }

    fn message(icon: &'static str, text: String, spin: bool, a: AgentTheme) -> Div {
        // `.desktop-agent-history-empty`.
        div()
            .min_h(px(theme::control_large()))
            .px(px(8.))
            .py(px(3.))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(6.))
            .text_color(a.text_subtle)
            .text_size(px(theme::ty().right.caption))
            .line_height(px(theme::ty().right.caption_line_height))
            .child(if spin {
                spinning("history-loading", icon, 13., 2., a.text_subtle).into_any_element()
            } else {
                Icon::new(icon)
                    .with_size(px(13.))
                    .stroke(2.)
                    .color(a.text_subtle)
                    .into_any_element()
            })
            .child(text)
    }

    fn row(
        &self,
        index: usize,
        session: &SessionMetadata,
        history: &History,
        a: AgentTheme,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let runtime = runtime_for_icon_key(&history.icon_key(session));
        let disabled = self.opening.is_some();
        let title = session.title.clone();
        let updated = (session.updated_at_known != Some(false))
            .then_some(session.updated_at.as_str())
            .filter(|at| !at.is_empty())
            .and_then(crate::clock::date_parse)
            .map(format_history_date)
            .unwrap_or_default();
        let target = create_agent_chat_history_target(session);
        let hover = t.hover;
        let text = a.text;
        div()
            .py(px(1.))
            .child(
                div()
                    .id(("history-option", index))
                    .h(px(ROW))
                    .w_full()
                    .px(px(6.))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .rounded(px(6.))
                    .text_color(a.text_muted)
                    .text_size(px(theme::ty().right.content))
                    .line_height(px(theme::ty().right.control_line_height))
                    .when(disabled, |d| d.opacity(0.5))
                    .when(!disabled, |d| {
                        d.hover(move |s| s.bg(hover).text_color(text))
                    })
                    .children(runtime.map(|runtime| {
                        monochrome_mark(runtime, t.dark, 14., a.text_subtle, t.canvas)
                    }))
                    .child(div().flex_1().min_w_0().truncate().child(title.clone()))
                    .child(
                        div()
                            .flex_shrink_0()
                            .text_color(a.text_subtle)
                            .text_size(px(theme::ty().right.caption))
                            .line_height(px(theme::ty().right.meta_line_height))
                            .child(updated),
                    )
                    .tooltip(tooltip(tf(
                        "agent.history.open",
                        &[("title", title.into())],
                    )))
                    .when(!disabled, |d| {
                        d.on_click(cx.listener(move |s, _, _, cx| {
                            if s.opening.is_some() {
                                return;
                            }
                            s.opening = Some(target.id.clone());
                            cx.emit(HistoryBrowserEvent::Open(target.clone()));
                            cx.notify();
                        }))
                    }),
            )
            .into_any_element()
    }

    fn list(&mut self, a: AgentTheme, t: Theme, cx: &mut Context<Self>) -> Div {
        let history = self.history();
        let failed = history.source_failed();
        let query = self.search.read(cx).text().trim().to_lowercase();
        let matching: Vec<SessionMetadata> = history
            .sessions
            .iter()
            .filter(|session| {
                query.is_empty()
                    || format!("{}\n{}", session.title, history.runtime_label(session))
                        .to_lowercase()
                        .contains(&query)
            })
            .cloned()
            .collect();
        let state = &history.state;
        let loading =
            history.sessions.is_empty() && (state.loading || !state.loaded || state.refreshing);
        let body: AnyElement = if loading {
            Self::message("loader-circle", tr("agent.history.loading").into(), true, a)
                .into_any_element()
        } else if history.sessions.is_empty() {
            let key = if state.error.is_some() || failed {
                "agent.history.refreshFailed"
            } else if history.excluded_count > 0 {
                "agent.history.alreadyOpen"
            } else if history.complete() {
                "agent.history.empty"
            } else {
                "agent.history.notFound"
            };
            Self::message("history", tr(key).into(), false, a).into_any_element()
        } else if matching.is_empty() {
            Self::message("search", tr("agent.history.noMatches").into(), false, a)
                .into_any_element()
        } else {
            let rows: Vec<AnyElement> = matching
                .iter()
                .enumerate()
                .map(|(i, s)| self.row(i, s, &history, a, t, cx))
                .collect();
            div()
                .id("history-list")
                .size_full()
                .overflow_y_scroll()
                .track_scroll(&self.list_scroll)
                .pl(px(12.))
                .pr(px(12.))
                .pb(px(8.))
                .flex()
                .flex_col()
                .children(rows)
                .child(crate::ui::scrollbar::vertical(
                    "agent-history-scrollbar",
                    &self.list_scroll,
                ))
                .into_any_element()
        };
        let warning = |text: String| {
            div()
                .text_center()
                .text_color(t.warning)
                .text_size(px(theme::ty().right.micro))
                .line_height(px(theme::ty().right.micro_line_height))
                .child(text)
        };
        let notes = history.source_notes();
        let more_disabled = state.loading_more || state.refreshing;
        let more_label = if state.loading_more {
            tr("agent.history.loadingMore")
        } else {
            tr("agent.history.loadMore")
        };
        let mut footer = div()
            .flex_shrink_0()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(3.))
            .px(px(12.))
            .pb(px(8.));
        for (id, source) in &state.sources {
            if source.status == "failed" {
                footer = footer.child(warning(format!(
                    "{}: {}",
                    history.label_for(id),
                    tr("agent.history.refreshFailed")
                )));
            }
        }
        if !notes.is_empty() {
            let open = self.details_open;
            let mut details = div()
                .max_w_full()
                .text_color(a.text_subtle)
                .text_size(px(theme::ty().right.micro))
                .line_height(px(theme::ty().right.micro_line_height))
                .child(
                    div()
                        .id("history-source-summary")
                        .flex()
                        .gap(px(4.))
                        .child(if open { "▾" } else { "▸" })
                        .child(tr("agent.history.sourceSummary"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.details_open = !s.details_open;
                            cx.notify();
                        })),
                );
            if open {
                for (id, key) in &notes {
                    details = details.child(div().text_center().child(format!(
                        "{}: {}",
                        history.label_for(id),
                        tr(key)
                    )));
                }
            }
            footer = footer.child(details);
        }
        if state.catalog_coverage.as_ref().is_some_and(|c| c.truncated) {
            footer = footer.child(warning(tr("agent.history.catalogTruncated").into()));
        }
        if history.has_more {
            let row_hover = a.row_hover;
            let muted = a.text_muted;
            footer = footer.child(
                div()
                    .id("history-more")
                    .px(px(8.))
                    .py(px(2.))
                    .rounded(px(4.))
                    .text_color(a.text_subtle)
                    .text_size(px(theme::ty().right.micro))
                    .line_height(px(theme::ty().right.micro_line_height))
                    .when(more_disabled, |d| d.opacity(0.5))
                    .when(!more_disabled, |d| {
                        d.hover(move |s| s.bg(row_hover).text_color(muted))
                            .on_click(cx.listener(|s, _, _, cx| {
                                if let HistorySource::Agent(controller) = &s.source {
                                    drop(controller.load_more());
                                }
                                cx.notify();
                            }))
                    })
                    .child(more_label),
            );
        }
        if state.error.is_some() && !history.sessions.is_empty() && !failed {
            footer = footer.child(warning(tr("agent.history.refreshFailed").into()));
        }
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(a.canvas)
            .child(self.toolbar(false, a, cx))
            .child(div().flex_1().min_h_0().child(body))
            .child(footer)
    }
}

impl Render for HistoryBrowser {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        self.search_focused = self
            .search
            .read(cx)
            .focus_handle(cx)
            .contains_focused(window, cx);
        self.search.update(cx, |s, _| {
            s.prompt_text = Some((
                theme::ty().right.caption,
                theme::ty().right.meta_line_height,
            ));
            s.placeholder_color = Some(a.launcher_placeholder_text);
        });
        let content = if self.enabled {
            self.list(a, t, cx)
        } else {
            self.permission(a, t, cx)
        };
        div()
            .id("agent-history-browser")
            .track_focus(&self.focus)
            .size_full()
            .font_family("Geist")
            .on_key_down(cx.listener(|s, e: &KeyDownEvent, window, cx| {
                if e.keystroke.key != "escape" {
                    return;
                }
                cx.stop_propagation();
                if s.search_open {
                    s.close_search(cx);
                    s.focus.focus(window, cx);
                } else {
                    s.back(cx);
                }
            }))
            .child(content)
    }
}

/// A Lucide glyph turning once every 900ms (`.is-spinning`).
fn spinning(
    id: &'static str,
    icon: &'static str,
    size: f32,
    stroke: f32,
    color: Rgba,
) -> AnyElement {
    Icon::new(icon)
        .with_size(px(size))
        .stroke(stroke)
        .color(color)
        .spinning(id)
        .into_any_element()
}

/// `formatHistoryDate`: `Intl.DateTimeFormat(undefined, { month: "short",
/// day: "numeric", hour: "numeric", minute: "2-digit" })` — the system's
/// region, in local time.
pub fn format_history_date(unix_ms: i64) -> String {
    crate::platform::locale_format::month_day_time(unix_ms)
}
