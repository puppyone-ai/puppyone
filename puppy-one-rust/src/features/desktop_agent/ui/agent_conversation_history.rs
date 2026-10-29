//! Port of `workbench/AgentChatHistoryBrowser` + `AgentConversationHistory`
//! (`styles/launcher.css`): the launcher's cross-runtime History. Discovery
//! waits for the explicit permission; rows are locators only, and opening one
//! is the workbench's job (`HistoryBrowserEvent::Open`).
use super::agent_brand_mark::monochrome_mark;
use super::agent_theme::AgentTheme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, tooltip};
use crate::{
    agent::connections::local_agent_inventory::Installation,
    features::desktop_agent::application::conversation_history::{
        ConversationHistory, HistorySession, SourceStatus,
    },
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::form_input::TextInput,
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use std::path::PathBuf;

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
    Open {
        installation: Installation,
        id: String,
    },
}

pub struct HistoryBrowser {
    installations: Vec<Installation>,
    root: PathBuf,
    history: Option<ConversationHistory>,
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
    _poll: Option<Task<()>>,
}

impl EventEmitter<HistoryBrowserEvent> for HistoryBrowser {}

impl HistoryBrowser {
    pub fn new(
        installations: Vec<Installation>,
        root: PathBuf,
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
        let mut browser = Self {
            installations,
            root,
            history: None,
            excluded: vec![],
            search_open: false,
            search,
            focus: cx.focus_handle(),
            details_open: false,
            search_focused: false,
            opening: None,
            list_scroll: ScrollHandle::new(),
            _poll: None,
        };
        if enabled {
            browser.enable(cx);
        }
        browser
    }
    /// Dev-capture: a fixed listing (`tools/reference-workbench-entry.tsx`).
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(&mut self, history: ConversationHistory) {
        self.history = Some(history);
    }
    pub fn enabled(&self) -> bool {
        self.history.is_some()
    }
    /// Start discovery once permission exists (`useAgentConversationHistory active`).
    pub fn enable(&mut self, cx: &mut Context<Self>) {
        if self.history.is_some() {
            return;
        }
        let (wake, rx) = Wake::channel();
        let installations = self
            .installations
            .iter()
            .filter(|i| i.chat)
            .cloned()
            .collect();
        let mut history = ConversationHistory::new(
            installations,
            self.root.clone(),
            wake,
            crate::features::desktop_agent::infrastructure::native::native_agent_client::create_listing,
        );
        history.set_excluded(self.excluded.clone());
        self.history = Some(history);
        self._poll = Some(cx.spawn(async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update(cx, |s, cx| {
                        if let Some(history) = s.history.as_mut() {
                            history.poll();
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
        cx.notify();
    }
    /// Sessions already open in a tab (`excludedResourceIds`).
    pub fn set_excluded(&mut self, ids: Vec<String>) {
        if let Some(history) = self.history.as_mut() {
            history.set_excluded(ids.clone());
        }
        self.excluded = ids;
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
        let history = self.history.as_ref();
        let busy = history.is_none_or(|h| {
            (h.sessions().is_empty() && h.loading()) || h.refreshing() || h.loading_more()
        });
        let refreshing = history.is_some_and(ConversationHistory::refreshing);
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
                    if let Some(history) = s.history.as_mut() {
                        history.refresh();
                    }
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
        session: &HistorySession,
        a: AgentTheme,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let history = self.history.as_ref().unwrap();
        let installation = history.installation(session.installation).cloned();
        let runtime = installation.as_ref().map(|i| i.runtime);
        let disabled = self.opening.is_some();
        let id = session.id.clone();
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
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .child(session.title.clone()),
                    )
                    .child(
                        div()
                            .flex_shrink_0()
                            .text_color(a.text_subtle)
                            .text_size(px(theme::ty().right.caption))
                            .line_height(px(theme::ty().right.meta_line_height))
                            .child(
                                session
                                    .updated_at
                                    .map(format_history_date)
                                    .unwrap_or_default(),
                            ),
                    )
                    .tooltip(tooltip(tf(
                        "agent.history.open",
                        &[("title", session.title.clone().into())],
                    )))
                    .when(!disabled, |d| {
                        d.on_click(cx.listener(move |s, _, _, cx| {
                            if s.opening.is_some() {
                                return;
                            }
                            if let Some(installation) = installation.clone() {
                                s.opening = Some(id.clone());
                                cx.emit(HistoryBrowserEvent::Open {
                                    installation,
                                    id: id.clone(),
                                });
                                cx.notify();
                            }
                        }))
                    }),
            )
            .into_any_element()
    }

    fn list(&mut self, a: AgentTheme, t: Theme, cx: &mut Context<Self>) -> Div {
        let history = self.history.as_ref().unwrap();
        let sessions = history.sessions();
        let failed = history.source_failed();
        let query = self.search.read(cx).text().trim().to_lowercase();
        let matching: Vec<HistorySession> = sessions
            .iter()
            .filter(|session| {
                query.is_empty() || {
                    let label = history
                        .installation(session.installation)
                        .map(|i| i.label.as_str())
                        .unwrap_or("");
                    format!("{}\n{}", session.title, label)
                        .to_lowercase()
                        .contains(&query)
                }
            })
            .cloned()
            .collect();
        let loading = sessions.is_empty() && (history.loading() || history.refreshing());
        let body: AnyElement = if loading {
            Self::message("loader-circle", tr("agent.history.loading").into(), true, a)
                .into_any_element()
        } else if sessions.is_empty() {
            let key = if failed {
                "agent.history.refreshFailed"
            } else if history.excluded_count() > 0 {
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
                .map(|(i, s)| self.row(i, s, a, t, cx))
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
        let history = self.history.as_ref().unwrap();
        let label = |index: usize| {
            history
                .installation(index)
                .map(|i| i.label.clone())
                .unwrap_or_default()
        };
        let statuses = history.statuses();
        let warning = |text: String| {
            div()
                .text_center()
                .text_color(t.warning)
                .text_size(px(theme::ty().right.micro))
                .line_height(px(theme::ty().right.micro_line_height))
                .child(text)
        };
        let notes: Vec<(usize, &'static str)> = statuses
            .iter()
            // More pages (`nextCursor`) is `hasMore`, not partial coverage.
            .filter_map(|(i, status)| match status {
                SourceStatus::Unsupported => Some((*i, "agent.history.sourceUnsupported")),
                _ => None,
            })
            .collect();
        let has_more = history.has_more();
        let more_disabled = history.loading_more() || history.refreshing();
        let more_label = if history.loading_more() {
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
        for (i, status) in &statuses {
            if *status == SourceStatus::Failed {
                footer = footer.child(warning(format!(
                    "{}: {}",
                    label(*i),
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
                for (i, key) in notes {
                    details = details.child(div().text_center().child(format!(
                        "{}: {}",
                        label(i),
                        tr(key)
                    )));
                }
            }
            footer = footer.child(details);
        }
        if has_more {
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
                                if let Some(history) = s.history.as_mut() {
                                    history.load_more();
                                }
                                cx.notify();
                            }))
                    })
                    .child(more_label),
            );
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
        let content = if self.history.is_some() {
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
