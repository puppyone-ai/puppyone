//! Projection window and changed-range calculation (product
//! `core/projection/syntaxProjectionRange.ts`).
//!
//! Pure functions over line counts, block line spans, [`SyntaxSplice`], and
//! [`PreviewState`], shared by [`crate::editor::markdown::pipeline`] and
//! [`crate::editor::markdown::core::decorations`] so parse-coverage guards and
//! decoration splice windows always agree.
use super::super::{state::PreviewState, syntax::SyntaxSplice};
use crate::editor::text::buffer::Buffer;
use std::ops::Range;

/// Requested line window to project into decorations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionRequest {
    pub lines: Range<usize>,
}

/// Block-aligned incremental decoration window derived from a [`SyntaxSplice`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IncrementalWindow {
    pub old_blocks: Range<usize>,
    pub old_lines: Range<usize>,
    pub new_lines: Range<usize>,
    pub line_delta: isize,
}

/// Sort and coalesce overlapping or adjacent ranges.
pub fn merge_ranges(mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.sort_by_key(|r| (r.start, r.end));
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for r in ranges {
        match merged.last_mut() {
            Some(last) if r.start <= last.end => last.end = last.end.max(r.end),
            _ => merged.push(r),
        }
    }
    merged
}

/// Enclosing range covering both `prev` and `next` projection spans.
pub fn changed_range(prev: &Range<usize>, next: &Range<usize>) -> Range<usize> {
    prev.start.min(next.start)..prev.end.max(next.end)
}

