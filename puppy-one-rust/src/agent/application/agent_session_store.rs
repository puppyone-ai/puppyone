//! `application/agent-session-store.mjs`: Main-owned application-session
//! identity, window ownership and retirement.
use super::agent_input_policy::{normalize_required_id, require_sender_id};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::domain::agent_session_model::SessionRef;
use crate::agent::sender::Sender;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use tokio::task::spawn_local;

/// `projectSessionError(code, message, retryable)`.
pub fn project_session_error(code: &str, message: &str, retryable: bool) -> AgentError {
    AgentError::coded(code, message).with_retryable(retryable)
}

struct OwnerCleanup {
    sender: Sender,
    listener: u64,
    session_ids: Vec<String>,
}

#[derive(Default)]
struct StoreState {
    sessions: Vec<(String, SessionRef)>,
    owner_cleanups: HashMap<u64, OwnerCleanup>,
    closed_instances: Vec<(String, (String, String))>,
}

type OwnerDestroyed = Rc<RefCell<Option<Rc<dyn Fn(u64)>>>>;

#[derive(Clone)]
pub struct AgentSessionStore {
    state: Rc<RefCell<StoreState>>,
    on_owner_destroyed: OwnerDestroyed,
}

impl AgentSessionStore {
    pub fn new() -> Self {
        Self {
            state: Rc::default(),
            on_owner_destroyed: Rc::default(),
        }
    }

    /// The `onOwnerDestroyed` callback (wired after the lifecycle exists).
    pub fn set_on_owner_destroyed(&self, callback: Rc<dyn Fn(u64)>) {
        *self.on_owner_destroyed.borrow_mut() = Some(callback);
    }

    pub fn add(&self, session: &SessionRef) -> AgentResult<()> {
        let id = session.id();
        if self
            .state
            .borrow()
            .sessions
            .iter()
            .any(|(key, _)| *key == id)
        {
            return Err(AgentError::new(format!("Duplicate Agent session: {id}")));
        }
        self.state.borrow_mut().sessions.push((id, session.clone()));
        self.attach_owner(session);
        Ok(())
    }

    /// `store.adoptIdentity(session, id)`.
    pub fn adopt_identity(&self, session: &SessionRef, id: &str) -> AgentResult<()> {
        if session.id() == id {
            return Ok(());
        }
        if !self.is_current(session) || session.sequence() > 0 || self.get(id).is_some() {
            return Err(AgentError::new(
                "Native conversation is already owned by another Agent session.",
            ));
        }
        self.remove(session);
        session.state_mut().id = id.to_string();
        self.add(session)
    }

