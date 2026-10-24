//! Port of `GeneralSettingsView.tsx`: language, build version, update rows.
//! The native preview has no update service, so its rows show the product's
//! development-build state instead of inventing an updater.
use super::super::{components::*, settings_workspace_surface::SettingsWorkspaceSurface};
use super::Page;
use crate::{
    localization::{Locale, t as tr, tf},
    theme::{self, Theme},
    ui::{Tone, action_button, row, switch, tooltip},
};
use gpui::{prelude::*, *};
use gpui_kit::component::menu::PopupMenuItem;
impl SettingsWorkspaceSurface {
    pub(super) fn general(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let prefs = self.preferences.clone();
        let preference = prefs.read(cx).state.locale.clone();
        let system = crate::localization::system_locale();
        let system_label = Locale::choices()
            .find(|(id, _)| *id == system)
            .map(|(_, l)| l)
            .unwrap_or("English");
        let system_option = tf(
            "settings.language.system",
            &[("language", system_label.into())],
        );
        let current = Locale::choices()
            .find(|(id, _)| *id == preference)
            .map(|(_, l)| SharedString::from(l))
            .unwrap_or_else(|| system_option.clone().into());
        let language = select("language", current, false, t, move || {
            let mut items = vec![{
                let prefs = prefs.clone();
                PopupMenuItem::new(system_option.clone())
                    .checked(preference == "system")
                    .on_click(move |_, _, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.locale = "system".into(), cx))
                    })
            }];
            items.extend(Locale::choices().map(|(id, label)| {
                let prefs = prefs.clone();
                PopupMenuItem::new(label)
                    .checked(preference == id)
                    .on_click(move |_, _, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.locale = id.into(), cx))
                    })
            }));
            items
        });
        let version = env!("CARGO_PKG_VERSION");
        let diagnostics = format!("PuppyOne GPUI\nChannel: dev\nVersion: {version}\n");
        let copied = self.is_copied("build-version");
        let copy_label = tr(if copied {
            "shell.build.copy.copied"
        } else {
            "shell.build.copy.action"
        });
        let version_value = row()
            .gap(px(7.))
            .min_w_0()
            .child(
                div()
                    .truncate()
                    .text_color(t.text)
                    .text_size(px(theme::ty().ui.label))
                    .child(format!("{} · {version}", tr("shell.build.channel.dev"))),
            )
            .child(
                action_button(
                    "copy-build",
                    "",
                    Some(if copied { "check" } else { "copy" }),
                    Tone::Default,
                    false,
                    t,
                )
                .accessibility_label(copy_label)
                .tooltip(tooltip(copy_label))
                .px(px(7.))
                .on_click(cx.listener(move |s, _, _, cx| {
                    s.copy("build-version".into(), diagnostics.clone(), cx)
                })),
            );
        let auto_download = setting_row(
            tr("updates.settings.autoDownload.title"),
            switch(
                "automatic-downloads",
                tr("updates.settings.autoDownload.title"),
                false,
                true,
                t,
                |_, _, _| {},
            )
            .tooltip(tooltip(tr("updates.settings.autoDownload.detail"))),
            t,
        );
        let updates = setting_row(
            tr("updates.settings.title"),
            action_button(
                "development-build",
                tr("updates.action.developmentBuild"),
                Some("info"),
                Tone::Default,
                true,
                t,
            ),
            t,
        );
        section(tr(Page::General.title()), t).child(lead_list(vec![
            setting_row(tr("settings.language.selectorLabel"), language, t).into_any_element(),
            setting_row(tr("settings.general.version"), version_value, t).into_any_element(),
            auto_download.into_any_element(),
            updates.into_any_element(),
        ]))
    }
}