#[inline]
fn partition_point(len: usize, mut pred: impl FnMut(usize) -> bool) -> usize {
    let mut lo = 0usize;
    let mut hi = len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if pred(mid) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Compute the block-aligned incremental decoration window for `splice`.
/// Returns `None` when the document or previous block list is empty and a full
/// rebuild should be performed instead.
pub fn incremental_window(
    block_count: usize,
    block_lines: impl Fn(usize) -> Range<usize>,
    splice: &SyntaxSplice,
    new_total: usize,
) -> Option<IncrementalWindow> {
    let line_delta: isize = (splice.new_lines.end as isize - splice.new_lines.start as isize)
        - (splice.old_lines.end as isize - splice.old_lines.start as isize);
    let old_total = ((new_total as isize) - line_delta).max(0) as usize;
    if block_count == 0 || old_total == 0 || new_total == 0 {
        return None;
    }

    let raw_old_start = splice.old_lines.start.saturating_sub(1).min(old_total);
    let raw_old_end = (splice.old_lines.end + 1).min(old_total).max(raw_old_start);

    let b_start = partition_point(block_count, |i| block_lines(i).end <= raw_old_start);
    let b_end = partition_point(block_count, |i| block_lines(i).start < raw_old_end).max(b_start);

    let aligned_old_start = if b_start < b_end {
        block_lines(b_start).start.min(raw_old_start)
    } else {
        raw_old_start
    };
    let aligned_old_end = if b_start < b_end {
        block_lines(b_end - 1).end.max(raw_old_end)
    } else {
        raw_old_end
    };

    let aligned_new_start = aligned_old_start.min(new_total);
    let aligned_new_end = ((aligned_old_end as isize) + line_delta)
        .clamp(aligned_new_start as isize, new_total as isize) as usize;

    Some(IncrementalWindow {
        old_blocks: b_start..b_end,
        old_lines: aligned_old_start..aligned_old_end,
        new_lines: aligned_new_start..aligned_new_end,
        line_delta,
    })
}

/// Byte offset that parsed syntax/plans must cover for an incremental
/// decoration splice without materialising an untouched deferred suffix tail.
/// Returns `None` when the window reaches EOF (requiring the full document).
pub fn incremental_required_byte(
    doc: &Buffer,
    block_count: usize,
    block_lines: impl Fn(usize) -> Range<usize>,
    splice: &SyntaxSplice,
) -> Option<usize> {
    let new_total = doc.line_count();
    let line_delta: isize = (splice.new_lines.end as isize - splice.new_lines.start as isize)
        - (splice.old_lines.end as isize - splice.old_lines.start as isize);
    let old_total = ((new_total as isize) - line_delta).max(0) as usize;
    let raw_old_end = (splice.old_lines.end + 1).min(old_total);
    let b_end = partition_point(block_count, |i| block_lines(i).start < raw_old_end);
    let aligned_old_end = b_end
        .checked_sub(1)
        .map_or(raw_old_end, |i| block_lines(i).end.max(raw_old_end));
    let aligned_new_end =
        ((aligned_old_end as isize) + line_delta).clamp(0, new_total as isize) as usize;
    let guard_line = (aligned_new_end + 1).min(new_total);
    if guard_line < new_total {
        Some(doc.line_range(guard_line).start)
    } else {
        None
    }
}

/// Compute the merged, block-aligned line spans that require Reveal Layer
/// overrides for the active `preview` state.
pub fn reveal_line_spans(
    doc: &Buffer,
    preview: &PreviewState,
    block_count: usize,
    block_lines: impl Fn(usize) -> Range<usize>,
) -> Vec<Range<usize>> {
    let total = doc.line_count();
    if total == 0 {
        return Vec::new();
    }

    let mut line_spans: Vec<Range<usize>> = Vec::with_capacity(4);
    for r in [&preview.reveal, &preview.revealed_source]
        .into_iter()
        .flatten()
    {
        let clamped = doc.clamp_range(r.clone());
        let first = doc.line_index(clamped.start);
        let last = doc.line_index(clamped.end.saturating_sub(1).max(clamped.start));
        line_spans.push(first..(last + 1).min(total));
    }
    if let Some(comp) = preview.composing {
        let l = doc.line_index(doc.clamp(comp));
        line_spans.push(l..(l + 1).min(total));
    }
    if let Some(rl) = preview.reveal_line
        && rl < total
    {
        line_spans.push(rl..rl + 1);
    }
    if line_spans.is_empty() {
        return Vec::new();
    }

    // Align any span touching a multi-line `Block::Widget` to that widget's
    // whole `lines` range so inline reveals inside table cells or revealed
    // source blocks replace whole blocks cleanly.
    for span in &mut line_spans {
        let b_first = partition_point(block_count, |i| block_lines(i).end <= span.start);
        let b_last = partition_point(block_count, |i| block_lines(i).start < span.end).max(b_first);
        if b_first < b_last {
            span.start = span.start.min(block_lines(b_first).start);
            span.end = span.end.max(block_lines(b_last - 1).end);
        }
    }
    merge_ranges(line_spans)
}

/// Byte offset that parsed syntax/plans must cover for a Reveal Layer pass
/// without materialising an untouched deferred suffix tail.
pub fn reveal_required_byte(
    doc: &Buffer,
    preview: &PreviewState,
    block_count: usize,
    block_lines: impl Fn(usize) -> Range<usize>,
) -> Option<usize> {
    let mut max_line = 0usize;
    let total = doc.line_count();
    for r in [&preview.reveal, &preview.revealed_source]
        .into_iter()
        .flatten()
    {
        let clamped = doc.clamp_range(r.clone());
        max_line = max_line.max(doc.line_index(clamped.end.saturating_sub(1).max(clamped.start)));
    }
    if let Some(comp) = preview.composing {
        max_line = max_line.max(doc.line_index(doc.clamp(comp)));
    }
    if let Some(rl) = preview.reveal_line {
        max_line = max_line.max(rl.min(total.saturating_sub(1)));
    }
    let b_last = partition_point(block_count, |i| {
        block_lines(i).start < (max_line + 1).min(total)
    });
    let expanded_end_line = b_last
        .checked_sub(1)
        .map_or(max_line + 1, |i| block_lines(i).end)
        .max(max_line + 1);
    if expanded_end_line + 1 < total {
        Some(doc.line_range(expanded_end_line + 1).start)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn sample_splice(old_lines: Range<usize>, new_lines: Range<usize>) -> SyntaxSplice {
        let line_delta = (new_lines.end as isize - new_lines.start as isize)
            - (old_lines.end as isize - old_lines.start as isize);
        SyntaxSplice {
            old_bytes: 0..0,
            new_bytes: 0..0,
            old_lines,
            new_lines,
            byte_delta: 0,
            line_delta,
            old_had_delimiters: false,
        }
    }

    #[test]
    fn incremental_window_aligns_multi_line_blocks_and_handles_line_deltas() {
        // Blocks: line 0, lines 1..4 (multi-line widget), line 4, line 5..8 (widget), line 8
        let blocks = [0..1, 1..4, 4..5, 5..8, 8..9];
        // Edit line 4 (+2 lines inserted): +/-1 context touches widget 1..4 and widget 5..8!
        let splice = sample_splice(4..5, 4..7);
        let win = incremental_window(blocks.len(), |i| blocks[i].clone(), &splice, 11).unwrap();
        assert_eq!(win.old_blocks, 1..4);
        assert_eq!(win.old_lines, 1..8);
        assert_eq!(win.new_lines, 1..10);
        assert_eq!(win.line_delta, 2);

        assert_eq!(changed_range(&(2..5), &(4..9)), 2..9);
        assert!(incremental_window(0, |_| 0..0, &splice, 11).is_none());
    }

    #[test]
    fn reveal_line_spans_expands_to_enclosing_blocks_and_merges_overlaps() {
        let doc = Buffer::new("l0\nl1\nl2\nl3\nl4\nl5\n");
        // Multi-line block spans lines 1..4; single lines for 0, 4, 5, 6.
        let blocks = [0..1, 1..4, 4..5, 5..6, 6..7];
        let mut preview = PreviewState::default();
        preview.reveal = Some(doc.line_range(2));
        preview.reveal_line = Some(3);
        let spans = reveal_line_spans(&doc, &preview, blocks.len(), |i| blocks[i].clone());
        assert_eq!(spans, vec![1..4]);

        let req = reveal_required_byte(&doc, &preview, blocks.len(), |i| blocks[i].clone());
        assert_eq!(req, Some(doc.line_range(5).start));
    }

    #[test]
    fn required_byte_guards_deferred_tail_boundary() {
        let doc = Buffer::new("a\nb\nc\nd\ne\nf\n");
        let blocks = [0..1, 1..2, 2..3, 3..4, 4..5, 5..6, 6..7];
        let splice = sample_splice(1..2, 1..2);
        let req = incremental_required_byte(&doc, blocks.len(), |i| blocks[i].clone(), &splice);
        // old_end=2 -> raw_old_end=3 -> aligned_new_end=3 -> guard_line=4
        assert_eq!(req, Some(doc.line_range(4).start));
    }
}
