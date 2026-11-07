//! `tests/unit/agent/sessions/desktop-agent.controller-registry.test.ts`.
use super::session_feed::settle;
use crate::agent::agent_error::AgentResult;
use crate::agent::application::tests::harness::run;
use crate::features::desktop_agent::application::agent_controller_registry::{
    AgentControllerRegistry, RegisteredController,
};
use crate::features::desktop_agent::application::agent_session_lifecycle::CloseOutcome;
use crate::features::desktop_agent::application::ui_runtime::TokioUiRuntime;
use futures_util::FutureExt;
use futures_util::future::{LocalBoxFuture, Shared};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use tokio::sync::oneshot;

type Once<T> = RefCell<VecDeque<Shared<oneshot::Receiver<T>>>>;

/// The mocked `AgentSessionController` instance.
#[derive(Default)]
struct Mock {
    close_calls: Cell<usize>,
    dispose_calls: Cell<usize>,
    rollback_calls: Cell<usize>,
    close_once: Once<CloseOutcome>,
    rollback_once: Once<()>,
}

#[derive(Clone)]
struct MockController(Rc<Mock>);

impl RegisteredController for MockController {
    fn close_tab_session(&self) -> LocalBoxFuture<'static, CloseOutcome> {
        self.0.close_calls.set(self.0.close_calls.get() + 1);
        let once = self.0.close_once.borrow_mut().pop_front();
        Box::pin(async move {
            match once {
                Some(pending) => pending.await.expect("close"),
                None => CloseOutcome::Closed,
            }
        })
    }
    fn dispose(&self, _preserve_draft: bool) {
        self.0.dispose_calls.set(self.0.dispose_calls.get() + 1);
    }
    fn rollback_preparation(&self) -> LocalBoxFuture<'static, AgentResult<()>> {
        self.0.rollback_calls.set(self.0.rollback_calls.get() + 1);
        let once = self.0.rollback_once.borrow_mut().pop_front();
        Box::pin(async move {
            if let Some(pending) = once {
                pending.await.expect("rollback");
            }
            Ok(())
        })
    }
    fn same(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

type Instances = Rc<RefCell<Vec<MockController>>>;

fn registry(instances: &Instances) -> AgentControllerRegistry<MockController> {
    let instances = instances.clone();
    AgentControllerRegistry::with_factory(
        Rc::new(move |_| {
            let controller = MockController(Rc::default());
            instances.borrow_mut().push(controller.clone());
            controller
        }),
        TokioUiRuntime::create(),
        false,
    )
}

fn instance(instances: &Instances, index: usize) -> Rc<Mock> {
    instances.borrow()[index].0.clone()
}

#[test]
fn retains_hidden_tabs_and_isolates_projects_using_the_same_root_and_item_id() {
    run(async {
        let instances: Instances = Rc::default();
        let (a, b) = (registry(&instances), registry(&instances));
        let first = a.get("tab-0").expect("get");
        for index in 1..9 {
            a.get(&format!("tab-{index}")).expect("get");
        }
        assert!(a.get("tab-0").expect("get").same(&first));
        assert!(!b.get("tab-0").expect("get").same(&first));
        assert_eq!(instances.borrow().len(), 10);
        assert_eq!(instance(&instances, 0).dispose_calls.get(), 0);
        a.dispose();
        assert_eq!(instance(&instances, 9).dispose_calls.get(), 0);
        b.dispose();
    });
}

#[test]
fn detaches_an_abandoned_reservation_before_awaiting_rollback() {
    run(async {
        let instances: Instances = Rc::default();
        let owner = Rc::new(registry(&instances));
        let abandoned = owner.get("reserved-tab").expect("get");
        let (resolve, wait) = oneshot::channel();
        instance(&instances, 0)
            .rollback_once
            .borrow_mut()
            .push_back(wait.shared());
        let rollback = {
            let owner = owner.clone();
            tokio::task::spawn_local(async move { owner.discard("reserved-tab").await })
        };
        settle().await;
        let replacement = owner.get("reserved-tab").expect("get");
        assert!(!replacement.same(&abandoned));
        resolve.send(()).expect("resolve");
        rollback.await.expect("rollback");
        assert!(owner.get("reserved-tab").expect("get").same(&replacement));
        assert_eq!(instance(&instances, 0).rollback_calls.get(), 1);
        owner.dispose();
    });
}

#[test]
fn coalesces_close_requests_and_keeps_failed_closes_available_for_retry() {
    run(async {
        let instances: Instances = Rc::default();
        let owner = registry(&instances);
        let controller = owner.get("chat").expect("get");
        let (resolve, wait) = oneshot::channel();
        instance(&instances, 0)
            .close_once
            .borrow_mut()
            .push_back(wait.shared());
        let first = owner.close("chat");
        let second = owner.close("chat");
        assert!(first.ptr_eq(&second));
        resolve.send(CloseOutcome::Kept).expect("resolve");
        assert_eq!(first.await, CloseOutcome::Kept);
        assert!(owner.get("chat").expect("get").same(&controller));
        assert_eq!(instance(&instances, 0).dispose_calls.get(), 0);
        assert_eq!(owner.close("chat").await, CloseOutcome::Closed);
        assert_eq!(instance(&instances, 0).close_calls.get(), 2);
        assert_eq!(instance(&instances, 0).dispose_calls.get(), 1);
        assert!(!owner.get("chat").expect("get").same(&controller));
        owner.dispose();
    });
}

#[test]
fn keeps_a_replacement_when_an_old_close_completes_late() {
    run(async {
        let instances: Instances = Rc::default();
        let owner = registry(&instances);
        owner.get("chat").expect("get");
        let (resolve, wait) = oneshot::channel();
        instance(&instances, 0)
            .close_once
            .borrow_mut()
            .push_back(wait.shared());
        let close = owner.close("chat");
        owner.discard("chat").await;
        let replacement = owner.get("chat").expect("get");
        resolve.send(CloseOutcome::Closed).expect("resolve");
        close.await;
        assert!(owner.get("chat").expect("get").same(&replacement));
        owner.dispose();
    });
}

#[test]
fn releases_local_replicas_once_and_cannot_resurrect_a_disposed_project() {
    run(async {
        let instances: Instances = Rc::default();
        let owner = registry(&instances);
        owner.get("chat").expect("get");
        owner.dispose();
        owner.dispose();
        assert_eq!(instance(&instances, 0).dispose_calls.get(), 1);
        assert_eq!(instance(&instances, 0).close_calls.get(), 0);
        let error = owner.get("chat").err().expect("released");
        assert!(error.message.contains("released"));
        assert_eq!(owner.close("chat").await, CloseOutcome::Closed);
        owner.discard("chat").await;
        assert_eq!(instances.borrow().len(), 1);
    });
}
