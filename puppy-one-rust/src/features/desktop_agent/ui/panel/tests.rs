//! The Agent panel over a recorded conversation (the pixel lab's fixture).
use super::AgentChatTabPanel;
use crate::agent::contract::protocol::AgentOperation;
use core::prelude::v1::test;
use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update(|window, cx| window.draw(cx).clear(cx));
    }
}

/// `Agent degraded-completion recovery`: a turn that ended degraded offers
/// one explicit continuation and, on request, provider-neutral details
/// (its code, scope, connection and side effects).
#[gpui::test]
fn a_degraded_turn_offers_details_and_one_continuation(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (_panel, cx) = cx
        .add_window_view(|window, cx| AgentChatTabPanel::lab_fixture("chat-degraded", window, cx));
    draw(cx);
    assert!(
        cx.debug_bounds("agent-recovery-degraded").is_some(),
        "the recovery"
    );
    assert!(
        cx.debug_bounds("agent-recovery-detail:CURSOR_HTTP2_STREAM_CANCEL")
            .is_none(),
        "details stay folded"
    );
    let details = cx.debug_bounds("agent-recovery-details").unwrap();
    cx.simulate_click(details.center(), Modifiers::default());
    draw(cx);
    assert!(
        cx.debug_bounds("agent-recovery-detail:CURSOR_HTTP2_STREAM_CANCEL")
            .is_some()
    );
    let connected = crate::localization::t("agent.recovery.degraded.transport.healthy");
    let connected: &'static str =
        Box::leak(format!("agent-recovery-detail:{connected}").into_boxed_str());
    assert!(cx.debug_bounds(connected).is_some());
    assert!(cx.debug_bounds("agent-recovery-continue").is_some());
}

type Asked = std::rc::Rc<std::cell::RefCell<Vec<AgentOperation>>>;

/// A presented fresh chat over the fixture runtime (see `seeded_fixture`),
/// drawn until it settles.
fn seeded<'a>(
    cx: &'a mut TestAppContext,
    ready: bool,
    offline: Option<&'static str>,
    prompt: &'static str,
) -> (Entity<AgentChatTabPanel>, Asked, &'a mut VisualTestContext) {
    let slot = std::rc::Rc::new(std::cell::RefCell::new(None));
    let kept = slot.clone();
    let (panel, cx) = cx.add_window_view(|window, cx| {
        let (panel, asked) = AgentChatTabPanel::seeded_fixture(ready, offline, prompt, window, cx);
        *kept.borrow_mut() = Some(asked);
        panel
    });
    let asked = slot.borrow().clone().unwrap();
    panel.update_in(cx, |p, window, cx| {
        p.set_presentation(true, true, window, cx)
    });
    draw(cx);
    draw(cx);
    (panel, asked, cx)
}

fn focus_composer(panel: &Entity<AgentChatTabPanel>, cx: &mut VisualTestContext) {
    panel.update_in(cx, |p, window, cx| {
        let composer = p.composer.clone();
        composer.update(cx, |c, cx| c.focus(window, cx));
    });
}

/// `Agent initial prompt handoff and one-shot auto-submit`: a chat created
/// with a prompt sends it once when it settles ready; over a runtime that
/// is not ready it keeps the prompt as a draft and never sends it later.
#[gpui::test]
fn a_seeded_prompt_sends_once_when_ready_and_otherwise_stays_a_draft(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    for ready in [true, false] {
        let (panel, asked, cx) = seeded(cx, ready, None, "Summarize Q4 metrics");
        let starts = || {
            asked
                .borrow()
                .iter()
                .filter(|op| **op == AgentOperation::StartTurn)
                .count()
        };
        let (draft, pending) = panel.read_with(cx, |p, _| {
            (
                p.controller.get_snapshot().draft,
                p.controller.has_pending_initial_auto_submit(),
            )
        });
        assert!(!pending, "ready={ready}: armed once only");
        if ready {
            assert_eq!(starts(), 1, "sent once");
        } else {
            assert_eq!(starts(), 0, "never sent");
            assert_eq!(draft, "Summarize Q4 metrics", "kept as the draft");
        }
    }
}

