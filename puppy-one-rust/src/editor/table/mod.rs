//! The editable table primitive shared by CSV and Markdown tables (product
//! `editor/table` with editable-table.css):
//!
//! - `layout`: column width rules
//! - `operation`: the structural operation vocabulary
//! - `style`: the `--po-editable-table-*` contract
//! - `paint`: canvas layers of cell boxes and text
//! - `interaction`: hover, grip drags, drop boundaries, structural
//!   selection, column resize (plain state over a format's `Tracks`)
//! - `controls`: rails, grips and the resize rail
//! - `menu`: the action menu and its sections
//!
//! A format supplies its model, geometry and operation handling; it never
//! re-implements these.
pub mod controls;
pub mod interaction;
mod layout;
pub mod menu;
pub mod operation;
pub mod paint;
pub mod style;

pub use layout::*;
