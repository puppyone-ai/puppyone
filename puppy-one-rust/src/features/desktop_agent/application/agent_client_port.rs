//! `application/AgentClientPort.ts`: the Renderer-side port the window's
//! Agent client implements. A request is one typed [`AgentRequest`]; its
//! answer one typed [`AgentResponse`]. [`AgentClient`] gives each
//! operation its own typed call; a client offers the optional operations
//! [`AgentClientPort::supports`] names.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::dto::{
    DraftReference, FeedAcknowledgement, FeedReceipt, FeedWatermark, Receipt, RuntimeInspection,
    SessionFailure, SessionFrame, SessionOpenResult, SessionSnapshot, SessionsPage,
};
use crate::agent::contract::protocol::*;
use futures_util::future::LocalBoxFuture;
use std::rc::Rc;

/// One port operation (`Promise<…>`).
pub type ClientFuture<T = AgentResponse> = LocalBoxFuture<'static, AgentResult<T>>;
/// An unsubscribe function.
pub type Cleanup = Box<dyn FnOnce()>;

/// The Agent client port.
pub trait AgentClientPort {
    /// Whether the client offers `operation` (`typeof bridge.method ===
    /// "function"`).
    fn supports(&self, operation: AgentOperation) -> bool;
    /// Whether the client delivers session frames
    /// (`bridge.onAgentSessionFrame` exists).
    fn delivers_frames(&self) -> bool {
        false
    }
    /// Sends `request`.
    fn request(&self, request: AgentRequest) -> ClientFuture;
    /// `bridge.onAgentSessionFrame?.(listener)`.
    fn on_agent_session_frame(&self, _listener: Rc<dyn Fn(SessionFrame)>) -> Option<Cleanup> {
        None
    }
    /// `bridge.onAgentSessionFailure?.(listener)`.
    fn on_agent_session_failure(&self, _listener: Rc<dyn Fn(SessionFailure)>) -> Option<Cleanup> {
        None
    }
}

/// `AgentClientProvider`.
pub type AgentClientProvider = Rc<dyn Fn() -> Option<Rc<dyn AgentClientPort>>>;

/// `bridge === other`.
pub fn same_client(a: &Rc<dyn AgentClientPort>, b: &Rc<dyn AgentClientPort>) -> bool {
    std::ptr::addr_eq(Rc::as_ptr(a), Rc::as_ptr(b))
}

/// `requireBridge(...methods)`: the bridge, when it offers every
/// operation.
pub fn require_bridge(
    provider: &AgentClientProvider,
    operations: &[AgentOperation],
) -> AgentResult<Rc<dyn AgentClientPort>> {
    match provider() {
        Some(bridge)
            if operations
                .iter()
                .all(|operation| bridge.supports(*operation)) =>
        {
            Ok(bridge)
        }
        _ => Err(super::agent_error::agent_known_error(
            "native-bridge-unavailable",
            None,
        )),
    }
}

fn unexpected(operation: AgentOperation) -> AgentError {
    AgentError::new(format!(
        "The Agent client answered {} with another operation's result.",
        operation.method()
    ))
    .with_name("TypeError")
}

