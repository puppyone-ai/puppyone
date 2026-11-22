//! Helpers shared by Markdown feature widgets (product `markdown/shared`):
//! media reference parsing, sanitized HTML DOM & rendering surface, fenced
//! block budget helpers, inline token scanning, focus/selection rings,
//! toolbar source toggle, and visible fallback primitives. Never imports
//! `core`, `features`, `platform`, `composition`, or `addons` (`R6`, `TA-41`).
pub mod dom;
pub mod fallback;
pub mod fence;
pub mod html_surface;
pub mod media_source;
pub mod ring;
pub mod source_toggle;
pub mod token_scan;
