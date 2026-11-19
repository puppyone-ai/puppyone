//! The History body: the discovery permission, its messages, and the
//! conversations by runtime with Load more.
use super::*;

impl HistoryBrowser {
    pub(super) fn permission(&mut self, a: AgentTheme, t: Theme, cx: &mut Context<Self>) -> Div {
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
                            .debug_selector(|| "history-permission-allow".into())
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

    pub(super) fn message(icon: &'static str, text: String, spin: bool, a: AgentTheme) -> Div {
        // `.desktop-agent-history-empty`.
        let label = text.clone();
        div()
            .debug_selector(move || format!("history-message:{label}"))
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
        let runtime = AgentMark::from_icon_key(&history.icon_key(session));
        let disabled = self.opening.is_some();
        let title = session.title.clone();
        let locator = session.id.clone();
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
                    .debug_selector(move || format!("history-option:{locator}"))
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
                        d.cursor(theme::navigation_cursor()).on_click(cx.listener(
                            move |s, _, _, cx| {
                                if s.opening.is_some() {
                                    return;
                                }
                                s.opening = Some(target.id.clone());
                                cx.emit(HistoryBrowserEvent::Open(target.clone()));
                                cx.notify();
                            },
                        ))
                    }),
            )
            .into_any_element()
    }

    pub(super) fn list(&mut self, a: AgentTheme, t: Theme, cx: &mut Context<Self>) -> Div {
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
            let label = text.clone();
            div()
                .debug_selector(|| "history-warning".into())
                .text_center()
                .text_color(t.warning)
                .text_size(px(theme::ty().right.micro))
                .line_height(px(theme::ty().right.micro_line_height))
                .child(
                    div()
                        .debug_selector(move || format!("history-warning:{label}"))
                        .child(text),
                )
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
            let summary = tr("agent.history.sourceSummary");
            let mut details = div()
                .max_w_full()
                .text_color(a.text_subtle)
                .text_size(px(theme::ty().right.micro))
                .line_height(px(theme::ty().right.micro_line_height))
                .child(
                    div()
                        .id("history-source-summary")
                        .debug_selector(|| "history-source-summary".into())
                        .flex()
                        .gap(px(4.))
                        .child(if open { "▾" } else { "▸" })
                        .child(
                            div()
                                .debug_selector(move || format!("history-summary:{summary}"))
                                .child(summary),
                        )
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.details_open = !s.details_open;
                            cx.notify();
                        })),
                );
            if open {
                for (id, key) in &notes {
                    let text = format!("{}: {}", history.label_for(id), tr(key));
                    let label = text.clone();
                    details = details.child(
                        div()
                            .debug_selector(move || format!("history-source-note:{label}"))
                            .text_center()
                            .child(text),
                    );
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
                    .debug_selector(|| "history-more".into())
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
                                s.source.load_more();
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
