//! Sidebar building blocks shared by the Explorer, Git Changes, Settings
//! navigation and the right-sidebar lists: `.tree-row` / `.po-sidebar-row`,
//! their hover-revealed row actions, section headers and groups.
use super::{Icon, IconButton, menu::child_id};
use crate::{
    theme::{self, Theme, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable, Selectable, StyledExt as _},
    component::Sizable as _,
};
use std::rc::Rc;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;
type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

/// Which backplates a row uses.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RowVariant {
    /// Explorer tree (`.tree-row`): selected rows rest on the hover tint and
    /// take the selected gradient when hovered or holding a menu.
    #[default]
    Tree,
    /// Resource lists (`.desktop-working-tree-row`): the active row rests on
    /// the hover tint and takes the selected tint when hovered.
    List,
    /// Navigation (`.po-sidebar-row`): the selected row takes the selected tint.
    Nav,
    /// A quiet command row (the Explorer's list-end "New"): UI meta type in
    /// a muted mix, lifting to subtle on hover and to text while its menu is
    /// open.
    Launcher,
}

/// A 32px sidebar row: leading glyph, label (and any trailing content),
/// and actions revealed by hover or by an open menu.
///
/// It is an interactive element, so owners attach drag and drop, context
/// menus and clicks directly. Do not call `hover` on it: the row owns its
/// hover style.
#[derive(IntoElement)]
pub struct SidebarRow {
    id: ElementId,
    base: Stateful<Div>,
    style: StyleRefinement,
    variant: RowVariant,
    leading: Option<Leading>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    selected: bool,
    open: bool,
    disabled: bool,
    dimmed: bool,
    indent: f32,
    on_click: Option<ClickHandler>,
}
impl SidebarRow {
    pub fn new(id: impl Into<ElementId>) -> Self {
        let id = id.into();
        Self {
            base: div().id(id.clone()),
            id,
            style: StyleRefinement::default(),
            variant: RowVariant::Tree,
            leading: None,
            label: None,
            children: vec![],
            actions: vec![],
            selected: false,
            open: false,
            disabled: false,
            dimmed: false,
            indent: 0.,
            on_click: None,
        }
    }
    pub fn variant(mut self, variant: RowVariant) -> Self {
        self.variant = variant;
        self
    }
    /// Any glyph in the 18px leading slot (a file icon, a brand mark).
    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(Leading::Element(element.into_any_element()));
        self
    }
    /// An icon in the leading slot; it follows the row's hover colour.
    pub fn icon(mut self, icon: impl Into<Icon>) -> Self {
        self.leading = Some(Leading::Icon(Box::new(icon.into())));
        self
    }
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    /// Row actions (24px [`RowActionButton`]s), revealed on hover or while open.
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }
    /// Cut to the clipboard: the glyph and label fade.
    pub fn dimmed(mut self, dimmed: bool) -> Self {
        self.dimmed = dimmed;
        self
    }
    /// Leading indentation (tree depth).
    pub fn indent(mut self, indent: f32) -> Self {
        self.indent = indent;
        self
    }
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}
impl Selectable for SidebarRow {
    fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    fn is_selected(&self) -> bool {
        self.selected
    }
    /// A menu launched from this row is open: its actions stay revealed.
    fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }
    fn is_open(&self) -> bool {
        self.open
    }
}
impl Disableable for SidebarRow {
    fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}
