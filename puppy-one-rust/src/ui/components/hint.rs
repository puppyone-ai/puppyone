//! `DesktopTooltipLayer`'s keyboard half. A control's hint opens when the
//! keyboard moves focus onto it — not when a pointer press does — below the
//! control, and stays while it keeps that focus. Escape dismisses it until
//! focus moves on. Hover hints are GPUI's own (`tooltip`). An open hint is
//! the control's AccessKit tooltip, named by its text (`role="tooltip"`).
use super::surface::child_id;
use gpui::{prelude::*, *};
use std::collections::HashMap;

/// Per window, the focus whose hint Escape dismissed.
#[derive(Default)]
struct Dismissed(HashMap<WindowId, WeakFocusHandle>);
impl Global for Dismissed {}

/// Escape dismisses the focused control's hint; focus moving on forgets
/// that.
pub fn bind(cx: &mut App) {
    cx.observe_keystrokes(|event, window, cx| {
        let id = window.window_handle().window_id();
        let focused = window.focused(cx);
        let dismissed = &mut cx.default_global::<Dismissed>().0;
        if event.keystroke.key == "escape" {
            if let Some(focused) = focused {
                dismissed.insert(id, focused.downgrade());
                window.refresh();
            }
        } else if dismissed
            .get(&id)
            .is_some_and(|held| held.upgrade() != focused)
        {
            dismissed.remove(&id);
        }
    })
    .detach();
}

/// Whether `focus`'s hint is open: the keyboard moved focus there, and
/// Escape has not dismissed it.
pub(super) fn open(focus: &FocusHandle, window: &Window, cx: &App) -> bool {
    focus.is_focused(window)
        && window.last_input_was_keyboard()
        && !cx.try_global::<Dismissed>().is_some_and(|dismissed| {
            dismissed
                .0
                .get(&window.window_handle().window_id())
                .and_then(WeakFocusHandle::upgrade)
                .is_some_and(|held| held == *focus)
        })
}

/// `id`'s hint `text`, below it on the overlay layer; the hint is the same
/// view a hover opens.
pub(super) fn below(
    id: &ElementId,
    text: SharedString,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let name = text.clone();
    let shown = window.use_keyed_state(child_id(id, "focus-hint"), cx, |_, _| {
        None::<(SharedString, AnyView)>
    });
    let view = match shown.read(cx).as_ref().filter(|(was, _)| *was == text) {
        Some((_, view)) => view.clone(),
        None => {
            let view = super::tooltip(text.clone())(window, cx);
            shown.update(cx, |shown, _| *shown = Some((text, view.clone())));
            view
        }
    };
    div()
        .id(child_id(id, "hint"))
        .role(Role::Tooltip)
        .aria_label(name)
        .test_support()
        .absolute()
        .top_full()
        .left_0()
        .child(
            deferred(anchored().snap_to_window_with_margin(px(8.)).child(view))
                .with_priority(gpui_kit::base::POPUP_PRIORITY + 1),
        )
        .into_any_element()
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::components::{Button, IconButton};
    use core::prelude::v1::test;
    use gpui_kit::test::TestQueryExt as _;

    struct Harness {
        new: FocusHandle,
        other: FocusHandle,
        search: FocusHandle,
    }
    impl Render for Harness {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
                .flex()
                .gap(px(40.))
                .p(px(40.))
                .child(
                    IconButton::new("new", "plus")
                        .label("New")
                        .track_focus(&self.new)
                        .debug_selector(|| "new".into()),
                )
                .child(
                    IconButton::new("other", "history")
                        .label("History")
                        .track_focus(&self.other),
                )
                .child(
                    Button::new("search")
                        .label("Find")
                        .tooltip("Search")
                        .track_focus(&self.search),
                )
        }
    }
    fn setup(cx: &mut TestAppContext) -> (Entity<Harness>, &mut VisualTestContext) {
        cx.update(crate::ui::input::bind_keys);
        cx.add_window_view(|_, cx| Harness {
            new: cx.focus_handle(),
            other: cx.focus_handle(),
            search: cx.focus_handle(),
        })
    }
    /// Every open hint, by its text.
    fn hints(cx: &mut VisualTestContext) -> Vec<String> {
        cx.update(|window, cx| {
            window.draw(cx).clear(cx);
            window
                .find_all_by_role(Role::Tooltip)
                .iter()
                .map(|hint| hint.label().unwrap_or_default().to_owned())
                .collect()
        })
    }
    /// The keyboard is in use, and moves focus to `focus`.
    fn tab_to(focus: &FocusHandle, cx: &mut VisualTestContext) {
        cx.simulate_keystrokes("shift-a");
        cx.update(|window, cx| focus.focus(window, cx));
    }

    /// `DesktopTooltipLayer`: `opens on keyboard focus and dismisses on
    /// Escape`. Escape keeps it closed while focus stays; focus moving on
    /// and back opens it again.
    #[gpui::test]
    fn keyboard_focus_opens_the_hint_and_escape_dismisses_it(cx: &mut TestAppContext) {
        let (view, cx) = setup(cx);
        let (new, other, search) = view.read_with(cx, |h, _| {
            (h.new.clone(), h.other.clone(), h.search.clone())
        });
        assert!(hints(cx).is_empty());
        tab_to(&new, cx);
        assert_eq!(hints(cx), ["New"]);
        let hint = cx.debug_bounds("tooltip").expect("the hint is drawn");
        let button = cx.debug_bounds("new").unwrap();
        assert!(hint.top() >= button.bottom(), "below its control");
        cx.simulate_keystrokes("escape");
        assert!(hints(cx).is_empty());
        cx.simulate_keystrokes("shift-a");
        assert!(hints(cx).is_empty(), "still dismissed while focus stays");
        tab_to(&other, cx);
        assert_eq!(hints(cx), ["History"]);
        tab_to(&new, cx);
        assert_eq!(hints(cx), ["New"]);
        // A labelled button's hint is its tooltip.
        tab_to(&search, cx);
        assert_eq!(hints(cx), ["Search"]);
    }

    /// `does not reopen immediately when a pointer press focuses the
    /// trigger`.
    #[gpui::test]
    fn a_pointer_press_that_focuses_the_control_opens_no_hint(cx: &mut TestAppContext) {
        let (view, cx) = setup(cx);
        let new = view.read_with(cx, |h, _| h.new.clone());
        hints(cx);
        let button = cx.debug_bounds("new").unwrap();
        cx.simulate_click(button.center(), Modifiers::none());
        assert!(
            cx.update(|window, _| new.is_focused(window)),
            "the press focused it"
        );
        assert!(hints(cx).is_empty());
        assert!(cx.debug_bounds("tooltip").is_none());
    }
}