/// `keeps display recovery and termination actionable when automatic /
/// paused / exhausted`; `keeps silent recovery invisible and uses a compact
/// reconnecting status before escalation`.
#[gpui::test]
fn display_recovery_stays_actionable_and_quiet_until_it_escalates(cx: &mut TestAppContext) {
    use crate::features::desktop_agent::application::agent_controller_state::{
        AgentDisplayRecovery, AgentDisplayRecoveryCause as Cause,
        AgentDisplayRecoveryPolicy as Policy, AgentDisplayRecoveryStage as Stage, StatePatch,
    };
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (panel, cx) =
        cx.add_window_view(|window, cx| AgentChatTabPanel::lab_fixture("chat-empty", window, cx));
    draw(cx);
    let recover = |cx: &mut VisualTestContext, policy, stage| {
        panel.update(cx, |p, cx| {
            p.controller
                .store()
                .patch(
                    StatePatch::new().display_recovery(Some(AgentDisplayRecovery {
                        policy,
                        stage,
                        cause: Cause::RevisionGap,
                        attempt: 2,
                        max_attempts: 5,
                    })),
                );
            cx.notify();
        });
        draw(cx);
    };
    let stale = crate::localization::t("agent.lifecycle.displayStale");
    let stale: &'static str = Box::leak(format!("agent-status:{stale}").into_boxed_str());
    for (policy, stage) in [
        (Policy::Automatic, Stage::Degraded),
        (Policy::Paused, Stage::ActionRequired),
        (Policy::Exhausted, Stage::ActionRequired),
    ] {
        recover(cx, policy, stage);
        assert!(cx.debug_bounds(stale).is_some(), "{policy:?}");
        assert!(
            cx.debug_bounds("agent-retry-display").is_some(),
            "{policy:?}"
        );
        assert!(
            cx.debug_bounds("agent-manage-executions").is_some(),
            "{policy:?}"
        );
        assert_eq!(
            cx.debug_bounds("agent-pause-display").is_some(),
            policy == Policy::Automatic,
            "{policy:?}"
        );
    }
    recover(cx, Policy::Automatic, Stage::Degraded);
    let attempt = crate::localization::tf(
        "agent.lifecycle.retryProgress",
        &[
            ("attempt", crate::localization::Arg::Number(2)),
            ("maximum", crate::localization::Arg::Number(5)),
        ],
    );
    assert!(attempt.contains("attempt 2 of 5"));
    let attempt: &'static str =
        Box::leak(format!("agent-status-detail:{attempt}").into_boxed_str());
    assert!(cx.debug_bounds(attempt).is_some());
    recover(cx, Policy::Automatic, Stage::Silent);
    assert!(
        cx.debug_bounds(stale).is_none(),
        "silent recovery stays invisible"
    );
    assert!(cx.debug_bounds("agent-status-reconnecting").is_none());
    recover(cx, Policy::Automatic, Stage::Reconnecting);
    assert!(cx.debug_bounds("agent-status-reconnecting").is_some());
    assert!(
        cx.debug_bounds("agent-retry-display").is_none(),
        "no actions yet"
    );
}

/// `Agent failure presentation`: `distinguishes preparation failure from
/// confirmed exit` — a session that failed to prepare needs attention and
/// offers Retry; one whose runtime exited is disconnected and offers
/// Reconnect.
#[gpui::test]
fn a_failed_preparation_needs_attention_and_an_exit_offers_reconnect(cx: &mut TestAppContext) {
    use crate::features::desktop_agent::application::agent_controller_state::{
        AgentControllerPhase, StatePatch,
    };
    use crate::features::desktop_agent::application::agent_error::create_agent_error;
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let codex = crate::localization::bidi_isolate("Codex");
    for (phase, code, heading, action) in [
        (
            AgentControllerPhase::Failed,
            "session-prepare-failed",
            "{agent} needs attention",
            "Retry",
        ),
        (
            AgentControllerPhase::RuntimeExited,
            "session-ended",
            "{agent} disconnected",
            "Reconnect",
        ),
    ] {
        let (panel, cx) = cx
            .add_window_view(|window, cx| AgentChatTabPanel::lab_fixture("chat-empty", window, cx));
        draw(cx);
        panel.update(cx, |p, cx| {
            p.controller.store().patch(
                StatePatch::new()
                    .phase(phase)
                    .error(Some(create_agent_error(code, None))),
            );
            cx.notify();
        });
        draw(cx);
        let heading = heading.replace("{agent}", &codex);
        let card: &'static str = Box::leak(format!("agent-status:{heading}").into_boxed_str());
        assert!(cx.debug_bounds(card).is_some(), "{phase:?}");
        let button: &'static str =
            Box::leak(format!("agent-readiness-retry:{action}").into_boxed_str());
        assert!(cx.debug_bounds(button).is_some(), "{phase:?}");
    }
}

