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
                code: None,
                request_id: None,
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
        // The group its only tab left folds away.
        assert!(!p.layout.groups.contains_key(&group));
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
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let root = tempfile::tempdir().unwrap();
    let (view, cx) = cx.add_window_view(Workbench::new);
    // A failure belongs to the project shown when it happened.
    view.update(cx, |w, cx| w.show(root.path().to_path_buf(), cx));
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
            items: std::collections::BTreeMap::new(),
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

/// `uses one Store for DOM focus activation, while only explicit tab
/// actions request focus`: a press inside another split group's content
/// makes its item the command target, and none while the workbench hides.
#[gpui::test]
fn a_press_in_a_group_makes_its_item_the_command_target(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let root = tempfile::tempdir().unwrap();
    let (view, cx) = cx.add_window_view(Workbench::new);
    let closes = Rc::new(Cell::new(0));
    let probe = |s: &mut Workbench, cx: &mut Context<Workbench>| {
        let presentation = Rc::new(RefCell::new((false, false)));
        let item = Probe {
            kind: ItemKind::Terminal,
            view: cx.new(|_| ProbeView {
                draft: "draft".into(),
            }),
            presentation: presentation.clone(),
            closes: closes.clone(),
        };
        let content = s.content(Rc::new(item), cx);
        let p = s.project_mut().unwrap();
        let id = p.layout.add(0);
        p.content.insert(id, content);
        p.layout.groups.get_mut(&0).unwrap().active = Some(id);
        (id, presentation)
    };
    let (first, second) = view.update(cx, |s, cx| {
        s.show(root.path().to_path_buf(), cx);
        // Nothing was stored for this project: show it without waiting.
        s.project_mut().unwrap().loading = false;
        let (_, first) = probe(s, cx);
        let (tab, second) = probe(s, cx);
        s.project_mut()
            .unwrap()
            .layout
            .split(0, Axis::Vertical, true, Some(tab));
        cx.notify();
        (first, second)
    });
    let targets = |cx: &mut VisualTestContext| {
        // Measure, then draw with the measured group bounds.
        for _ in 0..2 {
            cx.run_until_parked();
            cx.update(|w, cx| w.draw(cx).clear(cx));
        }
        (first.borrow().1, second.borrow().1)
    };
    let (a, b) = targets(cx);
    assert!(a != b, "one command target");
    let press = |cx: &mut VisualTestContext, group: Id| {
        let selector: &'static str =
            Box::leak(format!("workbench-group-content-{group}").into_boxed_str());
        let at = cx
            .debug_bounds(selector)
            .expect("the group's content")
            .center();
        cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
        cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    };
    let other = |cx: &mut VisualTestContext| {
        view.read_with(cx, |s, _| {
            let layout = &s.project().unwrap().layout;
            *layout
                .groups
                .keys()
                .find(|g| **g != layout.active_group)
                .unwrap()
        })
    };
    let group = other(cx);
    press(cx, group);
    assert_eq!(targets(cx), (b, a), "the pressed group's item");
    let group = other(cx);
    press(cx, group);
    assert_eq!(targets(cx), (a, b));
    view.update(cx, |s, cx| s.set_content_visible(false, cx));
    assert_eq!(targets(cx), (false, false));
    assert_eq!(closes.get(), 0);
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

/// `opens the launcher from plus`, `keeps multiple blank tabs independent
/// ... and in-place promotion`, `creates independent blank Items within one
/// Group`: `+` adds a blank launcher tab to its own group and selects it,
/// without a menu; blank tabs are independent "New tab"s; an item chosen in
/// one takes that tab's place, keeping the others and the current
/// selection; closing a blank tab removes only it.
#[gpui::test]
fn plus_adds_independent_blank_tabs_and_an_item_fills_the_one_it_was_chosen_in(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    // Keep the `+` button stationary between synthetic mouse-down and mouse-up.
    cx.update(|cx| cx.set_reduce_motion(true));
    let root = tempfile::tempdir().unwrap();
    let (view, cx) = cx.add_window_view(Workbench::new);
    view.update(cx, |s, cx| {
        s.show(root.path().to_path_buf(), cx);
        s.project_mut().unwrap().loading = false;
        s.add(0, cx);
    });
    let draw = |cx: &mut VisualTestContext| {
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    };
    draw(cx);
    for _ in 0..2 {
        let plus = cx.debug_bounds("workbench-new-tab-0").unwrap().center();
        cx.simulate_click(plus, Modifiers::none());
        draw(cx);
    }
    let tabs = view.read_with(cx, |s, cx| {
        let p = s.project().unwrap();
        let tabs = p.layout.groups[&0].tabs.clone();
        assert_eq!(p.layout.groups.len(), 1);
        assert_eq!(p.layout.groups[&0].active, tabs.last().copied());
        for tab in &tabs {
            assert!(matches!(p.content[tab], Content::Launcher));
            assert_eq!(s.tab_title(*tab, &p.content[tab], cx), "New tab");
        }
        assert!(s.context_menu.is_none());
        tabs
    });
    assert_eq!(tabs.len(), 3);
    assert_eq!(
        tabs.iter().collect::<std::collections::HashSet<_>>().len(),
        3
    );
    let item = view.update(cx, |s, cx| {
        let item = Probe {
            kind: ItemKind::Chat,
            view: cx.new(|_| ProbeView {
                draft: String::new(),
            }),
            presentation: Rc::default(),
            closes: Rc::default(),
        };
        s.place(0, Some(tabs[0]), Rc::new(item), cx)
    });
    assert_eq!(item, Some(tabs[0]));
    view.read_with(cx, |s, _| {
        let p = s.project().unwrap();
        assert_eq!(p.layout.groups[&0].tabs, tabs);
        assert_eq!(p.layout.groups[&0].active, Some(tabs[2]));
        assert_eq!(p.content[&tabs[0]].kind(), Some(ItemKind::Chat));
        assert!(matches!(p.content[&tabs[1]], Content::Launcher));
        assert!(matches!(p.content[&tabs[2]], Content::Launcher));
    });
    view.update(cx, |s, cx| s.close(tabs[1], false, cx));
    view.read_with(cx, |s, _| {
        assert_eq!(
            s.project().unwrap().layout.groups[&0].tabs,
            [tabs[0], tabs[2]]
        );
        assert_eq!(s.confirm, None);
    });
}

/// An item whose close decision, busy state and release the test drives.
struct Releasing {
    view: Entity<ProbeView>,
    decision: Rc<Cell<CloseDecision>>,
    running: Rc<Cell<bool>>,
    releases: Rc<RefCell<Vec<async_channel::Sender<bool>>>>,
}
impl WorkbenchItem for Releasing {
    fn kind(&self) -> ItemKind {
        ItemKind::Terminal
    }
    fn snapshot(&self, _: &App) -> ItemSnapshot {
        ItemSnapshot {
            title: "releasing".into(),
            accessible_label: "releasing".into(),
            detail: None,
            icon_key: None,
            status: ItemStatus::Running,
            running: self.running.get(),
            resource_id: None,
        }
    }
    fn view(&self) -> AnyView {
        self.view.clone().into()
    }
    fn retained(&self, _: &App) -> RetainedItem {
        RetainedItem::Terminal {
            title: "releasing".into(),
            runtime: None,
        }
    }
    fn close_decision(&self, _: &App) -> CloseDecision {
        self.decision.get()
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
        use futures_util::FutureExt as _;
        let (release, released) = async_channel::bounded(1);
        self.releases.borrow_mut().push(release);
        Some(async move { released.recv().await.unwrap_or(false) }.boxed_local())
    }
    fn watch(&self, cx: &mut Context<Workbench>) -> Subscription {
        cx.observe(&self.view, |_, _, cx| cx.notify())
    }
}

/// `Auxiliary Workbench close coordinator`: a close commits before the tab
/// leaves the topology, and the tab goes only once its item is released;
/// a busy item waits for an explicit confirmation and a blocked one never
/// commits; repeated requests while a release is pending commit once; a
/// release that fails keeps the tab, asking again only while the item is
/// still busy, and a later request retries; pending closes of different
/// items never affect each other.
#[gpui::test]
fn closes_commit_first_wait_for_their_release_and_stay_apart(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let root = tempfile::tempdir().unwrap();
    let (view, cx) = cx.add_window_view(Workbench::new);
    struct Handle {
        tab: Id,
        decision: Rc<Cell<CloseDecision>>,
        running: Rc<Cell<bool>>,
        releases: Rc<RefCell<Vec<async_channel::Sender<bool>>>>,
    }
    let handles: Vec<Handle> = view.update(cx, |s, cx| {
        s.show(root.path().to_path_buf(), cx);
        s.project_mut().unwrap().loading = false;
        (0..2)
            .map(|_| {
                let handle = Handle {
                    tab: 0,
                    decision: Rc::new(Cell::new(CloseDecision::Close)),
                    running: Rc::new(Cell::new(false)),
                    releases: Rc::default(),
                };
                let item = Releasing {
                    view: cx.new(|_| ProbeView {
                        draft: String::new(),
                    }),
                    decision: handle.decision.clone(),
                    running: handle.running.clone(),
                    releases: handle.releases.clone(),
                };
                let tab = s.place(0, None, Rc::new(item), cx).unwrap();
                Handle { tab, ..handle }
            })
            .collect()
    });
    let (a, b) = (&handles[0], &handles[1]);
    let open = |cx: &mut VisualTestContext, tab: Id| {
        view.read_with(cx, |s, _| s.project().unwrap().content.contains_key(&tab))
    };
    let release = |cx: &mut VisualTestContext, handle: &Handle, released: bool| {
        let sender = handle.releases.borrow_mut().remove(0);
        sender.send_blocking(released).unwrap();
        cx.run_until_parked();
    };
    // An immediate close commits; the tab stays until the release, and a
    // repeated request meanwhile commits nothing more.
    view.update(cx, |s, cx| {
        s.close(a.tab, false, cx);
        s.close(a.tab, false, cx);
    });
    assert_eq!(a.releases.borrow().len(), 1);
    assert!(open(cx, a.tab));
    // A release that fails keeps the tab without asking (the item is not
    // busy); asking again retries.
    release(cx, a, false);
    assert!(open(cx, a.tab));
    assert_eq!(view.read_with(cx, |s, _| s.confirm), None);
    // Busy now: it asks first, and commits only once confirmed.
    a.decision.set(CloseDecision::Confirm);
    a.running.set(true);
    view.update(cx, |s, cx| s.close(a.tab, false, cx));
    assert_eq!(view.read_with(cx, |s, _| s.confirm), Some(a.tab));
    assert!(a.releases.borrow().is_empty());
    view.update(cx, |s, cx| s.close(a.tab, true, cx));
    assert_eq!(a.releases.borrow().len(), 1);
    // While it is pending, another item's close is its own.
    b.decision.set(CloseDecision::Confirm);
    view.update(cx, |s, cx| s.close(b.tab, false, cx));
    assert_eq!(view.read_with(cx, |s, _| s.confirm), Some(b.tab));
    // A refused release of a still-busy item asks again.
    release(cx, a, false);
    assert!(open(cx, a.tab));
    assert_eq!(view.read_with(cx, |s, _| s.confirm), Some(a.tab));
    view.update(cx, |s, cx| s.dismiss_close(cx));
    // The other's confirmed close goes through on its own.
    view.update(cx, |s, cx| s.close(b.tab, true, cx));
    release(cx, b, true);
    assert!(!open(cx, b.tab));
    assert!(open(cx, a.tab));
    // A blocked item only keeps its tab; even a forced close cannot commit.
    a.decision.set(CloseDecision::Blocked);
    view.update(cx, |s, cx| {
        s.close(a.tab, false, cx);
        assert_eq!(s.confirm, Some(a.tab));
        assert!(s.close_copy(a.tab, cx).unwrap().blocked);
        s.close(a.tab, true, cx);
    });
    assert!(a.releases.borrow().is_empty());
    view.update(cx, |s, cx| s.dismiss_close(cx));
    // Once it can go, a confirmed close removes it after its release.
    a.decision.set(CloseDecision::Confirm);
    view.update(cx, |s, cx| s.close(a.tab, true, cx));
    release(cx, a, true);
    assert!(!open(cx, a.tab));
}

/// `keeps a failed creation and its retry confined to the original project`:
/// a creation failure shows and retries only in the project it happened
/// in; another project's creations and dismissals leave it there, and it
/// is back with its Retry when its project is shown again.
#[gpui::test]
fn a_creation_failure_stays_with_its_project(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (view, cx) = cx.add_window_view(Workbench::new);
    let retries = Rc::new(Cell::new(0));
    let tab = view.update(cx, |s, cx| {
        s.show(a.path().to_path_buf(), cx);
        s.project_mut().unwrap().loading = false;
        let tab = s.new_launcher_tab(0, cx).unwrap();
        let retried = retries.clone();
        s.fail_creation(
            tab,
            "temporary".into(),
            Some(Rc::new(move |_, _| retried.set(retried.get() + 1))),
            cx,
        );
        tab
    });
    assert_eq!(
        view.read_with(cx, |s, _| s.creation_failure_tab()),
        Some(tab)
    );
    view.update_in(cx, |s, w, cx| {
        s.show(b.path().to_path_buf(), cx);
        s.project_mut().unwrap().loading = false;
        assert_eq!(s.creation_failure_tab(), None);
        let other = s.new_launcher_tab(0, cx).unwrap();
        assert_eq!(other, tab, "tab ids repeat across projects");
        s.retry_creation(w, cx);
        s.clear_creation_failure(cx);
        s.remove_tab(b.path(), other, cx);
        assert!(s.creation_notice(cx).is_none());
    });
    cx.run_until_parked();
    assert_eq!(retries.get(), 0);
    view.update_in(cx, |s, w, cx| {
        s.show(a.path().to_path_buf(), cx);
        assert_eq!(s.creation_failure_tab(), Some(tab));
        assert!(s.creation_notice(cx).is_some());
        s.retry_creation(w, cx);
    });
    cx.run_until_parked();
    assert_eq!(retries.get(), 1);
    assert_eq!(view.read_with(cx, |s, _| s.creation_failure_tab()), None);
}

/// `Auxiliary Workbench topology`: terminals and chats share one tab
/// stack; either kind splits into its own group and moves back as one
/// tab, its group folding away; a tab alone in its group cannot be split
/// out of it; closing the last tab leaves a valid empty workbench.
#[gpui::test]
fn mixed_kinds_share_a_bar_and_split_or_move_as_single_tabs(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let root = tempfile::tempdir().unwrap();
    let (view, cx) = cx.add_window_view(Workbench::new);
    view.update(cx, |s, cx| {
        s.show(root.path().to_path_buf(), cx);
        s.project_mut().unwrap().loading = false;
        let terminal = Releasing {
            view: cx.new(|_| ProbeView {
                draft: String::new(),
            }),
            decision: Rc::new(Cell::new(CloseDecision::Close)),
            running: Rc::default(),
            releases: Rc::default(),
        };
        let chat = Probe {
            kind: ItemKind::Chat,
            view: cx.new(|_| ProbeView {
                draft: String::new(),
            }),
            presentation: Rc::default(),
            closes: Rc::default(),
        };
        let t = s.place(0, None, Rc::new(terminal), cx).unwrap();
        let c = s.place(0, None, Rc::new(chat), cx).unwrap();
        let wide = Bounds::new(point(px(0.), px(0.)), size(px(1200.), px(800.)));
        {
            let p = s.project().unwrap();
            assert_eq!(p.layout.groups[&0].tabs, vec![t, c]);
            assert_eq!(p.layout.groups[&0].active, Some(c));
            assert_eq!(
                [p.content[&t].kind(), p.content[&c].kind()],
                [Some(ItemKind::Terminal), Some(ItemKind::Chat)]
            );
        }
        assert!(s.can_split(c, 0, Axis::Horizontal, wide));
        s.split(0, Axis::Horizontal, Some(c), true, cx);
        let right = s.group_of(c).unwrap();
        assert_ne!(right, 0);
        assert_eq!(s.project().unwrap().layout.groups[&0].tabs, vec![t]);
        // Alone in its group, a tab cannot split out of it.
        assert!(!s.can_split(t, 0, Axis::Horizontal, wide));
        s.project_mut().unwrap().layout.move_tab(c, 0, 1);
        let p = s.project().unwrap();
        assert_eq!(p.layout.groups.keys().copied().collect::<Vec<_>>(), [0]);
        assert_eq!(p.layout.groups[&0].tabs, vec![t, c]);
        assert_eq!(p.content[&c].kind(), Some(ItemKind::Chat));
        let path = root.path().to_path_buf();
        s.remove_tab(&path, t, cx);
        s.remove_tab(&path, c, cx);
        let p = s.project().unwrap();
        assert!(p.content.is_empty() && p.layout.valid());
    });
}

#[gpui::test]
fn closing_last_tab_emits_closed_last_tab_and_folds_empty_secondary_splits(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let root = tempfile::tempdir().unwrap();
    let (view, cx) = cx.add_window_view(Workbench::new);
    let closed_last = Rc::new(Cell::new(0usize));
    let closed_last_sub = closed_last.clone();
    let _sub = cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event, _| {
            if matches!(event, WorkbenchEvent::ClosedLastTab) {
                closed_last_sub.set(closed_last_sub.get() + 1);
            }
        })
    });

    let (t1, t2) = view.update(cx, |s, cx| {
        s.show(root.path().to_path_buf(), cx);
        s.project_mut().unwrap().loading = false;
        let t1 = s.new_launcher_tab(0, cx).unwrap();
        let t2 = s.new_launcher_tab(0, cx).unwrap();
        s.split(0, Axis::Horizontal, Some(t2), true, cx);
        assert_eq!(s.project().unwrap().layout.groups.len(), 2);
        (t1, t2)
    });

    // Closing the only tab in the secondary split folds that split away without
    // collapsing the whole workbench (group 0 still has t1).
    view.update(cx, |s, cx| s.close(t2, false, cx));
    cx.run_until_parked();
    assert_eq!(closed_last.get(), 0);
    view.read_with(cx, |s, _| {
        let p = s.project().unwrap();
        assert_eq!(p.layout.groups.len(), 1);
        assert_eq!(p.layout.groups[&0].tabs, vec![t1]);
        assert!(p.layout.valid());
    });

    // Closing the final remaining tab emits ClosedLastTab and leaves no ghost launcher.
    view.update(cx, |s, cx| s.close(t1, false, cx));
    cx.run_until_parked();
    assert_eq!(closed_last.get(), 1);
    cx.update(|w, cx| w.draw(cx).clear(cx));
    assert!(cx.debug_bounds("launcher-heading").is_none());
    assert!(cx.debug_bounds("launcher-composer-input").is_none());
}
