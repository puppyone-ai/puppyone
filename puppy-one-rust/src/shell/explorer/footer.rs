//! `DesktopSidebarFooterNavigation` as the workspace sidebar mounts it:
//! Settings, then the Help launcher (`DesktopHelpLauncher`) in the utility
//! slot. The product removes the Git surface from the footer
//! (`useWorkspaceSurfaceContent` filters `git`); Changes lives in the Header.
//! With the navigation at the bottom the footer has no divider.
use super::*;
use crate::ui::components::{Icon, IconButton};
use gpui_kit::{base::Selectable as _, component::Sizable as _};

impl Shell {
    pub(in crate::shell) fn footer(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        // `.desktop-sidebar-footer-button` / `.desktop-help-launcher`: compact
        // squares with a 14px icon in the utility colour.
        let utility = |id: &'static str, icon: &'static str, label: &'static str, active: bool| {
            IconButton::new(
                id,
                Icon::new(icon).with_size(px(metric::SIDEBAR_UTILITY_ICON)),
            )
            .label(tr(label))
            .with_size(px(theme::control_compact()))
            .color(t.sidebar_utility)
            .selected(active)
        };
        let busy = self.pending
            || self.files.busy()
            || self.files.folder_busy
            || self.explorer.op.is_some();
        at(self.layout.footer)
            .bg(t.sidebar)
            .flex()
            .items_center()
            .justify_between()
            .py(px(metric::SIDEBAR_NAVIGATION_PADDING_BALANCED))
            .px(px(metric::SIDEBAR_NAVIGATION_PADDING_INLINE))
            .gap(px(metric::SIDEBAR_NAV_GAP))
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap(px(metric::SIDEBAR_NAV_GAP))
                    .child(
                        utility(
                            "settings",
                            "settings-compact",
                            "shell.navigation.settings",
                            self.modals.task() == Some(Task::Settings),
                        )
                        .on_click(cx.listener(|s, _, w, cx| s.command(Command::Settings, w, cx))),
                    )
                    .child(
                        utility(
                            "feedback",
                            "feedback-help",
                            "shell.feedback.label",
                            self.modals.task() == Some(Task::Feedback),
                        )
                        .on_click(cx.listener(|s, _, w, cx| s.command(Command::Feedback, w, cx))),
                    ),
            )
            // Native-only progress cue until file-operation notices are ported
            // (the product shows them in `FloatingNoticeStack`).
            .when(busy, |d| {
                let preset = self.preferences.read(cx).state.loading_animation.clone();
                d.child(ui::pulse_grid::pulse_grid(
                    "footer-busy",
                    &preset,
                    ui::pulse_grid::PulseSize::Sm,
                    t.subtle,
                ))
            })
    }
}
