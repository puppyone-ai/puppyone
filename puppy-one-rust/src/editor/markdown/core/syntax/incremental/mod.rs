//! Block-level incremental Markdown re-parsing, fast single-line list/table
//! row patches, and in-place coordinate shifting (`TA-13`, `TA-31`).
mod patch;
mod tail;
mod window;

use super::{Element, Fence, Hl, List, ListItem, Span, Syntax, SyntaxSplice};
use crate::editor::text::{buffer::Buffer, change::ChangeSet};

pub(super) fn shift_signed(v: usize, delta: isize) -> usize {
    (v as isize + delta) as usize
}

pub(super) fn shift_span_signed(span: &Span, delta: isize) -> Span {
    shift_signed(span.start, delta)..shift_signed(span.end, delta)
}

pub(super) fn shift_spans(spans: &mut [Span], delta: isize) {
    if delta == 0 {
        return;
    }
    for r in spans {
        *r = shift_span_signed(r, delta);
    }
}

pub(super) fn shift_elements(elements: &mut [Element], bd: isize) {
    if bd == 0 {
        return;
    }
    for m in elements {
        m.range = shift_span_signed(&m.range, bd);
        for mk in &mut m.markers {
            *mk = shift_span_signed(mk, bd);
        }
        if let Some(c) = &mut m.content {
            *c = shift_span_signed(c, bd);
        }
        if let Some(l) = &mut m.line {
            *l = shift_span_signed(l, bd);
        }
    }
}

pub(super) fn shift_lists(lists: &mut [List], bd: isize, item_delta: isize) {
    if bd == 0 && item_delta == 0 {
        return;
    }
    for m in lists {
        m.range = shift_span_signed(&m.range, bd);
        if item_delta != 0 {
            for it in &mut m.items {
                *it = shift_signed(*it, item_delta);
            }
            if let Some(p) = &mut m.parent {
                *p = shift_signed(*p, item_delta);
            }
        }
    }
}

pub(super) fn shift_items(items: &mut [ListItem], bd: isize, list_delta: isize, item_delta: isize) {
    if bd == 0 && list_delta == 0 && item_delta == 0 {
        return;
    }
    for m in items {
        m.range = shift_span_signed(&m.range, bd);
        if list_delta != 0 {
            m.list = shift_signed(m.list, list_delta);
        }
        if item_delta != 0 {
            for p in &mut m.parents {
                *p = shift_signed(*p, item_delta);
            }
        }
        m.marker_from = shift_signed(m.marker_from, bd);
        m.marker_to = shift_signed(m.marker_to, bd);
        m.content_from = shift_signed(m.content_from, bd);
        if let Some(t) = &mut m.task {
            t.line = shift_span_signed(&t.line, bd);
            t.checkbox = shift_span_signed(&t.checkbox, bd);
            t.prefix_to = shift_signed(t.prefix_to, bd);
        }
        for (_, br) in &mut m.blocks {
            *br = shift_span_signed(br, bd);
        }
    }
}

pub(super) fn shift_fences(fences: &mut [Fence], bd: isize, ld: isize) {
    if bd == 0 && ld == 0 {
        return;
    }
    for m in fences {
        m.range = shift_span_signed(&m.range, bd);
        m.code = shift_span_signed(&m.code, bd);
        if ld != 0 {
            m.lines = shift_span_signed(&m.lines, ld);
        }
    }
}

