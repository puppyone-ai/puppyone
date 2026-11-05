//! `application/agent-controller-state.ts`: the Renderer controller's state
//! and its phase graph. Contract DTOs (inspection, session, control,
//! references, …) stay JSON; the display is the shared [`AgentDisplay`].
//!
//! `patch(Partial<AgentControllerState>)` is [`StatePatch`]: a field that
//! is `None` is absent from the patch, `Some(None)` sets a nullable field
//! to `null`/`undefined`.
use crate::agent::contract::display_state::create_empty_agent_display;
use crate::agent::contract::display_types::AgentDisplay;
use serde_json::Value;
use std::rc::Rc;

macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $text:literal),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name { $($variant),* }
        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),* }
            }
            pub fn parse(value: &str) -> Option<Self> {
                match value { $($text => Some(Self::$variant),)* _ => None }
            }
        }
    };
}

string_enum!(
    /// `AgentControllerPhase`.
    AgentControllerPhase {
        Idle = "idle",
        Discovering = "discovering",
        Restoring = "restoring",
        Ready = "ready",
        Creating = "creating",
        Running = "running",
        Waiting = "waiting",
        RuntimeExited = "runtime-exited",
        Failed = "failed",
    }
);

string_enum!(
    /// `AgentSessionPreparation`.
    AgentSessionPreparation { Idle = "idle", Preparing = "preparing", Ready = "ready", Failed = "failed" }
);

string_enum!(
    /// `AgentSubmissionStage` (without `null`).
    AgentSubmissionStage { PreparingSession = "preparing-session", StartingTurn = "starting-turn" }
);

string_enum!(
    /// `AgentDisplayRecoveryCause`.
    AgentDisplayRecoveryCause {
        AttachTimeout = "attach-timeout",
        AttachFailed = "attach-failed",
        AckTimeout = "ack-timeout",
        AckFailed = "ack-failed",
        WatermarkTimeout = "watermark-timeout",
        WatermarkFailed = "watermark-failed",
        RevisionGap = "revision-gap",
        StreamReset = "stream-reset",
        SchemaInvalid = "schema-invalid",
        BackpressureOverflow = "backpressure-overflow",
    }
);

string_enum!(
    /// `AgentDisplayRecoveryStage`.
    AgentDisplayRecoveryStage {
        Silent = "silent",
        Reconnecting = "reconnecting",
        Degraded = "degraded",
        ActionRequired = "action-required",
    }
);

string_enum!(
    /// `AgentDisplayRecovery["policy"]`.
    AgentDisplayRecoveryPolicy { Automatic = "automatic", Paused = "paused", Exhausted = "exhausted" }
);

string_enum!(
    /// `AgentControllerState["replicaStatus"]`.
    ReplicaStatus { Detached = "detached", Subscribing = "subscribing", Live = "live", Stale = "stale" }
);

string_enum!(
    /// `AgentControllerState["localConnectionsPhase"]`.
    LocalConnectionsPhase { Idle = "idle", Loading = "loading", Ready = "ready", Error = "error" }
);

string_enum!(
    /// `stopRequest.status`.
    StopRequestStatus { Sending = "sending", Accepted = "accepted", Unconfirmed = "unconfirmed" }
);

/// `AgentDisplayRecovery`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentDisplayRecovery {
    pub policy: AgentDisplayRecoveryPolicy,
    pub stage: AgentDisplayRecoveryStage,
    pub cause: AgentDisplayRecoveryCause,
    pub attempt: u32,
    pub max_attempts: u32,
}

/// `AgentControllerState["stopRequest"]`. Its identity (`Rc`) is the
/// product's object identity (`state.stopRequest !== request`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StopRequest {
    pub command_id: String,
    pub session_id: String,
    pub instance_id: Option<String>,
    pub turn_id: String,
    pub status: StopRequestStatus,
}

