use super::*;
use crate::features::desktop_agent::{AgentChatHistoryPayload, HistoryBrowserEvent, HistoryTarget};
use core::prelude::v1::test;
use gpui::{TestAppContext, VisualTestContext};
use std::path::Path;

/// A workbench whose host is a launcher, as the right sidebar composes them.
fn compose(
    cx: &mut TestAppContext,
) -> (
    Entity<Workbench>,
    Entity<WorkbenchLauncher>,
    &mut VisualTestContext,
) {
    // These fixtures include real discovery/storage workers.
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (workbench, cx) = cx.add_window_view(Workbench::new);
    let launcher = workbench.update_in(cx, |_, window, cx| {
        let weak = cx.weak_entity();
        cx.new(|cx| WorkbenchLauncher::new(weak, window, cx))
    });
    // Keep the same host notification wiring as the production composition.
    workbench.update(cx, |w, cx| {
        w.set_host(Rc::new(launcher.clone()));
        cx.observe(&launcher, |_, _, cx| cx.notify()).detach();
    });
    (workbench, launcher, cx)
}

#[gpui::test]
fn a_history_chat_that_cannot_resume_goes_back_to_the_launcher(cx: &mut TestAppContext) {
    let (workbench, launcher, cx) = compose(cx);
    launcher.update(cx, |l, cx| l.show_local(PathBuf::from("/project"), cx));
    let tab = workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    launcher.update_in(cx, |l, window, cx| {
        let target = HistoryTarget {
            id: "agent:thread-1".into(),
            title: "Saved chat".into(),
            icon_key: None,
            payload: AgentChatHistoryPayload {
                runtime_id: "codex".into(),
                session_id: String::new(),
            },
        };
        l.restore_history_target(0, tab, target, window, cx);
    });
    // The tab stays the launcher; the workbench reports the failure.
    workbench.read_with(cx, |w, _| {
        assert!(w.is_launcher(Path::new("/project"), tab));
        assert_eq!(w.creation_failure_tab(), Some(tab));
    });
    workbench.update(cx, |w, cx| w.clear_creation_failure(cx));
    workbench.read_with(cx, |w, _| assert_eq!(w.creation_failure_tab(), None));
}

#[gpui::test]
fn the_shell_launcher_refuses_a_33rd_terminal(cx: &mut TestAppContext) {
    let (workbench, launcher, cx) = compose(cx);
    launcher.update(cx, |l, cx| l.show_local(PathBuf::from("/project"), cx));
    workbench.update(cx, |w, cx| {
        for n in 0..32 {
            w.lab_retained(
                RetainedItem::Terminal {
                    title: format!("t{n}"),
                    runtime: None,
                },
                cx,
            );
        }
        assert!(
            !w.can_create(ItemKind::Terminal),
            "32 terminals per project"
        );
    });
    // The shell launcher refuses rather than starting a 33rd PTY.
    launcher.update_in(cx, |l, window, cx| l.launch(0, None, None, window, cx));
    workbench.read_with(cx, |w, cx| {
        assert_eq!(w.open_resources(ItemKind::Terminal, cx).len(), 0);
        assert_eq!(w.tab_count(), 32);
    });
}

#[gpui::test]
fn a_hosted_location_offers_its_agent_only(cx: &mut TestAppContext) {
    let (_, launcher, cx) = compose(cx);
    launcher.update(cx, |l, cx| {
        l.show_local(PathBuf::from("/project"), cx);
        assert!(!l.is_hosted());
        assert!(
            l.visible_installations()
                .iter()
                .all(|i| i.id != crate::features::cloud::hosted_installation().id)
        );
    });
}