pub(super) fn splice_highlights_in_place(
    highlights: &mut Vec<(Span, Hl)>,
    ob: &Span,
    bd: isize,
    win_hl: Vec<(Span, Hl)>,
    trailing_nl_bounds: Option<(&Span, &Span, &Span)>,
) {
    let hl_pre = highlights.partition_point(|(r, _)| r.end <= ob.start);
    let hl_suf = highlights
        .partition_point(|(r, _)| r.start < ob.end)
        .max(hl_pre);
    let trailing_nl_hl = trailing_nl_bounds
        .filter(|(old_c, _, _)| old_c.end < ob.end && hl_pre < hl_suf)
        .and_then(|(old_c, _, _)| {
            highlights[hl_pre..hl_suf]
                .iter()
                .rev()
                .find(|(r, _)| r.start <= old_c.end && r.end >= ob.end)
                .map(|(_, c)| *c)
        });
    let mut replacement: Vec<(Span, Hl)> = Vec::with_capacity(win_hl.len() + 3);
    if hl_pre < hl_suf && highlights[hl_pre].0.start < ob.start {
        replacement.push((highlights[hl_pre].0.start..ob.start, highlights[hl_pre].1));
    }
    replacement.extend(
        win_hl
            .into_iter()
            .filter(|(r, c)| !r.is_empty() && *c != Hl::NONE),
    );
    if let (Some(nl_hl), Some((_, new_c, nb))) = (trailing_nl_hl, trailing_nl_bounds)
        && new_c.end < nb.end
        && replacement.last().is_none_or(|(r, _)| r.end <= new_c.end)
    {
        replacement.push((new_c.end..nb.end, nl_hl));
    }
    if hl_pre < hl_suf && highlights[hl_suf - 1].0.end > ob.end {
        let tail_start = shift_signed(ob.end, bd);
        let tail_end = shift_signed(highlights[hl_suf - 1].0.end, bd);
        replacement.push((tail_start..tail_end, highlights[hl_suf - 1].1));
    }
    if bd != 0 {
        for (r, _) in &mut highlights[hl_suf..] {
            *r = shift_span_signed(r, bd);
        }
    }
    let rep_len = replacement.len();
    highlights.splice(hl_pre..hl_suf, replacement);
    let check_start = hl_pre.saturating_sub(1);
    let mut check_end = (hl_pre + rep_len + 1).min(highlights.len());
    let mut idx = check_start;
    while idx + 1 < check_end {
        if highlights[idx].1 == highlights[idx + 1].1
            && highlights[idx].0.end == highlights[idx + 1].0.start
        {
            highlights[idx].0.end = highlights[idx + 1].0.end;
            highlights.remove(idx + 1);
            check_end -= 1;
        } else {
            idx += 1;
        }
    }
}

pub(super) fn shift_after_byte(vec: &mut [Span], ob_end: usize, bd: isize) {
    if bd == 0 {
        return;
    }
    let pos = vec.partition_point(|r| r.start < ob_end);
    shift_spans(&mut vec[pos..], bd);
}

pub(super) fn shift_common_suffix(prev: &mut Syntax, ob_end: usize, bd: isize, bd_suf: usize) {
    if bd == 0 {
        return;
    }
    shift_after_byte(&mut prev.code_blocks, ob_end, bd);
    shift_after_byte(&mut prev.html_blocks, ob_end, bd);
    shift_after_byte(&mut prev.marker_html, ob_end, bd);
    shift_after_byte(&mut prev.comment_spans, ob_end, bd);
    shift_after_byte(&mut prev.footnote_spans, ob_end, bd);
    let f_pos = prev.fences.partition_point(|f| f.range.start < ob_end);
    shift_fences(&mut prev.fences[f_pos..], bd, 0);
    let nd_pos = prev.note_definitions.partition_point(|&p| p < ob_end);
    for p in &mut prev.note_definitions[nd_pos..] {
        *p = shift_signed(*p, bd);
    }
    let ld_pos = prev.link_defs.partition_point(|(r, _)| r.start < ob_end);
    for (r, _) in &mut prev.link_defs[ld_pos..] {
        *r = shift_span_signed(r, bd);
    }
    for p in &mut prev.block_delimiters[bd_suf..] {
        *p = shift_signed(*p, bd);
    }
    prev.footnotes.shift_in_place(ob_end, bd);
}