/// `AgentControllerState`.
#[derive(Clone, Debug)]
pub struct AgentControllerState {
    pub phase: AgentControllerPhase,
    pub inspection: Option<Value>,
    pub session: Option<Value>,
    /// Main-owned business state. Renderer-only fields are derived from
    /// this checkpoint.
    pub control: Option<Value>,
    pub replica_status: ReplicaStatus,
    pub projection: AgentDisplay,
    pub selected_runtime_id: Option<String>,
    pub selected_provider_id: Option<String>,
    pub selected_model: Option<String>,
    pub selected_effort: Option<String>,
    pub selected_mode: Option<String>,
    pub local_connections: Vec<Value>,
    pub local_connections_phase: LocalConnectionsPhase,
    pub local_connections_scanned_at: Option<String>,
    pub local_connections_error: Option<Value>,
    pub draft: String,
    /// Atomic file-reference spans inside draft. Images remain media
    /// references.
    pub draft_mentions: Vec<Value>,
    /// Optimistic prompt shown while the native backend accepts the turn.
    pub pending_prompt: Option<String>,
    /// Immutable prompt/config/reference capture while native turn
    /// acceptance is pending.
    pub pending_intent: Option<Value>,
    /// Lifecycle of the reusable native session prepared for the selected
    /// runtime.
    pub session_preparation: AgentSessionPreparation,
    pub references: Vec<Value>,
    /// An `AgentErrorDescriptor`.
    pub error: Option<Value>,
    pub submitting: bool,
    pub stopping: bool,
    pub stop_request: Option<Rc<StopRequest>>,
    pub display_recovery: Option<AgentDisplayRecovery>,
    pub initialized: bool,
}

impl Default for AgentControllerState {
    fn default() -> Self {
        Self {
            phase: AgentControllerPhase::Idle,
            inspection: None,
            session: None,
            control: None,
            replica_status: ReplicaStatus::Detached,
            projection: create_empty_agent_display(),
            selected_runtime_id: None,
            selected_provider_id: None,
            selected_model: None,
            selected_effort: None,
            selected_mode: None,
            local_connections: Vec::new(),
            local_connections_phase: LocalConnectionsPhase::Idle,
            local_connections_scanned_at: None,
            local_connections_error: None,
            draft: String::new(),
            draft_mentions: Vec::new(),
            pending_prompt: None,
            pending_intent: None,
            session_preparation: AgentSessionPreparation::Idle,
            references: Vec::new(),
            error: None,
            submitting: false,
            stopping: false,
            stop_request: None,
            display_recovery: None,
            initialized: false,
        }
    }
}

impl AgentControllerState {
    /// `state.session?.id`.
    pub fn session_id(&self) -> Option<&str> {
        self.session.as_ref().and_then(|s| s["id"].as_str())
    }
    /// `state.session?.instanceId`.
    pub fn session_instance_id(&self) -> Option<&str> {
        self.session.as_ref().and_then(|s| s["instanceId"].as_str())
    }
    /// `state.inspection?.capabilities?.[name]` is truthy.
    pub fn capability(&self, name: &str) -> bool {
        self.inspection
            .as_ref()
            .is_some_and(|i| crate::agent::contract::js::truthy(&i["capabilities"][name]))
    }
    /// `state.projection.runningTurnId` when truthy.
    pub fn running_turn_id(&self) -> Option<&str> {
        self.projection
            .running_turn_id()
            .filter(|id| !id.is_empty())
    }
    /// The state as the product's plain object (`getSnapshot()`).
    pub fn to_value(&self) -> Value {
        let text = |value: &Option<String>| value.clone().map_or(Value::Null, Value::from);
        let mut value = serde_json::json!({
            "phase": self.phase.as_str(),
            "inspection": self.inspection,
            "session": self.session,
            "control": self.control,
            "replicaStatus": self.replica_status.as_str(),
            "projection": self.projection.to_value(),
            "selectedRuntimeId": text(&self.selected_runtime_id),
            "selectedProviderId": text(&self.selected_provider_id),
            "selectedModel": text(&self.selected_model),
            "selectedEffort": text(&self.selected_effort),
            "selectedMode": text(&self.selected_mode),
            "localConnections": self.local_connections,
            "localConnectionsPhase": self.local_connections_phase.as_str(),
            "localConnectionsScannedAt": text(&self.local_connections_scanned_at),
            "localConnectionsError": self.local_connections_error,
            "draft": self.draft,
            "draftMentions": self.draft_mentions,
            "pendingPrompt": text(&self.pending_prompt),
            "pendingIntent": self.pending_intent,
            "sessionPreparation": self.session_preparation.as_str(),
            "references": self.references,
            "error": self.error,
            "submitting": self.submitting,
            "stopping": self.stopping,
            "initialized": self.initialized,
        });
        if let Some(request) = &self.stop_request {
            value["stopRequest"] = serde_json::json!({
                "commandId": request.command_id,
                "sessionId": request.session_id,
                "instanceId": request.instance_id,
                "turnId": request.turn_id,
                "status": request.status.as_str(),
            });
        }
        if let Some(recovery) = &self.display_recovery {
            value["displayRecovery"] = serde_json::json!({
                "policy": recovery.policy.as_str(),
                "stage": recovery.stage.as_str(),
                "cause": recovery.cause.as_str(),
                "attempt": recovery.attempt,
                "maxAttempts": recovery.max_attempts,
            });
        }
        value
    }
    /// `state.error?.code`.
    pub fn error_code(&self) -> Option<&str> {
        self.error.as_ref().and_then(|e| e["code"].as_str())
    }
}

