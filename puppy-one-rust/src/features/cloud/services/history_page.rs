//! History: the commit graph and its rows.
use super::*;

impl CloudServices {
    pub(super) fn history(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let Some(history) = details.history else {
            return v_flex()
                .gap(px(12.))
                .child(self.back(t, cx))
                .child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(ty.meta))
                                .text_color(t.muted)
                                .child(tr("cloud.team.loadFailed")),
                        )
                        .child(
                            Button::new("cloud-history-retry")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.retry"))
                                .on_click(cx.listener(|s, _, _, cx| s.refresh(cx))),
                        ),
                )
                .into_any_element();
        };
        let rows = graph::rows(&history);
        let width = graph::width(&rows);
        let more = history.more();
        let list = v_flex()
            .id("cloud-history-list")
            .w(px(380.))
            .flex_shrink_0()
            .overflow_y_scroll()
            .track_scroll(&self.list_scroll)
            .children(rows.into_iter().enumerate().map(|(index, row)| {
                let id = row.id.clone();
                let commit = history.commits.iter().find(|c| c.id == row.id);
                let message = commit.map_or(String::new(), |c| {
                    if c.message.is_empty() {
                        tr("cloud.history.updateWorkspace").to_owned()
                    } else {
                        c.message.clone()
                    }
                });
                let selected = self.commit.as_deref() == Some(id.as_str());
                let clickable = row.commit;
                h_flex()
                    .id(("cloud-history-row", index))
                    .h(px(GRAPH_ROW))
                    .gap(px(6.))
                    .when(selected, |d| d.bg(t.selected))
                    .hover(|d| d.bg(t.hover))
                    .when(clickable, |d| {
                        d.on_click(cx.listener(move |s, _, _, cx| s.open_commit(id.clone(), cx)))
                    })
                    .child(graph_cell(&row, width, t))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(ty.meta))
                            .text_color(t.text)
                            .child(message),
                    )
                    .children(row.labels.first().map(|label| {
                        div()
                            .flex_shrink_0()
                            .px(px(6.))
                            .rounded(px(4.))
                            .bg(t.control)
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(label.name.clone())
                    }))
            }))
            .when(self.history_more_failed, |list| {
                list.child(
                    div()
                        .px(px(8.))
                        .py(px(6.))
                        .text_size(px(ty.caption))
                        .text_color(t.danger)
                        .child(tr("cloud.message.history-load-more-failed")),
                )
            })
            .when(more, |list| {
                list.child(
                    h_flex().justify_center().py(px(8.)).child(
                        Button::new("cloud-history-more")
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.common.loadMore"))
                            .disabled(self.history_loading_more)
                            .on_click(cx.listener(|s, _, _, cx| s.load_more_history(cx))),
                    ),
                )
            });
        let detail = v_flex()
            .flex_1()
            .min_w_0()
            .gap(px(6.))
            .pl(px(16.))
            .children(self.detail.as_ref().map(|commit| {
                v_flex()
                    .gap(px(4.))
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(commit.message.clone()),
                    )
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(commit.who.clone()),
                    )
                    .children(commit.changes.iter().take(200).map(|change| {
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.text)
                            .child(change.path.clone())
                    }))
            }));
        v_flex()
            .gap(px(12.))
            .child(self.back(t, cx))
            .child(self.heading(t))
            .child(h_flex().items_start().child(list).child(detail))
            .into_any_element()
    }
}

/// `HISTORY_GRAPH_ROW_HEIGHT`.
pub(super) const GRAPH_ROW: f32 = 30.;

/// `HistoryGraphVisual`: lanes and the node of one row.
pub(super) fn graph_cell(row: &graph::Row, width: f32, t: Theme) -> impl IntoElement {
    let row = row.clone();
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let y_of = |anchor: graph::Anchor| match anchor {
                graph::Anchor::Top => 0.,
                graph::Anchor::Middle => GRAPH_ROW / 2.,
                graph::Anchor::Bottom => GRAPH_ROW,
            };
            let at = |x: f32, y: f32| bounds.origin + point(px(x), px(y));
            for segment in &row.segments {
                let (x0, x1) = (
                    graph::lane_x(segment.from_lane),
                    graph::lane_x(segment.to_lane),
                );
                let (y0, y1) = (y_of(segment.from), y_of(segment.to));
                let mut path = PathBuilder::stroke(px(1.5));
                path.move_to(at(x0, y0));
                if x0 == x1 || y0 == y1 {
                    path.line_to(at(x1, y1));
                } else {
                    let middle = y0 + (y1 - y0) / 2.;
                    path.cubic_bezier_to(at(x1, y1), at(x0, middle), at(x1, middle));
                }
                if let Ok(path) = path.build() {
                    window.paint_path(path, theme::history_graph_color(segment.color));
                }
            }
            let square = |lane: usize, half: f32| Bounds {
                origin: at(graph::lane_x(lane) - half, GRAPH_ROW / 2. - half),
                size: size(px(half * 2.), px(half * 2.)),
            };
            for marker in &row.ref_markers {
                window.paint_quad(
                    fill(
                        square(marker.lane, 5.),
                        theme::history_graph_color(marker.color),
                    )
                    .corner_radii(px(3.)),
                );
            }
            let current = row.labels.iter().any(|l| l.current);
            let color = theme::history_graph_color(row.node_color);
            window.paint_quad(fill(square(row.node_lane, 5.5), t.overlay).corner_radii(px(3.)));
            window.paint_quad(quad(
                square(row.node_lane, if current { 4. } else { 3.5 }),
                px(2.),
                if current { color } else { t.overlay },
                px(1.5),
                color,
                BorderStyle::Solid,
            ));
        },
    )
    .w(px(width))
    .h(px(GRAPH_ROW))
    .flex_shrink_0()
}
