//! Semantic block boundaries (product core/presentation/markdownBlockRhythm.ts).
//! Only classes and list facts come from here; every spacing value belongs to
//! the theme and is applied by the stylesheet.
use super::{
    classes::Class,
    syntax::{BlockKind, Syntax},
};
use crate::editor::text::buffer::Buffer;

/// The list facts a list line projects (`MarkdownLineRhythm.list`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ListRhythm {
    pub depth: usize,
    /// Visible marker (`•` or the source number); empty on continuation lines.
    pub marker: String,
    /// Widest ordered marker of this item's list (0 for bullets).
    pub columns: usize,
    /// The same for each ancestor item's list, outermost first.
    pub parent_columns: Vec<usize>,
    /// End of the hidden source prefix.
    pub prefix_to: usize,
    /// End of the indentation before the literal marker.
    pub source_indent_to: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LineRhythm {
    pub classes: Class,
    pub list: Option<ListRhythm>,
}

/// Rhythm of every source line. `source_line` is the line kept as source
/// while its block prefix is typed (composingBlockLine).
pub fn block_rhythm(doc: &Buffer, syntax: &Syntax, source_line: Option<usize>) -> Vec<LineRhythm> {
    let mut lines = vec![LineRhythm::default(); doc.line_count()];
    let line_of = |offset: usize| doc.line_index(offset);
    // Paragraph boundaries (addParagraphRhythm).
    for p in &syntax.paragraphs {
        if p.task {
            continue;
        }
        let Some(item) = p.item else {
            lines[line_of(p.range.start)].classes |= Class::PARAGRAPH_START;
            lines[line_of(p.range.end)].classes |= Class::PARAGRAPH_END;
            continue;
        };
        // Quoted lists retain source markers through their own adapter.
        if p.item_quoted {
            continue;
        }
        let direct: Vec<usize> = syntax.items[item]
            .blocks
            .iter()
            .filter(|b| b.0 == BlockKind::Paragraph)
            .map(|b| b.1.start)
            .collect();
        if direct.first() != Some(&p.range.start) {
            lines[line_of(p.range.start)].classes |= Class::PARAGRAPH_START;
        }
        if direct.last() != Some(&p.range.start) {
            lines[line_of(p.range.end)].classes |= Class::PARAGRAPH_END;
        }
    }
    // Top-level lists.
    for list in &syntax.lists {
        if list.parent.is_none() && !list.quoted {
            lines[line_of(list.range.start)].classes |= Class::LIST_START;
            lines[line_of(list.range.end)].classes |= Class::LIST_END;
        }
    }
    // Items in tree (pre-)order, so nested items project last.
    for item in syntax.items.iter().filter(|i| !i.quoted) {
        lines[line_of(item.range.start)].classes |= Class::LIST_ITEM_START;
        lines[line_of(item.range.end)].classes |= Class::LIST_ITEM_END;
        let list = &syntax.lists[item.list];
        let columns = if list.ordered { list.columns } else { 0 };
        let parent_columns: Vec<usize> = item
            .parents
            .iter()
            .map(|&p| {
                let l = &syntax.lists[syntax.items[p].list];
                if l.ordered { l.columns } else { 0 }
            })
            .collect();
        let depth = parent_columns.len();
        let marker_line = line_of(item.range.start);
        // The item owns its marker line and every direct text block.
        let mut spans = vec![(marker_line, marker_line)];
        spans.extend(
            item.blocks
                .iter()
                .map(|b| (line_of(b.1.start), line_of(b.1.end))),
        );
        for (first, last) in spans {
            let end = last.min(doc.line_count() - 1);
            for (line, rhythm) in lines.iter_mut().enumerate().take(end + 1).skip(first) {
                // `- - text`: editing exposes both literal markers.
                if Some(line) == source_line && rhythm.list.is_some() {
                    continue;
                }
                let start = line == marker_line;
                let mut classes = Class::LIST_LINE;
                if list.ordered {
                    classes |= Class::ORDERED_LIST_LINE;
                }
                if depth > 0 {
                    classes |= Class::NESTED_LIST_LINE;
                }
                if !start {
                    classes |= Class::LIST_CONTINUATION;
                }
                if let Some(task) = &item.task {
                    classes |= Class::TASK_LINE;
                    if task.checked {
                        classes |= Class::TASK_CHECKED;
                    }
                }
                let range = doc.line_range(line);
                let indent = doc
                    .line(line)
                    .bytes()
                    .take_while(|b| *b == b' ' || *b == b'\t')
                    .count();
                let source_indent_to = if start {
                    item.marker_from
                } else {
                    range.start + indent
                };
                let marker = if item.marker.starts_with(|c: char| c.is_ascii_digit()) {
                    item.marker.clone()
                } else {
                    "•".to_owned()
                };
                rhythm.classes |= classes;
                rhythm.list = Some(ListRhythm {
                    depth,
                    marker: if start { marker } else { String::new() },
                    columns,
                    parent_columns: parent_columns.clone(),
                    prefix_to: if start {
                        item.content_from
                    } else {
                        source_indent_to
                    },
                    source_indent_to,
                });
            }
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_rhythm_matches_the_product_line_classes() {
        let doc = Buffer::new(include_str!("../../../../fixtures/editor/sample.md"));
        let syntax = Syntax::parse(&doc);
        let r = block_rhythm(&doc, &syntax, None);
        let has = |line: usize, c: Class| r[line].classes.has(c);
        // Probe (artifacts/probe/sample-dark.json): line 2 is the paragraph.
        assert!(has(2, Class::PARAGRAPH_START | Class::PARAGRAPH_END));
        assert!(has(
            6,
            Class::LIST_START | Class::LIST_ITEM_START | Class::LIST_ITEM_END | Class::LIST_LINE
        ));
        assert!(has(7, Class::LIST_ITEM_START) && !has(7, Class::LIST_ITEM_END));
        assert!(has(
            8,
            Class::LIST_END | Class::LIST_ITEM_END | Class::NESTED_LIST_LINE
        ));
        assert_eq!(r[8].list.as_ref().unwrap().depth, 1);
        assert!(has(10, Class::ORDERED_LIST_LINE));
        assert_eq!(r[10].list.as_ref().unwrap().marker, "1.");
        assert_eq!(r[10].list.as_ref().unwrap().columns, 2);
        assert!(has(14, Class::TASK_LINE | Class::TASK_CHECKED));
        assert!(!has(13, Class::TASK_CHECKED) && !has(13, Class::PARAGRAPH_START));
        assert!(has(18, Class::PARAGRAPH_START | Class::PARAGRAPH_END));
        assert_eq!(
            r[6].list.as_ref().unwrap().prefix_to,
            doc.line_range(6).start + 2
        );
    }
}
