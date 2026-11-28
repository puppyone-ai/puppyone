//! GFM table walking helpers for `core/syntax/tree.rs`.
use super::{
    Hl, Span,
    tree::{Frame, HlNode, Walker, line_end, trim},
};

impl Walker<'_> {
    pub(super) fn start_table(&mut self, range: Span) {
        let doc = self.doc;
        let range = trim(doc, range);
        self.syntax.tables.push(range.clone());
        let mut node = HlNode::new(range.clone(), Hl::NONE, false);
        let mut at = range.start;
        let mut row = 0;
        while at < range.end {
            let end = line_end(doc, at).min(range.end);
            if row == 1 {
                node.children.push(HlNode::leaf(at..end, Hl::MARKUP));
            } else if row > 1 {
                for (i, _) in doc[at..end].match_indices('|') {
                    if !super::super::links::is_escaped(doc.as_bytes(), at + i) {
                        node.children
                            .push(HlNode::leaf(at + i..at + i + 1, Hl::MARKUP));
                    }
                }
            }
            row += 1;
            at = end + 1;
        }
        self.push(Frame::Table, node);
    }

    pub(super) fn start_table_head(&mut self, range: Span) {
        let doc = self.doc;
        let range = trim(doc, range);
        let mut node = HlNode::new(range.clone(), Hl::HEADING, true);
        for (i, _) in doc[range.clone()].match_indices('|') {
            node.children.push(HlNode::leaf(
                range.start + i..range.start + i + 1,
                Hl::MARKUP,
            ));
        }
        self.push(Frame::TableHead, node);
    }

    pub(super) fn start_table_cell(&mut self, range: Span) {
        self.syntax.table_cells.push(trim(self.doc, range.clone()));
        self.push(Frame::Other, HlNode::new(range, Hl::NONE, false));
    }
}
