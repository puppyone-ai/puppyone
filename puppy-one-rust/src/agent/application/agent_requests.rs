//! The Agent host's request entry (`electron/main/ipc/agent-ipc.mjs`'s
//! handlers without the IPC). A window's [`AgentRequest`] is checked
//! against the shared contract, its workspace root is authorized before
//! the service sees it, turn references are authorized and leased here, and
//! every answer is read against the operation's response contract before
//! it leaves the host (a failure is the plain operation failure).
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_reference_authorization::{
    ReferenceBudget, ResolveResource, authorize_agent_references, workspace_draft_references,
};
use crate::agent::application::agent_input_policy::require_supported_agent_references;
use crate::agent::application::agent_service::AgentService;
use crate::agent::application::ports::Pending;
use crate::agent::connections::local_agent_inventory::LocalAgentInventory;
use crate::agent::contract::dto::OperationFailure;
use crate::agent::contract::js;
use crate::agent::contract::protocol::{
    AgentOperation, AgentRequest, AgentResponse, ResponseError,
};
use crate::agent::contract::schema::{assert_agent_ipc_response, parse_agent_ipc_request};
use crate::agent::infrastructure::attachments::agent_attachment_store::AgentAttachmentStore;
use crate::agent::runtime::agent_operation_error::agent_operation_failure;
use crate::agent::sender::Sender;
use serde_json::{Value, json};
use std::rc::Rc;

