//! Port of `LocalProjectSettingsView.tsx`.
use super::super::settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::components::{
        Button, ButtonVariant, Icon, SettingRow, SettingsList, SettingsSection, ValueRow,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{base::h_flex, component::Sizable as _};
impl SettingsWorkspaceSurface {
    pub(super) fn local_project(
        &self,
        t: Theme,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(root) = self.root.clone() else {
            return SettingsSection::new(tr(Page::Project.title())).into_any_element();
        };
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.display().to_string());
        let status = h_flex()
            .gap(px(6.))
            .text_size(px(theme::ty().ui.label))
            .text_color(t.success)
            .child(Icon::new("shield-check").small())
            .child(tr("settings.localProject.protected"));
        let confirm = tf(
            "settings.localProject.unlink.confirm",
            &[("workspace", name.clone().into())],
        );
        let unlink = Button::new("unlink-project")
            .variant(ButtonVariant::OutlineDanger)
            .icon("unlink")
            .label(tr("settings.localProject.unlink.action"))
            .on_click(cx.listener(move |_, _, window, cx| {
                let answer = window.prompt(
                    PromptLevel::Warning,
                    tr("settings.localProject.unlink.title"),
                    Some(&confirm),
                    &[
                        tr("settings.localProject.unlink.action"),
                        tr("common.action.cancel"),
                    ],
                    cx,
                );
                let root = root.clone();
                cx.spawn(async move |this, cx| {
                    if answer.await == Ok(0) {
                        let _ =
                            this.update(cx, |_, cx| cx.emit(SettingsEvent::ForgetProject(root)));
                    }
                })
                .detach();
            }));
        let path = self.root.as_ref().unwrap().display().to_string();
        SettingsSection::new(tr(Page::Project.title()))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(ValueRow::new(tr("settings.localProject.name"), name))
                    .child(ValueRow::new(tr("settings.localProject.path"), path))
                    .child(ValueRow::new(
                        tr("settings.localProject.mode"),
                        tr("settings.localProject.modeLocal"),
                    ))
                    .child(
                        SettingRow::new(tr("settings.localProject.status"))
                            .control(status)
                            .min_h(px(theme::control())),
                    )
                    .child(
                        SettingRow::new(tr("settings.localProject.recentWorkspace"))
                            .control(unlink),
                    ),
            )
            .into_any_element()
    }
}
