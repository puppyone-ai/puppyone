//! Mermaid block model and execution-budget classification (`MA-04`: zero `gpui`).
use crate::editor::markdown::core::plans::execution::{
    DocumentProfile, FenceExecution, MERMAID_DEFERRED_MAX_BYTES, MERMAID_DEFERRED_MAX_ITEMS,
    MERMAID_RICH_BYTES, MERMAID_RICH_ITEMS, decide_fence_execution,
};
use std::ops::Range;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct MermaidBlock {
    pub range: Range<usize>,
    pub code: Range<usize>,
    pub source: String,
    pub deferred: bool,
}

pub fn is_mermaid(language: &str) -> bool {
    matches!(language.trim().to_lowercase().as_str(), "mermaid" | "mmd")
}

/// `decideMarkdownBlockExecution("mermaid", …)`: `Some(deferred)` for a
/// diagram, `None` for one that stays source.
pub fn execution(source: &str, profile: DocumentProfile) -> Option<bool> {
    match decide_fence_execution(
        source,
        profile,
        MERMAID_RICH_BYTES,
        MERMAID_RICH_ITEMS,
        MERMAID_DEFERRED_MAX_BYTES,
        MERMAID_DEFERRED_MAX_ITEMS,
    ) {
        FenceExecution::Immediate => Some(false),
        FenceExecution::Deferred => Some(true),
        FenceExecution::FallbackToCode => None,
    }
}
