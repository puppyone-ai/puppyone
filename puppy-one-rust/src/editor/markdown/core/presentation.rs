//! Semantic block boundaries (product `core/presentation/markdownBlockRhythm.ts`).
//! Supports both full-document `block_rhythm` and bounded `block_rhythm_in_lines`
//! so incremental edits and 1-line Reveal Layer patches compute rhythm in
//! `O(|window|)` without allocating `doc.line_count()` entries or flattening
//! `doc.flat` (`TA-01`, `TA-11`, `TA-13`).
use super::{
    classes::Class,
    syntax::{BlockKind, Syntax},
};
use crate::editor::text::buffer::Buffer;
use std::ops::Range;

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

/// Compute `LineRhythm` only for `line_window` (`out.len() == line_window.len()`,
/// indexed by `line - line_window.start`), scanning only paragraphs/lists/items
/// intersecting `line_window` via binary search!
pub fn block_rhythm_in_lines(
    doc: &Buffer,
    syntax: &Syntax,
    line_window: Range<usize>,
    source_line: Option<usize>,
) -> Vec<LineRhythm> {
    let total = doc.line_count();
    let w_start = line_window.start.min(total);
    let w_end = line_window.end.min(total).max(w_start);
    let mut lines = vec![LineRhythm::default(); w_end - w_start];
    if lines.is_empty() {
        return lines;
    }

    let byte_start = doc.line_range(w_start).start;
    let byte_end = doc.line_range(w_end - 1).end;
    let line_of = |offset: usize| doc.line_index(offset);
    let set_class = |lines: &mut [LineRhythm], line: usize, cls: Class| {
        if line >= w_start && line < w_end {
            lines[line - w_start].classes |= cls;
        }
    };

    // 1. Paragraph boundaries intersecting `[byte_start..=byte_end]`.
    let p_first = syntax
        .paragraphs
        .partition_point(|p| p.range.end < byte_start);
    let p_last = syntax
        .paragraphs
        .partition_point(|p| p.range.start <= byte_end)
        .max(p_first);
    for p in &syntax.paragraphs[p_first..p_last] {
        if p.task {
            continue;
        }
        let Some(item) = p.item else {
            set_class(&mut lines, line_of(p.range.start), Class::PARAGRAPH_START);
            set_class(&mut lines, line_of(p.range.end), Class::PARAGRAPH_END);
            continue;
        };
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
            set_class(&mut lines, line_of(p.range.start), Class::PARAGRAPH_START);
        }
        if direct.last() != Some(&p.range.start) {
            set_class(&mut lines, line_of(p.range.end), Class::PARAGRAPH_END);
        }
    }

    // 2. Top-level lists intersecting `[byte_start..=byte_end]`.
    let l_first = syntax.lists.partition_point(|l| l.range.end < byte_start);
    let l_last = syntax
        .lists
        .partition_point(|l| l.range.start <= byte_end)
        .max(l_first);
    for list in &syntax.lists[l_first..l_last] {
        if list.parent.is_none() && !list.quoted {
            set_class(&mut lines, line_of(list.range.start), Class::LIST_START);
            set_class(&mut lines, line_of(list.range.end), Class::LIST_END);
        }
    }

    // 3. Items in tree (pre-)order intersecting `[byte_start..=byte_end]`.
    // Start from the enclosing top-level block so outer parent items are included!
    let block_min = syntax
        .top_blocks
        .partition_point(|b| b.start <= byte_start)
        .checked_sub(1)
        .and_then(|i| syntax.top_blocks.get(i))
        .map_or(byte_start, |b| b.start.min(byte_start));
    let i_first = syntax.items.partition_point(|i| i.range.end < block_min);
    let i_last = syntax
        .items
        .partition_point(|i| i.range.start <= byte_end)
        .max(i_first);
    for item in syntax.items[i_first..i_last].iter().filter(|i| !i.quoted) {
        let item_start_line = line_of(item.range.start);
        let item_end_line = line_of(item.range.end);
        set_class(&mut lines, item_start_line, Class::LIST_ITEM_START);
        set_class(&mut lines, item_end_line, Class::LIST_ITEM_END);
        if item_end_line < w_start || item_start_line >= w_end {
            continue;
        }
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
        let marker_line = item_start_line;
        let mut spans = vec![(marker_line, marker_line)];
        spans.extend(
            item.blocks
                .iter()
                .map(|b| (line_of(b.1.start), line_of(b.1.end))),
        );
        for (first, last) in spans {
            let clamped_first = first.max(w_start);
            let clamped_last = last.min(total.saturating_sub(1)).min(w_end - 1);
            if clamped_first > clamped_last {
                continue;
            }
            for line in clamped_first..=clamped_last {
                let rhythm = &mut lines[line - w_start];
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
                let line_text = doc.line_cow(line);
                let indent = line_text
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

/// Rhythm of every source line. `source_line` is the line kept as source
/// while its block prefix is typed (`composingBlockLine`).
pub fn block_rhythm(doc: &Buffer, syntax: &Syntax, source_line: Option<usize>) -> Vec<LineRhythm> {
    block_rhythm_in_lines(doc, syntax, 0..doc.line_count(), source_line)
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

    // `markdownListEditing.test.ts`: list lines through one structural model.

    /// The rhythm of every line, checked against the bounded computation
    /// (`equivalent(state)`: an incremental window agrees with the whole).
    fn rhythm(text: &str, source_line: Option<usize>) -> (Buffer, Syntax, Vec<LineRhythm>) {
        let doc = Buffer::new(text);
        let syntax = Syntax::parse(&doc);
        let whole = block_rhythm(&doc, &syntax, source_line);
        for (line, expected) in whole.iter().enumerate() {
            assert_eq!(
                &block_rhythm_in_lines(&doc, &syntax, line..line + 1, source_line)[0],
                expected,
                "{text:?} line {line}"
            );
        }
        (doc, syntax, whole)
    }

    /// `types a task without duplicate markers or lost parent geometry`;
    /// `keeps both typed markers visible when the parser recognizes compact
    /// nested lists`; `allows deleting a task prefix character by character
    /// without a hidden checkbox`: while a list prefix is typed or deleted
    /// on a source line the line keeps a list rail, and the finished task is
    /// one item at its parent's depth plus one.
    #[test]
    fn a_typed_or_deleted_task_prefix_keeps_its_list_rail() {
        for initial in ["", "- parent\n  ", "- parent\n    ", "10. parent\n    "] {
            let mut text = initial.to_owned();
            for c in "- [ ] task".chars() {
                text.push(c);
                let last = text.matches('\n').count();
                let (_, _, lines) = rhythm(&text, Some(last));
                assert!(lines[last].list.is_some(), "{text:?}");
            }
            let (_, syntax, lines) = rhythm(&text, None);
            let task = syntax.items.iter().find(|i| i.task.is_some()).unwrap();
            let nested = usize::from(!initial.is_empty());
            assert_eq!(task.parents.len(), nested, "{initial:?}");
            assert!(lines.last().unwrap().classes.has(Class::TASK_LINE));
        }
        let mut text = "- parent\n  ".to_owned();
        for c in "- - [ ] task".chars() {
            text.push(c);
            let (_, _, lines) = rhythm(&text, Some(1));
            assert!(lines[1].list.is_some(), "{text:?}");
        }
        let mut text = "- parent\n    - [ ] task".to_owned();
        for at in (15..19).rev() {
            text.remove(at);
            let (_, syntax, lines) = rhythm(&text, Some(1));
            assert!(lines[1].list.is_some(), "{text:?}");
            assert_eq!(syntax.items.last().unwrap().parents.len(), 1, "{text:?}");
        }
        assert_eq!(text, "- parent\n    - task");
    }

    /// `shares nesting for every list item text block`.
    #[test]
    fn every_nested_item_block_shares_its_depth() {
        for text in [
            "- parent\n    - child",
            "- parent\n    - [ ] task",
            "- parent\n    - # heading",
        ] {
            let (_, _, lines) = rhythm(text, None);
            assert_eq!(lines[1].list.as_ref().unwrap().depth, 1, "{text:?}");
            assert!(lines[1].classes.has(Class::NESTED_LIST_LINE), "{text:?}");
        }
    }

    /// `does not invent list/task semantics in literal content`.
    #[test]
    fn literal_content_has_no_task() {
        for text in [
            "    - [ ] code",
            "- [ ]task",
            "```md\n- [ ] code\n```",
            "text\n2. literal",
        ] {
            let (_, syntax, lines) = rhythm(text, None);
            assert!(syntax.items.iter().all(|i| i.task.is_none()), "{text:?}");
            assert!(
                lines.iter().all(|l| !l.classes.has(Class::TASK_LINE)),
                "{text:?}"
            );
        }
    }

    /// `reprojects the whole item on a task transition`.
    #[test]
    fn a_task_transition_reprojects_the_whole_item() {
        let item = "- root\n  one\n  two\n  three\n  four\n  five\n- last";
        for (text, task) in [
            (item.replacen("- ", "- [ ] ", 1), true),
            (item.to_owned(), false),
        ] {
            let (_, _, lines) = rhythm(&text, None);
            for line in &lines[1..6] {
                assert!(line.classes.has(Class::LIST_CONTINUATION), "{text:?}");
                assert_eq!(line.classes.has(Class::TASK_LINE), task, "{text:?}");
            }
        }
    }
}
