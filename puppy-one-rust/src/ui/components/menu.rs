//! Menus: the product surface of `components/DesktopMenu.tsx`
//! (`.desktop-menu-surface`, `.desktop-menu-item`, `.desktop-menu-separator`)
//! and its variants. Opening, placement and dismissal belong to
//! [`super::PopoverMenu`] / [`super::AnchoredMenu`], which run on GPUI Kit.
use super::Icon;
use crate::{
    theme::{self, Theme, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Positioner, StyledExt as _},
    component::Sizable as _,
};
use std::{rc::Rc, time::Duration};

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;
type SubmenuBuilder = Rc<dyn Fn(&mut Window, &mut App) -> Menu>;

/// Which `.desktop-menu-surface` a menu is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MenuVariant {
    /// `DesktopMenuSurface` defaults: UI type, popover elevation.
    #[default]
    Default,
    /// `DesktopSidebarActionMenu`: left-sidebar type, compact elevation.
    SidebarAction,
    /// The Explorer's list-end "New" menu: sidebar row geometry, no separators.
    SidebarLauncher,
    /// `.desktop-project-menu` under the Header.
    Project,
}
/// Resolved metrics of a menu variant.
#[derive(Clone, Copy, Debug)]
struct MenuStyle {
    font: f32,
    line_height: f32,
    meta: f32,
    meta_line_height: f32,
    padding: f32,
    item_height: f32,
    item_padding: f32,
    item_gap: f32,
    item_radius: f32,
    hide_separators: bool,
    icon_opacity: f32,
    trailing_inherits: bool,
}
impl MenuVariant {
    fn style(self) -> MenuStyle {
        let m = theme::ty();
        let sidebar = !matches!(self, Self::Default);
        MenuStyle {
            font: if sidebar {
                m.left.content
            } else {
                m.ui.control
            },
            line_height: if sidebar { m.left.line_height } else { 18. },
            meta: if sidebar { m.left.meta } else { m.ui.meta },
            meta_line_height: if sidebar { m.left.line_height } else { 15. },
            padding: if self == Self::Project {
                metric::PROJECT_MENU_SPACING
            } else {
                metric::MENU_PADDING
            },
            item_height: theme::control(),
            item_padding: if self == Self::SidebarLauncher {
                metric::SIDEBAR_ROW_CONTENT_LEFT
            } else {
                metric::MENU_ITEM_PADDING_INLINE
            },
            item_gap: if self == Self::SidebarLauncher {
                metric::SIDEBAR_ICON_LABEL_GAP
            } else {
                metric::MENU_ITEM_GAP
            },
            item_radius: metric::CONTROL_RADIUS,
            hide_separators: self == Self::SidebarLauncher,
            icon_opacity: if self == Self::Project { 1. } else { 0.82 },
            trailing_inherits: self == Self::Project,
        }
    }
    /// The surface's elevation (`--po-elevation-*`), for surfaces that
    /// draw their own rows (editor menus).
    pub fn shadow(self, t: Theme) -> Vec<BoxShadow> {
        let shadow = |color: Rgba, y: f32, blur: f32, spread: f32| BoxShadow {
            inset: false,
            color: color.into(),
            offset: point(px(0.), px(y)),
            blur_radius: px(blur),
            spread_radius: px(spread),
        };
        match self {
            // `--po-elevation-popover`.
            Self::Default => vec![shadow(
                theme::alpha(t.shadow, if t.dark { 0.36 } else { 0.64 }),
                3.,
                8.,
                -4.,
            )],
            // `--po-elevation-low`.
            Self::SidebarAction | Self::SidebarLauncher => vec![shadow(
                theme::alpha(t.shadow, if t.dark { 0.28 } else { 0.32 }),
                2.,
                4.,
                -2.,
            )],
            Self::Project => vec![
                shadow(theme::alpha(t.shadow, 0.45), 2., 4., 0.),
                shadow(theme::alpha(t.shadow, 0.65), 6., 16., -4.),
            ],
        }
    }
}

