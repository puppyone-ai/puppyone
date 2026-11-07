//! `display-types.ts`: the display a Renderer replica shows, typed
//! (`AgentProjection`). The replica applies Main's patches to the
//! transport form ([`AgentDisplay`]); [`AgentProjection::project`] then
//! rebuilds only the entries a patch touched, so a streaming revision
//! converts one message, not the transcript.
use super::super::display_types::{AgentDisplay, Entry};
use super::record::Record;
use super::references::{PromptMention, ReferenceDisplay};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// `AgentTranscriptMessage`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TranscriptMessage {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    /// `"user"` or `"assistant"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub role: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub client_user_message_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub submission_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub delivery_status: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub truncated: Option<bool>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub item_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub text: String,
    pub references: Option<Vec<ReferenceDisplay>>,
    pub prompt_mentions: Option<Vec<PromptMention>>,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub streaming: bool,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub terminal_state: Option<String>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub sequence: i64,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub updated_sequence: Option<i64>,
}

/// `AgentActivity`: a tool call, command, file change, plan, reasoning,
/// warning, error, notification or system note.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Activity {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub item_id: Option<String>,
    /// `AgentActivityKind`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub kind: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub label: String,
    /// `AgentActivityLabelCode`.
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub label_code: Option<String>,
    /// `AgentActivityStatus`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    /// What the provider reported (tool, input, command, changes, result…).
    pub detail: Record,
    #[serde(deserialize_with = "super::lenient::text")]
    pub output: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub sequence: i64,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub updated_sequence: Option<i64>,
}

/// `AgentConnectionStatus`: the live provider transport, replaced as it
/// changes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionStatus {
    /// `"reconnecting"` or `"fallback"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub state: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub message: String,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub attempt: Option<i64>,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub max_attempts: Option<i64>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub sequence: i64,
}

/// `AgentApproval["networkApprovalContext"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct NetworkApprovalContext {
    #[serde(deserialize_with = "super::lenient::text")]
    pub host: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub protocol: String,
}

/// `AgentApproval`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Approval {
    /// `AgentCommandDeliveryStatus` of the answer sent, if any.
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub reply_status: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub request_id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub turn_id: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub item_id: Option<String>,
    /// `"command"` or `"file-change"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub kind: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub title: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub title_code: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub command: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub cwd: Option<String>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub command_actions: Vec<Record>,
    pub network_approval_context: Option<NetworkApprovalContext>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub grant_root: Option<String>,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub policy_change_requested: bool,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub reason: Option<String>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub available_decisions: Vec<String>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub sequence: i64,
}

/// `AgentQuestionChoice`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuestionChoice {
    #[serde(deserialize_with = "super::lenient::text")]
    pub label: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub description: String,
}

/// `AgentQuestionPrompt`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuestionPrompt {
    #[serde(deserialize_with = "super::lenient::text")]
    pub header: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub question: String,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub multiple: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub custom: bool,
    #[serde(deserialize_with = "super::lenient::list")]
    pub options: Vec<QuestionChoice>,
}

/// `AgentQuestion`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Question {
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub reply_status: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub request_id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub turn_id: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub item_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub questions: Vec<QuestionPrompt>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub sequence: i64,
}

/// `AgentTurnRecovery`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TurnRecovery {
    #[serde(deserialize_with = "super::lenient::text")]
    pub kind: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub failure_scope: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub code: String,
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub retryable: Option<bool>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub transport_health: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub side_effects: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub diagnostic: Option<String>,
}

/// `AgentTurn`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Turn {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub recovery_of_turn_id: Option<String>,
    /// `"running"`, `"outcome-unknown"` or the turn's outcome.
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub started_at_sequence: i64,
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub started_at_ms: Option<f64>,
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub user_wait_started_at_ms: Option<f64>,
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub user_wait_duration_ms: Option<f64>,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub completed_at_sequence: Option<i64>,
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub duration_ms: Option<f64>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub part_ids: Vec<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub completion_quality: Option<String>,
    pub recovery: Option<TurnRecovery>,
}

