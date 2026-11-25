//! `CloudAgentConversation.tsx`: the hosted Agent's conversation through
//! the shared chat views (transcript, approval dock, composer, empty state
//! and notices). Its runs are projected by `cloudAgentProjection`; it has no
//! configuration, attachments or session preparation, and shows
//! `CloudAgentStatus` instead of the readiness card. Every request goes to
//! its [`CloudAgentController`].
use super::{CloudAgentController, CloudAgentState, CloudHistory, LABEL, project_cloud_agent_runs};
use crate::agent::contract::dto::{
    Capabilities, RuntimeCatalogEntry, RuntimeDescriptor, RuntimeInspection, RuntimeReadiness,
    SessionMetadata,
};
use crate::features::desktop_agent::{
    AgentChatTabPresentation, AgentChatViewModel, AgentControllerPhase, AgentControllerState,
    AgentTheme, ButtonTone, ComposerEvent, ComposerInput, ComposerView, DockEvent, DocksInput,
    DocksView, EmptyStateView, ProviderNoticesView, ReplicaStatus, SessionPickers, SubmitPrompt,
    TranscriptEvent, TranscriptInput, TranscriptView, agent_button, can_submit,
    default_chat_view_model,
};
use crate::localization::t;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use std::rc::Rc;

/// The hosted runtime's id (`CloudAgentHistory`'s `cloud-pi`).
pub const HOSTED_RUNTIME_ID: &str = "cloud-pi";
/// `iconKey: "puppyone-agent"`.
pub const HOSTED_ICON_KEY: &str = "puppyone-agent";

