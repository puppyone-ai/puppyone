//! `application/LocalAgentConnectionLoader.ts`: lazy presentation loader for
//! the Main-owned local-tool inventory. It does not participate in session
//! phases and cannot select a Provider.
use super::agent_client_port::{AgentClient as _, AgentClientProvider};
use super::agent_controller_state::{LocalConnectionsPhase, StatePatch};
use super::agent_error::{ErrorDescriptor, create_agent_error, format_agent_error};
use super::agent_session_controller::AgentControllerStore;
use super::ui_runtime::{Task, UiRuntime, launch, resolved, unstarted};
use crate::agent::contract::protocol::{AgentOperation, RuntimeQuery};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

#[derive(Clone)]
pub struct LocalAgentConnectionLoader(Rc<Inner>);

struct Inner {
    workspace_root: String,
    bridge_provider: AgentClientProvider,
    store: Rc<AgentControllerStore>,
    runtime: Rc<dyn UiRuntime>,
    pending: RefCell<Option<(u64, Task<()>)>>,
    next_task: Cell<u64>,
    disposed: Cell<bool>,
}

impl LocalAgentConnectionLoader {
    pub fn new(
        workspace_root: &str,
        bridge_provider: AgentClientProvider,
        store: Rc<AgentControllerStore>,
        runtime: Rc<dyn UiRuntime>,
    ) -> Self {
        Self(Rc::new(Inner {
            workspace_root: workspace_root.to_string(),
            bridge_provider,
            store,
            runtime,
            pending: RefCell::default(),
            next_task: Cell::new(0),
            disposed: Cell::new(false),
        }))
    }

    pub fn discover(&self, refresh: bool) -> Task<()> {
        let inner = &self.0;
        if inner.disposed.get() {
            return resolved(());
        }
        if let Some((_, pending)) = inner.pending.borrow().as_ref() {
            return pending.clone();
        }
        let bridge = (inner.bridge_provider)();
        let Some(bridge) = bridge.filter(|b| b.supports(AgentOperation::DiscoverLocalConnections))
        else {
            inner.store.patch(
                StatePatch::new()
                    .local_connections_phase(LocalConnectionsPhase::Error)
                    .local_connections_error(Some(create_agent_error(
                        "native-bridge-unavailable",
                        None,
                    ))),
            );
            return resolved(());
        };
        inner.store.patch(
            StatePatch::new()
                .local_connections_phase(LocalConnectionsPhase::Loading)
                .local_connections_error(None),
        );
        let call = bridge.discover_local_connections(RuntimeQuery {
            root_path: Some(inner.workspace_root.clone()),
            refresh: Some(refresh),
            ..RuntimeQuery::default()
        });
        let id = inner.next_task.get() + 1;
        inner.next_task.set(id);
        let loader = inner.clone();
        let task = unstarted(async move {
            let result = call.await;
            if !loader.disposed.get() {
                match result {
                    Ok(snapshot) => {
                        let warning = snapshot.warnings.first().filter(|w| !w.is_empty());
                        loader.store.patch(
                            StatePatch::new()
                                .local_connections(snapshot.connections.clone())
                                .local_connections_phase(LocalConnectionsPhase::Ready)
                                .local_connections_scanned_at(
                                    Some(snapshot.scanned_at.clone()).filter(|s| !s.is_empty()),
                                )
                                .local_connections_error(warning.map(|warning| ErrorDescriptor {
                                    code: "unknown".into(),
                                    detail: Some(warning.clone()),
                                    ..ErrorDescriptor::default()
                                })),
                        );
                    }
                    Err(error) => loader.store.patch(
                        StatePatch::new()
                            .local_connections_phase(LocalConnectionsPhase::Error)
                            .local_connections_error(Some(format_agent_error(&error))),
                    ),
                }
            }
            let current = loader
                .pending
                .borrow()
                .as_ref()
                .is_some_and(|(task, _)| *task == id);
            if current {
                *loader.pending.borrow_mut() = None;
            }
        });
        *inner.pending.borrow_mut() = Some((id, task.clone()));
        launch(&inner.runtime, &task);
        task
    }

    pub fn dispose(&self) {
        self.0.disposed.set(true);
    }
}
