//! Block render execution budgets and fence-execution policy
//! (product `core/plans/markdownBlockExecution.ts`, `MA-04`: zero `gpui`).
//!
//! Centralizes document scale classification, immediate/deferred/fallback
//! decisions, and per-feature rich rendering budgets so features consume one
//! canonical budget authority rather than duplicating magic limits.

/// `getMarkdownDocumentProfile`: `0` (normal), `1` (large), or `2` (extreme),
/// measured by total UTF-16 code units and line count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentProfile {
    Normal = 0,
    Large = 1,
    Extreme = 2,
}

impl DocumentProfile {
    pub fn classify(utf16_units: usize, lines: usize) -> Self {
        if utf16_units > 10 * 1024 * 1024 || lines > 250_000 {
            Self::Extreme
        } else if utf16_units > 1024 * 1024 || lines > 50_000 {
            Self::Large
        } else {
            Self::Normal
        }
    }

    pub const fn index(self) -> usize {
        self as usize
    }
}

/// How a rich fenced block (such as Mermaid) executes under its profile budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FenceExecution {
    /// Render immediately in live preview.
    Immediate,
    /// Render on explicit user activation (`deferred`).
    Deferred,
    /// Exceeds the rich/deferred ceiling; fall back to a plain code block.
    FallbackToCode,
}

/// `decideMarkdownBlockExecution`: classifies `source` against the per-profile
/// immediate budget (`rich_bytes`, `rich_items`) and the deferred ceiling.
pub fn decide_fence_execution(
    source: &str,
    profile: DocumentProfile,
    rich_bytes: [usize; 3],
    rich_items: [usize; 3],
    deferred_max_bytes: usize,
    deferred_max_items: usize,
) -> FenceExecution {
    let idx = profile.index();
    let bytes = source.len();
    let items = source.lines().filter(|l| !l.trim().is_empty()).count();
    if bytes <= rich_bytes[idx] && items <= rich_items[idx] {
        FenceExecution::Immediate
    } else if bytes <= deferred_max_bytes && items <= deferred_max_items {
        FenceExecution::Deferred
    } else {
        FenceExecution::FallbackToCode
    }
}

// --- Centralized rich-preview budgets (product `markdownBlockExecution.ts`) ---

/// Math rich-preview budget measured in JS UTF-16 code units, independent of
/// the raster service's byte and image-size limits.
pub const MATH_MAX_RICH_SOURCE_UNITS: usize = 32 * 1024;

/// Mermaid immediate and deferred rendering budgets per [`DocumentProfile`].
pub const MERMAID_RICH_BYTES: [usize; 3] = [32 * 1024, 24 * 1024, 12 * 1024];
pub const MERMAID_RICH_ITEMS: [usize; 3] = [1_000, 700, 350];
pub const MERMAID_DEFERRED_MAX_BYTES: usize = 128 * 1024;
pub const MERMAID_DEFERRED_MAX_ITEMS: usize = 4_000;

/// MDX component (`HTML_RICH_BYTES` / `_NODES` / `_DEPTH`, normal profile)
/// rich-render budget: beyond these limits the block stays visible source.
pub const MDX_RICH_BYTES: usize = 48 * 1024;
pub const MDX_RICH_NODES: usize = 800;
pub const MDX_RICH_DEPTH: usize = 48;

/// Code-block syntax-highlighting budgets (`codeBlockHighlightBudget.ts`).
pub const CODE_HIGHLIGHT_SOURCE_BYTE_LIMIT: usize = 16 * 1024;
pub const CODE_HIGHLIGHT_LINE_UNIT_LIMIT: usize = 4 * 1024;
pub const CODE_HIGHLIGHT_SEGMENT_LIMIT: usize = 2048 / 2;

/// Cross-block HTML flow sibling scan limit (`MARKDOWN_HTML_FLOW_MAX_SIBLINGS`).
pub const HTML_FLOW_MAX_SIBLINGS: usize = 512;

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn document_profiles_follow_product_thresholds() {
        assert_eq!(DocumentProfile::classify(100, 10), DocumentProfile::Normal);
        assert_eq!(
            DocumentProfile::classify(2 * 1024 * 1024, 10),
            DocumentProfile::Large
        );
        assert_eq!(
            DocumentProfile::classify(10, 300_000),
            DocumentProfile::Extreme
        );
    }
}
