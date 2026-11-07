//! What a window asks of the Agent host and what it answers: the product's
//! `agent:*` requests (`AgentIpcChannel`) as one typed [`AgentRequest`]
//! per operation, their typed [`AgentResponse`], and the window-bound
//! [`AgentEvent`]. In process these values are the protocol; their JSON
//! form exists for the Main-side service, which keeps the product's JSON
//! records, and is checked here against the same contract the product's
//! IPC applies.
use super::dto::*;
use super::js;
use super::operation_error::read_agent_operation_failure;
use super::schema::{assert_agent_ipc_response, parse_agent_ipc_request};
use super::validation::Contract;
use serde::Serialize;
use serde_json::Value;

/// One operation (`AgentIpcChannel`, without the transport's dispatch
/// channel).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AgentOperation {
    DiscoverRuntimes,
    DiscoverLocalConnections,
    ListModels,
    ReadAccount,
    CreateSession,
    ResumeSession,
    OpenSession,
    ReplaySession,
    AttachSession,
    AcknowledgeFeed,
    ReadFeedWatermark,
    DetachFeed,
    ListSessions,
    ForkSession,
    ArchiveSession,
    DeleteSession,
    CloseSession,
    StageReferences,
    RevokeReferences,
    ResolveWorkspaceReferences,
    PickWorkspaceReferences,
    StartTurn,
    SteerTurn,
    InterruptTurn,
    CompactSession,
    ResolveApproval,
    ResolveQuestion,
    /// A desktop window's own execution manager (not a Main operation).
    ManageExecutions,
    /// A desktop window's own execution stop (not a Main operation).
    TerminateExecution,
}

