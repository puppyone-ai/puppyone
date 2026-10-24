//! Port of `DesktopWindowChrome` + `DesktopTitlebarContext` + `headerElements.tsx`.
//! Left: Explorer expand (when collapsed), project switcher and location.
//! Right: Changes status and the Agent entry. Empty space moves the window.
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme::metric,
    ui::{icon_sized, tooltip},
};

/// `GitTitlebarStatus` projected from the native Git snapshot.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub(super) struct GitTitlebarStatus {
    pub conflicts: usize,
    pub incoming: u32,
    pub local: usize,
    pub outgoing: u32,
}
fn header_count(count: usize) -> String {
    if count > 99 {
        "99+".into()
    } else {
        count.to_string()
    }
}
/// Record an element's last painted bounds (anchors for popovers).
pub(super) fn measure(anchors: &Anchors, key: &'static str) -> impl IntoElement {
    let anchors = anchors.clone();
    canvas(
        move |bounds, _, _| {
            anchors.borrow_mut().insert(key, bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}
impl Shell {
    pub(super) fn git_status(&self, cx: &App) -> GitTitlebarStatus {
        self.source_control
            .read(cx)
            .snapshot
            .as_ref()
            .map(|s| GitTitlebarStatus {
                conflicts: s.changes.iter().filter(|c| c.conflict()).count(),
                incoming: s.behind,
                local: s.changes.len(),
                outgoing: s.ahead,
            })
            .unwrap_or_default()
    }
    fn changes_action(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        let status = self.git_status(cx);
        let indicator = |icon: &str, color: Rgba, count: String| {
            row()
                .h(px(20.))
                .gap(px(2.))
                .text_size(px(theme::ty().header.meta))
                .text_color(t.muted)
                .child(icon_sized(icon, 15., color))
                .child(count)
        };
        let mut indicators = row().gap(px(4.));
        if status.conflicts > 0 {
            indicators = indicators.child(
                indicator(
                    "triangle-alert",
                    theme::tint(t.danger, 0.78),
                    header_count(status.conflicts),
                )
                .text_color(theme::tint(t.danger, 0.78)),
            );
        } else if status.local == 0 && status.incoming == 0 && status.outgoing == 0 {
            indicators = indicators.child(indicator("asterisk", t.muted, "0".into()));
        } else {
            if status.incoming > 0 {
                indicators = indicators.child(indicator(
                    "arrow-down",
                    theme::tint(t.accent, 0.74),
                    header_count(status.incoming as usize),
                ));
            }
            if status.outgoing > 0 {
                indicators = indicators.child(indicator(
                    "arrow-up",
                    theme::tint(t.success, 0.72),
                    header_count(status.outgoing as usize),
                ));
            }
            if status.local > 0 {
                indicators = indicators.child(indicator(
                    "asterisk",
                    theme::tint(t.warning, 0.76),
                    header_count(status.local),
                ));
            }
        }
        let mut label = vec![tr("source-control.label.changes").to_string()];
        if status.conflicts > 0 {
            label.push(tf(
                "source-control.commit.conflicts",
                &[("count", status.conflicts.into())],
            ));
        }
        if status.local > 0 {
            label.push(tf(
                "source-control.commit.files",
                &[("count", status.local.into())],
            ));
        }
        if status.incoming > 0 {
            label.push(tf(
                "source-control.sync.pullCount",
                &[("count", status.incoming.into())],
            ));
        }
        if status.outgoing > 0 {
            label.push(tf(
                "source-control.sync.localWaiting",
                &[("count", status.outgoing.into())],
            ));
        }
        let label = label.join(", ");
        let open = self.changes && self.right_open;
        gpui_kit::base::Button::new("changes")
            .accessibility_label(label.clone())
            .selected(open)
            .flex()
            .items_center()
            .justify_center()
            .h(px(theme::control_compact()))
            .min_w(px(theme::control()))
            .px(px(7.))
            .gap(px(4.))
            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
            .cursor(theme::clickable_cursor())
            .when(open, |b| b.bg(t.selected))
            .hover(move |s| s.bg(t.hover))
            .tooltip(tooltip(label))
            .child(indicators)
            .on_click(cx.listener(|s, _, w, cx| s.command(Command::Changes, w, cx)))
    }
    fn agent_action(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        let open = self.right_open && !self.changes;
        let label = tr(if open {
            "shell.titlebar.hideAgent"
        } else {
            "shell.titlebar.showAgent"
        });
        gpui_kit::base::Button::new("right")
            .accessibility_label(label)
            .selected(open)
            .flex()
            .items_center()
            .justify_center()
            .w(px(metric::TITLEBAR_TOOL_ACTION_WIDTH))
            .h(px(theme::control_compact()))
            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
            .cursor(theme::clickable_cursor())
            .when(open, |b| b.bg(t.selected))
            .hover(move |s| s.bg(t.hover))
            .tooltip(tooltip(label))
            .child(icon_sized("agent-entry", 15., t.muted))
            .on_click(cx.listener(|s, _, w, cx| s.command(Command::ToggleRightSidebar, w, cx)))
    }
    /// `DesktopWorkspaceSwitcher` trigger + `DesktopProjectLocationSwitcher` trigger.
    fn project_context(&self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let project_open = self.popover == Some(Popover::Project);
        let location_open = self.popover == Some(Popover::Location);
        let label = tf(
            "shell.workspaceSwitcher.openMenu",
            &[("workspace", self.project.clone().into())],
        );
        let device = tr(if cfg!(target_os = "macos") {
            "shell.workspaceSwitcher.location.thisMac"
        } else {
            "shell.workspaceSwitcher.location.thisComputer"
        });
        // `DesktopProjectLocationSwitcher` renders only when Cloud workspaces
        // are enabled (`projectLocation` is undefined otherwise).
        let cloud = self.preferences.read(cx).state.experimental.cloud_workspace;
        row()
            .min_w_0()
            .gap(px(2.))
            .child(
                div()
                    .relative()
                    .min_w_0()
                    .child(
                        gpui_kit::base::Button::new("project")
                            .accessibility_label(label)
                            .track_focus(&self.project_focus)
                            .selected(project_open)
                            .flex()
                            .items_center()
                            .min_w_0()
                            .h(px(theme::control_compact()))
                            .px(px(6.))
                            .gap(px(6.))
                            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                            .text_size(px(theme::ty().header.content))
                            .line_height(px(theme::ty().header.line_height))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(if project_open { t.text } else { t.muted })
                            .cursor(theme::clickable_cursor())
                            .when(project_open, |b| b.bg(t.hover))
                            .hover(move |s| s.bg(t.hover).text_color(t.text))
                            .child(icon_sized(
                                "house-compact",
                                16.,
                                if project_open { t.text } else { t.muted },
                            ))
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .child(if self.project.is_empty() {
                                        tr("onboarding.action.openFolder").to_owned()
                                    } else {
                                        self.project.clone()
                                    }),
                            )
                            .on_click(
                                cx.listener(|s, _, w, cx| s.command(Command::ProjectMenu, w, cx)),
                            ),
                    )
                    .child(header::measure(&self.anchors, "project")),
            )
            .when(cloud, |d| {
                d.child(
                    div()
                        .relative()
                        .flex_shrink_0()
                        .child(
                            gpui_kit::base::Button::new("project-location")
                                .accessibility_label(format!(
                                    "{device}, {}",
                                    tr("shell.workspaceSwitcher.projectDetails")
                                ))
                                .selected(location_open)
                                .flex()
                                .items_center()
                                .justify_center()
                                .w(px(theme::control()))
                                .h(px(theme::control_compact()))
                                .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                                .cursor(theme::clickable_cursor())
                                .when(location_open, |b| b.bg(t.hover))
                                .hover(move |s| s.bg(t.hover))
                                .tooltip(tooltip(device))
                                .child(icon_sized("laptop", 16., t.muted))
                                .on_click(cx.listener(|s, _, w, cx| {
                                    s.command(Command::LocationMenu, w, cx)
                                })),
                        )
                        .child(header::measure(&self.anchors, "location")),
                )
            })
    }
    pub(super) fn header(&self, cx: &mut Context<Self>) -> Div {
        let t = Theme::new(self.dark);
        let r = self.layout.header;
        let home = self.home_visible();
        let prefs = self.preferences.read(cx).state.clone();
        let centered = prefs.experimental.centered_project_in_header;
        let show_project = !home && !self.rail && (self.files.workspace.is_some() || self.fixture);
        let drag = || {
            div()
                .id("header-drag")
                .flex_1()
                .h_full()
                .min_w(px(32.))
                .on_mouse_down(MouseButton::Left, |e, w, _| {
                    if e.click_count == 2 {
                        w.zoom_window();
                    } else {
                        w.start_window_move();
                    }
                })
        };
        let mut left = row().h_full().min_w_0().pl(px(80. + 6.)).gap(px(2.));
        if !home && !self.left_open {
            left = left.child(
                crate::ui::labelled_icon_button(
                    "expand-explorer",
                    "panel-left",
                    tr("shared-ui.explorer.expandSidebar"),
                    t,
                )
                .w(px(theme::control()))
                .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                .on_click(cx.listener(|s, _, w, cx| s.command(Command::ToggleExplorer, w, cx))),
            );
        }
        if show_project && !centered {
            left = left.child(self.project_context(cx));
        }
        // `.desktop-titlebar-actions`: 2px apart, 6px from the window edge,
        // with `.desktop-titlebar-action-divider` (1×18, 3px margins) between
        // Changes and the Agent entry.
        let mut actions = row().h_full().gap(px(2.)).pr(px(6.));
        let changes = !home && self.files.workspace.is_some() && prefs.header_changes;
        let agent = !home && prefs.header_terminal;
        if changes {
            actions = actions.child(self.changes_action(cx));
        }
        if changes && agent {
            actions = actions.child(div().w(px(1.)).h(px(18.)).mx(px(3.)).bg(t.shell_divider));
        }
        if agent {
            actions = actions.child(self.agent_action(cx));
        }
        let mut bar = at(r)
            .flex()
            .items_center()
            .bg(t.header)
            .border_b_1()
            .border_color(t.shell_divider)
            .child(left)
            .child(drag())
            .child(actions);
        if show_project && centered {
            bar = bar.child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .w_full()
                    .h_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(div().max_w(px(360.)).child(self.project_context(cx))),
            );
        }
        bar
    }
}