pub(super) fn single_line_edit_bounds(
    doc: &Buffer,
    before_doc: &Buffer,
    changes: &ChangeSet,
) -> Option<(usize, Span, Span, Span, Span, isize)> {
    let cs = changes.changes();
    if cs.len() != 1 || cs[0].insert.contains(['\n', '\r']) {
        return None;
    }
    let ch = &cs[0];
    let line_idx = before_doc.line_index(ch.range.start);
    if before_doc.line_index(ch.range.end) != line_idx || line_idx >= doc.line_count() {
        return None;
    }
    let old_content = before_doc.line_range(line_idx);
    let new_content = doc.line_range(line_idx);
    if ch.range.end > old_content.end {
        return None;
    }
    let old_end = if line_idx + 1 < before_doc.line_count() {
        before_doc.line_range(line_idx + 1).start
    } else {
        before_doc.len()
    };
    let new_end = if line_idx + 1 < doc.line_count() {
        doc.line_range(line_idx + 1).start
    } else {
        doc.len()
    };
    let ob = old_content.start..old_end;
    let nb = new_content.start..new_end;
    let bd = doc.len() as isize - before_doc.len() as isize;
    if (nb.end as isize - ob.end as isize) != bd {
        return None;
    }
    Some((line_idx, old_content, new_content, ob, nb, bd))
}