impl AgentOperation {
    /// Every Main operation.
    pub const MAIN: &'static [AgentOperation] = &[
        Self::DiscoverRuntimes,
        Self::DiscoverLocalConnections,
        Self::ListModels,
        Self::ReadAccount,
        Self::CreateSession,
        Self::ResumeSession,
        Self::OpenSession,
        Self::ReplaySession,
        Self::AttachSession,
        Self::AcknowledgeFeed,
        Self::ReadFeedWatermark,
        Self::DetachFeed,
        Self::ListSessions,
        Self::ForkSession,
        Self::ArchiveSession,
        Self::DeleteSession,
        Self::CloseSession,
        Self::StageReferences,
        Self::RevokeReferences,
        Self::ResolveWorkspaceReferences,
        Self::PickWorkspaceReferences,
        Self::StartTurn,
        Self::SteerTurn,
        Self::InterruptTurn,
        Self::CompactSession,
        Self::ResolveApproval,
        Self::ResolveQuestion,
    ];

    /// The product's channel: the contract names its request and response
    /// rules by it.
    pub(in crate::agent) fn channel(self) -> &'static str {
        match self {
            Self::DiscoverRuntimes => "agent:providers-discover",
            Self::DiscoverLocalConnections => "agent:local-connections-discover",
            Self::ListModels => "agent:models-list",
            Self::ReadAccount => "agent:account-read",
            Self::CreateSession => "agent:session-create",
            Self::ResumeSession => "agent:session-resume",
            Self::OpenSession => "agent:session-open",
            Self::ReplaySession => "agent:session-replay",
            Self::AttachSession => "agent:session-attach",
            Self::AcknowledgeFeed => "agent:session-feed-ack",
            Self::ReadFeedWatermark => "agent:session-feed-watermark",
            Self::DetachFeed => "agent:session-detach",
            Self::ListSessions => "agent:sessions-list",
            Self::ForkSession => "agent:session-fork",
            Self::ArchiveSession => "agent:session-archive",
            Self::DeleteSession => "agent:session-delete",
            Self::CloseSession => "agent:session-close",
            Self::StageReferences => "agent:reference-stage",
            Self::RevokeReferences => "agent:reference-revoke",
            Self::ResolveWorkspaceReferences => "agent:reference-resolve-workspace",
            Self::PickWorkspaceReferences => "agent:reference-pick-workspace",
            Self::StartTurn => "agent:turn-start",
            Self::SteerTurn => "agent:turn-steer",
            Self::InterruptTurn => "agent:turn-interrupt",
            Self::CompactSession => "agent:session-compact",
            Self::ResolveApproval => "agent:approval-resolve",
            Self::ResolveQuestion => "agent:question-resolve",
            Self::ManageExecutions => "agent:executions-manage",
            Self::TerminateExecution => "agent:execution-terminate",
        }
    }

    /// The product port's method name (`AgentClientPort`), as the
    /// Renderer's tests and diagnostics name it.
    pub fn method(self) -> &'static str {
        match self {
            Self::DiscoverRuntimes => "discoverAgentRuntimes",
            Self::DiscoverLocalConnections => "discoverLocalAgentConnections",
            Self::ListModels => "listAgentModels",
            Self::ReadAccount => "readAgentAccount",
            Self::CreateSession => "createAgentSession",
            Self::ResumeSession => "resumeAgentSession",
            Self::OpenSession => "openAgentSession",
            Self::ReplaySession => "replayAgentSession",
            Self::AttachSession => "attachAgentSession",
            Self::AcknowledgeFeed => "acknowledgeAgentSession",
            Self::ReadFeedWatermark => "readAgentSessionWatermark",
            Self::DetachFeed => "detachAgentSession",
            Self::ListSessions => "listAgentSessions",
            Self::ForkSession => "forkAgentSession",
            Self::ArchiveSession => "archiveAgentSession",
            Self::DeleteSession => "deleteAgentSession",
            Self::CloseSession => "closeAgentSession",
            Self::StageReferences => "stageAgentAttachments",
            Self::RevokeReferences => "revokeAgentAttachments",
            Self::ResolveWorkspaceReferences => "resolveAgentWorkspaceReferences",
            Self::PickWorkspaceReferences => "pickAgentWorkspaceReferences",
            Self::StartTurn => "startAgentTurn",
            Self::SteerTurn => "steerAgentTurn",
            Self::InterruptTurn => "interruptAgentTurn",
            Self::CompactSession => "compactAgentSession",
            Self::ResolveApproval => "resolveAgentApproval",
            Self::ResolveQuestion => "resolveAgentQuestion",
            Self::ManageExecutions => "manageAgentExecutions",
            Self::TerminateExecution => "terminateAgentExecution",
        }
    }

    /// The operation of port method `method`.
    pub fn of_method(method: &str) -> Option<Self> {
        Self::MAIN
            .iter()
            .chain(&[Self::ManageExecutions, Self::TerminateExecution])
            .copied()
            .find(|operation| operation.method() == method)
            .or(match method {
                "discoverAgentProviders" => Some(Self::DiscoverRuntimes),
                _ => None,
            })
    }
}

/// `AgentRuntimeRequest` (discovery, models, account) and
/// `AgentLocalConnectionsRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh: Option<bool>,
}

/// `AgentSessionCreateRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSession {
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creation_id: Option<String>,
}

/// `AgentSessionResumeRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSession {
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

/// `AgentSessionOpenRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSession {
    pub root_path: String,
    pub session_id: String,
    pub runtime_id: String,
}

/// `AgentReplayRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySession {
    pub root_path: String,
    pub session_id: String,
    pub after_sequence: i64,
}

/// `AgentSessionAttachRequest`: one session (and its live instance).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTarget {
    pub root_path: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

/// `AgentSessionFeedAckRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedAck {
    pub root_path: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    pub subscription_id: String,
    pub stream_id: String,
    pub revision: i64,
}

/// `AgentSessionDetachRequest` (and the watermark read).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedTarget {
    pub root_path: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    pub subscription_id: String,
}

/// `AgentSessionsListRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessions {
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discover_native: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

/// `AgentSessionMutationRequest` (fork, archive, delete).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryAction {
    pub root_path: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_native: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_native: Option<bool>,
}

/// `AgentSessionCloseRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseSession {
    pub root_path: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove_persistence: Option<bool>,
}

