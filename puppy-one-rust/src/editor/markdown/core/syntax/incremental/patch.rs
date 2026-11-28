//! Fast single-line in-place incremental patches for flat list items and GFM
//! table body rows (`TA-31`).
use super::{
    extra_link_defs_str, shift_after_byte, shift_common_suffix, shift_elements, shift_items,
    shift_lists, shift_signed, shift_span_signed, shift_spans, single_line_edit_bounds,
    splice_highlights_in_place,
};
use crate::editor::{
    markdown::core::{
        features::Features,
        syntax::{
            Element, Hl, Kind, Span, Syntax, SyntaxSplice, has_global_hazards, link_defs_overlap,
            span_straddles, spans_overlap,
        },
    },
    text::{buffer::Buffer, change::ChangeSet},
};

impl Syntax {
    /// Fast path for single-line edits inside one existing flat single-line list
    /// item (`TA-31`). Parses only the edited line and patches `prev` in place.
    pub(in crate::editor::markdown::core::syntax) fn try_patch_single_list_item_in_place(
        prev: &mut Syntax,
        doc: &Buffer,
        before_doc: &Buffer,
        changes: &ChangeSet,
        features: Features,
    ) -> Option<SyntaxSplice> {
        let (line_idx, old_line_content, new_line_content, ob, nb, byte_delta) =
            single_line_edit_bounds(doc, before_doc, changes)?;
        if has_global_hazards(&before_doc.slice_cow(old_line_content.clone()))
            || has_global_hazards(&doc.slice_cow(new_line_content.clone()))
        {
            return None;
        }
        let item_idx = prev.items.partition_point(|it| it.range.start < ob.start);
        let old_item = prev.items.get(item_idx)?;
        if old_item.quoted
            || !old_item.parents.is_empty()
            || old_item.range.start < old_line_content.start
            || old_item.range.end > old_line_content.end
            || prev
                .items
                .get(item_idx + 1)
                .is_some_and(|next| next.range.start < ob.end)
        {
            return None;
        }
        let list_idx = old_item.list;
        let old_list = prev.lists.get(list_idx)?;
        if old_list.parent.is_some()
            || old_list.range.start > ob.start
            || old_list.range.end < old_item.range.end
        {
            return None;
        }
        let has_overlap = prev
            .lists
            .iter()
            .any(|l| l.parent.is_some() && l.range.start < ob.end && l.range.end > ob.start)
            || prev
                .fences
                .iter()
                .any(|f| f.range.start < ob.end && f.range.end > ob.start)
            || spans_overlap(&prev.code_blocks, &ob)
            || spans_overlap(&prev.tables, &ob)
            || spans_overlap(&prev.html_blocks, &ob)
            || spans_overlap(&prev.marker_html, &ob)
            || link_defs_overlap(&prev.link_defs, &ob)
            || span_straddles(&prev.comment_spans, ob.start)
            || span_straddles(&prev.comment_spans, ob.end)
            || span_straddles(&prev.footnote_spans, ob.start)
            || span_straddles(&prev.footnote_spans, ob.end);
        let el_pre = prev.elements.partition_point(|e| e.range.start < ob.start);
        let el_suf = prev
            .elements
            .partition_point(|e| e.range.start < ob.end)
            .max(el_pre);
        if has_overlap
            || prev.elements[..el_pre]
                .iter()
                .rev()
                .take(8)
                .any(|e| e.range.end > ob.start)
            || prev.elements[el_pre..el_suf].iter().any(|e| {
                e.range.end > ob.end
                    || matches!(
                        e.kind,
                        Kind::FootnoteReference | Kind::FootnoteDefinition | Kind::Comment
                    )
            })
        {
            return None;
        }

        let extra_defs = extra_link_defs_str(prev);
        let win = Self::parse_region(doc, line_idx..line_idx + 1, &extra_defs, features);
        if win.items.len() != 1
            || win.lists.len() != 1
            || !win.fences.is_empty()
            || !win.code_blocks.is_empty()
            || !win.tables.is_empty()
            || !win.html_blocks.is_empty()
            || !win.marker_html.is_empty()
            || !win.link_defs.is_empty()
            || !win.footnotes.is_empty()
            || !win.block_delimiters.is_empty()
            || !win.comment_spans.is_empty()
            || !win.footnote_spans.is_empty()
            || win.elements.iter().any(|e| e.kind == Kind::Blockquote)
        {
            return None;
        }
        let mut new_item = win.items[0].clone();
        if new_item.quoted
            || !new_item.parents.is_empty()
            || new_item.marker != old_item.marker
            || new_item.indent_columns != old_item.indent_columns
            || win.lists[0].ordered != old_list.ordered
            || new_item.range.start < nb.start
            || new_item.range.end > new_line_content.end
        {
            return None;
        }
        let para_pre = prev.paragraphs.partition_point(|p| p.range.end <= ob.start);
        let para_suf = prev
            .paragraphs
            .partition_point(|p| p.range.start < ob.end)
            .max(para_pre);
        if prev.paragraphs[para_pre..para_suf].len() != win.paragraphs.len() {
            return None;
        }
        if let (Some(old_p), Some(new_p)) = (
            prev.paragraphs[para_pre..para_suf].first(),
            win.paragraphs.first(),
        ) && (old_p.item != Some(item_idx) || old_p.direct != new_p.direct)
        {
            return None;
        }
        let bd_pre = prev.block_delimiters.partition_point(|&p| p < ob.start);
        let bd_suf = prev
            .block_delimiters
            .partition_point(|&p| p < ob.end)
            .max(bd_pre);
        if bd_suf > bd_pre {
            return None;
        }

        new_item.list = list_idx;
        prev.items[item_idx] = new_item;
        if byte_delta != 0 {
            shift_items(&mut prev.items[item_idx + 1..], byte_delta, 0, 0);
            prev.lists[list_idx].range.end =
                shift_signed(prev.lists[list_idx].range.end, byte_delta);
            shift_lists(&mut prev.lists[list_idx + 1..], byte_delta, 0);
            for tb in &mut prev.top_blocks {
                if tb.start <= ob.start && ob.start < tb.end {
                    tb.end = shift_signed(tb.end, byte_delta);
                } else if tb.start >= ob.end {
                    *tb = shift_span_signed(tb, byte_delta);
                }
            }
        }
        let win_el_len = win.elements.len();
        prev.elements.splice(el_pre..el_suf, win.elements);
        shift_elements(&mut prev.elements[el_pre + win_el_len..], byte_delta);

        let mut win_paras = win.paragraphs;
        for p in &mut win_paras {
            if p.item.is_some() {
                p.item = Some(item_idx);
            }
        }
        let win_para_len = win_paras.len();
        prev.paragraphs.splice(para_pre..para_suf, win_paras);
        if byte_delta != 0 {
            for m in &mut prev.paragraphs[para_pre + win_para_len..] {
                m.range = shift_span_signed(&m.range, byte_delta);
            }
        }

        splice_highlights_in_place(
            &mut prev.highlights,
            &ob,
            byte_delta,
            win.highlights,
            Some((&old_line_content, &new_line_content, &nb)),
        );
        let it_pre = prev.inline_tags.partition_point(|r| r.end <= ob.start);
        let it_suf = prev
            .inline_tags
            .partition_point(|r| r.start < ob.end)
            .max(it_pre);
        let win_it_len = win.inline_tags.len();
        prev.inline_tags.splice(it_pre..it_suf, win.inline_tags);
        shift_spans(&mut prev.inline_tags[it_pre + win_it_len..], byte_delta);
        shift_after_byte(&mut prev.tables, ob.end, byte_delta);
        shift_after_byte(&mut prev.table_cells, ob.end, byte_delta);
        shift_common_suffix(prev, ob.end, byte_delta, bd_suf);

        Some(SyntaxSplice {
            old_bytes: ob,
            new_bytes: nb,
            old_lines: line_idx..line_idx + 1,
            new_lines: line_idx..line_idx + 1,
            byte_delta,
            line_delta: 0,
            old_had_delimiters: false,
        })
    }