/// The fields every part has (`AgentPartBase`) and those its kind adds.
/// `kind` says which apply: `user` and `assistant` carry text; the
/// activity kinds carry an [`Activity`]; `turn-summary` a duration and
/// status; `usage` its report; `permission` and `question` a request and
/// state; `unknown` the event type it could not show.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Part {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub kind: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub item_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub sequence: i64,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub updated_sequence: Option<i64>,
    // user / assistant
    #[serde(deserialize_with = "super::lenient::text")]
    pub text: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub submission_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub delivery_status: Option<String>,
    pub references: Option<Vec<ReferenceDisplay>>,
    pub prompt_mentions: Option<Vec<PromptMention>>,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub streaming: bool,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub terminal_state: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub truncated: Option<bool>,
    // turn-summary
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub duration_ms: Option<f64>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub completion_quality: Option<String>,
    // activity kinds
    #[serde(deserialize_with = "super::lenient::text")]
    pub label: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub label_code: Option<String>,
    pub detail: Record,
    #[serde(deserialize_with = "super::lenient::text")]
    pub output: String,
    // usage
    pub usage: Option<Record>,
    // permission / question
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub request_id: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub state: Option<String>,
    // unknown
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub event_type: Option<String>,
}

impl Part {
    /// The activity as a part.
    pub fn of_activity(activity: &Activity) -> Self {
        Self {
            id: activity.id.clone(),
            kind: activity.kind.clone(),
            turn_id: activity.turn_id.clone(),
            item_id: activity.item_id.clone(),
            sequence: activity.sequence,
            updated_sequence: activity.updated_sequence,
            status: activity.status.clone(),
            label: activity.label.clone(),
            label_code: activity.label_code.clone(),
            detail: activity.detail.clone(),
            output: activity.output.clone(),
            ..Self::default()
        }
    }
    /// A message as the part the timeline would have made of it.
    pub fn of_message(message: &TranscriptMessage) -> Self {
        Self {
            id: message.id.clone(),
            kind: message.role.clone(),
            turn_id: message.turn_id.clone(),
            item_id: message.item_id.clone(),
            sequence: message.sequence,
            updated_sequence: message.updated_sequence,
            text: message.text.clone(),
            submission_id: message.submission_id.clone(),
            delivery_status: message.delivery_status.clone(),
            references: message.references.clone(),
            prompt_mentions: message.prompt_mentions.clone(),
            streaming: message.streaming,
            terminal_state: message.terminal_state.clone(),
            truncated: message.truncated,
            ..Self::default()
        }
    }
}

/// What an activity shows, whether it is a display activity or a timeline
/// part of an activity kind.
pub trait ActivityFields {
    fn kind(&self) -> &str;
    fn label(&self) -> &str;
    fn label_code(&self) -> Option<&str>;
    fn detail(&self) -> &Record;
    fn output(&self) -> &str;
}

impl ActivityFields for Activity {
    fn kind(&self) -> &str {
        &self.kind
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn label_code(&self) -> Option<&str> {
        self.label_code.as_deref()
    }
    fn detail(&self) -> &Record {
        &self.detail
    }
    fn output(&self) -> &str {
        &self.output
    }
}

impl ActivityFields for Part {
    fn kind(&self) -> &str {
        &self.kind
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn label_code(&self) -> Option<&str> {
        self.label_code.as_deref()
    }
    fn detail(&self) -> &Record {
        &self.detail
    }
    fn output(&self) -> &str {
        &self.output
    }
}

/// `TimelineRow`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TimelineRow {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub part_id: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub turn_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub kind: String,
    #[serde(deserialize_with = "super::lenient::integer")]
    pub sequence: i64,
    #[serde(default, deserialize_with = "super::lenient::optional_integer")]
    pub updated_sequence: Option<i64>,
    #[serde(deserialize_with = "super::lenient::number")]
    #[serde(serialize_with = "super::lenient::write_number")]
    pub estimated_height: f64,
}

/// `AgentDisplayPresentation`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Presentation {
    /// `"ready"`, `"creating"`, `"running"`, `"waiting"` or
    /// `"runtime-exited"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub phase: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub terminal_state: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub pending_prompt: Option<String>,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub submitting: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub stopping: bool,
}

/// `AgentHistoryCoverage`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HistoryCoverage {
    #[serde(deserialize_with = "super::lenient::text")]
    pub coverage: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub reason: Option<String>,
}

/// `AgentProjection`: the display, typed. Entries are shared; two
/// projections share every entry a revision did not touch.
#[derive(Clone, Debug)]
pub struct AgentProjection {
    display: AgentDisplay,
    pub history: HistoryCoverage,
    pub display_truncated: bool,
    pub connection_status: Option<ConnectionStatus>,
    pub running_turn_id: Option<String>,
    pub presentation: Option<Presentation>,
    pub messages: Vec<Arc<TranscriptMessage>>,
    pub activities: Vec<Arc<Activity>>,
    pub approvals: Vec<Arc<Approval>>,
    pub questions: Vec<Arc<Question>>,
    pub turns: Vec<Arc<Turn>>,
    pub parts: Vec<Arc<Part>>,
    pub rows: Vec<Arc<TimelineRow>>,
    /// The typed form of each transport entry, by allocation.
    typed: Arc<HashMap<usize, Typed>>,
}

