#![cfg(test)]
use super::*;
use crate::features::updates::{Status, UpdateState};
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt;
use std::cell::Cell;

struct Harness {
    state: Option<UpdateState>,
    clicks: Rc<Cell<usize>>,
}
impl Render for Harness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let clicks = self.clicks.clone();
        h_flex().tab_group().children(
            UpdateButton::new(self.state.as_ref())
                .map(|button| button.on_click(move |_, _, _| clicks.set(clicks.get() + 1))),
        )
    }
}
fn state(status: Status, automatic: bool) -> UpdateState {
    let mut state = UpdateState::new(
        crate::platform::build_identity::Channel::Stable,
        "1.4.0".into(),
        None,
        automatic,
    );
    state.status = status;
    state.available_version = Some("1.5.0".into());
    state
}
fn draw(cx: &mut VisualTestContext) {
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
}

fn press(cx: &mut VisualTestContext, key: &str) {
    let keystroke = Keystroke::parse(key).unwrap();
    cx.simulate_event(KeyDownEvent {
        keystroke: keystroke.clone(),
        is_held: false,
        prefer_character_input: false,
    });
    cx.simulate_event(KeyUpEvent { keystroke });
}

#[gpui::test]
fn actionable_update_buttons_expose_the_version_and_activate_from_pointer_and_keyboard(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    let clicks = Rc::new(Cell::new(0));
    let (view, cx) = cx.add_window_view(|_, _| Harness {
        state: Some(state(Status::Available, false)),
        clicks: clicks.clone(),
    });
    for status in [Status::Available, Status::Downloaded] {
        view.update(cx, |view, cx| {
            view.state = Some(state(status, false));
            cx.notify();
        });
        draw(cx);
        cx.update(|window, _| {
            let button = window.find("titlebar-update");
            assert_eq!(button.role(), Some(Role::Button));
            assert_ne!(button.disabled(), Some(true));
            assert!(button.label().unwrap().contains("1.5.0"));
        });
        let before = clicks.get();
        cx.update(|window, cx| window.click("titlebar-update", cx));
        draw(cx);
        assert_eq!(clicks.get(), before + 1);
        cx.update(|window, _| assert_eq!(window.find("titlebar-update").focused(), Some(true)));
        press(cx, "enter");
        press(cx, "space");
        draw(cx);
        assert_eq!(clicks.get(), before + 3);
    }
    view.update(cx, |view, cx| {
        view.state = Some(state(Status::Installing, false));
        cx.notify();
    });
    draw(cx);
    let before = clicks.get();
    cx.update(|window, cx| {
        let button = window.find("titlebar-update");
        assert_eq!(button.role(), Some(Role::Button));
        assert_eq!(button.disabled(), Some(true));
        window.click("titlebar-update", cx);
    });
    press(cx, "enter");
    press(cx, "space");
    draw(cx);
    assert_eq!(
        clicks.get(),
        before,
        "installing must ignore all activation"
    );
    view.update(cx, |view, cx| {
        view.state = Some(state(Status::Downloaded, false));
        cx.notify();
    });
    draw(cx);
    cx.update(|window, cx| window.focus_next(cx));
    press(cx, "enter");
    assert_eq!(
        clicks.get(),
        before + 1,
        "a cancelled restart becomes interactive again"
    );
}

#[gpui::test]
fn absent_capability_and_nonactionable_update_states_render_no_titlebar_command(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    assert!(UpdateButton::new(None).is_none());
    let (view, cx) = cx.add_window_view(|_, _| Harness {
        state: None,
        clicks: Rc::new(Cell::new(0)),
    });
    draw(cx);
    cx.update(|window, _| assert!(window.try_find("titlebar-update").is_none()));
    for status in [
        Status::Disabled,
        Status::Idle,
        Status::Checking,
        Status::NotAvailable,
        Status::Available,
        Status::Downloading,
        Status::Error,
    ] {
        assert!(UpdateButton::new(Some(&state(status, true))).is_none());
        view.update(cx, |view, cx| {
            view.state = Some(state(status, true));
            cx.notify();
        });
        draw(cx);
        cx.update(|window, _| assert!(window.try_find("titlebar-update").is_none(), "{status:?}"));
    }
}
