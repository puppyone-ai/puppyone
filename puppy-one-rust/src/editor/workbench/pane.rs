//! Pane chrome (editor-workbench EditorPaneChrome / EditorPaneActionsMenu,
//! desktop-editor-split-view.css): the ⋯ handle centred 4px below the pane's
//! top edge — revealed while the pointer is in the pane's leading third, over
//! the handle, or while its menu is open — and the actions menu anchored
//! 4px below it: the editor's segmented mode control, find, open in the
//! default app and close, then the editor's view toggles and commands.
use crate::{
    localization::t,
    theme::{self, Theme, metric},
    ui::components::{Icon, tooltip},
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use std::rc::Rc;

/// `PANE_HANDLE_REVEAL_RATIO`.
pub const REVEAL_RATIO: f32 = 1. / 3.;
const MENU_MAX_HEIGHT: f32 = 360.;
const ACTION: f32 = 28.;

#[derive(Clone, Debug, PartialEq)]
pub struct Segment {
    pub id: &'static str,
    pub icon: &'static str,
    pub label: SharedString,
}

/// `EditorPaneMenuSegmentedControl`.
#[derive(Clone, Debug, PartialEq)]
pub struct Segmented {
    pub label: SharedString,
    pub options: Vec<Segment>,
    pub value: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ItemKind {
    /// Toggles keep the menu open.
    Toggle(bool),
    Command {
        disabled: bool,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: &'static str,
    pub label: SharedString,
    pub kind: ItemKind,
}

/// What the pane's editor contributes (`EditorPaneMenuContribution` plus
/// the find command and the external opener).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Contribution {
    pub segmented: Option<Segmented>,
    pub items: Vec<Item>,
    pub find: bool,
    pub open_external: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Segment(&'static str),
    Find,
    OpenExternal,
    Close,
    Item(&'static str),
}

impl Contribution {
    /// Every focusable menu item in order, with what it does.
    pub fn entries(&self) -> Vec<Action> {
        let mut out: Vec<Action> = self
            .segmented
            .iter()
            .flat_map(|s| s.options.iter().map(|o| Action::Segment(o.id)))
            .collect();
        if self.find {
            out.push(Action::Find);
        }
        if self.open_external {
            out.push(Action::OpenExternal);
        }
        out.push(Action::Close);
        out.extend(
            self.items
                .iter()
                .filter(|i| !matches!(i.kind, ItemKind::Command { disabled: true }))
                .map(|i| Action::Item(i.id)),
        );
        out
    }

    /// Whether running an entry closes the menu (`runAndClose`; toggles and
    /// segments stay open).
    pub fn closes(&self, action: &Action) -> bool {
        match action {
            Action::Segment(_) => false,
            Action::Item(id) => !self
                .items
                .iter()
                .any(|i| i.id == *id && matches!(i.kind, ItemKind::Toggle(_))),
            _ => true,
        }
    }
}

/// Chrome state owned by the pane.
pub struct PaneChrome {
    pub open: bool,
    /// The pointer is in the reveal zone.
    pub hot: bool,
    pub focus: FocusHandle,
    pub selected: usize,
    /// `:focus-visible` after keyboard navigation.
    pub keyboard: bool,
    /// The menu's scroller.
    pub scroll: ScrollHandle,
}

impl PaneChrome {
    pub fn new(focus: FocusHandle) -> Self {
        Self {
            scroll: ScrollHandle::new(),
            open: false,
            hot: false,
            focus,
            selected: 0,
            keyboard: false,
        }
    }

    pub fn revealed(&self) -> bool {
        self.hot || self.open
    }

    /// `isPointInPaneHandleRevealZone`.
    pub fn reveal_zone(bounds: Bounds<Pixels>, position: Point<Pixels>) -> bool {
        bounds.contains(&position)
            && position.y < bounds.origin.y + bounds.size.height * REVEAL_RATIO
    }

    /// Arrow keys / Home / End over the menu items; returns the entry Enter
    /// / Space activates.
    pub fn key(&mut self, key: &str, count: usize) -> Option<usize> {
        let (selected, moved, run) = menu_key(self.selected, key, count);
        self.selected = selected;
        self.keyboard |= moved;
        run
    }
}

/// One key over `count` menu entries: the new selection, whether it moved,
/// and the entry to run.
pub fn menu_key(selected: usize, key: &str, count: usize) -> (usize, bool, Option<usize>) {
    if count == 0 {
        return (0, false, None);
    }
    let selected = selected.min(count - 1);
    match key {
        "down" | "right" => ((selected + 1) % count, true, None),
        "up" | "left" => ((selected + count - 1) % count, true, None),
        "home" => (0, true, None),
        "end" => (count - 1, true, None),
        "enter" | "space" => (selected, false, Some(selected)),
        _ => (selected, false, None),
    }
}

type OnAction = Rc<dyn Fn(Action, &mut Window, &mut App)>;
type OnDismiss = Rc<dyn Fn(bool, &mut Window, &mut App)>;
type OnKey = Rc<dyn Fn(&KeyDownEvent, &mut Window, &mut App)>;

#[derive(Clone)]
pub struct PaneDrag {
    pub owner: EntityId,
    pub slot: u64,
}
impl Render for PaneDrag {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().px_2().child(t("editor.panes.dragToMove"))
    }
}
/// The handle (`.desktop-editor-pane-handle-shell` / `-handle`).
pub fn handle(
    dark: bool,
    revealed: bool,
    label: SharedString,
    drag: Option<PaneDrag>,
    on_toggle: impl Fn(&mut Window, &mut App) + 'static,
) -> AnyElement {
    let t_ = Theme::new(dark);
    let color = theme::mix(t_.muted, Rgba::default(), 0.68);
    let hover = theme::mix(t_.muted, Rgba::default(), 0.82);
    let dot = || {
        div()
            .size(px(2.))
            .bg(color)
            .group_hover("desktop-editor-pane-handle", move |s| s.bg(hover))
    };
    div()
        .id("desktop-editor-pane-handle-shell")
        .group("desktop-editor-pane-handle-shell")
        .absolute()
        .top(px(4.))
        .left_0()
        .right_0()
        .flex()
        .justify_center()
        .child(
            div()
                .w(px(52.))
                .h(px(20.))
                .flex()
                .justify_center()
                .opacity(if revealed { 1. } else { 0. })
                .hover(|s| s.opacity(1.))
                .child(
                    div()
                        .id("desktop-editor-pane-handle")
                        .group("desktop-editor-pane-handle")
                        .w(px(27.))
                        .h(px(13.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(2.))
                        .cursor(CursorStyle::OpenHand)
                        .tooltip(tooltip(label))
                        .when_some(drag, |d, drag| {
                            d.on_drag(drag, |drag, _, _, cx| cx.new(|_| drag.clone()))
                        })
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(move |_, window, cx| on_toggle(window, cx))
                        .child(dot())
                        .child(dot())
                        .child(dot()),
                ),
        )
        .into_any_element()
}

/// The actions menu: centred under the handle (gap 4), content-sized,
/// within the pane less 8px margins, at most 360px tall.
pub fn menu(
    chrome: &PaneChrome,
    contribution: &Contribution,
    dark: bool,
    pane: Bounds<Pixels>,
    on_action: OnAction,
    on_dismiss: OnDismiss,
    on_key: OnKey,
) -> Option<AnyElement> {
    if !chrome.open {
        return None;
    }
    let t_ = Theme::new(dark);
    let selected = chrome.keyboard.then_some(chrome.selected);
    let mut index = 0;
    let mut next = || {
        let i = index;
        index += 1;
        i
    };
    let icon_button = |id: ElementId,
                       icon: &'static str,
                       label: SharedString,
                       fg: Rgba,
                       hover_bg: Rgba,
                       hover_fg: Rgba,
                       focused: bool,
                       action: Action,
                       on_action: OnAction| {
        div()
            .id(id)
            .size(px(ACTION))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(5.))
            .cursor(theme::clickable_cursor())
            .when(focused, |d| d.bg(hover_bg))
            .hover(move |s| s.bg(hover_bg))
            .tooltip(tooltip(label))
            .on_click(move |_, window, cx| on_action(action.clone(), window, cx))
            .child(Icon::new(icon).color(if focused { hover_fg } else { fg }))
    };
    let mut primary = div().flex().items_center().gap(px(3.));
    if let Some(segmented) = &contribution.segmented {
        let mut group = div().flex().gap(px(1.)).h(px(ACTION));
        for option in &segmented.options {
            let n = next();
            let checked = option.id == segmented.value;
            let focused = selected == Some(n);
            let bg = if checked {
                t_.selected
            } else if focused {
                t_.hover
            } else {
                Rgba::default()
            };
            let fg = if checked || focused {
                t_.text
            } else {
                t_.muted
            };
            let action = Action::Segment(option.id);
            let on_action = on_action.clone();
            let hover = t_.hover;
            group = group.child(
                div()
                    .id(("desktop-editor-pane-menu-segment", n))
                    .size(px(ACTION))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(5.))
                    .bg(bg)
                    .cursor(theme::clickable_cursor())
                    .when(!checked, |d| d.hover(move |s| s.bg(hover)))
                    .tooltip(tooltip(option.label.clone()))
                    .on_click(move |_, window, cx| on_action(action.clone(), window, cx))
                    .child(
                        svg()
                            .path(format!("icons/{}.svg", option.icon))
                            .size(px(12.))
                            .text_color(fg),
                    ),
            );
        }
        primary = primary.child(group);
    }
    let mut end = div().flex().items_center().gap(px(3.));
    if contribution.segmented.is_some() {
        end = end.child(
            div()
                .w(px(1.))
                .h(px(18.))
                .mx(px(3.))
                .flex_shrink_0()
                .bg(t_.divider),
        );
    }
    if contribution.find {
        let n = next();
        end = end.child(icon_button(
            "desktop-editor-pane-menu-find".into(),
            "search",
            t("editor.find.label").into(),
            t_.muted,
            t_.hover,
            t_.text,
            selected == Some(n),
            Action::Find,
            on_action.clone(),
        ));
    }
    if contribution.open_external {
        let n = next();
        end = end.child(icon_button(
            "desktop-editor-pane-menu-external".into(),
            "external-link",
            t("editor.openDefaultApp").into(),
            t_.muted,
            t_.hover,
            t_.text,
            selected == Some(n),
            Action::OpenExternal,
            on_action.clone(),
        ));
    }
    let n = next();
    end = end.child(icon_button(
        "desktop-editor-pane-menu-close".into(),
        "x",
        t("editor.panes.closePane").into(),
        t_.danger,
        theme::alpha(t_.danger, 0.10),
        t_.danger,
        selected == Some(n),
        Action::Close,
        on_action.clone(),
    ));
    primary = primary.child(end);
    let items = contribution.items.iter();
    let mut secondary = div().flex().flex_col().gap(px(2.));
    let mut any = false;
    for item in items {
        any = true;
        let disabled = matches!(item.kind, ItemKind::Command { disabled: true });
        let focused = !disabled && selected == Some(next());
        let fg = if disabled {
            t_.text_disabled
        } else if focused {
            t_.text
        } else {
            t_.muted
        };
        let hover = (t_.hover, t_.text);
        let action = Action::Item(item.id);
        let on_action = on_action.clone();
        let icon = match item.kind {
            ItemKind::Toggle(checked) => Some(
                div()
                    .size(px(metric::MENU_ICON_SLOT))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .children(checked.then(|| Icon::new("check").small().color(fg))),
            ),
            ItemKind::Command { .. } => None,
        };
        secondary = secondary.child(
            div()
                .id(SharedString::from(format!(
                    "desktop-editor-pane-menu-item-{}",
                    item.id
                )))
                .flex()
                .items_center()
                .gap(px(metric::MENU_ITEM_GAP))
                .h(px(theme::control()))
                .px(px(metric::MENU_ITEM_PADDING_INLINE))
                .rounded(px(metric::CONTROL_RADIUS))
                .text_size(px(theme::ty().ui.control))
                .line_height(px(18.))
                .text_color(fg)
                .whitespace_nowrap()
                .when(focused, |d| d.bg(hover.0))
                .when(!disabled, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(hover.0).text_color(hover.1))
                        .on_click(move |_, window, cx| on_action(action.clone(), window, cx))
                })
                .children(icon)
                .child(item.label.clone()),
        );
    }
    let dismiss = on_dismiss.clone();
    let shadow = BoxShadow {
        color: theme::alpha(t_.shadow, 0.28).into(),
        offset: point(px(0.), px(2.)),
        blur_radius: px(4.),
        spread_radius: px(-2.),
        inset: false,
    };
    let top = pane.origin.y + px(4. + 13. + 4.);
    let surface = div()
        .id("desktop-editor-pane-menu")
        .track_focus(&chrome.focus)
        .occlude()
        .flex()
        .flex_col()
        .relative()
        .max_w(pane.size.width - px(16.))
        .max_h(px(MENU_MAX_HEIGHT))
        .border_1()
        .border_color(t_.border)
        .rounded(px(metric::MENU_RADIUS))
        // `background-clip: padding-box`; the rows scroll in an inner layer.
        .child(crate::ui::components::menu::padding_box_fill(
            metric::MENU_RADIUS,
            t_.menu_bg,
        ))
        .shadow(vec![shadow])
        .text_color(t_.text)
        .on_key_down(move |e: &KeyDownEvent, window, cx| on_key(e, window, cx))
        .on_mouse_down_out(move |e: &MouseDownEvent, window, cx| {
            // A press on the handle toggles instead (it is "inside").
            let handle = Bounds::centered_at(
                point(pane.center().x, pane.origin.y + px(4. + 6.5)),
                size(px(27.), px(13.)),
            );
            if !handle.contains(&e.position) {
                dismiss(false, window, cx);
            }
        })
        .child(
            div()
                .id("desktop-editor-pane-menu-rows")
                .flex()
                .flex_col()
                .min_h_0()
                .p(px(metric::MENU_PADDING))
                .overflow_y_scroll()
                .track_scroll(&chrome.scroll)
                .child(primary)
                .when(any, |d| {
                    d.child(
                        div()
                            .mt(px(4.))
                            .pt(px(4.))
                            .border_t_1()
                            .border_color(t_.divider)
                            .child(secondary),
                    )
                }),
        )
        .child(crate::ui::scrollbar::vertical(
            "desktop-editor-pane-menu-scrollbar",
            &chrome.scroll,
        ));
    Some(
        deferred(
            div()
                .absolute()
                .left(pane.origin.x + px(8.))
                .w(pane.size.width - px(16.))
                .top(top)
                .flex()
                .justify_center()
                .child(surface),
        )
        .with_priority(3)
        .into_any_element(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn contribution() -> Contribution {
        Contribution {
            segmented: Some(Segmented {
                label: "Mode".into(),
                options: vec![
                    Segment {
                        id: "live",
                        icon: "editor-mode-edit",
                        label: "Live".into(),
                    },
                    Segment {
                        id: "source",
                        icon: "editor-mode-source",
                        label: "Source".into(),
                    },
                ],
                value: "live",
            }),
            items: vec![
                Item {
                    id: "toggle",
                    label: "Toggle".into(),
                    kind: ItemKind::Toggle(true),
                },
                Item {
                    id: "off",
                    label: "Off".into(),
                    kind: ItemKind::Command { disabled: true },
                },
                Item {
                    id: "run",
                    label: "Run".into(),
                    kind: ItemKind::Command { disabled: false },
                },
            ],
            find: true,
            open_external: true,
        }
    }

    #[test]
    fn entries_follow_the_menu_order_and_skip_disabled_commands() {
        let c = contribution();
        assert_eq!(
            c.entries(),
            vec![
                Action::Segment("live"),
                Action::Segment("source"),
                Action::Find,
                Action::OpenExternal,
                Action::Close,
                Action::Item("toggle"),
                Action::Item("run")
            ]
        );
        assert!(
            !c.closes(&Action::Item("toggle"))
                && c.closes(&Action::Item("run"))
                && !c.closes(&Action::Segment("source"))
                && c.closes(&Action::Find)
        );
    }

    #[test]
    fn keys_cycle_and_activate() {
        assert_eq!(menu_key(0, "up", 7), (6, true, None));
        assert_eq!(menu_key(6, "down", 7), (0, true, None));
        assert_eq!(menu_key(2, "end", 7), (6, true, None));
        assert_eq!(menu_key(4, "enter", 7), (4, false, Some(4)));
        assert_eq!(menu_key(9, "x", 7), (6, false, None));
    }
}
