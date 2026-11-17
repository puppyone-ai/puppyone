//! Wire formats and the plain types every layer shares: UTF-16 text, the
//! clock, wake channels, geometry, file formats and kinds, the tree model, the
//! UI asset catalog, the Workspace provider contract and the Agent contract.
#[path = "../../src/asset_catalog.rs"]
pub mod asset_catalog;
#[path = "../../src/clock.rs"]
pub mod clock;
#[path = "../../src/file_kind.rs"]
pub mod file_kind;
#[path = "../../src/formats/mod.rs"]
pub mod formats;
#[path = "../../src/geometry.rs"]
pub mod geometry;
#[path = "../../src/model.rs"]
pub mod model;
#[path = "../../src/text.rs"]
pub mod text;
#[path = "../../src/wake.rs"]
pub mod wake;
/// `crate::workspace::contracts` (`src/workspace/contracts.rs`).
#[path = "../../src/workspace"]
pub mod workspace {
    pub mod contracts;
}
/// `crate::agent::contract` (`src/agent/contract`).
#[path = "../../src/agent"]
pub mod agent {
    pub mod contract;
}
