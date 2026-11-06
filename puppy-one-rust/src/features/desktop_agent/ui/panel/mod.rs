//! `ui/AgentChatTabPanel.tsx` with `AgentPanelLayout`: one Agent tab over
//! its project-owned [`AgentSessionController`]. Every admission and display
//! policy comes from the chat view model of the controller's snapshot; this
//! view only owns presentation memory (disclosures, pickers, scroll).
mod composer;
mod compute;
mod docks;
pub mod elements;
#[cfg(feature = "dev-capture")]
mod fixture;
mod status;
mod transcript;

use super::agent_chat_view_model::{
    AgentChatRuntime, AgentChatViewModel, AgentChatViewOptions, derive_agent_chat_runtime,
    derive_agent_chat_view_model,
};
use super::agent_tool_group_presentation::AgentTranscriptRow;
use crate::agent::contract::js;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentSessionPreparation,
};
use crate::features::desktop_agent::application::agent_session_controller::AgentSessionController;
use crate::features::desktop_agent::domain::agent_session_controls::AgentSessionControlId;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::form_input::{InputEvent, TextInput};
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

actions!(agent_panel, [SubmitPrompt]);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-enter", SubmitPrompt, Some("AgentChatPanel")),
        KeyBinding::new("ctrl-enter", SubmitPrompt, Some("AgentChatPanel")),
    ]);
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
    /// `onPresentationChange`.
    Presentation(AgentChatTabPresentation),
    /// `onOpenFile(path)`.
    OpenFile(String),
    /// `onOpenModelConnections`.
    OpenModelConnections,
    /// `onOpenAccount`.
    OpenAccount,
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
    composer: Entity<TextInput>,
    /// The controller draft the composer last showed (text, mentions).
    shown_draft: (String, Vec<Value>),
    transcript: ListState,
    rows: Vec<AgentTranscriptRow>,
    parts: HashMap<String, Value>,
    row_signatures: Vec<(String, blake3::Hash)>,
    /// `seenPartIdsRef`: parts that already entered once do not animate.
    follow: bool,
    unread: usize,
    transcript_width: f32,
    /// Standalone shell disclosures (`rowId:partId`).
    expanded: HashSet<String>,
    /// `AgentToolActivityGroup`'s single open step, per row.
    group_selected: HashMap<String, String>,
    open_folds: HashSet<String>,
    run_summary_open: bool,
    history_notice_open: bool,
    diagnostics_open: bool,
    recovery_details_open: bool,
    /// `pendingConnectionModel`.
    pending_connection_model: Option<String>,
    picker_open: Option<AgentSessionControlId>,
    picker_active: Option<usize>,
    picker_query: Entity<TextInput>,
    picker_focus: FocusHandle,
    picker_scroll: ScrollHandle,
    dock_scroll: ScrollHandle,
    /// `AgentQuestionDock`'s answers per question index, per request.
    question_answers: HashMap<String, HashMap<usize, Vec<String>>>,
    question_inputs: HashMap<String, Entity<TextInput>>,
    logo_turns: u32,
    provider_notices_open: bool,
    last_presentation: Option<AgentChatTabPresentation>,
    /// `useModelConnections()`'s snapshot, its last revision, and whether a
    /// send asked for compute access (`computeAccessPrompt`).
    compute: Option<compute::ComputeSnapshot>,
    compute_revision: Option<String>,
    compute_access_prompt: bool,
    /// `usePaymentsExperience()`.
    payments: bool,
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
        let composer = cx.new(|cx| {
            TextInput::new(
                crate::localization::t("agent.composer.placeholder.default"),
                true,
                64_000,
                window,
                cx,
            )
        });
        composer.update(cx, |input, _| {
            // One 1.5em line at rest; Enter sends, Shift+Enter breaks the line.
            let size = crate::theme::ty().left.content;
            input.prompt_text = Some((size, size * 1.5));
            input.min_height = size * 1.5;
            input.appearance = false;
            input.submit_on_enter = true;
            input.token_renderer = Some(composer::token_renderer());
        });
        cx.subscribe_in(
            &composer,
            window,
            |s, _, event: &InputEvent, window, cx| match event {
                InputEvent::Submit => s.submit(window, cx),
                InputEvent::Changed => s.composer_changed(cx),
            },
        )
        .detach();
        let picker_query = cx.new(|cx| {
            let mut input = TextInput::new("", false, 200, window, cx);
            input.appearance = false;
            input
        });
        cx.observe(&picker_query, |s: &mut Self, _, cx| {
            s.picker_active = None;
            cx.notify()
        })
        .detach();
        let transcript = ListState::new(0, ListAlignment::Top, px(300.));
        let weak = cx.entity().downgrade();
        transcript.set_scroll_handler(move |event, _, cx| {
            let _ = weak.update(cx, |s, cx| {
                s.follow = event.visible_range.end >= event.count;
                if s.follow {
                    s.unread = 0;
                }
                cx.notify();
            });
        });
        let mut panel = Self {
            controller,
            presented: true,
            command_target: true,
            hidden_runtime_ids,
            composer,
            shown_draft: Default::default(),
            transcript,
            rows: Vec::new(),
            parts: HashMap::new(),
            row_signatures: Vec::new(),
            follow: true,
            unread: 0,
            transcript_width: 0.,
            expanded: HashSet::new(),
            group_selected: HashMap::new(),
            open_folds: HashSet::new(),
            run_summary_open: false,
            history_notice_open: false,
            diagnostics_open: false,
            recovery_details_open: false,
            pending_connection_model: None,
            picker_open: None,
            picker_active: None,
            picker_query,
            picker_focus: cx.focus_handle(),
            picker_scroll: ScrollHandle::new(),
            dock_scroll: ScrollHandle::new(),
            question_answers: HashMap::new(),
            question_inputs: HashMap::new(),
            logo_turns: 0,
            provider_notices_open: false,
            last_presentation: None,
            compute: None,
            compute_revision: None,
            compute_access_prompt: false,
            payments: false,
            _store: Box::new(unsubscribe),
        };
        panel.reload_model_connections(cx);
        panel.on_state_change(window, cx);
        panel
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
            cx.notify();
        }
    }

    /// `hiddenRuntimeIds`.
    pub fn set_hidden_runtime_ids(&mut self, hidden: Vec<String>, cx: &mut Context<Self>) {
        self.hidden_runtime_ids = hidden;
        cx.notify();
    }

    fn state(&self) -> AgentControllerState {
        self.controller.get_snapshot()
    }

    fn runtime_view(&self, state: &AgentControllerState) -> AgentChatRuntime {
        derive_agent_chat_runtime(state, &self.hidden_runtime_ids)
    }

    fn view_model(&self, state: &AgentControllerState) -> AgentChatViewModel {
        let runtime = self.runtime_view(state);
        let compute = self.compute_view(&runtime.runtime_models, state.selected_model.as_deref());
        derive_agent_chat_view_model(
            state,
            runtime,
            &AgentChatViewOptions {
                presented: self.presented,
                pending_connection_model: self.pending_connection_model.clone(),
                compute_ready: compute.ready,
                compute_access_required: compute.access_required.map(str::to_string),
                preferences_ready: true,
            },
        )
    }

    /// The controller published a new snapshot.
    fn on_state_change(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let state = self.state();
        self.sync_composer(&state, window, cx);
        let view = self.view_model(&state);
        // `useAgentRoutingPreferences`: the command target initializes its
        // controller.
        if self.command_target && !state.initialized && state.phase == AgentControllerPhase::Idle {
            drop(self.controller.initialize(false));
        }
        // `useAgentSessionPreparation`: prepare an empty native session only
        // while the active panel is routable.
        if self.command_target
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
            cx.emit(AgentChatPanelEvent::Presentation(presentation));
        }
        self.refresh_transcript(&state, &view);
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
        if !composer::can_submit(&state, &view) || !view.routing_ready {
            return;
        }
        self.compute_access_prompt = false;
        self.follow = true;
        drop(self.controller.submit(&state.draft));
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
            cx.notify();
            return;
        }
        match id {
            AgentSessionControlId::Model => self.controller.select_model(Some(&value)),
            AgentSessionControlId::Effort => self.controller.select_effort(Some(&value)),
            AgentSessionControlId::Mode => self.controller.select_mode(Some(&value)),
        }
    }
}

impl Render for AgentChatTabPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let state = self.state();
        let view = self.view_model(&state);
        let panel = v_flex()
            .id("agent-chat-panel")
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
        let conversation = self.render_conversation(&state, &view, window, cx);
        let dock = (!view.startup_loading).then(|| self.render_dock(&state, &view, window, cx));
        panel.children(status).child(conversation).children(dock)
    }
}

/// `entry.runtimeId ?? entry.provider` of a session value.
pub(super) fn text_of(value: &Value) -> String {
    js::string_or_empty(Some(value))
}
