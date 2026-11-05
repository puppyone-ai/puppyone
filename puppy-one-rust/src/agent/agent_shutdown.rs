//! `agent-shutdown.mjs`: quit is held until Agent journals and child
//! processes have drained.
use crate::agent::agent_error::AgentResult;
use futures_util::future::LocalBoxFuture;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// `logger.error(message)`.
pub type Logger = Rc<dyn Fn(&str)>;

/// What the quit coordinator reads from the Agent service.
pub trait QuitAgentService {
    /// `agentService.getRetainedSessionCount?.()`.
    fn retained_session_count(&self) -> Option<usize> {
        None
    }
    /// `agentService.getSessionCount()`.
    fn session_count(&self) -> usize;
    /// `agentService.hasRuntimeResources?.()`.
    fn has_runtime_resources(&self) -> bool {
        false
    }
    /// `agentService.closeAll()`.
    fn close_all(&self) -> LocalBoxFuture<'static, AgentResult<()>>;
}

/// `createAgentQuitCoordinator({ app, agentService, disposeApplicationServices, logger })`.
pub struct AgentQuitCoordinator {
    quit: Rc<dyn Fn()>,
    agent_service: Rc<dyn QuitAgentService>,
    dispose_application_services: Rc<dyn Fn()>,
    logger: Logger,
    application_services_disposed: Cell<bool>,
    draining: Rc<RefCell<bool>>,
}

impl AgentQuitCoordinator {
    pub fn new(
        quit: Rc<dyn Fn()>,
        agent_service: Rc<dyn QuitAgentService>,
        dispose_application_services: Rc<dyn Fn()>,
        logger: Option<Logger>,
    ) -> Self {
        Self {
            quit,
            agent_service,
            dispose_application_services,
            logger: logger.unwrap_or_else(|| Rc::new(|message| eprintln!("{message}"))),
            application_services_disposed: Cell::new(false),
            draining: Rc::default(),
        }
    }

    /// `handleBeforeQuit(event)`: `true` prevents this quit attempt.
    pub fn handle_before_quit(&self) -> bool {
        if !self.application_services_disposed.replace(true) {
            (self.dispose_application_services)();
        }
        let retained = self
            .agent_service
            .retained_session_count()
            .unwrap_or_else(|| self.agent_service.session_count());
        let resources = self.agent_service.has_runtime_resources();
        if retained == 0 && !resources {
            crate::agent::event_loop::spawn({
                let drain = self.agent_service.close_all();
                async move {
                    let _ = drain.await;
                }
            });
            return false;
        }
        // The quit is retried once Agent journals and child processes have
        // drained; the platform does not await asynchronous quit listeners.
        if *self.draining.borrow() {
            return true;
        }
        *self.draining.borrow_mut() = true;
        let drain = self.agent_service.close_all();
        let (quit, logger, draining) = (
            self.quit.clone(),
            self.logger.clone(),
            self.draining.clone(),
        );
        crate::agent::event_loop::spawn(async move {
            if let Err(error) = drain.await {
                logger(&format!(
                    "puppyone failed to drain Agent sessions during quit: {error}"
                ));
            }
            *draining.borrow_mut() = false;
            quit();
        });
        true
    }
}

#[cfg(test)]
mod tests {
    //! `tests/integration/agent/sessions/electron.agent-shutdown.test.mjs`.
    use super::*;
    use crate::agent::application::tests_support::run_local;
    use core::prelude::v1::test;
    use tokio::sync::oneshot;

    struct FakeService {
        sessions: Rc<Cell<usize>>,
        resources: Option<bool>,
        drains: Rc<RefCell<Vec<oneshot::Sender<()>>>>,
        closes: Rc<Cell<usize>>,
    }

    impl QuitAgentService for FakeService {
        fn session_count(&self) -> usize {
            self.sessions.get()
        }
        fn has_runtime_resources(&self) -> bool {
            self.resources.unwrap_or(false)
        }
        fn close_all(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
            self.closes.set(self.closes.get() + 1);
            let (sender, receiver) = oneshot::channel();
            self.drains.borrow_mut().push(sender);
            let sessions = self.sessions.clone();
            Box::pin(async move {
                let _ = receiver.await;
                sessions.set(0);
                Ok(())
            })
        }
    }

    fn service(sessions: usize, resources: Option<bool>) -> Rc<FakeService> {
        Rc::new(FakeService {
            sessions: Rc::new(Cell::new(sessions)),
            resources,
            drains: Rc::default(),
            closes: Rc::default(),
        })
    }

    async fn settle() {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    #[test]
    fn prevents_quit_until_active_agent_sessions_and_persistence_are_drained() {
        run_local(async {
            let agent = service(1, None);
            let quits = Rc::new(Cell::new(0));
            let disposals = Rc::new(Cell::new(0));
            let coordinator = AgentQuitCoordinator::new(
                {
                    let quits = quits.clone();
                    Rc::new(move || quits.set(quits.get() + 1))
                },
                agent.clone(),
                {
                    let disposals = disposals.clone();
                    Rc::new(move || disposals.set(disposals.get() + 1))
                },
                Some(Rc::new(|_| {})),
            );
            assert!(coordinator.handle_before_quit());
            assert!(coordinator.handle_before_quit());
            assert_eq!(agent.closes.get(), 1);
            assert_eq!(disposals.get(), 1);
            let drain = agent.drains.borrow_mut().remove(0);
            let _ = drain.send(());
            settle().await;
            assert_eq!(quits.get(), 1);
            assert!(!coordinator.handle_before_quit());
            assert_eq!(disposals.get(), 1);
        });
    }

    #[test]
    fn does_not_intercept_updater_driven_quit_when_no_agent_session_is_active() {
        run_local(async {
            let agent = service(0, Some(false));
            let coordinator =
                AgentQuitCoordinator::new(Rc::new(|| {}), agent.clone(), Rc::new(|| {}), None);
            assert!(!coordinator.handle_before_quit());
            settle().await;
            assert_eq!(agent.closes.get(), 1);
        });
    }

    #[test]
    fn waits_for_an_inspected_sidecar_even_when_no_agent_session_was_created() {
        run_local(async {
            let agent = service(0, Some(true));
            let quits = Rc::new(Cell::new(0));
            let coordinator = AgentQuitCoordinator::new(
                {
                    let quits = quits.clone();
                    Rc::new(move || quits.set(quits.get() + 1))
                },
                agent.clone(),
                Rc::new(|| {}),
                None,
            );
            assert!(coordinator.handle_before_quit());
            let drain = agent.drains.borrow_mut().remove(0);
            let _ = drain.send(());
            settle().await;
            assert_eq!(quits.get(), 1);
        });
    }
}
