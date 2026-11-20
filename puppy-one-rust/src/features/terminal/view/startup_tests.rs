use super::*;
use crate::platform::terminal::{Bridge, Request};
use core::prelude::v1::test;
use std::{cell::RefCell, rc::Rc};

fn inputs(bridge: &Bridge) -> Vec<Vec<u8>> {
    bridge
        .requests
        .try_iter()
        .filter_map(|request| match request {
            Request::Input(bytes) => Some(bytes),
            Request::Resize(_, _) => None,
        })
        .collect()
}
#[gpui::test]
fn native_color_queries_follow_the_current_theme_and_reply_only_to_the_owning_terminal(
    cx: &mut TestAppContext,
) {
    let a = Rc::new(RefCell::new(None));
    let b = Rc::new(RefCell::new(None));
    let first = cx.add_window({
        let bridge = a.clone();
        move |window, cx| {
            TerminalView::start(
                move |wake| {
                    let (terminal, outlet) = Terminal::bridged(wake);
                    *bridge.borrow_mut() = Some(outlet);
                    terminal
                },
                true,
                window,
                cx,
            )
        }
    });
    let second = cx.add_window({
        let bridge = b.clone();
        move |window, cx| {
            TerminalView::start(
                move |wake| {
                    let (terminal, outlet) = Terminal::bridged(wake);
                    *bridge.borrow_mut() = Some(outlet);
                    terminal
                },
                true,
                window,
                cx,
            )
        }
    });
    cx.update(|cx| {
        let mut appearance = crate::ui::appearance::Appearance::default();
        appearance.palette.terminal_fg = rgb(0x6d665d);
        appearance.palette.terminal_bg = rgb(0xfbfaf7);
        cx.set_global(appearance);
    });
    let first_bridge = a.borrow_mut().take().unwrap();
    let second_bridge = b.borrow_mut().take().unwrap();
    first_bridge.outlet.send(Event::Started {
        input_shell: "/fixture/zsh".into(),
    });
    cx.run_until_parked();
    first
        .update(cx, |s, _, _| {
            assert!(s.startup.covered());
            assert_eq!(s.shell, "/fixture/zsh");
        })
        .unwrap();
    first_bridge.outlet.send(Event::Data(
        b"before\x1b]10;?\x1b\\middle\x1b]11;?\x1b\\after".to_vec(),
    ));
    cx.run_until_parked();
    cx.run_until_parked();
    assert_eq!(
        inputs(&first_bridge),
        [
            b"\x1b]10;rgb:6d6d/6666/5d5d\x1b\\".to_vec(),
            b"\x1b]11;rgb:fbfb/fafa/f7f7\x1b\\".to_vec()
        ]
    );
    assert!(inputs(&second_bridge).is_empty());
    first
        .update(cx, |s, _, _| {
            assert_eq!(s.screen_text(), "beforemiddleafter")
        })
        .unwrap();
    second
        .update(cx, |s, _, _| assert!(s.screen_text().is_empty()))
        .unwrap();
    cx.update(|cx| {
        let mut appearance = crate::ui::appearance::Appearance::default();
        appearance.palette.terminal_fg = rgb(0xd1cec6);
        appearance.palette.terminal_bg = rgb(0x161413);
        cx.set_global(appearance);
    });
    first_bridge.outlet.send(Event::Data(b"\x1b]10;".to_vec()));
    cx.run_until_parked();
    assert!(inputs(&first_bridge).is_empty());
    first_bridge
        .outlet
        .send(Event::Data(b"?\x07\x1b]11;?\x07".to_vec()));
    cx.run_until_parked();
    assert_eq!(
        inputs(&first_bridge),
        [
            b"\x1b]10;rgb:d1d1/cece/c6c6\x1b\\".to_vec(),
            b"\x1b]11;rgb:1616/1414/1313\x1b\\".to_vec()
        ]
    );
    assert!(inputs(&second_bridge).is_empty());
    first
        .update(cx, |s, _, _| {
            assert_eq!(s.screen_text(), "beforemiddleafter")
        })
        .unwrap();
    first
        .update(cx, |s, _, _| assert!(s.startup.covered()))
        .unwrap();
    first_bridge
        .outlet
        .send(Event::Data(b"\x1b[?1049h".to_vec()));
    cx.run_until_parked();
    first
        .update(cx, |s, _, _| {
            assert!(!s.startup.covered());
            assert!(s.startup_timer.is_none());
        })
        .unwrap();
}

