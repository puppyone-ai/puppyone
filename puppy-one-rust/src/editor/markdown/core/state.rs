//! Live-preview state of one pane (product core/state): the inline source
//! fragment revealed at the caret (livePreviewReveal.ts), the line whose
//! block prefix is being typed (composingBlockLine.ts), the pointer-drag
//! freeze (pointerSelection.ts) and the hidden-block-marker caret rule
//! (selectionBehavior.ts).
use super::syntax::Syntax;
use crate::editor::text::{
    buffer::Buffer,
    change::{Assoc, ChangeSet},
    selection::Selection,
    state::{Applied, EditorState, UserEvent},
};
use std::ops::Range;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PreviewState {
    /// `inlineRevealRange`: the inline element whose markers show as source.
    pub reveal: Option<Range<usize>>,
    /// Start of the line kept as source while its prefix is typed.
    pub composing: Option<usize>,
    /// A pointer selection is in progress (line boxes stay as they are).
    pub selecting: bool,
    focused: bool,
}

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
    // `#{1,6}\s?`
    let hashes = b.iter().take_while(|&&c| c == b'#').count();
    if (1..=6).contains(&hashes) {
        return Some(hashes + usize::from(b.get(hashes).is_some_and(|c| c.is_ascii_whitespace())));
    }
    let lead = b.iter().take_while(|c| c.is_ascii_whitespace()).count();
    // `\s*>+\s?`
    let quotes = b[lead..].iter().take_while(|&&c| c == b'>').count();
    if quotes > 0 {
        let end = lead + quotes;
        return Some(end + usize::from(b.get(end).is_some_and(|c| c.is_ascii_whitespace())));
    }
    if lead <= 3 {
        let rest = &text[lead..];
        // ``\s{0,3}(?:`{3,}|~{3,})[^\n`]*``
        for fence in *b"`~" {
            let n = rest.bytes().take_while(|&c| c == fence).count();
            if n >= 3 {
                let info = rest[n..].find('`').unwrap_or(rest.len() - n);
                return Some(lead + n + info);
            }
        }
        // `\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*`
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
    // `\|.*\|`
    if text.starts_with('|') && text.len() > 1 && text.ends_with('|') {
        return Some(text.len());
    }
    None
}

fn touches(changes: &ChangeSet, range: Range<usize>) -> bool {
    // Changed ranges in the new document.
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

impl PreviewState {
    /// `getInlineRevealRangeAtSelection`.
    fn reveal_at(state: &EditorState, syntax: &Syntax, read_only: bool) -> Option<Range<usize>> {
        let s = state.selection;
        if read_only || !s.is_empty() {
            return None;
        }
        syntax.reveal_element(s.head).map(|e| e.range.clone())
    }

    /// A transaction changed the document (`applied` from the view).
    pub fn applied(
        &mut self,
        applied: &Applied,
        state: &EditorState,
        syntax: &Syntax,
        focused: bool,
        read_only: bool,
    ) {
        let map = |r: &Range<usize>| {
            applied.changes.map(r.start, Assoc::Before)..applied.changes.map(r.end, Assoc::After)
        };
        let reveal = self.reveal.as_ref().map(map);
        // Typing ends a pointer gesture.
        self.selecting = false;
        // composingBlockLine.
        let doc = &state.doc;
        let line = doc.line_index(state.selection.head);
        let line_start = doc.line_range(line).start;
        let mut composing = self
            .composing
            .map(|c| applied.changes.map(c, Assoc::Before))
            .filter(|c| *c == line_start);
        match applied.event {
            UserEvent::Paste => composing = None,
            UserEvent::Input | UserEvent::Delete => {
                if let Some(n) = composing_prefix(doc.line(line))
                    && touches(&applied.changes, line_start..line_start + n)
                {
                    composing = Some(line_start);
                }
            }
            _ => {}
        }
        self.composing = if focused { composing } else { None };
        // resolvePaneLocalInlineRevealRange with a document change.
        self.reveal = if !focused {
            reveal.filter(|r| {
                syntax
                    .reveal_element(r.start + 1)
                    .is_some_and(|e| e.range == *r)
            })
        } else {
            Self::reveal_at(state, syntax, read_only)
        };
        self.focused = focused;
    }

    /// Selection or focus changed without a document change.
    pub fn selection_changed(
        &mut self,
        state: &EditorState,
        syntax: &Syntax,
        focused: bool,
        selecting: bool,
        read_only: bool,
    ) {
        let entered = focused && !self.focused;
        let released = self.selecting && !selecting;
        self.selecting = selecting;
        self.focused = focused;
        if !focused {
            self.composing = None;
        } else if let Some(c) = self.composing
            && state
                .doc
                .line_range(state.doc.line_index(state.selection.head))
                .start
                != c
        {
            self.composing = None;
        }
        if selecting || !focused {
            return;
        }
        // A non-empty selection keeps the line boxes until the next caret.
        if !state.selection.is_empty() && !entered && !released {
            return;
        }
        self.reveal = Self::reveal_at(state, syntax, read_only);
    }

    /// `markdownHiddenMarkerSelectionNormalizer`: keep a caret off hidden
    /// block markers (one caret position per visual position).
    pub fn normalize(
        &self,
        doc: &Buffer,
        syntax: &Syntax,
        selection: Selection,
    ) -> Option<Selection> {
        if !selection.is_empty() {
            return None;
        }
        let caret = selection.head;
        let line = doc.line_range(doc.line_index(caret));
        if self.composing == Some(line.start) {
            return None;
        }
        let element = syntax.block_marker_on(line)?;
        let visible = element.visible_start();
        (caret >= element.range.start && caret < visible).then(|| Selection::cursor(visible))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_follow_the_product_expressions() {
        assert_eq!(list_input_prefix("- [ ] task"), Some(6));
        assert_eq!(list_input_prefix("  12. x"), Some(6));
        assert_eq!(list_input_prefix("-x"), None);
        assert_eq!(list_input_prefix("-"), Some(1));
        assert_eq!(composing_prefix("## Title"), Some(3));
        assert_eq!(composing_prefix("> q"), Some(2));
        assert_eq!(composing_prefix("```rust"), Some(7));
        assert_eq!(composing_prefix("plain"), None);
    }
}
