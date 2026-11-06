//! `ui/agentChatViewModel.ts`: all admission and display policy derived
//! from one controller snapshot.
use super::agent_history_presentation::agent_history_notice;
use super::agent_panel_presentation::{readiness_status_code, session_status_code};
use crate::agent::contract::js;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentDisplayRecoveryStage, AgentSessionPreparation,
    AgentSubmissionStage, ReplicaStatus,
};
use crate::features::desktop_agent::domain::agent_backend_routing::{
    list_agent_runtimes, list_visible_agent_runtimes,
};
use crate::features::desktop_agent::domain::agent_degraded_recovery::{
    ActiveAgentDegradedRecovery, active_agent_degraded_recovery,
};
use crate::features::desktop_agent::domain::agent_session_controls::{
    AgentSessionControl, AgentSessionControlId, AgentSessionControlSelection,
    derive_agent_session_controls,
};
use crate::localization::t;
use serde_json::{Value, json};

/// `AgentChatViewOptions`.
#[derive(Clone, Debug, Default)]
pub struct AgentChatViewOptions {
    pub presented: bool,
    pub pending_connection_model: Option<String>,
    pub compute_ready: bool,
    pub compute_access_required: Option<String>,
    pub preferences_ready: bool,
}

/// `deriveAgentChatRuntime(...)`.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentChatRuntime {
    pub agent_runtime_selected: bool,
    pub agent_runtimes: Vec<Value>,
    pub runtime_label: String,
    pub runtime_icon_key: Option<String>,
    pub runtime_models: Vec<Value>,
}

/// `presentation`.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentChatPresentation {
    pub title: String,
    pub runtime_label: Option<String>,
    pub runtime_icon_key: Option<String>,
    pub session_id: Option<String>,
    pub status_code: String,
    pub running: bool,
}

/// `deriveAgentChatViewModel(...)`.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentChatViewModel {
    pub runtime: AgentChatRuntime,
    pub loading: bool,
    pub failed: bool,
    pub has_committed_transcript: bool,
    pub submission_pending: bool,
    pub running: bool,
    pub startup_loading: bool,
    pub configuration_disabled: bool,
    pub compute_disabled: bool,
    pub working: bool,
    pub submission_stage: Option<AgentSubmissionStage>,
    pub unavailable: bool,
    pub compute_onboarding: bool,
    pub routing_ready: bool,
    pub can_request_compute_access: bool,
    pub has_status: bool,
    pub readiness: Option<Value>,
    pub reference_capabilities: Option<Value>,
    pub degraded_recovery: Option<ActiveAgentDegradedRecovery>,
    pub presentation: AgentChatPresentation,
    pub composer_placeholder: String,
    pub composer_disabled: bool,
    pub show_ready_empty_state: bool,
    pub show_runtime_launcher: bool,
    pub show_status: bool,
    pub panel_error: Option<Value>,
    pub model_connections: bool,
    pub read_only: bool,
    pub session_controls: Vec<AgentSessionControl>,
    pub commands: Vec<Value>,
    pub steer_available: bool,
    pub queue_available: bool,
    pub pending_submission_id: Option<String>,
    pub pending_references: Vec<Value>,
    pub pending_prompt_mentions: Vec<Value>,
    pub approval: Option<Value>,
    pub approval_resolving: bool,
    pub question: Option<Value>,
    pub question_resolving: bool,
}

fn non_empty(value: &Value) -> Option<String> {
    value.as_str().filter(|v| !v.is_empty()).map(str::to_string)
}