macro_rules! state_patch {
    ($($field:ident : $ty:ty),* $(,)?) => {
        /// `Partial<AgentControllerState>`.
        #[derive(Clone, Debug, Default)]
        pub struct StatePatch { $(pub $field: Option<$ty>,)* }

        impl StatePatch {
            pub fn new() -> Self {
                Self::default()
            }
            $(
                pub fn $field(mut self, value: $ty) -> Self {
                    self.$field = Some(value);
                    self
                }
            )*
            /// `{ ...this, ...other }`.
            pub fn and(mut self, other: StatePatch) -> Self {
                $(if other.$field.is_some() { self.$field = other.$field; })*
                self
            }
            /// `{ ...state, ...patch }`.
            pub fn apply_to(self, state: &mut AgentControllerState) {
                $(if let Some(value) = self.$field { state.$field = value; })*
            }
        }
    };
}

state_patch!(
    phase: AgentControllerPhase,
    inspection: Option<Value>,
    session: Option<Value>,
    control: Option<Value>,
    replica_status: ReplicaStatus,
    projection: AgentDisplay,
    selected_runtime_id: Option<String>,
    selected_provider_id: Option<String>,
    selected_model: Option<String>,
    selected_effort: Option<String>,
    selected_mode: Option<String>,
    local_connections: Vec<Value>,
    local_connections_phase: LocalConnectionsPhase,
    local_connections_scanned_at: Option<String>,
    local_connections_error: Option<Value>,
    draft: String,
    draft_mentions: Vec<Value>,
    pending_prompt: Option<String>,
    pending_intent: Option<Value>,
    session_preparation: AgentSessionPreparation,
    references: Vec<Value>,
    error: Option<Value>,
    submitting: bool,
    stopping: bool,
    stop_request: Option<Rc<StopRequest>>,
    display_recovery: Option<AgentDisplayRecovery>,
    initialized: bool,
);

/// `agentControllerTransitions[phase]`.
pub fn agent_controller_transitions(
    phase: AgentControllerPhase,
) -> &'static [AgentControllerPhase] {
    use AgentControllerPhase::*;
    match phase {
        Idle => &[Discovering, Restoring, Creating, Ready, Failed],
        Discovering => &[Restoring, Ready, Failed],
        Restoring => &[Ready, Running, Failed, RuntimeExited],
        Ready => &[
            Discovering,
            Restoring,
            Creating,
            Running,
            Waiting,
            Failed,
            RuntimeExited,
        ],
        Creating => &[Ready, Running, Failed, RuntimeExited],
        Running => &[Running, Waiting, Ready, Failed, RuntimeExited],
        Waiting => &[Waiting, Running, Ready, Failed, RuntimeExited],
        RuntimeExited => &[Discovering, Restoring, Creating, Ready, Failed],
        Failed => &[Discovering, Restoring, Creating, Ready, RuntimeExited],
    }
}
