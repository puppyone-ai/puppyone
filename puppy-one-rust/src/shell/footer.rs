//! `DesktopSidebarFooterNavigation` as the workspace sidebar mounts it:
//! Settings, then the Help launcher (`DesktopHelpLauncher`) in the utility
//! slot. The product removes the Git surface from the footer
//! (`useWorkspaceSurfaceContent` filters `git`); Changes lives in the Header.
//! With the navigation at the bottom the footer has no divider.
use super::{Command, modals::Task};
use crate::{
    localization::t as tr,
    theme::{self, metric},
    ui::{
        self,
        appearance::ActiveAppearance,
        components::{Icon, IconButton},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{base::Selectable as _, component::Sizable as _};
use std::rc::Rc;

type OnCommand = Rc<dyn Fn(Command, &mut Window, &mut App)>;

/// The footer below the Explorer; it fills the frame it is placed in.
#[derive(IntoElement)]
pub(super) struct SidebarFooter {
    task: Option<Task>,
    busy: bool,
    on_command: OnCommand,
}
impl SidebarFooter {
    /// Its buttons ask for [`Command::Settings`] and [`Command::Feedback`].
    pub fn new(on_command: impl Fn(Command, &mut Window, &mut App) + 'static) -> Self {
        Self {
            task: None,
            busy: false,
            on_command: Rc::new(on_command),
        }
    }
    /// The task dialog that is open lights its button.
    pub fn task(mut self, task: Option<Task>) -> Self {
        self.task = task;
        self
    }
    /// Native-only cue until file-operation notices are ported; its mark
    /// shares the global loading material, not a separate animation preset.
    pub fn busy(mut self, busy: bool) -> Self {
        self.busy = busy;
        self
    }
}
impl RenderOnce for SidebarFooter {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        // `.desktop-sidebar-footer-button` / `.desktop-help-launcher`: compact
        // squares with a 14px icon in the utility colour.
        let utility = |id: &'static str, icon: &'static str, label: &'static str, task: Task| {
            let on_command = self.on_command.clone();
            let command = match task {
                Task::Settings => Command::Settings,
                Task::Feedback => Command::Feedback,
            };
            IconButton::new(
                id,
                Icon::new(icon).with_size(px(metric::SIDEBAR_UTILITY_ICON)),
            )
            .label(tr(label))
            .with_size(px(theme::control_compact()))
            .color(t.sidebar_utility)
            .selected(self.task == Some(task))
            .on_click(move |_, window, cx| on_command(command, window, cx))
        };
        div()
            .size_full()
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
                    .child(utility(
                        "settings",
                        "settings-compact",
                        "shell.navigation.settings",
                        Task::Settings,
                    ))
                    .child(utility(
                        "feedback",
                        "feedback-help",
                        "shell.feedback.label",
                        Task::Feedback,
                    )),
            )
            .when(self.busy, |d| {
                d.child(ui::loading::LoadingMark::new("footer-busy").color(t.subtle))
            })
    }
}
