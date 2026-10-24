//! Port of `components/DesktopMenu.tsx` (`.desktop-menu-surface`,
//! `.desktop-menu-item`, `.desktop-menu-separator`) and its variants in
//! `styles/menus.css`, `styles/file-actions.css` and `styles/layout.css`.
//! Menus are positioned by their owner, which knows the trigger rectangle
//! (`geometry::menu_position`).
use crate::theme::{self, Theme, metric};
use gpui::{prelude::*, *};
use std::rc::Rc;

pub type MenuAction = Rc<dyn Fn(&mut Window, &mut App)>;
pub type MenuHover = Rc<dyn Fn(&bool, &mut Window, &mut App)>;

/// `data-menu-typography-surface` on `.desktop-menu-surface`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuTypography {
    /// `ui`: `--po-type-ui-control` / 18px, meta `--po-type-ui-meta` / 15px.
    Ui,
    /// `left-sidebar`: `--desktop-sidebar-font-size` / line height (sidebar
    /// action menus and the Header's project menus).
    LeftSidebar,
}
impl MenuTypography {
    /// `(--po-menu-item-font-size, --po-menu-item-line-height)`.
    pub fn item(self) -> (f32, f32) {
        let m = theme::ty();
        match self {
            Self::Ui => (m.ui.control, 18.),
            Self::LeftSidebar => (m.left.content, m.left.line_height),
        }
    }
    /// `(--po-menu-meta-font-size, --po-menu-meta-line-height)`.
    pub fn meta(self) -> (f32, f32) {
        let m = theme::ty();
        match self {
            Self::Ui => (m.ui.meta, 15.),
            Self::LeftSidebar => (m.left.meta, m.left.line_height),
        }
    }
}
/// `data-menu-elevation` plus the project-menu override of
/// `--po-menu-shadow-compact` (`.desktop-project-menu`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuElevation {
    /// `--po-menu-shadow` (`--po-elevation-popover`).
    Popover,
    /// `--po-menu-shadow-compact` (`--po-elevation-low`).
    Compact,
    /// `.desktop-project-menu` / `.desktop-project-location-menu`.
    ProjectMenu,
}
/// Resolved custom properties of one menu surface and its rows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MenuStyle {
    pub typography: MenuTypography,
    pub elevation: MenuElevation,
    /// `--po-menu-padding`.
    pub padding: f32,
    /// `--po-menu-border`.
    pub border: Rgba,
    /// `--po-menu-bg`.
    pub background: Rgba,
    /// `--po-menu-item-height`.
    pub item_height: f32,
    /// `--po-menu-item-padding-inline`.
    pub item_padding_inline: f32,
    /// `--po-menu-item-gap`.
    pub item_gap: f32,
    /// `--po-menu-item-radius`.
    pub item_radius: f32,
    /// `.desktop-create-entry-menu[data-sidebar-launcher] .desktop-menu-separator`.
    pub hide_separators: bool,
    /// `.desktop-menu-item-icon` opacity (`.desktop-project-menu` raises it to 1).
    pub icon_opacity: f32,
    /// `.desktop-project-menu .desktop-menu-item-trailing { color: inherit }`.
    pub trailing_inherits_color: bool,
}
impl MenuStyle {
    /// `DesktopMenuSurface` defaults: UI typography, popover elevation.
    pub fn surface(t: Theme) -> Self {
        Self {
            typography: MenuTypography::Ui,
            elevation: MenuElevation::Popover,
            padding: metric::MENU_PADDING,
            border: t.border,
            background: t.menu_bg,
            item_height: theme::control(),
            item_padding_inline: metric::MENU_ITEM_PADDING_INLINE,
            item_gap: metric::MENU_ITEM_GAP,
            item_radius: metric::CONTROL_RADIUS,
            hide_separators: false,
            icon_opacity: 0.82,
            trailing_inherits_color: false,
        }
    }
    /// `DesktopSidebarActionMenu`: compact, quiet, left-sidebar typography.
    pub fn sidebar_action(t: Theme) -> Self {
        Self {
            typography: MenuTypography::LeftSidebar,
            elevation: MenuElevation::Compact,
            ..Self::surface(t)
        }
    }
    /// `.desktop-create-entry-menu[data-sidebar-launcher="true"]`: the menu
    /// opened from the Explorer's "New" row takes the sidebar row geometry
    /// and drops its separators.
    pub fn sidebar_launcher(t: Theme) -> Self {
        Self {
            item_height: theme::control(),
            item_padding_inline: metric::SIDEBAR_ROW_CONTENT_LEFT,
            item_gap: metric::SIDEBAR_ICON_LABEL_GAP,
            item_radius: metric::SIDEBAR_ROW_RADIUS,
            hide_separators: true,
            ..Self::sidebar_action(t)
        }
    }
    /// `DesktopTitlebarMenuLayer` + `.desktop-project-menu`.
    pub fn project_menu(t: Theme) -> Self {
        Self {
            typography: MenuTypography::LeftSidebar,
            elevation: MenuElevation::ProjectMenu,
            padding: metric::PROJECT_MENU_SPACING,
            border: t.shell_divider,
            background: t.header,
            icon_opacity: 1.,
            trailing_inherits_color: true,
            ..Self::surface(t)
        }
    }
    /// Rendered height of a menu whose rows are `items` and `separators`,
    /// including the 1px border (hidden separators take no space).
    pub fn outer_height(&self, items: usize, separators: usize) -> f32 {
        let separators = if self.hide_separators { 0 } else { separators };
        self.estimated_height(items, separators) + 2.
    }
    /// The product's placement estimate (`estimatedHeight` in
    /// `nodeActions.tsx`): padding, rows and 9px separator blocks, without
    /// the border. It counts separators even where CSS hides them.
    pub fn estimated_height(&self, items: usize, separators: usize) -> f32 {
        self.padding * 2.
            + items as f32 * self.item_height
            + separators as f32 * metric::MENU_SEPARATOR_BLOCK
    }
}

