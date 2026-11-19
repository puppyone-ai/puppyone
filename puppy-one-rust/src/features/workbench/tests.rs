use super::*;
use core::prelude::v1::test;
use std::cell::{Cell, RefCell};
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
        w.draw(cx).clear(cx);
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
        w.draw(cx).clear(cx);
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
        w.draw(cx).clear(cx);
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
        w.draw(cx).clear(cx);
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
        w.draw(cx).clear(cx);
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
            w.draw(cx).clear(cx);
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
                w.draw(cx).clear(cx);
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

/// A contribution's item that records what the Workbench tells it.
struct Probe {
    kind: ItemKind,
    view: Entity<ProbeView>,
    presentation: Rc<RefCell<(bool, bool)>>,
    closes: Rc<Cell<usize>>,
}
/// The item's retained content: a draft the person typed.
struct ProbeView {
    draft: String,
}
impl Render for ProbeView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().child(self.draft.clone())
    }
}
impl WorkbenchItem for Probe {
    fn kind(&self) -> ItemKind {
        self.kind
    }
    fn snapshot(&self, _: &App) -> ItemSnapshot {
        ItemSnapshot {
            title: "probe".into(),
            accessible_label: "probe".into(),
            detail: None,
            icon_key: None,
            status: ItemStatus::Idle,
            running: false,
            resource_id: None,
        }
    }
    fn view(&self) -> AnyView {
        self.view.clone().into()
    }
    fn retained(&self, _: &App) -> RetainedItem {
        RetainedItem::Terminal {
            title: "probe".into(),
            runtime: None,
        }
    }
    fn close_decision(&self, _: &App) -> CloseDecision {
        CloseDecision::Close
    }
    fn close_copy(&self, blocked: bool, title: String) -> CloseCopy {
        CloseCopy {
            title,
            detail: "",
            action: "",
            blocked,
        }
    }
    fn commit_close(&self) -> Option<futures_util::future::LocalBoxFuture<'static, bool>> {
        self.closes.set(self.closes.get() + 1);
        None
    }
    fn set_presentation(&self, presented: bool, command_target: bool, _: &mut Window, _: &mut App) {
        *self.presentation.borrow_mut() = (presented, command_target);
    }
    fn watch(&self, cx: &mut Context<Workbench>) -> Subscription {
        cx.observe(&self.view, |_, _, cx| cx.notify())
    }
}

