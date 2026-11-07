//! The pane layout as the window hosts it: frames, motion, drags, stored layout, cached panes.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn idle_shell_does_not_schedule_continuous_frames(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.run_until_parked();
    let before = view.update(cx, |s, _| s.frame.frames);
    cx.run_until_parked();
    view.update(cx, |s, _| assert_eq!(s.frame.frames, before));
}
#[gpui::test]
fn closing_the_explorer_moves_its_frame_unless_motion_is_reduced(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let open = view.update(cx, |s, _| s.frame.layout.editor.x);
    assert!(open > 0.);
    let started = std::time::Instant::now();
    command(&view, cx, Command::ToggleExplorer);
    if started.elapsed() < MOTION_EARLY {
        view.update(cx, |s, _| {
            // Mid-motion the editor has not reached the window edge, and the
            // Explorer keeps its open width behind the moving frame.
            assert!(s.frame.layout.editor.x > 0.);
            assert_eq!(s.frame.layout.explorer.w, open);
        });
    }
    cx.update(|_, cx| cx.set_reduce_motion(true));
    command(&view, cx, Command::ToggleExplorer);
    view.update(cx, |s, _| assert_eq!(s.frame.layout.editor.x, open));
}
#[gpui::test]
fn a_closing_explorer_moves_without_rendering_its_rows_again(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.simulate_resize(size(px(1280.), px(800.)));
    draw(cx);
    let explorer = explorer_of(&view, cx);
    let renders = |cx: &mut VisualTestContext| explorer.read_with(cx, |e, _| e.renders);
    let edge = |cx: &mut VisualTestContext| view.read_with(cx, |s, _| s.frame.layout.editor.x);
    assert_eq!(edge(cx), 320.);
    // The toggle tells the Explorer once that it is closing…
    command(&view, cx, Command::ToggleExplorer);
    let closing = renders(cx);
    // …then its frame moves over many frames while the rows stay as they
    // were: the editor covers them, nothing clips them.
    let mut moving = 0;
    for _ in 0..200 {
        std::thread::sleep(std::time::Duration::from_millis(8));
        draw(cx);
        let x = edge(cx);
        if x == 0. {
            break;
        }
        assert!(x < 320.);
        moving += 1;
    }
    assert_eq!(edge(cx), 0., "the frame closed");
    assert!(moving >= 3, "the frame moved over {moving} frames");
    assert_eq!(
        renders(cx),
        closing,
        "the Explorer was reused at every frame"
    );
}
#[gpui::test]
fn opening_a_pane_in_a_narrow_window_widens_it_to_the_pane_minima(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.simulate_resize(size(px(760.), px(700.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // Explorer alone fits: the window keeps its width.
    assert_eq!(cx.update(|w, _| f32::from(w.bounds().size.width)), 760.);
    // Explorer + right sidebar need 320 + 8 + 220 + 320.
    command(&view, cx, Command::ToggleRightSidebar);
    assert_eq!(cx.update(|w, _| f32::from(w.bounds().size.width)), 868.);
    view.update(cx, |s, cx| {
        assert_eq!(s.panes.read(cx).window_minimum(), 868.)
    });
}
#[gpui::test]
fn dragging_the_explorer_edge_past_half_its_minimum_collapses_it(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let edge = view.read_with(cx, |s, _| s.frame.layout.editor.x);
    assert_eq!(edge, 320.);
    // The divider is the Explorer's last column; its lane runs 8px on.
    // Narrowing within range follows the pointer.
    drag(&view, cx, (322., 400.), &[(280., 400.)], true);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (
                s.panes.read(cx).explorer().open,
                s.panes.read(cx).explorer().width
            ),
            (true, 278.)
        )
    });
    // Past the 110px boundary the pane previews closed before release…
    drag(
        &view,
        cx,
        (277., 400.),
        &[(200., 400.), (100., 400.)],
        false,
    );
    view.read_with(cx, |s, cx| {
        assert!(
            s.panes.read(cx).explorer().open,
            "nothing is committed mid-drag"
        );
        assert_eq!(s.frame.layout.editor.x, 0., "the preview is closed");
    });
    // …and releasing commits it, reopening later at the minimum.
    cx.simulate_mouse_up(
        point(px(100.), px(400.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (
                s.panes.read(cx).explorer().open,
                s.panes.read(cx).explorer().width
            ),
            (false, 220.)
        )
    });
    // Both commits are the stored layout.
    view.read_with(cx, |s, cx| {
        let p = &s.prefs.store.read(cx).state;
        assert_eq!((p.sidebar_collapsed, p.explorer_width), (true, 220.));
    });
}
#[gpui::test]
fn the_stored_pane_layout_is_the_starting_layout(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // The stored layout arriving is shown at once, not as a close.
    let store = view.read_with(cx, |s, _| s.prefs.store.clone());
    store.update(cx, |store, cx| {
        store.change(
            |p| {
                p.sidebar_collapsed = true;
                p.explorer_width = 260.;
                p.right_sidebar_width = 400.;
            },
            cx,
        )
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (
                s.panes.read(cx).explorer().open,
                s.panes.read(cx).explorer().width,
                s.panes.read(cx).right().width
            ),
            (false, 260., 400.)
        );
        assert_eq!(s.frame.layout.editor.x, 0.);
        assert_eq!(s.frame.layout.explorer.w, 0.);
    });
    // Reopening comes back at the stored width, and is stored.
    command(&view, cx, Command::ToggleExplorer);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (
                s.panes.read(cx).explorer().open,
                s.panes.read(cx).explorer().width
            ),
            (true, 260.)
        );
        assert!(!s.prefs.store.read(cx).state.sidebar_collapsed);
    });
}
#[gpui::test]
fn a_collapse_preview_retreats_and_escape_rolls_back(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // Armed at 100, still armed at 134 (hysteresis), open again at 200.
    drag(
        &view,
        cx,
        (322., 400.),
        &[(100., 400.), (134., 400.)],
        false,
    );
    view.read_with(cx, |s, _| assert_eq!(s.frame.layout.editor.x, 0.));
    cx.simulate_mouse_move(
        point(px(200.), px(400.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    cx.simulate_mouse_up(
        point(px(200.), px(400.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (
                s.panes.read(cx).explorer().open,
                s.panes.read(cx).explorer().width
            ),
            (true, 220.)
        )
    });
    // Escape mid-drag (focus anywhere, before any binding) restores what was
    // committed; the release that follows changes nothing.
    drag(&view, cx, (221., 400.), &[(60., 400.)], false);
    view.read_with(cx, |s, _| assert_eq!(s.frame.layout.editor.x, 0.));
    cx.simulate_keystrokes("escape");
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, cx| {
        assert!(s.panes.read(cx).dragging().is_none());
        assert_eq!(s.frame.layout.editor.x, 220.);
    });
    cx.simulate_mouse_up(
        point(px(60.), px(400.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (
                s.panes.read(cx).explorer().open,
                s.panes.read(cx).explorer().width
            ),
            (true, 220.)
        )
    });
}
#[gpui::test]
fn a_closed_right_sidebar_is_pulled_out_from_the_window_edge(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.read_with(cx, |s, cx| assert!(!s.panes.read(cx).right().open));
    // A short pull snaps back closed…
    drag(&view, cx, (1275., 400.), &[(1200., 400.)], true);
    view.read_with(cx, |s, cx| assert!(!s.panes.read(cx).right().open));
    // …one past the 160px threshold opens it.
    drag(
        &view,
        cx,
        (1275., 400.),
        &[(1000., 400.), (900., 400.)],
        true,
    );
    view.read_with(cx, |s, cx| {
        assert_eq!(
            (
                s.panes.read(cx).right().open,
                s.panes.read(cx).right().width
            ),
            (true, 375.)
        )
    });
}
/// The closed right sidebar's lane is the right edge's tab stop: focused,
/// it takes the edge's keys, and End opens the sidebar at its widest with
/// the focus kept on the edge.
#[gpui::test]
fn the_closed_right_edge_opens_from_the_keyboard(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    cx.simulate_resize(size(px(1280.), px(800.)));
    draw(cx);
    let focus = view.read_with(cx, |s, cx| {
        assert!(!s.panes.read(cx).right().open);
        s.panes.read(cx).focus(panes::Side::End).clone()
    });
    cx.update(|w, cx| w.focus(&focus, cx));
    draw(cx);
    cx.simulate_keystrokes("end");
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.panes.read(cx).right().open));
    cx.update(|w, _| assert!(focus.is_focused(w)));
}
#[gpui::test]
fn the_cached_panes_render_again_only_when_they_change(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let text: String = (0..400).map(|i| format!("Line {i}\n\n")).collect();
    std::fs::write(temp.path().join("long.md"), &text).unwrap();
    let workspace = crate::workspace::Workspace::open(temp.path()).unwrap();
    let document = workspace.read(std::path::Path::new("long.md")).unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.replace(Documents::default()));
        s.session
            .docs
            .update(cx, |d, _| d.workspace = Some(workspace));
        s.session
            .docs
            .update(cx, |d, _| d.document = Some(document.clone()));
        s.session.docs.update(cx, |d, _| {
            d.outgoing.push(crate::documents::HostMessage::Open {
                id: document.id.clone(),
                name: "long.md".into(),
                text: document.text.clone(),
                revision: 0,
                external: false,
            })
        });
        s.sync_editor(w, cx);
    });
    draw(cx);
    draw(cx);
    let explorer = explorer_of(&view, cx);
    let renders = |cx: &mut VisualTestContext| explorer.read_with(cx, |e, _| e.renders);
    let frames = |cx: &mut VisualTestContext| view.read_with(cx, |s, _| s.frame.frames);
    // Scrolling the editor renders the window, not the Explorer.
    let editor = view.read_with(cx, |s, _| s.frame.layout.editor);
    let (before, shell_before) = (renders(cx), frames(cx));
    for _ in 0..5 {
        cx.simulate_event(ScrollWheelEvent {
            position: point(px(editor.x + editor.w / 2.), px(editor.y + editor.h / 2.)),
            delta: ScrollDelta::Pixels(point(px(0.), px(-40.))),
            ..Default::default()
        });
        draw(cx);
    }
    assert!(frames(cx) > shell_before, "the scroll rendered frames");
    assert_eq!(renders(cx), before, "the Explorer was reused");
    // Rendering the shell does not push anything into the Explorer…
    view.update(cx, |s, cx| {
        s.session.project.update(cx, |p, _| p.picking = true);
        cx.notify();
    });
    draw(cx);
    assert_eq!(renders(cx), before, "a shell frame is not a host change");
    // …a host change, handed over when it happens, renders it again.
    view.update_in(cx, |s, w, cx| s.push_explorer_host(w, cx));
    draw(cx);
    let pushed = renders(cx);
    assert!(pushed > before, "a host change renders the Explorer");
    // A preference the Explorer does not read leaves it alone (the first
    // change projects the whole appearance once, as loading does)…
    let store = view.read_with(cx, |s, _| s.prefs.store.clone());
    store.update(cx, |p, cx| p.change(|p| p.right_sidebar_width = 380., cx));
    draw(cx);
    let pushed = renders(cx);
    store.update(cx, |p, cx| p.change(|p| p.right_sidebar_width = 400., cx));
    draw(cx);
    assert_eq!(renders(cx), pushed, "a pane width is not the Explorer's");
    // …while an appearance change is process-wide: the window renders again.
    store.update(cx, |p, cx| {
        p.change(|p| p.pointer_cursors = !p.pointer_cursors, cx)
    });
    draw(cx);
    assert!(renders(cx) > pushed, "the window refreshed");
}