/// One file to stage: its native path, or its bytes when it has none.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StageFile {
    pub name: String,
    /// `file.type`.
    pub mime: String,
    pub size: f64,
    /// The native path, captured before any byte is read.
    pub path: Option<String>,
    /// The bytes of a file without a native path.
    pub bytes: Option<std::sync::Arc<Vec<u8>>>,
}

impl StageFile {
    /// The native path, when it is a usable one.
    pub fn native_path(&self) -> Option<&str> {
        self.path
            .as_deref()
            .filter(|path| !js::trim(path).is_empty())
    }
}

/// `AgentReferenceStageRequest`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StageReferences {
    pub root_path: String,
    pub epoch: String,
    pub files: Vec<StageFile>,
}

/// `AgentReferenceRevokeRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeReferences {
    pub root_path: String,
    pub tokens: Vec<String>,
}

/// `AgentWorkspaceReferenceResolveRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveWorkspaceReferences {
    pub root_path: String,
    pub paths: Vec<String>,
}

/// The workspace picker's root.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTarget {
    pub root_path: String,
}

/// `AgentCommandPrecondition`: a command captured for an older instance,
/// adapter or run is rejected.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPreconditions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_session_epoch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_adapter_generation: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_run_generation: Option<i64>,
}

/// `AgentTurnStartRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTurn {
    pub root_path: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_of_turn_id: Option<String>,
    #[serde(flatten)]
    pub preconditions: CommandPreconditions,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_epoch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_mentions: Option<Vec<PromptMention>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<FileReference>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_references: Option<Vec<FileReference>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<DraftReference>>,
}

/// `AgentTurnSteerRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteerTurn {
    pub root_path: String,
    pub session_id: String,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(flatten)]
    pub preconditions: CommandPreconditions,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_epoch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_mentions: Option<Vec<PromptMention>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<DraftReference>>,
}

/// `AgentTurnInterruptRequest`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptTurn {
    pub root_path: String,
    pub session_id: String,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(flatten)]
    pub preconditions: CommandPreconditions,
}

/// Compaction of a session's context.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactSession {
    pub root_path: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
}

/// `AgentApprovalDecision`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    AcceptForSession,
    Decline,
    Cancel,
}

impl ApprovalDecision {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "accept" => Self::Accept,
            "acceptForSession" => Self::AcceptForSession,
            "decline" => Self::Decline,
            "cancel" => Self::Cancel,
            _ => return None,
        })
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::AcceptForSession => "acceptForSession",
            Self::Decline => "decline",
            Self::Cancel => "cancel",
        }
    }
}

/// `AgentApprovalResolution`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApproval {
    pub root_path: String,
    pub session_id: String,
    pub turn_id: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(flatten)]
    pub preconditions: CommandPreconditions,
    pub decision: ApprovalDecision,
}

/// `AgentQuestionResolution["answer"]`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum QuestionAnswer {
    Text(String),
    Choices(Vec<String>),
    Matrix(Vec<Vec<String>>),
}

/// `AgentQuestionResolution`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveQuestion {
    pub root_path: String,
    pub session_id: String,
    pub turn_id: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(flatten)]
    pub preconditions: CommandPreconditions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<QuestionAnswer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<Vec<Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejected: Option<bool>,
}

/// A window's request of the Agent host.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentRequest {
    DiscoverRuntimes(RuntimeQuery),
    DiscoverLocalConnections(RuntimeQuery),
    ListModels(RuntimeQuery),
    ReadAccount(RuntimeQuery),
    CreateSession(CreateSession),
    ResumeSession(ResumeSession),
    OpenSession(OpenSession),
    ReplaySession(ReplaySession),
    AttachSession(SessionTarget),
    AcknowledgeFeed(FeedAck),
    ReadFeedWatermark(FeedTarget),
    DetachFeed(FeedTarget),
    ListSessions(ListSessions),
    ForkSession(HistoryAction),
    ArchiveSession(HistoryAction),
    DeleteSession(HistoryAction),
    CloseSession(CloseSession),
    StageReferences(StageReferences),
    RevokeReferences(RevokeReferences),
    ResolveWorkspaceReferences(ResolveWorkspaceReferences),
    PickWorkspaceReferences(WorkspaceTarget),
    StartTurn(StartTurn),
    SteerTurn(SteerTurn),
    InterruptTurn(InterruptTurn),
    CompactSession(CompactSession),
    ResolveApproval(ResolveApproval),
    ResolveQuestion(ResolveQuestion),
    ManageExecutions,
    TerminateExecution,
}

