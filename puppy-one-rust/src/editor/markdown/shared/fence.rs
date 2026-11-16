//! Shared fenced-block helpers (`markdownBlockExecution.ts`, `getCodeFenceMarker`):
//! document scale profiles, rich/deferred execution budgets, fence-marker
//! scanning, and atomic delimiter ranges for fenced block widgets.
use std::ops::Range;

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

/// `getCodeFenceMarker`: returns `(fence_byte, run_len)` for a line starting
/// with up to 3 spaces followed by at least 3 `` ` `` or `~` characters.
pub fn fence_marker(line: &str) -> Option<(u8, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line.as_bytes()[indent..];
    let c = *rest.first()?;
    let run = rest.iter().take_while(|b| **b == c).count();
    (matches!(c, b'`' | b'~') && run >= 3).then_some((c, run))
}

/// Atomic delimiter ranges `(opening_fence, closing_fence)` around `code`
/// within `range`, so the caret cannot rest on hidden fence lines while a
/// fenced block widget is rendered.
pub fn fence_delimiter_ranges(
    range: &Range<usize>,
    code: &Range<usize>,
) -> (Range<usize>, Range<usize>) {
    (
        range.start..code.start.max(range.start),
        code.end..range.end.max(code.end),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn document_profiles_and_fence_markers_follow_product_thresholds() {
        assert_eq!(DocumentProfile::classify(100, 10), DocumentProfile::Normal);
        assert_eq!(
            DocumentProfile::classify(2 * 1024 * 1024, 10),
            DocumentProfile::Large
        );
        assert_eq!(
            DocumentProfile::classify(10, 300_000),
            DocumentProfile::Extreme
        );
        assert_eq!(fence_marker("   ```rust\n"), Some((b'`', 3)));
        assert_eq!(fence_marker("~~~~\n"), Some((b'~', 4)));
        assert_eq!(fence_marker("    ```\n"), None);
        assert_eq!(fence_marker("``\n"), None);
        assert_eq!(
            fence_delimiter_ranges(&(10..50), &(18..46)),
            (10..18, 46..50)
        );
    }
}
