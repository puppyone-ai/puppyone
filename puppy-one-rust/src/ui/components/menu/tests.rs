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
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::components::bind_menu_keys(cx);
    });
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
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::components::bind_menu_keys(cx);
    });
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
struct PickerSubmenuHarness {
    outside: Rc<Cell<usize>>,
    picked: Rc<Cell<usize>>,
}
impl Render for PickerSubmenuHarness {
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
    let (_view, cx) = cx.add_window_view(|_, _| PickerSubmenuHarness {
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
    let (_view, cx) = cx.add_window_view(|_, _| PickerSubmenuHarness {
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

/// Two rows with submenus, as the source picker's sources are.
struct SiblingHarness;
impl Render for SiblingHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let mark = |name: &'static str| div().size(px(10.)).debug_selector(move || name.into());
        let level = move |id: &'static str, leaf: &'static str| {
            MenuItem::new(id)
                .id(id)
                .icon_element(mark(id))
                .submenu(move |_, _| {
                    Menu::new(SharedString::from(format!("{id}-level")))
                        .item(MenuItem::new(leaf).id(leaf).icon_element(mark(leaf)))
                })
        };
        div().size_full().child(
            Menu::new("sibling-harness")
                .w(px(200.))
                .item(level("plans", "plan-provider"))
                .item(level("keys", "key-provider")),
        )
    }
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
fn moving_to_a_sibling_row_closes_the_open_submenu_at_once(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (_view, cx) = cx.add_window_view(|_, _| SiblingHarness);
    draw(cx);
    let plans = cx.debug_bounds("plans").unwrap().center();
    cx.simulate_mouse_move(plans, None, Modifiers::default());
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("plan-provider").is_some());
    let keys = cx.debug_bounds("keys").unwrap().center();
    cx.simulate_mouse_move(keys, None, Modifiers::default());
    cx.run_until_parked();
    draw(cx);
    // No grace period: only the new row's submenu shows.
    assert!(cx.debug_bounds("plan-provider").is_none());
    assert!(cx.debug_bounds("key-provider").is_some());
}

#[gpui::test]
fn clicking_submenu_item_runs_action_before_parent_menu_dismisses(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::components::bind_menu_keys(cx);
    });
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

/// A keyboard menu with a submenu row between two actions, and a choice
/// menu whose current choice is the second.
struct KeyboardHarness {
    choices: bool,
}
impl Render for KeyboardHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let choices = self.choices;
        PopoverMenu::new("keys")
            .trigger(Button::new("keys-trigger").label("Open"))
            .menu(move |menu, _, _| {
                let menu = menu.keyboard_navigation();
                if choices {
                    return menu
                        .item(
                            MenuItem::new("One")
                                .id("one")
                                .radio(false)
                                .on_click(|_, _| {}),
                        )
                        .item(
                            MenuItem::new("Two")
                                .id("two")
                                .radio(true)
                                .on_click(|_, _| {}),
                        );
                }
                menu.item(MenuItem::new("First").id("first").on_click(|_, _| {}))
                    .item(MenuItem::new("More").id("more").submenu(|_, _| {
                        Menu::new("keys-more")
                            .item(MenuItem::new("Custom").id("custom").on_click(|_, _| {}))
                    }))
                    .item(MenuItem::new("Last").id("last").on_click(|_, _| {}))
            })
    }
}
fn keys(cx: &mut TestAppContext, choices: bool) -> &mut VisualTestContext {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::components::bind_menu_keys(cx);
    });
    let (_, cx) = cx.add_window_view(|_, _| KeyboardHarness { choices });
    draw(cx);
    cx.update(|w, cx| w.click("keys-trigger", cx));
    draw(cx);
    cx
}
fn focused(cx: &mut VisualTestContext, id: &'static str) -> bool {
    cx.update(|w, _| w.try_find(id).and_then(|e| e.focused()) == Some(true))
}
fn press(cx: &mut VisualTestContext, keys: &str) {
    cx.simulate_keystrokes(keys);
    draw(cx);
}

/// `createEntryMenu.test.tsx`: `opens Custom files from focus and returns
/// to its trigger with ArrowLeft`; `sidebarMenuHandoff.test.tsx`: `uses
/// Escape to close the creation submenu before dismissing its parent`.
#[gpui::test]
fn a_submenu_opens_on_focus_is_entered_and_left_and_escape_closes_it_first(
    cx: &mut TestAppContext,
) {
    let cx = keys(cx, false);
    assert!(focused(cx, "first"));
    // Focus on its row opens the submenu, and focus stays on the row.
    press(cx, "down");
    assert!(focused(cx, "more"));
    cx.update(|w, _| assert!(w.try_find("custom").is_some(), "open on focus"));
    // ArrowRight moves in; ArrowLeft closes it and returns to its row.
    press(cx, "right");
    assert!(focused(cx, "custom"));
    press(cx, "left");
    assert!(focused(cx, "more"));
    cx.update(|w, _| assert!(w.try_find("custom").is_none()));
    // Escape inside closes only the submenu; the next closes the menu.
    press(cx, "enter");
    assert!(focused(cx, "custom"));
    press(cx, "escape");
    assert!(focused(cx, "more"));
    cx.update(|w, _| {
        assert!(w.try_find("custom").is_none());
        assert!(w.try_find("first").is_some(), "the menu stays open");
    });
    press(cx, "escape");
    cx.update(|w, _| assert!(w.try_find("first").is_none()));
    assert!(focused(cx, "keys-trigger"));
    // A submenu opened with the pointer also closes before its menu.
    cx.update(|w, cx| w.click("keys-trigger", cx));
    draw(cx);
    cx.update(|w, cx| w.click("more", cx));
    draw(cx);
    cx.update(|w, _| assert!(w.try_find("custom").is_some()));
    press(cx, "escape");
    cx.update(|w, _| {
        assert!(w.try_find("custom").is_none());
        assert!(w.try_find("first").is_some());
    });
    press(cx, "escape");
    cx.update(|w, _| assert!(w.try_find("first").is_none()));
}