/// `owns incompatible-engine recovery instead of asking users to update
/// OpenCode`: an incompatible engine reads as an update for the runtime with
/// the backend's own guidance, its status code behind Diagnostics and a retry;
/// the composer still takes the draft.
#[gpui::test]
fn an_incompatible_engine_offers_its_recovery_and_keeps_the_draft_editable(
    cx: &mut TestAppContext,
) {
    use crate::features::desktop_agent::application::agent_controller_state::StatePatch;
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let message = "The configured Agent engine is incompatible with this PuppyOne build. \
                   Use PuppyOne's managed engine, then retry.";
    let (panel, cx) =
        cx.add_window_view(|window, cx| AgentChatTabPanel::lab_fixture("chat-empty", window, cx));
    draw(cx);
    panel.update(cx, |p, cx| {
        let mut inspection = p.controller.get_snapshot().inspection.unwrap();
        let readiness = inspection.readiness.as_mut().unwrap();
        readiness.status = "unsupported-version".into();
        readiness.code = "RUNTIME_VERSION_UNSUPPORTED".into();
        readiness.message = message.into();
        p.controller
            .store()
            .patch(StatePatch::new().inspection(Some(inspection)));
        cx.notify();
    });
    draw(cx);
    let heading = format!(
        "agent-status:Update {}",
        crate::localization::bidi_isolate("Codex")
    );
    assert!(
        cx.debug_bounds(Box::leak(heading.into_boxed_str()))
            .is_some()
    );
    let detail = format!("agent-status-detail:{message}");
    assert!(
        cx.debug_bounds(Box::leak(detail.into_boxed_str()))
            .is_some()
    );
    assert!(cx.debug_bounds("agent-readiness-retry:Retry").is_some());
    let code = "agent-diagnostic:Status code: RUNTIME_VERSION_UNSUPPORTED";
    assert!(cx.debug_bounds(code).is_none(), "folded until asked");
    let toggle = cx.debug_bounds("agent-diagnostics").unwrap();
    cx.simulate_click(toggle.center(), Modifiers::default());
    draw(cx);
    assert!(cx.debug_bounds(code).is_some());

    focus_composer(&panel, cx);
    cx.simulate_input("keep this draft");
    draw(cx);
    let draft = panel.read_with(cx, |p, _| p.controller.get_snapshot().draft);
    assert_eq!(draft, "keep this draft");
}

/// `keeps discovery failure visible and blocks session preparation`: the
/// failure reads in the panel instead of the empty chat, its message under
/// Diagnostics, and a typed prompt neither prepares a session nor sends.
#[gpui::test]
fn a_discovery_failure_stays_visible_and_prepares_nothing(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (panel, asked, cx) = seeded(cx, true, Some("Discovery offline"), "");
    // No runtime was discovered, so the heading names the Agent in general.
    let heading = format!(
        "agent-status:{} needs attention",
        crate::localization::bidi_isolate("Agent")
    );
    assert!(
        cx.debug_bounds(Box::leak(heading.into_boxed_str()))
            .is_some()
    );
    assert!(cx.debug_bounds("agent-empty-state").is_none());
    let toggle = cx.debug_bounds("agent-diagnostics").unwrap();
    cx.simulate_click(toggle.center(), Modifiers::default());
    draw(cx);
    assert!(
        cx.debug_bounds("agent-diagnostic:Discovery offline")
            .is_some()
    );
    focus_composer(&panel, cx);
    cx.simulate_input("hello");
    cx.simulate_keystrokes("enter");
    draw(cx);
    assert_eq!(*asked.borrow(), [AgentOperation::DiscoverRuntimes]);
    assert_eq!(
        panel.read_with(cx, |p, _| p.controller.get_snapshot().draft),
        "hello"
    );
}

