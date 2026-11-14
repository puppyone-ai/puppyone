//! Port of `OtherAppImportsSettingsView.tsx` (shown when the Experimental
//! "Other app imports" switch is on): the sources the switch adds, each by
//! its own name, and Import, which closes Settings for the import dialog.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    features::project_import::SOURCES,
    localization::t as tr,
    theme::Theme,
    ui::components::{Button, ButtonVariant, SettingsList, SettingsSection},
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;
impl SettingsWorkspaceSurface {
    pub(super) fn other_app_imports(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        // `IMPORT_SOURCE_REGISTRY` with `availability: "experimental"`.
        let rows = SOURCES
            .iter()
            .filter(|source| !source.ready)
            .map(|source| {
                h_flex()
                    .w_full()
                    .min_h(px(crate::theme::control()))
                    .justify_between()
                    .px(px(10.))
                    .text_color(t.subtle)
                    .child(source.label)
                    .when(!source.operational, |d| {
                        d.child(
                            div()
                                .text_color(t.subtle)
                                .child(tr("onboarding.entry.import.directUnavailable")),
                        )
                    })
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        let title = tr("onboarding.entry.import.title");
        SettingsSection::new(tr(Page::OtherAppImports.title()))
            .child(SettingsList::new().lead(true).children(rows))
            .child(
                h_flex().px(px(10.)).child(
                    Button::new("open-import")
                        .variant(ButtonVariant::OutlinePrimary)
                        .label(title)
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(super::super::SettingsEvent::OpenImport)
                        })),
                ),
            )
            .into_any_element()
    }
}
