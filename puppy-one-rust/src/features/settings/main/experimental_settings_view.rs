//! Native `ExperimentalSettingsView`: the groups, switches and choice segments
//! backed by native consumers.
use super::super::{
    preference_types::Preferences, settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::t as tr,
    theme::Theme,
    ui::components::{
        Segment, SegmentedControl, SettingRow, SettingsSection, SettingsSubsection, Switch,
    },
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
}
macro_rules! setting {
    ($key:literal, $($field:ident).+) => {
        Setting { key: $key, get: |p| p.$($field).+, set: |p, v| p.$($field).+ = v, choices: None }
    };
    ($key:literal, $($field:ident).+, $off:literal, $on:literal) => {
        Setting { key: $key, get: |p| p.$($field).+, set: |p, v| p.$($field).+ = v, choices: Some(($off, $on)) }
    };
}
/// Supported experimental groups. `hostDevices` shows only while Other
/// computers passes its release gate; `payments` only while accounts are
/// available.
fn groups(
    account_available: bool,
    host_devices_available: bool,
) -> Vec<(&'static str, Vec<Setting>)> {
    let mut cloud = vec![
        setting!("cloudWorkspace", experimental.cloud_workspace),
        setting!("cloudComputerScreen", experimental.cloud_computer_screen),
        setting!(
            "isolatedAgentSandboxes",
            experimental.isolated_agent_sandboxes
        ),
        setting!("computerMode", experimental.computer_mode),
    ];
    if host_devices_available {
        // `useHostDevicesAvailable`: the owner's other computers.
        cloud.push(setting!("hostDevices", experimental.host_devices));
    }
    if account_available {
        cloud.push(setting!("payments", experimental.payments));
    }
    cloud.push(setting!("flowFiles", experimental.puppy_flow_files));
    vec![
        (
            "header",
            vec![
                setting!(
                    "projectSwitcherRail",
                    project_switcher_rail,
                    "menu",
                    "sidebar"
                ),
                setting!(
                    "alwaysShowOnboardingCoachmarks",
                    experimental.always_show_onboarding_coachmarks,
                    "once",
                    "repeat"
                ),
                setting!(
                    "editorTabsInHeader",
                    experimental.editor_tabs_in_header,
                    "panes",
                    "header"
                ),
            ],
        ),
        (
            "markdown",
            vec![setting!(
                "markdownBlockDrag",
                experimental.markdown_block_drag
            )],
        ),
        (
            "imports",
            vec![setting!("otherAppImports", experimental.other_app_imports)],
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
                    let detail: SharedString =
                        tr(&format!("settings.experimental.{}.detail", setting.key)).into();
                    let value = (setting.get)(&state);
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
                                            prefs.update(cx, |p, cx| {
                                                p.change(|p| set(p, choice), cx)
                                            })
                                        },
                                    )
                                });
                            SegmentedControl::new(setting.key)
                                .segments(segments)
                                .tooltip(detail)
                                .into_any_element()
                        }
                        None => {
                            let prefs = self.preferences.clone();
                            let set = setting.set;
                            Switch::new(SharedString::from(setting.key), label)
                                .checked(value)
                                .tooltip(detail)
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

    fn keys_in(group_id: &str, account: bool, hosts: bool) -> Vec<&'static str> {
        groups(account, hosts)
            .into_iter()
            .find(|(id, _)| *id == group_id)
            .map(|(_, rows)| rows.into_iter().map(|row| row.key).collect())
            .unwrap()
    }

    #[test]
    fn experimental_groups_list_only_supported_native_settings() {
        assert_eq!(
            keys_in("header", true, true),
            [
                "projectSwitcherRail",
                "alwaysShowOnboardingCoachmarks",
                "editorTabsInHeader",
            ]
        );
        assert_eq!(keys_in("markdown", true, true), ["markdownBlockDrag"]);
        assert_eq!(keys_in("imports", true, true), ["otherAppImports"]);
    }

    /// HX-1: the Other computers switch follows the release gate, not the
    /// account; paid compute follows the account.
    #[test]
    fn the_other_computers_switch_shows_only_past_the_release_gate() {
        assert_eq!(
            keys_in("cloud", true, false),
            [
                "cloudWorkspace",
                "cloudComputerScreen",
                "isolatedAgentSandboxes",
                "computerMode",
                "payments",
                "flowFiles"
            ]
        );
        assert_eq!(
            keys_in("cloud", true, true),
            [
                "cloudWorkspace",
                "cloudComputerScreen",
                "isolatedAgentSandboxes",
                "computerMode",
                "hostDevices",
                "payments",
                "flowFiles"
            ]
        );
        assert_eq!(
            keys_in("cloud", false, false),
            [
                "cloudWorkspace",
                "cloudComputerScreen",
                "isolatedAgentSandboxes",
                "computerMode",
                "flowFiles"
            ]
        );
    }
}