/// `keeps the first draft through sign-in, grants access without checkout,
/// and sends only on the next click`: sending before PuppyOne compute is
/// usable asks to sign in (in the browser) instead of preparing a session; while compute
/// connects and once it is ready the draft stays unsent, and the next send
/// runs it once.
#[gpui::test]
fn first_use_compute_keeps_the_draft_until_the_next_send(cx: &mut TestAppContext) {
    use super::compute::{ComputeSnapshot, ManagedCompute};
    use std::{cell::Cell, collections::HashMap, rc::Rc};
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let draft = "Help me with this local project";
    let available = Rc::new(Cell::new(false));
    let slot = Rc::new(std::cell::RefCell::new(None));
    let (panel, cx) = cx.add_window_view(|window, cx| {
        let (panel, asked) = AgentChatTabPanel::managed_fixture(available.clone(), window, cx);
        *slot.borrow_mut() = Some(asked);
        panel
    });
    let asked = slot.borrow().clone().unwrap();
    let wallet = crate::features::model_connections::compute_support::world(false);
    let hooks = crate::features::model_connections::compute_support::hooks(&wallet);
    cx.update(|_, cx| crate::features::model_connections::install_compute(hooks, cx));
    let compute =
        |revision: &str, signed_in: bool, ready: bool, reason: &'static str| ComputeSnapshot {
            revision: revision.into(),
            sources: if ready {
                HashMap::from([("mc_paid".to_string(), "managed")])
            } else {
                HashMap::new()
            },
            managed: Some(ManagedCompute {
                signed_in,
                available: ready,
                reason,
                ..Default::default()
            }),
        };
    let asked_for = |op: AgentOperation| asked.borrow().iter().filter(|o| **o == op).count();
    panel.update_in(cx, |p, window, cx| {
        p.set_presentation(true, true, window, cx);
        p.set_payments(true, cx);
        p.apply_compute(compute("100", false, false, "sign-in-required"), cx);
    });
    draw(cx);
    assert!(
        cx.debug_bounds("agent-compute-sign-in").is_none(),
        "asked only on send"
    );
    let send = |panel: &Entity<AgentChatTabPanel>, cx: &mut VisualTestContext| {
        focus_composer(panel, cx);
        cx.simulate_keystrokes("enter");
        draw(cx);
    };
    focus_composer(&panel, cx);
    cx.simulate_input(draft);
    send(&panel, cx);
    assert!(cx.debug_bounds("agent-compute-sign-in").is_some());
    assert_eq!(asked_for(AgentOperation::StartTurn), 0);
    assert_eq!(asked_for(AgentOperation::CreateSession), 0);

    let opened = Rc::new(Cell::new(0));
    let count = opened.clone();
    cx.update(|_, cx| {
        cx.subscribe(&panel, move |_, event, _| {
            if matches!(event, super::AgentChatPanelEvent::OpenAccount) {
                count.set(count.get() + 1);
            }
        })
        .detach()
    });
    let sign_in = cx.debug_bounds("agent-compute-sign-in").unwrap();
    cx.simulate_click(sign_in.center(), Modifiers::default());
    draw(cx);
    // `managed({action: "sign-in"})`: the browser sign-in, from Chat.
    assert_eq!(wallet.lock().unwrap().sign_ins, 1, "the browser sign-in");
    assert_eq!(opened.get(), 0, "not the account page");
    assert_eq!(asked_for(AgentOperation::StartTurn), 0);

    panel.update(cx, |p, cx| {
        p.apply_compute(compute("101", true, false, "loading"), cx)
    });
    draw(cx);
    assert!(cx.debug_bounds("agent-compute-connecting").is_some());
    let kept = |panel: &Entity<AgentChatTabPanel>, cx: &mut VisualTestContext| {
        panel.read_with(cx, |p, _| p.controller.get_snapshot().draft)
    };
    assert_eq!(kept(&panel, cx), draft);
    assert_eq!(asked_for(AgentOperation::StartTurn), 0);

    available.set(true);
    panel.update(cx, |p, cx| {
        p.apply_compute(compute("102", true, true, "ready"), cx)
    });
    draw(cx);
    draw(cx);
    assert!(cx.debug_bounds("agent-compute-sign-in").is_none());
    assert!(cx.debug_bounds("agent-compute-connecting").is_none());
    assert_eq!(kept(&panel, cx), draft);
    assert_eq!(
        asked_for(AgentOperation::StartTurn),
        0,
        "never sent on its own"
    );

    send(&panel, cx);
    assert_eq!(asked_for(AgentOperation::StartTurn), 1);
}

