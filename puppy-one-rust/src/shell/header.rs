//! Port of `DesktopWindowChrome` + `DesktopTitlebarContext` + `headerElements.tsx`.
//! Left: Explorer expand (when collapsed), project switcher and location.
//! Right: Changes status and the Agent entry. Empty space moves the window.
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme::metric,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Icon, IconButton},
    },
};
use gpui_kit::{
    base::{Selectable as _, h_flex},
    component::Sizable as _,
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
        let t = cx.palette();
        let status = self.git_status(cx);
        let indicator = |icon: &'static str, color: Rgba, count: String| {
            h_flex()
                .h(px(20.))
                .gap(px(2.))
                .text_size(px(theme::ty().header.meta))
                .text_color(t.muted)
                .child(Icon::new(icon).color(color))
                .child(count)
        };
        let mut indicators = h_flex().gap(px(4.));
        if status.conflicts > 0 {
            let danger = theme::tint(t.danger, 0.78);
            indicators = indicators.child(
                indicator("triangle-alert", danger, header_count(status.conflicts))
                    .text_color(danger),
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
        Button::new("changes")
            .variant(ButtonVariant::Titlebar)
            .accessibility_label(label.clone())
            .tooltip(label)
            .selected(self.changes && self.right_open)
            .min_w(px(theme::control()))
            .trailing(indicators)
            .on_click(cx.listener(|s, _, w, cx| s.command(Command::Changes, w, cx)))
    }
    fn agent_action(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let open = self.right_open && !self.changes;
        let label = tr(if open {
            "shell.titlebar.hideAgent"
        } else {
            "shell.titlebar.showAgent"
        });
        Button::new("right")
            .variant(ButtonVariant::Titlebar)
            .icon("agent-entry")
            .accessibility_label(label)
            .tooltip(label)
            .selected(open)
            .w(px(metric::TITLEBAR_TOOL_ACTION_WIDTH))
            .on_click(cx.listener(|s, _, w, cx| s.command(Command::ToggleRightSidebar, w, cx)))
    }
    /// `HomepageCloudStatus` signed out: "Sign in" (`.homepage-cloud-sign-in`).
    /// Cloud sign-in is not native yet; it opens Account, which says so.
    fn sign_in_action(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let ty = theme::ty().header;
        Button::new("home-sign-in")
            .variant(ButtonVariant::Titlebar)
            .label(tr("cloud.auth.signIn"))
            .accessibility_label(tr("cloud.auth.signInToCloud"))
            .pr(px(8.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .on_click(cx.listener(|s, _, w, cx| {
                s.command(Command::Settings, w, cx);
                s.task_ui.settings.update(cx, |settings, cx| {
                    settings.select_page(crate::features::settings::Page::Account, cx)
                });
            }))
    }
    /// `DesktopWorkspaceSwitcher` trigger + `DesktopProjectLocationSwitcher` trigger.
    fn project_context(&self, cx: &mut Context<Self>) -> Div {
        let label = tf(
            "shell.workspaceSwitcher.openMenu",
            &[("workspace", self.project.clone().into())],
        );
        let device = tr(if cfg!(target_os = "macos") {
            "shell.workspaceSwitcher.location.thisMac"
        } else {
            "shell.workspaceSwitcher.location.thisComputer"
        });
        let name = if self.project.is_empty() {
            tr("onboarding.action.openFolder").to_owned()
        } else {
            self.project.clone()
        };
        let ty = theme::ty().header;
        // `.desktop-titlebar-workspace-button`.
        let project = Button::new("project")
            .variant(ButtonVariant::Ghost)
            .accessibility_label(label)
            .track_focus(&self.project_focus)
            .icon(Icon::new("house-compact").large())
            .label(name)
            .flex_shrink(1.)
            .min_w_0()
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .font_weight(FontWeight::MEDIUM);
        // `DesktopProjectLocationSwitcher` renders only when Cloud workspaces
        // are enabled (`projectLocation` is undefined otherwise).
        let cloud = self.preferences.read(cx).state.experimental.cloud_workspace;
        h_flex()
            .min_w_0()
            .gap(px(2.))
            .child(self.header_popover(Popover::Project, project, cx))
            .when(cloud, |d| {
                let location = Button::new("project-location")
                    .variant(ButtonVariant::Titlebar)
                    .icon(Icon::new("laptop").large())
                    .accessibility_label(format!(
                        "{device}, {}",
                        tr("shell.workspaceSwitcher.projectDetails")
                    ))
                    .tooltip(device)
                    .w(px(theme::control()));
                d.child(self.header_popover(Popover::Location, location, cx))
            })
    }
    pub(super) fn header(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
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
        let mut left = h_flex().h_full().min_w_0().pl(px(80. + 6.)).gap(px(2.));
        if !home && !self.left_open {
            left = left.child(
                IconButton::new("expand-explorer", "panel-left")
                    .label(tr("shared-ui.explorer.expandSidebar"))
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
        let mut actions = h_flex().h_full().gap(px(2.)).pr(px(6.));
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
        if home {
            actions = actions.child(self.sign_in_action(cx));
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
