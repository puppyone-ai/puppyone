//! `types.ts`: a session as the Renderer sees it — its metadata, Main's
//! control view, the snapshot an attach receives, the frames that follow,
//! and the History listing.
use super::super::display_types::AgentDisplay;
use super::super::js;
use super::record::Record;
use super::runtime::{
    AccountState, Capabilities, InferenceProvider, Mode, Model, RuntimeDescriptor, SlashCommand,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `AgentSessionMetadata` (and the History list item, which adds its
/// listing fields). The Renderer keeps `activeTurnId` and `terminalState`
/// current from the display it replicates.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionMetadata {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub history_coverage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub source_scope_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<RuntimeDescriptor>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub provider: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub provider_session_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub workspace_root: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub title: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub created_at: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub updated_at: String,
    /// The last turn's outcome, `"idle"`, `"running"`, `"provider-exited"`
    /// or `"outcome-unknown"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub terminal_state: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub selected_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub selected_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub selected_mode: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub active_turn_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub last_sequence: i64,
    // `AgentSessionListItem`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub updated_at_known: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub archived_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub partial: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub origin: Option<String>,
}

impl SessionMetadata {
    /// `session.runtimeId ?? session.provider`.
    pub fn runtime_key(&self) -> &str {
        self.runtime_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .unwrap_or(&self.provider)
    }
    /// The live instance, when it has one.
    pub fn instance(&self) -> Option<&str> {
        self.instance_id.as_deref().filter(|id| !id.is_empty())
    }
}

/// `AgentSessionCursor`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionCursor {
    #[serde(deserialize_with = "super::lenient::text")]
    pub stream_id: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub revision: i64,
}

/// `AgentSessionControl["connection"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ControlConnection {
    /// `"connecting"`, `"connected"`, `"recovering"`, `"disconnected"` or
    /// `"exited"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub recovery_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub attempt: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub max_attempts: Option<i64>,
}

/// `AgentSessionControl["execution"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ControlExecution {
    /// `"idle"`, `"starting"`, `"active"`, `"ended"` or `"outcome-unknown"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub active_turn_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub uncertain_turn_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub started_at_ms: Option<i64>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub native_outcome: Option<String>,
    /// `"confirmed"` or `"unknown"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub certainty: String,
}

/// One approval or question Main holds open.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ControlBlocker {
    #[serde(deserialize_with = "super::lenient::text")]
    pub request_id: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub item_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub runtime_id: String,
}

/// `AgentSessionControlView["interaction"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ControlInteraction {
    #[serde(deserialize_with = "super::lenient::list")]
    pub approvals: Vec<ControlBlocker>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub questions: Vec<ControlBlocker>,
}

/// One command Main admitted (without its input body).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ControlCommand {
    #[serde(deserialize_with = "super::lenient::text")]
    pub command_id: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub operation_id: Option<String>,
    /// `"start"`, `"steer"`, `"interrupt"`, `"approval"` or `"question"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub kind: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub target_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub request_id: Option<String>,
    /// `AgentCommandDeliveryStatus`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub error: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub intent_fingerprint: Option<String>,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub was_queued: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub user_message_id: Option<String>,
}

/// `AgentSessionControl["recoveries"][number]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ControlRecovery {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub scope: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub request_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub adapter_generation: i64,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub run_generation: i64,
    #[serde(deserialize_with = "super::lenient::text")]
    pub state: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub message: String,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub attempt: Option<i64>,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub max_attempts: Option<i64>,
}

/// `AgentSessionControlView["pendingSubmission"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PendingSubmission {
    #[serde(deserialize_with = "super::lenient::text")]
    pub command_id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub operation_id: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub adapter_generation: i64,
}