/// `keeps the empty-chat identity visible while the composer only contains
/// an unsent draft`.
#[gpui::test]
fn an_unsent_draft_keeps_the_empty_chat(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (panel, _, cx) = seeded(cx, true, None, "");
    assert!(cx.debug_bounds("agent-empty-state").is_some());
    focus_composer(&panel, cx);
    cx.simulate_input("This is still only a draft");
    draw(cx);
    assert!(cx.debug_bounds("agent-empty-state").is_some());
}

/// `uses one centered product loader while the chat runtime starts`: while
/// the runtime is discovered the chat is one centered loader with no status
/// or dock; once it is ready the dock and composer arrive and the loader
/// goes.
#[gpui::test]
fn startup_is_one_centered_loader_until_the_runtime_is_ready(cx: &mut TestAppContext) {
    use crate::features::desktop_agent::application::agent_controller_state::{
        AgentControllerPhase, StatePatch,
    };
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (panel, _, cx) = seeded(cx, true, None, "");
    let phase = |panel: &Entity<AgentChatTabPanel>, cx: &mut VisualTestContext, phase| {
        panel.update(cx, |p, cx| {
            p.controller.store().patch(StatePatch::new().phase(phase));
            cx.notify();
        });
        draw(cx);
    };
    phase(&panel, cx, AgentControllerPhase::Discovering);
    let loader = cx.debug_bounds("agent-startup-loading").unwrap();
    let chat = cx.debug_bounds("agent-chat-panel").unwrap();
    assert_eq!(loader.center().x, chat.center().x);
    assert!(cx.debug_bounds("agent-dock").is_none());
    assert!(cx.debug_bounds("agent-empty-state").is_none());
    phase(&panel, cx, AgentControllerPhase::Ready);
    assert!(cx.debug_bounds("agent-startup-loading").is_none());
    assert!(cx.debug_bounds("agent-dock").is_some());
}

