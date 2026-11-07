use super::*;
use core::prelude::v1::test;

#[test]
fn a_session_is_titled_by_its_folder() {
    use std::path::Path;
    assert_eq!(path_label(Path::new("/Users/me/project/")), "project");
    assert_eq!(path_label(Path::new("/Users/me/project")), "project");
    assert_eq!(path_label(Path::new("C:\\work\\site\\")), "site");
    assert_eq!(path_label(Path::new("/")), "/");
    assert_eq!(path_label(Path::new("")), "—");
}

#[test]
fn cells_follow_xterm_for_menlo_at_one_and_two_device_pixels() {
    // Menlo 13px: "W" advances 7.8267; ascent 12.0669, descent 3.0659.
    assert_eq!(
        cell_metrics(7.82666, 12.066895, 3.065918, 2.),
        (7.5, 18.5, 14.)
    );
    assert_eq!(
        cell_metrics(7.82666, 12.066895, 3.065918, 1.),
        (7., 18., 14.)
    );
}

#[test]
fn the_grid_fits_inside_the_session_padding_like_fit_addon() {
    let grid = Grid {
        cell_w: 7.5,
        cell_h: 18.5,
        ..Grid::default()
    };
    // 420 − 16 left − 14 scrollbar = 390 → 52 columns; 464 − 30 → 23 rows.
    assert_eq!(fit(420., 464., &grid), (23, 52));
    assert_eq!(fit(10., 10., &grid), (1, 2), "FitAddon's minimum");
}

#[test]
fn the_thumb_tracks_the_scrollback_offset() {
    let lane = (100., 400.);
    assert_eq!(thumb(lane, 20, 0, 0), None, "nothing to scroll");
    // 20 rows over 80 lines: a 100px thumb at the bottom, then the top.
    assert_eq!(thumb(lane, 20, 60, 0), Some((400., 100.)));
    assert_eq!(thumb(lane, 20, 60, 60), Some((100., 100.)));
    assert_eq!(thumb(lane, 20, 60, 30), Some((250., 100.)));
    // Long scrollback keeps the minimum slider.
    assert_eq!(thumb(lane, 20, 6000, 0).unwrap().1, THUMB_MIN);
}

#[gpui::test]
fn a_click_on_a_link_opens_it_and_a_selection_does_not(cx: &mut TestAppContext) {
    let (view, cx) = cx.add_window_view(|_, cx| {
        TerminalView::assemble(Terminal::disconnected_for_test(), false, false, cx)
    });
    view.update(cx, |s, cx| {
        s.parser
            .process(b"see https://example.com/x now\r\nhttps://example.org/y\r\n");
        cx.notify();
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let (origin, grid) = view.read_with(cx, |s, _| (s.bounds.origin, s.grid.clone()));
    let at = |row: f32, col: f32| {
        origin
            + point(
                px(PAD_LEFT + (col + 0.5) * grid.cell_w),
                px(PAD_TOP + (row + 0.5) * grid.cell_h),
            )
    };
    // Hovering underlines the link and points.
    cx.simulate_mouse_move(at(0., 6.), None, Modifiers::none());
    view.read_with(cx, |s, _| {
        assert_eq!(
            s.hover_link.as_ref().map(|l| l.url.as_str()),
            Some("https://example.com/x")
        )
    });
    // A drag across the second link selects it instead of opening it.
    cx.simulate_mouse_down(at(1., 0.), MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_move(at(1., 8.), MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_up(at(1., 8.), MouseButton::Left, Modifiers::none());
    assert_eq!(cx.opened_url(), None);
    cx.simulate_mouse_down(at(0., 6.), MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_up(at(0., 6.), MouseButton::Left, Modifiers::none());
    assert_eq!(cx.opened_url().as_deref(), Some("https://example.com/x"));
}
#[gpui::test]
fn native_pointer_selection_copy_and_shift_override(cx: &mut TestAppContext) {
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut view = TerminalView::assemble(Terminal::disconnected_for_test(), false, false, cx);
        view.parser = vt100::Parser::new(24, 80, 10);
        view.shell = "/bin/zsh".into();
        view
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    // A drop on an exited session, or from a workspace without local
    // paths, is refused with the product notice.
    view.update_in(cx, |s, w, cx| {
        s.insert_paths(Some(vec!["/tmp/a.md".into()]), w, cx);
        assert!(s.drop_failed);
        s.drop_failed = false;
        s.insert_paths(None, w, cx);
        assert!(s.drop_failed);
        s.drop_failed = false;
    });
    let origin = view.update(cx, |s, cx| {
        s.parser.process(b"hello world");
        cx.notify();
        s.bounds.origin
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let cell_w = view.read_with(cx, |s, _| s.grid.cell_w);
    let start = origin + point(px(PAD_LEFT), px(PAD_TOP + 4.));
    let end = start + point(px(5. * cell_w), px(0.));
    cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_move(end, MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::none());
    cx.simulate_keystrokes("cmd-c");
    cx.update(|_, cx| {
        assert_eq!(
            cx.read_from_clipboard().and_then(|c| c.text()).as_deref(),
            Some("hello")
        )
    });
    view.update(cx, |s, cx| {
        s.parser.process(b"\x1b[?1002h\x1b[?1006h");
        cx.notify();
    });
    let shift = Modifiers {
        shift: true,
        ..Modifiers::none()
    };
    cx.simulate_mouse_down(end, MouseButton::Left, shift);
    cx.simulate_mouse_move(start, MouseButton::Left, shift);
    cx.simulate_mouse_up(start, MouseButton::Left, shift);
    view.update(cx, |s, _| {
        assert_eq!(s.selection.unwrap().text(s.parser.screen()), "hello");
        assert_eq!(s.mouse_button, None);
        assert!(!s.selecting);
        assert!(
            s.failure.is_none(),
            "selection must not write to the disconnected PTY"
        );
    });
}