    pub fn get(&self, id: &str) -> Option<SessionRef> {
        self.state
            .borrow()
            .sessions
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, s)| s.clone())
    }

    /// `store.isCurrent(session)`.
    pub fn is_current(&self, session: &SessionRef) -> bool {
        self.get(&session.id())
            .is_some_and(|current| Rc::ptr_eq(&current, session))
    }

    pub fn values(&self) -> Vec<SessionRef> {
        self.state
            .borrow()
            .sessions
            .iter()
            .map(|(_, s)| s.clone())
            .collect()
    }

    pub fn remove(&self, session: &SessionRef) -> bool {
        if !self.is_current(session) {
            return false;
        }
        let id = session.id();
        self.state
            .borrow_mut()
            .sessions
            .retain(|(key, _)| *key != id);
        self.detach_owner(session);
        true
    }

    /// `store.requireOwned(sender, id)`.
    pub fn require_owned(&self, sender: &Sender, id: Option<&Value>) -> AgentResult<SessionRef> {
        let normalized = normalize_required_id(id, "Agent session id")?;
        let Some(session) = self.get(&normalized) else {
            return Err(project_session_error(
                "SESSION_NOT_FOUND",
                "Agent session was not found or has already closed.",
                false,
            ));
        };
        if session.owner_id != require_sender_id(sender)? {
            return Err(project_session_error(
                "SESSION_UNAUTHORIZED",
                "Agent session is owned by another window.",
                false,
            ));
        }
        Ok(session)
    }

    /// `store.assertInstance(sender, request, workspaceRoot, { allowClosed })`.
    pub fn assert_instance(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
        allow_closed: bool,
    ) -> AgentResult<Option<SessionRef>> {
        if allow_closed && self.was_closed(sender, request, workspace_root) {
            return Ok(None);
        }
        let session = self.require_owned(sender, request.get("sessionId"))?;
        let instance = request["instanceId"].as_str().filter(|i| !i.is_empty());
        if instance != Some(session.instance_id.as_str()) {
            return Err(project_session_error(
                "SESSION_STALE",
                "This running conversation instance has ended.",
                false,
            ));
        }
        if Some(session.workspace_root().as_str()) != workspace_root {
            return Err(project_session_error(
                "SESSION_UNAUTHORIZED",
                "The conversation belongs to another project.",
                false,
            ));
        }
        Ok(Some(session))
    }

    /// `store.rememberClosed(session)`.
    pub fn remember_closed(&self, session: &SessionRef) {
        let key = format!("{}:{}", session.owner_id, session.instance_id);
        let mut state = self.state.borrow_mut();
        state.closed_instances.retain(|(k, _)| *k != key);
        state
            .closed_instances
            .push((key, (session.id(), session.workspace_root())));
        let excess = state.closed_instances.len().saturating_sub(512);
        state.closed_instances.drain(..excess);
    }

    /// `store.wasClosed(sender, request, workspaceRoot)`.
    pub fn was_closed(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: Option<&str>,
    ) -> bool {
        let Some(instance) = request["instanceId"].as_str().filter(|i| !i.is_empty()) else {
            return false;
        };
        let key = format!("{}:{instance}", sender.id());
        self.state
            .borrow()
            .closed_instances
            .iter()
            .find(|(k, _)| *k == key)
            .is_some_and(|(_, (id, root))| {
                request["sessionId"] == id.as_str() && Some(root.as_str()) == workspace_root
            })
    }

    fn by_recency(mut sessions: Vec<SessionRef>) -> Vec<SessionRef> {
        sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at()));
        sessions
    }

    /// `store.findOwned(ownerId, workspaceRoot, { connectedOnly })`.
    pub fn find_owned(
        &self,
        owner_id: u64,
        workspace_root: &str,
        connected_only: bool,
    ) -> Option<SessionRef> {
        Self::by_recency(
            self.values()
                .into_iter()
                .filter(|s| {
                    s.owner_id == owner_id
                        && s.workspace_root() == workspace_root
                        && (!connected_only || !s.provider_exited())
                })
                .collect(),
        )
        .into_iter()
        .next()
    }

    /// `store.takeRetired(ownerId, workspaceRoot, requestedSessionId)`.
    pub fn take_retired(
        &self,
        owner_id: u64,
        workspace_root: &str,
        requested: Option<&str>,
    ) -> Option<SessionRef> {
        let retired = Self::by_recency(
            self.values()
                .into_iter()
                .filter(|s| {
                    s.owner_id == owner_id
                        && s.workspace_root() == workspace_root
                        && s.provider_exited()
                        && s.provider_session_id().is_some()
                        && requested.is_none_or(|id| s.id() == id)
                })
                .collect(),
        )
        .into_iter()
        .next()?;
        if let Some(timer) = retired.state_mut().persist_timer.take() {
            timer.abort();
        }
        self.remove(&retired);
        Some(retired)
    }

    /// `store.discardRetired(ownerId, workspaceRoot)`.
    pub fn discard_retired(&self, owner_id: u64, workspace_root: &str) {
        for session in self.values() {
            if session.owner_id != owner_id
                || session.workspace_root() != workspace_root
                || !session.provider_exited()
            {
                continue;
            }
            if let Some(timer) = session.state_mut().persist_timer.take() {
                timer.abort();
            }
            self.remove(&session);
        }
    }

    /// `store.activeCount()`.
    #[cfg(test)]
    pub fn active_count(&self) -> usize {
        self.values()
            .iter()
            .filter(|s| !s.provider_exited())
            .count()
    }

    /// `store.size`.
    #[cfg(test)]
    pub fn size(&self) -> usize {
        self.state.borrow().sessions.len()
    }

    fn attach_owner(&self, session: &SessionRef) {
        let owner = session.owner_id;
        let id = session.id();
        if let Some(cleanup) = self.state.borrow_mut().owner_cleanups.get_mut(&owner) {
            cleanup.session_ids.push(id);
            return;
        }
        let state = self.state.clone();
        let callback = self.on_owner_destroyed.clone();
        let listener = session.sender.once_destroyed(move || {
            state.borrow_mut().owner_cleanups.remove(&owner);
            let callback = callback.borrow().clone();
            if let Some(callback) = callback {
                spawn_local(async move { callback(owner) });
            }
        });
        self.state.borrow_mut().owner_cleanups.insert(
            owner,
            OwnerCleanup {
                sender: session.sender.clone(),
                listener,
                session_ids: vec![id],
            },
        );
    }

    fn detach_owner(&self, session: &SessionRef) {
        let owner = session.owner_id;
        let id = session.id();
        let mut state = self.state.borrow_mut();
        let Some(cleanup) = state.owner_cleanups.get_mut(&owner) else {
            return;
        };
        cleanup.session_ids.retain(|s| *s != id);
        if !cleanup.session_ids.is_empty() {
            return;
        }
        let cleanup = state.owner_cleanups.remove(&owner).expect("owner cleanup");
        cleanup.sender.remove_destroyed_listener(cleanup.listener);
    }
}

impl Default for AgentSessionStore {
    fn default() -> Self {
        Self::new()
    }
}
