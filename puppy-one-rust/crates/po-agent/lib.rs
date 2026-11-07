//! The Agent host: domain, application, provider runtimes and protocols,
//! transports, persistence and the in-process host the window talks to.
#[path = "../../src/agent/mod.rs"]
pub mod agent;

// The modules below this crate, under the names the sources use.
pub(crate) use po_contracts::{clock, text};
pub(crate) use po_platform::{localization, platform};
pub(crate) use po_workspace::cloud;
