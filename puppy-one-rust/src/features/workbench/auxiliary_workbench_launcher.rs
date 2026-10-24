//! Port of `AuxiliaryWorkbenchLauncher` / `TerminalLauncher` (chat mode) with
//! `auxiliary-workbench-launcher.css`: detected local agents, then the bundled
//! Built-in Agent, then Terminal, inside a bordered group whose heading and
//! History control sit on its top border. Right-click an Agent to run its CLI
//! in a terminal instead of Chat.
use super::*;
use crate::{
    features::desktop_agent::ui::agent_brand_mark::{LauncherIdentity, launcher_icon},
    localization::t as tr,
    theme,
    ui::{icon_stroke, tooltip},
};
use gpui_kit::component::{
    Sizable,
    button::ButtonVariants,
    menu::{ContextMenuExt, DropdownMenu, PopupMenuItem},
};

/// `.desktop-terminal-launcher-content`: `min(100%, 252px)`, 264px from a 460px container.
fn content_width(container: f32) -> f32 {
    if container >= 460. {
        264.
    } else {
        container.min(252.)
    }
}
/// Discovery feedback appears only after 200ms (`useDelayedDiscoveryFeedback`).
const FEEDBACK_DELAY: std::time::Duration = std::time::Duration::from_millis(200);

impl Workbench {
    /// `.desktop-terminal-launcher-tool` / `-shell`: a full-width, start-aligned row.
    fn launcher_row(
        &self,
        id: ElementId,
        identity: LauncherIdentity,
        label: SharedString,
        group: SharedString,
    ) -> gpui_kit::base::Button {
        let t = Theme::new(self.dark);
        let m = theme::ty();
        gpui_kit::base::Button::new(id)
            .accessibility_label(format!("{}: {label}", tr("terminal.launcher.title")))
            .group(group.clone())
            .w_full()
            .min_h(px(theme::control_large()))
            .justify_start()
            .gap(px(9.))
            .px(px(8.))
            .py(px(5.))
            .border_1()
            .border_color(theme::alpha(t.border, 0.))
            .rounded(px(theme::metric::CONTROL_RADIUS))
            .text_color(t.muted)
            .cursor(theme::clickable_cursor())
            .hover(move |b| b.bg(t.hover).text_color(t.text))
            .child(
                launcher_icon(identity, false, self.dark, t.muted)
                    .group_hover(group, |s| s.opacity(1.)),
            )
            .child(
                div()
                    .min_w_0()
                    .text_size(px(m.right.content))
                    .line_height(px(m.right.control_line_height))
                    .truncate()
                    .child(label),
            )
    }

