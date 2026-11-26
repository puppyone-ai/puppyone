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

/// `delays compact feedback outside the Agent list, adds results
/// immediately`, `does not flash a fast cached result`, `Refreshing
/// agents…`, `silences discovery failure`, `preserves usable rows and
/// manual refresh after a silent failure`, `keeps both frames available
/// when a prior Shell start reports an error`: discovery says nothing for
/// its first 200ms, then checks (or refreshes) between the found Agents and
/// the bundled one; found Agents show at once; a failure or an empty result
/// says nothing; every row stays usable throughout, and Scan again works
/// whenever no scan is running.
#[gpui::test]
fn discovery_feedback_waits_names_a_refresh_and_never_takes_a_row_away(cx: &mut TestAppContext) {
    use crate::agent::connections::legacy_runtime_registry::Runtime;
    use crate::platform::local_agent_setup::{Observation, ObservationFailure, ObservationStatus};
    use std::time::Instant;
    let (workbench, launcher, cx) = compose(cx);
    launcher.update(cx, |l, cx| l.show_local(PathBuf::from("/project"), cx));
    workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    let installation = |runtime, id, label: &str| Installation {
        runtime,
        id,
        label: label.into(),
        executable: PathBuf::from(format!("/fixture/{id}")),
        chat: true,
    };
    let codex = installation(Runtime::Codex, "codex", "Codex");
    let bundled = installation(
        Runtime::PuppyOne,
        agents::BUILT_IN_AGENT_ID,
        agents::BUILT_IN_AGENT_LABEL,
    );
    let set = |cx: &mut VisualTestContext, f: &dyn Fn(&mut WorkbenchLauncher)| {
        launcher.update(cx, |l, cx| {
            l.discovery_override = true;
            f(l);
            cx.notify();
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    };
    let top = |cx: &mut VisualTestContext, selector: &'static str| {
        cx.debug_bounds(selector).map(|b| b.top())
    };
    let label = |cx: &mut VisualTestContext| launcher.read_with(cx, |l, _| l.discovery_label());
    set(cx, &|l| {
        l.installations = vec![bundled.clone()];
        l.scanning = true;
        l.refreshing = false;
        l.scan_started = Some(Instant::now());
        l.picker_open = Some(0);
    });
    assert_eq!(top(cx, "launcher-discovery"), None);
    assert!(
        top(cx, "launcher-agent-puppyone-agent").is_some() && top(cx, "launcher-shell").is_some()
    );
    set(cx, &|l| {
        l.scan_started = Some(Instant::now() - std::time::Duration::from_millis(200));
        l.installations = vec![codex.clone(), bundled.clone()];
        l.picker_open = Some(0);
    });
    assert_eq!(label(cx), Some("terminal.launcher.detecting"));
    let (agent, feedback, built_in) = (
        top(cx, "launcher-agent-codex").unwrap(),
        top(cx, "launcher-discovery").unwrap(),
        top(cx, "launcher-agent-puppyone-agent").unwrap(),
    );
    assert!(agent < built_in && feedback > px(0.));
    // A scan that is running is the one Scan again would ask for.
    let store = cx.update(|_, cx| crate::features::local_agents::installation_store(cx));
    let deadline = Instant::now() + std::time::Duration::from_secs(10);
    while store.read_with(cx, |s, _| s.scanning) {
        assert!(Instant::now() < deadline, "the first scan did not settle");
        cx.run_until_parked();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let scans = Rc::new(std::cell::Cell::new(0));
    let _watch = cx.update(|_, cx| {
        let scans = scans.clone();
        let mut was = false;
        cx.observe(&store, move |store, cx| {
            let now = store.read(cx).scanning;
            if now && !was {
                scans.set(scans.get() + 1);
            }
            was = now;
        })
    });
    set(cx, &|l| l.picker_open = None);
    let scan = cx.debug_bounds("launcher-scan").unwrap().center();
    cx.simulate_click(scan, Modifiers::none());
    assert_eq!(scans.get(), 0);
    set(cx, &|l| l.scanning = false);
    assert_eq!(top(cx, "launcher-discovery"), None);
    set(cx, &|l| {
        l.scanning = true;
        l.refreshing = true;
        l.scan_started = Some(Instant::now() - std::time::Duration::from_millis(200));
        l.picker_open = Some(0);
    });
    assert_eq!(label(cx), Some("terminal.launcher.refreshing"));
    assert!(top(cx, "launcher-agent-codex").is_some());
    // A failed scan says nothing, keeps every row, and can be asked again.
    set(cx, &|l| {
        l.scanning = false;
        l.refreshing = false;
        l.picker_open = Some(0);
        l.observations = vec![Observation {
            id: "codex".into(),
            status: ObservationStatus::Failed,
            failure: Some(ObservationFailure::Product),
        }];
        l.launch_errors
            .insert(0, "The Agent could not start.".into());
    });
    assert_eq!(top(cx, "launcher-discovery"), None);
    assert!(top(cx, "launcher-error").is_some());
    for row in [
        "launcher-agent-codex",
        "launcher-agent-puppyone-agent",
        "launcher-shell",
    ] {
        assert!(top(cx, row).is_some(), "{row}");
    }
    set(cx, &|l| l.picker_open = None);
    let scan = cx.debug_bounds("launcher-scan").unwrap().center();
    cx.simulate_click(scan, Modifiers::none());
    assert!(scans.get() > 0, "Scan again asks for a new scan");
}

/// `supports a standalone Chat launcher without exposing the Shell frame`:
/// a hosted Project's launcher offers its Agent only — no shell, no local
/// discovery to scan or to wait on.
#[gpui::test]
fn a_hosted_launcher_offers_its_agent_without_a_shell_or_local_discovery(cx: &mut TestAppContext) {
    use crate::cloud::auth::{Cancellation, model::ApiRequest};
    use crate::features::cloud::Hub;
    use crate::workspace::cloud::agent::{Client, Error, Event, Transport};
    struct Offline;
    impl Transport for Offline {
        fn request(&self, _: ApiRequest) -> Result<serde_json::Value, Error> {
            Err(Error {
                status: None,
                code: None,
                request_id: None,
                unknown: false,
                message: "offline".into(),
            })
        }
        fn events(&self, _: &str, _: u64, _: &Cancellation) -> Result<Vec<Event>, Error> {
            Ok(vec![])
        }
    }
    let (workbench, launcher, cx) = compose(cx);
    let dir = tempfile::tempdir().unwrap();
    let hub = Hub::new(
        Client::new(Arc::new(Offline), "project-a".into(), "wb-1".into()),
        "puppyone-cloud://test/hosted-launcher".into(),
        dir.path().to_path_buf(),
        Box::new(|| {}),
    );
    launcher.update(cx, |l, cx| {
        l.hosted.open_hub(hub);
        l.show(PathBuf::from("hosted-launcher"), cx);
        l.discovery_override = true;
        l.scanning = true;
        l.scan_started = Some(std::time::Instant::now() - std::time::Duration::from_secs(1));
        l.picker_open = Some(0);
    });
    workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    let hosted: &'static str = Box::leak(
        format!(
            "launcher-agent-{}",
            crate::features::cloud::hosted_installation().id
        )
        .into_boxed_str(),
    );
    assert!(cx.debug_bounds(hosted).is_some());
    for absent in ["launcher-shell", "launcher-scan", "launcher-discovery"] {
        assert!(cx.debug_bounds(absent).is_none(), "{absent}");
    }
    assert_eq!(launcher.read_with(cx, |l, _| l.discovery_label()), None);
}

/// `uses detected ... and keeps Terminal in the same launch group`,
/// `switches the same frame to Chat recipes`, `renders only detected ids`,
/// `keeps local feedback and setup above bundled Agents`: one group lists
/// the detected Agents in catalog order, then setup for those not found,
/// then the Built-in Agent, then the terminal, whether or not discovery
/// failed; an Agent that was not detected has no row.
#[gpui::test]
fn detected_agents_then_setup_then_the_built_in_and_the_terminal(cx: &mut TestAppContext) {
    use crate::platform::local_agent_setup::companion::Presence;
    use crate::platform::local_agent_setup::{Observation, ObservationFailure, ObservationStatus};
    let (workbench, launcher, cx) = compose(cx);
    let cursor_supported = crate::platform::local_agent_setup::route("cursor").is_some_and(|r| {
        r.platforms
            .contains(&crate::platform::local_agent_setup::platform())
    });
    let suggested = if cursor_supported { "cursor" } else { "codex" };
    // A companion app is here and its CLI is not: setup offers it.
    cx.update(|_, cx| {
        crate::features::local_agents::activation_store(cx).update(cx, |s, cx| {
            s.fixture_companions(vec![(suggested, Presence::Present)]);
            cx.notify();
        })
    });
    launcher.update(cx, |l, cx| {
        let prefs = cx.new(|_| PreferencesStore::memory());
        prefs.update(cx, |p, _| {
            p.state.local_agents.setup_suggestions.enabled = true
        });
        l.set_preference_store(prefs, cx);
        l.show_local(PathBuf::from("/project"), cx)
    });
    workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    let detected: &[&str] = if cursor_supported {
        &["codex", "hermes", "workbuddy-china"]
    } else {
        &["hermes", "workbuddy-china"]
    };
    for failed in [false, true] {
        launcher.update(cx, |l, cx| {
            l.discovery_override = true;
            l.scanning = false;
            l.picker_open = Some(0);
            l.installations = agents::LOCAL_AGENTS
                .iter()
                .filter(|a| detected.contains(&a.id))
                .map(|a| Installation {
                    runtime: a.runtime,
                    id: a.id,
                    label: a.label.into(),
                    executable: PathBuf::from(format!("/fixture/{}", a.id)),
                    chat: true,
                })
                .chain([Installation {
                    runtime: crate::agent::connections::legacy_runtime_registry::Runtime::PuppyOne,
                    id: agents::BUILT_IN_AGENT_ID,
                    label: agents::BUILT_IN_AGENT_LABEL.into(),
                    executable: PathBuf::new(),
                    chat: true,
                }])
                .collect();
            l.observations = agents::LOCAL_AGENTS
                .iter()
                .map(|a| Observation {
                    id: a.id.into(),
                    status: if detected.contains(&a.id) {
                        ObservationStatus::Found
                    } else if failed && a.id == "claude" {
                        ObservationStatus::Failed
                    } else {
                        ObservationStatus::NotFound
                    },
                    failure: (failed && a.id == "claude").then_some(ObservationFailure::Product),
                })
                .collect();
            cx.notify();
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        let top = |cx: &mut VisualTestContext, selector: &str| {
            let selector: &'static str = Box::leak(selector.to_owned().into_boxed_str());
            cx.debug_bounds(selector).map(|b| b.top())
        };
        let mut picker_order: Vec<_> = detected
            .iter()
            .map(|id| top(cx, &format!("launcher-agent-{id}")).expect(id))
            .collect();
        picker_order.push(top(cx, "launcher-agent-puppyone-agent").expect("built-in"));
        assert!(
            picker_order.windows(2).all(|w| w[0] < w[1]),
            "{picker_order:?}"
        );
        assert!(top(cx, "launcher-setup").is_some());
        assert!(top(cx, "launcher-shell").is_some());
        for absent in ["claude", "cursor", "opencode", "pi"] {
            assert_eq!(
                top(cx, &format!("launcher-agent-{absent}")),
                None,
                "{absent}"
            );
        }
        assert_eq!(top(cx, "launcher-discovery"), None);
    }
}

/// `resolves Pi Workbench chrome through the same brand registry as Local
/// Agents settings`, `presents Codex Agent Chat with the ChatGPT mark while
/// retaining its name`: every local Agent's row draws the brand its runtime
/// names in the one catalog Settings also draws from, from an asset that
/// exists; Codex keeps its name and draws the ChatGPT mark.
#[test]
fn every_agent_row_draws_its_brand_from_the_one_catalog() {
    use crate::ui::agent_brand_mark::{AgentMark, LauncherIdentity, svg_path};
    let assets = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
    for product in agents::LOCAL_AGENTS {
        let identity = LauncherIdentity::brand(product.runtime.icon_key());
        assert!(
            matches!(identity, LauncherIdentity::Brand(_)),
            "{}",
            product.id
        );
    }
    assert_eq!(
        LauncherIdentity::brand("pi"),
        LauncherIdentity::Brand(AgentMark::Pi)
    );
    for dark in [false, true] {
        let mark = svg_path(AgentMark::Pi, dark).unwrap();
        assert!(assets.join(mark).exists(), "{mark}");
    }
    let codex = agents::LOCAL_AGENTS
        .iter()
        .find(|a| a.id == "codex")
        .unwrap();
    assert_eq!(codex.label, "Codex");
    let mark = svg_path(AgentMark::Codex, false).unwrap();
    assert_eq!(mark, "agents/chatgpt-mark.svg");
    assert!(assets.join(mark).exists());
    assert_eq!(
        LauncherIdentity::brand(
            crate::agent::connections::legacy_runtime_registry::Runtime::PuppyOne.icon_key()
        ),
        LauncherIdentity::Brand(AgentMark::PuppyOne)
    );
}

/// `mounts the contribution-owned history browser only after explicit
/// navigation`: a launcher has no History browser until its History control
/// is clicked; then the browser fills that launcher tab, and Back returns
/// to the launcher.
#[gpui::test]
fn the_history_browser_opens_only_when_asked_and_back_returns_to_the_launcher(
    cx: &mut TestAppContext,
) {
    let (workbench, launcher, cx) = compose(cx);
    let root = tempfile::tempdir().unwrap();
    launcher.update(cx, |l, cx| {
        let prefs = cx.new(|_| PreferencesStore::memory());
        l.set_preference_store(prefs, cx);
        l.show_local(root.path().to_path_buf(), cx);
    });
    let tab = workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    let draw = |cx: &mut VisualTestContext| {
        cx.run_until_parked();
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    };
    draw(cx);
    assert!(launcher.read_with(cx, |l, _| l.history.is_empty()));
    assert!(cx.debug_bounds("history-permission-allow").is_none());
    let title = |cx: &mut VisualTestContext| cx.update(|_, cx| launcher.launcher_title(tab, cx));
    let marked = |cx: &mut VisualTestContext| {
        cx.update(|_, cx| launcher.launcher_mark(tab, gpui::rgb(0), cx).is_some())
    };
    assert_eq!((title(cx), marked(cx)), (None, false));
    let open = cx.debug_bounds("launcher-history").unwrap().center();
    cx.simulate_click(open, Modifiers::none());
    draw(cx);
    let browser = launcher.read_with(cx, |l, _| l.history.get(&tab).cloned());
    assert!(cx.debug_bounds("history-permission-allow").is_some());
    assert!(cx.debug_bounds("launcher-shell").is_none());
    // The tab is titled and marked as History while it shows it.
    assert_eq!(title(cx).as_deref(), Some("Chat history"));
    assert!(marked(cx));
    assert!(workbench.read_with(cx, |w, _| w.is_launcher(root.path(), tab)));
    browser
        .expect("the browser fills the launcher tab")
        .update(cx, |_, cx| cx.emit(HistoryBrowserEvent::Back));
    draw(cx);
    assert!(launcher.read_with(cx, |l, _| l.history.is_empty()));
    assert!(cx.debug_bounds("launcher-shell").is_some());
    assert_eq!((title(cx), marked(cx)), (None, false));
}

/// `intersects discovered Agents with the Active Chat visibility settings`:
/// an Agent hidden in Settings has no launcher row even when detected; the
/// Built-in Agent is never hidden.
#[gpui::test]
fn hidden_agents_have_no_row_even_when_detected(cx: &mut TestAppContext) {
    use crate::agent::connections::legacy_runtime_registry::Runtime;
    let (workbench, launcher, cx) = compose(cx);
    launcher.update(cx, |l, cx| l.show_local(PathBuf::from("/project"), cx));
    workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    let installation = |runtime, id, label: &str| Installation {
        runtime,
        id,
        label: label.into(),
        executable: PathBuf::from(format!("/fixture/{id}")),
        chat: true,
    };
    let rows = |cx: &mut VisualTestContext| {
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        [
            "launcher-agent-claude",
            "launcher-agent-codex",
            "launcher-agent-puppyone-agent",
        ]
        .map(|selector| cx.debug_bounds(selector).is_some())
    };
    launcher.update(cx, |l, cx| {
        l.discovery_override = true;
        l.scanning = false;
        l.picker_open = Some(0);
        l.installations = vec![
            installation(Runtime::Claude, "claude", "Claude Code"),
            installation(Runtime::Codex, "codex", "Codex"),
            installation(
                Runtime::PuppyOne,
                agents::BUILT_IN_AGENT_ID,
                agents::BUILT_IN_AGENT_LABEL,
            ),
        ];
        cx.notify();
    });
    assert_eq!(rows(cx), [true, true, true]);
    launcher.update(cx, |l, cx| {
        l.set_preferences(
            vec!["claude".into(), agents::BUILT_IN_AGENT_ID.into()],
            AgentRoutingPreferences::default(),
            false,
            cx,
        );
        cx.notify();
    });
    assert_eq!(rows(cx), [false, true, true]);
}

/// What the window's keyboard focus is, by its accessible name.
fn focused_label(cx: &mut VisualTestContext) -> Option<String> {
    use gpui_kit::test::TestQueryExt as _;
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
        window
            .elements()
            .into_iter()
            .filter(|e| e.focused() == Some(true))
            .min_by_key(|e| std::cmp::Reverse(e.path().len()))
            .and_then(|e| e.label().map(str::to_owned))
    })
}
fn row_label(label: &str) -> String {
    format!(
        "{}: {label}",
        crate::localization::t("terminal.launcher.title")
    )
}

/// `returns setup focus to the launcher with installed=false|true`: when
/// setup's activation dialog closes with the keyboard in it, the keyboard
/// goes to the launcher's first usable detected Agent, else its bundled
/// one, else its heading — which is focusable but never a Tab stop.
#[gpui::test]
fn closing_setup_gives_the_keyboard_back_to_the_launcher(cx: &mut TestAppContext) {
    use crate::agent::connections::legacy_runtime_registry::Runtime;
    use crate::platform::local_agent_setup::companion::Presence;
    use crate::platform::local_agent_setup::{Observation, ObservationStatus};
    let (workbench, launcher, cx) = compose(cx);
    cx.update(|window, _| window.activate_window());
    let cursor_supported = crate::platform::local_agent_setup::route("cursor").is_some_and(|r| {
        r.platforms
            .contains(&crate::platform::local_agent_setup::platform())
    });
    let suggested = if cursor_supported { "cursor" } else { "codex" };
    cx.update(|_, cx| {
        crate::features::local_agents::activation_store(cx).update(cx, |s, cx| {
            s.fixture_companions(vec![(suggested, Presence::Present)]);
            cx.notify();
        })
    });
    launcher.update(cx, |l, cx| {
        let prefs = cx.new(|_| PreferencesStore::memory());
        prefs.update(cx, |p, _| {
            p.state.local_agents.setup_suggestions.enabled = true
        });
        l.set_preference_store(prefs, cx);
        l.show_local(PathBuf::from("/project"), cx)
    });
    workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    let hermes = agents::LOCAL_AGENTS
        .iter()
        .find(|a| a.id == "hermes")
        .unwrap();
    let built_in = Installation {
        runtime: Runtime::PuppyOne,
        id: agents::BUILT_IN_AGENT_ID,
        label: agents::BUILT_IN_AGENT_LABEL.into(),
        executable: PathBuf::new(),
        chat: true,
    };
    let heading = crate::localization::t("native.launcher.greeting").to_string();
    for (installed, bundled, expect_input) in [
        (true, true, true),
        (false, true, true),
        (false, false, false),
    ] {
        launcher.update(cx, |l, cx| {
            l.discovery_override = true;
            l.scanning = false;
            l.installations = installed
                .then(|| Installation {
                    runtime: hermes.runtime,
                    id: hermes.id,
                    label: hermes.label.into(),
                    executable: PathBuf::from("/fixture/hermes"),
                    chat: true,
                })
                .into_iter()
                .chain(bundled.then(|| built_in.clone()))
                .collect();
            l.observations = agents::LOCAL_AGENTS
                .iter()
                .map(|a| Observation {
                    id: a.id.into(),
                    status: if installed && a.id == "hermes" {
                        ObservationStatus::Found
                    } else {
                        ObservationStatus::NotFound
                    },
                    failure: None,
                })
                .collect();
            cx.notify();
        });
        cx.update(|window, cx| {
            window.blur(cx);
            window.draw(cx).clear(cx);
        });
        let activate: &'static str =
            Box::leak(format!("agent-setup-activate:{suggested}").into_boxed_str());
        let open = cx.debug_bounds(activate).expect("setup offers an Agent");
        cx.simulate_click(open.center(), Modifiers::none());
        cx.update(|window, cx| {
            window.draw(cx).clear(cx);
        });
        assert!(
            cx.update(|window, cx| window.focused(cx).is_some()),
            "the dialog has the keyboard"
        );
        let cancel = cx.debug_bounds("activation-cancel").expect("the dialog");
        cx.simulate_click(cancel.center(), Modifiers::none());
        cx.run_until_parked();
        cx.update(|window, cx| {
            window.draw(cx).clear(cx);
        });
        assert!(cx.debug_bounds("activation-cancel").is_none(), "closed");
        if expect_input {
            assert!(
                cx.update(|window, cx| {
                    launcher.read(cx).hero_inputs[&0]
                        .focus_handle(cx)
                        .contains_focused(window, cx)
                }),
                "installed={installed} bundled={bundled}: hero composer should regain focus"
            );
        } else {
            assert_eq!(
                focused_label(cx).as_deref(),
                Some(heading.as_str()),
                "installed={installed} bundled={bundled}"
            );
        }
    }
    // The heading is focusable, never a Tab stop.
    cx.update(|window, cx| {
        window.blur(cx);
        for _ in 0..12 {
            window.focus_next(cx);
            window.draw(cx).clear(cx);
        }
    });
    let mut stops = vec![];
    for _ in 0..12 {
        cx.update(|window, cx| window.focus_next(cx));
        stops.extend(focused_label(cx));
    }
    assert!(!stops.is_empty() && !stops.contains(&heading), "{stops:?}");
}

/// `delays compact feedback outside the Agent list, adds results
/// immediately, and preserves keyed focus`: the launcher's status says
/// nothing for discovery's first 200ms, then what it is doing, and that the
/// scan is complete once it finds an Agent; the status and the feedback
/// row sit outside the detected Agents' list; a found Agent shows at once,
/// and the row the keyboard is on keeps it while discovery adds an Agent
/// before it. A failed or empty scan announces nothing.
#[gpui::test]
fn discovery_keeps_a_focused_row_and_announces_when_the_scan_is_done(cx: &mut TestAppContext) {
    use crate::agent::connections::legacy_runtime_registry::Runtime;
    use crate::platform::local_agent_setup::{Observation, ObservationFailure, ObservationStatus};
    use gpui_kit::test::TestQueryExt as _;
    use std::time::{Duration, Instant};
    let (workbench, launcher, cx) = compose(cx);
    cx.update(|window, _| window.activate_window());
    launcher.update(cx, |l, cx| l.show_local(PathBuf::from("/project"), cx));
    workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    let installation = |runtime, id, label: &str| Installation {
        runtime,
        id,
        label: label.into(),
        executable: PathBuf::from(format!("/fixture/{id}")),
        chat: true,
    };
    let claude = installation(Runtime::Claude, "claude", "Claude Code");
    let codex = installation(Runtime::Codex, "codex", "Codex");
    let bundled = installation(
        Runtime::PuppyOne,
        agents::BUILT_IN_AGENT_ID,
        agents::BUILT_IN_AGENT_LABEL,
    );
    let set = |cx: &mut VisualTestContext, f: &dyn Fn(&mut WorkbenchLauncher)| {
        launcher.update(cx, |l, cx| {
            l.discovery_override = true;
            f(l);
            cx.notify();
        });
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    };
    // The launcher's status, and whether it sits in the Agent list.
    let status = |cx: &mut VisualTestContext| {
        cx.update(|window, _| {
            let found = window.find_all_by_role(Role::Status);
            assert_eq!(found.len(), 1, "one status");
            let list = ElementId::from(("launcher-agents", 0u64));
            assert!(!found[0].path().contains(&list), "outside the Agent list");
            found[0]
                .label()
                .map(str::to_owned)
                .filter(|l| !l.is_empty())
        })
    };
    let in_list = |cx: &mut VisualTestContext, label: &str| {
        cx.update(|window, _| {
            let list = ElementId::from(("launcher-agents", 0u64));
            window.find_by_label(label).path().contains(&list)
        })
    };
    let say = |key: &str| Some(crate::localization::t(key).to_string());
    set(cx, &|l| {
        l.installations = vec![bundled.clone()];
        l.observations = vec![];
        l.scanning = true;
        l.refreshing = false;
        l.picker_open = Some(0);
        l.scan_started = Some(Instant::now());
    });
    assert_eq!(status(cx), None, "nothing for the first 200ms");
    set(cx, &|l| {
        l.scan_started = Some(Instant::now() - Duration::from_millis(200));
    });
    assert_eq!(status(cx), say("terminal.launcher.detecting"));
    // The feedback row sits outside the detected Agents list.
    assert!(cx.debug_bounds("launcher-agents").is_some());
    assert!(cx.debug_bounds("launcher-discovery").is_some());
    set(cx, &|l| {
        l.installations = vec![codex.clone(), bundled.clone()]
    });
    assert!(
        in_list(cx, &row_label("Codex")),
        "found at once, in the list"
    );
    assert!(!in_list(cx, &row_label(agents::BUILT_IN_AGENT_LABEL)));
    // The keyboard moves onto Codex.
    cx.update(|window, cx| window.blur(cx));
    let mut reached = false;
    for _ in 0..16 {
        cx.update(|window, cx| window.focus_next(cx));
        if focused_label(cx) == Some(row_label("Codex")) {
            reached = true;
            break;
        }
    }
    assert!(reached, "Codex is a Tab stop");
    let announced = status(cx);
    set(cx, &|l| {
        l.installations = vec![claude.clone(), codex.clone(), bundled.clone()]
    });
    assert_eq!(focused_label(cx), Some(row_label("Codex")), "keyed focus");
    assert_eq!(status(cx), announced, "adding a row says nothing new");
    cx.update(|window, cx| window.focus_prev(cx));
    assert_eq!(focused_label(cx), Some(row_label("Claude Code")));
    cx.update(|window, cx| window.focus_next(cx));
    assert_eq!(focused_label(cx), Some(row_label("Codex")));
    set(cx, &|l| l.scanning = false);
    assert_eq!(focused_label(cx), Some(row_label("Codex")));
    assert_eq!(cx.debug_bounds("launcher-discovery"), None);
    assert_eq!(status(cx), say("terminal.launcher.detectionComplete"));
    // A failed scan, or one that found nothing, announces nothing.
    set(cx, &|l| {
        l.observations = vec![Observation {
            id: "claude".into(),
            status: ObservationStatus::Failed,
            failure: Some(ObservationFailure::Product),
        }]
    });
    assert_eq!(status(cx), None);
    set(cx, &|l| {
        l.observations = vec![Observation {
            id: "claude".into(),
            status: ObservationStatus::Unknown,
            failure: Some(ObservationFailure::EnvironmentUnavailable),
        }]
    });
    assert_eq!(status(cx), None);
    set(cx, &|l| {
        l.observations = vec![];
        l.installations = vec![bundled.clone()];
    });
    assert_eq!(status(cx), None);
}

#[gpui::test]
fn l1_composer_selects_agent_from_popover_and_focuses_prompt(cx: &mut TestAppContext) {
    use crate::agent::connections::legacy_runtime_registry::Runtime;
    crate::localization::set_current("en");
    let (workbench, launcher, cx) = compose(cx);
    cx.update(|window, _| window.activate_window());
    launcher.update(cx, |l, cx| {
        l.show_local(PathBuf::from("/project"), cx);
        l.discovery_override = true;
        l.scanning = false;
        l.installations = vec![
            Installation {
                runtime: Runtime::Claude,
                id: "claude",
                label: "Claude Code".into(),
                executable: PathBuf::from("/fixture/claude"),
                chat: true,
            },
            Installation {
                runtime: Runtime::Codex,
                id: "codex",
                label: "Codex".into(),
                executable: PathBuf::from("/fixture/codex"),
                chat: true,
            },
        ];
        cx.notify();
    });
    workbench
        .update(cx, |w, cx| w.new_launcher_tab(0, cx))
        .unwrap();
    cx.update(|w, cx| w.draw(cx).clear(cx));

    // Default active agent is the first detected local agent.
    assert_eq!(
        launcher.read_with(cx, |l, _| l.active_installation().map(|i| i.id)),
        Some("claude")
    );
    // Hero composer renders prominently without the old agent rows cluttering the stage.
    assert!(cx.debug_bounds("launcher-composer-input").is_some());
    assert!(cx.debug_bounds("launcher-agent-picker").is_some());
    assert!(cx.debug_bounds("launcher-send").is_some());
    assert!(cx.debug_bounds("launcher-agent-codex").is_none());

    // Clicking the Agent pill opens the switcher popover; picking Codex switches and focuses the input.
    let pill = cx.debug_bounds("launcher-agent-picker").unwrap().center();
    cx.simulate_click(pill, Modifiers::none());
    cx.update(|w, cx| w.draw(cx).clear(cx));
    let codex_row = cx
        .debug_bounds("launcher-agent-codex")
        .expect("Codex appears in switcher popover")
        .center();
    cx.simulate_click(codex_row, Modifiers::none());
    cx.update(|w, cx| w.draw(cx).clear(cx));

    assert_eq!(
        launcher.read_with(cx, |l, _| l.active_installation().map(|i| i.id)),
        Some("codex")
    );
    assert!(
        cx.debug_bounds("launcher-agent-popover").is_none(),
        "popover closes after picking"
    );
    assert!(
        cx.update(|window, cx| {
            launcher.read(cx).hero_inputs[&0]
                .focus_handle(cx)
                .contains_focused(window, cx)
        }),
        "picking an Agent returns focus directly to the hero prompt input"
    );
}
