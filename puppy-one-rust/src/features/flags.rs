//! `src/features/flags`: the two product decisions every account and Cloud
//! surface reads (#83, #89).
//!
//! - `account_available`: this build offers a PuppyOne account (Settings >
//!   Account, session restore, PuppyOne compute). An account is not Cloud.
//! - `cloud_enabled`: the account is available *and* the user turned on the
//!   Cloud experiment. Cloud projects, the Cloud Computer and its Plan,
//!   sharing, first-run sign-in, the Homepage account status and marketplace
//!   template links follow this; while it is off nothing contacts Cloud
//!   except the account session itself.
use crate::features::settings::preferences_store::PreferencesStore;
use gpui::{App, Entity};

/// `cloudBilling`: off in this build, as in the product.
pub const CLOUD_BILLING: bool = false;
pub fn account_available(cx: &App) -> bool {
    cx.has_global::<crate::features::cloud_account::CloudAccountService>()
}
pub fn cloud_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    account_available(cx) && preferences.read(cx).state.experimental.cloud_workspace
}
