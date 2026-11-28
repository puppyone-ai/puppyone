//! Block-aligned incremental window discovery (`TA-31`).
use super::{extra_link_defs_str, shift_span_signed};
use crate::editor::{
    markdown::core::{
        features::Features,
        syntax::{
            Span, Syntax, SyntaxSplice, fence_straddles, has_global_hazards, html_unbalanced,
            link_defs_overlap, span_straddles, spans_overlap,
        },
    },
    text::{buffer::Buffer, change::ChangeSet},
};

impl Syntax {
    pub(in crate::editor::markdown::core::syntax) fn compute_incremental_window(
        doc: &Buffer,
        before_doc: &Buffer,
        prev: &Syntax,
        changes: &ChangeSet,
        features: Features,
        allow_eof: bool,
    ) -> Option<(Self, SyntaxSplice)> {
        if changes.is_empty() || prev.top_blocks.len() < 6 {
            return None;
        }
        let n_blocks = prev.top_blocks.len();
        let cs = changes.changes();
        let min_old = cs.first().map_or(0, |c| c.range.start);
        let max_old = cs.last().map_or(0, |c| c.range.end);
        let byte_delta = doc.len() as isize - before_doc.len() as isize;
        let first_hit = prev.top_blocks.partition_point(|b| b.end < min_old);
        let b_start = first_hit.saturating_sub(1);

        let (old_start_byte, old_start_line) = if b_start == 0 {
            (0, 0)
        } else {
            let prev_end = prev.top_blocks[b_start - 1].end;
            if prev_end >= min_old {
                return None;
            }
            let osl = doc.line_index(prev_end) + 1;
            if osl >= doc.line_count() {
                return None;
            }
            let osb = doc.line_range(osl).start;
            if osb > min_old {
                return None;
            }
            (osb, osl)
        };
        if fence_straddles(&prev.fences, old_start_byte)
            || span_straddles(&prev.html_blocks, old_start_byte)
            || span_straddles(&prev.comment_spans, old_start_byte)
        {
            return None;
        }

        let last_hit = prev.top_blocks.partition_point(|b| b.start <= max_old);
        let past_straddles = |mut b_end: usize| {
            while b_end < n_blocks {
                let anchor_end = prev.top_blocks[b_end - 1].end;
                if fence_straddles(&prev.fences, anchor_end)
                    || span_straddles(&prev.html_blocks, anchor_end)
                    || span_straddles(&prev.comment_spans, anchor_end)
                {
                    b_end += 1;
                } else {
                    break;
                }
            }
            b_end
        };
        let mut b_end = past_straddles((last_hit + 1).min(n_blocks));
        let mut step = 1usize;
        let mut tried_eof = false;
        loop {
            let at_eof = b_end >= n_blocks;
            if at_eof {
                if !allow_eof || tried_eof || b_start == 0 {
                    break;
                }
                tried_eof = true;
            } else if prev.top_blocks[b_end - 1].start <= max_old {
                b_end = past_straddles((b_end + step).min(n_blocks));
                step *= 2;
                continue;
            }
            let (new_end_line, new_end_byte, old_end_byte, expected_align_new) = if at_eof {
                (doc.line_count(), doc.len(), before_doc.len(), None)
            } else {
                let expected = shift_span_signed(&prev.top_blocks[b_end - 1], byte_delta);
                if expected.end > doc.len() {
                    return None;
                }
                let nel = (doc.line_index(expected.end) + 1).min(doc.line_count());
                let neb = if nel >= doc.line_count() {
                    doc.len()
                } else {
                    doc.line_range(nel).start
                };
                let oeb_signed = neb as isize - byte_delta;
                if oeb_signed < 0 {
                    return None;
                }
                (nel, neb, oeb_signed as usize, Some(expected))
            };
            if new_end_byte < old_start_byte
                || old_end_byte < old_start_byte
                || old_end_byte > before_doc.len()
            {
                return None;
            }
            let old_span = old_start_byte..old_end_byte;
            if has_global_hazards(&doc.slice_cow(old_start_byte..new_end_byte))
                || link_defs_overlap(&prev.link_defs, &old_span)
                || spans_overlap(&prev.footnote_spans, &old_span)
            {
                return None;
            }
            let extra_defs = extra_link_defs_str(prev);
            let win_syntax =
                Self::parse_region(doc, old_start_line..new_end_line, &extra_defs, features);

            let start_aligned = b_start == 0
                || win_syntax
                    .top_blocks
                    .first()
                    .is_some_and(|first| first.start == prev.top_blocks[b_start].start);
            let end_aligned = match &expected_align_new {
                Some(expected) => {
                    win_syntax.fences.iter().all(|f| f.closed)
                        && win_syntax
                            .html_blocks
                            .last()
                            .is_none_or(|h| h.end <= expected.end)
                        && win_syntax.top_blocks.last() == Some(expected)
                }
                None => {
                    win_syntax.fences.iter().all(|f| f.closed)
                        && (extra_defs.is_empty() || win_syntax.html_blocks.is_empty())
                }
            };
            if win_syntax.link_defs.is_empty()
                && win_syntax.footnotes.is_empty()
                && start_aligned
                && end_aligned
            {
                let html_before = prev
                    .html_blocks
                    .partition_point(|h| h.end <= old_start_byte);
                let html_upto = prev
                    .html_blocks
                    .partition_point(|h| h.start < old_end_byte)
                    .max(html_before);
                let old_html = |h: &Span| html_unbalanced(&before_doc.slice_cow(h.clone()));
                let window_unbalanced = prev.html_blocks[html_before..html_upto]
                    .iter()
                    .any(old_html)
                    || win_syntax
                        .html_blocks
                        .iter()
                        .any(|h| html_unbalanced(&doc.slice_cow(h.clone())));
                if window_unbalanced
                    && prev.html_blocks[..html_before]
                        .iter()
                        .chain(&prev.html_blocks[html_upto..])
                        .any(old_html)
                {
                    return None;
                }
                let old_end_line = if new_end_line >= doc.line_count() {
                    before_doc.line_count()
                } else {
                    before_doc.line_index(old_end_byte)
                };
                let bd_pre = prev
                    .block_delimiters
                    .partition_point(|&p| p < old_start_byte);
                let bd_suf = prev
                    .block_delimiters
                    .partition_point(|&p| p < old_end_byte)
                    .max(bd_pre);
                return Some((
                    win_syntax,
                    SyntaxSplice {
                        old_bytes: old_start_byte..old_end_byte,
                        new_bytes: old_start_byte..new_end_byte,
                        old_lines: old_start_line..old_end_line,
                        new_lines: old_start_line..new_end_line,
                        byte_delta,
                        line_delta: new_end_line as isize - old_end_line as isize,
                        old_had_delimiters: bd_suf > bd_pre,
                    },
                ));
            }
            if at_eof || step > 16 {
                break;
            }
            b_end = past_straddles((b_end + step).min(n_blocks));
            step *= 2;
        }
        None
    }
}