/// `deriveAgentChatRuntime(state, hiddenRuntimeIds, t)`: the runtime
/// inventory, also the input to the routing-preference hook.
pub fn derive_agent_chat_runtime(
    state: &AgentControllerState,
    hidden_runtime_ids: &[String],
) -> AgentChatRuntime {
    let inspection = state.inspection.as_ref();
    let session_runtime = state
        .session
        .as_ref()
        .map(|s| &s["runtime"])
        .filter(|r| js::truthy(r));
    let inspection_runtime = inspection.map(|i| &i["runtime"]).filter(|r| js::truthy(r));
    let catalog_runtime = inspection
        .and_then(|i| i["runtimes"].as_array())
        .and_then(|runtimes| {
            runtimes.iter().find(|entry| {
                state
                    .selected_runtime_id
                    .as_deref()
                    .is_some_and(|id| entry["descriptor"]["id"] == id)
            })
        })
        .map(|entry| &entry["descriptor"]);
    let runtime = session_runtime.or(inspection_runtime).or(catalog_runtime);
    // A direct recipe remains bound even when its runtime needs setup. Only
    // the chooser filters not-installed runtimes from subsequent selection.
    let agent_runtime_selected = list_agent_runtimes(inspection).iter().any(|entry| {
        let id = entry["descriptor"]["id"].as_str().unwrap_or_default();
        state.selected_runtime_id.as_deref() == Some(id)
            && (state.session.is_some() || !hidden_runtime_ids.iter().any(|hidden| hidden == id))
    });
    let runtime_icon_key = state
        .selected_runtime_id
        .as_ref()
        .filter(|id| !id.is_empty())
        .map(|id| {
            runtime
                .and_then(|r| non_empty(&r["iconKey"]))
                .unwrap_or_else(|| id.clone())
        });
    AgentChatRuntime {
        agent_runtime_selected,
        agent_runtimes: list_visible_agent_runtimes(inspection, hidden_runtime_ids),
        runtime_label: runtime
            .and_then(|r| non_empty(&r["displayName"]))
            .unwrap_or_else(|| t("agent.name").to_string()),
        runtime_icon_key,
        runtime_models: if agent_runtime_selected {
            inspection
                .and_then(|i| i["models"].as_array().cloned())
                .unwrap_or_default()
        } else {
            Vec::new()
        },
    }
}

struct Activity {
    loading: bool,
    failed: bool,
    has_committed_transcript: bool,
    submission_pending: bool,
    running: bool,
    startup_loading: bool,
    configuration_disabled: bool,
    compute_disabled: bool,
    working: bool,
    submission_stage: Option<AgentSubmissionStage>,
}

struct Policy {
    unavailable: bool,
    compute_onboarding: bool,
    routing_ready: bool,
    can_request_compute_access: bool,
    has_status: bool,
}