macro_rules! each_request {
    ($self:expr, $bind:ident => $body:expr, stage $stage:ident => $stage_body:expr, none => $none:expr) => {
        match $self {
            AgentRequest::DiscoverRuntimes($bind)
            | AgentRequest::DiscoverLocalConnections($bind)
            | AgentRequest::ListModels($bind)
            | AgentRequest::ReadAccount($bind) => $body,
            AgentRequest::CreateSession($bind) => $body,
            AgentRequest::ResumeSession($bind) => $body,
            AgentRequest::OpenSession($bind) => $body,
            AgentRequest::ReplaySession($bind) => $body,
            AgentRequest::AttachSession($bind) => $body,
            AgentRequest::AcknowledgeFeed($bind) => $body,
            AgentRequest::ReadFeedWatermark($bind) | AgentRequest::DetachFeed($bind) => $body,
            AgentRequest::ListSessions($bind) => $body,
            AgentRequest::ForkSession($bind)
            | AgentRequest::ArchiveSession($bind)
            | AgentRequest::DeleteSession($bind) => $body,
            AgentRequest::CloseSession($bind) => $body,
            AgentRequest::StageReferences($stage) => $stage_body,
            AgentRequest::RevokeReferences($bind) => $body,
            AgentRequest::ResolveWorkspaceReferences($bind) => $body,
            AgentRequest::PickWorkspaceReferences($bind) => $body,
            AgentRequest::StartTurn($bind) => $body,
            AgentRequest::SteerTurn($bind) => $body,
            AgentRequest::InterruptTurn($bind) => $body,
            AgentRequest::CompactSession($bind) => $body,
            AgentRequest::ResolveApproval($bind) => $body,
            AgentRequest::ResolveQuestion($bind) => $body,
            AgentRequest::ManageExecutions | AgentRequest::TerminateExecution => $none,
        }
    };
}

impl AgentRequest {
    pub fn operation(&self) -> AgentOperation {
        use AgentOperation as O;
        match self {
            Self::DiscoverRuntimes(_) => O::DiscoverRuntimes,
            Self::DiscoverLocalConnections(_) => O::DiscoverLocalConnections,
            Self::ListModels(_) => O::ListModels,
            Self::ReadAccount(_) => O::ReadAccount,
            Self::CreateSession(_) => O::CreateSession,
            Self::ResumeSession(_) => O::ResumeSession,
            Self::OpenSession(_) => O::OpenSession,
            Self::ReplaySession(_) => O::ReplaySession,
            Self::AttachSession(_) => O::AttachSession,
            Self::AcknowledgeFeed(_) => O::AcknowledgeFeed,
            Self::ReadFeedWatermark(_) => O::ReadFeedWatermark,
            Self::DetachFeed(_) => O::DetachFeed,
            Self::ListSessions(_) => O::ListSessions,
            Self::ForkSession(_) => O::ForkSession,
            Self::ArchiveSession(_) => O::ArchiveSession,
            Self::DeleteSession(_) => O::DeleteSession,
            Self::CloseSession(_) => O::CloseSession,
            Self::StageReferences(_) => O::StageReferences,
            Self::RevokeReferences(_) => O::RevokeReferences,
            Self::ResolveWorkspaceReferences(_) => O::ResolveWorkspaceReferences,
            Self::PickWorkspaceReferences(_) => O::PickWorkspaceReferences,
            Self::StartTurn(_) => O::StartTurn,
            Self::SteerTurn(_) => O::SteerTurn,
            Self::InterruptTurn(_) => O::InterruptTurn,
            Self::CompactSession(_) => O::CompactSession,
            Self::ResolveApproval(_) => O::ResolveApproval,
            Self::ResolveQuestion(_) => O::ResolveQuestion,
            Self::ManageExecutions => O::ManageExecutions,
            Self::TerminateExecution => O::TerminateExecution,
        }
    }

