//! `CloudAgentConversation.tsx`: the hosted Agent's conversation through the
//! shared transcript, approval dock and composer. Its runs are projected by
//! `cloudAgentProjection`; it has no configuration, attachments or session
//! preparation, and shows `CloudAgentStatus` instead of the readiness card.
use super::status::{ButtonTone, agent_button};
use super::{AgentChatTabPanel, AgentChatTabPresentation};
use crate::agent::contract::dto::{
    Capabilities, RuntimeCatalogEntry, RuntimeDescriptor, RuntimeInspection, RuntimeReadiness,
    SessionMetadata,
};
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, ReplicaStatus,
};
use crate::features::desktop_agent::infrastructure::cloud::{
    CloudAgentController, CloudAgentState, CloudHistory, LABEL, project_cloud_agent_runs,
};
use crate::features::desktop_agent::ui::agent_chat_view_model::AgentChatViewModel;
use crate::features::desktop_agent::ui::agent_theme::AgentTheme;
use crate::localization::t;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};

/// The hosted runtime's id (`CloudAgentHistory`'s `cloud-pi`).
pub const HOSTED_RUNTIME_ID: &str = "cloud-pi";
/// `iconKey: "puppyone-agent"`.
pub const HOSTED_ICON_KEY: &str = "puppyone-agent";

/// The hosted conversation as the panel's controller state.
pub(super) fn hosted_controller_state(chat: &CloudAgentState) -> AgentControllerState {
    let descriptor = RuntimeDescriptor {
        id: HOSTED_RUNTIME_ID.into(),
        display_name: LABEL.into(),
        icon_key: Some(HOSTED_ICON_KEY.into()),
        ..RuntimeDescriptor::default()
    };
    let readiness = RuntimeReadiness {
        runtime_id: Some(HOSTED_RUNTIME_ID.into()),
        status: "ready".into(),
        selectable: Some(true),
        ..RuntimeReadiness::default()
    };
    let run = chat.runs.last();
    AgentControllerState {
        phase: if chat.running() {
            AgentControllerPhase::Running
        } else {
            AgentControllerPhase::Ready
        },
        initialized: true,
        inspection: Some(RuntimeInspection {
            selected_runtime_id: Some(HOSTED_RUNTIME_ID.into()),
            runtime: Some(descriptor.clone()),
            runtimes: Some(vec![RuntimeCatalogEntry {
                descriptor: descriptor.clone(),
                readiness: readiness.clone(),
            }]),
            readiness: Some(readiness),
            modes: Some(Vec::new()),
            commands: Some(Vec::new()),
            providers: Some(Vec::new()),
            capabilities: Some(Capabilities {
                streaming_text: true,
                manual_approvals: true,
                ..Capabilities::default()
            }),
            ..RuntimeInspection::default()
        }),
        selected_runtime_id: Some(HOSTED_RUNTIME_ID.into()),
        session: chat.session_id.as_ref().map(|id| SessionMetadata {
            id: id.clone(),
            runtime_id: Some(HOSTED_RUNTIME_ID.into()),
            runtime: Some(descriptor.clone()),
            ..SessionMetadata::default()
        }),
        replica_status: ReplicaStatus::Live,
        projection: project_cloud_agent_runs(&chat.runs),
        draft: chat.draft.clone(),
        pending_prompt: chat
            .pending
            .as_ref()
            .filter(|_| chat.submitting)
            .map(|p| p.prompt.clone()),
        submitting: chat.submitting,
        stopping: run.is_some_and(|r| r.stop_requested)
            || chat.resolving.as_deref() == Some("stop"),
        ..Default::default()
    }
}

/// The props `CloudAgentConversation` passes instead of the local policy.
pub(super) fn hosted_view(view: &mut AgentChatViewModel, chat: &CloudAgentState) {
    let running = chat.running();
    let exceptional = exceptional_state(chat).is_some();
    view.show_runtime_launcher = false;
    view.show_status = chat.reconnecting || chat.error.is_some() || exceptional;
    view.startup_loading = chat.loading && chat.runs.is_empty();
    view.working = running;
    view.running = running;
    view.submission_pending = chat.submitting;
    view.composer_disabled = chat.loading || chat.submitting;
    view.configuration_disabled = true;
    view.show_ready_empty_state = !chat.loading && chat.runs.is_empty() && !chat.submitting;
    view.composer_placeholder = t("agent.composer.placeholder.default").into();
    view.pending_submission_id = chat.pending.as_ref().map(|p| p.request_id.clone());
    view.pending_references = Vec::new();
    view.pending_prompt_mentions = Vec::new();
    view.approval_resolving = chat.resolving.is_some();
    view.question = None;
    view.session_controls = Vec::new();
    view.commands = Vec::new();
    view.steer_available = false;
    view.queue_available = false;
    view.reference_capabilities = None;
    view.model_connections = false;
    view.read_only = false;
    view.degraded_recovery = None;
    view.panel_error = None;
}