pub struct MenuItem {
    pub label: SharedString,
    pub icon: Option<MenuIcon>,
    pub detail: Option<SharedString>,
    pub trailing: Option<AnyElement>,
    pub shortcut: Option<SharedString>,
    pub selected: bool,
    pub disabled: bool,
    pub danger: bool,
    /// Keeps the hover/selected backplate (`aria-expanded` submenu trigger).
    pub open: bool,
    pub on_click: MenuAction,
    pub on_hover: Option<MenuHover>,
}
/// `.desktop-menu-item-icon` content.
pub enum MenuIcon {
    /// Lucide icon `(name, size, strokeWidth)`; drawn in the row colour.
    Lucide(&'static str, f32, f32),
    /// Pre-coloured element (file glyphs, brand marks).
    Element(AnyElement),
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
            shortcut: None,
            selected: false,
            disabled: false,
            danger: false,
            open: false,
            on_click: Rc::new(on_click),
            on_hover: None,
        }
    }
    /// Lucide icon at the product's default `size={14}` and stroke 2.
    pub fn icon(self, name: &'static str) -> Self {
        self.lucide(name, 14., 2.)
    }
    pub fn lucide(mut self, name: &'static str, size: f32, stroke: f32) -> Self {
        self.icon = Some(MenuIcon::Lucide(name, size, stroke));
        self
    }
    pub fn icon_element(mut self, element: AnyElement) -> Self {
        self.icon = Some(MenuIcon::Element(element));
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
    /// `trailing={shortcut}` text (`⌘C`).
    pub fn shortcut(mut self, text: impl Into<SharedString>) -> Self {
        self.shortcut = Some(text.into());
        self
    }
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
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
    pub fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }
    pub fn on_hover(mut self, handler: impl Fn(&bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_hover = Some(Rc::new(handler));
        self
    }
}
pub enum MenuEntry {
    Item(MenuItem),
    Separator,
}
fn shadow(color: Rgba, y: f32, blur: f32, spread: f32) -> BoxShadow {
    BoxShadow {
        inset: false,
        color: color.into(),
        offset: point(px(0.), px(y)),
        blur_radius: px(blur),
        spread_radius: px(spread),
    }
}
/// `--po-menu-shadow` (`--po-elevation-popover`).
pub fn menu_shadow(t: Theme) -> Vec<BoxShadow> {
    elevation_shadow(MenuElevation::Popover, t)
}
pub fn elevation_shadow(elevation: MenuElevation, t: Theme) -> Vec<BoxShadow> {
    match elevation {
        // 0 3px 8px -4px mix(shadow 64% | 36% dark)
        MenuElevation::Popover => vec![shadow(
            theme::alpha(t.shadow, if t.dark { 0.36 } else { 0.64 }),
            3.,
            8.,
            -4.,
        )],
        // 0 2px 4px -2px mix(shadow 32% | 28% dark)
        MenuElevation::Compact => vec![shadow(
            theme::alpha(t.shadow, if t.dark { 0.28 } else { 0.32 }),
            2.,
            4.,
            -2.,
        )],
        // 0 2px 4px mix(shadow 45%), 0 6px 16px -4px mix(shadow 65%)
        MenuElevation::ProjectMenu => vec![
            shadow(theme::alpha(t.shadow, 0.45), 2., 4., 0.),
            shadow(theme::alpha(t.shadow, 0.65), 6., 16., -4.),
        ],
    }
}
/// The menu surface with `DesktopMenuSurface` defaults.
pub fn menu_surface(
    id: impl Into<SharedString>,
    entries: Vec<MenuEntry>,
    t: Theme,
) -> Stateful<Div> {
    menu_surface_styled(id, entries, MenuStyle::surface(t), t)
}
/// The menu surface; the caller positions it and handles outside dismissal.
pub fn menu_surface_styled(
    id: impl Into<SharedString>,
    entries: Vec<MenuEntry>,
    style: MenuStyle,
    t: Theme,
) -> Stateful<Div> {
    let id: SharedString = id.into();
    let mut surface = menu_frame(id.clone(), style, t);
    for (index, entry) in entries.into_iter().enumerate() {
        surface = match entry {
            MenuEntry::Separator if style.hide_separators => surface,
            MenuEntry::Separator => surface.child(menu_separator(t)),
            MenuEntry::Item(item) => surface.child(menu_row((id.clone(), index), item, style, t)),
        };
    }
    surface
}
/// `.desktop-menu-surface` box: border, radius, material, elevation, padding.
pub fn menu_frame(id: impl Into<SharedString>, style: MenuStyle, t: Theme) -> Stateful<Div> {
    let id: SharedString = id.into();
    super::column()
        .id(id)
        .p(px(style.padding))
        .border_1()
        .border_color(style.border)
        .rounded(px(metric::MENU_RADIUS))
        .bg(style.background)
        .shadow(elevation_shadow(style.elevation, t))
        .text_color(t.text)
        .overflow_y_scroll()
        .occlude()
}
/// `.desktop-menu-separator`: 1px, `margin: 4px 2px`.
pub fn menu_separator(t: Theme) -> Div {
    div()
        .h(px(1.))
        .mx(px(2.))
        .my(px(4.))
        .flex_shrink_0()
        .bg(t.divider)
}
/// `.desktop-menu-section-label`.
pub fn menu_section_label(label: SharedString, style: MenuStyle, t: Theme) -> Div {
    let (size, line_height) = style.typography.meta();
    div()
        .flex_shrink_0()
        .px(px(style.item_padding_inline))
        .pb(px(4.))
        .text_size(px(size))
        .line_height(px(line_height))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.text_disabled)
        .child(label)
}
/// `.desktop-menu-item`.
pub fn menu_row(
    id: impl Into<ElementId>,
    item: MenuItem,
    style: MenuStyle,
    t: Theme,
) -> Stateful<Div> {
    let id: ElementId = id.into();
    let group = SharedString::from(format!("menu-row-{id}"));
    let disabled = item.disabled;
    let danger = item.danger;
    let lit = item.selected || item.open;
    let (font, line_height) = style.typography.item();
    let (meta, _) = style.typography.meta();
    // `color`: muted, raised to text by hover/focus/selected; danger keeps red.
    let resting = if danger {
        t.danger
    } else if lit && (!disabled || item.selected) {
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
    let action = item.on_click.clone();
    let icon = item.icon.map(|icon| {
        let slot = div()
            .size(px(metric::MENU_ICON_SLOT))
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .opacity(style.icon_opacity);
        match icon {
            MenuIcon::Lucide(name, size, stroke) => slot.child(
                super::icon_stroke(name, size, stroke, resting).when(!disabled, |svg| {
                    svg.group_hover(group.clone(), move |s| s.text_color(hover_fg))
                }),
            ),
            MenuIcon::Element(element) => slot.child(element),
        }
    });
    let trailing_fg = if style.trailing_inherits_color {
        resting
    } else {
        t.text_disabled
    };
    let mut row = super::row()
        .id(id)
        .group(group.clone())
        .w_full()
        .min_w_0()
        .flex_shrink_0()
        .h(px(style.item_height))
        .gap(px(style.item_gap))
        .px(px(style.item_padding_inline))
        .rounded(px(style.item_radius))
        .text_size(px(font))
        .line_height(px(line_height))
        .font_weight(FontWeight::NORMAL)
        .text_color(resting)
        .when(lit, |d| d.bg(t.hover))
        .when(disabled && !item.selected, |d| d.opacity(0.58))
        .when(!disabled, |d| {
            d.cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
                .on_click(move |_, window, cx| {
                    cx.stop_propagation();
                    action(window, cx)
                })
        })
        .children(icon)
        .child(
            super::row()
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
                        .text_size(px(meta))
                        .text_color(t.subtle)
                        .child(detail)
                })),
        )
        .children(item.shortcut.map(|text| {
            div()
                .flex_shrink_0()
                .text_size(px(meta))
                .text_color(trailing_fg)
                .child(text)
        }))
        .children(item.trailing.map(|element| {
            div()
                .flex_shrink_0()
                .flex()
                .items_center()
                .text_color(trailing_fg)
                .child(element)
        }));
    if let Some(hover) = item.on_hover {
        row = row.on_hover(move |hovered, window, cx| hover(hovered, window, cx));
    }
    row
}
