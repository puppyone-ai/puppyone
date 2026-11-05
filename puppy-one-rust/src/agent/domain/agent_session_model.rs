//! `domain/agent-session-model.mjs`: the Main-owned session record. Its
//! execution facts are read from the SessionActor; everything else is the
//! application's mutable bookkeeping for one live conversation.
use super::agent_control_view::project_agent_control_view;
use super::agent_event_workspace_paths::normalize_agent_event_workspace_paths;
use super::agent_session_actor::{ActorOptions, SessionActor};
use super::agent_session_control::is_agent_idle_disconnect;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::is_agent_event_envelope;
use crate::agent::contract::event_schema::sanitize_agent_event_envelope;
use crate::agent::contract::js::{self, Obj};
use crate::agent::contract::runtime_schema::{
    normalize_capability_snapshot, sanitize_agent_runtime_descriptor,
};
use crate::agent::contract::types::AgentEventView;
use crate::agent::event_loop::{SharedTask, Timer};
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::sender::Sender;
use serde_json::Value;
use std::cell::{Ref, RefCell, RefMut};
use std::rc::Rc;

const MAX_REPLAY_EVENTS: usize = 1_000;

/// One reference claim: leased tokens and private paths to scrub.
#[derive(Clone, Debug, Default)]
pub struct ReferenceClaim {
    pub tokens: Vec<String>,
    pub paths: Vec<(String, String)>,
}

/// The mutable fields of a session record.
pub struct SessionState {
    pub id: String,
    pub workspace_root: String,
    pub runtime_id: String,
    pub runtime: Value,
    pub provider_session_id: Option<String>,
    pub adapter: Option<Rc<dyn AgentRuntimeAdapter>>,
    /// `referenceClaims` (insertion-ordered).
    pub reference_claims: Vec<(String, ReferenceClaim)>,
    /// `privateReferencePaths`: private path → display name.
    pub private_reference_paths: Vec<(String, String)>,
    pub active_reference_tokens: Vec<String>,
    pub account: Value,
    pub providers: Vec<Value>,
    pub models: Vec<Value>,
    pub modes: Vec<Value>,
    pub commands: Vec<Value>,
    pub capabilities: Option<Value>,
    pub selected_model: Option<String>,
    pub selected_effort: Option<String>,
    pub selected_mode: Option<String>,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub persist_timer: Option<Timer>,
    pub interrupt_fallback_timer: Option<Timer>,
    pub closing: bool,
    pub closed: bool,
    pub lifecycle_event_seen: bool,
    pub source_scope_id: Option<String>,
    pub history_coverage: Option<String>,
    pub model_binding_revision: Option<String>,
    pub native_persistence_confirmed: bool,
    pub bootstrap_events: Option<Vec<Value>>,
    pub bootstrap_error: Option<AgentError>,
    pub close_promise: Option<SharedTask<AgentResult<()>>>,
}

/// `session`: shared by every coordinator; identity is the allocation
/// (`sessionStore.isCurrent(session)` compares objects).
pub struct AgentSession {
    pub actor: SessionActor,
    pub instance_id: String,
    pub owner_id: u64,
    pub sender: Sender,
    state: RefCell<SessionState>,
}

pub type SessionRef = Rc<AgentSession>;

/// `createAgentSessionRecord(input)`.
pub struct SessionRecordInput {
    pub id: String,
    pub owner_id: u64,
    pub sender: Sender,
    pub workspace_root: String,
    pub runtime_id: String,
    pub runtime: Option<Value>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub mode: Option<String>,
    pub events: Vec<Value>,
    pub sequence: i64,
    pub created_at: Option<String>,
    pub title: Option<String>,
    pub terminal_state: Option<String>,
}

