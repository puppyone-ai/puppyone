//! Port of `AuxiliaryWorkbenchLauncher` / `TerminalLauncher` (chat mode) with
//! `auxiliary-workbench-launcher.css`: detected local agents, then the bundled
//! Built-in Agent, then Terminal, inside a bordered group whose heading and
//! History control sit on its top border. Right-click an Agent to run its CLI
//! in a terminal instead of Chat.
use super::*;
use crate::ui::appearance::ActiveAppearance;
use crate::{
    localization::t as tr,
    theme,
    ui::agent_brand_mark::{LauncherIdentity, launcher_icon},
    ui::components::{AnchoredMenu, IconButton, Menu, MenuItem, Spinner},
};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

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

impl WorkbenchLauncher {
    /// `availabilityMessage` while discovery runs: nothing for the first
    /// 200ms, then what it is doing. Never a failure or an empty result:
    /// background discovery is best-effort and manual refresh stays.
    pub(super) fn discovery_label(&self) -> Option<&'static str> {
        let shown = self.scanning
            && !self.hosted.is_open()
            && self
                .scan_started
                .is_some_and(|start| start.elapsed() >= FEEDBACK_DELAY);
        shown.then_some(if self.refreshing {
            "terminal.launcher.refreshing"
        } else {
            "terminal.launcher.detecting"
        })
    }
    /// `availabilityMessage`, the launcher's polite status: what discovery
    /// is doing once its feedback shows, then that it finished — unless it
    /// failed or found no Agent, which it never announces.
    pub(super) fn availability(&self) -> Option<&'static str> {
        use crate::platform::local_agent_setup::{ObservationFailure, ObservationStatus};
        if self.hosted.is_open() {
            return None;
        }
        if self.scanning {
            return self.discovery_label();
        }
        let failed = self.observations.iter().any(|o| {
            o.status == ObservationStatus::Failed
                || o.failure == Some(ObservationFailure::EnvironmentUnavailable)
        });
        let found = self.installations.iter().any(|i| !i.bundled());
        (!failed && found).then_some("terminal.launcher.detectionComplete")
    }
    /// A launcher row's focus, kept by its Agent: a row stays focused while
    /// discovery adds rows around it.
    fn row_focus(&mut self, group: Id, id: &'static str, cx: &mut Context<Self>) -> FocusHandle {
        self.row_focus
            .entry((group, id))
            .or_insert_with(|| cx.focus_handle())
            .clone()
    }
    /// `onReturnToLauncher`: the launcher's first usable Agent — detected,
    /// else bundled — or else its heading takes the keyboard.
    pub(super) fn return_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let group = self
            .setup_group
            .filter(|group| self.heading_focus.contains_key(group))
            .or_else(|| self.heading_focus.keys().min().copied());
        let Some(group) = group else {
            return;
        };
        let target = self
            .return_targets
            .get(&group)
            .and_then(|targets| targets.first())
            .or_else(|| self.heading_focus.get(&group));
        if let Some(target) = target.cloned() {
            target.focus(window, cx);
        }
    }
    /// The launcher's setup section, narrowed to this launcher's surface and
    /// the detected Agents.
    fn setup_section(
        &mut self,
        cx: &mut Context<Self>,
    ) -> Option<Entity<crate::features::local_agents::SetupSection>> {
        use crate::features::local_agents::{Presentation, SetupSection};
        use crate::platform::local_agent_setup::Surface;
        let surface = if self.chat_mode {
            Surface::Chat
        } else {
            Surface::Terminal
        };
        if self.setup.is_none() {
            let preferences = self.preferences.clone()?;
            let owner = self.owner.clone();
            let host = cx.weak_entity();
            let section = cx.new(|cx| {
                SetupSection::new(Presentation::Launcher, surface, preferences, owner, cx)
                    .on_return(move |window, cx| {
                        let _ = host.update(cx, |l, cx| l.return_focus(window, cx));
                    })
            });
            cx.observe(&section, |_, _, cx| cx.notify()).detach();
            self.setup = Some(section);
        }
        let section = self.setup.clone()?;
        let observations = if self.scanning {
            vec![]
        } else {
            self.observations.clone()
        };
        section.update(cx, |s, cx| {
            s.set_surface(surface, cx);
            s.set_observations(observations, cx);
        });
        section.update(cx, |s, cx| s.visible(cx)).then_some(section)
    }
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
                b.cursor(theme::navigation_cursor())
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

    /// The launcher tab `context.tab`: its History browser when open, else
    /// the launcher (with its row menu when open).
    pub(super) fn render_launcher(
        &mut self,
        context: LauncherContext,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if let Some(history) = context.tab.and_then(|tab| self.render_history(tab)) {
            return history;
        }
        let menu = self.render_menu(cx);
        self.launcher(context, cx).children(menu).into_any_element()
    }
    /// A launcher row's "open in a terminal" menu, pinned at the pointer.
    fn render_menu(&self, cx: &mut Context<Self>) -> Option<AnchoredMenu> {
        let menu = self.menu.as_ref()?;
        let (group, tab, installation) = (menu.group, menu.tab, menu.installation.clone());
        let host = cx.weak_entity();
        let launch = host.clone();
        let surface = Menu::new("workbench-launcher-menu").min_w(px(180.)).item(
            MenuItem::new(crate::localization::t("terminal.title")).on_click(move |w, cx| {
                let _ = launch.update(cx, |s, cx| {
                    s.menu = None;
                    s.chat_mode = false;
                    s.launch(group, tab, Some(installation.clone()), w, cx)
                });
            }),
        );
        let close = move |cx: &mut App| {
            let _ = host.update(cx, |s, cx| {
                if s.menu.take().is_some() {
                    cx.notify();
                }
            });
        };
        let close_after_item = close.clone();
        Some(
            AnchoredMenu::new(
                "workbench-context-menu",
                menu.at,
                surface.on_dismiss(move |_, cx| close_after_item(cx)),
            )
            .on_dismiss(move |_, cx| close(cx)),
        )
    }
    fn launcher(&mut self, context: LauncherContext, cx: &mut Context<Self>) -> Stateful<Div> {
        let LauncherContext {
            group, tab, width, ..
        } = context;
        let t = cx.palette();
        let m = theme::ty();
        let visible = self.visible_installations();
        let (chats, terminals) = (context.can_chat, context.can_terminal);
        // `role="list"`: the detected Agents; discovery's feedback and
        // status sit outside it. Rows are keyed by Agent, never by place.
        let mut external = v_flex()
            .id(("launcher-agents", group))
            .role(Role::List)
            .debug_selector(|| "launcher-agents".into())
            .gap(px(1.));
        // `onReturnToLauncher`'s targets: usable detected rows, then bundled.
        let mut returns = vec![];
        for installation in visible.iter().filter(|i| !i.bundled()).cloned() {
            let terminal = installation.clone();
            let id = installation.id;
            let key = SharedString::from(format!("launch-agent-{group}-{id}"));
            let available = if installation.chat { chats } else { terminals };
            let focus = self.row_focus(group, id, cx);
            if available {
                returns.push(focus.clone());
            }
            external = external.child(
                self.launcher_row(
                    ElementId::Name(key.clone()),
                    LauncherIdentity::brand(installation.runtime.icon_key()),
                    installation.label.clone().into(),
                    key,
                    available,
                    cx,
                )
                .track_focus(&focus)
                .debug_selector(move || format!("launcher-agent-{id}"))
                .on_click(cx.listener(move |s, _, w, cx| {
                    s.chat_mode = true;
                    s.launch(group, tab, Some(installation.clone()), w, cx)
                }))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        s.menu = Some(LauncherMenu {
                            group,
                            tab,
                            installation: terminal.clone(),
                            at: e.position,
                        });
                        cx.notify();
                    }),
                ),
            );
        }
        let mut bundled = v_flex().gap(px(1.));
        for installation in visible.iter().filter(|i| i.bundled()).cloned() {
            let id = installation.id;
            let key = SharedString::from(format!("launch-bundled-{group}-{id}"));
            let available = if installation.chat { chats } else { terminals };
            let focus = self.row_focus(group, id, cx);
            if available {
                returns.push(focus.clone());
            }
            bundled = bundled.child(
                self.launcher_row(
                    ElementId::Name(key.clone()),
                    LauncherIdentity::brand(installation.runtime.icon_key()),
                    installation.label.clone().into(),
                    key,
                    available,
                    cx,
                )
                .track_focus(&focus)
                .debug_selector(move || format!("launcher-agent-{id}"))
                .on_click(cx.listener(move |s, _, w, cx| {
                    s.chat_mode = true;
                    s.launch(group, tab, Some(installation.clone()), w, cx)
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
            .debug_selector(|| "launcher-shell".into())
            .on_click(cx.listener(move |s, _, w, cx| s.launch(group, tab, None, w, cx)));

        // `.desktop-terminal-launcher-scan` / `-history`: 18px quiet controls.
        let quiet = |id: &'static str, icon: Icon, label: &'static str| {
            IconButton::new(ElementId::NamedInteger(id.into(), group), icon)
                .label(label)
                .with_size(px(18.))
                .color(t.subtle)
                .rounded(px(4.))
        };
        // A scan already running is the one a click would ask for.
        let scan = quiet(
            "launcher-scan",
            Icon::new("refresh-cw").xsmall().stroke(1.7),
            tr("terminal.launcher.scanAgain"),
        )
        .disabled(self.scanning)
        .debug_selector(|| "launcher-scan".into())
        .on_click(cx.listener(|s, _, _, cx| s.rescan(cx)));

        // `.desktop-terminal-launcher-history`: opens the cross-runtime
        // History browser in this launcher (`onOpenHistory`).
        let history = quiet(
            "launcher-history",
            Icon::new("history").with_size(px(13.)).stroke(1.7),
            tr("agent.history.title"),
        )
        .bg(t.auxiliary())
        .debug_selector(|| "launcher-history".into())
        .on_click(cx.listener(move |s, _, window, cx| {
            // Cloud reads the hosted Agent's own history (`CloudAgentHistory`).
            s.open_history(group, tab, window, cx)
        }));
        let cloud = self.hosted.is_open();

        let mut entries = v_flex().gap(px(1.)).child(external);
        // `discoveryPhase="ready"`: no local discovery in Cloud.
        let scanning = self.scanning && !cloud;
        let feedback = self.discovery_label();
        if scanning && feedback.is_none() {
            // Re-render once the indicator delay has passed.
            let wake = self.wake.clone();
            wake.after(FEEDBACK_DELAY);
        }
        if let Some(label) = feedback {
            // `LauncherDiscoveryFeedback`: an 11px spinning ring in the icon column.
            entries = entries.child(
                h_flex()
                    .debug_selector(|| "launcher-discovery".into())
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
                    .child(tr(label)),
            );
        }
        // `agentSetup`: suggested and running activations, between the
        // detected Agents and the bundled one.
        if !cloud && let Some(setup) = self.setup_section(cx) {
            entries = entries.child(
                div()
                    .debug_selector(|| "launcher-setup".into())
                    // Setup returns the keyboard to the launcher it was used in.
                    .capture_any_mouse_down(
                        cx.listener(move |s, _, _, _| s.setup_group = Some(group)),
                    )
                    .capture_key_down(cx.listener(move |s, _, _, _| s.setup_group = Some(group)))
                    .child(setup),
            );
        }
        // `terminalEnabled={false}`: a Cloud launcher offers no shell.
        entries = entries.child(bundled).when(!cloud, |e| e.child(shell));

        // `.desktop-terminal-launcher-error`.
        let error = self.launch_errors.get(&group).map(|message| {
            h_flex()
                .debug_selector(|| "launcher-error".into())
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
        let title = tr(if cloud {
            "cloud.home.cloud"
        } else {
            "terminal.launcher.localTitle"
        });
        let heading_focus = self
            .heading_focus
            .entry(group)
            .or_insert_with(|| cx.focus_handle().tab_stop(false))
            .clone();
        self.return_targets.insert(group, returns);
        // `role="status"`, visually hidden, outside the busy Agent list.
        let availability = div()
            .id(("launcher-availability", group))
            .role(Role::Status)
            .when_some(self.availability(), |d, message| d.aria_label(tr(message)))
            .test_support()
            .absolute()
            .size(px(1.))
            .overflow_hidden();
        let heading = h_flex()
            .absolute()
            .top(px(-theme::control() / 2.))
            .left(px(22.))
            .h(px(theme::control()))
            .px(px(6.))
            .gap(px(4.))
            .bg(t.auxiliary())
            .child(
                // `<h2 tabIndex={-1}>`: focusable, never a Tab stop.
                div()
                    .id(("launcher-heading", group))
                    .test_support()
                    .track_focus(&heading_focus)
                    .role(Role::Heading)
                    .aria_label(title)
                    .text_size(px(m.right.meta))
                    .line_height(px(m.right.meta_line_height))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.subtle)
                    .whitespace_nowrap()
                    .child(title),
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
                            .child(entries)
                            .child(availability),
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
