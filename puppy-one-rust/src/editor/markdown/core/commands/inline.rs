//! Inline format commands (core/commands/markdownInlineCommands.ts): toggle
//! delimiters around the selection or the word at the caret, unwrapping a
//! covering or overlapping format first; ⌘K wraps a link.
use super::{change, edit};
use crate::editor::{
    markdown::core::syntax::{Element, Kind, Syntax},
    text::{
        change::{Assoc, ChangeSet},
        selection::Selection,
        state::{EditorState, Transaction, UserEvent},
    },
};
use std::ops::Range;

#[derive(Clone, Copy, Debug)]
pub struct Spec {
    kind: Option<Kind>,
    open: &'static str,
    close: &'static str,
}

impl Spec {
    pub const STRONG: Spec = Spec {
        kind: Some(Kind::Strong),
        open: "**",
        close: "**",
    };
    pub const EMPHASIS: Spec = Spec {
        kind: Some(Kind::Emphasis),
        open: "*",
        close: "*",
    };
    pub const STRIKE: Spec = Spec {
        kind: Some(Kind::Strike),
        open: "~~",
        close: "~~",
    };
    pub const CODE: Spec = Spec {
        kind: Some(Kind::InlineCode),
        open: "`",
        close: "`",
    };
    /// `<u>` is inline HTML; the native pipeline has no element for it.
    pub const UNDERLINE: Spec = Spec {
        kind: None,
        open: "<u>",
        close: "</u>",
    };
    fn emphasis_like(&self) -> bool {
        matches!(self.kind, Some(Kind::Strong | Kind::Emphasis))
    }
}

/// `getWordRangeAt`: `[\p{L}\p{N}_-]` around the caret within its line.
fn word_at(state: &EditorState, pos: usize) -> Option<Range<usize>> {
    let doc = &state.doc;
    let line = doc.line_range(doc.line_index(pos));
    let text = doc.slice(line.clone());
    let word = |c: char| c.is_alphanumeric() || c == '_' || c == '-';
    let offset = pos - line.start;
    let from = text[..offset]
        .char_indices()
        .rev()
        .take_while(|(_, c)| word(*c))
        .last()
        .map_or(offset, |(i, _)| i);
    let to = offset
        + text[offset..]
            .chars()
            .take_while(|c| word(*c))
            .map(char::len_utf8)
            .sum::<usize>();
    (from < to).then(|| line.start + from..line.start + to)
}

fn is_punct(c: char) -> bool {
    c.is_ascii_punctuation() || (!c.is_alphanumeric() && !c.is_whitespace() && !c.is_control())
}

/// `adjustWrapRangeForMarkdownEmphasis`: shrink to flanking boundaries.
fn flanking(state: &EditorState, range: Range<usize>) -> Option<Range<usize>> {
    if range.is_empty() {
        return Some(range);
    }
    let text = state.doc.as_str();
    let (mut from, mut to) = (range.start, range.end);
    let before = |i: usize| text[..i].chars().next_back();
    let after = |i: usize| text[i..].chars().next();
    while from < to {
        let (prev, first) = (before(from), after(from));
        let left = first.is_some_and(|f| {
            !f.is_whitespace()
                && (!is_punct(f) || prev.is_none_or(|p| p.is_whitespace() || is_punct(p)))
        });
        if left {
            break;
        }
        from += first.map_or(1, char::len_utf8);
    }
    while from < to {
        let (last, next) = (before(to), after(to));
        let right = last.is_some_and(|l| {
            !l.is_whitespace()
                && (!is_punct(l) || next.is_none_or(|n| n.is_whitespace() || is_punct(n)))
        });
        if right {
            break;
        }
        to -= last.map_or(1, char::len_utf8);
    }
    (from < to).then_some(from..to)
}

/// Elements of `spec`'s kind on the selected lines: those containing the
/// selection and those overlapping it (`getInlineFormatCoverage`).
fn coverage<'a>(
    state: &EditorState,
    syntax: &'a Syntax,
    spec: Spec,
) -> (Vec<&'a Element>, Vec<&'a Element>) {
    let Some(kind) = spec.kind else {
        return (Vec::new(), Vec::new());
    };
    let s = state.selection;
    let (start, end) = (s.from(), s.to());
    let doc = &state.doc;
    let lines =
        doc.line_range(doc.line_index(start)).start..doc.line_range(doc.line_index(end)).end;
    let candidates: Vec<&Element> = syntax
        .elements_in(lines)
        .filter(|e| e.kind == kind && e.content.as_ref().is_some_and(|c| c.start < c.end))
        .collect();
    let formats = candidates
        .iter()
        .copied()
        .filter(|e| start >= e.range.start && end <= e.range.end && start < e.range.end)
        .collect();
    let neighbors = candidates
        .into_iter()
        .filter(|e| start < e.range.end && end > e.range.start)
        .collect();
    (formats, neighbors)
}

fn unwrap(state: &EditorState, elements: &[&Element]) -> Option<Transaction> {
    let mut markers: Vec<Range<usize>> = elements
        .iter()
        .flat_map(|e| e.markers.iter().cloned())
        .filter(|m| m.start < m.end)
        .collect();
    markers.sort_by_key(|m| (m.start, m.end));
    markers.dedup();
    if markers.is_empty() {
        return None;
    }
    let s = state.selection;
    let changes = ChangeSet::new(markers.into_iter().map(|m| change(m, "")).collect());
    let (a, b) = (
        changes.map(s.from(), Assoc::After),
        changes.map(s.to(), Assoc::Before),
    );
    let selection = if a >= b {
        Selection::cursor(a)
    } else {
        Selection::range(a, b)
    };
    Some(Transaction::edit(
        changes,
        Some(selection),
        UserEvent::Command,
    ))
}

