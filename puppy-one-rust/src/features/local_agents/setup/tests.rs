use super::*;
use core::prelude::v1::test;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};
#[derive(Default)]
struct Fake {
    found: Mutex<Vec<String>>,
    installs: AtomicUsize,
    hold_install: AtomicBool,
}
impl activation::Ports for Fake {
    fn resolve(&self, id: &str) -> Result<bool, ErrorCode> {
        Ok(self.found.lock().unwrap().iter().any(|f| f == id))
    }
    fn install(
        &self,
        recipe: &Recipe,
        cancel: &AtomicBool,
        committed: &dyn Fn(),
    ) -> Result<(), ErrorCode> {
        self.installs.fetch_add(1, Ordering::SeqCst);
        while self.hold_install.load(Ordering::SeqCst) {
            if cancel.load(Ordering::SeqCst) {
                return Err(ErrorCode::Installation);
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        self.found.lock().unwrap().push(recipe.setup_id.into());
        committed();
        Ok(())
    }
    fn open_guide(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn refresh(&self) {}
}
#[track_caller]
fn until(cx: &mut VisualTestContext, mut done: impl FnMut(&mut VisualTestContext) -> bool) {
    for _ in 0..400 {
        cx.run_until_parked();
        if done(cx) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    panic!("condition not reached");
}
#[gpui::test]
fn an_unfinished_installation_scan_never_recommends_installing_an_agent(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let dir = tempfile::tempdir().unwrap();
    let store = cx.update(|cx| {
        install(
            dir.path().join("activation.json"),
            |_| Arc::new(Fake::default()),
            cx,
        )
    });
    store.update(cx, |s, _| {
        fixture_companions(s, vec![("codex", Presence::Present)])
    });
    let preferences = cx.new(|_| PreferencesStore::memory());
    preferences.update(cx, |p, _| {
        p.state.local_agents.setup_suggestions.enabled = true
    });
    let (section, cx) = cx.add_window_view(|_, cx| {
        SetupSection::new(
            Presentation::Launcher,
            Surface::Chat,
            preferences.clone(),
            "fixture-window".into(),
            cx,
        )
    });
    let rendered = |cx: &mut VisualTestContext| {
        cx.run_until_parked();
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        cx.debug_bounds("agent-setup-activate:codex").is_some()
    };
    assert!(!rendered(cx));
    let rows = section.update(cx, |s, cx| s.model(cx).2);
    assert!(
        rows.is_empty(),
        "an installed companion alone cannot prove its CLI is absent"
    );
    assert!(!section.update(cx, |s, cx| s.visible(cx)));
    section.update(cx, |s, cx| s.set_found(Some(vec![]), cx));
    let rows = section.update(cx, |s, cx| s.model(cx).2);
    assert_eq!(
        rows.iter().map(|e| e.setup_id).collect::<Vec<_>>(),
        vec!["codex"]
    );
    assert!(rendered(cx));
    section.update(cx, |s, cx| s.set_found(None, cx));
    assert!(!rendered(cx));
    assert!(
        section.update(cx, |s, cx| s.model(cx).2.is_empty()),
        "a rescan revokes stale absence evidence"
    );
    for presentation in [Presentation::Launcher, Presentation::Settings] {
        section.update(cx, |s, cx| {
            s.presentation = presentation;
            s.set_observations(
                vec![setup::Observation {
                    id: "codex".into(),
                    status: setup::ObservationStatus::Failed,
                    failure: Some(setup::ObservationFailure::Product),
                }],
                cx,
            );
        });
        assert!(
            !rendered(cx),
            "failed evidence does not render an install action"
        );
        section.update(cx, |s, cx| s.set_found(Some(vec![]), cx));
        assert!(
            rendered(cx),
            "a completed absence observation restores the action"
        );
        section.update(cx, |s, cx| s.set_found(Some(vec!["codex"]), cx));
        assert!(!rendered(cx), "a found CLI removes the action");
    }
    assert!(
        store.read_with(cx, |s, _| s.snapshot.operations.is_empty()),
        "inspection must not install anything"
    );
}

#[gpui::test]
fn the_setup_directory_activates_an_agent_from_its_recipe(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let dir = tempfile::tempdir().unwrap();
    let journal = dir.path().join("local-agent-activation.json");
    let store = cx.update(|cx| install(journal, |_| Arc::new(Fake::default()), cx));
    cx.update(|cx| cx.set_global(Shared(store.clone())));
    let preferences = cx.new(|_| PreferencesStore::memory());
    let (section, cx) = cx.add_window_view(|_, cx| {
        SetupSection::new(
            Presentation::Settings,
            Surface::Chat,
            preferences.clone(),
            "w".into(),
            cx,
        )
    });
    section.update(cx, |s, cx| s.set_found(Some(vec!["claude"]), cx));
    // Settings lists every Chat route of this platform.
    let entries = section.update(cx, |s, cx| s.model(cx).0);
    assert_eq!(entries.len(), if cfg!(target_os = "macos") { 8 } else { 6 });
    assert!(entries.iter().all(|e| !e.recommended));
    section.update_in(cx, |s, w, cx| s.select("codex", "Codex", w, cx));
    let dialog = section.read_with(cx, |s, _| s.dialog.clone().unwrap());
    until(cx, |cx| {
        dialog.read_with(cx, |d, _| d.plan.is_some() || d.error)
    });
    let automatic = dialog.read_with(cx, |d, _| d.plan.as_ref().unwrap().automatic);
    assert_eq!(automatic, cfg!(target_os = "macos"));
    if !automatic {
        return;
    }
    dialog.update_in(cx, |d, w, cx| d.start(w, cx));
    until(cx, |cx| {
        dialog.read_with(cx, |d, cx| {
            !d.confirming
                && d.operation(cx)
                    .is_some_and(|o| o.status == activation::Status::Ready)
        })
    });
    let op = dialog.read_with(cx, |d, cx| d.operation(cx).unwrap());
    assert_eq!(op.steps, [StepState::Complete; 3]);
    // A ready Agent is no longer pending in the section.
    section.update(cx, |s, cx| s.set_found(Some(vec!["claude", "codex"]), cx));
    assert!(section.update(cx, |s, cx| s.model(cx).1.is_empty()));
    // Close dismisses the finished operation.
    dialog.update_in(cx, |d, w, cx| {
        d.perform(
            move |store, cx| store.act(op.operation_id.clone(), Action::Dismiss, cx),
            |d, w, cx| d.close(w, cx),
            w,
            cx,
        )
    });
    until(cx, |cx| section.read_with(cx, |s, _| s.dialog.is_none()));
    assert!(store.read_with(cx, |s, _| s.snapshot.operations.is_empty()));
    store.read_with(cx, |s, _| s.service.settle_for_test());
}

#[gpui::test]
fn retired_activation_epochs_cannot_restore_stale_operations(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    let store = cx.update(|cx| {
        install(
            dir.path().join("activation.json"),
            |_| Arc::new(Fake::default()),
            cx,
        )
    });
    store.update(cx, |s, cx| {
        let snapshot = |epoch: &str, revision| Snapshot {
            epoch: epoch.into(),
            revision,
            operations: if epoch == "one" {
                vec![receipt(if revision == 5 {
                    activation::Status::Cancelled
                } else {
                    activation::Status::Installing
                })]
            } else {
                vec![]
            },
        };
        s.accept(snapshot("one", 5), cx);
        s.error = true;
        s.accept(snapshot("one", 4), cx);
        assert_eq!(s.snapshot.revision, 5);
        assert_eq!(
            s.snapshot.operations[0].status,
            activation::Status::Cancelled
        );
        assert!(
            s.error,
            "ignored evidence cannot clear a later request failure"
        );
        s.accept(snapshot("two", 0), cx);
        assert!(!s.error);
        s.accept(snapshot("one", 6), cx);
        assert_eq!(
            s.snapshot.epoch, "two",
            "a retired process cannot publish again"
        );
        s.accept(snapshot("two", 1), cx);
        assert_eq!(s.snapshot.revision, 1);
    });
}

struct UiFixture {
    _dir: tempfile::TempDir,
    section: Entity<SetupSection>,
    store: Entity<Activation>,
    ports: Arc<Fake>,
    service: activation::Service,
    preferences: Entity<PreferencesStore>,
}
impl Drop for UiFixture {
    fn drop(&mut self) {
        self.ports.hold_install.store(false, Ordering::SeqCst);
        if !std::thread::panicking() {
            self.service.settle_for_test();
        }
    }
}
fn ui(cx: &mut TestAppContext) -> (UiFixture, &mut VisualTestContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let dir = tempfile::tempdir().unwrap();
    let ports = Arc::new(Fake::default());
    let store = cx.update(|cx| install(dir.path().join("activation.json"), |_| ports.clone(), cx));
    let preferences = cx.new(|cx| PreferencesStore::isolated(dir.path().join("preferences"), cx));
    let (section, cx) = cx.add_window_view(|_, cx| {
        SetupSection::new(
            Presentation::Launcher,
            Surface::Chat,
            preferences.clone(),
            "fixture".into(),
            cx,
        )
    });
    until(cx, |cx| {
        store.read_with(cx, |s, _| {
            s.snapshot.epoch != "initial" && !s.presence.is_scanning()
        })
    });
    store.update(cx, |s, cx| {
        fixture_companions(
            s,
            vec![("codex", Presence::Present), ("cursor", Presence::Present)],
        );
        cx.notify();
    });
    section.update(cx, |s, cx| s.set_found(Some(vec![]), cx));
    until(cx, |cx| preferences.read_with(cx, |p, _| p.loaded));
    draw(cx);
    let service = store.read_with(cx, |s, _| s.service.clone());
    (
        UiFixture {
            _dir: dir,
            section,
            store,
            ports,
            service,
            preferences,
        },
        cx,
    )
}
fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}
fn has(cx: &mut VisualTestContext, selector: &'static str) -> bool {
    draw(cx);
    cx.debug_bounds(selector).is_some()
}
fn click(cx: &mut VisualTestContext, selector: &'static str) {
    draw(cx);
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing {selector}"));
    assert!(bounds.size.width > px(0.) && bounds.size.height > px(0.));
    cx.simulate_click(bounds.center(), Modifiers::none());
    draw(cx);
}
fn dialog(f: &UiFixture, cx: &mut VisualTestContext) -> Entity<ActivationDialog> {
    f.section
        .read_with(cx, |s, _| s.dialog.clone().expect("dialog opened"))
}
fn ready_plan(f: &UiFixture, cx: &mut VisualTestContext) -> Entity<ActivationDialog> {
    let d = dialog(f, cx);
    until(cx, |cx| d.read_with(cx, |d, _| d.plan.is_some()));
    draw(cx);
    d
}
fn receipt(status: activation::Status) -> Operation {
    Operation {
        operation_id: "fixture-codex".into(),
        setup_id: "codex".into(),
        display_name: "Codex".into(),
        status,
        steps: [StepState::Complete, StepState::Running, StepState::Pending],
        installed: false,
        error: None,
        updated_at: 1,
    }
}
fn publish(f: &UiFixture, op: Operation, cx: &mut VisualTestContext) {
    f.store.update(cx, |s, cx| {
        s.accept(
            Snapshot {
                epoch: s.snapshot.epoch.clone(),
                revision: s.snapshot.revision + 1,
                operations: vec![op],
            },
            cx,
        )
    });
    draw(cx);
}
#[gpui::test]
fn rendered_suggestion_toggle_preserves_other_settings_and_running_tasks(cx: &mut TestAppContext) {
    let cursor_supported = crate::platform::local_agent_setup::route("cursor").is_some_and(|r| {
        r.platforms
            .contains(&crate::platform::local_agent_setup::platform())
    });
    let (f, cx) = ui(cx);
    assert!(has(cx, "agent-setup-activate:codex"));
    assert_eq!(has(cx, "agent-setup-activate:cursor"), cursor_supported);
    f.preferences.update(cx, |p, cx| {
        p.change(
            |p| {
                p.local_agents.hidden_agent_ids = vec!["codex".into()];
                p.local_agents.chat_history_discovery = true;
            },
            cx,
        )
    });
    assert!(!has(cx, "agent-setup-activate:codex"));
    assert_eq!(has(cx, "agent-setup-activate:cursor"), cursor_supported);
    f.section.update(cx, |s, cx| {
        s.presentation = Presentation::Settings;
        cx.notify();
    });
    click(cx, "agent-setup-suggestions");
    f.preferences.read_with(cx, |p, _| {
        assert!(!p.state.local_agents.setup_suggestions.enabled);
        assert_eq!(p.state.local_agents.hidden_agent_ids, vec!["codex"]);
        assert!(p.state.local_agents.chat_history_discovery);
    });
    assert!(!has(cx, "agent-setup-activate:cursor"));
    until(cx, |cx| f.preferences.read_with(cx, |p, _| p.drained()));
    let persisted: serde_json::Value = serde_json::from_slice(
        &std::fs::read(f._dir.path().join("preferences/preferences.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        persisted["local_agents"]["setup_suggestions"]["enabled"],
        false
    );
    assert_eq!(
        persisted["local_agents"]["hidden_agent_ids"],
        serde_json::json!(["codex"])
    );
    assert_eq!(persisted["local_agents"]["chat_history_discovery"], true);
    publish(&f, receipt(activation::Status::Installing), cx);
    assert!(has(cx, "agent-setup-view:codex"));
    assert!(has(cx, "agent-setup-stop:codex"));
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 0);
}
#[gpui::test]
fn discovered_clis_override_every_stale_activation_receipt_in_the_rendered_launcher(
    cx: &mut TestAppContext,
) {
    let (f, cx) = ui(cx);
    for status in [
        activation::Status::Installing,
        activation::Status::Cancelled,
        activation::Status::Failed,
        activation::Status::Interrupted,
        activation::Status::Ready,
    ] {
        f.section.update(cx, |s, cx| s.set_found(Some(vec![]), cx));
        publish(&f, receipt(status), cx);
        f.section
            .update(cx, |s, cx| s.set_found(Some(vec!["codex", "cursor"]), cx));
        for selector in [
            "agent-setup-activate:codex",
            "agent-setup-activate:cursor",
            "agent-setup-view:codex",
            "agent-setup-stop:codex",
        ] {
            assert!(!has(cx, selector), "{status:?}: {selector}");
        }
    }
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 0);
}
#[gpui::test]
fn missing_companions_do_not_render_activation_suggestions(cx: &mut TestAppContext) {
    let (f, cx) = ui(cx);
    f.store.update(cx, |s, cx| {
        fixture_companions(
            s,
            vec![("codex", Presence::NotFound), ("cursor", Presence::Unknown)],
        );
        cx.notify();
    });
    assert!(!has(cx, "agent-setup-activate:codex"));
    assert!(!has(cx, "agent-setup-activate:cursor"));
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 0);
}
#[cfg(target_os = "macos")]
#[gpui::test]
fn actual_activation_clicks_require_consent_and_reopen_the_same_background_operation(
    cx: &mut TestAppContext,
) {
    let (f, cx) = ui(cx);
    f.ports.hold_install.store(true, Ordering::SeqCst);
    click(cx, "agent-setup-activate:codex");
    let d = ready_plan(&f, cx);
    assert!(d.read_with(cx, |d, _| d.plan.as_ref().unwrap().automatic));
    assert!(has(
        cx,
        "activation-copy:Puppyone will install the Codex CLI in the background. Once installed, it is activated. You may need to sign in when you first use it. An existing installation will be reused."
    ));
    assert!(has(
        cx,
        "activation-copy:Closing this window lets the task continue in the background."
    ));
    for step in [
        "activation-step:prepare",
        "activation-step:install",
        "activation-step:verify",
    ] {
        assert!(has(cx, step));
    }
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 0);
    assert!(
        f.store
            .read_with(cx, |s, _| s.snapshot.operations.is_empty())
    );
    click(cx, "activation-start");
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot
                .operations
                .first()
                .is_some_and(|o| o.status == activation::Status::Installing)
        })
    });
    let id = f
        .store
        .read_with(cx, |s, _| s.snapshot.operations[0].operation_id.clone());
    click(cx, "activation-close");
    assert!(f.section.read_with(cx, |s, _| s.dialog.is_none()));
    assert!(f.store.read_with(cx, |s, _| s.snapshot.operations[0].status
        == activation::Status::Installing));
    click(cx, "agent-setup-view:codex");
    let reopened = dialog(&f, cx);
    assert!(!reopened.read_with(cx, |d, _| d.confirming));
    assert_eq!(
        reopened.read_with(cx, |d, cx| d.operation(cx).unwrap().operation_id),
        id
    );
    click(cx, "activation-stop");
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot.operations[0].status == activation::Status::Cancelled
        })
    });
    assert!(has(cx, "activation-copy:Stopped"));
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 1);
}
#[gpui::test]
fn retained_installation_retry_gets_a_fresh_plan_without_starting_again(cx: &mut TestAppContext) {
    let (f, cx) = ui(cx);
    let mut op = receipt(activation::Status::Cancelled);
    op.installed = true;
    publish(&f, op, cx);
    click(cx, "agent-setup-view:codex");
    assert!(has(cx, "activation-copy:The installed CLI has been kept."));
    click(cx, "activation-retry");
    let d = ready_plan(&f, cx);
    assert!(d.read_with(cx, |d, _| d.confirming));
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.store
            .read_with(cx, |s, _| s.snapshot.operations[0].status),
        activation::Status::Cancelled
    );
}