impl ParentElement for SidebarRow {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}
impl Styled for SidebarRow {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl InteractiveElement for SidebarRow {
    fn interactivity(&mut self) -> &mut Interactivity {
        self.base.interactivity()
    }
}
impl StatefulInteractiveElement for SidebarRow {}
impl RenderOnce for SidebarRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let group = SharedString::from(format!("sidebar-row-{}", self.id));
        let (selected, open, disabled) = (self.selected, self.open, self.disabled);
        let lit = selected || open;
        let tint = theme::alpha(t.hover, 0.86);
        let (fg, hover_fg) = match self.variant {
            RowVariant::Tree => (if lit { t.text } else { t.sidebar_text }, t.text),
            RowVariant::Launcher if open => (t.text, t.text),
            RowVariant::Launcher => (theme::mix(t.subtle, t.sidebar, 0.68), t.subtle),
            _ => (if lit { t.text } else { t.muted }, t.text),
        };
        // (resting background, hover background); `None` keeps the rest.
        let (rest, hover): (Option<Background>, Option<Background>) = match self.variant {
            RowVariant::Tree if selected => (
                Some(if open {
                    selected_gradient(t)
                } else {
                    solid(tint)
                }),
                Some(selected_gradient(t)),
            ),
            RowVariant::Tree => (open.then(|| solid(t.hover)), Some(solid(tint))),
            RowVariant::List if selected => (Some(solid(t.hover)), Some(solid(t.selected))),
            RowVariant::List => (open.then(|| solid(t.hover)), Some(solid(t.hover))),
            RowVariant::Nav => (
                selected.then(|| solid(t.selected)),
                Some(solid(if selected { t.selected } else { t.hover })),
            ),
            RowVariant::Launcher => (None, Some(solid(tint))),
        };
        let text_size = if self.variant == RowVariant::Launcher {
            theme::ty().ui.meta
        } else {
            theme::ty().left.content
        };
        let has_actions = !self.actions.is_empty();
        // `--tree-row-action-reserve`: the content's end padding while the
        // actions show (one 24px button 32px, two 56px).
        let reserve = match self.actions.len() {
            0 => metric::SIDEBAR_ROW_CONTENT_RIGHT,
            1 => 32.,
            _ => 56.,
        };
        let dimmed = self.dimmed;
        let nav = self.variant == RowVariant::Nav;
        let mut row = self
            .base
            .group(group.clone())
            .relative()
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .flex_shrink_0()
            .h(px(theme::control()))
            .my(px(1.))
            .pl(px(metric::SIDEBAR_ROW_CONTENT_LEFT + self.indent))
            .pr(px(if open && has_actions {
                reserve
            } else {
                metric::SIDEBAR_ROW_CONTENT_RIGHT
            }))
            // Navigation rows keep the shared `.po-sidebar-row` 6px gap; the
            // desktop tree and lists tighten it to 4.
            .gap(px(if nav {
                6.
            } else {
                metric::SIDEBAR_ICON_LABEL_GAP
            }))
            .rounded(px(metric::SIDEBAR_ROW_RADIUS))
            .text_size(px(text_size))
            .line_height(px(theme::ty().left.line_height))
            .font_weight(FontWeight::NORMAL)
            .text_color(fg)
            .when_some(rest, |d, fill| d.bg(fill))
            .when(disabled, |d| d.opacity(0.42))
            .when(!disabled, |d| {
                d.cursor(theme::clickable_cursor()).hover(move |s| {
                    let s = s.text_color(hover_fg);
                    let s = if has_actions { s.pr(px(reserve)) } else { s };
                    match hover {
                        Some(fill) => s.bg(fill),
                        None => s,
                    }
                })
            })
            .when_some(self.on_click.filter(|_| !disabled), |d, handler| {
                d.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .children(self.leading.map(|leading| {
                let leading = match leading {
                    Leading::Icon(icon) if !disabled => icon
                        .group_hover_color(group.clone(), hover_fg)
                        .into_any_element(),
                    Leading::Icon(icon) => icon.into_any_element(),
                    Leading::Element(element) => element,
                };
                // Navigation glyphs sit unslotted (`.po-sidebar-row > svg`).
                div()
                    .when(!nav, |d| d.size(px(metric::SIDEBAR_ICON_SLOT)))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .when(dimmed, |d| d.opacity(0.48))
                    .child(leading)
            }))
            .children(self.label.map(|label| {
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .when(dimmed, |d| d.opacity(0.48))
                    .child(label)
            }))
            .children(self.children);
        if has_actions {
            row = row.child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(metric::TREE_ROW_ACTION_INSET))
                    .flex()
                    .items_center()
                    .gap(px(metric::TREE_ROW_ACTION_GAP))
                    .when(!open, |d| d.invisible().group_hover(group, |s| s.visible()))
                    .children(self.actions),
            );
        }
        row.refine_style(&self.style)
    }
}
enum Leading {
    Icon(Box<Icon>),
    Element(AnyElement),
}
fn solid(color: Rgba) -> Background {
    Hsla::from(color).into()
}
/// `--tree-row-selected-bg`: the selected tint fading toward the row's end.
fn selected_gradient(t: Theme) -> Background {
    linear_gradient(
        90.,
        linear_color_stop(theme::alpha(t.selected, 0.96), 0.),
        linear_color_stop(theme::alpha(t.selected, 0.62), 1.),
    )
}

