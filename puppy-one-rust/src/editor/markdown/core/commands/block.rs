//! Block commands (core/commands/markdownBlockCommands.ts): list
//! continuation and indentation over the parsed item structure, heading
//! level, list and quote toggles.
use super::{change, edit, handled, selected_lines};
use crate::editor::{
    markdown::core::syntax::{ListItem, Syntax},
    text::{
        change::Change,
        selection::Selection,
        state::{EditorState, Transaction, UserEvent},
    },
};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListKind {
    Bullet,
    Ordered,
    Task,
}

/// CodeMirror `countColumn` with tab size 4.
fn columns(text: &str) -> usize {
    text.chars()
        .fold(0, |n, c| if c == '\t' { n + 4 - n % 4 } else { n + 1 })
}

fn leading(text: &str) -> usize {
    text.bytes()
        .take_while(|b| *b == b' ' || *b == b'\t')
        .count()
}

/// `setMarkdownHeadingLevel`: replace each selected line's `#` prefix.
pub fn set_heading(state: &EditorState, level: u8) -> Option<Transaction> {
    let doc = &state.doc;
    let marker = if level > 0 {
        format!("{} ", "#".repeat(level as usize))
    } else {
        String::new()
    };
    let mut changes = Vec::new();
    for line in selected_lines(state) {
        let range = doc.line_range(line);
        let text = doc.line(line);
        let hashes = text.bytes().take_while(|b| *b == b'#').count();
        let existing = if (1..=6).contains(&hashes)
            && text[hashes..]
                .chars()
                .next()
                .is_none_or(char::is_whitespace)
        {
            hashes + text[hashes..].chars().next().map_or(0, char::len_utf8)
        } else {
            0
        };
        if text[..existing] == *marker {
            continue;
        }
        changes.push(change(range.start..range.start + existing, marker.clone()));
    }
    if changes.is_empty() {
        return handled(state);
    }
    edit(changes, None, UserEvent::Command)
}

/// `toggleMarkdownList`: every selected line becomes an item of `kind`, or
/// stops being one when all already are.
pub fn toggle_list(state: &EditorState, syntax: &Syntax, kind: ListKind) -> Option<Transaction> {
    let doc = &state.doc;
    let lines: Vec<usize> = selected_lines(state).collect();
    let items: Vec<Option<&ListItem>> = lines
        .iter()
        .map(|&line| {
            let start = doc.line_range(line).start;
            syntax
                .item_at(doc, start)
                .map(|i| &syntax.items[i])
                .filter(|i| !i.quoted && doc.line_index(i.marker_from) == line)
        })
        .collect();
    let matching = items.iter().all(|item| {
        item.is_some_and(|i| match kind {
            ListKind::Task => i.task.is_some(),
            ListKind::Ordered => i.task.is_none() && syntax.lists[i.list].ordered,
            ListKind::Bullet => i.task.is_none() && !syntax.lists[i.list].ordered,
        })
    });
    let mut changes = Vec::new();
    for (index, (&line, item)) in lines.iter().zip(&items).enumerate() {
        let range = doc.line_range(line);
        let from = item.map_or(range.start + leading(doc.line(line)), |i| i.marker_from);
        let to = item.map_or(from, |i| i.content_from);
        let marker = if matching {
            String::new()
        } else {
            match kind {
                ListKind::Ordered => format!("{}. ", index + 1),
                ListKind::Task => "- [ ] ".into(),
                ListKind::Bullet => "- ".into(),
            }
        };
        changes.push(change(from..to, marker));
    }
    edit(changes, None, UserEvent::Command)
}

/// `toggleMarkdownQuote`.
pub fn toggle_quote(state: &EditorState) -> Option<Transaction> {
    let doc = &state.doc;
    let lines: Vec<usize> = selected_lines(state).collect();
    let quoted = |text: &str| text.trim_start().starts_with('>');
    let all = lines.iter().all(|&l| quoted(doc.line(l)));
    let mut changes = Vec::new();
    for &line in &lines {
        let range = doc.line_range(line);
        let text = doc.line(line);
        let lead = text.len() - text.trim_start().len();
        if all {
            let rest = &text[lead + 1..];
            let space = rest
                .chars()
                .next()
                .filter(|c| c.is_whitespace())
                .map_or(0, char::len_utf8);
            changes.push(change(
                range.start + lead..range.start + lead + 1 + space,
                "",
            ));
        } else {
            changes.push(change(range.start + lead..range.start + lead, "> "));
        }
    }
    edit(changes, None, UserEvent::Command)
}