#[gpui::test]
fn guided_activation_clicks_use_the_official_flow_without_automatic_installation_copy(
    cx: &mut TestAppContext,
) {
    let (f, cx) = ui(cx);
    f.section.update(cx, |s, cx| {
        s.presentation = Presentation::Settings;
        cx.notify();
    });
    click(cx, "agent-setup-directory");
    click(cx, "agent-setup-entry:claude");
    let d = ready_plan(&f, cx);
    d.read_with(cx, |d, _| {
        assert!(!d.plan.as_ref().unwrap().automatic);
        assert!(d.plan.as_ref().unwrap().version.is_none());
    });
    assert!(has(
        cx,
        "activation-copy:This Agent uses its official setup flow. Puppyone will guide you there and check the installation when you return. Sign-in and model setup are checked when you start the Agent."
    ));
    assert!(!has(
        cx,
        "activation-copy:Puppyone will install the Claude Code CLI in the background. Once installed, it is activated. You may need to sign in when you first use it. An existing installation will be reused."
    ));
    assert!(
        f.store
            .read_with(cx, |s, _| s.snapshot.operations.is_empty())
    );
    click(cx, "activation-start");
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot
                .operations
                .first()
                .is_some_and(|o| o.status == activation::Status::SetupRequired)
        })
    });
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 0);
    assert!(has(cx, "activation-guide"));
    assert!(has(cx, "activation-check"));
    f.ports.found.lock().unwrap().push("claude".into());
    click(cx, "activation-check");
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot.operations[0].status == activation::Status::Ready
        })
    });
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 0);
}
#[cfg(target_os = "macos")]
#[gpui::test]
fn completed_activation_removes_its_row_and_the_actual_close_button_dismisses_the_dialog(
    cx: &mut TestAppContext,
) {
    let (f, cx) = ui(cx);
    f.ports.hold_install.store(true, Ordering::SeqCst);
    click(cx, "agent-setup-activate:codex");
    ready_plan(&f, cx);
    click(cx, "activation-start");
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot
                .operations
                .first()
                .is_some_and(|o| o.status == activation::Status::Installing)
        })
    });
    f.section
        .update(cx, |s, cx| s.set_found(Some(vec!["codex"]), cx));
    f.ports.hold_install.store(false, Ordering::SeqCst);
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot.operations[0].status == activation::Status::Ready
        })
    });
    assert!(has(cx, "activation-copy:Activated"));
    assert!(!has(cx, "agent-setup-view:codex"));
    assert!(!has(cx, "agent-setup-stop:codex"));
    assert!(!has(cx, "activation-stop"));
    click(cx, "activation-close");
    until(cx, |cx| f.section.read_with(cx, |s, _| s.dialog.is_none()));
    assert!(
        f.store
            .read_with(cx, |s, _| s.snapshot.operations.is_empty())
    );
    assert_eq!(f.ports.installs.load(Ordering::SeqCst), 1);
}
#[gpui::test]
fn pending_activation_requests_keep_stop_and_close_clickable(cx: &mut TestAppContext) {
    let (f, cx) = ui(cx);
    f.section.update(cx, |s, cx| {
        s.presentation = Presentation::Settings;
        cx.notify();
    });
    click(cx, "agent-setup-directory");
    click(cx, "agent-setup-entry:claude");
    ready_plan(&f, cx);
    click(cx, "activation-start");
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot
                .operations
                .first()
                .is_some_and(|o| o.status == activation::Status::SetupRequired)
        })
    });
    let d = dialog(&f, cx);
    let (release, wait) = async_channel::bounded::<()>(1);
    d.update_in(cx, |d, w, cx| {
        d.perform(
            move |_, cx| {
                cx.background_spawn(async move {
                    wait.recv().await.unwrap();
                    Ok(())
                })
            },
            |_, _, _| {},
            w,
            cx,
        )
    });
    assert!(d.read_with(cx, |d, _| d.busy));
    click(cx, "activation-stop");
    until(cx, |cx| {
        f.store.read_with(cx, |s, _| {
            s.snapshot.operations[0].status == activation::Status::Cancelled
        })
    });
    click(cx, "activation-close");
    until(cx, |cx| f.section.read_with(cx, |s, _| s.dialog.is_none()));
    release.try_send(()).unwrap();
    draw(cx);
    assert!(
        f.section.read_with(cx, |s, _| s.dialog.is_none()),
        "a late request must not reopen a closed dialog"
    );
}