/// `createAgentSessionRecord(input)`.
pub fn create_agent_session_record(input: SessionRecordInput) -> AgentResult<SessionRef> {
    let restored: Vec<Value> = {
        let valid: Vec<&Value> = input
            .events
            .iter()
            .filter(|e| is_agent_event_envelope(e))
            .collect();
        valid[valid.len().saturating_sub(MAX_REPLAY_EVENTS)..]
            .iter()
            .map(|event| {
                sanitize_agent_event_envelope(event).map(|sanitized| {
                    normalize_agent_event_workspace_paths(&sanitized, &input.workspace_root)
                })
            })
            .collect::<Result<_, _>>()?
    };
    let highest = restored.iter().map(|e| e.sequence()).max().unwrap_or(0);
    let actor = SessionActor::new(ActorOptions {
        events: restored,
        sequence: normalize_sequence(input.sequence).max(highest),
        terminal_state: Some(input.terminal_state.unwrap_or_else(|| "idle".into())),
        clock: None,
    })?;
    let runtime = input.runtime.unwrap_or_else(|| {
        Obj::new()
            .set("id", input.runtime_id.as_str())
            .set("displayName", input.runtime_id.as_str())
            .build()
    });
    let title = input.title.filter(|t| !t.is_empty()).unwrap_or_else(|| {
        format!(
            "{} session",
            runtime["displayName"]
                .as_str()
                .filter(|n| !n.is_empty())
                .unwrap_or("Agent")
        )
    });
    let now = js::now_iso();
    Ok(Rc::new(AgentSession {
        actor,
        instance_id: uuid::Uuid::new_v4().to_string(),
        owner_id: input.owner_id,
        sender: input.sender,
        state: RefCell::new(SessionState {
            id: input.id,
            workspace_root: input.workspace_root,
            runtime_id: input.runtime_id,
            runtime,
            provider_session_id: None,
            adapter: None,
            reference_claims: Vec::new(),
            private_reference_paths: Vec::new(),
            active_reference_tokens: Vec::new(),
            account: Value::Null,
            providers: Vec::new(),
            models: Vec::new(),
            modes: Vec::new(),
            commands: Vec::new(),
            capabilities: None,
            selected_model: input.model,
            selected_effort: input.effort,
            selected_mode: input.mode,
            title,
            created_at: input
                .created_at
                .filter(|c| !c.is_empty())
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
            persist_timer: None,
            interrupt_fallback_timer: None,
            closing: false,
            closed: false,
            lifecycle_event_seen: false,
            source_scope_id: None,
            history_coverage: None,
            model_binding_revision: None,
            native_persistence_confirmed: false,
            bootstrap_events: None,
            bootstrap_error: None,
            close_promise: None,
        }),
    }))
}

