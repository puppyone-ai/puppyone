//! `CloudShareStatusCard` and the wizard's `ShareReadersStep`. The card only
//! answers "who can read this now"; everything that changes an answer lives
//! in the readers step behind Manage sharing.
use super::*;
use crate::features::source_control::relative_time;

/// One reader's facts: where, how, and when it last read.
fn reader_line(reader: &share::Share, waiting: bool, now: i64) -> String {
    let place = if reader.path.is_empty() {
        tr("cloud.share.readers.wholeProject").to_owned()
    } else {
        reader.path.clone()
    };
    let mode = tr(if reader.readonly {
        "cloud.share.scope.readOnly"
    } else {
        "cloud.share.scope.readWrite"
    });
    let used = if waiting {
        tr("cloud.share.readers.waiting").to_owned()
    } else if let Some(at) = &reader.last_seen {
        let time = relative_time(at, now).unwrap_or_else(|| at.clone());
        tf("cloud.share.readers.lastUsed", &[("time", time.into())])
    } else {
        tr("cloud.share.readers.neverUsed").to_owned()
    };
    format!("{place} · {mode} · {used}")
}
/// `desktop-share-status-reader-dot`: green once it has read anything.
fn reader_dot(live: bool, t: Theme) -> Div {
    div()
        .flex_none()
        .size(px(8.))
        .rounded_full()
        .bg(if live { t.success } else { t.muted })
}

