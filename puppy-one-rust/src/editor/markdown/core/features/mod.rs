//! The Markdown feature contract (`TA-30`, `TA-33`, `TA-40`,
//! product `core/features/`).
//!
//! Each capability is a vertical slice in `features/<name>/` and plugs into the
//! pipeline exclusively through [`MarkdownFeature`]. Pure module (`R10`: zero
//! `gpui` references).
pub mod context;
pub mod contract;
pub mod data;
pub mod isolation;

pub use context::{CommandCx, CompileCx, FeatureKeybinding, InlineWidgetCx, WidgetFactoryCx};
pub use contract::{Features, MarkdownFeature, find};
pub use isolation::{FEATURE_PANIC_EVENT, catch_feature_panic};