/// `BuiltInAgentCompute`: the first summary names PuppyOne compute and asks
/// for nothing; after a send the access prompt also offers the user's own
/// model in Settings; an empty balance offers the account and buys nothing;
/// a new connections catalog rediscovers the runtime once.
#[gpui::test]
fn the_compute_dock_names_its_route_and_hands_off_its_actions(cx: &mut TestAppContext) {
    use super::AgentChatPanelEvent;
    use super::compute::{ComputeSnapshot, ManagedCompute};
    use std::{cell::Cell, cell::RefCell, rc::Rc};
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let slot = Rc::new(RefCell::new(None));
    let kept = slot.clone();
    let (panel, cx) = cx.add_window_view(|window, cx| {
        let (panel, asked) =
            AgentChatTabPanel::managed_fixture(Rc::new(Cell::new(false)), window, cx);
        *kept.borrow_mut() = Some(asked);
        panel
    });
    let asked = slot.borrow().clone().unwrap();
    let events = Rc::new(RefCell::new(Vec::new()));
    let log = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&panel, move |_, event, _| match event {
            AgentChatPanelEvent::OpenAccount => log.borrow_mut().push("account"),
            AgentChatPanelEvent::OpenModelConnections => log.borrow_mut().push("connections"),
            _ => {}
        })
        .detach()
    });
    let compute = |revision: &str, signed_in: bool, reason: &'static str| ComputeSnapshot {
        revision: revision.into(),
        sources: Default::default(),
        managed: Some(ManagedCompute {
            signed_in,
            available: false,
            reason,
            ..Default::default()
        }),
    };
    panel.update_in(cx, |p, window, cx| {
        p.set_presentation(true, true, window, cx);
        p.set_payments(true, cx);
        p.apply_compute(compute("1", false, "sign-in-required"), cx);
    });
    draw(cx);
    assert!(
        cx.debug_bounds("agent-compute-summary:Puppyone's token")
            .is_some()
    );
    assert!(cx.debug_bounds("agent-compute-sign-in").is_none());
    assert!(cx.debug_bounds("agent-picker-Model").is_none());

    focus_composer(&panel, cx);
    cx.simulate_input("Hello");
    cx.simulate_keystrokes("enter");
    draw(cx);
    assert!(
        cx.debug_bounds("agent-compute-title:Use PuppyOne compute")
            .is_some()
    );
    let own = cx.debug_bounds("agent-compute-own").unwrap();
    cx.simulate_click(own.center(), Modifiers::default());
    draw(cx);
    assert_eq!(*events.borrow(), ["connections"]);

    panel.update(cx, |p, cx| {
        p.apply_compute(compute("1", true, "insufficient-credit"), cx)
    });
    draw(cx);
    assert!(
        cx.debug_bounds("agent-compute-title:Add credit to use this model.")
            .is_some()
    );
    let balance = cx.debug_bounds("agent-compute-balance").unwrap();
    cx.simulate_click(balance.center(), Modifiers::default());
    draw(cx);
    assert_eq!(*events.borrow(), ["connections", "account"]);
    assert!(!asked.borrow().iter().any(|op| matches!(
        op,
        AgentOperation::StartTurn | AgentOperation::CreateSession
    )));

    let discoveries = || {
        asked
            .borrow()
            .iter()
            .filter(|op| **op == AgentOperation::DiscoverRuntimes)
            .count()
    };
    let before = discoveries();
    panel.update(cx, |p, cx| {
        p.apply_compute(compute("2", true, "insufficient-credit"), cx)
    });
    draw(cx);
    assert_eq!(discoveries(), before + 1, "a new catalog rediscovers");
    panel.update(cx, |p, cx| {
        p.apply_compute(compute("2", true, "insufficient-credit"), cx)
    });
    draw(cx);
    assert_eq!(discoveries(), before + 1, "the same catalog does not");
}

