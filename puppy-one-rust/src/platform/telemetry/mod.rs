//! Desktop product analytics (`electron/main/telemetry`, `shared/desktop-telemetry-*`):
//! two bounded, anonymous events from packaged Stable builds after a one-time
//! notice, with an Off switch that forgets everything local.
pub mod contract;
mod service;
pub mod store;
pub mod transport;

pub use contract::{DISCLOSURE_URL, Level};
#[cfg(any(test, feature = "dev-capture"))]
pub use service::DisabledReason;
pub use service::{Config, Deps, Service, Snapshot, eligibility, import_electron_preference};
