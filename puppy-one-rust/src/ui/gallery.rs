//! Dev-capture component gallery: every library component in its states,
//! in the active appearance (`PUPPYONE_LAB=gallery-<dark|light>`, or
//! `gallery-dialog-<mode>` for the dialog over its backdrop).
use super::components::{
    Button, ButtonVariant, Dialog, Icon, IconButton, Menu, MenuItem, MenuVariant, MutedRow,
    ResizeHandle, RowActionButton, RowVariant, SectionHeader, Segment, SegmentedControl, Select,
    SelectOption, SettingRow, SettingsSubsection, SidebarGroup, SidebarRow, Spinner, Switch,
    ValueRow,
};
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, Selectable as _},
    component::Sizable as _,
};

pub struct Gallery {
    dialog: bool,
}
impl Gallery {
    pub fn new(dialog: bool) -> Self {
        Self { dialog }
    }
}
fn section(title: &'static str, body: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(10.))
        .child(
            div()
                .text_size(px(12.))
                .font_weight(FontWeight::MEDIUM)
                .child(title),
        )
        .child(body)
}
fn row() -> Div {
    div().flex().items_center().flex_wrap().gap(px(10.))
}
fn noop(_: &ClickEvent, _: &mut Window, _: &mut App) {}
/// A pane edge, a workbench split, an edge being dragged and a closed
/// pane's edge lane, each between two 48px panes.
fn resize_handles(t: crate::theme::Theme) -> Vec<Div> {
    let lane = crate::theme::metric::PANE_SASH;
    let edge = |id: &'static str| {
        ResizeHandle::new(id, Axis::Horizontal)
            .divider(t.sidebar_divider)
            .stroke_at(1.)
    };
    let collapsed = crate::theme::pane::COLLAPSED_EDGE_HIT;
    [
        (edge("rh-edge"), lane),
        (
            ResizeHandle::new("rh-split", Axis::Horizontal)
                .stroke_at((lane - 1.) / 2.)
                .rest(t.divider),
            lane,
        ),
        (edge("rh-dragged").resizing(true), lane),
        (
            ResizeHandle::new("rh-collapsed", Axis::Horizontal)
                .stroke_at(collapsed - 1.)
                .rest(crate::theme::alpha(t.shell_divider, 0.72))
                .hover(t.border_strong)
                .cursor(CursorStyle::ResizeLeft),
            collapsed,
        ),
    ]
    .into_iter()
    .map(|(handle, width)| {
        div().relative().w(px(96.)).h(px(56.)).bg(t.sidebar).child(
            handle
                .absolute()
                .top_0()
                .left(px(48. - 1.))
                .w(px(width))
                .h_full(),
        )
    })
    .collect()
}
impl Render for Gallery {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let buttons = [
            ("Outline", ButtonVariant::Outline),
            ("Primary", ButtonVariant::OutlinePrimary),
            ("Danger", ButtonVariant::OutlineDanger),
            ("Filled", ButtonVariant::Filled),
            ("Commit", ButtonVariant::FilledPrimary),
            ("Ghost", ButtonVariant::Ghost),
            ("Titlebar", ButtonVariant::Titlebar),
            ("Save", ButtonVariant::Success),
            ("Cancel", ButtonVariant::Secondary),
            ("Save", ButtonVariant::Solid),
            ("Delete", ButtonVariant::SolidDanger),
        ];
        let button_row = |disabled: bool| {
            row().children(buttons.iter().enumerate().map(|(i, (label, variant))| {
                Button::new(("gallery-button", i + usize::from(disabled) * 100))
                    .variant(*variant)
                    .label(*label)
                    .when(i == 1 || i == 4, |b| b.icon("plus"))
                    .disabled(disabled)
                    .on_click(noop)
            }))
        };
        let menu = |variant: MenuVariant, id: &'static str| {
            Menu::new(id)
                .variant(variant)
                .w(px(224.))
                .item(MenuItem::new("Copy Path").icon("copy"))
                .separator()
                .item(
                    MenuItem::new("Paste into folder")
                        .icon("clipboard-paste")
                        .shortcut("⌘V")
                        .disabled(true),
                )
                .item(MenuItem::new("Copy item").icon("copy").shortcut("⌘C"))
                .item(MenuItem::new("Selected").icon("folder").checked(true))
                .item(
                    MenuItem::new("Custom files")
                        .icon("workflow")
                        .trailing(Icon::new("chevron-right").small().stroke(2.)),
                )
                .separator()
                .item(MenuItem::new("Delete item").icon("trash-2").danger())
        };
        let sidebar = |variant: RowVariant, id: &'static str| {
            div()
                .w(px(260.))
                .flex()
                .flex_col()
                .child(
                    SidebarRow::new((id, 0usize))
                        .variant(variant)
                        .icon("folder")
                        .label("Resting"),
                )
                .child(
                    SidebarRow::new((id, 1usize))
                        .variant(variant)
                        .icon("folder")
                        .label("Selected")
                        .selected(true),
                )
                .child(
                    SidebarRow::new((id, 2usize))
                        .variant(variant)
                        .icon("folder")
                        .label("Menu open")
                        .open(true)
                        .action(RowActionButton::new((id, 20usize), "plus").label("Create"))
                        .action(
                            RowActionButton::new((id, 21usize), "ellipsis-vertical")
                                .label("More")
                                .open(true),
                        ),
                )
                .child(
                    SidebarRow::new((id, 3usize))
                        .variant(variant)
                        .icon("folder")
                        .label("Cut")
                        .dimmed(true),
                )
                .child(
                    SidebarRow::new((id, 4usize))
                        .variant(variant)
                        .icon("folder")
                        .label("Disabled")
                        .disabled(true),
                )
        };
        let page = div()
            .size_full()
            .flex()
            .flex_col()
            .gap(px(22.))
            .p(px(28.))
            .bg(t.sidebar)
            .text_color(t.text)
            .font_family("Geist")
            .text_size(px(14.))
            .child(section(
                "Button",
                div()
                    .flex()
                    .flex_col()
                    .gap(px(10.))
                    .child(button_row(false))
                    .child(button_row(true)),
            ))
            .child(section(
                "Button states · open (menu expanded) and selected",
                row()
                    .child(
                        Button::new("state-0")
                            .variant(ButtonVariant::Ghost)
                            .icon(Icon::new("house-compact").large())
                            .label("Ghost open")
                            .open(true),
                    )
                    .child(
                        Button::new("state-1")
                            .variant(ButtonVariant::Titlebar)
                            .icon("agent-entry")
                            .accessibility_label("Titlebar selected")
                            .selected(true),
                    )
                    .child(
                        Button::new("state-2")
                            .variant(ButtonVariant::Titlebar)
                            .icon("laptop")
                            .accessibility_label("Titlebar open")
                            .open(true),
                    )
                    .child(
                        Icon::new("loader-circle")
                            .color(t.muted)
                            .spinning("gallery-spinning-icon"),
                    ),
            ))
            .child(section(
                "IconButton",
                row()
                    .child(IconButton::new("ib-0", "history").label("History"))
                    .child(
                        IconButton::new("ib-1", "history")
                            .label("Selected")
                            .selected(true),
                    )
                    .child(
                        IconButton::new("ib-2", "ellipsis-vertical")
                            .label("Open")
                            .open(true),
                    )
                    .child(IconButton::new("ib-3", "trash-2").label("Danger").danger())
                    .child(IconButton::new("ib-4", "history").label("Small").small())
                    .child(IconButton::new("ib-5", "history").label("Large").large())
                    .child(
                        IconButton::new("ib-6", "history")
                            .label("Disabled")
                            .disabled(true),
                    ),
            ))
            .child(section(
                "Switch · SegmentedControl · Select · Spinner",
                row()
                    .child(Switch::new("sw-0", "On").checked(true))
                    .child(Switch::new("sw-1", "Off"))
                    .child(Switch::new("sw-2", "Disabled").disabled(true))
                    .child(SegmentedControl::new("seg").segments([
                        Segment::new("System").selected(true),
                        Segment::new("Light"),
                        Segment::new("Dark"),
                    ]))
                    .child(Select::new("select", "Dark", |_| {
                        vec![
                            SelectOption::new("Light"),
                            SelectOption::new("Dark").selected(true),
                        ]
                    }))
                    .child(Spinner::new("spin", t.border, t.accent)),
            ))
            .child(section(
                "ResizeHandle · pane edge · split · dragged · collapsed edge",
                row().children(resize_handles(t)),
            ))
            .child(
                div()
                    .flex()
                    .gap(px(24.))
                    .items_start()
                    .child(section(
                        "Menu · Default",
                        menu(MenuVariant::Default, "menu-default"),
                    ))
                    .child(section(
                        "Menu · SidebarAction",
                        menu(MenuVariant::SidebarAction, "menu-sidebar"),
                    ))
                    .child(section(
                        "Menu · Project",
                        menu(MenuVariant::Project, "menu-project"),
                    ))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(16.))
                            .child(section(
                                "SidebarRow · Tree",
                                sidebar(RowVariant::Tree, "tree"),
                            ))
                            .child(section(
                                "SectionHeader · SidebarGroup",
                                div()
                                    .w(px(260.))
                                    .child(
                                        SectionHeader::new("sh", "Staged Changes").count(1).action(
                                            Button::new("sh-commit")
                                                .variant(ButtonVariant::FilledPrimary)
                                                .label("Commit")
                                                .icon("plus")
                                                .small(),
                                        ),
                                    )
                                    .child(
                                        SidebarGroup::new(Some("Group".into())).child(
                                            SidebarRow::new("nav-row")
                                                .variant(RowVariant::Nav)
                                                .icon("settings")
                                                .label("Nav selected")
                                                .selected(true),
                                        ),
                                    ),
                            )),
                    ),
            )
            .child(section(
                "Settings",
                div().w(px(640.)).child(
                    SettingsSubsection::new()
                        .title("Subsection")
                        .child(
                            SettingRow::new("Setting row")
                                .control(Switch::new("set-sw", "On").checked(true)),
                        )
                        .child(ValueRow::new("Value row", "/Users/example/project").monospace(true))
                        .child(MutedRow::new("Muted row"))
                        .child(MutedRow::new("Danger row").danger()),
                ),
            ));
        let dialog = self.dialog.then(|| {
            Dialog::new("gallery-dialog")
                .title("Rename")
                .on_close(|_, _| {})
                .child("Dialog body text in the muted colour.")
                .footer(
                    Button::new("dlg-cancel")
                        .variant(ButtonVariant::Secondary)
                        .label("Cancel"),
                )
                .footer(
                    Button::new("dlg-save")
                        .variant(ButtonVariant::Solid)
                        .label("Save"),
                )
        });
        div().size_full().child(page).children(dialog)
    }
}
