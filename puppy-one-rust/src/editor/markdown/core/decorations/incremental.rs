//! Incremental Document-Layer decoration splicing with deferred downstream
//! byte shifts (`TA-11`, `TA-13`, `TA-32`, `TA-81`).
use super::{
    DecorateCx,
    block::{LazyBlockWidget, LazyEnvSlot, LazyWidgetEnv, decorate_window},
    decorate_with_registry, surface,
};
use crate::editor::{
    markdown::core::{
        presentation::block_rhythm_in_lines, projection::range::incremental_window,
        syntax::SyntaxSplice,
    },
    view::{
        decoration::{Block, BlockSplice, Decorations, InlineWidget, InlineWidgetKind},
        widget::{BlockId, BlockIdRegistry, BlockWidget},
    },
};
use std::{cell::RefCell, collections::HashMap, ops::Range, rc::Rc};

fn shift_range(r: &Range<usize>, delta: isize) -> Range<usize> {
    let s = ((r.start as isize) + delta) as usize;
    let e = ((r.end as isize) + delta) as usize;
    s..e
}

fn shift_inline_widget_in_place(w: &mut InlineWidget, delta: isize) {
    w.range = shift_range(&w.range, delta);
    match &mut w.kind {
        InlineWidgetKind::Text(_) => {}
        InlineWidgetKind::Superscript { sup, .. } => sup.range = w.range.clone(),
        InlineWidgetKind::Image { image, .. } => image.range = w.range.clone(),
    }
}

