//! Port of `LocalProjectSettingsView.tsx`.
use super::super::{
    components::*,
    settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface},
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{Tone, action_button, icon_sized, row},
};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    pub(super) fn local_project(&self, t: Theme, _: &mut Window, cx: &mut Context<Self>) -> Div {
        let Some(root) = self.root.clone() else {
            return section(tr(Page::Project.title()), t);
        };
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.display().to_string());
        let status = row()
            .gap(px(6.))
            .text_size(px(theme::ty().ui.label))
            .text_color(t.success)
            .child(icon_sized("shield-check", 14., t.success))
            .child(tr("settings.localProject.protected"));
        let confirm = tf(
            "settings.localProject.unlink.confirm",
            &[("workspace", name.clone().into())],
        );
        let unlink = action_button(
            "unlink-project",
            tr("settings.localProject.unlink.action"),
            Some("unlink"),
            Tone::Danger,
            false,
            t,
        )
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
                    let _ = this.update(cx, |_, cx| cx.emit(SettingsEvent::ForgetProject(root)));
                }
            })
            .detach();
        }));
        section(tr(Page::Project.title()), t).child(lead_list(vec![
            value_row(tr("settings.localProject.name"), name, false, None, t).into_any_element(),
            value_row(
                tr("settings.localProject.path"),
                self.root.as_ref().unwrap().display().to_string(),
                false,
                None,
                t,
            )
            .into_any_element(),
            value_row(
                tr("settings.localProject.mode"),
                tr("settings.localProject.modeLocal"),
                false,
                None,
                t,
            )
            .into_any_element(),
            setting_row(tr("settings.localProject.status"), status, t)
                .min_h(px(theme::control()))
                .into_any_element(),
            setting_row(tr("settings.localProject.recentWorkspace"), unlink, t).into_any_element(),
        ]))
    }
}