pub(super) fn extra_link_defs_str(prev: &Syntax) -> String {
    prev.link_defs
        .iter()
        .map(|(_, raw)| raw.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

impl Syntax {
    pub(super) fn splice_syntax_in_place(prev: &mut Syntax, win: Syntax, sp: &SyntaxSplice) {
        let (bd, ld, ob) = (sp.byte_delta, sp.line_delta, &sp.old_bytes);
        let el_pre = prev.elements.partition_point(|e| e.range.start < ob.start);
        let el_suf = prev
            .elements
            .partition_point(|e| e.range.start < ob.end)
            .max(el_pre);
        let win_el_len = win.elements.len();
        prev.elements.splice(el_pre..el_suf, win.elements);
        shift_elements(&mut prev.elements[el_pre + win_el_len..], bd);

        let list_pre = prev.lists.partition_point(|l| l.range.end <= ob.start);
        let list_suf = prev
            .lists
            .partition_point(|l| l.range.start < ob.end)
            .max(list_pre);
        let item_pre = prev.items.partition_point(|i| i.range.end <= ob.start);
        let item_suf = prev
            .items
            .partition_point(|i| i.range.start < ob.end)
            .max(item_pre);
        let para_pre = prev.paragraphs.partition_point(|p| p.range.end <= ob.start);
        let para_suf = prev
            .paragraphs
            .partition_point(|p| p.range.start < ob.end)
            .max(para_pre);
        let (win_list_len, win_item_len, win_para_len) =
            (win.lists.len(), win.items.len(), win.paragraphs.len());
        let list_idx_delta = win_list_len as isize - (list_suf - list_pre) as isize;
        let item_idx_delta = win_item_len as isize - (item_suf - item_pre) as isize;

        let mut win_lists = win.lists;
        if item_pre != 0 {
            shift_lists(&mut win_lists, 0, item_pre as isize);
        }
        prev.lists.splice(list_pre..list_suf, win_lists);
        shift_lists(
            &mut prev.lists[list_pre + win_list_len..],
            bd,
            item_idx_delta,
        );

        let mut win_items = win.items;
        if list_pre != 0 || item_pre != 0 {
            shift_items(&mut win_items, 0, list_pre as isize, item_pre as isize);
        }
        prev.items.splice(item_pre..item_suf, win_items);
        shift_items(
            &mut prev.items[item_pre + win_item_len..],
            bd,
            list_idx_delta,
            item_idx_delta,
        );

        let mut win_paras = win.paragraphs;
        if item_pre != 0 {
            for p in &mut win_paras {
                if let Some(it) = &mut p.item {
                    *it += item_pre;
                }
            }
        }
        prev.paragraphs.splice(para_pre..para_suf, win_paras);
        if bd != 0 || item_idx_delta != 0 {
            for m in &mut prev.paragraphs[para_pre + win_para_len..] {
                m.range = shift_span_signed(&m.range, bd);
                if let Some(it) = &mut m.item {
                    *it = shift_signed(*it, item_idx_delta);
                }
            }
        }

        let f_pre = prev.fences.partition_point(|f| f.range.end <= ob.start);
        let f_suf = prev
            .fences
            .partition_point(|f| f.range.start < ob.end)
            .max(f_pre);
        let win_f_len = win.fences.len();
        prev.fences.splice(f_pre..f_suf, win.fences);
        shift_fences(&mut prev.fences[f_pre + win_f_len..], bd, ld);

        let c_pre = prev
            .code_lines
            .partition_point(|r| r.end <= sp.old_lines.start);
        let c_suf = prev
            .code_lines
            .partition_point(|r| r.start < sp.old_lines.end)
            .max(c_pre);
        let win_c_len = win.code_lines.len();
        prev.code_lines.splice(c_pre..c_suf, win.code_lines);
        shift_spans(&mut prev.code_lines[c_pre + win_c_len..], ld);

        splice_highlights_in_place(&mut prev.highlights, ob, bd, win.highlights, None);

        let splice_spans = |vec: &mut Vec<Span>, mid: Vec<Span>| {
            let pre = vec.partition_point(|r| r.end <= ob.start);
            let suf = vec.partition_point(|r| r.start < ob.end).max(pre);
            let mid_len = mid.len();
            vec.splice(pre..suf, mid);
            shift_spans(&mut vec[pre + mid_len..], bd);
        };
        splice_spans(&mut prev.code_blocks, win.code_blocks);
        splice_spans(&mut prev.tables, win.tables);
        splice_spans(&mut prev.table_cells, win.table_cells);
        splice_spans(&mut prev.inline_tags, win.inline_tags);
        splice_spans(&mut prev.html_blocks, win.html_blocks);
        splice_spans(&mut prev.marker_html, win.marker_html);
        splice_spans(&mut prev.top_blocks, win.top_blocks);
        splice_spans(&mut prev.comment_spans, win.comment_spans);
        splice_spans(&mut prev.footnote_spans, win.footnote_spans);

        let nd_pre = prev.note_definitions.partition_point(|&p| p < ob.start);
        let nd_suf = prev
            .note_definitions
            .partition_point(|&p| p < ob.end)
            .max(nd_pre);
        let win_nd_len = win.note_definitions.len();
        prev.note_definitions
            .splice(nd_pre..nd_suf, win.note_definitions);
        if bd != 0 {
            for p in &mut prev.note_definitions[nd_pre + win_nd_len..] {
                *p = shift_signed(*p, bd);
            }
        }
        let ld_pre = prev.link_defs.partition_point(|(r, _)| r.end <= ob.start);
        let ld_suf = prev
            .link_defs
            .partition_point(|(r, _)| r.start < ob.end)
            .max(ld_pre);
        prev.link_defs.drain(ld_pre..ld_suf);
        if bd != 0 {
            for (r, _) in &mut prev.link_defs[ld_pre..] {
                *r = shift_span_signed(r, bd);
            }
        }
        let bd_pre = prev.block_delimiters.partition_point(|&p| p < ob.start);
        let bd_suf = prev
            .block_delimiters
            .partition_point(|&p| p < ob.end)
            .max(bd_pre);
        let win_bd_len = win.block_delimiters.len();
        prev.block_delimiters
            .splice(bd_pre..bd_suf, win.block_delimiters);
        if bd != 0 {
            for p in &mut prev.block_delimiters[bd_pre + win_bd_len..] {
                *p = shift_signed(*p, bd);
            }
        }
        prev.footnotes.shift_in_place(ob.end, bd);
    }
}
