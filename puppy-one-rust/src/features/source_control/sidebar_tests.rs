//! Acceptance at the actual Changes sidebar's layout and pointer listeners.
use super::*;
use core::prelude::v1::test;

fn many_changes() -> Snapshot {
    Snapshot {
        head: "fixture-head".into(),
        branch: "main".into(),
        changes: (0..30)
            .flat_map(|i| {
                [
                    Change {
                        path: format!("staged-{i}.md"),
                        original: None,
                        index: 'M',
                        worktree: ' ',
                    },
                    Change {
                        path: format!("working-{i}.md"),
                        original: None,
                        index: ' ',
                        worktree: 'M',
                    },
                ]
            })
            .collect(),
        ..Default::default()
    }
}
fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| {
        window.refresh();
        let _ = window.draw(cx);
    });
}
fn setup(cx: &mut TestAppContext) -> (Entity<SourceControl>, &mut VisualTestContext) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(SourceControl::new);
    cx.simulate_resize(size(px(400.), px(440.)));
    view.update(cx, |s, cx| {
        let snapshot = many_changes();
        s.sections = project_sections(&snapshot);
        s.snapshot = Some(snapshot);
        cx.notify();
    });
    draw(cx);
    (view, cx)
}
fn heights(cx: &mut VisualTestContext) -> (f32, f32) {
    (
        cx.debug_bounds("git-panel-Staged")
            .expect("staged panel")
            .size
            .height
            .into(),
        cx.debug_bounds("git-panel-Unstaged")
            .expect("unstaged panel")
            .size
            .height
            .into(),
    )
}
fn start_drag(cx: &mut VisualTestContext, delta: f32) -> Point<Pixels> {
    let at = cx.debug_bounds("git-section-resize").unwrap().center();
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    let end = at + point(px(0.), px(delta));
    cx.simulate_mouse_move(end, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    end
}
fn same_heights(actual: (f32, f32), expected: (f32, f32)) {
    assert!(
        (actual.0 - expected.0).abs() <= 1.,
        "actual={actual:?}, expected={expected:?}"
    );
    assert!(
        (actual.1 - expected.1).abs() <= 1.,
        "actual={actual:?}, expected={expected:?}"
    );
}
#[gpui::test]
fn dragging_a_section_boundary_resizes_only_its_adjacent_panels(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        let snapshot = s.snapshot.as_mut().unwrap();
        snapshot.ahead = 2;
        snapshot.target = Some(git::SyncTarget {
            remote: "origin".into(),
            branch: "main".into(),
            exists: true,
        });
        snapshot.remotes = vec!["origin".into()];
        cx.notify();
    });
    draw(cx);
    let committed = cx.debug_bounds("git-panel-Committed").unwrap();
    let before = heights(cx);
    let at = cx
        .debug_bounds("git-section-resize")
        .expect("section divider")
        .center();
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    let end = at + point(px(0.), px(32.));
    cx.simulate_mouse_move(end, Some(MouseButton::Left), Modifiers::default());
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    draw(cx);
    let after = heights(cx);
    assert!(
        (after.0 - before.0 - 32.).abs() <= 1.,
        "before={before:?} after={after:?}"
    );
    assert!(
        (after.1 - before.1 + 32.).abs() <= 1.,
        "before={before:?} after={after:?}"
    );
    assert!((after.0 + after.1 - before.0 - before.1).abs() <= 1.);
    assert_eq!(cx.debug_bounds("git-panel-Committed").unwrap(), committed);
}

#[gpui::test]
fn escape_focus_loss_visibility_and_lost_buttons_roll_back_the_drag(cx: &mut TestAppContext) {
    let (_, cx) = setup(cx);
    for cancellation in ["escape", "blur", "hidden", "lost-button"] {
        cx.update(|window, _| window.activate_window());
        draw(cx);
        let before = heights(cx);
        let end = start_drag(cx, 30.);
        assert!(heights(cx).0 > before.0 + 20.);
        match cancellation {
            "escape" => cx.simulate_keystrokes("escape"),
            "blur" => cx.deactivate_window(),
            "hidden" => cx.simulate_visibility_change(WindowVisibility::Hidden),
            _ => cx.simulate_mouse_move(end, None, Modifiers::default()),
        }
        draw(cx);
        let after = heights(cx);
        assert!(
            (after.0 - before.0).abs() <= 1.,
            "{cancellation}: before={before:?} after={after:?}"
        );
        same_heights(after, before);
        // A release delivered after cancellation cannot commit its preview.
        cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
        draw(cx);
        same_heights(heights(cx), before);
        cx.simulate_visibility_change(WindowVisibility::Visible);
    }
}

