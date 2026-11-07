//! `application/turn/agent-turn-queue.mjs`: owns private queued payloads
//! and keeps their public SessionActor records settled.
use super::super::agent_reference_policy::private_reference_lease_tokens;
use super::super::ports::AttachmentStore;
use super::agent_start_transaction::StartContext;
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js::Obj;
use crate::agent::domain::agent_session_model::SessionRef;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use tokio::task::spawn_local;

pub const MAX_QUEUED_TURNS: usize = 20;

type ExecuteStart = Rc<dyn Fn(StartContext) -> LocalBoxFuture<'static, AgentResult<Value>>>;

struct QueueState {
    contexts: Vec<(String, StartContext)>,
    cleanups: HashMap<String, (SessionRef, u64)>,
    draining: HashSet<String>,
}

#[derive(Clone)]
pub struct AgentTurnQueue {
    state: Rc<RefCell<QueueState>>,
    attachments: Option<Rc<dyn AttachmentStore>>,
    execute_start: Rc<RefCell<Option<ExecuteStart>>>,
}

fn session_key(session: &SessionRef) -> String {
    session.actor.control()["sessionEpoch"]
        .as_str()
        .unwrap_or("")
        .to_string()
}

fn context_key(session: &SessionRef, command_id: &str) -> String {
    format!("{}:{command_id}", session_key(session))
}

fn queue_dispatchable(control: &Value) -> bool {
    let execution = &control["execution"];
    if control["connection"]["status"] != "connected"
        || control["queue"].as_array().is_none_or(Vec::is_empty)
        || crate::agent::contract::js::truthy_opt(control.get("pendingSubmission"))
    {
        return false;
    }
    if crate::agent::contract::js::truthy_opt(execution.get("activeTurnId"))
        || crate::agent::contract::js::truthy_opt(execution.get("uncertainTurnId"))
        || matches!(
            execution["status"].as_str(),
            Some("starting" | "outcome-unknown")
        )
    {
        return false;
    }
    !control["commands"].as_array().is_some_and(|commands| {
        commands
            .iter()
            .any(|c| c["kind"] == "interrupt" && c["status"] == "dispatching")
    })
}

impl AgentTurnQueue {
    /// `createAgentTurnQueue({ attachmentStore, executeStart })`.
    pub fn new(attachments: Option<Rc<dyn AttachmentStore>>) -> Self {
        Self {
            state: Rc::new(RefCell::new(QueueState {
                contexts: Vec::new(),
                cleanups: HashMap::new(),
                draining: HashSet::new(),
            })),
            attachments,
            execute_start: Rc::default(),
        }
    }

    /// Wires `executeStart` (the coordinator's start transaction).
    pub fn set_execute_start(&self, execute: ExecuteStart) {
        *self.execute_start.borrow_mut() = Some(execute);
    }

    /// `queue.enqueue(context)`.
    pub fn enqueue(&self, context: StartContext) {
        let key = context_key(&context.session, &context.command_id);
        let session = context.session.clone();
        {
            let mut state = self.state.borrow_mut();
            state.contexts.retain(|(k, _)| *k != key);
            state.contexts.push((key, context));
        }
        self.observe(&session);
        self.schedule(&session);
    }

    fn observe(&self, session: &SessionRef) {
        let key = session_key(session);
        if self.state.borrow().cleanups.contains_key(&key) {
            return;
        }
        let queue = self.clone();
        let target = Rc::downgrade(session);
        let listener = session.actor.subscribe(move |commit| {
            let Some(session) = target.upgrade() else {
                return;
            };
            if matches!(
                commit.control["connection"]["status"].as_str(),
                Some("exited" | "disconnected")
            ) {
                let queue = queue.clone();
                spawn_local(async move { queue.discard_session(&session).await });
                return;
            }
            let settled = queue.clone();
            let settled_session = session.clone();
            spawn_local(async move { settled.discard_settled(&settled_session).await });
            queue.schedule(&session);
        });
        self.state
            .borrow_mut()
            .cleanups
            .insert(key, (session.clone(), listener));
    }

