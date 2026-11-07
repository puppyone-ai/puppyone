//! `application/AgentControllerRegistry.ts`: owned by one project
//! generation; disposing it releases local replicas only.
use super::agent_client_port::AgentClientProvider;
use super::agent_session_controller::AgentSessionController;
use super::agent_session_lifecycle::CloseOutcome;
use super::ui_runtime::{Task, UiRuntime, launch, resolved, unstarted};
use crate::agent::agent_error::{AgentError, AgentResult};
use futures_util::FutureExt;
use futures_util::future::LocalBoxFuture;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// What the registry needs of a controller.
pub trait RegisteredController: Clone + 'static {
    /// `closeTabSession()`: closed, a termination receipt, or kept.
    fn close_tab_session(&self) -> LocalBoxFuture<'static, CloseOutcome>;
    fn dispose(&self, preserve_draft: bool);
    fn rollback_preparation(&self) -> LocalBoxFuture<'static, AgentResult<()>>;
    /// `controller === other`.
    fn same(&self, other: &Self) -> bool;
}

impl RegisteredController for AgentSessionController {
    fn close_tab_session(&self) -> LocalBoxFuture<'static, CloseOutcome> {
        AgentSessionController::close_tab_session(self).boxed_local()
    }
    fn dispose(&self, preserve_draft: bool) {
        AgentSessionController::dispose(self, preserve_draft);
    }
    fn rollback_preparation(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
        AgentSessionController::rollback_preparation(self).boxed_local()
    }
    fn same(&self, other: &Self) -> bool {
        self.ptr_eq(other)
    }
}

/// An in-flight close: its id, controller and result.
type Closing<C> = (u64, C, Task<CloseOutcome>);

/// `new AgentControllerRegistry(root, createClient, preserveDraftOnDispose)`.
pub struct AgentControllerRegistry<C: RegisteredController = AgentSessionController> {
    create: Rc<dyn Fn(&str) -> C>,
    runtime: Rc<dyn UiRuntime>,
    preserve_draft_on_dispose: bool,
    controllers: Rc<RefCell<Vec<(String, C)>>>,
    closing: Rc<RefCell<Vec<Closing<C>>>>,
    next_close: Cell<u64>,
    disposed: Cell<bool>,
}

impl AgentControllerRegistry<AgentSessionController> {
    pub fn new(
        root: &str,
        create_client: Rc<dyn Fn(&str) -> AgentClientProvider>,
        runtime: Rc<dyn UiRuntime>,
        preserve_draft_on_dispose: bool,
    ) -> Self {
        let root = root.to_string();
        let controller_runtime = runtime.clone();
        Self::with_factory(
            Rc::new(move |id| {
                AgentSessionController::new(&root, create_client(id), controller_runtime.clone())
            }),
            runtime,
            preserve_draft_on_dispose,
        )
    }
}

impl<C: RegisteredController> AgentControllerRegistry<C> {
    pub fn with_factory(
        create: Rc<dyn Fn(&str) -> C>,
        runtime: Rc<dyn UiRuntime>,
        preserve_draft_on_dispose: bool,
    ) -> Self {
        Self {
            create,
            runtime,
            preserve_draft_on_dispose,
            controllers: Rc::default(),
            closing: Rc::default(),
            next_close: Cell::new(0),
            disposed: Cell::new(false),
        }
    }

    pub fn get(&self, id: &str) -> AgentResult<C> {
        if self.disposed.get() {
            return Err(AgentError::new(
                "This project's Agent controllers have been released.",
            ));
        }
        if let Some((_, controller)) = self.controllers.borrow().iter().find(|(key, _)| key == id) {
            return Ok(controller.clone());
        }
        let controller = (self.create)(id);
        self.controllers
            .borrow_mut()
            .push((id.to_string(), controller.clone()));
        Ok(controller)
    }

    pub fn close(&self, id: &str) -> Task<CloseOutcome> {
        let Some(controller) = self.find(id) else {
            return resolved(CloseOutcome::Closed);
        };
        if let Some((_, _, pending)) = self
            .closing
            .borrow()
            .iter()
            .find(|(_, c, _)| c.same(&controller))
        {
            return pending.clone();
        }
        let close_id = self.next_close.get() + 1;
        self.next_close.set(close_id);
        let controllers = self.controllers.clone();
        let closing = self.closing.clone();
        let id = id.to_string();
        let closed = controller.clone();
        let task = unstarted(async move {
            let result = closed.close_tab_session().await;
            let result = if result.closed() {
                closed.dispose(false);
                let mut controllers = controllers.borrow_mut();
                if let Some(index) = controllers
                    .iter()
                    .position(|(key, c)| *key == id && c.same(&closed))
                {
                    controllers.remove(index);
                }
                result
            } else {
                CloseOutcome::Kept
            };
            closing
                .borrow_mut()
                .retain(|(pending, _, _)| *pending != close_id);
            result
        });
        self.closing
            .borrow_mut()
            .push((close_id, controller, task.clone()));
        launch(&self.runtime, &task);
        task
    }

    pub async fn discard(&self, id: &str) {
        let Some(controller) = self.find(id) else {
            return;
        };
        // Detach the abandoned reservation before awaiting native rollback.
        // Its completion must never remove a replacement using the same Item
        // id.
        self.controllers.borrow_mut().retain(|(key, _)| key != id);
        let _ = controller.rollback_preparation().await;
    }

    pub fn dispose(&self) {
        if self.disposed.get() {
            return;
        }
        self.disposed.set(true);
        let controllers = std::mem::take(&mut *self.controllers.borrow_mut());
        for (_, controller) in controllers {
            controller.dispose(self.preserve_draft_on_dispose);
        }
    }

    fn find(&self, id: &str) -> Option<C> {
        self.controllers
            .borrow()
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, controller)| controller.clone())
    }
}
