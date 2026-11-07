//! OS adapters (processes, files, Git, storage, telemetry, PDF, Office,
//! themes, Agent CLI activity) and localization; no product layer above them.
#[path = "../../src/localization.rs"]
pub mod localization;
#[path = "../../src/platform/mod.rs"]
pub mod platform;

// The modules below this crate, under the names the sources use.
pub(crate) use po_contracts::{asset_catalog, wake};
