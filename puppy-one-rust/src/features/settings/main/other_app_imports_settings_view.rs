//! Port of `OtherAppImportsSettingsView.tsx` (shown when the Experimental
//! "Other app imports" switch is on). The import flow itself is not native yet,
//! so the entry button is disabled rather than routed to a placeholder.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::Theme,
    ui::components::{Button, ButtonVariant, SettingsList, SettingsSection},
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};
/// `LOCAL_IMPORT_SOURCES` with `availability: "experimental"` (id, operational).
const SOURCES: [(&str, bool); 4] = [
    ("notion", false),
    ("google-drive", false),
    ("obsidian", true),
    ("airtable", false),
];
impl SettingsWorkspaceSurface {
    pub(super) fn other_app_imports(&self, t: Theme) -> AnyElement {
        let rows = SOURCES
            .iter()
            .map(|(id, operational)| {
                h_flex()
                    .w_full()
                    .min_h(px(crate::theme::control()))
                    .justify_between()
                    .px(px(10.))
                    .text_color(t.subtle)
                    .child(tr(&format!("onboarding.entry.import.source.{id}.title")))
                    .when(!operational, |d| {
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
                        .disabled(true)
                        .tooltip(tf(
                            "settings.sidebar.notAvailable",
                            &[("section", title.into())],
                        )),
                ),
            )
            .into_any_element()
    }
}
