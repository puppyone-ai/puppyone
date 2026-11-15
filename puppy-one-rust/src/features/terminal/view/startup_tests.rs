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
}
