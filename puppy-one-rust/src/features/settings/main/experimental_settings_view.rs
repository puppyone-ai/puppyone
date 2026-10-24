//! Port of `ExperimentalSettingsView.tsx`: the same groups, rows and choice
//! segments. Rows whose behaviour has a native consumer are live; the others
//! look exactly like the product's but are inert, and their tooltip carries
//! the product's "not available yet" message instead of silently doing
//! nothing. `gitAutoCommit` appears only when the platform exposes it (never
//! natively), like the Web view. The Homepage group follows the product
//! build's `assetLibraryHome` flag (`features/flags/flags.json`: on).
use super::super::{
    components::*, preference_types::Preferences,
    settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::Theme,
    ui::{SegmentOption, segment, switch, tooltip},
};
use gpui::{prelude::*, *};

type Get = fn(&Preferences) -> bool;
type Set = fn(&mut Preferences, bool);
struct Setting {
    key: &'static str,
    get: Get,
    set: Set,
    /// `(false label, true label)` for segment rows.
    choices: Option<(&'static str, &'static str)>,
    native: bool,
}
macro_rules! setting {
    ($key:literal, $($field:ident).+, $native:expr) => {
        Setting { key: $key, get: |p| p.$($field).+, set: |p, v| p.$($field).+ = v, choices: None, native: $native }
    };
    ($key:literal, $($field:ident).+, $native:expr, $off:literal, $on:literal) => {
        Setting { key: $key, get: |p| p.$($field).+, set: |p, v| p.$($field).+ = v, choices: Some(($off, $on)), native: $native }
    };
}
fn groups() -> Vec<(&'static str, Vec<Setting>)> {
    vec![
        (
            "header",
            vec![
                setting!("projectReach", experimental.project_reach, false),
                setting!(
                    "projectHeaderAlignment",
                    experimental.centered_project_in_header,
                    true,
                    "left",
                    "center"
                ),
                setting!(
                    "projectLocationIconsInHeader",
                    experimental.project_location_icons_in_header,
                    false,
                    "menu",
                    "header"
                ),
                setting!(
                    "workbenchTabsInHeader",
                    experimental.workbench_tabs_in_header,
                    false,
                    "sidebar",
                    "header"
                ),
                setting!("shareOnboarding", experimental.share_onboarding, false),
                setting!(
                    "projectSwitcherRail",
                    project_switcher_rail,
                    true,
                    "menu",
                    "sidebar"
                ),
                setting!(
                    "multiRootWorkspaces",
                    experimental.multi_root_workspaces,
                    false
                ),
                setting!(
                    "alwaysShowOnboardingCoachmarks",
                    experimental.always_show_onboarding_coachmarks,
                    false,
                    "once",
                    "repeat"
                ),
                setting!(
                    "editorTabsInHeader",
                    experimental.editor_tabs_in_header,
                    false,
                    "panes",
                    "header"
                ),
            ],
        ),
        (
            "markdown",
            vec![
                // The native Markdown editor has no block drag or heading
                // outline yet (the WebView product viewer was removed).
                setting!("markdownBlockDrag", experimental.markdown_block_drag, false),
                setting!(
                    "markdownHeadingOutline",
                    experimental.markdown_heading_outline,
                    false
                ),
            ],
        ),
        (
            "imports",
            vec![
                setting!("otherAppImports", experimental.other_app_imports, true),
                setting!("viewerPlugins", experimental.viewer_plugins, false),
            ],
        ),
        (
            "cloud",
            vec![
                setting!("cloudWorkspace", experimental.cloud_workspace, false),
                setting!("cloudAutomation", experimental.cloud_automation, false),
                setting!("payments", experimental.payments, false),
                setting!("flowFiles", experimental.puppy_flow_files, false),
            ],
        ),
        (
            "homepage",
            vec![setting!(
                "projectsHome",
                experimental.asset_library_home,
                false,
                "list",
                "cards"
            )],
        ),
    ]
}
impl SettingsWorkspaceSurface {
    pub(super) fn experimental(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let state = self.preferences.read(cx).state.clone();
        let mut content = section(tr(Page::Experimental.title()), t);
        for (index, (group, settings)) in groups().into_iter().enumerate() {
            let rows = settings
                .into_iter()
                .map(|setting| {
                    let label = tr(&format!("settings.experimental.{}.title", setting.key));
                    let detail = (setting.key != "projectHeaderAlignment")
                        .then(|| tr(&format!("settings.experimental.{}.detail", setting.key)));
                    let value = (setting.get)(&state);
                    let disabled = !setting.native;
                    let reason = disabled.then(|| {
                        tf(
                            "settings.sidebar.notAvailable",
                            &[("section", label.into())],
                        )
                    });
                    let control: AnyElement = match setting.choices {
                        Some((off, on)) => {
                            let options = [(false, off), (true, on)]
                                .into_iter()
                                .map(|(choice, key)| {
                                    let prefs = self.preferences.clone();
                                    let set = setting.set;
                                    SegmentOption {
                                        label: tr(&format!(
                                            "settings.experimental.{}.{key}",
                                            setting.key
                                        ))
                                        .into(),
                                        leading: None,
                                        active: value == choice,
                                        disabled: false,
                                        on_select: Box::new(move |_, cx| {
                                            if !disabled {
                                                prefs.update(cx, |p, cx| {
                                                    p.change(|p| set(p, choice), cx)
                                                })
                                            }
                                        }),
                                    }
                                })
                                .collect();
                            let seg = segment(SharedString::from(setting.key), options, t)
                                .id(SharedString::from(format!("{}-segment", setting.key)));
                            match reason.clone().or(detail.map(String::from)) {
                                Some(text) => seg.tooltip(tooltip(text)).into_any_element(),
                                None => seg.into_any_element(),
                            }
                        }
                        None => {
                            let prefs = self.preferences.clone();
                            let set = setting.set;
                            switch(
                                SharedString::from(setting.key),
                                label,
                                value,
                                disabled,
                                t,
                                move |on, _, cx| {
                                    prefs.update(cx, |p, cx| p.change(|p| set(p, on), cx))
                                },
                            )
                            .tooltip(tooltip(
                                reason
                                    .clone()
                                    .unwrap_or_else(|| detail.unwrap_or(label).into()),
                            ))
                            .into_any_element()
                        }
                    };
                    setting_row(label, control, t).into_any_element()
                })
                .collect();
            content = content.child(subsection(
                Some(tr(&format!("settings.experimental.groups.{group}")).into()),
                None,
                index == 0,
                rows,
                t,
            ));
        }
        content
    }
}