    pub(super) fn launcher(
        &mut self,
        group: Id,
        tab: Option<Id>,
        width: f32,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t = Theme::new(self.dark);
        let m = theme::ty();
        let visible = self.visible_installations();
        let mut external = column().gap(px(1.));
        for (i, installation) in visible.iter().filter(|i| !i.bundled()).cloned().enumerate() {
            let terminal = installation.clone();
            let host = cx.weak_entity();
            let row_group = SharedString::from(format!("launch-agent-{group}-{i}"));
            external = external.child(
                self.launcher_row(
                    ElementId::NamedInteger("launch-agent".into(), group * 100 + i as u64),
                    LauncherIdentity::Runtime(installation.runtime),
                    installation.label.clone().into(),
                    row_group,
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
            bundled = bundled.child(
                self.launcher_row(
                    ElementId::NamedInteger("launch-bundled".into(), group * 100 + i as u64),
                    LauncherIdentity::Runtime(installation.runtime),
                    installation.label.clone().into(),
                    format!("launch-bundled-{group}-{i}").into(),
                )
                .on_click(cx.listener(move |s, _, w, cx| {
                    s.chat_mode = true;
                    s.launch(group, tab, Some(installation.clone()), false, w, cx)
                })),
            );
        }
        let shell = self
            .launcher_row(
                ElementId::NamedInteger("open-shell".into(), group),
                LauncherIdentity::Shell,
                tr("terminal.title").into(),
                format!("open-shell-{group}").into(),
            )
            .on_click(cx.listener(move |s, _, w, cx| s.launch(group, tab, None, false, w, cx)));

        // `.desktop-terminal-launcher-scan` / `-history`: 18px quiet controls.
        let quiet = |button: gpui_kit::base::Button, enabled: bool| {
            button
                .size(px(18.))
                .rounded(px(4.))
                .text_color(t.subtle)
                .when(enabled, |b| {
                    b.cursor(theme::clickable_cursor())
                        .hover(move |b| b.bg(t.hover).text_color(t.muted))
                })
                .when(!enabled, |b| b.opacity(0.52))
        };
        let scan_label = tr("terminal.launcher.scanAgain");
        let scan = quiet(
            gpui_kit::base::Button::new(ElementId::NamedInteger("launcher-scan".into(), group))
                .accessibility_label(scan_label)
                .disabled(self.scanning),
            !self.scanning,
        )
        .tooltip(tooltip(scan_label))
        .child(icon_stroke("refresh-cw", 12., 1.7, t.subtle))
        .on_click(cx.listener(|s, _, _, cx| s.rescan(cx)));

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
        .p_0()
        .child(icon_stroke("history", 13., 1.7, t.subtle))
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

        let mut entries = column().gap(px(1.)).child(external);
        let feedback = self.scanning
            && self
                .scan_started
                .is_some_and(|start| start.elapsed() >= FEEDBACK_DELAY);
        if self.scanning && !feedback {
            // Re-render once the indicator delay has passed.
            let wake = self.wake.clone();
            wake.after(FEEDBACK_DELAY);
        }
        if feedback {
            // `LauncherDiscoveryFeedback`: an 11px spinning ring in the icon column.
            entries =
                entries.child(
                    row()
                        .min_h(px(theme::control_large()))
                        .px(px(8.))
                        .py(px(5.))
                        .gap(px(9.))
                        .border_1()
                        .border_color(theme::alpha(t.border, 0.))
                        .text_size(px(m.right.content))
                        .line_height(px(m.right.control_line_height))
                        .text_color(t.subtle)
                        .child(div().w(px(18.)).flex().justify_center().child(
                            crate::ui::spinner_ring(
                                ElementId::NamedInteger("launcher-scanning".into(), group),
                                11.,
                                t.border,
                                t.subtle,
                            ),
                        ))
                        .child(tr("terminal.launcher.detecting")),
                );
        }
        entries = entries.child(bundled).child(shell);

        let heading = row()
            .absolute()
            .top(px(-theme::control() / 2.))
            .left(px(22.))
            .h(px(theme::control()))
            .px(px(6.))
            .gap(px(4.))
            .bg(t.auxiliary())
            .child(
                div()
                    .text_size(px(m.right.meta))
                    .line_height(px(m.right.meta_line_height))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.subtle)
                    .whitespace_nowrap()
                    .child(tr("terminal.launcher.localTitle")),
            )
            .child(scan);
        let history = div()
            .absolute()
            .top(px(-9.))
            .right(px(22.))
            .rounded(px(4.))
            .bg(t.auxiliary())
            // `box-shadow: 0 0 0 6px var(--po-surface-auxiliary)` masks the border.
            .shadow(vec![BoxShadow {
                inset: false,
                color: t.auxiliary().into(),
                offset: point(px(0.), px(0.)),
                blur_radius: px(0.),
                spread_radius: px(6.),
            }])
            .child(history);
        div()
            .id(("launcher", group))
            .size_full()
            .overflow_y_scroll()
            .bg(t.auxiliary())
            .text_color(t.terminal_fg)
            .child(
                // `place-items: safe center`: centred, but never above the top edge.
                column()
                    .min_h_full()
                    .py(px(32.))
                    .items_center()
                    .justify_center()
                    .child(
                        column()
                            .relative()
                            .w(px(content_width(width)))
                            .p(px(18.))
                            .gap(px(8.))
                            .border_1()
                            .border_color(t.border)
                            .child(heading)
                            .child(history)
                            .child(entries),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn content_width_follows_the_container_query() {
        assert_eq!(super::content_width(420.), 252.);
        assert_eq!(super::content_width(200.), 200.);
        assert_eq!(super::content_width(460.), 264.);
    }
}