#[inline]
fn logical_partition(
    len: usize,
    split: usize,
    delta: isize,
    key: impl Fn(usize) -> usize,
    bound: usize,
) -> usize {
    let b = bound as i128;
    let mut lo = 0usize;
    let mut hi = len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let v = key(mid) as i128 + if mid < split { 0 } else { delta as i128 };
        if v < b {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Incrementally splice Document-Layer decorations across `splice` (`TA-11`,
/// `TA-13`, `TA-32`). Clones `prev` when shared; prefer
/// [`decorate_incremental_in_place`] when the caller owns `prev`.
#[allow(clippy::too_many_arguments)]
pub fn decorate_incremental(
    prev: &Rc<Decorations>,
    splice: &SyntaxSplice,
    cx: &DecorateCx,
    registry: &mut BlockIdRegistry,
    revision: u64,
    prev_widgets: &HashMap<BlockId, Rc<dyn BlockWidget>>,
    lazy_env_slot: &LazyEnvSlot,
) -> Decorations {
    let base_id = prev.id;
    let mut built = decorate_incremental_in_place(
        (**prev).clone(),
        splice,
        cx,
        registry,
        revision,
        prev_widgets,
        lazy_env_slot,
        None,
    );
    if let Some(sp) = &mut built.splice {
        sp.base_ptr = base_id as usize;
    }
    built
}

/// In-place `O(log N + |window|)` incremental Document-Layer decoration splice
/// (`TA-11`, `TA-13`, `TA-32`, `TA-81`). Moves `prev` vectors in place and
/// defers downstream byte shifts via `Decorations::deferred`.
#[allow(clippy::too_many_arguments)]
pub fn decorate_incremental_in_place(
    mut prev: Decorations,
    splice: &SyntaxSplice,
    cx: &DecorateCx,
    registry: &mut BlockIdRegistry,
    revision: u64,
    prev_widgets: &HashMap<BlockId, Rc<dyn BlockWidget>>,
    lazy_env_slot: &LazyEnvSlot,
    source_fallbacks: Option<&[(bool, Range<usize>)]>,
) -> Decorations {
    let base_id = prev.id;
    let new_total = cx.doc.line_count();
    let Some(win_spec) = incremental_window(
        prev.blocks.len(),
        |i| prev.blocks[i].lines(),
        splice,
        new_total,
    ) else {
        let rhythm = super::super::presentation::block_rhythm(cx.doc, cx.syntax, None);
        let full_cx = DecorateCx {
            rhythm: &rhythm,
            ..*cx
        };
        return decorate_with_registry(&full_cx, registry, revision, prev_widgets);
    };

    let b_start = win_spec.old_blocks.start;
    let b_end = win_spec.old_blocks.end;
    let aligned_new_start = win_spec.new_lines.start;
    let aligned_new_end = win_spec.new_lines.end;
    let line_delta = win_spec.line_delta;

    let window_rhythm =
        block_rhythm_in_lines(cx.doc, cx.syntax, aligned_new_start..aligned_new_end, None);
    let win_cx = DecorateCx {
        rhythm: &window_rhythm,
        ..*cx
    };
    let mut win = decorate_window(
        &win_cx,
        aligned_new_start..aligned_new_end,
        aligned_new_start,
        Some(registry),
        revision,
        Some(prev_widgets),
        source_fallbacks,
    );

    let byte_delta: isize = (splice.new_bytes.end as isize - splice.new_bytes.start as isize)
        - (splice.old_bytes.end as isize - splice.old_bytes.start as isize);

    let needs_lazy_wrap = byte_delta != 0 || line_delta != 0;
    if needs_lazy_wrap {
        let link_defs_text = if cx.syntax.link_defs.is_empty() {
            String::new()
        } else {
            cx.syntax
                .link_defs
                .iter()
                .map(|(_, raw)| raw.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        };
        *lazy_env_slot.borrow_mut() = Some(Rc::new(LazyWidgetEnv {
            revision,
            doc: cx.doc.clone(),
            link_defs_text,
            theme: cx.theme.clone(),
            features: cx.features,
            feature_state: cx.preview.features.clone(),
            assets: cx.assets.cloned(),
            references: cx.references.cloned(),
        }));
    }

    // Evict ONLY widget IDs removed from the replaced `prev.blocks[b_start..b_end]`
    // window (`O(|window|)` instead of scanning all document blocks!).
    let mut dead_ids: Vec<BlockId> = Vec::new();
    for old_b in &prev.blocks[b_start..b_end] {
        if let Block::Widget { id: old_id, .. } = old_b {
            let kept = win
                .blocks
                .iter()
                .any(|nb| matches!(nb, Block::Widget { id, .. } if id == old_id));
            if !kept {
                dead_ids.push(*old_id);
            }
        }
    }
    registry.remove_ids(&dead_ids);

    let win_blocks_len = win.blocks.len();
    let new_blocks_range = b_start..b_start + win_blocks_len;
    let block_count_delta = win_blocks_len as isize - (b_end - b_start) as isize;

    if line_delta != 0 {
        prev.materialize_block_anchors();
        let old_lazy = if prev.lazy_wrapped_from == usize::MAX {
            usize::MAX
        } else if prev.lazy_wrapped_from <= b_end {
            b_start + win_blocks_len
        } else {
            ((prev.lazy_wrapped_from as isize) + block_count_delta) as usize
        };
        prev.blocks.splice(b_start..b_end, win.blocks);
        let suffix_start = b_start + win_blocks_len;
        for (offset, block) in prev.blocks[suffix_start..].iter_mut().enumerate() {
            let idx = suffix_start + offset;
            match block {
                Block::Line { line, .. } => {
                    *line = ((*line as isize) + line_delta) as usize;
                }
                Block::Widget { id, lines, widget } => {
                    lines.start = ((lines.start as isize) + line_delta) as usize;
                    lines.end = ((lines.end as isize) + line_delta) as usize;
                    id.shift(byte_delta, revision);
                    if idx < old_lazy
                        && widget
                            .as_widget_any()
                            .and_then(|a| a.downcast_ref::<LazyBlockWidget>())
                            .is_none()
                    {
                        *widget = Rc::new(LazyBlockWidget {
                            env_slot: Rc::clone(lazy_env_slot),
                            fallback: Rc::clone(widget),
                            resolved: RefCell::new(None),
                        });
                    }
                }
            }
        }
        prev.lazy_wrapped_from = suffix_start.min(old_lazy);
    } else {
        if prev.deferred.blocks_delta != 0 {
            let b_split = prev.deferred.blocks_split.min(prev.blocks.len());
            if b_end < b_split {
                prev.materialize_block_anchors();
            } else if b_split < b_start {
                let bd = prev.deferred.blocks_delta;
                let rev = prev.deferred.blocks_revision;
                for block in &mut prev.blocks[b_split..b_start] {
                    if let Block::Widget { id, .. } = block {
                        id.shift(bd, rev);
                    }
                }
                prev.deferred.blocks_split = b_start;
            }
        }
        let old_lazy = if prev.lazy_wrapped_from == usize::MAX {
            usize::MAX
        } else if prev.lazy_wrapped_from <= b_end {
            b_start + win_blocks_len
        } else {
            ((prev.lazy_wrapped_from as isize) + block_count_delta) as usize
        };
        prev.blocks.splice(b_start..b_end, win.blocks);
        let suffix_start = b_start + win_blocks_len;
        if byte_delta != 0 {
            let wrap_end = old_lazy.min(prev.blocks.len());
            if suffix_start < wrap_end {
                for block in &mut prev.blocks[suffix_start..wrap_end] {
                    if let Block::Widget { widget, .. } = block
                        && widget
                            .as_widget_any()
                            .and_then(|a| a.downcast_ref::<LazyBlockWidget>())
                            .is_none()
                    {
                        *widget = Rc::new(LazyBlockWidget {
                            env_slot: Rc::clone(lazy_env_slot),
                            fallback: Rc::clone(widget),
                            resolved: RefCell::new(None),
                        });
                    }
                }
            }
            prev.lazy_wrapped_from = suffix_start.min(old_lazy);
            let next_b_delta = prev.deferred.blocks_delta + byte_delta;
            prev.deferred.blocks_delta = next_b_delta;
            prev.deferred.blocks_revision = revision;
            prev.deferred.blocks_split = if next_b_delta == 0 {
                prev.blocks.len()
            } else {
                suffix_start
            };
        } else {
            prev.lazy_wrapped_from = old_lazy;
            if prev.deferred.blocks_delta != 0 {
                prev.deferred.blocks_split = suffix_start;
            }
        }
    }

    let new_win_bytes_start = if aligned_new_start < new_total {
        cx.doc.line_range(aligned_new_start).start
    } else {
        cx.doc.len()
    };
    let new_win_bytes_end = if aligned_new_end == 0 {
        0
    } else if aligned_new_end < new_total {
        cx.doc.line_range(aligned_new_end).start
    } else {
        cx.doc.len()
    };
    let old_win_bytes_start = new_win_bytes_start;
    let old_win_bytes_end = ((new_win_bytes_end as isize) - byte_delta).max(0) as usize;

    // The window decorates whole lines, but an element on its first or last
    // line can reach into the unchanged lines around it (emphasis wrapping onto
    // the next line). The prefix and suffix keep their own copies of those
    // ranges, so the window contributes only the ones starting inside it;
    // otherwise they would appear twice and break the sorted order.
    let to_eof = aligned_new_end >= new_total;
    let in_window =
        |start: usize| start >= new_win_bytes_start && (to_eof || start < new_win_bytes_end);
    win.marks.retain(|m| in_window(m.range.start));
    win.atomic.retain(|r| in_window(r.start));
    win.inline_widgets.retain(|w| in_window(w.range.start));
    win.underlines.retain(|u| in_window(u.range.start));

    let d0 = prev.deferred.delta;
    let ms0 = prev.deferred.marks_split.min(prev.marks.len());
    let hs0 = prev.deferred.hidden_split.min(prev.hidden.len());
    let as0 = prev.deferred.atomic_split.min(prev.atomic.len());
    let iws0 = prev
        .deferred
        .inline_widgets_split
        .min(prev.inline_widgets.len());
    let us0 = prev.deferred.underlines_split.min(prev.underlines.len());

    let m_pre = logical_partition(
        prev.marks.len(),
        ms0,
        d0,
        |i| prev.marks[i].range.start,
        old_win_bytes_start,
    );
    let m_suf = logical_partition(
        prev.marks.len(),
        ms0,
        d0,
        |i| prev.marks[i].range.start,
        old_win_bytes_end,
    )
    .max(m_pre);

    let mut h_pre = logical_partition(
        prev.hidden.len(),
        hs0,
        d0,
        |i| prev.hidden[i].start,
        old_win_bytes_start,
    );
    let mut h_suf = logical_partition(
        prev.hidden.len(),
        hs0,
        d0,
        |i| prev.hidden[i].start,
        old_win_bytes_end,
    )
    .max(h_pre);

    let a_pre = logical_partition(
        prev.atomic.len(),
        as0,
        d0,
        |i| prev.atomic[i].start,
        old_win_bytes_start,
    );
    let a_suf = logical_partition(
        prev.atomic.len(),
        as0,
        d0,
        |i| prev.atomic[i].start,
        old_win_bytes_end,
    )
    .max(a_pre);

    let iw_pre = logical_partition(
        prev.inline_widgets.len(),
        iws0,
        d0,
        |i| prev.inline_widgets[i].range.start,
        old_win_bytes_start,
    );
    let iw_suf = logical_partition(
        prev.inline_widgets.len(),
        iws0,
        d0,
        |i| prev.inline_widgets[i].range.start,
        old_win_bytes_end,
    )
    .max(iw_pre);

    let u_pre = logical_partition(
        prev.underlines.len(),
        us0,
        d0,
        |i| prev.underlines[i].range.start,
        old_win_bytes_start,
    );
    let u_suf = logical_partition(
        prev.underlines.len(),
        us0,
        d0,
        |i| prev.underlines[i].range.start,
        old_win_bytes_end,
    )
    .max(u_pre);

    // If the edit jumped strictly earlier than the previous deferred split in
    // any inline vector, materialise once so all five vectors keep one shared delta.
    if d0 != 0 && (m_suf < ms0 || h_suf < hs0 || a_suf < as0 || iw_suf < iws0 || u_suf < us0) {
        prev.materialize_inline_vectors();
    }

    let cur_delta = prev.deferred.delta;
    if cur_delta != 0 {
        let ms = prev.deferred.marks_split.min(prev.marks.len());
        if ms < m_pre {
            for m in &mut prev.marks[ms..m_pre] {
                m.range = shift_range(&m.range, cur_delta);
            }
        }
        let hs = prev.deferred.hidden_split.min(prev.hidden.len());
        if hs < h_pre {
            for r in &mut prev.hidden[hs..h_pre] {
                *r = shift_range(r, cur_delta);
            }
        }
        let ats = prev.deferred.atomic_split.min(prev.atomic.len());
        if ats < a_pre {
            for r in &mut prev.atomic[ats..a_pre] {
                *r = shift_range(r, cur_delta);
            }
        }
        let iws = prev
            .deferred
            .inline_widgets_split
            .min(prev.inline_widgets.len());
        if iws < iw_pre {
            for w in &mut prev.inline_widgets[iws..iw_pre] {
                shift_inline_widget_in_place(w, cur_delta);
            }
        }
        let us = prev.deferred.underlines_split.min(prev.underlines.len());
        if us < u_pre {
            for u in &mut prev.underlines[us..u_pre] {
                u.range = shift_range(&u.range, cur_delta);
            }
        }
    }

    let next_delta = cur_delta + byte_delta;

    let m_mid_len = win.marks.len();
    prev.marks.splice(m_pre..m_suf, win.marks);
    let new_marks_split = m_pre + m_mid_len;

    // O(1) sorted boundary coalescing for `hidden` without touching the suffix.
    let mut h_mid = win.hidden;
    if h_pre > 0 && !h_mid.is_empty() && h_mid[0].start <= prev.hidden[h_pre - 1].end {
        h_pre -= 1;
        let left = &prev.hidden[h_pre];
        h_mid[0].start = left.start;
        h_mid[0].end = h_mid[0].end.max(left.end);
    }
    while h_suf < prev.hidden.len() {
        let next_r = shift_range(&prev.hidden[h_suf], next_delta);
        if let Some(last) = h_mid.last_mut() {
            if next_r.start <= last.end {
                last.end = last.end.max(next_r.end);
                h_suf += 1;
                continue;
            }
        } else if h_pre > 0 && next_r.start <= prev.hidden[h_pre - 1].end {
            let merged_start = prev.hidden[h_pre - 1].start;
            let merged_end = prev.hidden[h_pre - 1].end.max(next_r.end);
            h_pre -= 1;
            h_suf += 1;
            h_mid.push(merged_start..merged_end);
            continue;
        }
        break;
    }
    let h_mid_len = h_mid.len();
    prev.hidden.splice(h_pre..h_suf, h_mid);
    let new_hidden_split = h_pre + h_mid_len;

    let a_mid_len = win.atomic.len();
    prev.atomic.splice(a_pre..a_suf, win.atomic);
    let new_atomic_split = a_pre + a_mid_len;

    let iw_mid_len = win.inline_widgets.len();
    prev.inline_widgets
        .splice(iw_pre..iw_suf, win.inline_widgets);
    let new_inline_widgets_split = iw_pre + iw_mid_len;

    let u_mid_len = win.underlines.len();
    prev.underlines.splice(u_pre..u_suf, win.underlines);
    let new_underlines_split = u_pre + u_mid_len;

    prev.deferred.delta = next_delta;
    if next_delta == 0 {
        prev.deferred.marks_split = prev.marks.len();
        prev.deferred.hidden_split = prev.hidden.len();
        prev.deferred.atomic_split = prev.atomic.len();
        prev.deferred.inline_widgets_split = prev.inline_widgets.len();
        prev.deferred.underlines_split = prev.underlines.len();
    } else {
        prev.deferred.marks_split = new_marks_split;
        prev.deferred.hidden_split = new_hidden_split;
        prev.deferred.atomic_split = new_atomic_split;
        prev.deferred.inline_widgets_split = new_inline_widgets_split;
        prev.deferred.underlines_split = new_underlines_split;
    }

    prev.id = crate::editor::view::decoration::next_decorations_id();
    prev.surface = surface(cx.theme);
    prev.splice = Some(BlockSplice {
        base_ptr: base_id as usize,
        old_blocks: b_start..b_end,
        new_blocks: new_blocks_range,
        removed_widget_ids: dead_ids,
    });
    prev
}