/// `deriveAgentChatViewModel(state, runtime, options, t)`.
pub fn derive_agent_chat_view_model(
    state: &AgentControllerState,
    runtime: AgentChatRuntime,
    options: &AgentChatViewOptions,
) -> AgentChatViewModel {
    let activity = derive_activity(state, options.presented);
    let readiness = state
        .inspection
        .as_ref()
        .map(|i| i["readiness"].clone())
        .filter(Value::is_object);
    let unavailable = readiness.as_ref().is_some_and(|r| r["status"] != "ready");
    let compute_onboarding = is_compute_onboarding(state, &activity);
    let routing_ready = is_routing_ready(state, &runtime, options);
    let can_request_compute_access = can_request_access(
        state,
        &runtime,
        options,
        unavailable,
        compute_onboarding,
        activity.failed,
    );
    let has_status = has_panel_status(state, unavailable, compute_onboarding, activity.failed);
    let degraded_recovery = active_agent_degraded_recovery(&state.projection);
    let policy = Policy {
        unavailable,
        compute_onboarding,
        routing_ready,
        can_request_compute_access,
        has_status,
    };
    let approval = state.projection.approvals.first().map(|a| (**a).clone());
    let question = state.projection.questions.first().map(|q| (**q).clone());
    let (session_controls, commands, steer_available, queue_available) =
        derive_composer_configuration(state);
    let (pending_submission_id, pending_references, pending_prompt_mentions) =
        derive_pending_transcript(state);
    AgentChatViewModel {
        presentation: derive_presentation(state, &runtime, degraded_recovery.is_some()),
        composer_placeholder: composer_placeholder(state, &runtime, &activity, &policy),
        composer_disabled: composer_disabled(state, &activity, &policy),
        show_ready_empty_state: show_ready_empty_state(state, &activity, &policy),
        show_runtime_launcher: state.initialized
            && state.inspection.is_some()
            && !runtime.agent_runtime_selected
            && !activity.loading
            && !activity.failed,
        show_status: has_status || state.stop_request.is_some(),
        panel_error: panel_error(state, &runtime.runtime_label),
        model_connections: state.capability("modelConnections"),
        read_only: state.capability("readOnly"),
        reference_capabilities: derive_reference_capabilities(state),
        approval_resolving: reply_in_flight(approval.as_ref()),
        question_resolving: reply_in_flight(question.as_ref()),
        approval,
        question,
        session_controls,
        commands,
        steer_available,
        queue_available,
        pending_submission_id,
        pending_references,
        pending_prompt_mentions,
        degraded_recovery,
        readiness,
        runtime,
        loading: activity.loading,
        failed: activity.failed,
        has_committed_transcript: activity.has_committed_transcript,
        submission_pending: activity.submission_pending,
        running: activity.running,
        startup_loading: activity.startup_loading,
        configuration_disabled: activity.configuration_disabled,
        compute_disabled: activity.compute_disabled,
        working: activity.working,
        submission_stage: activity.submission_stage,
        unavailable,
        compute_onboarding,
        routing_ready,
        can_request_compute_access,
        has_status,
    }
}

fn derive_activity(state: &AgentControllerState, presented: bool) -> Activity {
    let loading = matches!(
        state.phase,
        AgentControllerPhase::Discovering
            | AgentControllerPhase::Restoring
            | AgentControllerPhase::Creating
    );
    let failed = matches!(
        state.phase,
        AgentControllerPhase::Failed | AgentControllerPhase::RuntimeExited
    );
    let projection = &state.projection;
    let has_committed_transcript = !projection.rows.is_empty()
        || !projection.parts.is_empty()
        || !projection.messages.is_empty()
        || !projection.activities.is_empty();
    let submission_pending = state.submitting
        || state
            .pending_prompt
            .as_deref()
            .is_some_and(|p| !p.is_empty());
    let running = state.running_turn_id().is_some();
    Activity {
        loading,
        failed,
        has_committed_transcript,
        submission_pending,
        running,
        startup_loading: presented
            && (!state.initialized || loading)
            && !state
                .pending_prompt
                .as_deref()
                .is_some_and(|p| !p.is_empty())
            && !has_committed_transcript,
        configuration_disabled: loading || submission_pending,
        compute_disabled: loading || submission_pending || running,
        working: state.submitting || running,
        submission_stage: submission_stage(state, submission_pending),
    }
}

/// `submissionStage(state, pending)`.
fn submission_stage(state: &AgentControllerState, pending: bool) -> Option<AgentSubmissionStage> {
    if !pending || state.running_turn_id().is_some() {
        return None;
    }
    // Main admission replaces the preview before the native turn starts. Keep
    // feedback for attachment-only inputs; preview text is not a lifecycle
    // signal.
    if state.session.is_none() || state.session_preparation == AgentSessionPreparation::Preparing {
        return Some(AgentSubmissionStage::PreparingSession);
    }
    Some(AgentSubmissionStage::StartingTurn)
}

fn is_compute_onboarding(state: &AgentControllerState, activity: &Activity) -> bool {
    // First-use setup is onboarding. Saved routes, history, credentials errors
    // and actual runtime failures retain recovery UI.
    state.capability("modelConnections")
        && state
            .inspection
            .as_ref()
            .is_some_and(|i| i["readiness"]["code"] == "RUNTIME_SETUP_REQUIRED")
        && state.selected_model.is_none()
        && state.session.is_none()
        && !activity.has_committed_transcript
        && state.error.is_none()
        && !activity.failed
}