macro_rules! typed_calls {
    ($($(#[$meta:meta])* fn $name:ident($request:ty) -> $ret:ty = $variant:ident => |$response:ident| $read:expr;)*) => {
        /// The port's operations, each with its request and answer types.
        pub trait AgentClient {
            $($(#[$meta])* fn $name(&self, request: $request) -> ClientFuture<$ret>;)*
            /// `bridge.manageAgentExecutions()`.
            fn manage_executions(&self) -> ClientFuture<Receipt>;
            /// `bridge.terminateAgentExecution()`.
            fn terminate_execution(&self) -> ClientFuture<Receipt>;
        }
        impl<P: AgentClientPort + ?Sized> AgentClient for P {
            $(fn $name(&self, request: $request) -> ClientFuture<$ret> {
                let call = self.request(AgentRequest::$variant(request));
                Box::pin(async move {
                    match call.await? {
                        $response => $read.ok_or_else(|| unexpected(AgentOperation::$variant)),
                    }
                })
            })*
            fn manage_executions(&self) -> ClientFuture<Receipt> {
                let call = self.request(AgentRequest::ManageExecutions);
                Box::pin(async move {
                    match call.await? {
                        AgentResponse::Receipt(receipt) => Ok(receipt),
                        _ => Err(unexpected(AgentOperation::ManageExecutions)),
                    }
                })
            }
            fn terminate_execution(&self) -> ClientFuture<Receipt> {
                let call = self.request(AgentRequest::TerminateExecution);
                Box::pin(async move {
                    match call.await? {
                        AgentResponse::Receipt(receipt) => Ok(receipt),
                        _ => Err(unexpected(AgentOperation::TerminateExecution)),
                    }
                })
            }
        }
    };
}

typed_calls! {
    /// `discoverAgentRuntimes(request)`.
    fn discover_runtimes(RuntimeQuery) -> RuntimeInspection = DiscoverRuntimes
        => |response| match response { AgentResponse::Inspection(i) => Some(*i), _ => None };
    /// `createAgentSession(request)`.
    fn create_session(CreateSession) -> SessionSnapshot = CreateSession
        => |response| match response { AgentResponse::Snapshot(s) => Some(*s), _ => None };
    /// `resumeAgentSession(request)`: `None` when there is nothing to resume.
    fn resume_session(ResumeSession) -> Option<SessionSnapshot> = ResumeSession
        => |response| match response {
            AgentResponse::Snapshot(s) => Some(Some(*s)),
            AgentResponse::NoSnapshot => Some(None),
            _ => None,
        };
    /// `openAgentSession(request)`.
    fn open_session(OpenSession) -> SessionOpenResult = OpenSession
        => |response| match response { AgentResponse::Opened(r) => Some(r), _ => None };
    /// `attachAgentSession(request)`.
    fn attach_session(SessionTarget) -> FeedReceipt = AttachSession
        => |response| match response { AgentResponse::FeedReceipt(r) => Some(*r), _ => None };
    /// `acknowledgeAgentSession(request)`.
    fn acknowledge_session(FeedAck) -> FeedAcknowledgement = AcknowledgeFeed
        => |response| match response { AgentResponse::FeedAcknowledgement(a) => Some(a), _ => None };
    /// `readAgentSessionWatermark(request)`.
    fn read_session_watermark(FeedTarget) -> FeedWatermark = ReadFeedWatermark
        => |response| match response { AgentResponse::FeedWatermark(w) => Some(w), _ => None };
    /// `detachAgentSession(request)`.
    fn detach_session(FeedTarget) -> Receipt = DetachFeed
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
    /// `listAgentSessions(request)`.
    fn list_sessions(ListSessions) -> SessionsPage = ListSessions
        => |response| match response { AgentResponse::Sessions(p) => Some(*p), _ => None };
    /// `closeAgentSession(request)`.
    fn close_session(CloseSession) -> Receipt = CloseSession
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
    /// `stageAgentAttachments(request)`.
    fn stage_attachments(StageReferences) -> Vec<DraftReference> = StageReferences
        => |response| match response { AgentResponse::References(r) => Some(r), _ => None };
    /// `revokeAgentAttachments(request)`.
    fn revoke_attachments(RevokeReferences) -> Receipt = RevokeReferences
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
    /// `resolveAgentWorkspaceReferences(request)`.
    fn resolve_workspace_references(ResolveWorkspaceReferences) -> Vec<DraftReference> = ResolveWorkspaceReferences
        => |response| match response { AgentResponse::References(r) => Some(r), _ => None };
    /// `pickAgentWorkspaceReferences(request)`.
    fn pick_workspace_references(WorkspaceTarget) -> Vec<DraftReference> = PickWorkspaceReferences
        => |response| match response { AgentResponse::References(r) => Some(r), _ => None };
    /// `startAgentTurn(request)`.
    fn start_turn(StartTurn) -> Receipt = StartTurn
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
    /// `steerAgentTurn(request)`.
    fn steer_turn(SteerTurn) -> Receipt = SteerTurn
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
    /// `interruptAgentTurn(request)`.
    fn interrupt_turn(InterruptTurn) -> Receipt = InterruptTurn
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
    /// `resolveAgentApproval(request)`.
    fn resolve_approval(ResolveApproval) -> Receipt = ResolveApproval
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
    /// `resolveAgentQuestion(request)`.
    fn resolve_question(ResolveQuestion) -> Receipt = ResolveQuestion
        => |response| match response { AgentResponse::Receipt(r) => Some(r), _ => None };
}

/// The bytes or native path behind a Renderer `File`.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentFileSource {
    /// `webUtils.getPathForFile(file)`.
    Path(String),
    /// A clipboard/browser file without a native path.
    Bytes(Rc<Vec<u8>>),
}

/// A Renderer `File` (`name`, `type`, `size`).
#[derive(Clone, Debug, PartialEq)]
pub struct AgentFile {
    pub name: String,
    /// `file.type`.
    pub mime: String,
    pub size: f64,
    pub source: AgentFileSource,
}

impl AgentFile {
    /// The file as staging reads it.
    pub fn to_stage_file(&self) -> StageFile {
        StageFile {
            name: self.name.clone(),
            mime: self.mime.clone(),
            size: self.size,
            path: match &self.source {
                AgentFileSource::Path(path) => Some(path.clone()),
                AgentFileSource::Bytes(_) => None,
            },
            bytes: match &self.source {
                AgentFileSource::Path(_) => None,
                AgentFileSource::Bytes(bytes) => Some(std::sync::Arc::new((**bytes).clone())),
            },
        }
    }
}
