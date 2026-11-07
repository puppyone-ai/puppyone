//! Moving whole blocks (markdownBlockBoundaries.ts, markdownBlockMove.ts),
//! the `enableMarkdownBlockDrag` experiment: a block is a child of the
//! document or a list item with siblings (the innermost such item owns its
//! line, and moves with its descendants but never leaves its list). A move
//! swaps whole blocks and keeps the blank lines between them where they
//! were; an ordered list renumbers from 1. Front matter never moves and
//! nothing moves into it.
use crate::editor::{
    markdown::core::syntax::Syntax,
    text::{
        buffer::Buffer,
        change::{Change, ChangeSet},
        selection::Selection,
        state::{EditorState, Transaction, UserEvent},
    },
};
use std::{
    ops::Range,
    sync::atomic::{AtomicBool, Ordering},
};

static ENABLED: AtomicBool = AtomicBool::new(false);

/// Follow the experiment (preferences apply it).
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}
pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// A movable block and the siblings it moves among.
#[derive(Clone, Debug, PartialEq)]
pub struct Movable {
    pub range: Range<usize>,
    pub group: Vec<Range<usize>>,
    pub index: usize,
    /// List depth of a list item (0 for a document child).
    pub depth: usize,
    /// The ordered list it belongs to (renumbered after a move).
    ordered: Option<Vec<usize>>,
}

/// `getMarkdownBodyStart`: after front matter at the very top.
fn body_start(doc: &Buffer) -> usize {
    if doc.line_count() < 2 || doc.line(0).trim_end() != "---" {
        return 0;
    }
    (1..doc.line_count().min(256))
        .find(|&l| doc.line(l).trim_end() == "---")
        .map_or(0, |l| doc.line_range(l).end + 1)
}

/// `getMarkdownMovableBlockAt`: by line, never by column; a blank line
/// belongs to no block.
pub fn movable_at(doc: &Buffer, syntax: &Syntax, offset: usize) -> Option<Movable> {
    if doc.is_empty() {
        return None;
    }
    let line = doc.line_range(doc.line_index(offset.min(doc.len())));
    let body = body_start(doc);
    if line.start < body {
        return None;
    }
    let content_end = line.start + doc.slice(line.clone()).trim_end().len();
    if content_end == line.start {
        return None;
    }
    let anchor = content_end - 1;
    let mut items: Vec<usize> = (0..syntax.items.len())
        .filter(|&i| syntax.items[i].range.contains(&anchor))
        .collect();
    items.sort_by_key(|&i| std::cmp::Reverse(syntax.items[i].parents.len()));
    for i in items {
        let item = &syntax.items[i];
        let list = &syntax.lists[item.list];
        if list.items.len() < 2 {
            continue;
        }
        let group: Vec<Range<usize>> = list
            .items
            .iter()
            .map(|&k| syntax.items[k].range.clone())
            .collect();
        return Some(Movable {
            range: item.range.clone(),
            index: list.items.iter().position(|&k| k == i)?,
            group,
            depth: item.parents.len() + 1,
            ordered: list.ordered.then(|| list.items.clone()),
        });
    }
    let group: Vec<Range<usize>> = syntax
        .top_blocks
        .iter()
        .filter(|b| b.start >= body && !b.is_empty())
        .cloned()
        .collect();
    let index = group
        .iter()
        .position(|b| b.start <= anchor && anchor < b.end)?;
    (group.len() >= 2).then(|| Movable {
        range: group[index].clone(),
        group,
        index,
        depth: 0,
        ordered: None,
    })
}

/// `isMarkdownBlockMoveNoop`.
pub fn is_noop(index: usize, boundary: usize) -> bool {
    boundary == index || boundary == index + 1
}

