//! `ui/AgentChatTabPanel.tsx` with `AgentPanelLayout`: one Agent tab over
//! its project-owned [`AgentSessionController`]. Every admission and display
//! policy comes from the chat view model of the controller's snapshot; this
//! view only owns presentation memory (disclosures, pickers, scroll).
//!
//! The panel composes the shared chat views (transcript, docks, composer,
//! empty state, notices); the hosted Agent's conversation composes the same
//! views in `features/cloud`.
mod compute;
mod dock;
#[cfg(feature = "dev-capture")]
mod fixture;
mod ingestion;
mod launcher;
mod routing;
mod status;
#[cfg(all(test, feature = "dev-capture"))]
mod tests;
mod view_model;

use super::agent_chat_view_model::{
    AgentChatRuntime, AgentChatViewModel, derive_agent_chat_runtime,
};
use super::composer::{ComposerEvent, ComposerInput, ComposerView, can_submit};
use super::docks::{DockEvent, DocksInput, DocksView};
use super::empty_state::EmptyStateView;
use super::pickers::{PickerEvent, SessionPickers};
use super::provider_notices::ProviderNoticesView;
use super::transcript::{TranscriptEvent, TranscriptInput, TranscriptView};
use crate::agent::contract::protocol::ApprovalDecision;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentSessionPreparation,
};
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControlId;
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use std::rc::Rc;

pub use routing::AgentRouting;
pub use view_model::default_chat_view_model;

actions!(agent_panel, [SubmitPrompt]);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([KeyBinding::new(
        "secondary-enter",
        SubmitPrompt,
        Some("AgentChatPanel"),
    )]);
}

/// `AgentChatTabPresentation`: what the Workbench item shows for this tab.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentChatTabPresentation {
    pub title: String,
    pub runtime_label: Option<String>,
    pub runtime_icon_key: Option<String>,
    pub session_id: Option<String>,
    pub status_code: String,
    pub running: bool,
}

/// Events for the hosting Workbench item.
pub enum AgentChatPanelEvent {
    /// `onPresentationChange`: [`AgentChatTabPanel::presentation`] changed.
    Presentation,
    /// `onOpenFile(path)`.
    OpenFile(String),
    /// `onOpenModelConnections`.
    OpenModelConnections,
    /// `onOpenAccount`.
    OpenAccount,
    /// `onPreferredRuntimeChange(runtimeId)`.
    PreferredRuntime(Option<String>),
    /// `onPreferredRouteChange(route)`.
    PreferredRoute(crate::features::settings::AgentRoutePatch),
}

impl EventEmitter<AgentChatPanelEvent> for AgentChatTabPanel {}

/// `AgentChatTabPanel`.
pub struct AgentChatTabPanel {
    controller: AgentSessionController,
    /// `presented` / `commandTarget`.
    presented: bool,
    command_target: bool,
    /// The user's Active Chat visibility settings.
    hidden_runtime_ids: Vec<String>,
    /// `AgentComposer`, and the session pickers it shares with
    /// `BuiltInAgentCompute`.
    composer: Entity<ComposerView>,
    pickers: Entity<SessionPickers>,
    /// Asks the panel to hand the composer its part again, after a change
    /// of the panel's own policy (routing, compute, hidden runtimes).
    refresh: tokio::sync::mpsc::UnboundedSender<()>,
    /// The conversation (`AgentTranscript`).
    transcript: Entity<TranscriptView>,
    diagnostics_open: bool,
    recovery_details_open: bool,
    /// `pendingConnectionModel`.
    pending_connection_model: Option<String>,
    /// `AgentApprovalDock` and `AgentQuestionDock`.
    docks: Entity<DocksView>,
    /// `AgentEmptyState` and `AgentProviderActivities`.
    empty_state: Entity<EmptyStateView>,
    notices: Entity<ProviderNoticesView>,
    last_presentation: Option<AgentChatTabPresentation>,
    /// `useModelConnections()`'s snapshot, its last revision, and whether a
    /// send asked for compute access (`computeAccessPrompt`).
    compute: Option<compute::ComputeSnapshot>,
    compute_revision: Option<String>,
    compute_access_prompt: bool,
    /// The app's compute wallet, as it is now (`snapshot.managed`).
    wallet: Option<compute::ManagedCompute>,
    /// `usePaymentsExperience()`.
    payments: bool,
    /// The user's routing preferences (`preferredRuntimeId`, `preferredRoute`).
    routing: AgentRouting,
    /// The pixel lab's UI state, until its conversation shows.
    #[cfg(feature = "dev-capture")]
    lab: Option<fixture::LabState>,
    _store: Box<dyn FnOnce()>,
}