    /// `queue.schedule(session)`.
    pub fn schedule(&self, session: &SessionRef) {
        let identity = session_key(session);
        if self.state.borrow().draining.contains(&identity) {
            return;
        }
        if !queue_dispatchable(&session.actor.control()) {
            return;
        }
        self.state.borrow_mut().draining.insert(identity.clone());
        let queue = self.clone();
        let session = session.clone();
        spawn_local(async move {
            queue.drain_one(&session).await;
            queue.state.borrow_mut().draining.remove(&identity);
            if !session.provider_exited() {
                queue.schedule(&session);
            }
        });
    }

    async fn drain_one(&self, session: &SessionRef) {
        let control = session.actor.control();
        let Some(command_id) = control["queue"][0].as_str().map(str::to_string) else {
            return;
        };
        let key = context_key(session, &command_id);
        let context = {
            let state = self.state.borrow();
            state
                .contexts
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, c)| c.clone())
        };
        let Some(context) = context.filter(|c| Rc::ptr_eq(&c.session, session)) else {
            let _ = session.actor.dispatch(json!({
                "type": "command.cancelled", "commandId": command_id, "error": "queued-command-payload-unavailable",
            }));
            return;
        };
        if session.provider_exited() {
            return;
        }
        let adapter_generation = control["adapterGeneration"].clone();
        // Transfer the private payload out of queue ownership before the
        // public reservation commit notifies subscribers. Restore it when the
        // Actor rejects the reservation; no async work occurs in this window.
        self.state.borrow_mut().contexts.retain(|(k, _)| *k != key);
        let reservation = session.actor.dispatch(json!({
            "type": "queue.dispatch-reserved",
            "commandId": command_id,
            "operationId": context.operation_id,
            "adapterGeneration": adapter_generation,
        }));
        match reservation {
            Ok(result) if result.changed => {}
            _ => {
                self.state.borrow_mut().contexts.push((key, context));
                return;
            }
        }
        let execute = self.execute_start.borrow().clone();
        if let Some(execute) = execute {
            // Command settlement is recorded by the coordinator.
            let _ = execute(context).await;
        }
    }

    async fn discard_session(&self, session: &SessionRef) {
        let abandoned: Vec<StartContext> = {
            let state = self.state.borrow();
            state
                .contexts
                .iter()
                .filter(|(_, c)| Rc::ptr_eq(&c.session, session))
                .map(|(_, c)| c.clone())
                .collect()
        };
        for context in abandoned {
            let _ = session.actor.dispatch(json!({
                "type": "command.cancelled",
                "commandId": context.command_id,
                "error": "session-ended-before-command-dispatch",
            }));
            let key = context_key(session, &context.command_id);
            self.state.borrow_mut().contexts.retain(|(k, _)| *k != key);
            self.release_lease(session, &context.request).await;
        }
        let cleanup = self
            .state
            .borrow_mut()
            .cleanups
            .remove(&session_key(session));
        if let Some((owner, listener)) = cleanup {
            owner.actor.unsubscribe(listener);
        }
    }

    async fn discard_settled(&self, session: &SessionRef) {
        let queued: HashSet<String> = session.actor.control()["queue"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|id| id.as_str().map(str::to_string))
            .collect();
        let settled: Vec<StartContext> = {
            let state = self.state.borrow();
            state
                .contexts
                .iter()
                .filter(|(_, c)| Rc::ptr_eq(&c.session, session) && !queued.contains(&c.command_id))
                .map(|(_, c)| c.clone())
                .collect()
        };
        for context in settled {
            let key = context_key(session, &context.command_id);
            self.state.borrow_mut().contexts.retain(|(k, _)| *k != key);
            self.release_lease(session, &context.request).await;
        }
    }

    async fn release_lease(&self, session: &SessionRef, request: &Value) {
        let lease_id = request["privateReferenceLease"]["leaseId"]
            .as_str()
            .filter(|id| !id.is_empty());
        let tokens = private_reference_lease_tokens(request);
        let (Some(lease_id), Some(store)) = (
            lease_id,
            self.attachments
                .as_ref()
                .filter(|s| s.supports("releaseLease")),
        ) else {
            return;
        };
        if tokens.is_empty() {
            return;
        }
        let _ = store
            .release_lease(
                Obj::new()
                    .set("ownerId", session.owner_id)
                    .set("workspaceRoot", session.workspace_root())
                    .set("tokens", tokens)
                    .set("leaseId", lease_id)
                    .build(),
            )
            .await;
    }
}