/// `projectRowActionsFocus.test.tsx`: `closes the menu on Tab and hands
/// focus back to its button` (and from inside a submenu).
#[gpui::test]
fn tab_closes_the_menu_and_hands_focus_back_to_its_trigger(cx: &mut TestAppContext) {
    let cx = keys(cx, false);
    press(cx, "end");
    assert!(focused(cx, "last"));
    press(cx, "tab");
    cx.update(|w, _| assert!(w.try_find("first").is_none()));
    assert!(focused(cx, "keys-trigger"));
    cx.update(|w, cx| w.click("keys-trigger", cx));
    draw(cx);
    press(cx, "down right");
    assert!(focused(cx, "custom"));
    press(cx, "shift-tab");
    cx.update(|w, _| {
        assert!(w.try_find("custom").is_none());
        assert!(w.try_find("first").is_none());
    });
    assert!(focused(cx, "keys-trigger"));
}

/// `onboardingProjectLayouts.test.tsx`: `marks the current choice and
/// starts the keyboard on it`.
#[gpui::test]
fn the_keyboard_starts_on_the_current_choice_which_is_marked(cx: &mut TestAppContext) {
    let cx = keys(cx, true);
    assert!(focused(cx, "two"));
    cx.update(|w, _| {
        use gpui_kit::test::TestQueryExt as _;
        let radios = w.find_all_by_role(Role::MenuItemRadio);
        let checked: Vec<_> = radios
            .iter()
            .map(|r| (r.label().map(str::to_owned), r.checked()))
            .collect();
        assert_eq!(
            checked,
            [
                (Some("One".into()), Some(false)),
                (Some("Two".into()), Some(true)),
            ]
        );
    });
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
                        .item(MenuItem::new("First Group").id("group-a").submenu(|_, _| {
                            Menu::new("sub-a").item(MenuItem::new("Alpha Action").id("alpha"))
                        }))
                        .item(MenuItem::new("Second Group").id("group-b").submenu(|_, _| {
                            Menu::new("sub-b").item(MenuItem::new("Beta Action").id("beta"))
                        }))
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

struct RequestedSubmenuHarness {
    open: bool,
}
impl Render for RequestedSubmenuHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(
            PopoverMenu::new("requested-submenu")
                .open(self.open)
                .trigger(Button::new("open-requested").label("Open"))
                .menu(|menu, _, _| {
                    menu.w(px(180.))
                        .item(MenuItem::new("Resting Row").id("resting-row"))
                        .item(MenuItem::new("Other Row").id("other-row"))
                        .item(
                            MenuItem::new("Requested Group")
                                .id("requested-group")
                                .open_submenu(true)
                                .submenu(|_, _| {
                                    Menu::new("requested-sub")
                                        .item(MenuItem::new("Requested Action").id("requested"))
                                }),
                        )
                }),
        )
    }
}

#[gpui::test]
fn requested_submenu_stays_open_until_the_pointer_moves_onto_a_plain_row(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(|_, _| RequestedSubmenuHarness { open: true });
    draw(cx);
    let resting = cx.debug_bounds("menu-item:Resting Row").unwrap();
    let other = cx.debug_bounds("menu-item:Other Row").unwrap();

    // Leave the pointer where a plain row will appear, then reopen the menu.
    view.update(cx, |v, cx| {
        v.open = false;
        cx.notify();
    });
    draw(cx);
    cx.simulate_mouse_move(resting.center(), None, Modifiers::none());
    view.update(cx, |v, cx| {
        v.open = true;
        cx.notify();
    });
    draw(cx);
    draw(cx);
    assert!(
        cx.debug_bounds("menu-item:Requested Action").is_some(),
        "a row laid out under a resting pointer must not close a requested submenu"
    );

    // The pointer closes it as usual once it really moves onto a plain row.
    cx.simulate_mouse_move(other.center(), None, Modifiers::none());
    draw(cx);
    assert!(
        cx.debug_bounds("menu-item:Requested Action").is_none(),
        "moving onto a plain row must close the requested submenu"
    );
}