/// `CloudAgentStatus`'s exceptional run.
fn exceptional_state(chat: &CloudAgentState) -> Option<&str> {
    chat.runs
        .last()
        .map(|run| run.state.as_str())
        .filter(|state| matches!(*state, "conflict" | "outcome_unknown" | "failed"))
}

/// `errorLabelKey(error)`.
fn error_label_key(status: Option<u16>) -> &'static str {
    match status {
        Some(401) => "cloud.auth.signInRequired",
        Some(403) => "cloud.agent.permissionDenied",
        Some(409) => "cloud.agent.busy",
        _ => "cloud.agent.connectionError",
    }
}

/// `CloudAgentWorkbench.update(id)`: the tab's title and status.
pub(super) fn hosted_presentation(
    chat: &CloudAgentState,
    history: &CloudHistory,
) -> AgentChatTabPresentation {
    let titled = |id: &str| {
        history
            .sessions
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| s.title.clone())
            .filter(|t| !t.is_empty())
    };
    let title = chat
        .runs
        .first()
        .map(|run| run.prompt.chars().take(80).collect::<String>())
        .filter(|t| !t.is_empty())
        .or_else(|| chat.session_id.as_deref().and_then(titled))
        .unwrap_or_else(|| LABEL.into());
    let running = chat.running();
    let status = if chat.error.is_some() {
        "error"
    } else if chat.loading {
        "starting"
    } else if running {
        "running"
    } else {
        "idle"
    };
    AgentChatTabPresentation {
        title,
        runtime_label: Some(LABEL.into()),
        runtime_icon_key: Some(HOSTED_ICON_KEY.into()),
        session_id: chat.session_id.clone(),
        status_code: status.into(),
        running: chat.submitting || running,
    }
}

impl AgentChatTabPanel {
    /// The hosted chat, when this tab is one.
    pub fn hosted(&self) -> Option<&CloudAgentController> {
        self.hosted.as_deref()
    }

    /// `CloudAgentStatus`.
    pub(super) fn render_hosted_status(
        &mut self,
        chat: &CloudAgentState,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let mut status = v_flex().flex_shrink_0().gap(px(8.)).px(px(12.)).pt(px(10.));
        if chat.reconnecting {
            status = status.child(
                div()
                    .text_size(px(m.right.caption))
                    .text_color(a.text_subtle)
                    .child(t("agent.lifecycle.reconnecting")),
            );
        }
        if let Some(error) = chat.error.clone() {
            let open = self.diagnostics_open;
            status = status.child(
                v_flex()
                    .gap(px(8.))
                    .px(px(12.))
                    .py(px(10.))
                    .rounded(px(8.))
                    .border_1()
                    .border_color(a.blocking_border)
                    .bg(a.blocking_surface)
                    .child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(a.text)
                            .child(t(error_label_key(chat.error_status))),
                    )
                    .child(
                        div()
                            .id("hosted-diagnostics")
                            .text_size(px(m.right.caption))
                            .text_color(a.text_subtle)
                            .cursor(theme::clickable_cursor())
                            .child(format!(
                                "{} {}",
                                if open { "▾" } else { "▸" },
                                t("agent.header.diagnostics")
                            ))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.diagnostics_open = !s.diagnostics_open;
                                cx.notify();
                            })),
                    )
                    .when(open, |d| {
                        d.child(
                            div()
                                .whitespace_normal()
                                .text_size(px(m.right.caption))
                                .text_color(a.text_muted)
                                .child(error),
                        )
                    })
                    .child(
                        h_flex().child(
                            agent_button(
                                "hosted-retry",
                                t("common.action.retry").into(),
                                ButtonTone::Secondary,
                                false,
                                &a,
                            )
                            .on_click(cx.listener(|s, _, _, _| {
                                if let Some(chat) = s.hosted() {
                                    chat.retry();
                                }
                            })),
                        ),
                    ),
            );
        }
        if let Some(state) = exceptional_state(chat) {
            let code = chat.runs.last().and_then(|run| run.snapshot.code.clone());
            status = status.child(
                v_flex()
                    .gap(px(4.))
                    .text_size(px(m.right.caption))
                    .text_color(a.text_muted)
                    .child(t(&format!("cloud.agent.{state}")))
                    .children(code.map(|code| {
                        div()
                            .text_color(a.text_subtle)
                            .child(format!("{}: {code}", t("agent.header.diagnostics")))
                    })),
            );
        }
        status.into_any_element()
    }
}
