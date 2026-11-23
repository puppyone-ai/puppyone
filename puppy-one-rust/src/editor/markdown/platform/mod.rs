//! Markdown platform capability layer (`TA-42`, `TA-50`, `TA-51`, `TA-52`,
//! `MA-09`, `MA-14`):
//! - `brokers`: async asset/render/embed/link execution ports;
//! - `policy`: centralized URL, asset, HTML profile, network, SVG, and limit policies;
//! - `sessions`: per-view, `BlockId`-scoped presentation sessions (`WidgetStateStore`);
//! - `security`: document and workspace capability identity helpers.
//!
//! Never imports `markdown::features` or `markdown::composition` (`R7`).
pub mod brokers;
pub mod policy;
pub mod security;
pub mod sessions;
