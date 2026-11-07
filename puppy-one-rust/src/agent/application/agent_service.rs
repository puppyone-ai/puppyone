//! `application/agent-service.mjs`: the provider-neutral Agent application
//! facade. Composition only: command behavior belongs to focused
//! coordinators, while this API is the stable boundary IPC consumes.
use super::agent_event_journal::AgentEventJournal;
use super::agent_runtime_catalog::AgentRuntimeCatalog;
use super::agent_session_store::AgentSessionStore;
use super::history::agent_history_queries::AgentHistoryQueries;
use super::history::history_catalog_port::create_history_catalog_port;
use super::history::native_conversation_indexer::NativeConversationIndexer;
use super::ports::{AttachmentStore, ConsoleLogger, HistoryCatalog, Logger, SessionCache};
use super::processes::agent_process_supervisor::AgentProcessSupervisor;
use super::runtime_resolution::runtime_resolution_coordinator::RuntimeResolutionCoordinator;
use super::session::agent_session_commands::AgentSessionCommands;
use super::session::agent_session_feed::AgentSessionFeed;
use super::session::agent_session_lifecycle::AgentSessionLifecycle;
use super::session::agent_session_runtime::AgentSessionRuntime;
use super::turn::agent_turn_coordinator::AgentTurnCoordinator;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::domain::agent_session_model::SessionRef;
use crate::agent::runtime::agent_runtime_registry::AgentRuntimeRegistry;
use crate::agent::sender::Sender;
use futures_util::future::join;
use serde_json::Value;
use std::rc::Rc;
use tokio::task::spawn_local;

/// `createAgentService({ runtimeRegistry, sessionCache, conversationCatalog, logger, attachmentStore, processSupervisor })`.
pub struct AgentServiceOptions {
    pub runtime_registry: AgentRuntimeRegistry,
    pub session_cache: Rc<dyn SessionCache>,
    pub conversation_catalog: Option<Rc<dyn HistoryCatalog>>,
    pub logger: Option<Rc<dyn Logger>>,
    pub attachment_store: Option<Rc<dyn AttachmentStore>>,
    pub process_supervisor: Option<AgentProcessSupervisor>,
}

#[derive(Clone)]
pub struct AgentService {
    store: AgentSessionStore,
    coordinator: RuntimeResolutionCoordinator,
    catalog: AgentRuntimeCatalog,
    indexer: NativeConversationIndexer,
    history: AgentHistoryQueries,
    feed: AgentSessionFeed,
    lifecycle: AgentSessionLifecycle,
    turns: AgentTurnCoordinator,
    commands: AgentSessionCommands,
}

impl AgentService {
    pub fn new(options: AgentServiceOptions) -> Self {
        let logger: Rc<dyn Logger> = options.logger.unwrap_or_else(|| Rc::new(ConsoleLogger));
        let supervisor = options.process_supervisor.unwrap_or_default();
        let store = AgentSessionStore::new();
        let coordinator = RuntimeResolutionCoordinator::new(
            options.runtime_registry.clone(),
            supervisor.clone(),
            None,
        );
        let catalog = AgentRuntimeCatalog::new(coordinator.clone());
        let history_catalog = create_history_catalog_port(
            options
                .conversation_catalog
                .or_else(|| options.session_cache.history_catalog()),
        );
        let indexer = NativeConversationIndexer::new(
            options.runtime_registry.clone(),
            coordinator.clone(),
            history_catalog.clone(),
            supervisor.clone(),
        );
        let history = AgentHistoryQueries::new(history_catalog, indexer.clone());
        let journal = AgentEventJournal::new(options.session_cache.clone(), logger.clone());
        let feed = AgentSessionFeed::new(logger.clone());
        let runtime = AgentSessionRuntime::new(
            options.runtime_registry,
            coordinator.clone(),
            supervisor,
            store.clone(),
            options.session_cache,
            options.attachment_store,
            logger,
            journal,
        );
        let lifecycle = AgentSessionLifecycle::new(runtime.clone());
        {
            let lifecycle = lifecycle.clone();
            store.set_on_owner_destroyed(Rc::new(move |owner| {
                let lifecycle = lifecycle.clone();
                spawn_local(async move {
                    if let Err(error) = lifecycle.close_sessions_for_window(owner).await {
                        eprintln!(
                            "Unable to stop Agent resources after window destruction: {error}"
                        );
                    }
                });
            }));
        }
        let turns = AgentTurnCoordinator::new(runtime.clone());
        let commands = AgentSessionCommands::new(runtime);
        Self {
            store,
            coordinator,
            catalog,
            indexer,
            history,
            feed,
            lifecycle,
            turns,
            commands,
        }
    }

    fn require_feed_session(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: &str,
    ) -> AgentResult<SessionRef> {
        if request["instanceId"]
            .as_str()
            .is_some_and(|i| !i.is_empty())
        {
            self.store
                .assert_instance(sender, request, Some(workspace_root), false)?;
        }
        let session = self.store.require_owned(sender, request.get("sessionId"))?;
        if session.workspace_root() != workspace_root {
            return Err(AgentError::new(
                "Agent session workspace does not match the authorized workspace.",
            ));
        }
        Ok(session)
    }

