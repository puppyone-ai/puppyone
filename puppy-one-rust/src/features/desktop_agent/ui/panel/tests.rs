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
/// usable asks to sign in instead of preparing a session; while compute
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
    assert_eq!(opened.get(), 1, "signing in goes through the account");

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