    /// Fast path for single-line edits inside an existing body row (`row >= 2`)
    /// of a top-level GFM table (`TA-31`).
    pub(in crate::editor::markdown::core::syntax) fn try_patch_single_table_row_in_place(
        prev: &mut Syntax,
        doc: &Buffer,
        before_doc: &Buffer,
        changes: &ChangeSet,
        features: Features,
    ) -> Option<SyntaxSplice> {
        let (line_idx, old_line_content, new_line_content, ob, nb, byte_delta) =
            single_line_edit_bounds(doc, before_doc, changes)?;
        let old_line_str = before_doc.slice_cow(old_line_content.clone());
        let new_line_str = doc.slice_cow(new_line_content.clone());
        if old_line_str.trim().is_empty()
            || new_line_str.trim().is_empty()
            || has_global_hazards(&old_line_str)
            || has_global_hazards(&new_line_str)
        {
            return None;
        }
        let table_idx = prev
            .tables
            .partition_point(|t| t.end < old_line_content.start);
        let old_table = prev.tables.get(table_idx)?.clone();
        if old_table.start > old_line_content.start || old_line_content.start > old_table.end {
            return None;
        }
        let tb_idx = prev
            .top_blocks
            .partition_point(|b| b.start < old_table.start);
        let old_tb = prev.top_blocks.get(tb_idx)?;
        if old_tb.start != old_table.start || old_tb.end != old_table.end {
            return None;
        }
        let table_first_line = before_doc.line_index(old_table.start);
        let table_last_line =
            before_doc.line_index(old_table.end.saturating_sub(1).max(old_table.start));
        if line_idx < table_first_line + 2 || line_idx > table_last_line {
            return None;
        }
        let bd_pre = prev.block_delimiters.partition_point(|&p| p < ob.start);
        let bd_suf = prev
            .block_delimiters
            .partition_point(|&p| p < ob.end)
            .max(bd_pre);
        let f_i = prev.fences.partition_point(|f| f.range.end <= ob.start);
        let l_i = prev.lists.partition_point(|l| l.range.end <= ob.start);
        let i_i = prev.items.partition_point(|it| it.range.end <= ob.start);
        if prev.fences.get(f_i).is_some_and(|f| f.range.start < ob.end)
            || prev.lists.get(l_i).is_some_and(|l| l.range.start < ob.end)
            || prev
                .items
                .get(i_i)
                .is_some_and(|it| it.range.start < ob.end)
            || bd_suf > bd_pre
            || spans_overlap(&prev.code_blocks, &ob)
            || spans_overlap(&prev.html_blocks, &ob)
            || spans_overlap(&prev.marker_html, &ob)
            || link_defs_overlap(&prev.link_defs, &ob)
            || span_straddles(&prev.comment_spans, ob.start)
            || span_straddles(&prev.comment_spans, ob.end)
            || span_straddles(&prev.footnote_spans, ob.start)
            || span_straddles(&prev.footnote_spans, ob.end)
            || spans_overlap(&prev.comment_spans, &ob)
            || spans_overlap(&prev.footnote_spans, &ob)
        {
            return None;
        }
        let el_pre = prev.elements.partition_point(|e| e.range.start < ob.start);
        let el_suf = prev
            .elements
            .partition_point(|e| e.range.start < ob.end)
            .max(el_pre);
        if prev.elements[..el_pre]
            .iter()
            .rev()
            .take(8)
            .any(|e| e.range.end > ob.start)
            || prev.elements[el_pre..el_suf].iter().any(|e| {
                e.range.end > ob.end
                    || matches!(
                        e.kind,
                        Kind::FootnoteReference | Kind::FootnoteDefinition | Kind::Comment
                    )
            })
        {
            return None;
        }

        let header_line = doc.line_cow(table_first_line);
        let sep_line = doc.line_cow(table_first_line + 1);
        let mut mini_str =
            String::with_capacity(header_line.len() + sep_line.len() + new_line_str.len() + 3);
        mini_str.push_str(&header_line);
        mini_str.push('\n');
        mini_str.push_str(&sep_line);
        mini_str.push('\n');
        let row_offset = mini_str.len();
        mini_str.push_str(&new_line_str);
        if new_line_content.end < nb.end {
            mini_str.push('\n');
        }
        let mini_buf = Buffer::new(mini_str);
        let extra_defs = extra_link_defs_str(prev);
        let mini = Self::parse_region(&mini_buf, 0..3, &extra_defs, features);

        let expected_mini_start = old_table.start - before_doc.line_range(table_first_line).start;
        let trimmed_row_end = row_offset + new_line_str.trim_end().len();
        if mini.tables.len() != 1
            || mini.tables[0].start != expected_mini_start
            || mini.tables[0].end < trimmed_row_end
            || !mini.lists.is_empty()
            || !mini.items.is_empty()
            || !mini.paragraphs.is_empty()
            || !mini.fences.is_empty()
            || !mini.code_blocks.is_empty()
            || !mini.html_blocks.is_empty()
            || !mini.marker_html.is_empty()
            || !mini.link_defs.is_empty()
            || !mini.footnotes.is_empty()
            || !mini.block_delimiters.is_empty()
            || !mini.comment_spans.is_empty()
            || !mini.footnote_spans.is_empty()
            || mini.elements.iter().any(|e| {
                e.kind == Kind::Blockquote
                    || (e.range.start < row_offset && e.range.end > row_offset)
            })
            || mini
                .table_cells
                .iter()
                .any(|c| c.start < row_offset && c.end > row_offset)
            || mini
                .highlights
                .iter()
                .any(|(r, _)| r.start < row_offset && r.end > row_offset)
            || mini
                .inline_tags
                .iter()
                .any(|r| r.start < row_offset && r.end > row_offset)
        {
            return None;
        }

        let coord_delta = nb.start as isize - row_offset as isize;
        let mut row_elements: Vec<Element> = mini
            .elements
            .into_iter()
            .filter(|e| e.range.start >= row_offset)
            .collect();
        shift_elements(&mut row_elements, coord_delta);
        let header_cells = mini
            .table_cells
            .iter()
            .filter(|c| c.start < row_offset)
            .count();
        let row_cells: Vec<Span> = mini
            .table_cells
            .into_iter()
            .filter(|c| c.start >= row_offset)
            .map(|c| shift_span_signed(&c, coord_delta))
            .collect();
        if row_cells.len() != header_cells {
            return None;
        }
        let tc_pre = prev.table_cells.partition_point(|r| r.end <= ob.start);
        let tc_suf = prev
            .table_cells
            .partition_point(|r| r.start < ob.end)
            .max(tc_pre);
        if tc_suf - tc_pre != header_cells
            || prev.table_cells[tc_pre..tc_suf].iter().any(|c| {
                c.end > old_line_content.end || (c.is_empty() && c.start >= old_line_content.end)
            })
            || prev
                .table_cells
                .get(tc_suf)
                .is_some_and(|c| c.is_empty() && c.start == ob.end)
            || row_cells.iter().any(|c| {
                c.end > new_line_content.end || (c.is_empty() && c.start >= new_line_content.end)
            })
        {
            return None;
        }
        let row_highlights: Vec<(Span, Hl)> = mini
            .highlights
            .into_iter()
            .filter(|(r, c)| r.start >= row_offset && !r.is_empty() && *c != Hl::NONE)
            .map(|(r, c)| (shift_span_signed(&r, coord_delta), c))
            .collect();
        let row_inline_tags: Vec<Span> = mini
            .inline_tags
            .into_iter()
            .filter(|r| r.start >= row_offset)
            .map(|r| shift_span_signed(&r, coord_delta))
            .collect();

        let new_table_end = if line_idx < table_last_line {
            shift_signed(old_table.end, byte_delta)
        } else {
            shift_signed(mini.tables[0].end, coord_delta)
        };
        prev.tables[table_idx].end = new_table_end;
        prev.top_blocks[tb_idx].end = new_table_end;

        let win_el_len = row_elements.len();
        prev.elements.splice(el_pre..el_suf, row_elements);
        shift_elements(&mut prev.elements[el_pre + win_el_len..], byte_delta);

        let win_tc_len = row_cells.len();
        prev.table_cells.splice(tc_pre..tc_suf, row_cells);
        shift_spans(&mut prev.table_cells[tc_pre + win_tc_len..], byte_delta);

        splice_highlights_in_place(&mut prev.highlights, &ob, byte_delta, row_highlights, None);

        let it_pre = prev.inline_tags.partition_point(|r| r.end <= ob.start);
        let it_suf = prev
            .inline_tags
            .partition_point(|r| r.start < ob.end)
            .max(it_pre);
        let win_it_len = row_inline_tags.len();
        prev.inline_tags.splice(it_pre..it_suf, row_inline_tags);
        shift_spans(&mut prev.inline_tags[it_pre + win_it_len..], byte_delta);

        if byte_delta != 0 {
            shift_spans(&mut prev.tables[table_idx + 1..], byte_delta);
            shift_spans(&mut prev.top_blocks[tb_idx + 1..], byte_delta);
            let l_pos = prev.lists.partition_point(|l| l.range.start < ob.end);
            shift_lists(&mut prev.lists[l_pos..], byte_delta, 0);
            let i_pos = prev.items.partition_point(|i| i.range.start < ob.end);
            shift_items(&mut prev.items[i_pos..], byte_delta, 0, 0);
            let p_pos = prev.paragraphs.partition_point(|p| p.range.start < ob.end);
            for p in &mut prev.paragraphs[p_pos..] {
                p.range = shift_span_signed(&p.range, byte_delta);
            }
            shift_common_suffix(prev, ob.end, byte_delta, bd_suf);
        }

        Some(SyntaxSplice {
            old_bytes: ob,
            new_bytes: nb,
            old_lines: line_idx..line_idx + 1,
            new_lines: line_idx..line_idx + 1,
            byte_delta,
            line_delta: 0,
            old_had_delimiters: false,
        })
    }
}
