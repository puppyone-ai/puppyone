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

/// `cloudBilling`: on, as the product's `src/features/flags/flags.json` sets
/// it; the organization group then offers Billing.
pub const CLOUD_BILLING: bool = true;
pub fn account_available(cx: &App) -> bool {
    crate::features::cloud::account::available(cx)
}
pub fn cloud_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    account_available(cx) && preferences.read(cx).state.experimental.cloud_workspace
}
/// `shareOnboardingEnabled`: Share on a local repository, and on Explorer folders.
pub fn share_enabled(preferences: &Entity<PreferencesStore>, cx: &App) -> bool {
    cloud_enabled(preferences, cx) && preferences.read(cx).state.experimental.share_onboarding
}
