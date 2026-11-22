//! Markdown dialect resolution (product `core/dialect/markdownDialect.ts`).
//!
//! The cross-crate [`MarkdownDialect`] enum remains in `crate::formats::markdown`;
//! this module provides the Markdown-core resolution entry point.
pub use crate::formats::markdown::{DialectResolution, DialectSource, MarkdownDialect};

/// Resolve the Markdown dialect from path extension and optional explicit host
/// metadata (host metadata takes precedence; document body never participates).
pub fn resolve_dialect(path: &str, explicit: Option<MarkdownDialect>) -> DialectResolution {
    MarkdownDialect::resolve(path, explicit)
}