#[derive(Clone, Debug)]
enum Typed {
    Message(Arc<TranscriptMessage>),
    Activity(Arc<Activity>),
    Approval(Arc<Approval>),
    Question(Arc<Question>),
    Turn(Arc<Turn>),
    Part(Arc<Part>),
    Row(Arc<TimelineRow>),
}

impl PartialEq for AgentProjection {
    fn eq(&self, other: &Self) -> bool {
        self.display == other.display
    }
}

impl Default for AgentProjection {
    fn default() -> Self {
        Self::project(
            &super::super::display_state::create_empty_agent_display(),
            None,
        )
        .expect("the empty display is well formed")
    }
}

fn convert<T: serde::de::DeserializeOwned>(entry: &Entry, key: &str) -> Result<T, String> {
    T::deserialize(&**entry).map_err(|error| format!("Agent display {key}: {error}"))
}

fn value<T: serde::de::DeserializeOwned + Default>(
    display: &AgentDisplay,
    key: &str,
) -> Result<T, String> {
    match display.get(key) {
        None | Some(Value::Null) => Ok(T::default()),
        Some(value) => {
            T::deserialize(value).map_err(|error| format!("Agent display {key}: {error}"))
        }
    }
}

impl AgentProjection {
    /// The typed display of `display`, reusing the typed entries `previous`
    /// already made of the same transport entries.
    pub fn project(display: &AgentDisplay, previous: Option<&Self>) -> Result<Self, String> {
        let mut typed: HashMap<usize, Typed> = HashMap::new();
        let known = previous.map(|p| &*p.typed);
        macro_rules! collection {
            ($entries:expr, $variant:ident, $key:literal) => {{
                let mut out = Vec::with_capacity($entries.len());
                for entry in $entries {
                    let ptr = Arc::as_ptr(entry) as usize;
                    let reused = known.and_then(|k| k.get(&ptr)).and_then(|t| match t {
                        Typed::$variant(value) => Some(value.clone()),
                        _ => None,
                    });
                    let value = match reused {
                        Some(value) => value,
                        None => Arc::new(convert(entry, $key)?),
                    };
                    typed.insert(ptr, Typed::$variant(value.clone()));
                    out.push(value);
                }
                out
            }};
        }
        let messages = collection!(&display.messages, Message, "messages");
        let activities = collection!(&display.activities, Activity, "activities");
        let approvals = collection!(&display.approvals, Approval, "approvals");
        let questions = collection!(&display.questions, Question, "questions");
        let turns = collection!(&display.turns, Turn, "turns");
        let parts = collection!(&display.parts, Part, "parts");
        let rows = collection!(&display.rows, Row, "rows");
        let window: Record = value(display, "displayWindow")?;
        Ok(Self {
            history: value(display, "history")?,
            display_truncated: window.is_true("truncated"),
            connection_status: value(display, "connectionStatus")?,
            running_turn_id: display.running_turn_id().map(str::to_string),
            presentation: value(display, "presentation")?,
            display: display.clone(),
            messages,
            activities,
            approvals,
            questions,
            turns,
            parts,
            rows,
            typed: Arc::new(typed),
        })
    }
    /// The projection after Main's `patch`: applied to the transport form,
    /// checked against the display contract, then typed.
    pub fn apply(&self, patch: &super::session::DisplayPatch) -> Result<Self, String> {
        let next = super::super::display_state::apply_agent_display_patch(&self.display, &patch.0)
            .map_err(|error| error.0)?;
        super::super::display_schema::assert_display(&next).map_err(|error| error.0)?;
        Self::project(&next, Some(self))
    }
    /// `projection.runningTurnId` when non-empty.
    pub fn running_turn(&self) -> Option<&str> {
        self.running_turn_id.as_deref().filter(|id| !id.is_empty())
    }
    /// Whether nothing has been committed: no rows, parts, messages or
    /// activities.
    pub fn is_empty_transcript(&self) -> bool {
        self.rows.is_empty()
            && self.parts.is_empty()
            && self.messages.is_empty()
            && self.activities.is_empty()
    }
    /// The display as plain JSON, for test snapshots.
    #[cfg(test)]
    pub fn to_json_string(&self) -> String {
        serde_json::to_string(&self.display.to_value()).unwrap_or_default()
    }
}
