//! The Agent panel over a recorded conversation (the pixel lab's fixture).
use super::AgentChatTabPanel;
use core::prelude::v1::test;
use gpui::{Modifiers, TestAppContext, VisualTestContext};

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

/// `Agent initial prompt handoff and one-shot auto-submit`: a chat created
/// with a prompt sends it once when it settles ready; over a runtime that
/// is not ready it keeps the prompt as a draft and never sends it later.
#[gpui::test]
fn a_seeded_prompt_sends_once_when_ready_and_otherwise_stays_a_draft(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    for ready in [true, false] {
        let starts = std::rc::Rc::new(std::cell::RefCell::new(None));
        let slot = starts.clone();
        let (panel, cx) = cx.add_window_view(|window, cx| {
            let (panel, starts) =
                AgentChatTabPanel::seeded_fixture(ready, "Summarize Q4 metrics", window, cx);
            *slot.borrow_mut() = Some(starts);
            panel
        });
        let starts = starts.borrow().clone().unwrap();
        panel.update_in(cx, |p, window, cx| {
            p.set_presentation(true, true, window, cx)
        });
        draw(cx);
        draw(cx);
        let (draft, pending) = panel.read_with(cx, |p, _| {
            (
                p.controller.get_snapshot().draft,
                p.controller.has_pending_initial_auto_submit(),
            )
        });
        assert!(!pending, "ready={ready}: armed once only");
        if ready {
            assert_eq!(starts.get(), 1, "sent once");
        } else {
            assert_eq!(starts.get(), 0, "never sent");
            assert_eq!(draft, "Summarize Q4 metrics", "kept as the draft");
        }
    }
}
