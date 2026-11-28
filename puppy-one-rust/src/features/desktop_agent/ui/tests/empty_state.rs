//! `tests/component/agent/transcript/empty-state.test.ts`: the empty
//! conversation's mark and cue.
use crate::features::desktop_agent::ui::empty_state::EmptyStateView;
use crate::features::desktop_agent::ui::transcript::TranscriptView;
use core::prelude::v1::test;
use gpui::{Modifiers, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
}

/// `renders the quiet runtime identity only for a ready empty conversation`;
/// `uses Pi's theme-colored normalized vector in the empty conversation`:
/// the runtime's mark is its theme-coloured vector and spins once per
/// click; the cue asks what to work on.
#[gpui::test]
fn the_empty_mark_is_the_runtimes_vector_and_spins_per_click(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    for (icon_key, label) in [("codex", "Codex"), ("pi", "Pi Agent")] {
        let (view, cx) = cx.add_window_view(|_, _| EmptyStateView::default());
        view.update(cx, |v, cx| {
            v.set_runtime(Some(icon_key.into()), label.into(), cx)
        });
        draw(cx);
        assert!(cx.debug_bounds("agent-empty-prompt").is_some());
        let logo = cx
            .debug_bounds("agent-empty-logo:vector:0")
            .unwrap_or_else(|| panic!("{icon_key}: a vector mark"));
        for _ in 0..3 {
            cx.simulate_click(logo.center(), Modifiers::default());
        }
        draw(cx);
        assert!(cx.debug_bounds("agent-empty-logo:vector:3").is_some());
    }
}

/// `keeps the transcript generic when no product empty-state slot is
/// supplied`: an empty transcript draws no cue of its own; the chat lays
/// the empty state over it.
#[gpui::test]
fn an_empty_transcript_draws_no_cue_of_its_own(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (_, cx) = cx.add_window_view(|_, cx| TranscriptView::new(cx));
    draw(cx);
    assert!(cx.debug_bounds("agent-empty-prompt").is_none());
    assert!(cx.debug_bounds("agent-startup-loading").is_none());
}
