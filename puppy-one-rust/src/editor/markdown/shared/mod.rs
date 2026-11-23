//! Helpers shared by Markdown feature widgets (product `markdown/shared`):
//! media reference parsing, isolated preview port, fenced block helpers,
//! inline token scanning, and shared widget chrome (`ring`, `source_toggle`,
//! `fallback`). Never imports `core`, `features`, `platform`, `composition`,
//! or `addons` (`R6`, `MA-08`).
pub mod fence;
pub mod media;
pub mod preview;
pub mod token_scan;
pub mod widgets;
