//! Port of `AgentProviderActivities` (`provider-activities.css`): quiet,
//! bounded live notices above the composer. Running, failed and warning
//! notices show as lines; the rest collect under a closed "Notifications N"
//! disclosure. Compaction and completed sign-ins are not notices; there are
//! no timers, toasts, transcript rows or tool glyphs.
use super::*;
use crate::agent::domain::agent_session_model::{ActivityKind, ProviderActivity};
use crate::localization::t as tr;
use crate::ui::{appearance::ActiveAppearance, components::tooltip};
use gpui_kit::base::{h_flex, v_flex};

/// The notices `AgentProviderActivities` shows, in order.
pub(crate) fn notices(activities: &[ProviderActivity]) -> Vec<&ProviderActivity> {
    activities
        .iter()
        .filter(|a| {
            !a.label.is_empty()
                && match a.kind {
                    ActivityKind::Notification => true,
                    ActivityKind::System => {
                        let category = a.category.as_deref();
                        category != Some("compaction")
                            && !(category == Some("authentication")
                                && matches!(a.status.as_str(), "completed" | "succeeded"))
                    }
                }
        })
        .collect()
}
fn prominent(activity: &ProviderActivity) -> bool {
    matches!(activity.status.as_str(), "running" | "failed" | "warning")
}

impl AgentChat {
    pub(super) fn render_provider_activities(
        &self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let snapshot = self.session.snapshot();
        let notices = notices(&snapshot.activities);
        if notices.is_empty() {
            return None;
        }
        let t = cx.palette();
        let m = crate::theme::ty();
        let open = window.use_keyed_state("agent-provider-notices-open", cx, |_, _| false);
        let expanded = *open.read(cx);
        // `.desktop-agent-provider-activities p { margin: 4px 0; pre-wrap }`:
        // adjacent margins collapse to 4px, which flex gaps reproduce.
        let line = |text: &str| {
            div()
                .w_full()
                .min_w_0()
                .whitespace_normal()
                .child(SharedString::from(text.to_owned()))
        };
        let lines: Vec<AnyElement> = notices
            .iter()
            .filter(|a| prominent(a))
            .map(|a| {
                line(&a.label)
                    .when(a.status == "failed", |d| d.text_color(t.danger))
                    .into_any_element()
            })
            .collect();
        let quiet: Vec<&ProviderActivity> =
            notices.iter().copied().filter(|a| !prominent(a)).collect();
        let mut region = v_flex()
            .id("agent-provider-activities")
            .w_full()
            .min_w_0()
            .flex_shrink_0()
            .max_h(px(160.))
            .overflow_y_scroll()
            .px(px(8.))
            .text_color(t.subtle)
            .text_size(px(m.right.caption))
            // The panel's 1.6 line height.
            .line_height(px(m.right.caption * 1.6))
            .when(!lines.is_empty(), |d| {
                d.child(v_flex().my(px(4.)).gap(px(4.)).children(lines))
            });
        if !quiet.is_empty() {
            let toggle = open.clone();
            region = region.child(
                // `<details><summary>`: Chromium's disclosure marker, closed
                // until opened.
                h_flex()
                    .id("agent-provider-notices")
                    .py(px(4.))
                    .gap(px(4.5))
                    .cursor(crate::theme::clickable_cursor())
                    .child(
                        svg()
                            .path(if expanded {
                                "icons/details-open.svg"
                            } else {
                                "icons/details-closed.svg"
                            })
                            .w(px(if expanded { 8. } else { 7. }))
                            .h(px(if expanded { 7. } else { 8. }))
                            .flex_shrink_0()
                            .text_color(t.subtle),
                    )
                    // `formatNumber` of at most 32: the same digits in every
                    // product locale.
                    .child(format!(
                        "{} {}",
                        tr("agent.activity.notifications"),
                        quiet.len()
                    ))
                    .on_click(move |_, _, cx| {
                        toggle.update(cx, |open, cx| {
                            *open = !*open;
                            cx.notify();
                        })
                    }),
            );
            if expanded {
                // `.desktop-agent-provider-notices { padding: 4px 0 }` around
                // the lines' own 4px margins.
                region = region.child(v_flex().py(px(8.)).gap(px(4.)).children(
                    quiet.iter().enumerate().map(|(i, a)| {
                        let notice = line(&a.label).id(("agent-provider-notice", i));
                        match a.source.clone().filter(|s| !s.is_empty()) {
                            Some(source) => notice.tooltip(tooltip(source)).into_any_element(),
                            None => notice.into_any_element(),
                        }
                    }),
                ));
            }
        }
        Some(region.into_any_element())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    fn activity(kind: ActivityKind, status: &str, category: Option<&str>) -> ProviderActivity {
        ProviderActivity {
            id: format!("{kind:?}{status}{category:?}"),
            kind,
            label: "label".into(),
            status: status.into(),
            category: category.map(str::to_owned),
            source: None,
            sequence: 0,
        }
    }
    #[test]
    fn compaction_and_finished_sign_ins_are_not_notices() {
        let all = [
            activity(ActivityKind::Notification, "completed", None),
            activity(ActivityKind::System, "running", Some("compaction")),
            activity(ActivityKind::System, "completed", Some("authentication")),
            activity(ActivityKind::System, "running", Some("authentication")),
            activity(ActivityKind::System, "failed", Some("status")),
            ProviderActivity {
                label: String::new(),
                ..activity(ActivityKind::Notification, "failed", None)
            },
        ];
        let shown = notices(&all);
        assert_eq!(shown.len(), 3);
        assert_eq!(shown.iter().filter(|a| prominent(a)).count(), 2);
    }
}
