//! Port of `components/DesktopMenu.tsx` (`.desktop-menu-surface`). Menus are
//! positioned by their owner, which knows their exact rectangle.
use crate::theme::{self, Theme, metric};
use gpui::{prelude::*, *};
use std::rc::Rc;

pub type MenuAction = Rc<dyn Fn(&mut Window, &mut App)>;
pub struct MenuItem {
    pub label: SharedString,
    pub icon: Option<AnyElement>,
    pub detail: Option<SharedString>,
    pub trailing: Option<AnyElement>,
    pub checked: bool,
    pub disabled: bool,
    pub danger: bool,
    pub on_click: MenuAction,
}
impl MenuItem {
    pub fn new(
        label: impl Into<SharedString>,
        on_click: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            label: label.into(),
            icon: None,
            detail: None,
            trailing: None,
            checked: false,
            disabled: false,
            danger: false,
            on_click: Rc::new(on_click),
        }
    }
    pub fn icon(mut self, name: &str, t: Theme) -> Self {
        self.icon = Some(
            super::icon_sized(name, 15., if self.danger { t.danger } else { t.muted })
                .into_any_element(),
        );
        self
    }
    pub fn icon_element(mut self, element: AnyElement) -> Self {
        self.icon = Some(element);
        self
    }
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }
    pub fn trailing(mut self, element: AnyElement) -> Self {
        self.trailing = Some(element);
        self
    }
    pub fn shortcut(self, text: impl Into<SharedString>, t: Theme) -> Self {
        let text = text.into();
        self.trailing(
            div()
                .text_size(px(theme::ty().ui.meta))
                .text_color(t.text_disabled)
                .child(text)
                .into_any_element(),
        )
    }
    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
}
pub enum MenuEntry {
    Item(MenuItem),
    Separator,
    Section(SharedString),
}
/// `--po-menu-shadow` (`--po-elevation-popover`).
pub fn menu_shadow(t: Theme) -> Vec<BoxShadow> {
    vec![BoxShadow {
        inset: false,
        color: theme::alpha(t.shadow, if t.dark { 0.36 } else { 0.64 }).into(),
        offset: point(px(0.), px(3.)),
        blur_radius: px(8.),
        spread_radius: px(-4.),
    }]
}
/// The menu surface; the caller positions it and handles outside dismissal.
pub fn menu_surface(
    id: impl Into<SharedString>,
    entries: Vec<MenuEntry>,
    t: Theme,
) -> Stateful<Div> {
    let id: SharedString = id.into();
    let mut surface = super::column()
        .id(id.clone())
        .p(px(metric::MENU_PADDING))
        .border_1()
        .border_color(t.border)
        .rounded(px(metric::MENU_RADIUS))
        .bg(t.menu_bg)
        .shadow(menu_shadow(t))
        .text_color(t.text)
        .overflow_y_scroll()
        .occlude();
    for (index, entry) in entries.into_iter().enumerate() {
        surface = match entry {
            MenuEntry::Separator => surface.child(
                div()
                    .h(px(1.))
                    .mx(px(2.))
                    .my(px(4.))
                    .flex_shrink_0()
                    .bg(t.divider),
            ),
            MenuEntry::Section(label) => surface.child(
                div()
                    .px(px(metric::MENU_ITEM_PADDING_INLINE))
                    .pt(px(4.))
                    .pb(px(4.))
                    .text_size(px(theme::ty().ui.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text_disabled)
                    .child(label),
            ),
            MenuEntry::Item(item) => surface.child(menu_row((id.clone(), index), item, t)),
        };
    }
    surface
}
fn menu_row(id: impl Into<ElementId>, item: MenuItem, t: Theme) -> Stateful<Div> {
    let disabled = item.disabled;
    let danger = item.danger;
    let fg = if disabled {
        t.text_disabled
    } else if danger {
        t.danger
    } else {
        t.muted
    };
    let hover_bg = if danger {
        theme::alpha(t.danger, 0.10)
    } else {
        t.hover
    };
    let action = item.on_click.clone();
    super::row()
        .id(id)
        .w_full()
        .min_w_0()
        .flex_shrink_0()
        .min_h(px(theme::control()))
        .gap(px(metric::MENU_ITEM_GAP))
        .px(px(metric::MENU_ITEM_PADDING_INLINE))
        .rounded(px(metric::CONTROL_RADIUS))
        .text_size(px(theme::ty().ui.control))
        .line_height(px(18.))
        .text_color(fg)
        .when(!disabled, |d| {
            d.cursor(theme::clickable_cursor())
                .hover(move |s| {
                    s.bg(hover_bg)
                        .text_color(if danger { t.danger } else { t.text })
                })
                .on_click(move |_, window, cx| {
                    cx.stop_propagation();
                    action(window, cx)
                })
        })
        .child(
            div()
                .size(px(metric::MENU_ICON_SLOT))
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .children(item.icon),
        )
        .child(
            super::row()
                .flex_1()
                .min_w_0()
                .gap(px(7.))
                .child(div().min_w_0().truncate().child(item.label))
                .children(item.detail.map(|detail| {
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(theme::ty().ui.meta))
                        .text_color(t.subtle)
                        .child(detail)
                })),
        )
        .children(item.trailing)
        .when(item.checked, |d| {
            d.child(super::icon_sized("check", 14., t.muted))
        })
}
