//! `src/features/flags`: the product decisions every account, Cloud and
//! other-computer surface reads (#83, #89).
//!
//! - `account_available`: this build offers a PuppyOne account (Settings >
//!   Account, session restore, PuppyOne compute). An account is not Cloud.
//! - `cloud_enabled`: the account is available *and* the user turned on the
//!   Cloud experiment (or Computer Mode, whose Cloud Computers need it).
//!   Cloud projects, the Cloud Computer and its Plan, sharing, first-run
//!   sign-in, the Homepage account status and marketplace template links
//!   follow this; while it is off nothing contacts Cloud except the account
//!   session itself.
//! - `computer_mode_enabled`: projects are framed as miniature Cloud and
//!   on-device computers (`useComputerModeEnabled`); it also shows the Cloud
//!   Computer screen without its own switch.
//! - `host_devices_available`: the account is available and this build
//!   passes the Other computers release gate (`hosts::AVAILABLE`, closed in
//!   v0.4.4); the experiment's switch shows only then.
//! - `host_devices_enabled`: Other computers is available and the user
//!   turned it on: the owner's other computers on the Homepage and opening
//!   this computer's folders to them.
use crate::features::settings::PreferencesStore;
use gpui::{App, Entity};

pub fn account_available(cx: &App) -> bool {
    crate::features::cloud::account::available(cx)
}
/// `usePaymentsExperience`: the single decision point for asking anyone for
/// money — the build offers an account and the user has not opted out.
pub fn payments_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    account_available(cx) && preferences.read(cx).state.experimental.payments
}
pub fn cloud_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    let experimental = &preferences.read(cx).state.experimental;
    account_available(cx) && (experimental.cloud_workspace || experimental.computer_mode)
}
pub fn cloud_screen_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    let experimental = &preferences.read(cx).state.experimental;
    cloud_enabled(preferences, cx)
        && (experimental.cloud_computer_screen || experimental.computer_mode)
}
pub fn isolated_agent_sandboxes_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    cloud_enabled(preferences, cx)
        && preferences
            .read(cx)
            .state
            .experimental
            .isolated_agent_sandboxes
}
pub fn cloud_computer_settings_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    cloud_screen_enabled(preferences, cx) || isolated_agent_sandboxes_enabled(preferences, cx)
}
/// `useComputerModeEnabled`: needs no account; on-device computers are local.
pub fn computer_mode_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    preferences.read(cx).state.experimental.computer_mode
}
/// `VITE_HOST_DEVICES_ENABLED`: whether a build offers the owner's other
/// computers out of the box (the Settings switch can still turn them on).
pub const HOST_DEVICES_BUILD: bool = option_env!("PUPPYONE_HOST_DEVICES_ENABLED").is_some();
/// `useHostDevicesAvailable`: the release gate is independent of a saved
/// experiment choice.
pub fn host_devices_available(cx: &App) -> bool {
    account_available(cx) && rollout(cx)
}
/// `useHostDevicesEnabled`: shows the owner's other computers and per-folder
/// sharing controls; it grants no folder access.
pub fn host_devices_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    host_devices_available(cx) && preferences.read(cx).state.experimental.host_devices
}

#[cfg(not(test))]
fn rollout(_: &App) -> bool {
    crate::workspace::hosts::AVAILABLE
}
#[cfg(test)]
fn rollout(cx: &App) -> bool {
    cx.has_global::<HostDevicesRollout>() || crate::workspace::hosts::AVAILABLE
}
/// The release gate as tests open it (`registerHostIpcHandlers({enabled})`);
/// builds have no way to.
#[cfg(test)]
struct HostDevicesRollout;
#[cfg(test)]
impl gpui::Global for HostDevicesRollout {}
#[cfg(test)]
pub fn open_host_devices_rollout(cx: &mut App) {
    cx.set_global(HostDevicesRollout);
}