/// The Agent service requests reach (the in-process service, or a test
/// double).
pub trait AgentRequestService {
    fn discover_providers(
        &self,
        sender: &Sender,
        request: Value,
        root: Option<String>,
    ) -> Pending<Value>;
    fn list_models(&self, sender: &Sender, request: Value, root: Option<String>) -> Pending<Value>;
    fn read_account(&self, sender: &Sender, request: Value, root: Option<String>)
    -> Pending<Value>;
    fn create_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn resume_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn open_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn replay(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn attach_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn acknowledge_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn read_session_watermark(
        &self,
        sender: &Sender,
        request: Value,
        root: String,
    ) -> Pending<Value>;
    fn detach_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn list_sessions(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn fork_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn archive_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn delete_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn close_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn start_turn(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn steer_turn(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn interrupt_turn(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn compact_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn resolve_approval(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    fn resolve_question(&self, sender: &Sender, request: Value, root: String) -> Pending<Value>;
    /// `getReferenceInputCapabilities(sender, sessionId, root)`.
    fn get_reference_input_capabilities(
        &self,
        sender: &Sender,
        session_id: Option<Value>,
        root: String,
    ) -> Pending<Value>;
}

/// `authorizeWorkspaceRoot(event, requestedRoot)`: the canonical root this
/// window may use.
pub type AuthorizeWorkspaceRoot = Rc<dyn Fn(&Sender, String) -> Pending<String>>;
/// `resolveWorkspaceResource(event, resource, { legacyRoot })`.
pub type ResolveWorkspaceResource = Rc<dyn Fn(&Sender, String, String) -> Pending<Value>>;
/// `dialog.showOpenDialog(owner, { defaultPath, properties })`: the
/// chosen paths (empty when cancelled).
pub type PickWorkspacePaths = Rc<dyn Fn(&Sender, String) -> Pending<Vec<String>>>;

/// `registerAgentIpcHandlers({ … })`: what requests are handled with.
#[derive(Clone)]
pub struct AgentRequests {
    pub agent_service: Rc<dyn AgentRequestService>,
    pub local_agent_inventory: Option<LocalAgentInventory>,
    pub authorize_workspace_root: AuthorizeWorkspaceRoot,
    pub resolve_workspace_resource: Option<ResolveWorkspaceResource>,
    pub attachment_store: Option<AgentAttachmentStore>,
    pub pick_workspace_paths: Option<PickWorkspacePaths>,
}

fn invalid(message: &str) -> AgentError {
    AgentError::new(message)
}

/// The failure as plain data (`agentOperationFailure`).
fn failure_of(error: AgentError) -> OperationFailure {
    let envelope = agent_operation_failure(error);
    serde_json::from_value(envelope["agentFailure"].clone()).unwrap_or_default()
}

impl AgentRequests {
    /// Handles `request` from `sender`: its answer, or why it failed.
    pub async fn handle(
        &self,
        sender: &Sender,
        request: AgentRequest,
    ) -> Result<AgentResponse, OperationFailure> {
        let operation = request.operation();
        let response = async {
            let value = request.to_value()?;
            self.dispatch(sender, operation, value).await
        }
        .await;
        let read = response.and_then(|value| {
            AgentResponse::read(operation, &value).map_err(|error| match error {
                ResponseError::Failed(failure) => {
                    AgentError::coded(&failure.code, failure.message.clone())
                }
                ResponseError::Invalid(message) => AgentError::new(message).with_name("TypeError"),
            })
        });
        read.map_err(failure_of)
    }

    /// Handles `operation`'s request in its transport form: the answer, or
    /// the operation-failure envelope (`ipcMain.handle`'s listener).
    pub async fn handle_value(
        &self,
        sender: &Sender,
        operation: AgentOperation,
        raw: &Value,
    ) -> Value {
        let result = async {
            if !AgentOperation::MAIN.contains(&operation) {
                return Err(invalid("Unsupported Agent operation."));
            }
            let request = parse_agent_ipc_request(operation.channel(), raw)?;
            let response = self.dispatch(sender, operation, request).await?;
            Ok(assert_agent_ipc_response(operation.channel(), &response)?)
        }
        .await;
        result.unwrap_or_else(agent_operation_failure)
    }

    async fn optional_root(&self, sender: &Sender, request: &Value) -> AgentResult<Option<String>> {
        match request
            .get("rootPath")
            .and_then(Value::as_str)
            .filter(|r| !r.is_empty())
        {
            Some(root) => Ok(Some(
                (self.authorize_workspace_root)(sender, root.to_string()).await?,
            )),
            None => Ok(None),
        }
    }

    async fn required_root(&self, sender: &Sender, request: &Value) -> AgentResult<String> {
        let requested = js::to_js_string(request.get("rootPath"));
        (self.authorize_workspace_root)(sender, requested).await
    }

    fn resource_resolver(&self, sender: &Sender, workspace_root: &str) -> Option<ResolveResource> {
        let resolve = self.resolve_workspace_resource.clone()?;
        let (sender, legacy_root) = (sender.clone(), workspace_root.to_string());
        Some(Rc::new(move |resource: String| {
            resolve(&sender, resource, legacy_root.clone())
        }))
    }

    fn attachments(&self) -> AgentResult<&AgentAttachmentStore> {
        self.attachment_store
            .as_ref()
            .ok_or_else(|| invalid("Agent attachment staging is unavailable."))
    }

    async fn dispatch(
        &self,
        sender: &Sender,
        operation: AgentOperation,
        request: Value,
    ) -> AgentResult<Value> {
        use AgentOperation as O;
        let service = &self.agent_service;
        match operation {
            O::DiscoverRuntimes => {
                let root = self.optional_root(sender, &request).await?;
                service.discover_providers(sender, request, root).await
            }
            O::DiscoverLocalConnections => {
                let root = self.optional_root(sender, &request).await?;
                let Some(inventory) = self.local_agent_inventory.as_ref() else {
                    return Err(invalid("Local Agent inventory is unavailable."));
                };
                inventory
                    .discover(request.get("refresh") == Some(&Value::Bool(true)), root)
                    .await
            }
            O::ListModels => {
                let root = self.optional_root(sender, &request).await?;
                service.list_models(sender, request, root).await
            }
            O::ReadAccount => {
                let root = self.optional_root(sender, &request).await?;
                service.read_account(sender, request, root).await
            }
            O::StageReferences => {
                let root = self.required_root(sender, &request).await?;
                let staged = self
                    .attachments()?
                    .stage(&json!({
                        "ownerId": sender.id(),
                        "workspaceRoot": root,
                        "epoch": request.get("epoch"),
                        "sourcePaths": request.get("sourcePaths"),
                        "sources": request.get("sources"),
                    }))
                    .await?;
                Ok(Value::Array(staged))
            }
            O::RevokeReferences => {
                let root = self.required_root(sender, &request).await?;
                self.attachments()?.revoke(&json!({
                    "ownerId": sender.id(),
                    "workspaceRoot": root,
                    "tokens": request.get("tokens"),
                }))
            }
            O::ResolveWorkspaceReferences => {
                let root = self.required_root(sender, &request).await?;
                let paths = request["paths"].as_array().cloned().unwrap_or_default();
                let mut budget = ReferenceBudget::default();
                let authorized = authorize_agent_references(
                    &root,
                    &paths,
                    &mut budget,
                    self.resource_resolver(sender, &root),
                )
                .await?;
                Ok(Value::Array(workspace_draft_references(&authorized)))
            }
            O::PickWorkspaceReferences => {
                let root = self.required_root(sender, &request).await?;
                let Some(pick) = self.pick_workspace_paths.as_ref() else {
                    return Err(invalid("The workspace picker is unavailable."));
                };
                let paths = pick(sender, root.clone()).await?;
                if paths.is_empty() {
                    return Ok(json!([]));
                }
                let paths: Vec<Value> = paths.into_iter().map(Value::from).collect();
                let mut budget = ReferenceBudget::default();
                let authorized = authorize_agent_references(
                    &root,
                    &paths,
                    &mut budget,
                    self.resource_resolver(sender, &root),
                )
                .await?;
                Ok(Value::Array(workspace_draft_references(&authorized)))
            }
            O::StartTurn => self.dispatch_start(sender, request).await,
            O::SteerTurn => self.dispatch_steer(sender, request).await,
            O::ManageExecutions | O::TerminateExecution => {
                Err(invalid("Unsupported Agent operation."))
            }
            _ => {
                let root = self.required_root(sender, &request).await?;
                match operation {
                    O::CreateSession => service.create_session(sender, request, root).await,
                    O::ResumeSession => service.resume_session(sender, request, root).await,
                    O::OpenSession => service.open_session(sender, request, root).await,
                    O::ReplaySession => service.replay(sender, request, root).await,
                    O::AttachSession => service.attach_session(sender, request, root).await,
                    O::AcknowledgeFeed => service.acknowledge_session(sender, request, root).await,
                    O::ReadFeedWatermark => {
                        service.read_session_watermark(sender, request, root).await
                    }
                    O::DetachFeed => service.detach_session(sender, request, root).await,
                    O::ListSessions => service.list_sessions(sender, request, root).await,
                    O::ForkSession => service.fork_session(sender, request, root).await,
                    O::ArchiveSession => service.archive_session(sender, request, root).await,
                    O::DeleteSession => service.delete_session(sender, request, root).await,
                    O::CloseSession => service.close_session(sender, request, root).await,
                    O::InterruptTurn => service.interrupt_turn(sender, request, root).await,
                    O::CompactSession => service.compact_session(sender, request, root).await,
                    O::ResolveApproval => service.resolve_approval(sender, request, root).await,
                    O::ResolveQuestion => service.resolve_question(sender, request, root).await,
                    _ => Err(invalid("Unsupported Agent operation.")),
                }
            }
        }
    }

    /// `dispatchStart(event, request)`.
    async fn dispatch_start(&self, sender: &Sender, request: Value) -> AgentResult<Value> {
        let root = self.required_root(sender, &request).await?;
        let capabilities = self
            .agent_service
            .get_reference_input_capabilities(
                sender,
                request.get("sessionId").cloned(),
                root.clone(),
            )
            .await?;
        let references = match request.get("references").and_then(Value::as_array) {
            Some(references) => references.clone(),
            None => [request.get("contextReferences"), request.get("attachments")]
                .into_iter()
                .flatten()
                .filter_map(Value::as_array)
                .flatten()
                .map(|entry| {
                    js::with(
                        &js::with(entry, "kind", "workspace-entry"),
                        "entryType",
                        "file",
                    )
                })
                .collect(),
        };
        let (authorized, staged_tokens) = self
            .authorize_turn_references(sender, &root, &request, &references, &capabilities)
            .await?;
        let mut forwarded = js::with(&request, "references", Value::Array(authorized));
        js::delete(&mut forwarded, "attachments");
        js::delete(&mut forwarded, "contextReferences");
        self.with_staged_reference_lease(sender, &root, &request, staged_tokens, forwarded, false)
            .await
    }

    /// `dispatchSteer(event, request)`.
    async fn dispatch_steer(&self, sender: &Sender, request: Value) -> AgentResult<Value> {
        let root = self.required_root(sender, &request).await?;
        let capabilities = self
            .agent_service
            .get_reference_input_capabilities(
                sender,
                request.get("sessionId").cloned(),
                root.clone(),
            )
            .await?;
        let references = request["references"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let (authorized, staged_tokens) = self
            .authorize_turn_references(sender, &root, &request, &references, &capabilities)
            .await?;
        let forwarded = if authorized.is_empty() {
            request.clone()
        } else {
            js::with(&request, "references", Value::Array(authorized))
        };
        self.with_staged_reference_lease(sender, &root, &request, staged_tokens, forwarded, true)
            .await
    }

    /// `withStagedReferenceLease({ … })`: the staged snapshots a turn reads
    /// are leased for it; a failed dispatch releases them.
    async fn with_staged_reference_lease(
        &self,
        sender: &Sender,
        root: &str,
        request: &Value,
        tokens: Vec<String>,
        forwarded: Value,
        steer: bool,
    ) -> AgentResult<Value> {
        let service = &self.agent_service;
        let invoke = |forwarded: Value| {
            if steer {
                service.steer_turn(sender, forwarded, root.to_string())
            } else {
                service.start_turn(sender, forwarded, root.to_string())
            }
        };
        if tokens.is_empty() {
            return invoke(forwarded).await;
        }
        let store = self.attachments()?;
        let lease_id = format!("lease-{}", uuid::Uuid::new_v4());
        let lease = json!({
            "ownerId": sender.id(),
            "workspaceRoot": root,
            "epoch": request.get("referenceEpoch"),
            "tokens": tokens,
            "leaseId": lease_id,
        });
        store.lease(&lease).await?;
        let forwarded = js::with(
            &forwarded,
            "privateReferenceLease",
            json!({ "leaseId": lease_id, "tokens": tokens }),
        );
        match invoke(forwarded).await {
            Ok(result) => Ok(result),
            Err(error) => {
                let _ = store.release_lease(&lease);
                Err(error)
            }
        }
    }

    /// `authorizeTurnReferences({ … })`: workspace entries and staged
    /// snapshots share one budget and the runtime's reference contract.
    async fn authorize_turn_references(
        &self,
        sender: &Sender,
        root: &str,
        request: &Value,
        references: &[Value],
        capabilities: &Value,
    ) -> AgentResult<(Vec<Value>, Vec<String>)> {
        let profile = json!({ "referenceInputs": capabilities });
        require_supported_agent_references(Some(&profile), references)?;
        let mut budget = ReferenceBudget::default();
        let workspace_entries: Vec<Value> = references
            .iter()
            .filter(|entry| entry.get("kind").and_then(Value::as_str) != Some("staged-attachment"))
            .cloned()
            .collect();
        let workspace = authorize_agent_references(
            root,
            &workspace_entries,
            &mut budget,
            self.resource_resolver(sender, root),
        )
        .await?;
        let staged_drafts: Vec<Value> = references
            .iter()
            .filter(|entry| entry.get("kind").and_then(Value::as_str) == Some("staged-attachment"))
            .cloned()
            .collect();
        if staged_drafts.len() > budget.remaining_references {
            return Err(invalid("Agent references exceed the 32-file safety limit."));
        }
        let staged = if staged_drafts.is_empty() {
            Vec::new()
        } else {
            self.attachments()?
                .authorize(&json!({
                    "ownerId": sender.id(),
                    "workspaceRoot": root,
                    "epoch": request.get("referenceEpoch"),
                    "references": staged_drafts,
                }))
                .await?
        };
        let staged_bytes: u64 = staged
            .iter()
            .filter_map(|entry| entry["size"].as_u64())
            .sum();
        if staged_bytes > budget.remaining_bytes {
            return Err(invalid(
                "Agent references exceed the 25 MB total safety limit.",
            ));
        }
        let authorized: Vec<Value> = workspace.into_iter().chain(staged).collect();
        require_supported_agent_references(Some(&profile), &authorized)?;
        let mut tokens: Vec<String> = Vec::new();
        for token in staged_drafts
            .iter()
            .filter_map(|draft| draft.get("token").and_then(Value::as_str))
        {
            if !tokens.iter().any(|t| t == token) {
                tokens.push(token.to_string());
            }
        }
        Ok((authorized, tokens))
    }
}

/// The in-process Agent service.
impl AgentRequestService for AgentService {
    fn discover_providers(
        &self,
        _sender: &Sender,
        request: Value,
        root: Option<String>,
    ) -> Pending<Value> {
        let service = self.clone();
        Box::pin(async move { service.discover_providers(&request, root.as_deref()).await })
    }
    fn list_models(
        &self,
        _sender: &Sender,
        request: Value,
        root: Option<String>,
    ) -> Pending<Value> {
        let service = self.clone();
        Box::pin(async move { service.list_models(&request, root.as_deref()).await })
    }
    fn read_account(
        &self,
        _sender: &Sender,
        request: Value,
        root: Option<String>,
    ) -> Pending<Value> {
        let service = self.clone();
        Box::pin(async move { service.read_account(&request, root.as_deref()).await })
    }
    fn create_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.create_session(&sender, &request, &root).await })
    }
    fn resume_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.resume_session(&sender, &request, &root).await })
    }
    fn open_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.open_session(&sender, &request, &root).await })
    }
    fn replay(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let result = AgentService::replay(self, sender, &request, Some(&root));
        Box::pin(async move { result })
    }
    fn attach_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let result = AgentService::attach_session(self, sender, &request, &root);
        Box::pin(async move { result })
    }
    fn acknowledge_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let result = AgentService::acknowledge_session(self, sender, &request, &root);
        Box::pin(async move { result })
    }
    fn read_session_watermark(
        &self,
        sender: &Sender,
        request: Value,
        root: String,
    ) -> Pending<Value> {
        let result = AgentService::read_session_watermark(self, sender, &request, &root);
        Box::pin(async move { result })
    }
    fn detach_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let result = AgentService::detach_session(self, sender, &request, &root);
        Box::pin(async move { result })
    }
    fn list_sessions(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.list_sessions(&sender, &request, &root).await })
    }
    fn fork_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.fork_session(&sender, &request, Some(&root)).await })
    }
    fn archive_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.archive_session(&sender, &request, &root).await })
    }
    fn delete_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.delete_session(&sender, &request, &root).await })
    }
    fn close_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.close_session(&sender, &request, Some(&root)).await })
    }
    fn start_turn(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.start_turn(&sender, &request, Some(&root)).await })
    }
    fn steer_turn(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.steer_turn(&sender, &request, Some(&root)).await })
    }
    fn interrupt_turn(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move { service.interrupt_turn(&sender, &request, Some(&root)).await })
    }
    fn compact_session(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move {
            service
                .compact_session(&sender, &request, Some(&root))
                .await
        })
    }
    fn resolve_approval(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move {
            service
                .resolve_approval(&sender, &request, Some(&root))
                .await
        })
    }
    fn resolve_question(&self, sender: &Sender, request: Value, root: String) -> Pending<Value> {
        let (service, sender) = (self.clone(), sender.clone());
        Box::pin(async move {
            service
                .resolve_question(&sender, &request, Some(&root))
                .await
        })
    }
    fn get_reference_input_capabilities(
        &self,
        sender: &Sender,
        session_id: Option<Value>,
        root: String,
    ) -> Pending<Value> {
        let result = AgentService::get_reference_input_capabilities(
            self,
            sender,
            session_id.as_ref(),
            Some(&root),
        );
        Box::pin(async move { result })
    }
}
