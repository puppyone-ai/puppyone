//! Deferred suffix-tail detachment and shifted re-attachment (`TA-81`).
use super::{
    shift_elements, shift_fences, shift_items, shift_lists, shift_signed, shift_span_signed,
    shift_spans,
};
use crate::editor::markdown::core::syntax::{Footnotes, Syntax, fence_straddles, span_straddles};

impl Syntax {
    /// Split off the untouched suffix strictly at/after `(split_byte, split_line)`
    /// into a detached tail so repeated edits inside the prefix avoid shifting
    /// tens of thousands of downstream elements and highlights (`TA-81`).
    pub fn split_off_tail(&mut self, split_byte: usize, split_line: usize) -> Option<Syntax> {
        if !self.link_defs.is_empty()
            || !self.footnotes.is_empty()
            || !self.block_delimiters.is_empty()
            || fence_straddles(&self.fences, split_byte)
            || span_straddles(&self.html_blocks, split_byte)
            || span_straddles(&self.comment_spans, split_byte)
            || span_straddles(&self.footnote_spans, split_byte)
        {
            return None;
        }
        let tb_idx = self.top_blocks.partition_point(|b| b.start < split_byte);
        if tb_idx == 0 || tb_idx >= self.top_blocks.len() {
            return None;
        }
        let prev_tb = &self.top_blocks[tb_idx - 1];
        if prev_tb.end > split_byte {
            return None;
        }
        let prev_tb_start = prev_tb.start;

        let el_idx = self
            .elements
            .partition_point(|e| e.range.start < split_byte);
        let el_check = self
            .elements
            .partition_point(|e| e.range.start < prev_tb_start);
        if self.elements[el_check..el_idx]
            .iter()
            .any(|e| e.range.end > split_byte)
        {
            return None;
        }
        let list_idx = self.lists.partition_point(|l| l.range.start < split_byte);
        let item_idx = self.items.partition_point(|i| i.range.start < split_byte);
        let list_check = self
            .lists
            .partition_point(|l| l.range.start < prev_tb_start);
        let item_check = self
            .items
            .partition_point(|i| i.range.start < prev_tb_start);
        if self.lists[list_check..list_idx]
            .iter()
            .any(|l| l.range.end > split_byte)
            || self.items[item_check..item_idx]
                .iter()
                .any(|i| i.range.end > split_byte)
        {
            return None;
        }
        let para_idx = self
            .paragraphs
            .partition_point(|p| p.range.start < split_byte);
        let f_idx = self.fences.partition_point(|f| f.range.start < split_byte);
        let cl_idx = self.code_lines.partition_point(|r| r.start < split_line);
        let hl_idx = self
            .highlights
            .partition_point(|(r, _)| r.start < split_byte);
        let cb_idx = self.code_blocks.partition_point(|r| r.start < split_byte);
        let tbl_idx = self.tables.partition_point(|r| r.start < split_byte);
        let tc_idx = self.table_cells.partition_point(|r| r.start < split_byte);
        let nd_idx = self.note_definitions.partition_point(|&p| p < split_byte);
        let it_idx = self.inline_tags.partition_point(|r| r.start < split_byte);
        if (para_idx > 0 && self.paragraphs[para_idx - 1].range.end > split_byte)
            || (f_idx > 0 && self.fences[f_idx - 1].lines.end > split_line)
            || (cl_idx > 0 && self.code_lines[cl_idx - 1].end > split_line)
            || (hl_idx > 0 && self.highlights[hl_idx - 1].0.end > split_byte)
            || (cb_idx > 0 && self.code_blocks[cb_idx - 1].end > split_byte)
            || (tbl_idx > 0 && self.tables[tbl_idx - 1].end > split_byte)
            || (tc_idx > 0 && self.table_cells[tc_idx - 1].end > split_byte)
            || (it_idx > 0 && self.inline_tags[it_idx - 1].end > split_byte)
        {
            return None;
        }
        let hb_idx = self.html_blocks.partition_point(|r| r.start < split_byte);
        let cs_idx = self.comment_spans.partition_point(|r| r.start < split_byte);
        let fs_idx = self
            .footnote_spans
            .partition_point(|r| r.start < split_byte);

        Some(Syntax {
            elements: self.elements.split_off(el_idx),
            items: self.items.split_off(item_idx),
            lists: self.lists.split_off(list_idx),
            paragraphs: self.paragraphs.split_off(para_idx),
            fences: self.fences.split_off(f_idx),
            code_blocks: self.code_blocks.split_off(cb_idx),
            code_lines: self.code_lines.split_off(cl_idx),
            highlights: self.highlights.split_off(hl_idx),
            tables: self.tables.split_off(tbl_idx),
            table_cells: self.table_cells.split_off(tc_idx),
            note_definitions: self.note_definitions.split_off(nd_idx),
            inline_tags: self.inline_tags.split_off(it_idx),
            html_blocks: self.html_blocks.split_off(hb_idx),
            top_blocks: self.top_blocks.split_off(tb_idx),
            footnotes: Footnotes::default(),
            link_defs: Vec::new(),
            block_delimiters: Vec::new(),
            comment_spans: self.comment_spans.split_off(cs_idx),
            footnote_spans: self.footnote_spans.split_off(fs_idx),
        })
    }