/// `buildMarkdownBlockMoveTransaction`: the block before group position
/// `boundary` (0 ..= len). The selection inside the block moves with it.
pub fn move_block(
    state: &EditorState,
    syntax: &Syntax,
    movable: &Movable,
    boundary: usize,
) -> Option<Transaction> {
    let Movable { group, index, .. } = movable;
    let (n, s) = (group.len(), *index);
    if n < 2 || boundary > n || is_noop(s, boundary) {
        return None;
    }
    let doc = state.doc.as_str();
    let text = |i: usize| &doc[group[i].clone()];
    let separator = |i: usize| &doc[group[i].end..group[i + 1].start];
    // The new order, and the separator after each position.
    let mut order: Vec<usize> = (0..n).filter(|&i| i != s).collect();
    let at = if boundary < s { boundary } else { boundary - 1 };
    order.insert(at, s);
    // The separators stay in their slots except the ones the product's two
    // edits carry: up, the block takes the separator before it along and its
    // old slot keeps the one after it; down, the separator after it goes
    // before it and it takes the one that followed its landing place.
    let separators: Vec<&str> = (0..n - 1)
        .map(|k| {
            if boundary < s {
                match k {
                    k if k < boundary => separator(k),
                    k if k == boundary => separator(s - 1),
                    k if k < s => separator(k - 1),
                    k if k == s => separator(s),
                    k => separator(k),
                }
            } else {
                match k {
                    k if k < s => separator(k),
                    k if k + 1 < at => separator(k + 1),
                    k if k + 1 == at => separator(s),
                    k if k == at => separator(boundary - 1),
                    k => separator(k),
                }
            }
        })
        .collect();
    let renumber = movable.ordered.as_ref();
    let mut region = String::new();
    let mut moved_at = 0;
    let mut moved_delta: isize = 0;
    for (k, &i) in order.iter().enumerate() {
        let mut block = text(i).to_owned();
        let mut delta: isize = 0;
        if let Some(items) = renumber {
            let item = &syntax.items[items[i]];
            let at = item.marker_from - item.range.start;
            let digits = item.marker.trim_end_matches(['.', ')']);
            let number = (k + 1).to_string();
            if digits != number && block.get(at..at + digits.len()) == Some(digits) {
                block.replace_range(at..at + digits.len(), &number);
                delta = number.len() as isize - digits.len() as isize;
            }
        }
        if i == s {
            moved_at = region.len();
            moved_delta = delta;
        }
        region.push_str(&block);
        if k + 1 < n {
            region.push_str(separators[k]);
        }
    }
    let span = group[0].start..group[n - 1].end;
    let source = &group[s];
    let new_from = span.start + moved_at;
    let sel = state.selection;
    let inside = |p: usize| source.start <= p && p <= source.end;
    let map = |p: usize| {
        if inside(p) {
            let offset = p - source.start;
            let shift = if offset > 0 { moved_delta } else { 0 };
            (new_from as isize + offset as isize + shift).max(0) as usize
        } else if p >= span.end {
            (p as isize + region.len() as isize - span.len() as isize) as usize
        } else if p <= span.start {
            p
        } else {
            new_from
        }
    };
    let selection = Selection {
        anchor: map(sel.anchor),
        head: map(sel.head),
        ..sel
    };
    let changes = ChangeSet::new(vec![Change {
        range: span,
        insert: region,
    }]);
    Some(Transaction::edit(
        changes,
        Some(selection),
        UserEvent::Command,
    ))
}

/// `moveMarkdownBlock`: the block holding the caret one place up or down;
/// `None` where it cannot move (the key keeps its usual meaning).
pub fn move_by_keyboard(state: &EditorState, syntax: &Syntax, up: bool) -> Option<Transaction> {
    if !enabled() {
        return None;
    }
    let movable = movable_at(&state.doc, syntax, state.selection.head)?;
    let boundary = if up {
        movable.index.checked_sub(1)?
    } else {
        movable.index + 2
    };
    move_block(state, syntax, &movable, boundary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn moved(text: &str, caret: usize, up: bool) -> Option<String> {
        let mut state = EditorState::new(text);
        state.selection = Selection::cursor(caret);
        let syntax = Syntax::parse(&state.doc);
        let movable = movable_at(&state.doc, &syntax, caret)?;
        let boundary = if up {
            movable.index.checked_sub(1)?
        } else {
            movable.index + 2
        };
        let tr = move_block(&state, &syntax, &movable, boundary)?;
        state.apply(tr);
        Some(state.doc.as_str().to_owned())
    }

    #[test]
    fn blocks_swap_and_keep_their_gaps() {
        assert_eq!(
            moved("# A\n\npara\n\n\nlast\n", 6, true).as_deref(),
            Some("para\n\n# A\n\n\nlast\n")
        );
        assert_eq!(
            moved("# A\n\npara\n\n\nlast\n", 0, false).as_deref(),
            Some("para\n\n# A\n\n\nlast\n")
        );
        assert_eq!(moved("one\n\ntwo\n", 0, true), None);
        // A list item moves among its siblings; ordered lists renumber.
        assert_eq!(
            moved("- a\n- b\n- c\n", 4, false).as_deref(),
            Some("- a\n- c\n- b\n")
        );
        assert_eq!(
            moved("1. a\n2. b\n", 5, true).as_deref(),
            Some("1. b\n2. a\n")
        );
        // Front matter stays put.
        assert_eq!(moved("---\nt: x\n---\nbody\n\nend\n", 13, true), None);
    }
}