#[gpui::test]
fn native_agent_cover_blocks_user_input_but_reveals_on_first_tui_and_cancels_its_timer(
    cx: &mut TestAppContext,
) {
    let bridge = Rc::new(RefCell::new(None));
    let (view, cx) = cx.add_window_view({
        let bridge = bridge.clone();
        move |window, cx| {
            TerminalView::start(
                move |wake| {
                    let (terminal, outlet) = Terminal::bridged(wake);
                    *bridge.borrow_mut() = Some(outlet);
                    terminal
                },
                true,
                window,
                cx,
            )
        }
    });
    let bridge = bridge.borrow_mut().take().unwrap();
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    assert!(cx.debug_bounds("terminal-startup-cover").is_some());
    view.update(cx, |s, cx| {
        assert_eq!(s.status(), SessionStatus::Starting);
        s.input(b"must not reach shell".to_vec(), cx);
    });
    assert!(inputs(&bridge).is_empty());
    view.update_in(cx, |s, window, cx| {
        gpui::EntityInputHandler::replace_and_mark_text_in_range(
            s,
            None,
            "composition",
            None,
            window,
            cx,
        );
        assert!(
            s.marked.is_empty(),
            "the startup cover must not accept IME composition"
        );
    });
    bridge.outlet.send(Event::Started {
        input_shell: "/bin/zsh".into(),
    });
    bridge
        .outlet
        .send(Event::Data(b"shell prompt and echoed command".to_vec()));
    cx.run_until_parked();
    view.read_with(cx, |s, _| assert!(s.startup.covered()));
    bridge.outlet.send(Event::Data(b"\x1b[?10".to_vec()));
    cx.run_until_parked();
    view.read_with(cx, |s, _| assert!(s.startup.covered()));
    bridge.outlet.send(Event::Data(b"49hready".to_vec()));
    cx.run_until_parked();
    cx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    assert!(cx.debug_bounds("terminal-startup-cover").is_none());
    view.update(cx, |s, cx| {
        assert_eq!(s.status(), SessionStatus::Running);
        assert!(s.startup_timer.is_none());
        assert_eq!(s.screen_text(), "ready");
        s.input(b"usable\r".to_vec(), cx);
    });
    assert_eq!(inputs(&bridge), vec![b"usable\r".to_vec()]);
}
#[gpui::test]
fn native_startup_timeout_begins_at_pty_start_and_exit_or_error_removes_the_cover(
    cx: &mut TestAppContext,
) {
    let bridge = Rc::new(RefCell::new(None));
    let (view, cx) = cx.add_window_view({
        let bridge = bridge.clone();
        move |window, cx| {
            TerminalView::start(
                move |wake| {
                    let (terminal, outlet) = Terminal::bridged(wake);
                    *bridge.borrow_mut() = Some(outlet);
                    terminal
                },
                true,
                window,
                cx,
            )
        }
    });
    let bridge = bridge.borrow_mut().take().unwrap();
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_secs(10));
    cx.run_until_parked();
    view.read_with(cx, |s, _| {
        assert!(s.startup.covered());
        assert!(s.startup_timer.is_none());
    });
    bridge.outlet.send(Event::Started {
        input_shell: "/bin/bash".into(),
    });
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(2399));
    cx.run_until_parked();
    view.read_with(cx, |s, _| assert!(s.startup.covered()));
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    view.read_with(cx, |s, _| {
        assert!(!s.startup.covered());
        assert!(s.startup_timer.is_none());
    });
    for event in [Event::Exit(1), Event::Error("fixture failure".into())] {
        view.update(cx, |s, cx| {
            s.startup = startup::Startup::agent();
            s.begin_startup(cx);
        });
        bridge.outlet.send(event);
        cx.run_until_parked();
        view.read_with(cx, |s, _| {
            assert!(!s.startup.covered());
            assert!(s.startup_timer.is_none());
            assert!(!s.running);
        });
    }
}