#[gpui::test]
fn closing_a_native_window_revokes_only_its_plans_and_keeps_application_work(
    cx: &mut TestAppContext,
) {
    struct Empty;
    impl Render for Empty {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
        }
    }
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    let store = cx.update(|cx| {
        install(
            dir.path().join("activation.json"),
            |_| Arc::new(Fake::default()),
            cx,
        )
    });
    let service = store.read_with(cx, |s, _| s.service.clone());
    let first = cx.add_window(|_, _| Empty);
    let second = cx.add_window(|_, _| Empty);
    let owner = |window: WindowHandle<Empty>| format!("window:{:?}", window.window_id());
    let first_plan = service
        .plan(&owner(first), "claude", Surface::Chat)
        .unwrap();
    let second_plan = service
        .plan(&owner(second), "opencode", Surface::Chat)
        .unwrap();
    service.start(&owner(first), &first_plan.plan_id).unwrap();
    service.settle_for_test();
    first
        .update(cx, |_, window, _| window.remove_window())
        .unwrap();
    cx.run_until_parked();
    assert_eq!(
        service.start(&owner(first), &first_plan.plan_id),
        Err(ErrorCode::Unsupported)
    );
    assert_eq!(
        service.read().unwrap().operations[0].status,
        activation::Status::SetupRequired
    );
    service.start(&owner(second), &second_plan.plan_id).unwrap();
    service.settle_for_test();
    assert_eq!(service.read().unwrap().operations.len(), 2);
    second
        .update(cx, |_, window, _| window.remove_window())
        .unwrap();
    cx.run_until_parked();
    assert_eq!(
        service.start(&owner(second), &second_plan.plan_id),
        Err(ErrorCode::Unsupported)
    );
    // Closing even the last native window is not application disposal.
    assert!(service.plan("next-window", "codex", Surface::Chat).is_ok());
    cx.update(App::shutdown);
    assert_eq!(
        service.plan("after-quit", "codex", Surface::Chat),
        Err(ErrorCode::Interrupted)
    );
    service.settle_for_test();
}

