//! Port of `OtherAppImportsSettingsView.tsx` (shown when the Experimental
//! "Other app imports" switch is on). The import flow itself is not native yet,
//! so the entry button is disabled rather than routed to a placeholder.
use super::super::{components::*, settings_workspace_surface::SettingsWorkspaceSurface};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::Theme,
    ui::{Tone, action_button, row, tooltip},
};
use gpui::{prelude::*, *};
/// `LOCAL_IMPORT_SOURCES` with `availability: "experimental"` (id, operational).
const SOURCES: [(&str, bool); 4] = [
    ("notion", false),
    ("google-drive", false),
    ("obsidian", true),
    ("airtable", false),
];
impl SettingsWorkspaceSurface {
    pub(super) fn other_app_imports(&self, t: Theme) -> Div {
        let rows = SOURCES
            .iter()
            .map(|(id, operational)| {
                row()
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
            .collect();
        let title = tr("onboarding.entry.import.title");
        section(tr(Page::OtherAppImports.title()), t)
            .child(lead_list(rows))
            .child(row().px(px(10.)).child(
                action_button("open-import", title, None, Tone::Primary, true, t).tooltip(tooltip(
                    tf(
                        "settings.sidebar.notAvailable",
                        &[("section", title.into())],
                    ),
                )),
            ))
    }
}
