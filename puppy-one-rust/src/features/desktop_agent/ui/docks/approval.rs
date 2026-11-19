//! `AgentApprovalDock`: the request on top of the approval queue, its
//! command, scope and the decisions the runtime offers.
use super::super::agent_theme::AgentTheme;
use super::super::elements::{ButtonTone, agent_button};
use super::{DockEvent, DocksView};
use crate::agent::contract::dto::{Approval, RecordRef};
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

/// `normalizeApprovalCopy(value)`.
fn normalize_copy(value: &str) -> String {
    crate::text::trim(value)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// `distinctApprovalReason(reason, title)`.
fn distinct_reason(reason: Option<&str>, title: &str) -> Option<String> {
    let reason = reason?;
    let normalized = normalize_copy(reason);
    (!normalized.is_empty() && normalized != normalize_copy(title))
        .then(|| crate::text::trim(reason).to_string())
}

/// `approvalActionLabel(action)`.
fn action_label(action: RecordRef<'_>) -> String {
    let kind = action.text("type").unwrap_or("action");
    let name = action.text("name");
    let target = action.text("path").or_else(|| action.text("command"));
    [Some(name.unwrap_or(kind)), target]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(": ")
}

impl DocksView {
    /// `AgentApprovalDock`.
    pub(super) fn render_approval_dock(
        &mut self,
        approval: &Approval,
        queue_length: usize,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t_ = cx.palette();
        let a = AgentTheme::new(&t_);
        let m = theme::ty();
        let resolving = self.data.approval_resolving;
        let runtime_label = self.data.runtime_label.clone();
        let decisions: Vec<String> = approval.available_decisions.clone();
        let can_allow_for_session = decisions.iter().any(|d| d == "acceptForSession");
        let raw_title = crate::text::trim(&approval.title).to_string();
        let title = if raw_title.is_empty() {
            t("agent.approval.required").to_string()
        } else {
            raw_title
        };
        let reason = distinct_reason(approval.reason.as_deref(), &title);
        let status = if resolving {
            t("agent.approval.resolving").to_string()
        } else if queue_length > 1 {
            tf(
                "agent.approval.pending",
                &[("count", Arg::Number(queue_length as i64))],
            )
        } else {
            t("agent.approval.waiting").to_string()
        };
        let command = approval.command.clone().filter(|c| !c.is_empty());
        let cwd = approval.cwd.clone().filter(|c| !c.is_empty());
        let network = approval
            .network_approval_context
            .as_ref()
            .map(|context| format!("{}://{}", context.protocol, context.host));
        let grant_root = approval.grant_root.clone().filter(|g| !g.is_empty());
        let actions: Vec<String> = if command.is_none() {
            approval
                .command_actions
                .iter()
                .take(5)
                .map(|action| action_label(action.view()))
                .collect()
        } else {
            Vec::new()
        };
        let policy = approval.policy_change_requested;
        let meta = |text: String| {
            let selector = format!("agent-approval-detail:{text}");
            div()
                .debug_selector(move || selector)
                .text_size(px(m.left.meta))
                .line_height(px(m.left.meta * 1.5))
                .text_color(a.text_muted)
                .whitespace_normal()
                .child(text)
        };
        let code = |text: String| {
            let selector = format!("agent-approval-detail:{text}");
            div()
                .debug_selector(move || selector)
                .font_family(theme::MONO)
                .text_size(px(m.right.code))
                .line_height(px(m.right.code * 1.5))
                .text_color(a.text_muted)
                .whitespace_normal()
                .child(text)
        };
        let show_details = command.is_some()
            || cwd.is_some()
            || network.is_some()
            || grant_root.is_some()
            || !actions.is_empty()
            || reason.is_some()
            || policy;
        let mut details = v_flex().gap(px(6.)).mt(px(8.)).pl(px(32.)).min_w_0();
        if let Some(command) = command {
            details = details.child(code(command));
        }
        if let Some(cwd) = cwd {
            details = details.child(meta(tf(
                "agent.approval.inPath",
                &[("path", Arg::Text(bidi_isolate(&cwd)))],
            )));
        }
        if let Some(network) = network {
            details = details
                .child(meta(t("agent.approval.networkTarget").into()))
                .child(code(network));
        }
        if let Some(root) = grant_root {
            details = details
                .child(meta(t("agent.approval.writeScope").into()))
                .child(code(root));
        }
        for action in actions {
            details = details.child(meta(format!("• {action}")));
        }
        if let Some(reason) = reason {
            details = details.child(meta(reason));
        }
        if policy {
            details = details.child(meta(tf(
                "agent.approval.policyNote",
                &[("agent", Arg::Text(bidi_isolate(&runtime_label)))],
            )));
        }
        let request_id = approval.request_id.clone();
        let resolve = |decision: &'static str| {
            let request_id = request_id.clone();
            cx.listener(move |_: &mut Self, _, _, cx| {
                cx.emit(DockEvent::Approve {
                    request_id: request_id.clone(),
                    decision,
                });
            })
        };
        let mut footer = h_flex().justify_end().flex_wrap().gap(px(4.)).mt(px(10.));
        footer = footer.child(
            agent_button(
                "approval-deny",
                t("agent.approval.deny").into(),
                ButtonTone::Quiet,
                resolving,
                &a,
            )
            .debug_selector(|| "agent-approval:decline".into())
            .on_click(resolve("decline")),
        );
        if can_allow_for_session {
            footer = footer.child(
                agent_button(
                    "approval-session",
                    t("agent.approval.allowSession").into(),
                    ButtonTone::Secondary,
                    resolving,
                    &a,
                )
                .debug_selector(|| "agent-approval:acceptForSession".into())
                .on_click(resolve("acceptForSession")),
            );
        }
        footer = footer.child(
            agent_button(
                "approval-once",
                t("agent.approval.allowOnce").into(),
                ButtonTone::Primary,
                resolving,
                &a,
            )
            .debug_selector(|| "agent-approval:accept".into())
            .on_click(resolve("accept")),
        );
        self.dock_card(&a)
            .child(
                h_flex()
                    .gap(px(8.))
                    .min_w_0()
                    .child(
                        div()
                            .size(px(24.))
                            .flex_shrink_0()
                            .rounded(px(6.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(a.blocking_icon_surface)
                            .child(
                                Icon::new("shield-alert")
                                    .with_size(px(14.))
                                    .stroke(1.7)
                                    .color(a.blocking_icon),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .font_weight(FontWeight::MEDIUM)
                            .whitespace_normal()
                            .debug_selector({
                                let selector = format!("agent-approval-title:{title}");
                                move || selector
                            })
                            .child(title),
                    )
                    .child(
                        div()
                            .debug_selector({
                                let selector = format!("agent-approval-status:{status}");
                                move || selector
                            })
                            .flex_shrink_0()
                            .text_size(px(m.left.meta))
                            .text_color(a.text_subtle)
                            .child(status),
                    ),
            )
            .when(show_details, |d| d.child(details))
            .child(footer)
            .child(crate::ui::scrollbar::vertical(
                "agent-interaction-dock-scrollbar",
                &self.scroll,
            ))
            .into_any_element()
    }
}
