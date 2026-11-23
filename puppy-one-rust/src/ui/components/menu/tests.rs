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
        window.draw(cx).clear(cx);
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

struct SubmenuHarness {
    open: bool,
    anchored: bool,
    calls: Rc<Cell<usize>>,
}
impl Render for SubmenuHarness {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let calls = self.calls.clone();
        let build_menu = move |menu: Menu| {
            let calls = calls.clone();
            menu.item(
                MenuItem::new("Parent")
                    .id("parent-row")
                    .open_submenu(true)
                    .submenu(move |_, _| {
                        let calls = calls.clone();
                        Menu::new("child-submenu").item(
                            MenuItem::new("Child Action")
                                .id("child-action")
                                .on_click(move |_, _| calls.set(calls.get() + 1)),
                        )
                    }),
            )
        };
        if self.anchored {
            let view = cx.entity().downgrade();
            div().size_full().when(self.open, |d| {
                d.child(
                    crate::ui::components::AnchoredMenu::new(
                        "anchored-sub",
                        point(px(40.), px(40.)),
                        build_menu(Menu::new("anchored-sub-menu").w(px(160.))),
                    )
                    .on_dismiss(move |_, cx| {
                        let _ = view.update(cx, |s, cx| {
                            s.open = false;
                            cx.notify();
                        });
                    }),
                )
            })
        } else {
            let view = cx.entity().downgrade();
            div().size_full().child(
                PopoverMenu::new("popover-sub")
                    .open(self.open)
                    .on_open_change(move |opened, _, cx| {
                        let _ = view.update(cx, |s, cx| {
                            s.open = *opened;
                            cx.notify();
                        });
                    })
                    .trigger(Button::new("open-sub").label("Open"))
                    .menu(move |menu, _, _| build_menu(menu.w(px(160.)))),
            )
        }
    }
}

struct CachedSubmenuHost {
    inner: Entity<SubmenuHarness>,
}
impl Render for CachedSubmenuHost {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(
            self.inner
                .clone()
                .cached(StyleRefinement::default().size_full()),
        )
    }
}

#[gpui::test]
fn clicking_submenu_item_runs_action_before_parent_menu_dismisses(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    for anchored in [true, false] {
        let calls = Rc::new(Cell::new(0));
        let mut inner = None;
        let (_, cx) = cx.add_window_view(|_, cx| {
            let view = cx.new(|_| SubmenuHarness {
                open: true,
                anchored,
                calls: calls.clone(),
            });
            inner = Some(view.clone());
            CachedSubmenuHost { inner: view }
        });
        let view = inner.unwrap();
        draw(cx);
        draw(cx);
        // Third draw exercises a pure cached-view replay frame where
        // `SubmenuRow::render` does not run.
        draw(cx);
        let bounds = cx.debug_bounds("menu-item:Child Action").unwrap();
        assert!(
            bounds.origin.x > px(100.),
            "submenu must reposition beside the trigger row (bounds={bounds:?})"
        );
        cx.simulate_click(bounds.center(), Modifiers::none());
        draw(cx);
        assert_eq!(
            calls.get(),
            1,
            "submenu item click must run action (anchored={anchored}, bounds={bounds:?})"
        );
        if !anchored {
            view.read_with(cx, |v, _| assert!(!v.open, "popover submenu must dismiss"));
        } else {
            // Clicking outside both the anchored menu and its submenu still dismisses.
            cx.simulate_click(point(px(900.), px(500.)), Modifiers::none());
            draw(cx);
            view.read_with(cx, |v, _| assert!(!v.open, "outside click must dismiss"));
        }
    }
}

struct SiblingSubmenusHarness;
impl Render for SiblingSubmenusHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(
            PopoverMenu::new("sibling-submenus")
                .open(true)
                .trigger(Button::new("open-siblings").label("Open"))
                .menu(|menu, _, _| {
                    menu.w(px(180.))
                        .item(
                            MenuItem::new("First Group")
                                .id("group-a")
                                .submenu(|_, _| {
                                    Menu::new("sub-a")
                                        .item(MenuItem::new("Alpha Action").id("alpha"))
                                }),
                        )
                        .item(
                            MenuItem::new("Second Group")
                                .id("group-b")
                                .submenu(|_, _| {
                                    Menu::new("sub-b")
                                        .item(MenuItem::new("Beta Action").id("beta"))
                                }),
                        )
                        .item(MenuItem::new("Direct Settings").id("direct-settings"))
                }),
        )
    }
}

#[gpui::test]
fn hovering_sibling_row_switches_or_closes_submenu_immediately(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (_, cx) = cx.add_window_view(|_, _| SiblingSubmenusHarness);
    draw(cx);

    let row_a = cx.debug_bounds("menu-item:First Group").unwrap();
    let row_b = cx.debug_bounds("menu-item:Second Group").unwrap();
    let direct = cx.debug_bounds("menu-item:Direct Settings").unwrap();

    cx.simulate_mouse_move(row_a.center(), None, Modifiers::none());
    draw(cx);
    assert!(cx.debug_bounds("menu-item:Alpha Action").is_some());
    assert!(cx.debug_bounds("menu-item:Beta Action").is_none());

    // Moving to a sibling submenu switches on the next frame with zero overlap.
    cx.simulate_mouse_move(row_b.center(), None, Modifiers::none());
    draw(cx);
    assert!(
        cx.debug_bounds("menu-item:Alpha Action").is_none(),
        "previous sibling submenu must close immediately"
    );
    assert!(
        cx.debug_bounds("menu-item:Beta Action").is_some(),
        "newly hovered sibling submenu must open immediately"
    );

    // Moving to a non-submenu row closes any open submenu immediately.
    cx.simulate_mouse_move(direct.center(), None, Modifiers::none());
    draw(cx);
    assert!(
        cx.debug_bounds("menu-item:Beta Action").is_none(),
        "open submenu must close immediately when hovering a plain sibling item"
    );
}
