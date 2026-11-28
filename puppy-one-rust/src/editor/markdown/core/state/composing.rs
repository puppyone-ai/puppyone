//! Composing block-prefix line tracking
//! (product `core/state/composingBlockLine.ts`).
use crate::editor::text::{
    change::{Assoc, ChangeSet},
    state::{Applied, EditorState, UserEvent},
};
use std::ops::Range;

/// `getMarkdownListInputPrefix`:
/// `/^[\t ]*(?:[-*+]|\d{1,9}[.)])(?:[\t ]+(?:\[(?:[ xX](?:\][\t ]*)?)?)?|$)/`.
pub fn list_input_prefix(text: &str) -> Option<usize> {
    let b = text.as_bytes();
    let mut i = b.iter().take_while(|c| matches!(c, b' ' | b'\t')).count();
    match b.get(i) {
        Some(b'-' | b'*' | b'+') => i += 1,
        Some(c) if c.is_ascii_digit() => {
            let digits = b[i..].iter().take_while(|c| c.is_ascii_digit()).count();
            if digits > 9 || !matches!(b.get(i + digits), Some(b'.' | b')')) {
                return None;
            }
            i += digits + 1;
        }
        _ => return None,
    }
    if i == b.len() {
        return Some(i);
    }
    let spaces = b[i..]
        .iter()
        .take_while(|c| matches!(c, b' ' | b'\t'))
        .count();
    if spaces == 0 {
        return None;
    }
    i += spaces;
    if b.get(i) == Some(&b'[') {
        i += 1;
        if matches!(b.get(i), Some(b' ' | b'x' | b'X')) {
            i += 1;
            if b.get(i) == Some(&b']') {
                i += 1;
                i += b[i..]
                    .iter()
                    .take_while(|c| matches!(c, b' ' | b'\t'))
                    .count();
            }
        }
    }
    Some(i)
}

/// The block prefix being typed on a line (`getComposingBlockPrefixRange`).
fn composing_prefix(text: &str) -> Option<usize> {
    if let Some(n) = list_input_prefix(text) {
        return Some(n);
    }
    let b = text.as_bytes();
    let hashes = b.iter().take_while(|&&c| c == b'#').count();
    if (1..=6).contains(&hashes) {
        return Some(hashes + usize::from(b.get(hashes).is_some_and(|c| c.is_ascii_whitespace())));
    }
    let lead = b.iter().take_while(|c| c.is_ascii_whitespace()).count();
    let quotes = b[lead..].iter().take_while(|&&c| c == b'>').count();
    if quotes > 0 {
        let end = lead + quotes;
        return Some(end + usize::from(b.get(end).is_some_and(|c| c.is_ascii_whitespace())));
    }
    if lead <= 3 {
        let rest = &text[lead..];
        for fence in *b"`~" {
            let n = rest.bytes().take_while(|&c| c == fence).count();
            if n >= 3 {
                let info = rest[n..].find('`').unwrap_or(rest.len() - n);
                return Some(lead + n + info);
            }
        }
        for rule in *b"-*_" {
            let n = rest.bytes().take_while(|&c| c == rule).count();
            if n >= 3 {
                let tail = rest[n..]
                    .bytes()
                    .take_while(|c| c.is_ascii_whitespace())
                    .count();
                return Some(lead + n + tail);
            }
        }
    }
    if text.starts_with('|') && text.len() > 1 && text.ends_with('|') {
        return Some(text.len());
    }
    None
}

fn touches(changes: &ChangeSet, range: Range<usize>) -> bool {
    let mut delta: isize = 0;
    for c in changes.changes() {
        let from = (c.range.start as isize + delta) as usize;
        let to = from + c.insert.len();
        if from <= range.end && to.max(from) >= range.start {
            return true;
        }
        delta += c.insert.len() as isize - c.range.len() as isize;
    }
    false
}

pub(super) fn after_applied(
    prev_composing: Option<usize>,
    applied: &Applied,
    state: &EditorState,
    focused: bool,
) -> Option<usize> {
    let doc = &state.doc;
    let line = doc.line_index(state.selection.head);
    let line_start = doc.line_range(line).start;
    let mut composing = prev_composing
        .map(|c| applied.changes.map(c, Assoc::Before))
        .filter(|c| *c == line_start);
    match applied.event {
        UserEvent::Paste => composing = None,
        UserEvent::Input | UserEvent::Delete => {
            let line_text = doc.line_cow(line);
            if let Some(n) = composing_prefix(&line_text)
                && touches(&applied.changes, line_start..line_start + n)
            {
                composing = Some(line_start);
            }
        }
        _ => {}
    }
    if focused { composing } else { None }
}

pub(super) fn after_selection(
    prev_composing: Option<usize>,
    state: &EditorState,
    focused: bool,
) -> Option<usize> {
    if !focused {
        return None;
    }
    let c = prev_composing?;
    let head_line_start = state
        .doc
        .line_range(state.doc.line_index(state.selection.head))
        .start;
    (head_line_start == c).then_some(c)
}