/// `AuxiliaryPanelHost` → `AuxiliaryWorkbenchPanel active`: hiding the
/// workbench withdraws every item's presentation and command target
/// without closing, recreating or rearranging anything; showing it again
/// restores the shown tab of every group, split panes included.
#[gpui::test]
fn a_hidden_workbench_withdraws_presentation_and_keeps_its_items(cx: &mut TestAppContext) {
    // Saving the layout runs the real storage worker.
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    for kind in [ItemKind::Terminal, ItemKind::Chat] {
        // A project nothing was saved for: its stored layout cannot replace
        // the items under test.
        let root = tempfile::tempdir().unwrap();
        let (view, cx) = cx.add_window_view(Workbench::new);
        let closes = Rc::new(Cell::new(0));
        let probe = |s: &mut Workbench, cx: &mut Context<Workbench>| {
            let presentation = Rc::new(RefCell::new((false, false)));
            let item = Probe {
                kind,
                view: cx.new(|_| ProbeView {
                    draft: "retained draft".into(),
                }),
                presentation: presentation.clone(),
                closes: closes.clone(),
            };
            let draft = item.view.clone();
            let content = s.content(Rc::new(item), cx);
            let p = s.project_mut().unwrap();
            let id = p.layout.add(0);
            p.content.insert(id, content);
            p.layout.groups.get_mut(&0).unwrap().active = Some(id);
            (id, presentation, draft)
        };
        let (first, second, draft) = view.update(cx, |s, cx| {
            s.show(root.path().to_path_buf(), cx);
            let (_, first, draft) = probe(s, cx);
            let (tab, second, _) = probe(s, cx);
            // The second item in its own split pane.
            let p = s.project_mut().unwrap();
            p.layout.split(0, Axis::Vertical, true, Some(tab));
            cx.notify();
            (first, second, draft)
        });
        cx.run_until_parked();
        let shown = |cx: &mut VisualTestContext| {
            cx.run_until_parked();
            (*first.borrow(), *second.borrow())
        };
        let (a, b) = shown(cx);
        assert!(a.0 && b.0, "{kind:?}: both split panes are presented");
        assert!(a.1 != b.1, "{kind:?}: one of them is the command target");
        let topology = view.read_with(cx, |s, _| {
            serde_json::to_value(&s.project().unwrap().layout).unwrap()
        });
        draft.update(cx, |d, _| d.draft = "edited draft".into());
        for _ in 0..8 {
            view.update(cx, |s, cx| s.set_content_visible(false, cx));
            assert_eq!(shown(cx), ((false, false), (false, false)), "{kind:?}");
            // A late status change cannot present a hidden item.
            draft.update(cx, |_, cx| cx.notify());
            assert_eq!(shown(cx), ((false, false), (false, false)), "{kind:?}");
            view.update(cx, |s, cx| s.set_content_visible(true, cx));
            let (a, b) = shown(cx);
            assert!(a.0 && b.0 && a.1 != b.1, "{kind:?} {a:?} {b:?}");
        }
        // An item that arrives while hidden stays hidden until shown.
        view.update(cx, |s, cx| s.set_content_visible(false, cx));
        let late = view.update(cx, |s, cx| probe(s, cx).1);
        cx.run_until_parked();
        assert_eq!(*late.borrow(), (false, false), "{kind:?}");
        view.update(cx, |s, cx| s.set_content_visible(true, cx));
        cx.run_until_parked();
        assert!(late.borrow().0, "{kind:?}");
        view.read_with(cx, |s, _| {
            let layout = serde_json::to_value(&s.project().unwrap().layout).unwrap();
            assert_ne!(layout, topology, "the late item joined the layout");
            assert_eq!(s.project().unwrap().content.len(), 3);
        });
        assert_eq!(closes.get(), 0, "{kind:?}: nothing was closed");
        assert_eq!(draft.read_with(cx, |d, _| d.draft.clone()), "edited draft");
    }
}
/// `terminalClosePolicy`: a launcher still choosing closes at once; a
/// terminal asks first while it starts or runs, and closes unasked once
/// it exited or failed.
#[gpui::test]
fn a_terminal_asks_before_closing_only_while_it_starts_or_runs(cx: &mut TestAppContext) {
    use crate::features::terminal::{SessionStatus, TerminalItem, TerminalView};
    use crate::platform::terminal::{Bridge, Event, Terminal};
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(Workbench::new);
    let bridges: Rc<RefCell<Vec<Bridge>>> = Rc::default();
    let (exits, fails, terminals) = view.update_in(cx, |s, w, cx| {
        s.attach(
            PathBuf::from(format!("terminal-close-{}", uuid::Uuid::new_v4())),
            cx,
        );
        s.project_mut().unwrap().loading = false;
        let launcher = s.new_launcher_tab(0, cx).unwrap();
        s.close(launcher, false, cx);
        assert_eq!(s.confirm, None);
        assert!(!s.project().unwrap().content.contains_key(&launcher));
        let mut open = || {
            let bridges = bridges.clone();
            let terminal = cx.new(|cx| {
                TerminalView::start(
                    move |wake| {
                        let (terminal, bridge) = Terminal::bridged(wake);
                        bridges.borrow_mut().push(bridge);
                        terminal
                    },
                    true,
                    w,
                    cx,
                )
            });
            let item = TerminalItem::of(terminal.clone(), "repo".into(), None);
            (s.place(0, None, Rc::new(item), cx).unwrap(), terminal)
        };
        let (exits, a) = open();
        let (fails, b) = open();
        (exits, fails, [a, b])
    });
    let status =
        |cx: &mut VisualTestContext, i: usize| terminals[i].read_with(cx, |t, _| t.status());
    let asks = |cx: &mut VisualTestContext, tab: Id| {
        view.update(cx, |s, cx| {
            s.close(tab, false, cx);
            let asked = s.confirm == Some(tab);
            s.confirm = None;
            asked
        })
    };
    assert_eq!(status(cx, 0), SessionStatus::Starting);
    assert!(asks(cx, exits));
    let send = |i: usize, event: Event| assert!(bridges.borrow()[i].outlet.send(event));
    send(
        0,
        Event::Started {
            input_shell: "/bin/zsh".into(),
        },
    );
    send(0, Event::Data(b"\x1b[?1049h".to_vec()));
    cx.run_until_parked();
    assert_eq!(status(cx, 0), SessionStatus::Running);
    assert!(asks(cx, exits));
    send(0, Event::Exit(0));
    send(1, Event::Error("Agent is unavailable".into()));
    cx.run_until_parked();
    assert_eq!(status(cx, 0), SessionStatus::Exited);
    assert_eq!(status(cx, 1), SessionStatus::Error);
    for tab in [exits, fails] {
        assert!(!asks(cx, tab));
        assert!(view.read_with(cx, |s, _| !s.project().unwrap().content.contains_key(&tab)));
    }
}
