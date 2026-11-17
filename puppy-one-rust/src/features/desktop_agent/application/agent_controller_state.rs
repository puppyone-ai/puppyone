//! `application/agent-controller-state.ts`: the Renderer controller's state
//! and its phase graph, over the contract's types (inspection, session,
//! control, references) and the typed display ([`AgentProjection`]).
//!
//! `patch(Partial<AgentControllerState>)` is [`StatePatch`]: a field that
//! is `None` is absent from the patch, `Some(None)` sets a nullable field
//! to `null`/`undefined`.
use super::agent_error::ErrorDescriptor;
use crate::agent::contract::dto::{
    AgentProjection, Capability, DraftReference, PromptMention, RuntimeInspection, SessionControl,
    SessionMetadata, SubmissionIntent,
};
use std::rc::Rc;

/// A state the product spells as a string (`"idle"`, `"live"`).
pub trait StateName: Sized {
    fn as_str(&self) -> &'static str;
    fn parse(value: &str) -> Option<Self>;
}

macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $text:literal),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name { $($variant),* }
        impl StateName for $name {
            fn as_str(&self) -> &'static str {
                match self { $(Self::$variant => $text),* }
            }
            fn parse(value: &str) -> Option<Self> {
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
    pub inspection: Option<RuntimeInspection>,
    pub session: Option<SessionMetadata>,
    /// Main-owned business state. Renderer-only fields are derived from
    /// this checkpoint.
    pub control: Option<SessionControl>,
    pub replica_status: ReplicaStatus,
    pub projection: AgentProjection,
    pub selected_runtime_id: Option<String>,
    pub selected_provider_id: Option<String>,
    pub selected_model: Option<String>,
    pub selected_effort: Option<String>,
    pub selected_mode: Option<String>,
    pub draft: String,
    /// Atomic file-reference spans inside draft. Images remain media
    /// references.
    pub draft_mentions: Vec<PromptMention>,
    /// Optimistic prompt shown while the native backend accepts the turn.
    pub pending_prompt: Option<String>,
    /// Immutable prompt/config/reference capture while native turn
    /// acceptance is pending.
    pub pending_intent: Option<SubmissionIntent>,
    /// Lifecycle of the reusable native session prepared for the selected
    /// runtime.
    pub session_preparation: AgentSessionPreparation,
    pub references: Vec<DraftReference>,
    /// An `AgentErrorDescriptor`.
    pub error: Option<ErrorDescriptor>,
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
            projection: AgentProjection::default(),
            selected_runtime_id: None,
            selected_provider_id: None,
            selected_model: None,
            selected_effort: None,
            selected_mode: None,
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
        self.session.as_ref().map(|s| s.id.as_str())
    }
    /// `state.session?.instanceId`.
    pub fn session_instance_id(&self) -> Option<&str> {
        self.session.as_ref().and_then(|s| s.instance_id.as_deref())
    }
    /// `state.inspection?.capabilities?.[name]` is truthy.
    pub fn capability(&self, capability: Capability) -> bool {
        self.inspection
            .as_ref()
            .is_some_and(|i| i.capability(capability))
    }
    /// `state.projection.runningTurnId` when truthy.
    pub fn running_turn_id(&self) -> Option<&str> {
        self.projection.running_turn()
    }
    /// `state.error?.code`.
    pub fn error_code(&self) -> Option<&str> {
        self.error.as_ref().map(|e| e.code.as_str())
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
            /// `{ ...state, ...patch }`.
            pub fn apply_to(self, state: &mut AgentControllerState) {
                $(if let Some(value) = self.$field { state.$field = value; })*
            }
        }
    };
}

state_patch!(
    phase: AgentControllerPhase,
    inspection: Option<RuntimeInspection>,
    session: Option<SessionMetadata>,
    control: Option<SessionControl>,
    replica_status: ReplicaStatus,
    projection: AgentProjection,
    selected_runtime_id: Option<String>,
    selected_provider_id: Option<String>,
    selected_model: Option<String>,
    selected_effort: Option<String>,
    selected_mode: Option<String>,
    draft: String,
    draft_mentions: Vec<PromptMention>,
    pending_prompt: Option<String>,
    pending_intent: Option<SubmissionIntent>,
    session_preparation: AgentSessionPreparation,
    references: Vec<DraftReference>,
    error: Option<ErrorDescriptor>,
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
