//! Port of `AuxiliaryWorkbenchLauncher` / `TerminalLauncher` (chat mode):
//! detected local agents, then the bundled Built-in Agent, then Terminal.
//! The heading carries "Scan again"; History opens a saved chat per Agent.
//! Right-click an Agent to run its CLI in a terminal instead of Chat.
use super::*;
use crate::{
    localization::t as tr,
    theme,
    ui::{icon_sized, tooltip},
};
use gpui_kit::component::{
    Sizable,
    button::ButtonVariants,
    menu::{ContextMenuExt, DropdownMenu, PopupMenuItem},
};
impl Workbench {
    pub(super) fn launcher(&self, group: Id, tab: Option<Id>, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let m = theme::ty();
        let visible = self.visible_installations();
        let tool = |id: ElementId, leading: AnyElement, label: SharedString| {
            gpui_kit::base::Button::new(id)
                .accessibility_label(format!("{}: {label}", tr("terminal.launcher.title")))
                .flex()
                .items_center()
                .w_full()
                .h(px(theme::control()))
                .px(px(8.))
                .gap(px(8.))
                .rounded(px(theme::metric::CONTROL_RADIUS))
                .text_size(px(m.right.content))
                .text_color(t.terminal_fg)
                .cursor(theme::clickable_cursor())
                .hover(move |b| b.bg(t.hover).text_color(t.text))
                .child(leading)
                .child(div().truncate().child(label))
        };
        let mut external = column().gap(px(1.));
        for (i, installation) in visible.iter().filter(|i| !i.bundled()).cloned().enumerate() {
            let runtime = installation.runtime;
            let label: SharedString = installation.label.clone().into();
            let terminal = installation.clone();
            let host = cx.weak_entity();
            external = external.child(
                tool(
                    ElementId::NamedInteger("launch-agent".into(), group * 100 + i as u64),
                    crate::features::desktop_agent::ui::agent_brand_mark::brand(
                        runtime,
                        self.dark,
                        18.,
                        t.terminal_fg,
                    ),
                    label,
                )
                .on_click(cx.listener(move |s, _, w, cx| {
                    s.chat_mode = true;
                    s.launch(group, tab, Some(installation.clone()), false, w, cx)
                }))
                .context_menu(move |menu, _, _| {
                    let host = host.clone();
                    let terminal = terminal.clone();
                    menu.item(
                        PopupMenuItem::new(tr("terminal.title")).on_click(move |_, w, cx| {
                            let _ = host.update(cx, |s, cx| {
                                s.chat_mode = false;
                                s.launch(group, tab, Some(terminal.clone()), false, w, cx)
                            });
                        }),
                    )
                }),
            );
        }
        let mut bundled = column().gap(px(1.));
        for (i, installation) in visible.iter().filter(|i| i.bundled()).cloned().enumerate() {
            let runtime = installation.runtime;
            bundled = bundled.child(
                tool(
                    ElementId::NamedInteger("launch-bundled".into(), group * 100 + i as u64),
                    crate::features::desktop_agent::ui::agent_brand_mark::brand(
                        runtime,
                        self.dark,
                        18.,
                        t.terminal_fg,
                    ),
                    installation.label.clone().into(),
                )
                .on_click(cx.listener(move |s, _, w, cx| {
                    s.chat_mode = true;
                    s.launch(group, tab, Some(installation.clone()), false, w, cx)
                })),
            );
        }
        let shell = tool(
            ElementId::NamedInteger("open-shell".into(), group),
            icon_sized("square-terminal", 18., t.muted).into_any_element(),
            tr("terminal.title").into(),
        )
        .on_click(cx.listener(move |s, _, w, cx| s.launch(group, tab, None, false, w, cx)));

        // History: choose which Agent's saved chats to browse.
        let host = cx.weak_entity();
        let chats: Vec<_> = visible.iter().filter(|i| i.chat).cloned().collect();
        let history_label = tr("agent.history.title");
        let history = gpui_kit::component::button::Button::new(ElementId::NamedInteger(
            "launcher-history".into(),
            group,
        ))
        .ghost()
        .xsmall()
        .icon(crate::ui::menu_icon("history"))
        .size(px(18.))
        .rounded(px(4.))
        .bg(t.auxiliary())
        .text_color(t.subtle)
        .tooltip(history_label)
        .dropdown_menu(move |mut menu, _, _| {
            menu = menu.label(tr("agent.history.title"));
            for installation in &chats {
                let host = host.clone();
                let installation = installation.clone();
                menu = menu.item(PopupMenuItem::new(installation.label.clone()).on_click(
                    move |_, w, cx| {
                        let _ = host.update(cx, |s, cx| {
                            s.chat_mode = true;
                            s.launch(group, tab, Some(installation.clone()), true, w, cx)
                        });
                    },
                ));
            }
            menu
        });
        let scan_label = tr("terminal.launcher.scanAgain");
        let scan =
            gpui_kit::base::Button::new(ElementId::NamedInteger("launcher-scan".into(), group))
                .accessibility_label(scan_label)
                .disabled(self.scanning)
                .size(px(18.))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(4.))
                .when(!self.scanning, |b| {
                    b.cursor(theme::clickable_cursor())
                        .hover(move |b| b.bg(t.hover))
                })
                .tooltip(tooltip(scan_label))
                .child(icon_sized("refresh-cw", 12., t.subtle))
                .on_click(cx.listener(|s, _, _, cx| s.rescan(cx)));
        let mut entries = column().gap(px(1.)).child(external);
        if self.scanning {
            let preset = self.loading_animation.clone();
            entries = entries.child(
                row()
                    .h(px(m.right.control_line_height + 8.))
                    .px(px(8.))
                    .gap(px(8.))
                    .text_size(px(m.right.meta))
                    .text_color(t.subtle)
                    .child(crate::ui::pulse_grid::pulse_grid(
                        ElementId::NamedInteger("launcher-scanning".into(), group),
                        &preset,
                        crate::ui::pulse_grid::PulseSize::Sm,
                        t.subtle,
                    ))
                    .child(tr("terminal.launcher.detecting")),
            );
        }
        entries = entries.child(bundled).child(shell);
        column()
            .size_full()
            .min_h_0()
            .justify_center()
            .items_center()
            .py(px(32.))
            .bg(t.auxiliary())
            .child(
                column()
                    .relative()
                    .w(px(252.))
                    .max_w_full()
                    .p(px(18.))
                    .gap(px(8.))
                    .border_1()
                    .border_color(t.border)
                    .child(
                        row()
                            .absolute()
                            .top(px(-theme::control() / 2.))
                            .left(px(22.))
                            .h(px(theme::control()))
                            .px(px(6.))
                            .gap(px(4.))
                            .bg(t.auxiliary())
                            .text_size(px(m.right.meta))
                            .text_color(t.subtle)
                            .child(tr("terminal.launcher.localTitle"))
                            .child(scan),
                    )
                    .child(div().absolute().top(px(-9.)).right(px(22.)).child(history))
                    .child(entries),
            )
    }
}
