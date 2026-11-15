//! Port of `GeneralSettingsView.tsx`: language, build version, update rows.
//! The native preview has no update service, so its rows show the product's
//! development-build state instead of inventing an updater.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    localization::{Locale, t as tr, tf},
    theme::{self, Theme},
    ui::components::{
        Button, ButtonVariant, Icon, Select, SelectOption, SettingRow, SettingsList,
        SettingsSection, Switch,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex},
    component::Sizable as _,
};
impl SettingsWorkspaceSurface {
    pub(super) fn general(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
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
        let language = Select::new("language", current, move |_| {
            let mut options = vec![{
                let prefs = prefs.clone();
                SelectOption::new(system_option.clone())
                    .selected(preference == "system")
                    .on_select(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.locale = "system".into(), cx))
                    })
            }];
            options.extend(Locale::choices().map(|(id, label)| {
                let prefs = prefs.clone();
                SelectOption::new(label)
                    .selected(preference == id)
                    .on_select(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.locale = id.into(), cx))
                    })
            }));
            options
        });
        let build = crate::features::build_info::current();
        let diagnostics = build.diagnostics;
        let channel = tr(build.channel_key);
        let version = build.version;
        let copied = self.is_copied("build-version");
        let copy_label = tr(if copied {
            "shell.build.copy.copied"
        } else {
            "shell.build.copy.action"
        });
        let version_value = h_flex()
            .gap(px(7.))
            .min_w_0()
            .child(
                div()
                    .truncate()
                    .text_color(t.text)
                    .text_size(px(theme::ty().ui.label))
                    .child(format!("{channel} · {version}")),
            )
            .child(
                Button::new("copy-build")
                    .icon(if copied { "check" } else { "copy" })
                    .accessibility_label(copy_label)
                    .tooltip(copy_label)
                    // `.desktop-build-version-copy`: a 28px square.
                    .w(px(28.))
                    .px(px(0.))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.copy("build-version".into(), diagnostics.clone(), cx)
                    })),
            );
        // `AutomaticUpdateDownloadSettingRow` and `DesktopUpdateSettingsRow`.
        let update = crate::features::updates::state(cx);
        let usable = update
            .as_ref()
            .is_some_and(|u| u.status != crate::features::updates::Status::Disabled);
        let auto_download = SettingRow::new(tr("updates.settings.autoDownload.title")).control(
            Switch::new(
                "automatic-downloads",
                tr("updates.settings.autoDownload.title"),
            )
            .checked(update.as_ref().is_none_or(|u| u.automatically_download))
            .disabled(!usable)
            .tooltip(tr("updates.settings.autoDownload.detail"))
            .on_change(|enabled, _, cx| {
                if let Some(updates) = crate::features::updates::global(cx) {
                    updates.update(cx, |u, cx| u.set_automatically_download(enabled, cx));
                }
            }),
        );
        let updates = update.map(|state| {
            use crate::features::updates::words;
            let action = words::settings_action(&state);
            let detail = words::detail(&state);
            let mut icon = Icon::new(words::icon(state.status)).with_size(px(14.));
            if action.spinning {
                icon = icon.spinning("update-action-spin");
            }
            SettingRow::new(tr("updates.settings.title")).control(
                Button::new("update-action")
                    .variant(if action.primary {
                        ButtonVariant::OutlinePrimary
                    } else {
                        ButtonVariant::Outline
                    })
                    .icon(icon)
                    .label(action.label.clone())
                    .accessibility_label(format!("{}. {detail}", action.label))
                    .tooltip(detail)
                    .disabled(!action.enabled)
                    .on_click(move |_, _, cx| {
                        if let Some(updates) = crate::features::updates::global(cx) {
                            updates.update(cx, |u, cx| {
                                if action.checks {
                                    u.check(cx)
                                } else {
                                    u.update_now(cx)
                                }
                            });
                        }
                    }),
            )
        });
        SettingsSection::new(tr(Page::General.title()))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(SettingRow::new(tr("settings.language.selectorLabel")).control(language))
                    .child(SettingRow::new(tr("settings.general.version")).control(version_value))
                    .child(auto_download)
                    .children(updates),
            )
            .into_any_element()
    }
}