#[gpui::test]
fn explicit_companion_refresh_during_a_scan_runs_one_latest_follow_up(cx: &mut TestAppContext) {
    let (f, cx) = ui(cx);
    let calls = Arc::new(AtomicUsize::new(0));
    let (first_tx, first_rx) = async_channel::bounded(1);
    let (second_tx, second_rx) = async_channel::bounded(1);
    let reads = [first_rx, second_rx];
    let count = calls.clone();
    f.store.update(cx, |s, cx| {
        s.presence = companion::session::Session::default();
        s.scanner = Arc::new(move |_| {
            let index = count.fetch_add(1, Ordering::SeqCst);
            let receive = reads[index].clone();
            Box::pin(async move { receive.recv().await.unwrap() })
        });
        s.companions(cx);
    });
    cx.run_until_parked();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    f.store.update(cx, |s, cx| {
        s.rescan_companions(cx);
        s.rescan_companions(cx);
        assert!(s.companions(cx).is_empty());
    });
    first_tx
        .try_send(vec![("codex", Presence::Present)])
        .unwrap();
    cx.run_until_parked();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "refresh must survive the in-flight scan"
    );
    assert!(
        f.store.update(cx, |s, cx| s.companions(cx)).is_empty(),
        "first generation cannot revive stale recommendations"
    );
    second_tx
        .try_send(vec![("codex", Presence::NotFound)])
        .unwrap();
    cx.run_until_parked();
    assert_eq!(
        f.store.update(cx, |s, cx| s.companions(cx)),
        vec![("codex", Presence::NotFound)]
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

fn fixture_companions(store: &mut Activation, values: Vec<(&'static str, Presence)>) {
    store.fixture_companions(values);
}

#[gpui::test]
fn closing_the_last_native_setup_window_cancels_pending_evidence_but_preserves_completed_cache(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let dir = tempfile::tempdir().unwrap();
    let store = cx.update(|cx| {
        install(
            dir.path().join("activation.json"),
            |_| Arc::new(Fake::default()),
            cx,
        )
    });
    let preferences = cx.new(|_| PreferencesStore::memory());
    preferences.update(cx, |p, _| {
        p.state.local_agents.setup_suggestions.enabled = true
    });
    let first = cx.add_window(|window, cx| {
        SetupSection::new(
            Presentation::Settings,
            Surface::Chat,
            preferences.clone(),
            crate::features::agent_presence::owner(window),
            cx,
        )
    });
    let second = cx.add_window(|window, cx| {
        SetupSection::new(
            Presentation::Settings,
            Surface::Chat,
            preferences.clone(),
            crate::features::agent_presence::owner(window),
            cx,
        )
    });
    // Keep entities alive: the native close hook, not final Rust Drop, must release
    // their ownership. Two views must share one application-scoped scan.
    let held_first = first.update(cx, |_, _, cx| cx.entity()).unwrap();
    let held_second = second.update(cx, |_, _, cx| cx.entity()).unwrap();
    let (release, gate) = async_channel::bounded(1);
    let calls = Arc::new(AtomicUsize::new(0));
    let signals = Arc::new(Mutex::new(Vec::new()));
    let count = calls.clone();
    let captured = signals.clone();
    store.update(cx, |s, cx| {
        fixture_companions(s, vec![("codex", Presence::Present)]);
        s.scanner = Arc::new(move |cancel| {
            count.fetch_add(1, Ordering::SeqCst);
            captured.lock().unwrap().push(cancel);
            let gate = gate.clone();
            Box::pin(async move { gate.recv().await.unwrap() })
        });
        s.rescan_companions(cx);
        s.rescan_companions(cx);
    });
    cx.run_until_parked();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    first
        .update(cx, |_, window, _| window.remove_window())
        .unwrap();
    cx.run_until_parked();
    assert!(!signals.lock().unwrap()[0].load(Ordering::Relaxed));
    second
        .update(cx, |_, window, _| window.remove_window())
        .unwrap();
    cx.run_until_parked();
    assert!(signals.lock().unwrap()[0].load(Ordering::Relaxed));
    release
        .try_send(vec![("codex", Presence::NotFound)])
        .unwrap();
    cx.run_until_parked();
    store.read_with(cx, |s, _| {
        assert!(s.presence_clients.is_empty());
        assert_eq!(
            s.presence.current().unwrap().1,
            &vec![("codex", Presence::Present)]
        );
    });
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "closing last window cancels the queued scan too"
    );
    drop((held_first, held_second));
    cx.run_until_parked();
}

#[gpui::test]
fn disabling_the_last_enabled_view_cancels_scanning_and_unknown_is_not_retried_on_render(
    cx: &mut TestAppContext,
) {
    let (f, cx) = ui(cx);
    let (release, gate) = async_channel::bounded(1);
    let signals = Arc::new(Mutex::new(Vec::new()));
    let captured = signals.clone();
    f.store.update(cx, |s, cx| {
        s.scanner = Arc::new(move |cancel| {
            let mut signals = captured.lock().unwrap();
            let index = signals.len();
            signals.push(cancel);
            let gate = gate.clone();
            Box::pin(async move {
                if index == 0 {
                    gate.recv().await.unwrap()
                } else {
                    vec![("codex", Presence::Unknown), ("cursor", Presence::Unknown)]
                }
            })
        });
        s.rescan_companions(cx);
    });
    cx.run_until_parked();
    f.preferences.update(cx, |p, cx| {
        p.change(|p| p.local_agents.setup_suggestions.enabled = false, cx)
    });
    cx.run_until_parked();
    assert!(signals.lock().unwrap()[0].load(Ordering::Relaxed));
    release
        .try_send(vec![("codex", Presence::NotFound)])
        .unwrap();
    cx.run_until_parked();
    assert_eq!(signals.lock().unwrap().len(), 1);
    f.preferences.update(cx, |p, cx| {
        p.change(|p| p.local_agents.setup_suggestions.enabled = true, cx)
    });
    for _ in 0..4 {
        draw(cx);
    }
    assert_eq!(signals.lock().unwrap().len(), 2);
    assert!(f.section.update(cx, |s, cx| s.model(cx).2).is_empty());
    assert!(f.store.read_with(cx, |s, _| {
        s.presence
            .current()
            .unwrap()
            .1
            .iter()
            .all(|(_, p)| *p == Presence::Unknown)
    }));
}

#[gpui::test]
fn companion_cache_survives_view_replacement_and_application_shutdown_revokes_it(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let dir = tempfile::tempdir().unwrap();
    let store = cx.update(|cx| {
        install(
            dir.path().join("activation.json"),
            |_| Arc::new(Fake::default()),
            cx,
        )
    });
    let preferences = cx.new(|_| PreferencesStore::memory());
    preferences.update(cx, |p, _| {
        p.state.local_agents.setup_suggestions.enabled = true
    });
    store.update(cx, |s, _| {
        fixture_companions(s, vec![("codex", Presence::Present)]);
        s.scanner = Arc::new(|_| panic!("mounting a view must not rescan completed evidence"));
    });
    for _ in 0..3 {
        let window = cx.add_window(|window, cx| {
            SetupSection::new(
                Presentation::Settings,
                Surface::Chat,
                preferences.clone(),
                crate::features::agent_presence::owner(window),
                cx,
            )
        });
        window
            .update(cx, |s, _, cx| {
                s.set_found(Some(vec![]), cx);
                assert_eq!(s.model(cx).2[0].setup_id, "codex");
            })
            .unwrap();
        window
            .update(cx, |_, window, _| window.remove_window())
            .unwrap();
        cx.run_until_parked();
        assert!(store.read_with(cx, |s, _| s.presence.current().is_some()));
    }
    cx.update(App::shutdown);
    assert!(store.read_with(cx, |s, _| s.presence.current().is_none()));
}