    /// The session the request names, if it names one.
    pub fn session_id(&self) -> Option<&str> {
        Some(match self {
            Self::ResumeSession(r) => r.session_id.as_deref()?,
            Self::OpenSession(r) => &r.session_id,
            Self::ReplaySession(r) => &r.session_id,
            Self::AttachSession(r) => &r.session_id,
            Self::AcknowledgeFeed(r) => &r.session_id,
            Self::ReadFeedWatermark(r) | Self::DetachFeed(r) => &r.session_id,
            Self::ForkSession(r) | Self::ArchiveSession(r) | Self::DeleteSession(r) => {
                &r.session_id
            }
            Self::CloseSession(r) => &r.session_id,
            Self::StartTurn(r) => &r.session_id,
            Self::SteerTurn(r) => &r.session_id,
            Self::InterruptTurn(r) => &r.session_id,
            Self::CompactSession(r) => &r.session_id,
            Self::ResolveApproval(r) => &r.session_id,
            Self::ResolveQuestion(r) => &r.session_id,
            _ => return None,
        })
    }

    /// The live instance the request targets, if it says.
    pub fn instance_id(&self) -> Option<&str> {
        match self {
            Self::ResumeSession(r) => r.instance_id.as_deref(),
            Self::AttachSession(r) => r.instance_id.as_deref(),
            Self::AcknowledgeFeed(r) => r.instance_id.as_deref(),
            Self::ReadFeedWatermark(r) | Self::DetachFeed(r) => r.instance_id.as_deref(),
            Self::ForkSession(r) | Self::ArchiveSession(r) | Self::DeleteSession(r) => {
                r.instance_id.as_deref()
            }
            Self::CloseSession(r) => r.instance_id.as_deref(),
            Self::StartTurn(r) => r.preconditions.instance_id.as_deref(),
            Self::SteerTurn(r) => r.preconditions.instance_id.as_deref(),
            Self::InterruptTurn(r) => r.preconditions.instance_id.as_deref(),
            Self::CompactSession(r) => r.instance_id.as_deref(),
            Self::ResolveApproval(r) => r.preconditions.instance_id.as_deref(),
            Self::ResolveQuestion(r) => r.preconditions.instance_id.as_deref(),
            _ => None,
        }
        .filter(|id| !id.is_empty())
    }

    /// Fills in the live instance of a request that names a session but
    /// not its instance.
    pub fn set_instance_id(&mut self, instance: &str) {
        let slot = match self {
            Self::ResumeSession(r) => &mut r.instance_id,
            Self::AttachSession(r) => &mut r.instance_id,
            Self::AcknowledgeFeed(r) => &mut r.instance_id,
            Self::ReadFeedWatermark(r) | Self::DetachFeed(r) => &mut r.instance_id,
            Self::ForkSession(r) | Self::ArchiveSession(r) | Self::DeleteSession(r) => {
                &mut r.instance_id
            }
            Self::CloseSession(r) => &mut r.instance_id,
            Self::StartTurn(r) => &mut r.preconditions.instance_id,
            Self::SteerTurn(r) => &mut r.preconditions.instance_id,
            Self::InterruptTurn(r) => &mut r.preconditions.instance_id,
            Self::CompactSession(r) => &mut r.instance_id,
            Self::ResolveApproval(r) => &mut r.preconditions.instance_id,
            Self::ResolveQuestion(r) => &mut r.preconditions.instance_id,
            _ => return,
        };
        *slot = Some(instance.to_string());
    }

    /// The workspace root the request is for (`rootPath`).
    pub fn root_path(&self) -> Option<&str> {
        each_request!(self, request => request_root(request), stage stage => Some(stage.root_path.as_str()), none => None)
    }

    /// The request in its transport form, checked against the contract as
    /// the product's IPC checks every request (`parseAgentIpcRequest`).
    pub fn to_value(&self) -> Contract<Value> {
        if !AgentOperation::MAIN.contains(&self.operation()) {
            return Ok(Value::Object(Default::default()));
        }
        parse_agent_ipc_request(self.operation().channel(), &self.transport())
    }

