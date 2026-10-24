//! Native CSV / TSV editor (product `editor/viewers/csv`): the structured
//! model owns the document while live; source mode edits the raw text.
mod cell;
pub mod document;
pub mod layout;
pub mod model;
pub mod operations;
pub mod preferences;
pub mod theme;
mod view;

pub use view::{CsvEditor, CsvEvent, bind_keys};
#[allow(unused_imports)]
pub use view::{FindResult, ViewItem};
