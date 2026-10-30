//! Port of `AuxiliaryWorkbenchLauncher` / `TerminalLauncher` (chat mode) with
//! `auxiliary-workbench-launcher.css`: detected local agents, then the bundled
//! Built-in Agent, then Terminal, inside a bordered group whose heading and
//! History control sit on its top border. Right-click an Agent to run its CLI
//! in a terminal instead of Chat.
use super::*;
use crate::ui::appearance::ActiveAppearance;
use crate::{
    features::desktop_agent::ui::agent_brand_mark::{LauncherIdentity, launcher_icon},
    localization::t as tr,
    theme,
    ui::components::{Icon, IconButton, Spinner},
};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
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
        available: bool,
        cx: &App,
    ) -> gpui_kit::base::Button {
        let t = cx.palette();
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
            // `:disabled`: a contribution at its `maximumItems`.
            .disabled(!available)
            .when(available, |b| {
                b.cursor(theme::clickable_cursor())
                    .hover(move |b| b.bg(t.hover).text_color(t.text))
            })
            .when(!available, |b| b.opacity(0.52))
            .child(
                launcher_icon(identity, false, t.dark, t.muted)
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
        let t = cx.palette();
        let m = theme::ty();
        let visible = self.visible_installations();
        let (chats, terminals) = (self.can_create(true), self.can_create(false));
        let mut external = v_flex().gap(px(1.));
        for (i, installation) in visible.iter().filter(|i| !i.bundled()).cloned().enumerate() {
            let terminal = installation.clone();
            let row_group = SharedString::from(format!("launch-agent-{group}-{i}"));
            external = external.child(
                self.launcher_row(
                    ElementId::NamedInteger("launch-agent".into(), group * 100 + i as u64),
                    LauncherIdentity::Runtime(installation.runtime),
                    installation.label.clone().into(),
                    row_group,
                    if installation.chat { chats } else { terminals },
                    cx,
                )
                .on_click(cx.listener(move |s, _, w, cx| {
                    s.chat_mode = true;
                    s.launch(group, tab, Some(installation.clone()), false, w, cx)
                }))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        s.open_context_menu(
                            super::menus::ContextMenu::Launcher {
                                group,
                                tab,
                                installation: terminal.clone(),
                                at: e.position,
                            },
                            cx,
                        );
                    }),
                ),
            );
        }
        let mut bundled = v_flex().gap(px(1.));
        for (i, installation) in visible.iter().filter(|i| i.bundled()).cloned().enumerate() {
            bundled = bundled.child(
                self.launcher_row(
                    ElementId::NamedInteger("launch-bundled".into(), group * 100 + i as u64),
                    LauncherIdentity::Runtime(installation.runtime),
                    installation.label.clone().into(),
                    format!("launch-bundled-{group}-{i}").into(),
                    if installation.chat { chats } else { terminals },
                    cx,
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
                terminals,
                cx,
            )
            .on_click(cx.listener(move |s, _, w, cx| s.launch(group, tab, None, false, w, cx)));

        // `.desktop-terminal-launcher-scan` / `-history`: 18px quiet controls.
        let quiet = |id: &'static str, icon: Icon, label: &'static str| {
            IconButton::new(ElementId::NamedInteger(id.into(), group), icon)
                .label(label)
                .with_size(px(18.))
                .color(t.subtle)
                .rounded(px(4.))
        };
        let scan = quiet(
            "launcher-scan",
            Icon::new("refresh-cw").xsmall().stroke(1.7),
            tr("terminal.launcher.scanAgain"),
        )
        .disabled(self.scanning)
        .on_click(cx.listener(|s, _, _, cx| s.rescan(cx)));

        // `.desktop-terminal-launcher-history`: opens the cross-runtime
        // History browser in this launcher (`onOpenHistory`).
        let history = quiet(
            "launcher-history",
            Icon::new("history").with_size(px(13.)).stroke(1.7),
            tr("agent.history.title"),
        )
        .bg(t.auxiliary())
        .on_click(cx.listener(move |s, _, window, cx| {
            // Cloud: the hosted Agent's own history (`CloudAgentHistory`).
            if s.cloud.is_some() {
                s.chat_mode = true;
                s.launch(group, tab, Some(cloud_installation()), true, window, cx);
            } else {
                s.open_history(group, tab, window, cx)
            }
        }));
        let cloud = self.cloud.is_some();

        let mut entries = v_flex().gap(px(1.)).child(external);
        // `discoveryPhase="ready"`: no local discovery in Cloud.
        let scanning = self.scanning && !cloud;
        let feedback = scanning
            && self
                .scan_started
                .is_some_and(|start| start.elapsed() >= FEEDBACK_DELAY);
        if scanning && !feedback {
            // Re-render once the indicator delay has passed.
            let wake = self.wake.clone();
            wake.after(FEEDBACK_DELAY);
        }
        if feedback {
            // `LauncherDiscoveryFeedback`: an 11px spinning ring in the icon column.
            entries = entries.child(
                h_flex()
                    .min_h(px(theme::control_large()))
                    .px(px(8.))
                    .py(px(5.))
                    .gap(px(9.))
                    .border_1()
                    .border_color(theme::alpha(t.border, 0.))
                    .text_size(px(m.right.content))
                    .line_height(px(m.right.control_line_height))
                    .text_color(t.subtle)
                    .child(div().w(px(18.)).flex().justify_center().child(Spinner::new(
                        ElementId::NamedInteger("launcher-scanning".into(), group),
                        t.border,
                        t.subtle,
                    )))
                    .child(tr("terminal.launcher.detecting")),
            );
        }
        // `agentSetup`: suggested and running activations, between the
        // detected Agents and the bundled one.
        if !cloud && let Some(setup) = self.setup_section(cx) {
            entries = entries.child(setup);
        }
        // `terminalEnabled={false}`: a Cloud launcher offers no shell.
        entries = entries.child(bundled).when(!cloud, |e| e.child(shell));

        // `.desktop-terminal-launcher-error`.
        let error = self.launch_errors.get(&group).map(|message| {
            h_flex()
                .min_w_0()
                .items_start()
                .gap(px(6.))
                .px(px(8.))
                .py(px(5.))
                .rounded(px(5.))
                .bg(theme::alpha(t.danger, 0.08))
                .text_color(t.danger)
                .text_size(px(m.right.caption))
                .line_height(px(m.right.caption_line_height))
                .child(
                    div().mt(px(1.)).flex_shrink_0().child(
                        Icon::new("circle-alert")
                            .with_size(px(13.))
                            .stroke(1.7)
                            .color(t.danger),
                    ),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .whitespace_normal()
                        .child(message.clone()),
                )
        });
        let heading = h_flex()
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
                    .child(tr(if cloud {
                        "cloud.home.cloud"
                    } else {
                        "terminal.launcher.localTitle"
                    })),
            )
            .when(!cloud, |h| h.child(scan));
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
        let scroll = self.launcher_scroll.entry(group).or_default().clone();
        div()
            .id(("launcher", group))
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&scroll)
            .bg(t.auxiliary())
            .text_color(t.terminal_fg)
            .child(
                // `place-items: safe center`: centred, but never above the top edge.
                v_flex()
                    .min_h_full()
                    .py(px(32.))
                    .items_center()
                    .justify_center()
                    .child(
                        v_flex()
                            .relative()
                            .w(px(content_width(width)))
                            .p(px(18.))
                            .gap(px(8.))
                            .border_1()
                            .border_color(t.border)
                            .child(heading)
                            .child(history)
                            .children(error)
                            .child(entries),
                    ),
            )
            .child(crate::ui::scrollbar::vertical(
                ("launcher-scrollbar", group),
                &scroll,
            ))
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