    /// The request's transport form as the window wrote it, unchecked.
    pub fn transport(&self) -> Value {
        each_request!(self, request => serde_json::to_value(request).unwrap_or(Value::Null), stage stage => stage_value(stage), none => Value::Object(Default::default()))
    }
}

trait Rooted {
    fn root(&self) -> Option<&str>;
}
macro_rules! rooted {
    ($($ty:ty),*) => { $(impl Rooted for $ty { fn root(&self) -> Option<&str> { Some(&self.root_path) } })* };
}
rooted!(
    CreateSession,
    ResumeSession,
    OpenSession,
    ReplaySession,
    SessionTarget,
    FeedAck,
    FeedTarget,
    ListSessions,
    HistoryAction,
    CloseSession,
    RevokeReferences,
    ResolveWorkspaceReferences,
    WorkspaceTarget,
    StartTurn,
    SteerTurn,
    InterruptTurn,
    CompactSession,
    ResolveApproval,
    ResolveQuestion
);
impl Rooted for RuntimeQuery {
    fn root(&self) -> Option<&str> {
        self.root_path.as_deref()
    }
}
fn request_root(request: &impl Rooted) -> Option<&str> {
    request.root()
}

fn stage_value(stage: &StageReferences) -> Value {
    let mut value = serde_json::json!({ "rootPath": stage.root_path, "epoch": stage.epoch });
    if stage.files.iter().all(|file| file.native_path().is_some()) {
        value["sourcePaths"] = stage
            .files
            .iter()
            .filter_map(|file| file.native_path().map(Value::from))
            .collect();
    } else {
        value["sources"] = stage
            .files
            .iter()
            .map(|file| match file.native_path() {
                Some(path) => serde_json::json!({ "path": path }),
                None => serde_json::json!({
                    "name": file.name,
                    "bytes": js::uint8array(file.bytes.as_deref().map_or(&[][..], Vec::as_slice)),
                }),
            })
            .collect();
    }
    value
}

/// What an operation answers.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentResponse {
    Inspection(Box<RuntimeInspection>),
    LocalConnections(LocalConnectionsSnapshot),
    Models(Vec<Model>),
    Account(Option<AccountState>),
    Snapshot(Box<SessionSnapshot>),
    /// `resumeAgentSession`: nothing to resume.
    NoSnapshot,
    FeedReceipt(Box<FeedReceipt>),
    FeedAcknowledgement(FeedAcknowledgement),
    FeedWatermark(FeedWatermark),
    Opened(SessionOpenResult),
    Sessions(Box<SessionsPage>),
    References(Vec<DraftReference>),
    Receipt(Receipt),
}

/// Why a response could not be read.
#[derive(Clone, Debug, PartialEq)]
pub enum ResponseError {
    /// Main reported the operation failed.
    Failed(OperationFailure),
    /// The answer does not satisfy the contract.
    Invalid(String),
}

impl AgentResponse {
    /// Reads `operation`'s answer from its transport form: a failure
    /// envelope is the operation's failure; anything else must satisfy the
    /// operation's response contract (`assertAgentIpcResponse`).
    pub fn read(operation: AgentOperation, value: &Value) -> Result<Self, ResponseError> {
        let invalid = |error: String| ResponseError::Invalid(error);
        if let Some(failure) = read_agent_operation_failure(value).map_err(|e| invalid(e.0))? {
            return Err(ResponseError::Failed(
                serde_json::from_value(failure).map_err(|e| invalid(e.to_string()))?,
            ));
        }
        let checked =
            operation != AgentOperation::AttachSession && AgentOperation::MAIN.contains(&operation);
        let value = if checked {
            assert_agent_ipc_response(operation.channel(), value).map_err(|e| invalid(e.0))?
        } else {
            value.clone()
        };
        Self::from_transport(operation, &value).map_err(invalid)
    }