#[gpui::test]
fn keyboard_resize_uses_small_accelerated_and_limit_steps(cx: &mut TestAppContext) {
    let (_, cx) = setup(cx);
    let at = cx.debug_bounds("git-section-resize").unwrap().center();
    cx.simulate_click(at, Modifiers::default());
    draw(cx);
    let before = heights(cx);
    cx.simulate_keystrokes("down");
    draw(cx);
    same_heights(heights(cx), (before.0 + 8., before.1 - 8.));
    cx.simulate_keystrokes("shift-up");
    draw(cx);
    same_heights(heights(cx), (before.0 - 24., before.1 + 24.));
    let total = before.0 + before.1;
    cx.simulate_keystrokes("home");
    draw(cx);
    same_heights(heights(cx), (72., total - 72.));
    cx.simulate_keystrokes("up");
    draw(cx);
    same_heights(heights(cx), (72., total - 72.));
    cx.simulate_keystrokes("end");
    draw(cx);
    same_heights(heights(cx), (total - 72., 72.));
    cx.simulate_keystrokes("down left right");
    draw(cx);
    same_heights(heights(cx), (total - 72., 72.));
}

#[gpui::test]
fn release_uses_its_latest_position_and_extreme_drags_respect_both_limits(cx: &mut TestAppContext) {
    let (_, cx) = setup(cx);
    let before = heights(cx);
    let at = cx.debug_bounds("git-section-resize").unwrap().center();
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_up(
        at + point(px(0.), px(25.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    draw(cx);
    same_heights(heights(cx), (before.0 + 25., before.1 - 25.));
    let end = start_drag(cx, 5000.);
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    draw(cx);
    same_heights(heights(cx), (before.0 + before.1 - 72., 72.));
    let end = start_drag(cx, -5000.);
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    draw(cx);
    same_heights(heights(cx), (72., before.0 + before.1 - 72.));
}

#[gpui::test]
fn collapsing_a_group_hides_its_rows_and_restores_its_resized_height(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let end = start_drag(cx, 25.);
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    draw(cx);
    let resized = heights(cx);
    let toggle = cx.debug_bounds("git-section-Staged").unwrap();
    let at = point(toggle.origin.x + px(20.), toggle.center().y);
    cx.simulate_click(at, Modifiers::default());
    draw(cx);
    assert_eq!(heights(cx).0, theme::control());
    view.read_with(cx, |s, _| {
        assert!(s.collapsed.contains(&Panel::Staged));
        assert!(!s.collapsed.contains(&Panel::Unstaged));
        assert!(s.running.is_none());
    });
    cx.simulate_click(at, Modifiers::default());
    draw(cx);
    same_heights(heights(cx), resized);
}

#[gpui::test]
fn switching_to_history_cancels_a_preview_and_ignores_late_release(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let before = heights(cx);
    let end = start_drag(cx, 25.);
    view.update(cx, |s, cx| s.open_history(cx));
    draw(cx);
    assert!(cx.debug_bounds("git-section-resize").is_none());
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    view.update(cx, |s, cx| s.show_changes(cx));
    draw(cx);
    same_heights(heights(cx), before);
}

#[gpui::test]
fn changing_the_panel_set_cancels_a_drag_without_resizing_the_new_neighbor(
    cx: &mut TestAppContext,
) {
    let (view, cx) = setup(cx);
    let before = heights(cx);
    let end = start_drag(cx, 25.);
    view.update(cx, |s, cx| {
        s.snapshot.as_mut().unwrap().changes.retain(|c| !c.staged());
        s.sections = project_sections(s.snapshot.as_ref().unwrap());
        cx.notify();
    });
    draw(cx);
    assert!(cx.debug_bounds("git-panel-Staged").is_none());
    assert!(cx.debug_bounds("git-section-resize").is_none());
    let remaining = cx.debug_bounds("git-panel-Unstaged").unwrap();
    let content_cap = theme::control() * 10. + SECTION_BODY_TOP_GAP + 18.;
    assert!(
        (f32::from(remaining.size.height) - content_cap).abs() <= 1.,
        "remaining panel must immediately resume automatic sizing: {remaining:?}"
    );
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    view.update(cx, |s, cx| {
        s.snapshot = Some(many_changes());
        s.sections = project_sections(s.snapshot.as_ref().unwrap());
        cx.notify();
    });
    draw(cx);
    same_heights(heights(cx), before);
}