impl CloudServices {
    pub(super) fn awaited(&self) -> Option<&share::Pending> {
        self.pending_share.as_ref().map(|(_, pending)| pending)
    }
    /// `CloudShareStatusCard`, `surface="page"`.
    pub(super) fn share_status_card(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let rows = self.share_rows();
        let status = share::status(&rows, self.awaited());
        let awaited = self
            .awaited()
            .filter(|_| status == share::Status::Waiting)
            .cloned();
        let readers: Vec<&share::Share> = rows.iter().filter(|s| s.active()).collect();
        let (dot, headline, hint) = match (&status, &awaited) {
            (share::Status::Waiting, Some(pending)) => {
                let target = target_label(&pending.target);
                (
                    t.warning,
                    tf(
                        "cloud.share.status.waiting",
                        &[("target", target.clone().into())],
                    ),
                    Some(tf(
                        "cloud.share.status.waitingHint",
                        &[("target", target.into())],
                    )),
                )
            }
            (share::Status::Shared, _) => (
                t.success,
                tf(
                    "cloud.share.status.shared",
                    &[("count", readers.len().into())],
                ),
                None,
            ),
            _ => (
                t.accent,
                tr("cloud.share.status.published").to_owned(),
                None,
            ),
        };
        let managing = status != share::Status::Published;
        let now = chrono::Utc::now().timestamp();
        let mut card = v_flex()
            .gap(px(8.))
            .p(px(12.))
            .border_1()
            .border_color(t.border)
            .rounded(px(8.))
            .child(
                h_flex()
                    .gap(px(8.))
                    .items_start()
                    .child(
                        div()
                            .flex_none()
                            .mt(px(6.))
                            .size(px(8.))
                            .rounded_full()
                            .bg(dot),
                    )
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(ty.meta))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(headline),
                            )
                            .when_some(hint, |d, hint| {
                                d.child(
                                    div()
                                        .text_size(px(ty.caption))
                                        .text_color(t.muted)
                                        .child(hint),
                                )
                            }),
                    ),
            );
        if managing {
            for reader in readers {
                let waiting = awaited.as_ref().is_some_and(|p| p.endpoint == reader.id);
                card = card.child(
                    h_flex()
                        .gap(px(8.))
                        .child(reader_dot(reader.last_seen.is_some(), t))
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .child(
                                    div()
                                        .text_size(px(ty.meta))
                                        .text_color(t.text)
                                        .child(reader.name.clone()),
                                )
                                .child(
                                    div()
                                        .text_size(px(ty.caption))
                                        .text_color(t.muted)
                                        .child(reader_line(reader, waiting, now)),
                                ),
                        ),
                );
            }
            card = card.child(
                h_flex().justify_end().child(
                    Button::new("cloud-share-manage")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("cloud.share.status.action.manage"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.share_readers = true;
                            s.share_path.clear();
                            cx.notify();
                        })),
                ),
            );
        }
        card.into_any_element()
    }
    /// `ShareReadersStep`: who can read, and the one thing to do about it.
    pub(super) fn share_readers_step(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let readers: Vec<share::Share> = self
            .share_rows()
            .into_iter()
            .filter(|s| s.active())
            .collect();
        let url = cloud_account::environment(cx)
            .map(|e| services::mcp_server_url(e.api()))
            .unwrap_or_default();
        let now = chrono::Utc::now().timestamp();
        let mut page =
            v_flex()
                .gap(px(12.))
                .child(div().text_size(px(ty.meta)).text_color(t.muted).child(
                    if readers.is_empty() {
                        tr("cloud.share.readers.empty").to_owned()
                    } else {
                        tf(
                            "cloud.share.readers.description",
                            &[("count", readers.len().into())],
                        )
                    },
                ));
        for (index, reader) in readers.into_iter().enumerate() {
            let confirming = self.confirm_delete.as_deref() == Some(reader.id.as_str());
            let (ask, stop) = (reader.id.clone(), reader.id.clone());
            let row = h_flex()
                .gap(px(8.))
                .p(px(10.))
                .border_1()
                .border_color(t.border)
                .rounded(px(8.))
                .child(reader_dot(reader.last_seen.is_some(), t))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .text_size(px(ty.meta))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.text)
                                .child(reader.name.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.muted)
                                .child(reader_line(&reader, false, now)),
                        ),
                );
            let row = if confirming {
                row.child(
                    Button::new(("cloud-share-stop", index))
                        .variant(ButtonVariant::SolidDanger)
                        .label(tr("cloud.share.readers.confirmRevoke"))
                        .disabled(self.busy)
                        .on_click(cx.listener(move |s, _, _, cx| s.stop_share(stop.clone(), cx))),
                )
                .child(
                    Button::new(("cloud-share-keep", index))
                        .variant(ButtonVariant::Secondary)
                        .label(tr("common.action.cancel"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.confirm_delete = None;
                            s.stop_failed = false;
                            cx.notify();
                        })),
                )
            } else {
                let copy = url.clone();
                row.when(!url.is_empty(), |row| {
                    row.child(
                        Button::new(("cloud-share-copy", index))
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.share.readers.copyUrl"))
                            .on_click(cx.listener(move |s, _, _, cx| s.copy(copy.clone(), cx))),
                    )
                })
                .child(
                    Button::new(("cloud-share-ask", index))
                        .variant(ButtonVariant::Secondary)
                        .label(tr("cloud.share.readers.revoke"))
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.stop_failed = false;
                            s.confirm_delete = Some(ask.clone());
                            cx.notify();
                        })),
                )
            };
            page = page.child(row);
        }
        if self.stop_failed {
            page = page.child(
                div()
                    .text_size(px(ty.caption))
                    .text_color(t.danger)
                    .child(tr("cloud.share.readers.revokeFailed")),
            );
        }
        page.child(
            h_flex().child(
                Button::new("cloud-share-add")
                    .variant(ButtonVariant::Secondary)
                    .icon(Icon::new("plus").with_size(px(14.)).color(t.muted))
                    .label(tr("cloud.share.readers.add"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.share_readers = false;
                        cx.notify();
                    })),
            ),
        )
        .child(
            h_flex()
                .justify_between()
                .child(
                    Button::new("cloud-share-open-cloud")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("cloud.share.readers.openCloud"))
                        .on_click(cx.listener(|s, _, _, cx| s.select(Section::Contents, cx))),
                )
                .child(
                    Button::new("cloud-share-readers-done")
                        .variant(ButtonVariant::Solid)
                        .label(tr("cloud.share.action.done"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.share_readers = false;
                            s.confirm_delete = None;
                            s.stop_failed = false;
                            cx.notify();
                        })),
                ),
        )
        .into_any_element()
    }
}
