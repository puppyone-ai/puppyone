//! `src/features/flags`: the product decisions every account, Cloud and
//! other-computer surface reads (#83, #89).
//!
//! - `account_available`: this build offers a PuppyOne account (Settings >
//!   Account, session restore, PuppyOne compute). An account is not Cloud.
//! - `cloud_enabled`: the account is available *and* the user turned on the
//!   Cloud experiment. Cloud projects, the Cloud Computer and its Plan,
//!   sharing, first-run sign-in, the Homepage account status and marketplace
//!   template links follow this; while it is off nothing contacts Cloud
//!   except the account session itself.
//! - `host_devices_enabled`: the account is available and the user turned
//!   on Other computers: the owner's other computers on the Homepage and
//!   opening this computer's folders to them.
use crate::features::settings::PreferencesStore;
use gpui::{App, Entity};

pub fn account_available(cx: &App) -> bool {
    crate::features::cloud::account::available(cx)
}
pub fn cloud_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    account_available(cx) && preferences.read(cx).state.experimental.cloud_workspace
}
/// `VITE_HOST_DEVICES_ENABLED`: whether a build offers the owner's other
/// computers out of the box (the Settings switch can still turn them on).
pub const HOST_DEVICES_BUILD: bool = option_env!("PUPPYONE_HOST_DEVICES_ENABLED").is_some();
/// `useHostDevicesEnabled`: shows the owner's other computers and per-folder
/// sharing controls; it grants no folder access.
pub fn host_devices_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    account_available(cx) && preferences.read(cx).state.experimental.host_devices
}