/// One row of a [`Menu`].
pub struct MenuItem {
    label: SharedString,
    icon: Option<Icon>,
    glyph: Option<AnyElement>,
    detail: Option<SharedString>,
    shortcut: Option<SharedString>,
    trailing: Option<AnyElement>,
    hover_trailing: Option<AnyElement>,
    selected: bool,
    disabled: bool,
    danger: bool,
    submenu: Option<SubmenuBuilder>,
    open_submenu: bool,
    on_click: Option<Handler>,
}
impl MenuItem {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            glyph: None,
            detail: None,
            shortcut: None,
            trailing: None,
            hover_trailing: None,
            selected: false,
            disabled: false,
            danger: false,
            submenu: None,
            open_submenu: false,
            on_click: None,
        }
    }
    /// A Lucide icon at the product's menu default (14px, stroke 2).
    pub fn icon(self, name: impl Into<SharedString>) -> Self {
        self.icon_sized(Icon::new(name).small().stroke(2.))
    }
    /// An icon drawn at its own size and stroke; it follows the row's hover.
    pub fn icon_sized(mut self, icon: Icon) -> Self {
        self.icon = Some(icon);
        self
    }
    /// Any other glyph: a file icon, a brand mark.
    pub fn icon_element(mut self, element: impl IntoElement) -> Self {
        self.glyph = Some(element.into_any_element());
        self
    }
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }
    /// Keyboard shortcut hint (`⌘C`).
    pub fn shortcut(mut self, text: impl Into<SharedString>) -> Self {
        self.shortcut = Some(text.into());
        self
    }
    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }
    /// Shown in place of the trailing content while the row is hovered.
    pub fn hover_trailing(mut self, element: impl IntoElement) -> Self {
        self.hover_trailing = Some(element.into_any_element());
        self
    }
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    /// A selected row with a check at its end.
    pub fn checked(self, checked: bool) -> Self {
        if checked {
            self.selected(true)
                .trailing(Icon::new("check").small().stroke(2.))
        } else {
            self
        }
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
    /// A submenu opened by hovering or clicking the row.
    pub fn submenu(mut self, build: impl Fn(&mut Window, &mut App) -> Menu + 'static) -> Self {
        self.submenu = Some(Rc::new(build));
        self
    }
    /// Opens the submenu without a hover, as keyboard navigation does; the
    /// pointer closes it as usual afterwards.
    pub fn open_submenu(mut self, open: bool) -> Self {
        self.open_submenu = open;
        self
    }
    pub fn on_click(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

enum MenuEntry {
    Item(Box<MenuItem>),
    /// Rows `gap` apart (`.desktop-project-list`).
    List(Vec<MenuItem>, f32),
    Separator,
    Label(SharedString),
    Element(AnyElement),
}

/// A menu surface. Items run their handler, then `on_dismiss`.
#[derive(IntoElement)]
pub struct Menu {
    id: ElementId,
    variant: MenuVariant,
    entries: Vec<MenuEntry>,
    on_dismiss: Option<Handler>,
    style: StyleRefinement,
}
impl Menu {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: MenuVariant::Default,
            entries: vec![],
            on_dismiss: None,
            style: StyleRefinement::default(),
        }
    }
    pub fn variant(mut self, variant: MenuVariant) -> Self {
        self.variant = variant;
        self
    }
    pub fn item(mut self, item: MenuItem) -> Self {
        self.entries.push(MenuEntry::Item(Box::new(item)));
        self
    }
    pub fn items(mut self, items: impl IntoIterator<Item = MenuItem>) -> Self {
        self.entries.extend(
            items
                .into_iter()
                .map(|item| MenuEntry::Item(Box::new(item))),
        );
        self
    }
    /// Rows spaced `gap` apart, as one group (`.desktop-project-list`).
    pub fn list(mut self, gap: f32, items: impl IntoIterator<Item = MenuItem>) -> Self {
        self.entries
            .push(MenuEntry::List(items.into_iter().collect(), gap));
        self
    }
    pub fn separator(mut self) -> Self {
        self.entries.push(MenuEntry::Separator);
        self
    }
    /// `.desktop-menu-section-label`.
    pub fn label(mut self, text: impl Into<SharedString>) -> Self {
        self.entries.push(MenuEntry::Label(text.into()));
        self
    }
    /// A row the caller composes (a project list, an error line).
    pub fn element(mut self, element: impl IntoElement) -> Self {
        self.entries
            .push(MenuEntry::Element(element.into_any_element()));
        self
    }
    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
    fn dismiss_handler(&mut self, handler: Option<Handler>) {
        if self.on_dismiss.is_none() {
            self.on_dismiss = handler;
        }
    }
    /// The placement estimate the product uses (`estimatedHeight`):
    /// padding, rows and 9px separator blocks, without the border.
    pub fn estimated_height(variant: MenuVariant, items: usize, separators: usize) -> f32 {
        let s = variant.style();
        s.padding * 2.
            + items as f32 * s.item_height
            + separators as f32 * metric::MENU_SEPARATOR_BLOCK
    }
}
impl Styled for Menu {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for Menu {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let s = self.variant.style();
        let max_height = window.viewport_size().height - px(24.);
        let (border, background) = if self.variant == MenuVariant::Project {
            (t.shell_divider, t.header)
        } else {
            (t.border, t.menu_bg)
        };
        let dismiss = self.on_dismiss.clone();
        let id = self.id.clone();
        let mut surface = div()
            .id(self.id)
            .flex()
            .flex_col()
            .p(px(s.padding))
            .border_1()
            .border_color(border)
            .rounded(px(metric::MENU_RADIUS))
            .bg(background)
            .shadow(self.variant.shadow(t))
            .text_color(t.text)
            .max_h(max_height)
            .overflow_y_scroll()
            .occlude();
        for (index, entry) in self.entries.into_iter().enumerate() {
            surface = match entry {
                MenuEntry::Separator if s.hide_separators => surface,
                MenuEntry::Separator => surface.child(separator(t)),
                MenuEntry::Label(text) => surface.child(
                    div()
                        .flex_shrink_0()
                        .px(px(s.item_padding))
                        .pb(px(4.))
                        .text_size(px(s.meta))
                        .line_height(px(s.meta_line_height))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text_disabled)
                        .child(text),
                ),
                MenuEntry::Element(element) => surface.child(element),
                MenuEntry::List(items, gap) => surface.child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_shrink_0()
                        .gap(px(gap))
                        .children(items.into_iter().enumerate().map(|(row_index, item)| {
                            row(
                                child_id(&id, format!("{index}-{row_index}")),
                                item,
                                s,
                                t,
                                dismiss.clone(),
                            )
                        })),
                ),
                MenuEntry::Item(item) => surface.child(row(
                    child_id(&id, index.to_string()),
                    *item,
                    s,
                    t,
                    dismiss.clone(),
                )),
            };
        }
        surface.refine_style(&self.style)
    }
}
/// `.desktop-menu-separator`: 1px with `margin: 4px 2px`.
fn separator(t: Theme) -> Div {
    div()
        .h(px(1.))
        .mx(px(2.))
        .my(px(4.))
        .flex_shrink_0()
        .bg(t.divider)
}
/// Hover state of a row's submenu: open, and a generation that cancels a
/// scheduled close when the pointer comes back (`scheduleCloseSubmenu`).
#[derive(Default)]
struct SubmenuState {
    open: bool,
    /// An `open_submenu` request was honoured.
    requested: bool,
    epoch: u64,
    trigger: Bounds<Pixels>,
}
/// `.desktop-menu-item`.
fn row(
    element_id: ElementId,
    item: MenuItem,
    s: MenuStyle,
    t: Theme,
    dismiss: Option<Handler>,
) -> AnyElement {
    let group = SharedString::from(format!("menu-row-{element_id}"));
    let disabled = item.disabled;
    let danger = item.danger;
    let lit = item.selected;
    let resting = if danger {
        t.danger
    } else if lit {
        t.text
    } else if disabled {
        t.text_disabled
    } else {
        t.muted
    };
    let hover_fg = if danger { t.danger } else { t.text };
    let hover_bg = if danger {
        theme::alpha(t.danger, 0.10)
    } else {
        t.hover
    };
    let trailing_fg = if s.trailing_inherits {
        resting
    } else {
        t.text_disabled
    };
    let has_hover_trailing = item.hover_trailing.is_some();
    let submenu = item.submenu.clone();
    let open_submenu = item.open_submenu;
    let action = item.on_click.clone();
    let selector = item.label.clone();
    let row = h_row()
        .id(element_id.clone())
        .debug_selector(move || format!("menu-item:{selector}"))
        .group(group.clone())
        .relative()
        .w_full()
        .min_w_0()
        .flex_shrink_0()
        .h(px(s.item_height))
        .gap(px(s.item_gap))
        .px(px(s.item_padding))
        .rounded(px(s.item_radius))
        .text_size(px(s.font))
        .line_height(px(s.line_height))
        .font_weight(FontWeight::NORMAL)
        .text_color(resting)
        .when(lit, |d| d.bg(t.hover))
        .when(disabled && !lit, |d| d.opacity(0.58))
        .when(!disabled, |d| {
            d.cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
        })
        .children(
            item.icon
                .map(|icon| {
                    if disabled {
                        icon.into_any_element()
                    } else {
                        icon.group_hover_color(group.clone(), hover_fg)
                            .into_any_element()
                    }
                })
                .or(item.glyph)
                .map(|icon| {
                    div()
                        .size(px(metric::MENU_ICON_SLOT))
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .opacity(s.icon_opacity)
                        .child(icon)
                }),
        )
        .child(
            h_row()
                .flex_1()
                .min_w_0()
                .items_baseline()
                .gap(px(7.))
                .child(div().min_w_0().truncate().child(item.label))
                .children(item.detail.map(|detail| {
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(s.meta))
                        .text_color(t.subtle)
                        .child(detail)
                })),
        )
        .children(item.shortcut.map(|text| {
            div()
                .flex_shrink_0()
                .text_size(px(s.meta))
                .text_color(trailing_fg)
                .child(text)
        }))
        .children(item.trailing.map(|element| {
            div()
                .flex_shrink_0()
                .flex()
                .items_center()
                .text_color(trailing_fg)
                .when(has_hover_trailing, |d| {
                    d.group_hover(group.clone(), |s| s.invisible())
                })
                .child(element)
        }))
        .children(item.hover_trailing.map(|element| {
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .right(px(s.item_padding))
                .flex()
                .items_center()
                .invisible()
                .group_hover(group.clone(), |s| s.visible())
                .child(element)
        }));
    let Some(submenu) = submenu else {
        return row
            .when_some(action.filter(|_| !disabled), |d, action| {
                d.on_click(move |_, window, cx| {
                    cx.stop_propagation();
                    action(window, cx);
                    if let Some(dismiss) = &dismiss {
                        dismiss(window, cx);
                    }
                })
            })
            .into_any_element();
    };
    SubmenuRow {
        id: element_id,
        row,
        build: submenu,
        open: open_submenu,
        dismiss,
    }
    .into_any_element()
}
/// A row whose submenu opens on hover or click and closes 180ms after the
/// pointer leaves both, placed 4px past the row's end and 4px above it.
#[derive(IntoElement)]
struct SubmenuRow {
    id: ElementId,
    row: Stateful<Div>,
    build: SubmenuBuilder,
    /// Open once without a hover.
    open: bool,
    dismiss: Option<Handler>,
}
impl RenderOnce for SubmenuRow {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = window.use_keyed_state(child_id(&self.id, "submenu"), cx, |_, _| {
            SubmenuState::default()
        });
        if self.open {
            state.update(cx, |s, _| {
                if !s.requested {
                    s.requested = true;
                    s.open = true;
                }
            });
        }
        let hover = {
            let state = state.clone();
            move |hovered: bool, window: &mut Window, cx: &mut App| {
                let epoch = state.update(cx, |s, cx| {
                    s.epoch += 1;
                    if hovered && !s.open {
                        s.open = true;
                        cx.notify();
                    }
                    s.epoch
                });
                if hovered {
                    return;
                }
                let state = state.clone();
                window
                    .spawn(cx, async move |cx| {
                        cx.background_executor()
                            .timer(Duration::from_millis(180))
                            .await;
                        state.update(cx, |s, cx| {
                            if s.epoch == epoch && s.open {
                                s.open = false;
                                cx.notify();
                            }
                        });
                    })
                    .detach();
            }
        };
        let open = state.read(cx).open;
        let trigger = state.read(cx).trigger;
        let measure = {
            let state = state.clone();
            canvas(
                move |bounds, _, cx| state.update(cx, |s, _| s.trigger = bounds),
                |_, _, _, _| {},
            )
            .absolute()
            .top_0()
            .left_0()
            .size_full()
        };
        let hover_row = hover.clone();
        let click_state = state.clone();
        let t = cx.palette();
        let mut row = self
            .row
            // The trigger stays lit while its submenu is open (`data-open`).
            .when(open, |row| row.bg(t.hover).text_color(t.text))
            .child(measure)
            .on_hover(move |hovered, window, cx| hover_row(*hovered, window, cx))
            .on_click(move |_, _, cx| {
                cx.stop_propagation();
                click_state.update(cx, |s, cx| {
                    s.open = true;
                    cx.notify();
                });
            });
        if open {
            let mut menu = (self.build)(window, cx);
            menu.dismiss_handler(self.dismiss);
            let corner = point(trigger.right() + px(4.), trigger.top() - px(4.));
            row = row.child(
                deferred(
                    Positioner::corner(Anchor::TopLeft, corner)
                        .margin(px(8.))
                        .occlude()
                        .child(
                            div()
                                .id(child_id(&self.id, "submenu-host"))
                                .on_hover(move |hovered, window, cx| hover(*hovered, window, cx))
                                .child(menu.w(px(184.))),
                        ),
                )
                .with_priority(gpui_kit::base::POPUP_PRIORITY + 1),
            );
        }
        row
    }
}
/// A stable id for a named part of an element.
pub(crate) fn child_id(parent: &ElementId, name: impl Into<SharedString>) -> ElementId {
    ElementId::NamedChild(std::sync::Arc::new(parent.clone()), name.into())
}
/// A row that centres its children on the cross axis.
fn h_row() -> Div {
    div().flex().items_center()
}