/// `continueMarkdownListItem`: Enter continues the same parsed item.
pub fn continue_list_item(
    state: &EditorState,
    syntax: &Syntax,
    index: usize,
) -> Option<Transaction> {
    let doc = &state.doc;
    let item = &syntax.items[index];
    let caret = state.selection.head;
    let line = doc.line_range(doc.line_index(caret));
    let first = doc.line_index(item.marker_from) == doc.line_index(caret);
    if first && caret < item.content_from {
        return None;
    }
    if first
        && caret == line.end
        && doc
            .slice(item.content_from.min(line.end)..line.end)
            .trim()
            .is_empty()
    {
        // An empty item ends the list (or leaves its parent).
        if !item.parents.is_empty() {
            return indent(state, syntax, -1);
        }
        return edit(
            vec![change(line.start..item.content_from, "")],
            Some(Selection::cursor(line.start)),
            UserEvent::Input,
        );
    }
    let list = &syntax.lists[item.list];
    let ordered = list.ordered;
    let number: usize = item
        .marker
        .trim_end_matches(['.', ')'])
        .parse()
        .unwrap_or(0);
    let marker = if ordered {
        format!(
            "{}{}",
            number + 1,
            item.marker.chars().last().unwrap_or('.')
        )
    } else {
        item.marker.clone()
    };
    let prefix = if first {
        format!(
            "{}{} {}",
            doc.slice(line.start..item.marker_from),
            marker,
            if item.task.is_some() { "[ ] " } else { "" }
        )
    } else {
        " ".repeat(item.content_column)
    };
    let mut changes: Vec<Change> = vec![change(caret..caret, format!("\n{prefix}"))];
    // Continue a sequential ordered list, preserving deliberate numbering.
    if first && ordered {
        let mut expected = number + 1;
        let position = list.items.iter().position(|&i| i == index).unwrap_or(0);
        for &sibling in &list.items[position + 1..] {
            let s = &syntax.items[sibling];
            let digits = s.marker.trim_end_matches(['.', ')']);
            if digits.parse::<usize>().ok() != Some(expected) {
                break;
            }
            expected += 1;
            changes.push(change(
                s.marker_from..s.marker_from + digits.len(),
                expected.to_string(),
            ));
        }
    }
    edit(
        changes,
        Some(Selection::cursor(caret + 1 + prefix.len())),
        UserEvent::Input,
    )
}

/// CodeMirror's `insertNewlineContinueMarkup` for quotes: continue the quote
/// prefix, or end the quote on an empty quoted line.
pub fn continue_quote(state: &EditorState) -> Option<Transaction> {
    let doc = &state.doc;
    let caret = state.selection.head;
    let line = doc.line_range(doc.line_index(caret));
    let text = doc.line(doc.line_index(caret));
    let lead = text.len() - text.trim_start().len();
    if !text[lead..].starts_with('>') {
        return None;
    }
    let quotes = text[lead..]
        .bytes()
        .take_while(|b| *b == b'>' || *b == b' ')
        .count();
    let prefix_end = lead + quotes;
    if caret < line.start + prefix_end {
        return None;
    }
    if text[prefix_end..].trim().is_empty() && caret == line.end {
        return edit(
            vec![change(line.start..line.end, "")],
            Some(Selection::cursor(line.start)),
            UserEvent::Input,
        );
    }
    let mut prefix = text[..prefix_end].to_string();
    if !prefix.ends_with(' ') {
        prefix.push(' ');
    }
    edit(
        vec![change(caret..caret, format!("\n{prefix}"))],
        Some(Selection::cursor(caret + 1 + prefix.len())),
        UserEvent::Input,
    )
}

/// `adjustMarkdownListIndent`: move whole items (with their wrapped lines
/// and descendants) under the previous sibling or out to the parent.
pub fn indent(state: &EditorState, syntax: &Syntax, direction: i32) -> Option<Transaction> {
    let doc = &state.doc;
    let mut selected: BTreeMap<usize, usize> = BTreeMap::new();
    for line in selected_lines(state) {
        if let Some(i) = syntax
            .item_at(doc, doc.line_range(line).start)
            .filter(|&i| !syntax.items[i].quoted)
        {
            selected.insert(syntax.items[i].range.start, i);
        }
    }
    if selected.is_empty() {
        return None;
    }
    let starts: Vec<usize> = selected.keys().copied().collect();
    let items: Vec<usize> = selected
        .values()
        .copied()
        .filter(|&i| {
            !syntax.items[i]
                .parents
                .iter()
                .any(|p| starts.contains(&syntax.items[*p].range.start))
        })
        .collect();
    let mut changes = Vec::new();
    for index in items {
        let item = &syntax.items[index];
        let target = if direction < 0 {
            let Some(&parent) = item.parents.last() else {
                continue;
            };
            syntax.items[parent].indent_columns
        } else {
            let list = &syntax.lists[item.list];
            let position = list.items.iter().position(|&i| i == index).unwrap_or(0);
            let previous = list.items[..position]
                .iter()
                .rev()
                .find(|&&i| !starts.contains(&syntax.items[i].range.start));
            let Some(&previous) = previous else { continue };
            syntax.items[previous].content_column
        };
        let delta = target as isize - item.indent_columns as isize;
        if delta == 0 {
            continue;
        }
        for line in doc.line_index(item.range.start)..=doc.line_index(item.range.end) {
            let text = doc.line(line);
            if text.trim().is_empty() {
                continue;
            }
            let ws = leading(text);
            let range = doc.line_range(line);
            let width = (columns(&text[..ws]) as isize + delta).max(0) as usize;
            changes.push(change(range.start..range.start + ws, " ".repeat(width)));
        }
    }
    if changes.is_empty() {
        return handled(state);
    }
    edit(changes, None, UserEvent::Input)
}
