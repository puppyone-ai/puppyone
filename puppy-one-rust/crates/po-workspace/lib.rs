//! The Workspace facade, its ports and its local and Cloud providers, and
//! the Cloud client (sign-in broker, first publication).
#[path = "../../src/cloud/mod.rs"]
pub mod cloud;
#[path = "../../src/workspace/mod.rs"]
pub mod workspace;

// The modules below this crate, under the names the sources use.
pub(crate) use po_contracts::{formats, model, text};
pub(crate) use po_platform::{localization, platform};
