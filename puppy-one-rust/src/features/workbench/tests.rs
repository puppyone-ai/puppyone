use super::*;
use core::prelude::v1::test;
/// `{ kind: "blocked" }` and "closing never stops": an unconfirmed
/// submission keeps its tab; a confirmed running one closes unasked.
#[gpui::test]
fn a_hosted_chat_with_an_unconfirmed_submission_cannot_close(cx: &mut TestAppContext) {
    use crate::cloud::auth::Cancellation;
    use crate::cloud::auth::model::ApiRequest;
    use crate::features::cloud::{CloudAgentConversation, HostedChats, Hub};
    use crate::workspace::cloud::agent::Client;
    use crate::workspace::cloud::agent::Error;
    use crate::workspace::cloud::agent::Event;
    use crate::workspace::cloud::agent::Transport;
    use serde_json::{Value, json};
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    };
    #[derive(Default)]
    struct Script {
        accept: AtomicBool,
        paths: Mutex<Vec<String>>,
    }
    impl Transport for Script {
        fn request(&self, request: ApiRequest) -> Result<Value, Error> {
            self.paths.lock().unwrap().push(request.path.clone());
            let failure = |status, unknown| Error {
                status,
                unknown,
                message: "scripted".into(),
            };
            if !self.accept.load(Ordering::SeqCst) {
                return Err(failure(None, true));
            }
            if request.path.starts_with("/agents/requests/") {
                return Err(failure(Some(404), false));
            }
            let id = request
                .body
                .map_or("req".into(), |b| b["request_id"].clone());
            Ok(
                json!({"id": "run-1", "project_id": "project-a", "workbench_id": "wb-1",
                "agent_id": "agent-1", "session_id": "session-1", "request_id": id,
                "prompt": "hello", "state": "running", "sequence": 1}),
            )
        }
        fn events(&self, _: &str, _: u64, _: &Cancellation) -> Result<Vec<Event>, Error> {
            std::thread::sleep(std::time::Duration::from_millis(20));
            Ok(vec![])
        }
    }
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let script = Arc::new(Script::default());
    let dir = tempfile::tempdir().unwrap();
    let hub = Hub::new(
        Client::new(script.clone(), "project-a".into(), "wb-1".into()),
        "puppyone-cloud://test/blocked".into(),
        dir.path().to_path_buf(),
        Box::new(|| {}),
    );
    let (view, cx) = cx.add_window_view(Workbench::new);
    // The hosted contribution's chat, placed as its launcher would.
    let mut hosted = HostedChats::default();
    hosted.open_hub(hub);
    view.update_in(cx, |s, w, cx| {
        let root = PathBuf::from(format!("cloud-test-{}", uuid::Uuid::new_v4()));
        s.attach(root.clone(), cx);
        s.project_mut().unwrap().loading = false;
        let item = hosted.chat(&root, "tab:0", None, w, cx).unwrap();
        s.place(0, None, Rc::new(item), cx);
    });
    let (tab, chat) = view.read_with(cx, |s, _| {
        s.project()
            .unwrap()
            .content
            .iter()
            .find_map(|(id, c)| match c {
                Content::Item { item, .. } => item
                    .view()
                    .downcast::<CloudAgentConversation>()
                    .ok()
                    .map(|chat| (*id, chat)),
                _ => None,
            })
            .expect("a hosted chat")
    });
    let settle = |cx: &mut VisualTestContext, what: &str, ready: &dyn Fn(&App) -> bool| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !cx.update(|_, cx| ready(cx)) {
            cx.run_until_parked();
            assert!(
                std::time::Instant::now() < deadline,
                "{what} did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    };
    let hosted = |cx: &App, f: &dyn Fn(&crate::features::cloud::CloudAgentController) -> bool| {
        f(chat.read(cx).chat())
    };
    chat.update(cx, |c, _| c.chat().submit("hello".into()));
    settle(cx, "the lost receipt", &|cx| {
        hosted(cx, &|c| {
            let state = c.snapshot();
            state.error.is_some() && !state.submitting && !c.can_release()
        })
    });
    // The conversation draws its status, transcript and composer.
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |s, cx| {
        s.close(tab, false, cx);
        assert_eq!(s.confirm, Some(tab));
        assert!(s.close_copy(tab, cx).unwrap().is_blocked());
        // A forced close cannot get past the refusal.
        s.close(tab, true, cx);
        assert!(s.project().unwrap().content.contains_key(&tab));
        s.dismiss_close(cx);
    });
    // The retry confirms; the running tab now closes without asking.
    script.accept.store(true, Ordering::SeqCst);
    chat.update(cx, |c, _| c.chat().retry());
    settle(cx, "the confirmation", &|cx| {
        hosted(cx, &|c| c.can_release())
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |s, cx| {
        s.close(tab, false, cx);
        assert_eq!(s.confirm, None);
        assert!(!s.project().unwrap().content.contains_key(&tab));
    });
    assert!(
        !script
            .paths
            .lock()
            .unwrap()
            .iter()
            .any(|p| p.ends_with("/stop"))
    );
}
#[gpui::test]
fn project_switch_retains_tabs_without_starting_a_process(cx: &mut TestAppContext) {
    // This integration fixture includes real discovery/storage workers.
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(Workbench::new);
    view.update(cx, |s, cx| {
        s.show(PathBuf::from("/project-a"), cx);
        s.add(0, cx);
        s.add(0, cx);
        let p = s.project().unwrap();
        assert_eq!(p.content.len(), 2);
        assert!(p.content.values().all(|c| matches!(c, Content::Launcher)));
        assert!(!s.has_running(cx));
        s.show(PathBuf::from("/project-b"), cx);
        assert!(s.project().unwrap().content.is_empty());
        s.show(PathBuf::from("/project-a"), cx);
        assert_eq!(s.project().unwrap().content.len(), 2);
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |s, cx| {
        let ids = s.project().unwrap().layout.groups[&0].tabs.clone();
        for id in ids {
            s.close(id, false, cx);
        }
        assert!(s.project().unwrap().content.is_empty());
        assert_eq!(s.project().unwrap().layout.groups[&0].active, None);
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}
#[gpui::test]
fn contributions_stop_at_their_maximum_items(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(Workbench::new);
    view.update(cx, |s, cx| {
        s.show(PathBuf::from("/project"), cx);
        let p = s.project_mut().unwrap();
        for n in 0..32 {
            let id = p.layout.add(0);
            p.content.insert(
                id,
                Content::Retained(RetainedItem::Terminal {
                    title: format!("t{n}"),
                    runtime: None,
                }),
            );
        }
        assert!(
            !s.can_create(ItemKind::Terminal),
            "32 terminals per project"
        );
        assert!(s.can_create(ItemKind::Chat));
        let p = s.project_mut().unwrap();
        for n in 0..8 {
            let id = p.layout.add(0);
            p.content.insert(
                id,
                Content::Retained(RetainedItem::Chat {
                    runtime: crate::agent::connections::legacy_runtime_registry::Runtime::Codex,
                    thread: None,
                    title: format!("c{n}"),
                    runtime_id: Some("codex".into()),
                }),
            );
        }
        assert!(!s.can_create(ItemKind::Chat), "8 Agent Chats per project");
    });
}
#[gpui::test]
fn keyboard_move_splits_only_when_both_sides_fit(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(Workbench::new);
    view.update(cx, |s, cx| {
        s.show(PathBuf::from("/project"), cx);
        s.add(0, cx);
        s.add(0, cx);
        s.project_mut().unwrap().loading = false;
        // 420 wide: two 280px launchers cannot sit side by side.
        s.bounds.insert(
            0,
            Bounds::new(point(px(0.), px(38.)), size(px(420.), px(722.))),
        );
        s.move_active_to_edge(0, Edge::Right, cx);
        assert_eq!(s.project().unwrap().layout.groups.len(), 1);
        // 722 tall: 260 + 1 + 260 fits, so the active tab splits below.
        let active = s.project().unwrap().layout.groups[&0].active;
        s.move_active_to_edge(0, Edge::Bottom, cx);
        let layout = &s.project().unwrap().layout;
        assert_eq!(layout.groups.len(), 2);
        assert!(
            layout
                .groups
                .values()
                .any(|g| g.tabs == active.into_iter().collect::<Vec<_>>())
        );
    });
}
#[gpui::test]
fn split_move_and_overflow_keep_the_same_content_instance(cx: &mut TestAppContext) {
    // This integration fixture includes real discovery/storage workers.
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(Workbench::new);
    view.update(cx, |s, cx| {
        s.show(PathBuf::from("/project"), cx);
        for _ in 0..12 {
            s.add(0, cx);
        }
        let p = s.project_mut().unwrap();
        let tab = p.layout.groups[&0].tabs[4];
        let group = p.layout.split(0, Axis::Vertical, true, Some(tab));
        assert_eq!(p.content.len(), 12);
        assert_eq!(p.layout.groups[&group].active, Some(tab));
        p.layout.move_tab(tab, 0, 0);
        assert!(p.layout.remove_empty_group(group));
        p.layout.navigate(0, "end");
        assert_eq!(
            p.layout.groups[&0].active,
            p.layout.groups[&0].tabs.last().copied()
        );
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}

#[gpui::test]
fn native_history_read_failure_renders_retry_but_confirmed_missing_history_does_not(
    cx: &mut TestAppContext,
) {
    use crate::features::desktop_agent::OpenFailure;
    use std::cell::Cell;
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(Workbench::new);
    let retries = Rc::new(Cell::new(0));
    for (code, retryable, message) in [
        (
            "HISTORY_READ_FAILED",
            true,
            "History messages could not be loaded. Try again.",
        ),
        (
            "SESSION_NOT_FOUND",
            false,
            "This saved chat is no longer available.",
        ),
    ] {
        let failure = OpenFailure {
            code: Some(code.into()),
            retryable,
        };
        let rendered = crate::localization::t(failure.message_key().unwrap());
        assert_eq!(rendered, message);
        let retried = retries.clone();
        let retry = failure
            .retryable
            .then(|| -> CreationRetry { Rc::new(move |_, _| retried.set(retried.get() + 1)) });
        view.update(cx, |w, cx| w.fail_creation(0, rendered.into(), retry, cx));
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        let message_selector = if retryable {
            "floating-notice-message:History messages could not be loaded. Try again."
        } else {
            "floating-notice-message:This saved chat is no longer available."
        };
        assert!(cx.debug_bounds(message_selector).is_some());
        let button = cx.debug_bounds("floating-notice-action:Retry");
        assert_eq!(button.is_some(), retryable);
        if let Some(bounds) = button {
            cx.simulate_click(bounds.center(), Modifiers::none());
            cx.run_until_parked();
            cx.update(|w, cx| {
                let _ = w.draw(cx);
            });
            assert_eq!(retries.get(), 1);
            assert!(view.read_with(cx, |w, _| w.creation_failure.is_none()));
        }
    }
    assert_eq!(retries.get(), 1);
}

#[gpui::test]
fn a_new_launcher_cancels_pending_layout_restore_and_keeps_late_results_from_replacing_it(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(Workbench::new);
    // Install a pending read without starting a disk worker. The result channel
    // is the actual production path; no timing or user metadata is involved.
    view.update(cx, |s, cx| {
        let root = PathBuf::from("/fixture/late-layout");
        s.root = Some(root.clone());
        s.projects.insert(
            root.clone(),
            Project {
                loading: true,
                ..Project::default()
            },
        );
        let saved = StoredProject {
            version: 1,
            layout: Layout::default(),
            items: HashMap::new(),
        }
        .to_saved()
        .unwrap();
        let tab = s.new_launcher_tab(0, cx).unwrap();
        let loading = s.project().unwrap().loading;
        s.store_tx
            .send(ResultEvent::Loaded(root.clone(), Ok(Some(saved))))
            .unwrap();
        s.restore_results(cx);
        let retained = s.is_launcher(&root, tab);
        let count = s.tab_count();
        // The fixture owns no persisted project; deferred saving sees no data.
        s.projects.clear();
        s.root = None;
        assert!(
            !loading,
            "explicit creation must remove the loading placeholder immediately"
        );
        assert!(
            retained,
            "the late saved layout cannot replace an explicit new tab"
        );
        assert_eq!(count, 1);
    });
}
