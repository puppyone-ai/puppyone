//! `application/AgentSessionPreparer.ts`: owns concurrency and stale-result
//! cleanup for reusable native-session preparation.
use super::agent_client_port::AgentClientProvider;
use super::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentSessionPreparation, StatePatch,
};
use super::agent_error::format_agent_error;
use super::agent_session_controller::{AgentControllerStore, ApplySnapshot, CreateSession};
use super::ui_runtime::{Task, UiRuntime, resolved, start};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

pub struct AgentSessionPreparerOptions {
    pub workspace_root: String,
    pub bridge_provider: AgentClientProvider,
    pub store: Rc<AgentControllerStore>,
    pub runtime: Rc<dyn UiRuntime>,
    pub create_session: CreateSession,
    pub apply_snapshot: ApplySnapshot,
}

#[derive(Clone)]
pub struct AgentSessionPreparer(Rc<Inner>);

struct Inner {
    options: AgentSessionPreparerOptions,
    preparation: RefCell<Option<(u64, Task<bool>)>>,
    next_task: Cell<u64>,
    epoch: Cell<u64>,
    disposed: Cell<bool>,
}

impl AgentSessionPreparer {
    pub fn new(options: AgentSessionPreparerOptions) -> Self {
        Self(Rc::new(Inner {
            options,
            preparation: RefCell::default(),
            next_task: Cell::new(0),
            epoch: Cell::new(0),
            disposed: Cell::new(false),
        }))
    }

    pub fn prepare(&self) -> Task<bool> {
        self.0.prepare()
    }

    /// Invalidates only an in-flight prewarm; the stale native session is
    /// closed on arrival.
    pub fn invalidate_selection(&self) -> bool {
        let inner = &self.0;
        if inner.disposed.get()
            || inner.preparation.borrow().is_none()
            || inner.options.store.read(|state| state.session.is_some())
        {
            return false;
        }
        inner.epoch.set(inner.epoch.get() + 1);
        true
    }

    pub fn dispose(&self) {
        let inner = &self.0;
        if inner.disposed.get() {
            return;
        }
        inner.disposed.set(true);
        inner.epoch.set(inner.epoch.get() + 1);
    }
}

impl Inner {
    fn prepare(self: &Rc<Self>) -> Task<bool> {
        let store = &self.options.store;
        if self.disposed.get() {
            return resolved(false);
        }
        let (has_session, preparation) =
            store.read(|state| (state.session.is_some(), state.session_preparation));
        if has_session {
            if preparation != AgentSessionPreparation::Ready {
                store.patch(StatePatch::new().session_preparation(AgentSessionPreparation::Ready));
            }
            return resolved(true);
        }
        if let Some((_, task)) = self.preparation.borrow().as_ref() {
            return task.clone();
        }
        if !store.read(can_prepare_session) {
            return resolved(false);
        }
        let epoch = self.epoch.get() + 1;
        self.epoch.set(epoch);
        let selection = store.read(session_selection);
        let id = self.next_task.get() + 1;
        self.next_task.set(id);
        let preparer = self.clone();
        let task = start(&self.options.runtime, async move {
            let prepared = match (preparer.options.create_session)().await {
                Ok(snapshot) => {
                    if !preparer.is_current(epoch, &selection) {
                        preparer.close_stale(&snapshot).await;
                        false
                    } else {
                        match (preparer.options.apply_snapshot)(snapshot).await {
                            Ok(()) => true,
                            Err(error) => {
                                preparer.failed(epoch, &selection, &error);
                                false
                            }
                        }
                    }
                }
                Err(error) => {
                    preparer.failed(epoch, &selection, &error);
                    false
                }
            };
            let current = preparer
                .preparation
                .borrow()
                .as_ref()
                .is_some_and(|(task, _)| *task == id);
            if current {
                *preparer.preparation.borrow_mut() = None;
                let again = preparer.options.store.read(|latest| {
                    latest.session_preparation == AgentSessionPreparation::Idle
                        && can_prepare_session(latest)
                });
                if !preparer.disposed.get() && again {
                    drop(preparer.prepare());
                }
            }
            prepared
        });
        *self.preparation.borrow_mut() = Some((id, task.clone()));
        store.patch(
            StatePatch::new()
                .session_preparation(AgentSessionPreparation::Preparing)
                .error(None),
        );
        task
    }

    fn failed(&self, epoch: u64, selection: &str, error: &crate::agent::agent_error::AgentError) {
        if self.is_current(epoch, selection) {
            self.options.store.patch(
                StatePatch::new()
                    .session_preparation(AgentSessionPreparation::Failed)
                    .error(Some(format_agent_error(error))),
            );
        }
    }

    fn is_current(&self, epoch: u64, selection: &str) -> bool {
        !self.disposed.get()
            && epoch == self.epoch.get()
            && self
                .options
                .store
                .read(|state| selection == session_selection(state) && state.session.is_none())
    }

    async fn close_stale(&self, snapshot: &Value) {
        let bridge = (self.options.bridge_provider)();
        let Some(bridge) = bridge.filter(|b| b.implements("closeAgentSession")) else {
            return;
        };
        // A stale Renderer must never publish state; native shutdown is best
        // effort.
        let mut request = json!({
            "rootPath": self.options.workspace_root,
            "sessionId": snapshot["session"]["id"],
            "removePersistence": true,
        });
        if let Some(instance_id) = snapshot["session"].get("instanceId") {
            request["instanceId"] = instance_id.clone();
        }
        let _ = bridge.call("closeAgentSession", request).await;
    }
}

/// `canPrepareSession(state)`.
fn can_prepare_session(state: &AgentControllerState) -> bool {
    if !state.initialized || state.session.is_some() || state.running_turn_id().is_some() {
        return false;
    }
    let Some(inspection) = state.inspection.as_ref() else {
        return false;
    };
    if state.phase != AgentControllerPhase::Ready || inspection["readiness"]["status"] != "ready" {
        return false;
    }
    if state
        .selected_runtime_id
        .as_deref()
        .is_none_or(str::is_empty)
    {
        return false;
    }
    !state.capability("modelSelection")
        || state
            .selected_model
            .as_deref()
            .is_some_and(|m| !m.is_empty())
}

/// `sessionSelection(state)`.
fn session_selection(state: &AgentControllerState) -> String {
    [
        &state.selected_runtime_id,
        &state.selected_model,
        &state.selected_effort,
        &state.selected_mode,
    ]
    .iter()
    .map(|value| value.as_deref().unwrap_or(""))
    .collect::<Vec<_>>()
    .join("\u{0}")
}