    pub fn invalidate_runtime_readiness(&self) -> u64 {
        self.coordinator.clear()
    }
    pub fn assert_session_instance(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
        allow_closed: bool,
    ) -> AgentResult<Option<SessionRef>> {
        self.store
            .assert_instance(sender, request, root, allow_closed)
    }
    pub async fn discover_providers(
        &self,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        self.catalog.discover(request, workspace_root).await
    }
    pub async fn list_models(
        &self,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        self.catalog.list_models(request, workspace_root).await
    }
    pub async fn read_account(
        &self,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> AgentResult<Value> {
        self.catalog.read_account(request, workspace_root).await
    }
    pub fn get_reference_input_capabilities(
        &self,
        sender: &Sender,
        session_id: Option<&Value>,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.turns
            .get_reference_input_capabilities(sender, session_id, root)
    }
    pub async fn create_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        self.lifecycle.create_session(sender, request, root).await
    }
    pub async fn resume_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        self.lifecycle.resume_session(sender, request, root).await
    }
    pub async fn open_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        self.lifecycle.open_session(sender, request, root).await
    }
    pub async fn start_turn(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.turns.start_turn(sender, request, root).await
    }
    pub async fn steer_turn(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.turns.steer_turn(sender, request, root).await
    }
    pub async fn interrupt_turn(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.turns.interrupt_turn(sender, request, root).await
    }
    pub async fn resolve_approval(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.turns.resolve_approval(sender, request, root).await
    }
    pub async fn resolve_question(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.turns.resolve_question(sender, request, root).await
    }
    pub fn replay(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.turns.replay(sender, request, root)
    }
    pub fn attach_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        let session = self.require_feed_session(sender, request, root)?;
        self.feed.attach(&session)
    }
    pub fn acknowledge_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        let session = self.require_feed_session(sender, request, root)?;
        self.feed.acknowledge(&session, request)
    }
    pub fn read_session_watermark(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        let session = self.require_feed_session(sender, request, root)?;
        self.feed
            .watermark(&session, request["subscriptionId"].as_str().unwrap_or(""))
    }
    pub fn detach_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        let session = self.require_feed_session(sender, request, root)?;
        self.feed
            .detach(&session, request["subscriptionId"].as_str().unwrap_or(""))
    }
    pub async fn list_sessions(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        self.history.list_sessions(sender, request, root).await
    }
    pub async fn fork_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.commands.fork_session(sender, request, root).await
    }
    pub async fn archive_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        self.commands.archive_session(sender, request, root).await
    }
    pub async fn delete_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: &str,
    ) -> AgentResult<Value> {
        self.commands.delete_session(sender, request, root).await
    }
    pub async fn compact_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        self.commands.compact_session(sender, request, root).await
    }

    /// `service.closeSession(sender, request, workspaceRoot)`.
    pub async fn close_session(
        &self,
        sender: &Sender,
        request: &Value,
        root: Option<&str>,
    ) -> AgentResult<Value> {
        let closing = request["sessionId"]
            .as_str()
            .and_then(|id| self.store.get(id));
        let result = self.lifecycle.close_session(sender, request, root).await;
        if let Some(closing) = closing
            && !self.store.is_current(&closing)
        {
            self.feed
                .release_session(&closing.id(), Some(&closing.instance_id));
        }
        result
    }

    /// `service.closeSessionsForWindow(ownerId)`.
    pub async fn close_sessions_for_window(&self, owner_id: u64) -> AgentResult<()> {
        let sessions: Vec<SessionRef> = self
            .store
            .values()
            .into_iter()
            .filter(|s| s.owner_id == owner_id)
            .collect();
        let (indexed, closed) = join(
            self.indexer.close_owner(owner_id),
            self.lifecycle.close_sessions_for_window(owner_id),
        )
        .await;
        for session in sessions.iter().filter(|s| !self.store.is_current(s)) {
            self.feed
                .release_session(&session.id(), Some(&session.instance_id));
        }
        indexed?;
        closed
    }

    /// `service.closeSessionsForWorkspaceRoot(ownerId, workspaceRoot)`.
    pub async fn close_sessions_for_workspace_root(
        &self,
        owner_id: u64,
        root: &str,
    ) -> AgentResult<usize> {
        let sessions: Vec<SessionRef> = self
            .store
            .values()
            .into_iter()
            .filter(|s| s.owner_id == owner_id && s.workspace_root() == root)
            .collect();
        let (indexed, closed) = join(
            self.indexer.close_workspace(root),
            self.lifecycle
                .close_sessions_for_workspace_root(owner_id, root),
        )
        .await;
        for session in sessions.iter().filter(|s| !self.store.is_current(s)) {
            self.feed
                .release_session(&session.id(), Some(&session.instance_id));
        }
        indexed?;
        closed
    }

    /// `service.closeAll()`.
    pub async fn close_all(&self) -> AgentResult<()> {
        let (indexed, closed) = join(self.indexer.dispose(), self.lifecycle.close_all()).await;
        self.feed.release_all();
        indexed?;
        closed
    }

    pub fn get_session_count(&self) -> usize {
        self.lifecycle.get_session_count()
    }
    pub fn get_retained_session_count(&self) -> usize {
        self.lifecycle.get_retained_session_count()
    }
    pub fn has_runtime_resources(&self) -> bool {
        self.lifecycle.has_runtime_resources()
    }
}