/// The hosted conversation as the panel's controller state.
fn hosted_controller_state(chat: &CloudAgentState) -> AgentControllerState {
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
fn hosted_view(view: &mut AgentChatViewModel, chat: &CloudAgentState) {
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

/// Classify a hosted Agent refusal strictly by `(status, allowlisted code)` so
/// an unrelated HTTP 409 (e.g. unconfigured model, unready project, stale
/// workbench) is never mislabeled as `cloud.agent.busy`.
fn error_label_key(status: Option<u16>, code: Option<&str>) -> &'static str {
    match (status, code) {
        (Some(401), _) => "cloud.auth.signInRequired",
        (Some(403), _) => "cloud.agent.permissionDenied",
        (Some(409), Some("agent_session_busy")) => "cloud.agent.busy",
        (Some(409), Some("agent_model_unconfigured")) => "native.cloudAgent.modelUnconfigured",
        (Some(409), Some("project_agent_not_ready")) => "native.cloudAgent.projectNotReady",
        (Some(409), Some("agent_unavailable")) => "native.cloudAgent.unavailable",
        (Some(409), Some("agent_request_conflict")) => "native.cloudAgent.requestConflict",
        (
            Some(409 | 404),
            Some(
                "interactive_workspace_required"
                | "workbench_not_running"
                | "workbench_generation_changed"
                | "workbench_not_found",
            ),
        ) => "native.cloudAgent.workspaceChanged",
        (Some(503), Some("managed_agent_inference_disabled" | "cloud_workbench_unavailable")) => {
            "native.cloudAgent.serviceUnavailable"
        }
        (Some(409), _) => "native.cloudAgent.conflict",
        _ => "cloud.agent.connectionError",
    }
}

fn error_diagnostic_lines(chat: &CloudAgentState, error: String) -> Vec<String> {
    let mut lines = Vec::new();
    match (chat.error_status, chat.error_code) {
        (Some(status), Some(code)) => lines.push(format!("HTTP {status} · {code}")),
        (Some(status), None) => lines.push(format!("HTTP {status}")),
        (None, Some(code)) => lines.push(code.to_owned()),
        (None, None) => {}
    }
    if let Some(request_id) = &chat.error_request_id {
        lines.push(format!("Request ID: {request_id}"));
    }
    if !error.is_empty() {
        lines.push(error);
    }
    lines
}

/// `CloudAgentWorkbench.update(id)`: the tab's title and status.
fn hosted_presentation(chat: &CloudAgentState, history: &CloudHistory) -> AgentChatTabPresentation {
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

/// What the conversation asks of its tab.
pub enum ConversationEvent {
    /// The tab's title or status changed.
    Presentation,
    /// `onOpenFile(path)`.
    OpenFile(String),
}
impl EventEmitter<ConversationEvent> for CloudAgentConversation {}

/// One hosted chat tab's view.
pub struct CloudAgentConversation {
    chat: Rc<CloudAgentController>,
    presented: bool,
    transcript: Entity<TranscriptView>,
    composer: Entity<ComposerView>,
    docks: Entity<DocksView>,
    empty_state: Entity<EmptyStateView>,
    notices: Entity<ProviderNoticesView>,
    diagnostics_open: bool,
    last_presentation: Option<AgentChatTabPresentation>,
}

impl CloudAgentConversation {
    /// The conversation over `chat`, which wakes `changes`.
    pub fn new(
        chat: CloudAgentController,
        changes: async_channel::Receiver<()>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.spawn_in(window, async move |this, cx| {
            while changes.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, window, cx| s.on_state_change(window, cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        let transcript = cx.new(TranscriptView::new);
        cx.subscribe(&transcript, |_, _, event, cx| match event {
            TranscriptEvent::OpenFile(path) => cx.emit(ConversationEvent::OpenFile(path.clone())),
        })
        .detach();
        // The hosted Agent has no session controls; the pickers stay closed.
        let pickers = cx.new(|cx| SessionPickers::new(window, cx));
        let composer = cx.new(|cx| ComposerView::new(pickers, window, cx));
        cx.subscribe_in(&composer, window, |s, _, event, window, cx| {
            s.composer_event(event, window, cx)
        })
        .detach();
        let docks = cx.new(|_| DocksView::default());
        cx.subscribe(&docks, |s: &mut Self, _, event, cx| s.dock_event(event, cx))
            .detach();
        let mut conversation = Self {
            chat: Rc::new(chat),
            presented: true,
            transcript,
            composer,
            docks,
            empty_state: cx.new(|_| EmptyStateView::default()),
            notices: cx.new(|_| ProviderNoticesView::default()),
            diagnostics_open: false,
            last_presentation: None,
        };
        conversation.on_state_change(window, cx);
        conversation
    }

    /// The hosted chat.
    pub fn chat(&self) -> &CloudAgentController {
        &self.chat
    }

    /// What the tab shows (`CloudAgentWorkbench.update(id)`).
    pub fn presentation(&self) -> Option<&AgentChatTabPresentation> {
        self.last_presentation.as_ref()
    }

    /// Whether the tab is shown.
    pub fn set_presentation(
        &mut self,
        presented: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.presented != presented {
            self.presented = presented;
            self.on_state_change(window, cx);
        }
    }

    /// The conversation as a chat's state and view model.
    fn read(&self) -> (CloudAgentState, AgentControllerState, AgentChatViewModel) {
        let snapshot = self.chat.snapshot();
        let state = hosted_controller_state(&snapshot);
        let mut view = default_chat_view_model(&state, self.presented);
        hosted_view(&mut view, &snapshot);
        (snapshot, state, view)
    }

    /// The hosted chat changed.
    fn on_state_change(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (snapshot, state, view) = self.read();
        let composer = ComposerInput::of(&state, &view, |_| None);
        self.composer
            .update(cx, |c, cx| c.set_input(composer, window, cx));
        let presentation = hosted_presentation(&snapshot, &self.chat.hub().history());
        if self.last_presentation.as_ref() != Some(&presentation) {
            self.last_presentation = Some(presentation);
            cx.emit(ConversationEvent::Presentation);
        }
        let transcript = TranscriptInput::of(&state, &view);
        self.transcript
            .update(cx, |t, cx| t.set_input(transcript, cx));
        let docks = DocksInput::of(&state, &view);
        self.docks.update(cx, |d, cx| d.set_input(docks, cx));
        let (icon, label) = (
            view.runtime.runtime_icon_key.clone(),
            view.runtime.runtime_label.clone(),
        );
        self.empty_state
            .update(cx, |e, cx| e.set_runtime(icon, label, cx));
        self.notices
            .update(cx, |n, cx| n.set_projection(&state.projection, cx));
        cx.notify();
    }

    /// `handleSubmit`: the draft goes through the hosted admission.
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .composer
            .update(cx, |input, cx| input.composing(window, cx))
        {
            return;
        }
        let (_, state, view) = self.read();
        if !can_submit(&state, &view) || !view.routing_ready {
            return;
        }
        self.transcript.update(cx, |t, _| t.follow_latest());
        self.chat.submit(state.draft.clone());
        cx.notify();
    }

    /// The composer's requests the hosted Agent takes: its draft, send and
    /// stop. It has no references, attachments or commands.
    fn composer_event(
        &mut self,
        event: &ComposerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            ComposerEvent::DraftChanged { text, .. } => self.chat.set_draft(text.clone()),
            ComposerEvent::Submit => self.submit(window, cx),
            ComposerEvent::Stop => self.chat.stop(),
            _ => {}
        }
        cx.notify();
    }

    /// `controller.approve(approval.requestId, decision === "accept")`.
    fn dock_event(&mut self, event: &DockEvent, cx: &mut Context<Self>) {
        if let DockEvent::Approve {
            request_id,
            decision,
        } = event
        {
            self.chat.approve(request_id.clone(), *decision == "accept");
        }
        cx.notify();
    }

    /// `desktop-agent-dock-region`: the pending approval, the provider's
    /// notices and the composer, which stays while the conversation loads.
    fn render_dock(&self, view: &AgentChatViewModel, cx: &App) -> Div {
        let mut dock = v_flex()
            .flex_shrink_0()
            .pt(px(12.))
            .px(px(12.))
            .pb(px(12.))
            .gap(px(8.));
        if view.approval.is_some() || view.question.is_some() {
            dock = dock.child(self.docks.clone());
        }
        if !self.notices.read(cx).is_empty() {
            dock = dock.child(self.notices.clone());
        }
        dock.child(self.composer.clone())
    }

    /// `CloudAgentStatus`.
    fn render_status(&mut self, chat: &CloudAgentState, cx: &mut Context<Self>) -> AnyElement {
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
            let diagnostics = error_diagnostic_lines(chat, error);
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
                            .child(t(error_label_key(chat.error_status, chat.error_code))),
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
                        d.child(v_flex().gap(px(4.)).children(diagnostics.into_iter().map(
                            |line| {
                                div()
                                    .whitespace_normal()
                                    .text_size(px(m.right.caption))
                                    .text_color(a.text_muted)
                                    .child(line)
                            },
                        )))
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
                            .on_click(cx.listener(|s, _, _, _| s.chat.retry())),
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

impl Render for CloudAgentConversation {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let (snapshot, _, view) = self.read();
        let status = view.show_status.then(|| self.render_status(&snapshot, cx));
        let empty = view
            .show_ready_empty_state
            .then(|| div().absolute().inset_0().child(self.empty_state.clone()));
        let conversation = div()
            .relative()
            .flex_1()
            .min_h_0()
            .child(self.transcript.clone())
            .children(empty);
        v_flex()
            .id("agent-chat-panel")
            .key_context("AgentChatPanel")
            .size_full()
            .min_h_0()
            .bg(t.agent())
            .text_size(px(theme::ty().left.content))
            .text_color(t.text)
            .on_action(cx.listener(|s, _: &SubmitPrompt, window, cx| s.submit(window, cx)))
            .children(status)
            .child(conversation)
            .child(self.render_dock(&view, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn error_label_only_reports_busy_for_agent_session_busy() {
        assert_eq!(
            error_label_key(Some(409), Some("agent_session_busy")),
            "cloud.agent.busy"
        );
        assert_eq!(
            error_label_key(Some(409), Some("agent_model_unconfigured")),
            "native.cloudAgent.modelUnconfigured"
        );
        assert_eq!(
            error_label_key(Some(409), Some("project_agent_not_ready")),
            "native.cloudAgent.projectNotReady"
        );
        assert_eq!(
            error_label_key(Some(409), Some("agent_unavailable")),
            "native.cloudAgent.unavailable"
        );
        assert_eq!(
            error_label_key(Some(409), Some("workbench_not_running")),
            "native.cloudAgent.workspaceChanged"
        );
        assert_eq!(
            error_label_key(Some(503), Some("managed_agent_inference_disabled")),
            "native.cloudAgent.serviceUnavailable"
        );
        // An unknown HTTP 409 must never falsely claim an active task.
        assert_eq!(
            error_label_key(Some(409), None),
            "native.cloudAgent.conflict"
        );
        assert_eq!(
            error_label_key(Some(409), Some("unknown_conflict")),
            "native.cloudAgent.conflict"
        );
    }

    #[test]
    fn diagnostics_surface_status_code_and_request_id() {
        let state = CloudAgentState {
            error_status: Some(409),
            error_code: Some("agent_model_unconfigured"),
            error_request_id: Some("req-xyz".into()),
            ..Default::default()
        };
        assert_eq!(
            error_diagnostic_lines(&state, "The service rejected this request.".into()),
            vec![
                "HTTP 409 · agent_model_unconfigured".to_owned(),
                "Request ID: req-xyz".to_owned(),
                "The service rejected this request.".to_owned(),
            ]
        );
    }
}