fn is_routing_ready(
    state: &AgentControllerState,
    runtime: &AgentChatRuntime,
    options: &AgentChatViewOptions,
) -> bool {
    if !runtime.agent_runtime_selected
        || options.pending_connection_model.is_some()
        || !options.preferences_ready
    {
        return false;
    }
    if state.capability("modelConnections") && !options.compute_ready {
        return false;
    }
    if !state.capability("modelSelection") {
        return true;
    }
    state.selected_model.as_deref().is_some_and(|selected| {
        !selected.is_empty()
            && runtime
                .runtime_models
                .iter()
                .any(|model| model["model"] == selected)
    })
}

fn can_request_access(
    state: &AgentControllerState,
    runtime: &AgentChatRuntime,
    options: &AgentChatViewOptions,
    unavailable: bool,
    compute_onboarding: bool,
    failed: bool,
) -> bool {
    state.capability("modelConnections")
        && runtime.agent_runtime_selected
        && options
            .compute_access_required
            .as_deref()
            .is_some_and(|access| !access.is_empty())
        && options.pending_connection_model.is_none()
        && !failed
        && state.error.is_none()
        && (compute_onboarding || !unavailable)
}

fn has_panel_status(
    state: &AgentControllerState,
    unavailable: bool,
    onboarding: bool,
    failed: bool,
) -> bool {
    let recovery_visible = state
        .display_recovery
        .is_some_and(|recovery| recovery.stage != AgentDisplayRecoveryStage::Silent);
    let non_recovery_error = state.error.is_some()
        && !(state.error_code() == Some("event-gap") && state.display_recovery.is_some());
    (unavailable && !onboarding) || failed || non_recovery_error || recovery_visible
}

fn composer_disabled(state: &AgentControllerState, activity: &Activity, policy: &Policy) -> bool {
    state.capability("readOnly")
        || matches!(
            state.replica_status,
            ReplicaStatus::Stale | ReplicaStatus::Subscribing
        )
        || activity.loading
        || (policy.unavailable && !policy.can_request_compute_access)
        || activity.failed
        || (!policy.routing_ready && !policy.can_request_compute_access)
        || !state.projection.approvals.is_empty()
        || !state.projection.questions.is_empty()
}

fn show_ready_empty_state(
    state: &AgentControllerState,
    activity: &Activity,
    policy: &Policy,
) -> bool {
    let has_submitted_conversation = activity.has_committed_transcript
        || state
            .pending_prompt
            .as_deref()
            .is_some_and(|p| !p.is_empty())
        || state.pending_intent.is_some()
        || !state.projection.approvals.is_empty()
        || !state.projection.questions.is_empty();
    (policy.routing_ready || policy.compute_onboarding)
        && state.initialized
        && !activity.loading
        && !policy.has_status
        && !has_submitted_conversation
        && agent_history_notice(&state.projection).is_none()
        && !state
            .projection
            .get("connectionStatus")
            .is_some_and(js::truthy)
}

fn composer_placeholder(
    state: &AgentControllerState,
    runtime: &AgentChatRuntime,
    activity: &Activity,
    policy: &Policy,
) -> String {
    let key = if policy.compute_onboarding {
        "agent.composer.placeholder.default"
    } else if policy.unavailable || activity.failed {
        "agent.composer.placeholder.preparing"
    } else if !runtime.agent_runtime_selected {
        "agent.composer.placeholder.chooseAgent"
    } else if state.capability("modelSelection") && state.selected_model.is_none() {
        "agent.composer.placeholder.chooseModel"
    } else if !state.projection.rows.is_empty() || !state.projection.messages.is_empty() {
        "agent.composer.placeholder.followUp"
    } else {
        "agent.composer.placeholder.default"
    };
    t(key).to_string()
}