/// `AgentSessionControlView`: Main's business state for one session,
/// without executable input bodies.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionControl {
    #[serde(deserialize_with = "super::lenient::count")]
    pub schema_version: u32,
    #[serde(deserialize_with = "super::lenient::text")]
    pub stream_id: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub revision: i64,
    #[serde(deserialize_with = "super::lenient::text")]
    pub session_epoch: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub adapter_generation: i64,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub run_generation: i64,
    pub connection: ControlConnection,
    pub execution: ControlExecution,
    pub interaction: ControlInteraction,
    #[serde(deserialize_with = "super::lenient::list")]
    pub commands: Vec<ControlCommand>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recoveries: Option<Vec<ControlRecovery>>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub queue: Vec<String>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub terminal_turns: Vec<String>,
    pub pending_submission: Option<PendingSubmission>,
}

impl SessionControl {
    /// The command with id `id`.
    pub fn command(&self, id: &str) -> Option<&ControlCommand> {
        self.commands
            .iter()
            .find(|command| command.command_id == id)
    }
}

/// `AgentSessionSnapshot`: the session, its display and Main's control
/// state at one cursor.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionSnapshot {
    pub display: AgentDisplay,
    pub session: SessionMetadata,
    pub runtime: Option<RuntimeDescriptor>,
    pub account: Option<AccountState>,
    pub providers: Option<Vec<InferenceProvider>>,
    pub models: Vec<Model>,
    pub modes: Option<Vec<Mode>>,
    pub commands: Option<Vec<SlashCommand>>,
    pub capabilities: Option<Capabilities>,
    pub partial: bool,
    pub first_available_sequence: i64,
    pub last_sequence: i64,
    pub cursor: SessionCursor,
    pub control: SessionControl,
    /// The canonical events, for the Renderer's own checks (tests, labs).
    pub events: Vec<Record>,
}

/// `AgentSessionFeedReceipt`. A snapshot that fails the contract says
/// why, so the subscription it came with can still be released.
#[derive(Clone, Debug, PartialEq)]
pub struct FeedReceipt {
    pub subscription_id: String,
    pub snapshot: Result<Box<SessionSnapshot>, String>,
}

/// The answer to a feed acknowledgement.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FeedAcknowledgement {
    #[serde(deserialize_with = "super::lenient::text")]
    pub subscription_id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub stream_id: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub revision: i64,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub synchronized: bool,
}

/// The answer to a watermark read.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FeedWatermark {
    #[serde(deserialize_with = "super::lenient::text")]
    pub subscription_id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub stream_id: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub revision: i64,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub acknowledged_revision: Option<i64>,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub resync_required: bool,
}

/// `AgentSessionOpenResult["error"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionOpenFailure {
    /// `AgentSessionOpenErrorCode`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub code: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub message: String,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub retryable: bool,
}

/// `AgentSessionOpenResult`.
#[derive(Clone, Debug, PartialEq)]
pub enum SessionOpenResult {
    Opened(Box<SessionSnapshot>),
    Failed(SessionOpenFailure),
}

/// `AgentDisplayPatch`: the structural change between two displays. Only
/// the contract reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct DisplayPatch(pub(in crate::agent) Value);

/// `AgentSessionFrame`.
#[derive(Clone, Debug, PartialEq)]
pub enum SessionFrame {
    Delta {
        subscription_id: String,
        stream_id: String,
        base_revision: i64,
        revision: i64,
        control: Box<SessionControl>,
        display_patch: DisplayPatch,
        session: Box<SessionMetadata>,
    },
    ResyncRequired {
        subscription_id: String,
        stream_id: String,
        revision: i64,
    },
    /// A frame that failed the contract (the replica repairs from a fresh
    /// snapshot).
    Malformed {
        subscription_id: Option<String>,
        error: String,
    },
}

impl SessionFrame {
    pub fn subscription_id(&self) -> Option<&str> {
        match self {
            Self::Delta {
                subscription_id, ..
            }
            | Self::ResyncRequired {
                subscription_id, ..
            } => Some(subscription_id),
            Self::Malformed {
                subscription_id, ..
            } => subscription_id.as_deref(),
        }
    }
}