    /// Re-attach a previously detached suffix tail after shifting all byte,
    /// line, list, and item coordinates by their accumulated deltas (`TA-81`).
    pub fn append_shifted_tail(
        &mut self,
        mut tail: Syntax,
        bd: isize,
        ld: isize,
        list_delta: isize,
        item_delta: isize,
    ) {
        shift_elements(&mut tail.elements, bd);
        self.elements.append(&mut tail.elements);
        shift_lists(&mut tail.lists, bd, item_delta);
        self.lists.append(&mut tail.lists);
        shift_items(&mut tail.items, bd, list_delta, item_delta);
        self.items.append(&mut tail.items);
        if bd != 0 || item_delta != 0 {
            for m in &mut tail.paragraphs {
                m.range = shift_span_signed(&m.range, bd);
                if let Some(it) = &mut m.item {
                    *it = shift_signed(*it, item_delta);
                }
            }
        }
        self.paragraphs.append(&mut tail.paragraphs);
        shift_fences(&mut tail.fences, bd, ld);
        self.fences.append(&mut tail.fences);
        shift_spans(&mut tail.code_lines, ld);
        self.code_lines.append(&mut tail.code_lines);
        if bd != 0 {
            for (r, _) in &mut tail.highlights {
                *r = shift_span_signed(r, bd);
            }
            for vec in [
                &mut tail.code_blocks,
                &mut tail.tables,
                &mut tail.table_cells,
                &mut tail.inline_tags,
                &mut tail.html_blocks,
                &mut tail.top_blocks,
                &mut tail.comment_spans,
                &mut tail.footnote_spans,
            ] {
                shift_spans(vec, bd);
            }
            for p in &mut tail.note_definitions {
                *p = shift_signed(*p, bd);
            }
        }
        if let (Some(last), Some(first)) = (self.highlights.last_mut(), tail.highlights.first())
            && last.1 == first.1
            && last.0.end == first.0.start
        {
            last.0.end = first.0.end;
            self.highlights.extend(tail.highlights.into_iter().skip(1));
        } else {
            self.highlights.append(&mut tail.highlights);
        }
        self.code_blocks.append(&mut tail.code_blocks);
        self.tables.append(&mut tail.tables);
        self.table_cells.append(&mut tail.table_cells);
        self.inline_tags.append(&mut tail.inline_tags);
        self.html_blocks.append(&mut tail.html_blocks);
        self.top_blocks.append(&mut tail.top_blocks);
        self.comment_spans.append(&mut tail.comment_spans);
        self.footnote_spans.append(&mut tail.footnote_spans);
        self.note_definitions.append(&mut tail.note_definitions);
    }
}