/// `BuiltInAgentCompute` `labels a failed browser handoff as a sign-in
/// problem`, `offers retry after a confirmed failure and shows progress
/// while retrying` and `offers the server-configured trial only after the
/// first send attempt`, with the app's wallet behind the prompt.
#[gpui::test]
fn the_access_prompt_signs_in_retries_with_progress_and_offers_the_trial(cx: &mut TestAppContext) {
    use super::compute::ComputeSnapshot;
    use crate::features::model_connections::compute_support::{hold, world};
    use gpui_kit::test::TestQueryExt as _;
    use std::{cell::Cell, rc::Rc};
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let world = world(false);
    {
        let mut world = world.lock().unwrap();
        world.trial = 1_000_000;
        world.sign_in_starts = false;
    }
    let hooks = crate::features::model_connections::compute_support::hooks(&world);
    let wallet = cx.update(|cx| crate::features::model_connections::install_compute(hooks, cx));
    let (panel, cx) = cx.add_window_view(|window, cx| {
        AgentChatTabPanel::managed_fixture(Rc::new(Cell::new(false)), window, cx).0
    });
    panel.update_in(cx, |p, window, cx| {
        p.set_presentation(true, true, window, cx);
        p.set_payments(true, cx);
        p.watch_wallet(cx);
        p.apply_compute(
            ComputeSnapshot {
                revision: "1".into(),
                ..Default::default()
            },
            cx,
        );
    });
    cx.run_until_parked();
    draw(cx);
    // Only the first send attempt asks for access, offering the trial.
    assert!(cx.debug_bounds("agent-compute-sign-in").is_none());
    focus_composer(&panel, cx);
    cx.simulate_input("Hello");
    cx.simulate_keystrokes("enter");
    draw(cx);
    assert!(
        cx.debug_bounds("agent-compute-summary:Puppyone's token")
            .is_none()
    );
    assert!(
        cx.debug_bounds(
            "agent-compute-detail:One-time $1.00 AI credit per account. Top up as needed. No subscription."
        )
        .is_some()
    );
    // A browser handoff that cannot start says so, as a sign-in problem.
    let sign_in = cx.debug_bounds("agent-compute-sign-in").unwrap();
    cx.simulate_click(sign_in.center(), Modifiers::default());
    draw(cx);
    let alerts = |cx: &mut VisualTestContext| {
        cx.update(|w, _| {
            w.find_all_by_role(gpui::Role::Alert)
                .iter()
                .filter_map(|a| a.label().map(str::to_owned))
                .collect::<Vec<_>>()
        })
    };
    assert_eq!(
        alerts(cx),
        ["Could not open the sign-in page. Please retry."]
    );
    assert!(world.lock().unwrap().opened.is_empty(), "nothing bought");

    // Signed in, the wallet fails: the gateway is unavailable, and Retry
    // shows its progress until the retry ends.
    let failed = hold(&world, "/ai/balance");
    world.lock().unwrap().session =
        Some(crate::features::model_connections::compute_support::session("u"));
    wallet.update(cx, |w, cx| w.refresh(false, cx));
    cx.run_until_parked();
    failed
        .try_send(crate::features::model_connections::compute_support::failed())
        .unwrap();
    cx.run_until_parked();
    draw(cx);
    assert!(
        cx.debug_bounds("agent-compute-title:Compute service is temporarily unavailable.")
            .is_some()
    );
    assert!(alerts(cx).is_empty(), "no sign-in problem now");
    let retrying = hold(&world, "/ai/balance");
    let retry = cx.debug_bounds("agent-compute-retry").unwrap();
    cx.simulate_click(retry.center(), Modifiers::default());
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("agent-compute-connecting").is_some());
    let connecting = cx.update(|w, _| w.find_by_label("Connecting to compute…"));
    assert_eq!(connecting.disabled(), Some(true));
    assert!(
        cx.debug_bounds("agent-compute-title:Compute service is temporarily unavailable.")
            .is_none()
    );
    retrying
        .try_send(crate::features::model_connections::compute_support::failed())
        .unwrap();
    cx.run_until_parked();
    draw(cx);
    let retry = cx.update(|w, _| w.find_by_label("Retry"));
    assert_ne!(retry.disabled(), Some(true), "Retry is offered again");
}

/// `inserts a Finder folder path instead of staging it as a file
/// attachment`; `routes Finder drop, picker and every semantically supported
/// pasted File through one staging method`: a dropped folder becomes its
/// path in the draft, a dropped file is staged, and nothing is sent.
#[gpui::test]
fn finder_drops_insert_folders_as_paths_and_stage_files(cx: &mut TestAppContext) {
    use gpui::{ExternalPaths, FileDropEvent};
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let finder = tempfile::tempdir().unwrap();
    let folder = finder.path().join("Design System");
    std::fs::create_dir(&folder).unwrap();
    let file = finder.path().join("capture.png");
    std::fs::write(&file, b"image").unwrap();
    let (panel, asked, cx) = seeded(cx, true, None, "");
    let stagings = || {
        asked
            .borrow()
            .iter()
            .filter(|op| **op == AgentOperation::StageReferences)
            .count()
    };
    let chat = cx.debug_bounds("agent-chat-panel").unwrap();
    let drop = |cx: &mut VisualTestContext, path: std::path::PathBuf| {
        cx.simulate_event(FileDropEvent::Entered {
            position: chat.center(),
            paths: ExternalPaths(vec![path].into()),
        });
        cx.simulate_event(FileDropEvent::Submit {
            position: chat.center(),
        });
        draw(cx);
    };
    drop(cx, folder.clone());
    let draft = panel.read_with(cx, |p, _| p.controller.get_snapshot().draft);
    assert!(draft.contains(&*folder.to_string_lossy()), "{draft}");
    assert_eq!(stagings(), 0, "a folder is not an attachment");
    drop(cx, file);
    assert_eq!(stagings(), 1, "a file is staged");
    assert!(!asked.borrow().contains(&AgentOperation::StartTurn));
}

/// The panel's `role="status"` announcements (`desktop-agent-announcer`).
fn announced(cx: &mut VisualTestContext) -> Vec<String> {
    use gpui_kit::test::TestQueryExt as _;
    cx.update(|w, _| {
        w.find_all_by_role(gpui::Role::Status)
            .iter()
            .filter_map(|s| s.label().map(str::to_owned))
            .collect()
    })
}