fn wrap(state: &EditorState, spec: Spec) -> Option<Transaction> {
    let s = state.selection;
    let selected = if s.is_empty() {
        word_at(state, s.head).unwrap_or(s.head..s.head)
    } else {
        s.as_range()
    };
    let range = if spec.emphasis_like() {
        flanking(state, selected.clone()).unwrap_or(selected)
    } else {
        selected
    };
    let (open, close) = (spec.open.len(), spec.close.len());
    let selection = if range.is_empty() {
        Selection::cursor(range.start + open)
    } else {
        Selection::range(range.start + open, range.end + open)
    };
    let _ = close;
    edit(
        vec![
            change(range.start..range.start, spec.open),
            change(range.end..range.end, spec.close),
        ],
        Some(selection),
        UserEvent::Command,
    )
}

/// `unwrapWithDelimiters`: the selection (or word) is itself delimited, or
/// is directly surrounded by the delimiters.
fn unwrap_delimited(state: &EditorState, spec: Spec) -> Option<Transaction> {
    let s = state.selection;
    let doc = state.doc.as_str();
    let range = if s.is_empty() {
        word_at(state, s.head).unwrap_or(s.head..s.head)
    } else {
        s.as_range()
    };
    let text = &doc[range.clone()];
    let (open, close) = (spec.open.len(), spec.close.len());
    if text.len() >= open + close && text.starts_with(spec.open) && text.ends_with(spec.close) {
        let selection = if range.start + open == range.end - close {
            Selection::cursor(range.start)
        } else {
            Selection::range(range.start, range.end - open - close)
        };
        return edit(
            vec![
                change(range.start..range.start + open, ""),
                change(range.end - close..range.end, ""),
            ],
            Some(selection),
            UserEvent::Command,
        );
    }
    let before = range.start.checked_sub(open)?;
    let after = range.end + close;
    if after > doc.len()
        || &doc[before..range.start] != spec.open
        || &doc[range.end..after] != spec.close
    {
        return None;
    }
    let selection = if range.is_empty() {
        Selection::cursor(before)
    } else {
        Selection::range(before, range.end - open)
    };
    edit(
        vec![
            change(before..range.start, ""),
            change(range.end..after, ""),
        ],
        Some(selection),
        UserEvent::Command,
    )
}

/// `toggleMarkdownFormat`.
pub fn toggle(state: &EditorState, syntax: &Syntax, spec: Spec) -> Option<Transaction> {
    let (formats, neighbors) = coverage(state, syntax, spec);
    if !formats.is_empty() {
        return unwrap(state, &formats);
    }
    if !neighbors.is_empty() {
        return rewrap(state, &neighbors, spec);
    }
    unwrap_delimited(state, spec).or_else(|| wrap(state, spec))
}

/// Overlapping formats are removed and the selection wrapped whole, as one
/// change: the wrap is computed on the text without those markers and its
/// delimiters are placed back in original coordinates.
fn rewrap(state: &EditorState, neighbors: &[&Element], spec: Spec) -> Option<Transaction> {
    let mut markers: Vec<Range<usize>> = neighbors
        .iter()
        .flat_map(|e| e.markers.iter().cloned())
        .filter(|m| m.start < m.end)
        .collect();
    markers.sort_by_key(|m| (m.start, m.end));
    markers.dedup();
    let removal = ChangeSet::new(markers.iter().map(|m| change(m.clone(), "")).collect());
    let mut intermediate = state.clone();
    let s = state.selection;
    let (a, b) = (
        removal.map(s.from(), Assoc::After),
        removal.map(s.to(), Assoc::Before),
    );
    intermediate.apply(Transaction::edit(
        removal,
        Some(if a >= b {
            Selection::cursor(a)
        } else {
            Selection::range(a, b)
        }),
        UserEvent::Command,
    ));
    let selected = if intermediate.selection.is_empty() {
        word_at(&intermediate, intermediate.selection.head)
            .unwrap_or(intermediate.selection.as_range())
    } else {
        intermediate.selection.as_range()
    };
    let range = if spec.emphasis_like() {
        flanking(&intermediate, selected.clone()).unwrap_or(selected)
    } else {
        selected
    };
    // Intermediate → original: add back every removed marker before `p`.
    let original = |p: usize| {
        let mut o = p;
        for m in &markers {
            if m.start <= o {
                o += m.len();
            } else {
                break;
            }
        }
        o
    };
    let mut changes: Vec<_> = markers.iter().map(|m| change(m.clone(), "")).collect();
    let (open_at, close_at) = (original(range.start), original(range.end));
    changes.push(change(open_at..open_at, spec.open));
    changes.push(change(close_at..close_at, spec.close));
    let open = spec.open.len();
    let selection = if range.is_empty() {
        Selection::cursor(range.start + open)
    } else {
        Selection::range(range.start + open, range.end + open)
    };
    edit(changes, Some(selection), UserEvent::Command)
}

/// `wrapMarkdownLink`: `[text]()` with the caret in the parentheses.
pub fn wrap_link(state: &EditorState) -> Option<Transaction> {
    let s = state.selection;
    let range = if s.is_empty() {
        word_at(state, s.head)?
    } else {
        s.as_range()
    };
    let text = state.doc.slice(range.clone()).to_owned();
    let caret = range.start + text.len() + 3;
    edit(
        vec![change(range, format!("[{text}]()"))],
        Some(Selection::cursor(caret)),
        UserEvent::Command,
    )
}