impl AgentChatTabPanel {
    pub fn new(
        controller: AgentSessionController,
        hidden_runtime_ids: Vec<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (notify, mut changes) = tokio::sync::mpsc::unbounded_channel::<()>();
        let unsubscribe = controller.subscribe(Rc::new(move || {
            let _ = notify.send(());
        }));
        cx.spawn_in(window, async move |this, cx| {
            while changes.recv().await.is_some() {
                // Coalesce a burst of patches into one view update.
                while changes.try_recv().is_ok() {}
                if this
                    .update_in(cx, |s, window, cx| s.on_state_change(window, cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        let mut panel = Self::build(
            controller,
            hidden_runtime_ids,
            Box::new(unsubscribe),
            window,
            cx,
        );
        panel.watch_wallet(cx);
        panel.reload_model_connections(cx);
        panel.on_state_change(window, cx);
        panel
    }

    fn build(
        controller: AgentSessionController,
        hidden_runtime_ids: Vec<String>,
        store: Box<dyn FnOnce()>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (refresh, mut refreshes) = tokio::sync::mpsc::unbounded_channel::<()>();
        cx.spawn_in(window, async move |this, cx| {
            while refreshes.recv().await.is_some() {
                while refreshes.try_recv().is_ok() {}
                let synced = this.update_in(cx, |s, window, cx| {
                    let state = s.state();
                    let view = s.view_model(&state);
                    s.sync_composer(&state, &view, window, cx);
                    s.sync_views(&state, &view, cx);
                });
                if synced.is_err() {
                    break;
                }
            }
        })
        .detach();
        let pickers = cx.new(|cx| SessionPickers::new(window, cx));
        cx.subscribe(&pickers, |s: &mut Self, _, event, cx| match event {
            PickerEvent::Select { id, value } => s.select_session_control(*id, value.clone(), cx),
        })
        .detach();
        cx.observe(&pickers, |_, _, cx| cx.notify()).detach();
        let composer = cx.new(|cx| ComposerView::new(pickers.clone(), window, cx));
        cx.subscribe_in(&composer, window, |s, _, event, window, cx| {
            s.composer_event(event, window, cx)
        })
        .detach();
        let docks = cx.new(|_| DocksView::default());
        cx.subscribe(&docks, |s: &mut Self, _, event, cx| s.dock_event(event, cx))
            .detach();
        let transcript = cx.new(TranscriptView::new);
        cx.subscribe(&transcript, |s: &mut Self, _, event, cx| match event {
            TranscriptEvent::OpenFile(path) => s.open_file(path.clone(), cx),
        })
        .detach();
        Self {
            controller,
            presented: true,
            command_target: true,
            hidden_runtime_ids,
            composer,
            pickers,
            refresh,
            transcript,
            diagnostics_open: false,
            recovery_details_open: false,
            pending_connection_model: None,
            docks,
            empty_state: cx.new(|_| EmptyStateView::default()),
            notices: cx.new(|_| ProviderNoticesView::default()),
            last_presentation: None,
            compute: None,
            compute_revision: None,
            compute_access_prompt: false,
            wallet: None,
            payments: false,
            routing: AgentRouting::default(),
            #[cfg(feature = "dev-capture")]
            lab: None,
            _store: store,
        }
    }

    /// What the Workbench item shows (`onPresentationChange`).
    pub fn presentation(&self) -> Option<&AgentChatTabPresentation> {
        self.last_presentation.as_ref()
    }

    /// The tab's controller.
    pub fn controller(&self) -> &AgentSessionController {
        &self.controller
    }

    /// `presented` / `commandTarget` from the Workbench item.
    pub fn set_presentation(
        &mut self,
        presented: bool,
        command_target: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.presented == presented && self.command_target == command_target {
            return;
        }
        self.presented = presented;
        self.command_target = command_target;
        self.on_state_change(window, cx);
    }

    /// `usePaymentsExperience()`: whether PuppyOne compute is a route.
    pub fn set_payments(&mut self, payments: bool, cx: &mut Context<Self>) {
        if self.payments != payments {
            self.payments = payments;
            self.refresh_views();
            cx.notify();
        }
    }

    /// `hiddenRuntimeIds`.
    pub fn set_hidden_runtime_ids(&mut self, hidden: Vec<String>, cx: &mut Context<Self>) {
        self.hidden_runtime_ids = hidden;
        self.refresh_views();
        cx.notify();
    }

    fn state(&self) -> AgentControllerState {
        self.controller.get_snapshot()
    }

    fn runtime_view(&self, state: &AgentControllerState) -> AgentChatRuntime {
        derive_agent_chat_runtime(state, &self.hidden_runtime_ids)
    }

    fn view_model(&self, state: &AgentControllerState) -> AgentChatViewModel {
        view_model::chat_view_model(
            state,
            &view_model::ChatPolicy {
                hidden_runtime_ids: &self.hidden_runtime_ids,
                presented: self.presented,
                pending_connection_model: self.pending_connection_model.clone(),
                compute: self.compute.as_ref(),
                payments: self.payments,
                compute_access_prompt: self.compute_access_prompt,
                routing: &self.routing,
            },
        )
    }

    /// The controller published a new snapshot.
    fn on_state_change(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let state = self.state();
        let view = self.view_model(&state);
        self.sync_composer(&state, &view, window, cx);
        // `useAgentRoutingPreferences`: the command target initializes its
        // controller.
        if self.command_target && !state.initialized && state.phase == AgentControllerPhase::Idle {
            drop(self.controller.initialize(false));
        }
        self.apply_routing_preferences(cx);
        let state = self.state();
        let view = self.view_model(&state);
        // The seeded prompt is sent once, when the chat first settles, and
        // only if it can be sent then; otherwise it stays a draft.
        if self.controller.has_pending_initial_auto_submit()
            && state.initialized
            && !view.loading
            && routing::pending_preferences(&state, &view.runtime.runtime_models, &self.routing)
                .ready()
            && let Some(prompt) = self.controller.consume_initial_auto_submit()
            && view.routing_ready
            && state.phase == AgentControllerPhase::Ready
            && !view.unavailable
        {
            self.compute_access_prompt = false;
            self.transcript.update(cx, |t, _| t.follow_latest());
            drop(self.controller.submit(&prompt));
        }
        // `useAgentSessionPreparation`: prepare an empty native session only
        // while the active panel is routable.
        if self.command_target
            && !self.controller.has_pending_initial_auto_submit()
            && view.routing_ready
            && state.initialized
            && state.phase == AgentControllerPhase::Ready
            && state.session.is_none()
            && state.session_preparation == AgentSessionPreparation::Idle
        {
            drop(self.controller.prepare_session());
        }
        let presentation = AgentChatTabPresentation {
            title: view.presentation.title.clone(),
            runtime_label: view.presentation.runtime_label.clone(),
            runtime_icon_key: view.presentation.runtime_icon_key.clone(),
            session_id: view.presentation.session_id.clone(),
            status_code: view.presentation.status_code.clone(),
            running: view.presentation.running,
        };
        if self.last_presentation.as_ref() != Some(&presentation) {
            self.last_presentation = Some(presentation.clone());
            cx.emit(AgentChatPanelEvent::Presentation);
        }
        self.sync_views(&state, &view, cx);
        #[cfg(feature = "dev-capture")]
        self.apply_lab_state(cx);
        cx.notify();
    }

    /// `handleSubmit`.
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .composer
            .update(cx, |input, cx| input.composing(window, cx))
        {
            return;
        }
        let state = self.state();
        let view = self.view_model(&state);
        if !view.routing_ready && view.can_request_compute_access {
            self.compute_access_prompt = true;
            cx.notify();
            return;
        }
        if !can_submit(&state, &view) || !view.routing_ready {
            return;
        }
        self.compute_access_prompt = false;
        self.transcript.update(cx, |t, _| t.follow_latest());
        drop(self.controller.submit(&state.draft));
        cx.notify();
    }

    /// The composer's part of the chat (`AgentComposer`'s props).
    fn sync_composer(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let controller = self.controller.clone();
        let input = ComposerInput::of(state, view, |id| controller.get_reference_preview_url(id));
        self.composer
            .update(cx, |c, cx| c.set_input(input, window, cx));
    }

    /// The transcript's and the docks' part of the chat.
    fn sync_views(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) {
        let transcript = TranscriptInput::of(state, view);
        self.transcript
            .update(cx, |t, cx| t.set_input(transcript, cx));
        let docks = DocksInput::of(state, view);
        self.docks.update(cx, |d, cx| d.set_input(docks, cx));
        let (icon, label) = (
            view.runtime.runtime_icon_key.clone(),
            view.runtime.runtime_label.clone(),
        );
        self.empty_state
            .update(cx, |e, cx| e.set_runtime(icon, label, cx));
        self.notices
            .update(cx, |n, cx| n.set_projection(&state.projection, cx));
    }

    /// `AgentApprovalDock` / `AgentQuestionDock`: the person decided.
    fn dock_event(&mut self, event: &DockEvent, cx: &mut Context<Self>) {
        match event {
            DockEvent::Approve { decision, .. } => {
                if let Some(decision) = ApprovalDecision::parse(decision) {
                    drop(self.controller.resolve_approval(decision));
                }
            }
            DockEvent::Answer(resolution) => {
                drop(self.controller.resolve_question(resolution.clone()))
            }
        }
        cx.notify();
    }

    /// The panel's own policy (routing, compute, hidden runtimes, a pending
    /// model connection) changed what its views show.
    fn refresh_views(&self) {
        let _ = self.refresh.send(());
    }

    /// `AgentComposer`'s callbacks.
    fn composer_event(
        &mut self,
        event: &ComposerEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            ComposerEvent::DraftChanged {
                text,
                mentions,
                removed,
            } => {
                for id in removed {
                    self.controller.remove_reference(id);
                }
                self.controller.set_draft_document(text, mentions);
            }
            ComposerEvent::RemoveReference(id) => self.controller.remove_reference(id),
            ComposerEvent::Submit => self.submit(window, cx),
            ComposerEvent::Stop => drop(self.controller.stop()),
            ComposerEvent::Paste(pasted) => self.paste_files(pasted, cx),
            ComposerEvent::PickFiles => self.pick_external_files(window, cx),
            ComposerEvent::PickWorkspace => drop(self.controller.pick_workspace_references()),
            ComposerEvent::Command(name) => self
                .controller
                .set_draft_document(&format!("/{name} "), &[]),
        }
        cx.notify();
    }

    fn open_file(&mut self, path: String, cx: &mut Context<Self>) {
        cx.emit(AgentChatPanelEvent::OpenFile(path));
    }

    fn select_session_control(
        &mut self,
        id: AgentSessionControlId,
        value: String,
        cx: &mut Context<Self>,
    ) {
        if id == AgentSessionControlId::Model
            && self
                .controller
                .requires_new_model_connection_session(Some(&value))
        {
            self.pending_connection_model = Some(value);
            self.refresh_views();
            cx.notify();
            return;
        }
        self.select_routed_control(id, value, cx);
    }
}

impl Render for AgentChatTabPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let state = self.state();
        let view = self.view_model(&state);
        let panel = v_flex()
            .id("agent-chat-panel")
            .debug_selector(|| "agent-chat-panel".into())
            .key_context("AgentChatPanel")
            .size_full()
            .min_h_0()
            .bg(t.agent())
            .text_size(px(crate::theme::ty().left.content))
            .text_color(t.text)
            .on_action(cx.listener(|s, _: &SubmitPrompt, window, cx| s.submit(window, cx)));
        if view.show_runtime_launcher {
            return panel.child(self.render_launcher(&view, cx));
        }
        let panel = panel
            .on_drop(cx.listener(|s, paths: &ExternalPaths, _, cx| {
                s.add_external_paths(paths.paths().to_vec(), cx)
            }))
            .on_drop(
                cx.listener(|s, drag: &crate::ui::resource_drag::ResourceDrag, _, cx| {
                    if let Some(paths) = drag.local_paths() {
                        s.add_workspace_paths(paths, cx);
                    }
                }),
            );
        let status = view
            .show_status
            .then(|| self.render_status(&state, &view, cx));
        // `desktop-agent-conversation-region` and the empty-state overlay.
        let empty = view.show_ready_empty_state.then(|| {
            div()
                .debug_selector(|| "agent-empty-state".into())
                .absolute()
                .inset_0()
                .child(self.empty_state.clone())
        });
        let conversation = div()
            .relative()
            .flex_1()
            .min_h_0()
            .child(self.transcript.clone())
            .children(empty);
        let dock = (!view.startup_loading).then(|| self.render_dock(&state, &view, cx));
        panel.children(status).child(conversation).children(dock)
    }
}