fn resource_drag(
    workspace: Option<std::sync::Arc<crate::workspace::Workspace>>,
) -> crate::ui::resource_drag::ResourceDrag {
    crate::ui::resource_drag::ResourceDrag {
        single_file: true,
        paths: vec![std::path::PathBuf::from("secret.md")],
        label: "secret.md".into(),
        workspace,
        native: std::rc::Rc::new(std::cell::Cell::new(false)),
    }
}

/// `marks cross-workspace drags invalid and never grants their paths`:
/// entries dragged from another workspace, or from one without local
/// files, are refused and said so; this chat's own are resolved.
#[gpui::test]
fn cross_workspace_drags_are_refused_and_announced(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let ours = tempfile::tempdir().unwrap();
    let theirs = tempfile::tempdir().unwrap();
    for root in [&ours, &theirs] {
        std::fs::write(root.path().join("secret.md"), "s").unwrap();
    }
    let root = ours.path().to_string_lossy().into_owned();
    let slot = std::rc::Rc::new(std::cell::RefCell::new(None));
    let kept = slot.clone();
    let (panel, cx) = cx.add_window_view(|window, cx| {
        let (panel, asked) =
            AgentChatTabPanel::seeded_fixture_at(&root, true, None, "", window, cx);
        *kept.borrow_mut() = Some(asked);
        panel
    });
    let asked = slot.borrow().clone().unwrap();
    draw(cx);
    let resolved = || {
        asked
            .borrow()
            .iter()
            .filter(|op| {
                matches!(
                    op,
                    AgentOperation::ResolveWorkspaceReferences | AgentOperation::StageReferences
                )
            })
            .count()
    };
    let drop = |cx: &mut VisualTestContext, drag| {
        panel.update(cx, |p, cx| p.drop_resources(&drag, cx));
        draw(cx);
    };
    let other = crate::workspace::Workspace::open(theirs.path()).unwrap();
    drop(cx, resource_drag(Some(other)));
    assert_eq!(resolved(), 0, "another workspace's paths are never granted");
    assert_eq!(
        announced(cx),
        ["That item belongs to another workspace and was not added."]
    );
    let hosted = crate::workspace::Workspace::from_provider(std::sync::Arc::new(
        crate::workspace::testing::Memory::new("memory://cloud/project/"),
    ))
    .unwrap();
    drop(cx, resource_drag(Some(hosted)));
    assert_eq!(resolved(), 0);
    assert_eq!(
        announced(cx),
        ["That workspace item is no longer available."]
    );
    let own = crate::workspace::Workspace::open(ours.path()).unwrap();
    drop(cx, resource_drag(Some(own)));
    assert_eq!(resolved(), 1, "this chat's own entries are resolved");
}

/// `announces partial batches while retaining the rejected item as an
/// actionable error`: a dropped file the runtime refuses stays a failed
/// reference, and the status counts it.
#[gpui::test]
fn a_partial_batch_is_announced_and_keeps_its_failed_reference(cx: &mut TestAppContext) {
    use gpui::{ExternalPaths, FileDropEvent};
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let finder = tempfile::tempdir().unwrap();
    let file = finder.path().join("paper.pdf");
    std::fs::write(&file, b"pdf").unwrap();
    let (panel, _asked, cx) = seeded(cx, true, None, "");
    assert!(announced(cx).is_empty());
    let chat = cx.debug_bounds("agent-chat-panel").unwrap();
    cx.simulate_event(FileDropEvent::Entered {
        position: chat.center(),
        paths: ExternalPaths(vec![file].into()),
    });
    cx.simulate_event(FileDropEvent::Submit {
        position: chat.center(),
    });
    draw(cx);
    assert_eq!(announced(cx), ["Added 0; 1 could not be added."]);
    let references = panel.read_with(cx, |p, _| p.controller.get_snapshot().references);
    assert_eq!(references.len(), 1);
    assert_eq!(
        references[0].status,
        crate::agent::contract::dto::ReferenceStatus::Error
    );
}