/// A session's live instance failed (`onAgentSessionFailure`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionFailure {
    /// `"display"` for a display incident; anything else ends the instance.
    #[serde(deserialize_with = "super::lenient::text")]
    pub scope: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub message: Option<String>,
}

/// `AgentSessionsListResponse["discovery"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionDiscovery {
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub runtime_id: Option<String>,
    /// `AgentSessionDiscoveryStatus`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub next_cursor: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub scan_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub indexed: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub retryable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub catalog_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub source_scope_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub coverage: Option<String>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub warnings: Vec<String>,
}

/// `AgentSessionsListResponse["catalogCoverage"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CatalogCoverage {
    #[serde(deserialize_with = "super::lenient::flag")]
    pub truncated: bool,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub capacity: i64,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub retained: i64,
}

/// `AgentSessionsListResponse`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionsPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub catalog_next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded_session_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub session_list_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_coverage: Option<CatalogCoverage>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub sessions: Vec<SessionMetadata>,
    pub discovery: SessionDiscovery,
    #[serde(deserialize_with = "super::lenient::list")]
    pub warnings: Vec<String>,
}

/// A receipt Main returns for a command or a mutation: what the product
/// reads of it (`accepted`, `status`, the command's id).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Receipt {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub accepted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub queued: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub closed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub detached: Option<bool>,
    /// The rest of the receipt, as Main sent it.
    #[serde(flatten)]
    pub rest: Record,
}

impl SessionSnapshot {
    /// A snapshot from its validated transport form.
    pub(in crate::agent) fn from_value(value: &Value) -> Result<Self, String> {
        fn parse<T: serde::de::DeserializeOwned>(value: &Value, key: &str) -> Result<T, String> {
            T::deserialize(value.get(key).unwrap_or(&Value::Null))
                .map_err(|error| format!("Agent session snapshot.{key}: {error}"))
        }
        fn optional<T: serde::de::DeserializeOwned>(
            value: &Value,
            key: &str,
        ) -> Result<Option<T>, String> {
            match value.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(_) => parse(value, key).map(Some),
            }
        }
        Ok(Self {
            display: AgentDisplay::from_value(value.get("display").unwrap_or(&Value::Null))
                .map_err(|e| e.0)?,
            session: parse(value, "session")?,
            runtime: optional(value, "runtime")?,
            account: optional(value, "account")?,
            providers: optional(value, "providers")?,
            models: optional(value, "models")?.unwrap_or_default(),
            modes: optional(value, "modes")?,
            commands: optional(value, "commands")?,
            capabilities: optional(value, "capabilities")?,
            partial: value.get("partial") == Some(&Value::Bool(true)),
            first_available_sequence: value
                .get("firstAvailableSequence")
                .and_then(js::safe_integer)
                .unwrap_or(0),
            last_sequence: value
                .get("lastSequence")
                .and_then(js::safe_integer)
                .unwrap_or(0),
            cursor: parse(value, "cursor")?,
            control: parse(value, "control")?,
            events: value
                .get("events")
                .and_then(Value::as_array)
                .map(|events| events.iter().cloned().map(Record::from_value).collect())
                .unwrap_or_default(),
        })
    }
    /// The snapshot in transport form.
    pub(in crate::agent) fn to_value(&self) -> Value {
        let mut value = serde_json::json!({
            "display": self.display.to_value(),
            "session": self.session,
            "account": self.account,
            "providers": self.providers,
            "models": self.models,
            "capabilities": self.capabilities,
            "events": self.events,
            "partial": self.partial,
            "firstAvailableSequence": self.first_available_sequence,
            "lastSequence": self.last_sequence,
            "cursor": self.cursor,
            "control": self.control,
        });
        if let Some(runtime) = &self.runtime {
            value["runtime"] = serde_json::json!(runtime);
        }
        if let Some(modes) = &self.modes {
            value["modes"] = serde_json::json!(modes);
        }
        if let Some(commands) = &self.commands {
            value["commands"] = serde_json::json!(commands);
        }
        value
    }
}
