//! List, list-item, and GFM task-marker walking helpers for `core/syntax/tree.rs`.
use super::{
    BlockKind, Element, Hl, Kind, ListItem, Span, TaskLine,
    tree::{HlNode, Walker, blank_run, columns, line_end, line_start},
};

impl Walker<'_> {
    pub(super) fn list_item(&self, range: Span, list: usize) -> ListItem {
        let doc = self.doc;
        let bytes = doc.as_bytes();
        let line_from = line_start(doc, range.start);
        let line_to = line_end(doc, range.start);
        let mut at = range.start;
        while at < line_to && matches!(bytes[at], b' ' | b'\t' | b'>') {
            at += 1;
        }
        let digits = bytes[at..line_to]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count();
        let marker_len = if digits > 0 && matches!(bytes.get(at + digits), Some(b'.' | b')')) {
            digits + 1
        } else {
            1
        };
        let mark_to = (at + marker_len).min(line_to);
        let marker_to = mark_to + blank_run(doc, mark_to).min(line_to - mark_to);
        let parents = self.items();
        let quoted = self.quoted();
        let marker_end_column = columns(&doc[line_from..mark_to]);
        let after_column = columns(&doc[line_from..marker_to]);
        let padding = after_column - marker_end_column;
        ListItem {
            range,
            list,
            parents,
            quoted,
            marker: doc[at..mark_to].to_owned(),
            marker_from: at,
            marker_to,
            content_from: marker_to,
            task: None,
            blocks: Vec::new(),
            indent_columns: columns(&doc[line_from..at]),
            content_column: marker_end_column
                + if (1..=4).contains(&padding) {
                    padding
                } else {
                    1
                },
        }
    }

    pub(super) fn task_marker(&mut self, range: Span, checked: bool) {
        let doc = self.doc;
        let Some(&item_index) = self.items().last() else {
            return;
        };
        let depth = self.syntax.items[item_index].parents.len();
        let line_from = line_start(doc, range.start);
        let line_to = line_end(doc, range.start);
        let content_from = range.end + blank_run(doc, range.end).min(line_to - range.end);
        let item = &mut self.syntax.items[item_index];
        item.content_from = content_from;
        item.task = Some(TaskLine {
            line: line_from..line_to,
            depth,
            checked,
            checkbox: range.clone(),
            prefix_to: content_from,
        });
        if let Some(first) = item.blocks.first_mut() {
            first.0 = BlockKind::Task;
            first.1.start = first.1.start.min(range.start);
        } else {
            item.blocks.push((BlockKind::Task, range.start..line_to));
        }
        let start = range.start;
        if let Some(p) = self
            .syntax
            .paragraphs
            .iter_mut()
            .find(|p| p.item == Some(item_index) && p.direct)
        {
            p.task = true;
            p.range.start = p.range.start.min(start);
        }
        let mut node = HlNode::new(range.start..line_to, Hl::LIST, false);
        node.children.push(HlNode::leaf(range, Hl::NONE));
        self.attach(node);
    }
}

/// createListElement: tasks own two markers (indent + list marker, checkbox).
pub(super) fn list_element(doc: &str, item: &ListItem) -> Option<Element> {
    if item.quoted {
        return None;
    }
    let line = line_start(doc, item.marker_from)..line_end(doc, item.marker_from);
    let mut e = match &item.task {
        Some(task) => {
            let mut e = Element::new(
                Kind::Task,
                item.range.clone(),
                vec![
                    line.start..task.checkbox.start,
                    task.checkbox.start..task.prefix_to,
                ],
                Some(task.prefix_to..item.range.end.max(task.prefix_to)),
            );
            e.checked = task.checked;
            e
        }
        None => Element::new(
            Kind::List,
            item.range.clone(),
            vec![line.start..item.marker_to],
            Some(item.marker_to..item.range.end.max(item.marker_to)),
        ),
    };
    e.line = Some(line);
    Some(e)
}
