//! `ProjectEntryLauncherDialog`: the one way into a new local Project from
//! the Project Rail and the Header project menu — create a project, open a
//! folder, or import from another app. The launcher only routes; creating,
//! choosing a folder and importing keep their own dialogs.
use crate::{
    localization::t as tr,
    shell::{Shell, command::Command, modals::Modal},
    theme::{self, Theme, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{Dialog, Icon, ProductIcon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

/// The three routes, in the product's order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::shell) enum Route {
    Create,
    OpenFolder,
    Import,
}

/// `ImportSourcePreview`: the GitHub and GitLab marks the import entry
/// carries, 20px discs ringed in `ring` and overlapping by 6px.
pub(in crate::shell) fn import_badges(t: Theme, ring: Rgba, dimmed: bool) -> Div {
    let badge = |mark: &'static str| {
        div()
            .flex()
            .flex_shrink_0()
            .size(px(20.))
            .items_center()
            .justify_center()
            .rounded_full()
            .border_1()
            .border_color(ring)
            .bg(theme::mix(t.muted, ring, 0.12))
            .child(img(mark).size(px(14.)))
    };
    h_flex()
        // `:disabled` dims the preview.
        .when(dimmed, |d| d.opacity(0.3))
        .child(badge(if t.dark {
            "integrations/github-inverse.svg"
        } else {
            "integrations/github.svg"
        }))
        .child(badge("integrations/gitlab.svg").ml(px(-6.)))
}

impl Shell {
    /// `openProjectLauncher`: any pending navigation is left as is; the
    /// launcher only opens.
    pub(in crate::shell) fn open_project_entry(&mut self, cx: &mut Context<Self>) {
        if !self.modals.iter().any(|m| matches!(m, Modal::ProjectEntry)) {
            self.modals.open(Modal::ProjectEntry);
        }
        cx.notify();
    }
    pub(in crate::shell) fn close_project_entry(&mut self, cx: &mut Context<Self>) {
        self.modals.remove(|m| matches!(m, Modal::ProjectEntry));
        cx.notify();
    }
    /// Close the launcher, then hand off to the chosen flow.
    pub(in crate::shell) fn choose_project_entry(
        &mut self,
        route: Route,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_project_entry(cx);
        match route {
            Route::Create => self.begin_create_project(window, cx),
            Route::OpenFolder => self.command(Command::OpenFolder, window, cx),
            Route::Import => self.begin_import(window, cx),
        }
    }
    pub(in crate::shell) fn project_entry_dialog(&self, cx: &mut Context<Self>) -> Dialog {
        let t = cx.palette();
        let host = cx.weak_entity();
        // `.desktop-project-entry-option`: a menu-height row, its icon in
        // the menu icon slot, the UI body size in the muted colour.
        let option = |route: Route, icon: Icon, label: &'static str| {
            div()
                .id(SharedString::from(format!("project-entry-{route:?}")))
                .flex()
                .items_center()
                .min_h(px(theme::control()))
                .gap(px(metric::MENU_ITEM_GAP))
                .px(px(metric::MENU_ITEM_PADDING_INLINE))
                .rounded(px(metric::CONTROL_RADIUS))
                .text_size(px(theme::ty().ui.body))
                .text_color(t.muted)
                .cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(t.hover).text_color(t.text))
                .child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .size(px(metric::MENU_ICON_SLOT))
                        .items_center()
                        .justify_center()
                        .child(icon.with_size(px(15.)).stroke(1.8)),
                )
                .on_click(
                    cx.listener(move |s, _, window, cx| s.choose_project_entry(route, window, cx)),
                )
                .child(
                    h_flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(6.))
                        .child(tr(label))
                        .when(route == Route::Import, |d| {
                            // `.onboarding-entry-import-brand-badge` on the
                            // dialog's overlay surface.
                            d.child(import_badges(t, t.overlay, false))
                        }),
                )
        };
        Dialog::new("project-entry-launcher")
            .width(360.)
            .title(tr("shell.workspaceSwitcher.createNew"))
            .leading(Icon::new("plus"), t.accent)
            .header_bottom(10.)
            .body_padding(4., 12.)
            .body_inline(12.)
            .focus_handle(self.modal_focus.clone())
            .child(
                v_flex()
                    .gap(px(2.))
                    .child(option(
                        Route::Create,
                        Icon::new("file-plus-2"),
                        "onboarding.action.createLocalProject",
                    ))
                    .child(option(
                        Route::OpenFolder,
                        Icon::product(ProductIcon::Folder),
                        "onboarding.action.openFolder",
                    ))
                    .child(option(
                        Route::Import,
                        Icon::new("download"),
                        "onboarding.action.importFromApps",
                    )),
            )
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| s.close_project_entry(cx));
            })
    }
}

impl Shell {
    /// `RestoringWorkspaceScreen`: while the launch reopens the last Project
    /// the window shows a quiet loading mark, never the Homepage.
    pub(in crate::shell) fn restoring(&self) -> bool {
        self.files.workspace.is_none() && (self.restore_last || self.restoring_open)
    }
    pub(in crate::shell) fn restoring_view(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        div()
            .relative()
            .size_full()
            .bg(t.canvas)
            // `DesktopWindowDragRegion.onboarding-titlebar`.
            .child(
                div()
                    .id("restoring-titlebar")
                    .absolute()
                    .top_0()
                    .left_0()
                    .right_0()
                    .h(px(metric::CHROME_HEIGHT))
                    .on_mouse_down(MouseButton::Left, |e, window, _| {
                        if e.click_count == 2 {
                            window.zoom_window();
                        } else {
                            window.start_window_move();
                        }
                    }),
            )
            .child(
                div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        crate::ui::loading::LoadingMark::new("workspace-restoring")
                            .area()
                            .size(crate::ui::loading::LoaderSize::Md)
                            .tone(crate::ui::loading::Tone::Neutral),
                    ),
            )
    }
    /// `ProjectNavigationFailure`: the reason, Close, and Retry.
    pub(in crate::shell) fn project_failure_dialog(
        &self,
        message: &str,
        cx: &mut Context<Self>,
    ) -> Dialog {
        use crate::ui::components::{Button, ButtonVariant};
        let t = cx.palette();
        let host = cx.weak_entity();
        Dialog::new("project-navigation-failure")
            .width(420.)
            .title(tr("shell.workspaceSwitcher.switchFailed"))
            .focus_handle(self.modal_focus.clone())
            // `.desktop-dialog-error`.
            .child(
                div()
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(18.))
                    .text_color(t.danger)
                    .child(message.to_owned()),
            )
            .footer(
                Button::new("project-failure-close")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.close"))
                    .on_click(
                        cx.listener(|s, _, w, cx| s.command(Command::CloseProjectFailure, w, cx)),
                    ),
            )
            .footer(
                Button::new("project-failure-retry")
                    .variant(ButtonVariant::Solid)
                    .label(tr("cloud.common.retry"))
                    .on_click(
                        cx.listener(|s, _, w, cx| s.command(Command::RetryProjectOpen, w, cx)),
                    ),
            )
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.command(Command::CloseProjectFailure, w, cx));
            })
    }
}
