use super::*;
use crate::features::desktop_agent::{AgentChatHistoryPayload, HistoryTarget};
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
    workbench.update(cx, |w, _| w.set_host(Rc::new(launcher.clone())));
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
    let calls = Rc::new(Cell::new(0));
    let browser = launcher.update_in(cx, |l, window, cx| {
        let browser =
            cx.new(|cx| HistoryBrowser::new(Rc::new(Source(calls.clone())), false, window, cx));
        l.install_history(tab, browser.clone(), window, cx);
        browser
    });
    cx.run_until_parked();
    cx.update(|w, cx| {
        let _ = w.draw(cx);
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