impl AgentSession {
    pub fn state(&self) -> Ref<'_, SessionState> {
        self.state.borrow()
    }
    pub fn state_mut(&self) -> RefMut<'_, SessionState> {
        self.state.borrow_mut()
    }
    pub fn id(&self) -> String {
        self.state().id.clone()
    }
    pub fn workspace_root(&self) -> String {
        self.state().workspace_root.clone()
    }
    pub fn runtime_id(&self) -> String {
        self.state().runtime_id.clone()
    }
    pub fn provider_session_id(&self) -> Option<String> {
        self.state().provider_session_id.clone()
    }
    pub fn adapter(&self) -> Option<Rc<dyn AgentRuntimeAdapter>> {
        self.state().adapter.clone()
    }
    pub fn closing(&self) -> bool {
        self.state().closing
    }
    pub fn capabilities(&self) -> Option<Value> {
        self.state().capabilities.clone()
    }
    /// `session.capabilities?.[flag] === true`.
    pub fn capability(&self, flag: &str) -> bool {
        self.state()
            .capabilities
            .as_ref()
            .is_some_and(|c| c[flag] == true)
    }
    pub fn runtime_display_name(&self) -> String {
        self.state().runtime["displayName"]
            .as_str()
            .filter(|n| !n.is_empty())
            .unwrap_or("Agent runtime")
            .to_string()
    }

    fn control(&self) -> Value {
        self.actor.control()
    }
    /// `session.activeTurnId`.
    pub fn active_turn_id(&self) -> Option<String> {
        self.actor.read(|a| {
            a.control()["execution"]["activeTurnId"]
                .as_str()
                .map(str::to_string)
        })
    }
    /// `session.activeTurnStartedAtMs`.
    pub fn active_turn_started_at_ms(&self) -> Option<i64> {
        self.actor
            .read(|a| a.control()["execution"]["startedAtMs"].as_i64())
    }
    /// `session.lastStartedTurnId`.
    pub fn last_started_turn_id(&self) -> Option<String> {
        self.active_turn_id()
    }
    /// `session.pendingPrompt`.
    pub fn pending_prompt(&self) -> Option<String> {
        self.actor.read(|a| {
            a.control()["pendingSubmission"]["prompt"]
                .as_str()
                .map(str::to_string)
        })
    }
    /// `session.pendingPromptMentions`.
    pub fn pending_prompt_mentions(&self) -> Value {
        self.actor.read(|a| {
            a.control()["pendingSubmission"]
                .get("promptMentions")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new()))
        })
    }
    /// `session.pendingReferenceDisplays`.
    pub fn pending_reference_displays(&self) -> Value {
        self.actor.read(|a| {
            a.control()["pendingSubmission"]
                .get("referenceDisplays")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new()))
        })
    }
    /// `session.turnStarting`.
    pub fn turn_starting(&self) -> bool {
        self.actor
            .read(|a| a.control()["execution"]["status"] == "starting")
    }
    /// `session.interruptingTurnId`.
    pub fn interrupting_turn_id(&self) -> Option<String> {
        self.actor.read(|a| {
            a.control()["commands"].as_array().and_then(|commands| {
                commands
                    .iter()
                    .find(|c| c["kind"] == "interrupt" && c["status"] == "dispatching")
                    .and_then(|c| c["targetTurnId"].as_str().map(str::to_string))
            })
        })
    }
    /// `session.pendingApprovals.get(requestId)`.
    pub fn pending_approval(&self, request_id: &str) -> Option<Value> {
        self.blocker("approvals", request_id)
    }
    /// `session.pendingQuestions.get(requestId)`.
    pub fn pending_question(&self, request_id: &str) -> Option<Value> {
        self.blocker("questions", request_id)
    }
    /// `session.pendingApprovals.values()` / `pendingQuestions.values()`.
    pub fn pending_blockers(&self, key: &str) -> Vec<Value> {
        self.actor.read(|a| {
            a.control()["interaction"][key]
                .as_array()
                .cloned()
                .unwrap_or_default()
        })
    }
    fn blocker(&self, key: &str, request_id: &str) -> Option<Value> {
        self.pending_blockers(key)
            .into_iter()
            .find(|entry| entry["requestId"] == request_id)
    }
    /// `session.sequence`.
    pub fn sequence(&self) -> i64 {
        self.actor.sequence()
    }
    /// `session.events`.
    pub fn events(&self) -> Vec<Value> {
        self.actor.events()
    }
    /// `session.terminalState`.
    pub fn terminal_state(&self) -> String {
        terminal_state_from_control(&self.control())
    }
    /// `session.providerExited`.
    pub fn provider_exited(&self) -> bool {
        self.actor
            .read(|a| a.control()["connection"]["status"] == "exited")
    }
    pub fn updated_at(&self) -> String {
        self.state().updated_at.clone()
    }
}

/// `requireConnectedSession(session)`.
pub fn require_connected_session(session: &AgentSession) -> AgentResult<()> {
    if session.provider_exited() || session.adapter().is_none() {
        let name = session.state().runtime["displayName"]
            .as_str()
            .filter(|n| !n.is_empty())
            .unwrap_or("Agent runtime")
            .to_string();
        return Err(AgentError::new(format!(
            "{name} is disconnected. Refresh to resume the saved session."
        )));
    }
    Ok(())
}

/// `persistedRecordFromSession(session)`.
pub fn persisted_record_from_session(session: &AgentSession) -> Value {
    let state = session.state();
    Obj::new()
        .set("sessionId", state.id.as_str())
        .set("workspaceRoot", state.workspace_root.as_str())
        .set("runtimeId", state.runtime_id.as_str())
        .set("runtime", state.runtime.clone())
        .set("provider", state.runtime_id.as_str())
        .set("providerSessionId", state.provider_session_id.clone())
        .set(
            "sourceScopeId",
            state
                .source_scope_id
                .clone()
                .unwrap_or_else(|| "default".into()),
        )
        .opt("historyCoverage", state.history_coverage.clone())
        .set("title", state.title.as_str())
        .set("createdAt", state.created_at.as_str())
        .set("updatedAt", state.updated_at.as_str())
        .set(
            "terminalState",
            terminal_state_from_control(&session.actor.control()),
        )
        .set("selectedModel", state.selected_model.clone())
        .opt(
            "modelBindingRevision",
            state
                .model_binding_revision
                .clone()
                .filter(|r| !r.is_empty()),
        )
        .set("selectedEffort", state.selected_effort.clone())
        .set("selectedMode", state.selected_mode.clone())
        .set("lastSequence", session.sequence())
        .set("events", session.events())
        .build()
}