/// `.tree-row-action-button`: a 24px command in a row's actions.
#[derive(IntoElement)]
pub struct RowActionButton {
    button: IconButton,
}
impl RowActionButton {
    pub fn new(id: impl Into<ElementId>, icon: impl Into<Icon>) -> Self {
        Self {
            button: IconButton::new(id, icon).with_size(px(24.)),
        }
    }
    /// The "⋮" more-actions trigger (`po-overflow-dots--vertical`).
    pub fn more(id: impl Into<ElementId>) -> Self {
        Self::new(id, Icon::new("overflow-dots").with_size(px(10.)))
    }
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.button = self.button.label(label);
        self
    }
    pub fn danger(mut self) -> Self {
        self.button = self.button.danger();
        self
    }
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.button = self.button.on_click(handler);
        self
    }
}
impl Selectable for RowActionButton {
    fn selected(mut self, selected: bool) -> Self {
        self.button = self.button.selected(selected);
        self
    }
    fn is_selected(&self) -> bool {
        self.button.is_selected()
    }
    fn open(mut self, open: bool) -> Self {
        self.button = self.button.open(open);
        self
    }
    fn is_open(&self) -> bool {
        self.button.is_open()
    }
}
impl Disableable for RowActionButton {
    fn disabled(mut self, disabled: bool) -> Self {
        self.button = self.button.disabled(disabled);
        self
    }
}
impl RenderOnce for RowActionButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        self.button
            .color(t.muted)
            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
    }
}

/// `SourceControlSectionHeader`: a collapsible title with its count and
/// trailing actions.
#[derive(IntoElement)]
pub struct SectionHeader {
    id: ElementId,
    title: SharedString,
    count: Option<usize>,
    expanded: bool,
    actions: Vec<AnyElement>,
    on_toggle: Option<Handler>,
}
impl SectionHeader {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            count: None,
            expanded: true,
            actions: vec![],
            on_toggle: None,
        }
    }
    pub fn count(mut self, count: usize) -> Self {
        self.count = Some(count);
        self
    }
    pub fn expanded(mut self, expanded: bool) -> Self {
        self.expanded = expanded;
        self
    }
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }
    pub fn on_toggle(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }
}
impl RenderOnce for SectionHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let m = theme::ty();
        let toggle = self.on_toggle;
        div()
            .flex()
            .items_center()
            .flex_shrink_0()
            .w_full()
            .h(px(theme::control()))
            .pr(px(metric::SIDEBAR_ROW_RIGHT_GAP))
            .child(
                div()
                    .id(child_id(&self.id, "title"))
                    .flex()
                    .items_center()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .ml(px(metric::SIDEBAR_ROW_LEFT_GAP))
                    .px(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
                    .gap(px(6.))
                    .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                    .text_size(px(m.left.content))
                    .line_height(px(m.left.line_height))
                    .text_color(t.subtle)
                    .when(toggle.is_some(), |d| d.cursor(theme::clickable_cursor()))
                    .child(
                        Icon::new(if self.expanded {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        })
                        .small()
                        .stroke(2.)
                        .color(t.text_disabled),
                    )
                    .child(div().flex_shrink_0().child(self.title))
                    .children(self.count.map(|count| {
                        div()
                            .text_size(px(m.left.meta))
                            .text_color(t.text_disabled)
                            .child(count.to_string())
                    }))
                    .when_some(toggle, |d, toggle| {
                        d.on_click(move |_, window, cx| toggle(window, cx))
                    }),
            )
            .children(self.actions)
    }
}

/// `.po-desktop-sidebar-group`: an optional title row; groups after the
/// first get a full-bleed divider in their 12px top gap.
#[derive(IntoElement)]
pub struct SidebarGroup {
    title: Option<SharedString>,
    first: bool,
    children: Vec<AnyElement>,
}
impl SidebarGroup {
    pub fn new(title: Option<SharedString>) -> Self {
        Self {
            title,
            first: false,
            children: vec![],
        }
    }
    /// The first group has no divider.
    pub fn first(mut self, first: bool) -> Self {
        self.first = first;
        self
    }
}
impl ParentElement for SidebarGroup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}
impl RenderOnce for SidebarGroup {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        div()
            .flex()
            .flex_col()
            .relative()
            .min_w_0()
            .when(!self.first, |d| {
                d.pt(px(metric::SIDEBAR_GROUP_GAP)).child(
                    div()
                        .absolute()
                        .top(px(metric::SIDEBAR_GROUP_DIVIDER_TOP))
                        .left(px(-metric::SIDEBAR_ROW_LEFT_GAP))
                        .right(px(-metric::SIDEBAR_ROW_RIGHT_GAP))
                        .h(px(1.))
                        .bg(t.sidebar_divider),
                )
            })
            .children(self.title.map(|title| {
                div()
                    .flex()
                    .items_center()
                    .w_full()
                    .h(px(theme::control()))
                    .flex_shrink_0()
                    .px(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
                    .text_size(px(theme::ty().left.meta))
                    .line_height(px(theme::ty().left.line_height))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.subtle)
                    .child(title)
            }))
            .children(self.children)
    }
}