    /// `operation`'s answer from a transport form that already satisfies
    /// its response contract (or a test double's plain answer). An attach
    /// receipt's snapshot is checked here, and a failing one kept as its
    /// reason, so the window can release the subscription it names.
    pub fn from_transport(operation: AgentOperation, value: &Value) -> Result<Self, String> {
        use AgentOperation as O;
        let snapshot = |value: &Value| SessionSnapshot::from_value(value).map(Box::new);
        Ok(match operation {
            O::DiscoverRuntimes => Self::Inspection(Box::new(parse(value.clone())?)),
            O::DiscoverLocalConnections => Self::LocalConnections(parse(value.clone())?),
            O::ListModels => Self::Models(parse(value.clone())?),
            O::ReadAccount => Self::Account(parse(value.clone())?),
            O::CreateSession | O::ReplaySession | O::ForkSession => {
                Self::Snapshot(snapshot(value)?)
            }
            O::ResumeSession => match value {
                Value::Null => Self::NoSnapshot,
                value => Self::Snapshot(snapshot(value)?),
            },
            O::AttachSession => {
                let subscription_id = super::validation::required_opaque_id(
                    value.get("subscriptionId"),
                    "subscriptionId",
                )
                .map_err(|e| e.0)?;
                let raw = value.get("snapshot").unwrap_or(&Value::Null);
                let snapshot = super::schema::assert_agent_session_snapshot(raw)
                    .map_err(|e| e.0)
                    .and_then(|()| snapshot(raw));
                Self::FeedReceipt(Box::new(FeedReceipt {
                    subscription_id,
                    snapshot,
                }))
            }
            O::AcknowledgeFeed => Self::FeedAcknowledgement(parse(value.clone())?),
            O::ReadFeedWatermark => Self::FeedWatermark(parse(value.clone())?),
            O::OpenSession => Self::Opened(match value.get("status").and_then(Value::as_str) {
                Some("opened") => SessionOpenResult::Opened(snapshot(
                    value.get("snapshot").unwrap_or(&Value::Null),
                )?),
                _ => SessionOpenResult::Failed(parse(
                    value.get("error").cloned().unwrap_or(Value::Null),
                )?),
            }),
            O::ListSessions => Self::Sessions(Box::new(parse(value.clone())?)),
            O::StageReferences | O::ResolveWorkspaceReferences | O::PickWorkspaceReferences => {
                Self::References(parse(value.clone())?)
            }
            _ => Self::Receipt(match value {
                Value::Null => Receipt::default(),
                value => parse(value.clone())?,
            }),
        })
    }
}

fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| error.to_string())
}

/// What the Agent host sends a window unasked.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentEvent {
    /// `agent:session-frame`.
    SessionFrame(SessionFrame),
}

impl SessionFrame {
    /// A frame from its transport form (`assertAgentSessionFrame`); one
    /// that fails the contract is [`SessionFrame::Malformed`].
    pub fn read(value: &Value) -> Self {
        let subscription = value
            .get("subscriptionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let malformed = |error: String| Self::Malformed {
            subscription_id: subscription.clone(),
            error,
        };
        if let Err(error) = super::schema::assert_agent_session_frame(value) {
            return malformed(error.0);
        }
        let text = |key: &str| js::string_or_empty(value.get(key));
        let integer = |key: &str| value.get(key).and_then(js::safe_integer).unwrap_or(0);
        if value.get("type").and_then(Value::as_str) == Some("resync-required") {
            return Self::ResyncRequired {
                subscription_id: text("subscriptionId"),
                stream_id: text("streamId"),
                revision: integer("revision"),
            };
        }
        let typed = (|| -> Result<Self, String> {
            Ok(Self::Delta {
                subscription_id: text("subscriptionId"),
                stream_id: text("streamId"),
                base_revision: integer("baseRevision"),
                revision: integer("revision"),
                control: Box::new(parse(value.get("control").cloned().unwrap_or_default())?),
                display_patch: DisplayPatch(value.get("displayPatch").cloned().unwrap_or_default()),
                session: Box::new(parse(value.get("session").cloned().unwrap_or_default())?),
            })
        })();
        typed.unwrap_or_else(malformed)
    }
}
