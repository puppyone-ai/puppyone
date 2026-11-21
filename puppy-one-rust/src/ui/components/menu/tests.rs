use super::*;
use crate::ui::components::{Button, PopoverMenu};
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt;
use std::cell::Cell;

struct Harness {
    enabled: bool,
    last_enabled: bool,
    calls: Rc<Cell<usize>>,
}
impl Render for Harness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let enabled = self.enabled;
        let last_enabled = self.last_enabled;
        let calls = self.calls.clone();
        PopoverMenu::new("keyboard-menu")
            .trigger(Button::new("trigger").label("Open"))
            .menu(move |menu, _, _| {
                menu.keyboard_navigation()
                    .item(
                        MenuItem::new("First")
                            .id("first")
                            .disabled(!enabled)
                            .stay_open()
                            .on_click(|_, _| {}),
                    )
                    .separator()
                    .item(
                        MenuItem::new("Unavailable")
                            .id("disabled")
                            .disabled(true)
                            .on_click(|_, _| panic!("disabled action ran")),
                    )
                    .item(MenuItem::new("Information").id("fact").fact(true))
                    .list(
                        2.,
                        [MenuItem::new("Last")
                            .id("last")
                            .disabled(!last_enabled)
                            .on_click(move |_, _| calls.set(calls.get() + 1))],
                    )
            })
    }
}
fn draw(cx: &mut VisualTestContext) {
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
}

#[gpui::test]
fn keyboard_menu_skips_unavailable_rows_and_recovers_when_the_focused_row_is_disabled(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    let calls = Rc::new(Cell::new(0));
    let (view, cx) = cx.add_window_view(|_, _| Harness {
        enabled: true,
        last_enabled: true,
        calls: calls.clone(),
    });
    draw(cx);
    cx.update(|w, cx| w.click("trigger", cx));
    draw(cx);
    cx.update(|w, _| assert_eq!(w.find("first").focused(), Some(true)));
    for (key, id) in [
        ("down", "last"),
        ("down", "first"),
        ("up", "last"),
        ("home", "first"),
    ] {
        cx.simulate_keystrokes(key);
        draw(cx);
        cx.update(|w, _| assert_eq!(w.find(id).focused(), Some(true)));
        assert_eq!(calls.get(), 0, "navigation must not activate a command");
    }
    view.update(cx, |view, cx| {
        view.enabled = false;
        cx.notify();
    });
    draw(cx);
    cx.update(|w, _| assert_eq!(w.find("last").focused(), Some(true)));
    cx.simulate_keystrokes("down up");
    draw(cx);
    cx.update(|w, _| assert_eq!(w.find("last").focused(), Some(true)));
    cx.simulate_keystrokes("enter");
    draw(cx);
    assert_eq!(calls.get(), 1);
    cx.update(|w, _| {
        assert!(w.try_find("last").is_none());
        assert_eq!(w.find("trigger").focused(), Some(true));
    });
}

#[gpui::test]
fn keyboard_menu_with_no_enabled_rows_still_dismisses_and_returns_focus(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(|_, _| Harness {
        enabled: true,
        last_enabled: true,
        calls: Rc::new(Cell::new(0)),
    });
    draw(cx);
    cx.update(|w, cx| w.click("trigger", cx));
    draw(cx);
    view.update(cx, |view, cx| {
        view.enabled = false;
        view.last_enabled = false;
        cx.notify();
    });
    draw(cx);
    cx.simulate_keystrokes("down up home end enter space escape");
    draw(cx);
    cx.update(|w, _| {
        assert!(w.try_find("first").is_none());
        assert_eq!(w.find("trigger").focused(), Some(true));
    });
    view.read_with(cx, |view, _| assert_eq!(view.calls.get(), 0));
    // A fresh menu with only disabled rows also retains its dismissal scope.
    cx.update(|w, cx| w.click("trigger", cx));
    draw(cx);
    cx.simulate_keystrokes("escape");
    draw(cx);
    cx.update(|w, _| {
        assert!(w.try_find("first").is_none());
        assert_eq!(w.find("trigger").focused(), Some(true));
    });
}

/// A menu that closes on a press outside it, with one row opening a
/// submenu, as the agent panel's source picker is.
struct SubmenuHarness {
    outside: Rc<Cell<usize>>,
    picked: Rc<Cell<usize>>,
}
impl Render for SubmenuHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let outside = self.outside.clone();
        let picked = self.picked.clone();
        let mark = |name: &'static str| div().size(px(10.)).debug_selector(move || name.into());
        div().size_full().child(
            Menu::new("submenu-harness")
                .w(px(200.))
                .on_mouse_down_out(move |_, _, _| outside.set(outside.get() + 1))
                .item(
                    MenuItem::new("Plans")
                        .id("plans")
                        .icon_element(mark("plans-row"))
                        .submenu(move |_, _| {
                            let picked = picked.clone();
                            Menu::new("submenu-harness-level").item(
                                MenuItem::new("Provider")
                                    .id("provider")
                                    .icon_element(mark("provider-row"))
                                    .on_click(move |_, _| picked.set(picked.get() + 1)),
                            )
                        }),
                ),
        )
    }
}

#[gpui::test]
fn a_submenu_stays_open_under_the_pointer_and_takes_its_click(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let outside = Rc::new(Cell::new(0));
    let picked = Rc::new(Cell::new(0));
    let (_view, cx) = cx.add_window_view(|_, _| SubmenuHarness {
        outside: outside.clone(),
        picked: picked.clone(),
    });
    draw(cx);
    let row = cx.debug_bounds("plans-row").unwrap().center();
    cx.simulate_mouse_move(row, None, Modifiers::default());
    cx.run_until_parked();
    draw(cx);
    let provider = cx
        .debug_bounds("provider-row")
        .expect("hovering the row opens its submenu")
        .center();
    // Into the submenu and resting there: it stays open.
    cx.simulate_mouse_move(provider, None, Modifiers::default());
    cx.executor().advance_clock(Duration::from_millis(400));
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("provider-row").is_some());
    // Its row is clicked, not taken for a press outside the menu.
    cx.simulate_click(provider, Modifiers::default());
    cx.run_until_parked();
    assert_eq!((picked.get(), outside.get()), (1, 0));
}

#[gpui::test]
fn a_submenu_closes_once_the_pointer_leaves_it_and_its_row(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (_view, cx) = cx.add_window_view(|_, _| SubmenuHarness {
        outside: Rc::new(Cell::new(0)),
        picked: Rc::new(Cell::new(0)),
    });
    draw(cx);
    let row = cx.debug_bounds("plans-row").unwrap().center();
    cx.simulate_mouse_move(row, None, Modifiers::default());
    cx.run_until_parked();
    draw(cx);
    let provider = cx.debug_bounds("provider-row").unwrap().center();
    cx.simulate_mouse_move(provider, None, Modifiers::default());
    cx.run_until_parked();
    // Away from both, below the menu.
    cx.simulate_mouse_move(point(row.x, px(400.)), None, Modifiers::default());
    cx.executor().advance_clock(Duration::from_millis(400));
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("provider-row").is_none());
}
