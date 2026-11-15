//! `AgentProviderActivities`: the provider's live notices above the
//! composer, prominent ones in full and quiet ones folded.
use super::agent_theme::AgentTheme;
use crate::agent::contract::dto::{Activity, AgentProjection};
use crate::localization::{format_number, t};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

/// The notices a projection shows: labelled notifications and system
/// activities (not compaction, not a finished sign-in).
pub fn provider_notices(projection: &AgentProjection) -> Vec<Activity> {
    projection
        .activities
        .iter()
        .filter(|activity| {
            let label = !activity.label.is_empty();
            let category = activity.detail.text("category").unwrap_or_default();
            let status = activity.status.as_str();
            label
                && (activity.kind == "notification"
                    || (activity.kind == "system"
                        && category != "compaction"
                        && !(category == "authentication"
                            && ["completed", "succeeded"].contains(&status))))
        })
        .map(|activity| (**activity).clone())
        .collect()
}

#[derive(Default)]
pub struct ProviderNoticesView {
    notices: Vec<Activity>,
    /// The quiet notices are unfolded.
    open: bool,
}

impl ProviderNoticesView {
    pub fn set_projection(&mut self, projection: &AgentProjection, cx: &mut Context<Self>) {
        self.notices = provider_notices(projection);
        cx.notify();
    }
    pub fn is_empty(&self) -> bool {
        self.notices.is_empty()
    }
}

impl Render for ProviderNoticesView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let notices = self.notices.clone();
        let (prominent, quiet): (Vec<Activity>, Vec<Activity>) =
            notices.into_iter().partition(|activity| {
                ["running", "failed", "warning"].contains(&activity.status.as_str())
            });
        let open = self.open;
        let mut column = v_flex().gap(px(4.)).text_size(px(m.right.caption));
        for activity in &prominent {
            let failed = activity.status == "failed";
            column = column.child(
                div()
                    .whitespace_normal()
                    .text_color(if failed { palette.danger } else { a.text_muted })
                    .child(activity.label.clone()),
            );
        }
        if !quiet.is_empty() {
            column = column.child(
                h_flex()
                    .id("agent-provider-notices")
                    .gap(px(4.))
                    .text_color(a.text_subtle)
                    .cursor(theme::clickable_cursor())
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.open = !s.open;
                        cx.notify();
                    }))
                    .child(
                        Icon::new(if open {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        })
                        .with_size(px(12.))
                        .color(a.text_subtle),
                    )
                    .child(t("agent.activity.notifications"))
                    .child(format_number(quiet.len() as i64)),
            );
            if open {
                column = column.children(quiet.iter().map(|activity| {
                    div()
                        .pl(px(16.))
                        .whitespace_normal()
                        .text_color(a.text_subtle)
                        .child(activity.label.clone())
                }));
            }
        }
        column
    }
}