/// `applyProviderSession(session, providerSession)`.
pub fn apply_provider_session(session: &AgentSession, provider_session: &Value) {
    let text = |key: &str| {
        provider_session
            .get(key)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    let mut state = session.state_mut();
    if let Some(revision) = text("modelBindingRevision") {
        state.model_binding_revision = Some(revision);
    }
    state.provider_session_id = provider_session
        .get("providerSessionId")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(title) = text("title") {
        state.title = title;
    }
    if let Some(model) = text("model") {
        state.selected_model = Some(model);
    }
    if let Some(effort) = text("effort") {
        state.selected_effort = Some(effort);
    }
    if let Some(mode) = text("mode") {
        state.selected_mode = Some(mode);
    }
    if let Some(created) = text("createdAt") {
        state.created_at = created;
    }
    state.updated_at = text("updatedAt").unwrap_or_else(js::now_iso);
}

fn list(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

/// `applyInspection(session, inspection)`.
pub fn apply_inspection(session: &AgentSession, inspection: &Value) {
    let mut state = session.state_mut();
    state.account = inspection.get("account").cloned().unwrap_or(Value::Null);
    state.providers = list(inspection.get("providers"));
    state.models = list(inspection.get("models"));
    state.modes = list(inspection.get("modes"));
    state.commands = list(inspection.get("commands"));
    state.capabilities = Some(normalize_capability_snapshot(
        inspection.get("capabilities").unwrap_or(&Value::Null),
    ));
    if let Some(runtime) = inspection.get("runtime").filter(|r| js::truthy(r))
        && let Ok(descriptor) = sanitize_agent_runtime_descriptor(runtime)
    {
        state.runtime = Obj::from(&state.runtime).spread(&descriptor).build();
    }
    let model_connections = js::truthy_opt(inspection["capabilities"].get("modelConnections"));
    let has_model =
        |state: &SessionState, model: &str| state.models.iter().any(|m| m["model"] == model);
    if !model_connections
        && let Some(model) = state.selected_model.clone()
        && !has_model(&state, &model)
    {
        state.selected_model = None;
    }
    if state.selected_model.is_none() && !model_connections {
        let mut provider_ids: Vec<String> = Vec::new();
        for model in &state.models {
            if let Some(id) = model_provider_id(model)
                && !provider_ids.contains(&id)
            {
                provider_ids.push(id);
            }
        }
        if provider_ids.len() <= 1 {
            let provider = provider_ids.first().cloned();
            let provider_models: Vec<&Value> = state
                .models
                .iter()
                .filter(|m| provider.is_none() || model_provider_id(m) == provider)
                .collect();
            state.selected_model = provider_models
                .iter()
                .find(|m| js::truthy_opt(m.get("isDefault")))
                .or(provider_models.first())
                .and_then(|m| m["model"].as_str().map(str::to_string));
        }
    }
    if state.selected_model.is_none() && model_connections {
        let defaults: Vec<&Value> = state
            .models
            .iter()
            .filter(|m| js::truthy_opt(m.get("isDefault")))
            .collect();
        state.selected_model = (defaults.len() == 1)
            .then(|| defaults[0]["model"].as_str().map(str::to_string))
            .flatten();
    }
    let selected = state
        .selected_model
        .as_ref()
        .and_then(|model| state.models.iter().find(|m| m["model"] == model.as_str()))
        .cloned();
    let efforts: Vec<String> = selected
        .as_ref()
        .and_then(|m| m["variants"].as_array())
        .map(|v| {
            v.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if state
        .selected_effort
        .as_ref()
        .is_none_or(|effort| !efforts.contains(effort))
    {
        let default_variant = selected
            .as_ref()
            .and_then(|m| m["defaultVariant"].as_str())
            .map(str::to_string);
        state.selected_effort = match default_variant {
            Some(variant) if efforts.contains(&variant) => Some(variant),
            _ if efforts.iter().any(|e| e == "medium") => Some("medium".into()),
            _ => efforts.first().cloned(),
        };
    }
    if state.selected_mode.is_none() {
        state.selected_mode = state
            .modes
            .iter()
            .find(|m| js::truthy_opt(m.get("isDefault")))
            .or(state.modes.first())
            .and_then(|m| m["id"].as_str().map(str::to_string));
    }
}

/// `sessionMetadata(session, control)`.
pub fn session_metadata(session: &AgentSession, control: Option<&Value>) -> Value {
    let owned;
    let control = match control {
        Some(control) => control,
        None => {
            owned = session.actor.control();
            &owned
        }
    };
    let state = session.state();
    Obj::new()
        .set("instanceId", session.instance_id.as_str())
        .set("id", state.id.as_str())
        .set("runtimeId", state.runtime_id.as_str())
        .set("runtime", state.runtime.clone())
        .set("provider", state.runtime_id.as_str())
        .set("providerSessionId", state.provider_session_id.clone())
        .set(
            "sourceScopeId",
            state
                .source_scope_id
                .clone()
                .unwrap_or_else(|| "default".into()),
        )
        .set("workspaceRoot", state.workspace_root.as_str())
        .opt("historyCoverage", state.history_coverage.clone())
        .set("title", state.title.as_str())
        .set("createdAt", state.created_at.as_str())
        .set("updatedAt", state.updated_at.as_str())
        .set("terminalState", terminal_state_from_control(control))
        .set("selectedModel", state.selected_model.clone())
        .set("selectedEffort", state.selected_effort.clone())
        .set("selectedMode", state.selected_mode.clone())
        .set("activeTurnId", control["execution"]["activeTurnId"].clone())
        .set("lastSequence", session.sequence())
        .build()
}

/// `sessionSnapshot(session)`.
pub fn session_snapshot(session: &AgentSession) -> Value {
    let snapshot = session.actor.snapshot();
    let state = session.state();
    let metadata = {
        drop(state);
        session_metadata(session, Some(&snapshot.control))
    };
    let state = session.state();
    Obj::new()
        .set("session", metadata)
        .set("account", state.account.clone())
        .set("providers", state.providers.clone())
        .set("models", state.models.clone())
        .set("modes", state.modes.clone())
        .set("commands", state.commands.clone())
        .set(
            "capabilities",
            state.capabilities.clone().unwrap_or(Value::Null),
        )
        .set("runtime", state.runtime.clone())
        .set("cursor", snapshot.cursor.clone())
        .set("control", project_agent_control_view(&snapshot.control))
        .set("display", snapshot.display.to_value())
        .set("timeline", snapshot.timeline.clone())
        .set("events", snapshot.timeline["events"].clone())
        .set("partial", snapshot.timeline["partial"].clone())
        .set(
            "firstAvailableSequence",
            snapshot.timeline["firstAvailableSequence"].clone(),
        )
        .set("lastSequence", snapshot.timeline["lastSequence"].clone())
        .build()
}

/// `terminalStateFromControl(control)`.
pub fn terminal_state_from_control(control: &Value) -> String {
    if control["connection"]["status"] == "exited" && !is_agent_idle_disconnect(control) {
        return "provider-exited".into();
    }
    if js::truthy_opt(control["execution"].get("activeTurnId")) {
        return "running".into();
    }
    if control["execution"]["status"] == "outcome-unknown" {
        return "outcome-unknown".into();
    }
    control["execution"]["nativeOutcome"]
        .as_str()
        .filter(|o| !o.is_empty())
        .unwrap_or("idle")
        .to_string()
}

fn model_provider_id(model: &Value) -> Option<String> {
    if let Some(id) = model["providerId"].as_str().filter(|id| !id.is_empty()) {
        return Some(id.to_string());
    }
    let name = model["model"].as_str()?;
    let slash = name.find('/')?;
    (slash > 0).then(|| name[..slash].to_string())
}

fn normalize_sequence(value: i64) -> i64 {
    value.max(0)
}