#[cfg(target_os = "macos")]
#[gpui::test]
fn real_agent_color_handshake_completes_under_the_native_startup_cover(cx: &mut TestAppContext) {
    use crate::platform::terminal::shell::{AgentCommand, Environment, ShellHost};
    cx.executor().allow_parking();
    cx.update(|cx| {
        let mut appearance = crate::ui::appearance::Appearance::default();
        appearance.palette.terminal_fg = rgb(0x6d665d);
        appearance.palette.terminal_bg = rgb(0xfbfaf7);
        cx.set_global(appearance);
    });
    let directory = tempfile::tempdir().unwrap();
    let script = directory.path().join("query-colors.py");
    let receipt = directory.path().join("color-replies");
    std::fs::write(
        &script,
        r#"import os, sys, termios, tty
previous = termios.tcgetattr(0)
try:
    tty.setraw(0)
    replies = b''
    for slot in (10, 11):
        os.write(1, ('\x1b]%d;?\x1b\\' % slot).encode())
        reply = b''
        while not reply.endswith(b'\x1b\\'):
            reply += os.read(0, 1)
            if len(reply) > 128:
                raise RuntimeError('unexpected terminal reply')
        replies += reply
    with open(sys.argv[1], 'wb') as output:
        output.write(replies)
    os.write(1, b'\x1b[?1049hHANDSHAKE_OK')
    while os.read(0, 1) != b'q':
        pass
finally:
    termios.tcsetattr(0, termios.TCSANOW, previous)
"#,
    )
    .unwrap();
    let environment: Environment = [
        (
            "HOME".into(),
            directory.path().to_string_lossy().into_owned(),
        ),
        ("SHELL".into(), "/bin/bash".into()),
        ("PATH".into(), "/usr/bin:/bin".into()),
    ]
    .into();
    let agent = AgentCommand {
        executable_path: "/usr/bin/python3".into(),
        args: vec![
            script.to_string_lossy().into_owned(),
            receipt.to_string_lossy().into_owned(),
        ],
        display_name: Some("Color fixture".into()),
        path_entries: vec![],
        environment: Some(environment.clone()),
    };
    let host = ShellHost::build(Some(&agent), &environment, "darwin").unwrap();
    let owner = format!("native-color-startup-{}", uuid::Uuid::new_v4());
    let child_owner = owner.clone();
    let root = directory.path().to_path_buf();
    let (release, preparation) = std::sync::mpsc::channel();
    let (view, cx) = cx.add_window_view(move |window, cx| {
        TerminalView::start(
            move |wake| {
                Terminal::spawn_shell_prepared(root, "shell", wake, child_owner, move || {
                    preparation.recv().map_err(|e| e.to_string())?;
                    Ok(host)
                })
            },
            true,
            window,
            cx,
        )
    });
    view.read_with(cx, |s, _| assert!(s.startup.covered()));
    release.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        cx.run_until_parked();
        if view.read_with(cx, |s, _| {
            assert!(s.failure.is_none(), "{:?}", s.failure);
            !s.startup.covered() && s.screen_text().contains("HANDSHAKE_OK")
        }) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "real PTY color handshake stalled under the cover"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(
        std::fs::read(&receipt).unwrap(),
        b"\x1b]10;rgb:6d6d/6666/5d5d\x1b\\\x1b]11;rgb:fbfb/fafa/f7f7\x1b\\"
    );
    view.update(cx, |s, cx| {
        assert!(s.startup_timer.is_none());
        s.input(b"q".to_vec(), cx);
    });
    let released = view.downgrade();
    cx.update(|window, _| window.remove_window());
    drop(view);
    // GPUI drains deferred entity releases during an App update, not merely
    // while parking its executor after the last strong handle is dropped.
    cx.cx.update(|_| ());
    cx.run_until_parked();
    assert!(
        released.upgrade().is_none(),
        "closed window retained its TerminalView"
    );
    while crate::platform::host_budget::Budget::global()
        .snapshot()
        .iter()
        .any(|row| row.owner == owner)
    {
        assert!(
            Instant::now() < deadline,
            "real PTY retained its lease after closing the native view"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// `has one canonical query responder even without a display`: the
/// session's own screen answers a cursor position report, exactly once.
#[gpui::test]
fn a_cursor_report_is_answered_once_by_the_session(cx: &mut TestAppContext) {
    let slot = Rc::new(RefCell::new(None));
    cx.add_window({
        let slot = slot.clone();
        move |window, cx| {
            TerminalView::start(
                move |wake| {
                    let (terminal, bridge) = Terminal::bridged(wake);
                    *slot.borrow_mut() = Some(bridge);
                    terminal
                },
                false,
                window,
                cx,
            )
        }
    });
    let bridge = slot.borrow_mut().take().unwrap();
    bridge.outlet.send(Event::Started {
        input_shell: "/bin/zsh".into(),
    });
    bridge.outlet.send(Event::Data(b"\x1b[6n".to_vec()));
    cx.run_until_parked();
    assert_eq!(inputs(&bridge), [b"\x1b[1;1R".to_vec()]);
}

/// `does not reassign terminal font metrics during a color-only refresh`:
/// new terminal colors repaint the session without measuring its grid
/// again or resizing its PTY.
#[gpui::test]
fn a_color_only_theme_change_keeps_the_grid_and_the_pty_size(cx: &mut TestAppContext) {
    let slot = Rc::new(RefCell::new(None));
    let (view, cx) = cx.add_window_view({
        let slot = slot.clone();
        move |window, cx| {
            TerminalView::start(
                move |wake| {
                    let (terminal, bridge) = Terminal::bridged(wake);
                    *slot.borrow_mut() = Some(bridge);
                    terminal
                },
                false,
                window,
                cx,
            )
        }
    });
    let bridge = slot.borrow_mut().take().unwrap();
    let draw = |cx: &mut VisualTestContext| {
        cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        cx.run_until_parked();
    };
    draw(cx);
    let resized = |bridge: &Bridge| {
        bridge
            .requests
            .try_iter()
            .filter(|r| matches!(r, Request::Resize(_, _)))
            .count()
    };
    assert!(resized(&bridge) > 0, "the first frame fits the PTY");
    let grid = view.read_with(cx, |s, _| {
        (s.grid.cell_w, s.grid.cell_h, s.parser.screen().size())
    });
    cx.update(|_, cx| {
        let mut appearance = crate::ui::appearance::Appearance::default();
        appearance.palette.terminal_fg = rgb(0xd1cec6);
        appearance.palette.terminal_bg = rgb(0x161413);
        cx.set_global(appearance);
    });
    // The window repaints its terminal in the new colors.
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    assert_eq!(resized(&bridge), 0);
    assert_eq!(
        view.read_with(cx, |s, _| (
            s.grid.cell_w,
            s.grid.cell_h,
            s.parser.screen().size()
        )),
        grid
    );
}