#[gpui::test]
fn allowing_history_records_permission_and_enables_its_browser_once(cx: &mut TestAppContext) {
    use crate::features::desktop_agent::{ConversationHistorySource, ConversationHistoryState};
    use std::cell::Cell;
    struct Source(Rc<Cell<usize>>);
    impl ConversationHistorySource for Source {
        fn snapshot(&self) -> ConversationHistoryState {
            ConversationHistoryState::default()
        }
        fn activate(&self) {
            self.0.set(self.0.get() + 1);
        }
        fn refresh(&self) {
            panic!("permission alone must not refresh the source")
        }
        fn watch(&self, _: Wake) -> Box<dyn FnOnce()> {
            Box::new(|| {})
        }
    }
    let (workbench, launcher, cx) = compose(cx);
    let prefs = cx.update(|_, cx| cx.new(|_| PreferencesStore::memory()));
    assert!(!prefs.read_with(cx, |p, _| p.state.local_agents.chat_history_discovery));
    let root = tempfile::tempdir().unwrap();
    launcher.update(cx, |l, cx| {
        l.set_preference_store(prefs.clone(), cx);
        l.show_local(root.path().to_path_buf(), cx);
    });
    let tab = workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    cx.run_until_parked();
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    let calls = Rc::new(Cell::new(0));
    let browser = launcher.update_in(cx, |l, window, cx| {
        let browser =
            cx.new(|cx| HistoryBrowser::new(Rc::new(Source(calls.clone())), false, window, cx));
        l.install_history(tab, browser.clone(), window, cx);
        browser
    });
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    assert_eq!(calls.get(), 0);
    let bounds = cx
        .debug_bounds("history-permission-allow")
        .expect("permission renders in the launcher tab");
    cx.simulate_click(bounds.center(), Modifiers::none());
    cx.run_until_parked();
    assert!(prefs.read_with(cx, |p, _| p.state.local_agents.chat_history_discovery));
    assert!(browser.read_with(cx, |b, _| b.enabled()));
    assert_eq!(calls.get(), 1);
    // Re-observing the shared permission does not reactivate this browser.
    launcher.update(cx, |l, cx| l.sync_history(cx));
    assert_eq!(calls.get(), 1);
    assert!(workbench.read_with(cx, |w, _| w.is_launcher(root.path(), tab)));
}

#[gpui::test]
fn history_restore_respects_the_chat_limit_before_preparing_a_native_session(
    cx: &mut TestAppContext,
) {
    let (workbench, launcher, cx) = compose(cx);
    let root = tempfile::tempdir().unwrap();
    launcher.update(cx, |l, cx| l.show_local(root.path().to_path_buf(), cx));
    workbench.update(cx, |w, cx| {
        for n in 0..8 {
            w.lab_retained(
                RetainedItem::Chat {
                    runtime: crate::agent::connections::legacy_runtime_registry::Runtime::Codex,
                    thread: None,
                    title: format!("chat {n}"),
                    runtime_id: Some("codex".into()),
                },
                cx,
            );
        }
        assert!(!w.can_create(ItemKind::Chat));
    });
    let tab = workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    launcher.update_in(cx, |l, window, cx| {
        l.restore_history_target(
            0,
            tab,
            HistoryTarget {
                id: "saved".into(),
                title: "Saved".into(),
                icon_key: None,
                // Admission must refuse even before target validation can report a failure.
                payload: AgentChatHistoryPayload {
                    runtime_id: "codex".into(),
                    session_id: String::new(),
                },
            },
            window,
            cx,
        );
    });
    workbench.read_with(cx, |w, _| {
        assert_eq!(w.tab_count(), 9);
        assert!(w.is_launcher(root.path(), tab));
        assert_eq!(
            w.creation_failure_tab(),
            None,
            "capacity refusal must not start target preparation"
        );
    });
}

#[gpui::test]
fn a_pending_history_preparation_blocks_terminal_launch_in_the_same_tab(cx: &mut TestAppContext) {
    let (workbench, launcher, cx) = compose(cx);
    let root = tempfile::tempdir().unwrap();
    launcher.update(cx, |l, cx| l.show_local(root.path().to_path_buf(), cx));
    let (tab, permit) = workbench.update(cx, |w, cx| {
        let tab = w.new_launcher_tab(0, cx).unwrap();
        let permit = w.reserve_creation(ItemKind::Chat, tab, cx).unwrap();
        (tab, permit)
    });
    launcher.update_in(cx, |l, window, cx| l.launch(0, Some(tab), None, window, cx));
    workbench.update(cx, |w, cx| {
        assert!(w.is_launcher(root.path(), tab));
        assert!(w.creation_is_current(&permit));
        assert_eq!(w.open_resources(ItemKind::Terminal, cx).len(), 0);
        assert_eq!(w.tab_count(), 1);
        w.cancel_creation(permit, cx);
        assert!(w.launcher_available(root.path(), tab));
    });
}

