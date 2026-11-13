//! Port of `ExperimentalSettingsView.tsx`: the same groups, rows and choice
//! segments. Rows whose behaviour has a native consumer are live; the others
//! look exactly like the product's but are inert, and their tooltip carries
//! the product's "not available yet" message instead of silently doing
//! nothing. `gitAutoCommit` appears only when the platform exposes it (never
//! natively), like the Web view.
use super::super::{
    preference_types::Preferences, settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::Theme,
    ui::components::{
        Segment, SegmentedControl, SettingRow, SettingsSection, SettingsSubsection, Switch,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::Disableable as _;

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
/// `ExperimentalSettingsView`'s groups at the pinned product. `hostDevices`
/// shows only while Other computers passes its release gate, `payments`
/// only while accounts are available; `gitAutoCommit` only where the
/// platform exposes it, which the native build never does.
fn groups(
    account_available: bool,
    host_devices_available: bool,
) -> Vec<(&'static str, Vec<Setting>)> {
    let mut cloud = vec![setting!(
        "cloudWorkspace",
        experimental.cloud_workspace,
        true
    )];
    if host_devices_available {
        // `useHostDevicesAvailable`: the owner's other computers.
        cloud.push(setting!("hostDevices", experimental.host_devices, true));
    }
    if account_available {
        cloud.push(setting!("payments", experimental.payments, true));
    }
    cloud.push(setting!("flowFiles", experimental.puppy_flow_files, true));
    vec![
        (
            "header",
            vec![
                setting!("projectReach", experimental.project_reach, false),
                setting!(
                    "workbenchTabsInHeader",
                    experimental.workbench_tabs_in_header,
                    false,
                    "sidebar",
                    "header"
                ),
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
                    true,
                    "once",
                    "repeat"
                ),
                setting!(
                    "editorTabsInHeader",
                    experimental.editor_tabs_in_header,
                    true,
                    "panes",
                    "header"
                ),
            ],
        ),
        (
            "markdown",
            vec![
                setting!("markdownBlockDrag", experimental.markdown_block_drag, true),
                // The native Markdown editor has no heading outline yet.
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
        ("cloud", cloud),
    ]
}
impl SettingsWorkspaceSurface {
    pub(super) fn experimental(&self, _: Theme, cx: &mut Context<Self>) -> AnyElement {
        let state = self.preferences.read(cx).state.clone();
        let mut content = SettingsSection::new(tr(Page::Experimental.title()));
        let account = crate::features::flags::account_available(cx);
        let hosts = crate::features::flags::host_devices_available(cx);
        for (index, (group, settings)) in groups(account, hosts).into_iter().enumerate() {
            let rows = settings
                .into_iter()
                .map(|setting| {
                    let label = tr(&format!("settings.experimental.{}.title", setting.key));
                    let detail = tr(&format!("settings.experimental.{}.detail", setting.key));
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
                            let segments =
                                [(false, off), (true, on)].into_iter().map(|(choice, key)| {
                                    let prefs = self.preferences.clone();
                                    let set = setting.set;
                                    Segment::new(tr(&format!(
                                        "settings.experimental.{}.{key}",
                                        setting.key
                                    )))
                                    .selected(value == choice)
                                    .on_select(
                                        move |_, cx| {
                                            if !disabled {
                                                prefs.update(cx, |p, cx| {
                                                    p.change(|p| set(p, choice), cx)
                                                })
                                            }
                                        },
                                    )
                                });
                            SegmentedControl::new(setting.key)
                                .segments(segments)
                                .when_some(reason.clone().or(Some(detail.into())), |s, text| {
                                    s.tooltip(text)
                                })
                                .into_any_element()
                        }
                        None => {
                            let prefs = self.preferences.clone();
                            let set = setting.set;
                            Switch::new(SharedString::from(setting.key), label)
                                .checked(value)
                                .disabled(disabled)
                                .tooltip(reason.clone().unwrap_or_else(|| detail.into()))
                                .on_change(move |on, _, cx| {
                                    prefs.update(cx, |p, cx| p.change(|p| set(p, on), cx))
                                })
                                .into_any_element()
                        }
                    };
                    SettingRow::new(label).control(control)
                })
                .collect::<Vec<_>>();
            content = content.child(
                SettingsSubsection::new()
                    .title(tr(&format!("settings.experimental.groups.{group}")))
                    .lead(index == 0)
                    .children(rows),
            );
        }
        content.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::groups;
    use core::prelude::v1::test;

    fn cloud_keys(account: bool, hosts: bool) -> Vec<&'static str> {
        groups(account, hosts)
            .into_iter()
            .find(|(id, _)| *id == "cloud")
            .map(|(_, rows)| rows.into_iter().map(|row| row.key).collect())
            .unwrap()
    }

    /// HX-1: the Other computers switch follows the release gate, not the
    /// account; paid compute follows the account.
    #[test]
    fn the_other_computers_switch_shows_only_past_the_release_gate() {
        assert_eq!(
            cloud_keys(true, false),
            ["cloudWorkspace", "payments", "flowFiles"]
        );
        assert_eq!(
            cloud_keys(true, true),
            ["cloudWorkspace", "hostDevices", "payments", "flowFiles"]
        );
        assert_eq!(cloud_keys(false, false), ["cloudWorkspace", "flowFiles"]);
    }
}