fn derive_presentation(
    state: &AgentControllerState,
    runtime: &AgentChatRuntime,
    degraded: bool,
) -> AgentChatPresentation {
    let mut status_code =
        readiness_status_code(state.inspection.as_ref().map(|i| &i["readiness"])).to_string();
    if let Some(session) = &state.session {
        status_code = session_status_code(session["terminalState"].as_str());
    }
    if degraded {
        status_code = "needs-attention".into();
    }
    let title = state
        .session
        .as_ref()
        .and_then(|s| non_empty(&s["title"]))
        .unwrap_or_else(|| {
            if runtime.agent_runtime_selected {
                runtime.runtime_label.clone()
            } else {
                t("agent.header.newChat").to_string()
            }
        });
    AgentChatPresentation {
        title,
        runtime_label: runtime
            .agent_runtime_selected
            .then(|| runtime.runtime_label.clone()),
        runtime_icon_key: runtime.runtime_icon_key.clone(),
        session_id: state.session_id().map(str::to_string),
        status_code,
        running: state.running_turn_id().is_some(),
    }
}

fn panel_error(state: &AgentControllerState, runtime: &str) -> Option<Value> {
    if let Some(error) = &state.error {
        return Some(error.clone());
    }
    (state.phase == AgentControllerPhase::RuntimeExited)
        .then(|| json!({ "code": "runtime-exited", "params": { "runtime": runtime } }))
}

fn derive_reference_capabilities(state: &AgentControllerState) -> Option<Value> {
    let inspection = state.inspection.as_ref()?;
    let base = inspection["capabilities"]["referenceInputs"].clone();
    if !js::truthy(&base) {
        return None;
    }
    if !state.capability("modelConnections") {
        return Some(base);
    }
    let images = inspection["models"]
        .as_array()
        .and_then(|models| {
            models.iter().find(|model| {
                state
                    .selected_model
                    .as_deref()
                    .is_some_and(|selected| model["model"] == selected)
            })
        })
        .map(|model| model["modelCapabilities"]["images"] == "supported")
        .unwrap_or(false);
    let mut capabilities = base;
    capabilities["attachments"]["image"]["accepted"] = Value::Bool(images);
    Some(capabilities)
}

fn derive_composer_configuration(
    state: &AgentControllerState,
) -> (Vec<AgentSessionControl>, Vec<Value>, bool, bool) {
    let controls = derive_agent_session_controls(
        state.inspection.as_ref(),
        AgentSessionControlSelection {
            selected_model: state.selected_model.as_deref(),
            selected_effort: state.selected_effort.as_deref(),
            selected_mode: state.selected_mode.as_deref(),
        },
    );
    let session_controls = if state.capability("modelConnections") {
        controls
            .into_iter()
            .filter(|control| control.id != AgentSessionControlId::Model)
            .collect()
    } else {
        controls
    };
    let commands = if state.capability("slashCommands") {
        state
            .inspection
            .as_ref()
            .and_then(|i| i["commands"].as_array().cloned())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    (
        session_controls,
        commands,
        state.capability("steer"),
        state.capability("queue"),
    )
}

fn derive_pending_transcript(
    state: &AgentControllerState,
) -> (Option<String>, Vec<Value>, Vec<Value>) {
    let intent = state.pending_intent.as_ref();
    let mut references = intent
        .and_then(|i| i["references"].as_array().cloned())
        .unwrap_or_default();
    if state.pending_prompt.is_none() {
        references = Vec::new();
    }
    (
        intent.and_then(|i| non_empty(&i["id"])),
        references,
        intent
            .and_then(|i| i["promptMentions"].as_array().cloned())
            .unwrap_or_default(),
    )
}

/// `replyInFlight(status)`.
fn reply_in_flight(interaction: Option<&Value>) -> bool {
    interaction
        .and_then(|i| i["replyStatus"].as_str())
        .is_some_and(|status| ["dispatching", "accepted", "outcome-unknown"].contains(&status))
}