fn empty_hosted_history(dir: &Path) -> std::sync::Arc<crate::features::cloud::Hub> {
    use crate::workspace::cloud::agent::{Client, Error, Event, Transport};
    struct NoRequests;
    impl Transport for NoRequests {
        fn request(
            &self,
            _: crate::cloud::auth::model::ApiRequest,
        ) -> Result<serde_json::Value, Error> {
            panic!("history admission must not allocate or query a hosted conversation")
        }
        fn events(
            &self,
            _: &str,
            _: u64,
            _: &crate::cloud::auth::Cancellation,
        ) -> Result<Vec<Event>, Error> {
            panic!("history admission must not observe a hosted conversation")
        }
    }
    crate::features::cloud::Hub::new(
        Client::new(
            std::sync::Arc::new(NoRequests),
            "project-a".into(),
            "workbench-a".into(),
        ),
        "admission-fixture".into(),
        dir.to_path_buf(),
        Box::new(|| {}),
    )
}

#[gpui::test]
fn missing_hosted_history_stays_on_the_launcher_instead_of_creating_a_new_chat(
    cx: &mut TestAppContext,
) {
    let (workbench, launcher, cx) = compose(cx);
    let root = tempfile::tempdir().unwrap();
    let receipts = tempfile::tempdir().unwrap();
    launcher.update(cx, |l, cx| {
        l.show_local(root.path().to_path_buf(), cx);
        l.hosted.open_hub(empty_hosted_history(receipts.path()));
    });
    let tab = workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    let target = HistoryTarget {
        id: "removed-session".into(),
        title: "Saved".into(),
        icon_key: None,
        payload: AgentChatHistoryPayload {
            runtime_id: "cloud-pi".into(),
            session_id: "removed-session".into(),
        },
    };
    launcher.update_in(cx, |l, window, cx| {
        l.history_event(tab, &HistoryBrowserEvent::Open(target), window, cx);
    });
    workbench.read_with(cx, |w, _| {
        assert!(
            w.is_launcher(root.path(), tab),
            "a missing locator must never become a new conversation"
        );
        assert_eq!(w.creation_failure_tab(), Some(tab));
        assert!(
            w.can_create(ItemKind::Chat),
            "failure releases the preparation"
        );
    });
    assert_eq!(receipts.path().read_dir().unwrap().count(), 0);
}

#[gpui::test]
fn hosted_history_obeys_the_chat_limit_before_allocating_receipts(cx: &mut TestAppContext) {
    let (workbench, launcher, cx) = compose(cx);
    let root = tempfile::tempdir().unwrap();
    let receipts = tempfile::tempdir().unwrap();
    launcher.update(cx, |l, cx| {
        l.show_local(root.path().to_path_buf(), cx);
        l.hosted.open_hub(empty_hosted_history(receipts.path()));
    });
    let tab = workbench.update(cx, |w, cx| {
        for n in 0..8 {
            w.lab_retained(
                RetainedItem::Chat {
                    runtime: crate::agent::connections::legacy_runtime_registry::Runtime::Codex,
                    thread: None,
                    title: format!("chat {n}"),
                    runtime_id: Some("codex".into()),
                },
                cx,
            );
        }
        w.new_launcher_tab(0, cx).unwrap()
    });
    let target = HistoryTarget {
        id: "saved-session".into(),
        title: "Saved".into(),
        icon_key: None,
        payload: AgentChatHistoryPayload {
            runtime_id: "cloud-pi".into(),
            session_id: "saved-session".into(),
        },
    };
    launcher.update_in(cx, |l, window, cx| {
        l.history_event(tab, &HistoryBrowserEvent::Open(target), window, cx)
    });
    workbench.read_with(cx, |w, _| {
        assert!(w.is_launcher(root.path(), tab));
        assert_eq!(w.creation_failure_tab(), None);
        assert_eq!(w.tab_count(), 9);
    });
    assert_eq!(receipts.path().read_dir().unwrap().count(), 0);
}
