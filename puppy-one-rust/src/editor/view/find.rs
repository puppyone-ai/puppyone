//! The editor's find adapter (editor/find/codeMirrorFindAdapter.ts): literal,
//! case-insensitive matches over the source text; the current match is
//! selected and scrolled to the middle; matches are marked
//! (`.cm-editor-find-match`, editor-find.css) and follow edits.
use super::EditorView;
use crate::editor::text::selection::Selection;
use gpui::Context;
use std::ops::Range;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FindMarks {
    pub query: String,
    pub matches: Vec<Range<usize>>,
    pub current: Option<usize>,
}

/// `SearchQuery { caseSensitive: false, literal: true }` over `text`.
pub fn find_all(text: &str, query: &str) -> Vec<Range<usize>> {
    if query.is_empty() {
        return Vec::new();
    }
    // Lower-case char by char so offsets stay those of the source.
    let folded: Vec<(usize, char)> = text.char_indices().flat_map(|(i, c)| c.to_lowercase().map(move |l| (i, l))).collect();
    let needle: Vec<char> = query.chars().flat_map(char::to_lowercase).collect();
    let mut out = Vec::new();
    let mut k = 0;
    while k + needle.len() <= folded.len() {
        if folded[k..k + needle.len()].iter().map(|(_, c)| *c).eq(needle.iter().copied()) {
            let start = folded[k].0;
            let last = folded[k + needle.len() - 1].0;
            let end = last + text[last..].chars().next().map_or(0, char::len_utf8);
            out.push(start..end);
            k += needle.len();
        } else {
            k += 1;
        }
    }
    out
}

impl EditorView {
    fn refresh_find(&mut self, select_nearest: bool, cx: &mut Context<Self>) -> (usize, usize) {
        let matches = find_all(self.text(), &self.find.query);
        let current = if matches.is_empty() {
            None
        } else if select_nearest || self.find.current.is_none_or(|c| c >= matches.len()) {
            // The first match at or after the selection.
            let from = self.state.selection.from();
            Some(matches.iter().position(|m| m.start >= from).unwrap_or(0))
        } else {
            self.find.current
        };
        self.find.matches = matches;
        self.find.current = current;
        self.reveal_find(cx);
        self.find_result()
    }

    fn find_result(&self) -> (usize, usize) {
        (self.find.current.map_or(0, |c| c + 1), self.find.matches.len())
    }

    /// Select the current match and centre it.
    fn reveal_find(&mut self, cx: &mut Context<Self>) {
        if let Some(m) = self.find.current.and_then(|c| self.find.matches.get(c)).cloned() {
            self.set_selection(Selection::range(m.start, m.end), cx);
            self.reveal_centered = true;
        }
        cx.notify();
    }

    /// `setQuery`; returns (current, total).
    pub fn find_query(&mut self, query: &str, cx: &mut Context<Self>) -> (usize, usize) {
        self.find.query = query.to_owned();
        self.refresh_find(true, cx)
    }

    /// `move`: wrap to the next / previous match.
    pub fn find_move(&mut self, forward: bool, cx: &mut Context<Self>) -> (usize, usize) {
        let n = self.find.matches.len();
        if n == 0 {
            return self.find_result();
        }
        let current = self.find.current.unwrap_or(if forward { n - 1 } else { 0 });
        self.find.current = Some(if forward { (current + 1) % n } else { (current + n - 1) % n });
        self.reveal_find(cx);
        self.find_result()
    }

    pub fn find_clear(&mut self, cx: &mut Context<Self>) {
        self.find = FindMarks::default();
        cx.notify();
    }

    /// Keep matches current after an edit.
    pub(super) fn find_changed(&mut self) {
        if self.find.query.is_empty() {
            return;
        }
        self.find.matches = find_all(self.text(), &self.find.query);
        if self.find.current.is_some_and(|c| c >= self.find.matches.len()) {
            self.find.current = (!self.find.matches.is_empty()).then_some(0);
        }
    }

    pub fn find_marks(&self) -> &FindMarks {
        &self.find
    }
}

#[cfg(test)]
mod tests {
    use super::find_all;

    #[test]
    fn matches_are_literal_case_insensitive_and_non_overlapping() {
        assert_eq!(find_all("Aa aA aaa", "aa"), vec![0..2, 3..5, 6..8]);
        assert_eq!(find_all("a.b a*b", "."), vec![1..2]);
        assert_eq!(find_all("Straße STRASSE", "straße"), vec![0..7]);
        assert_eq!(find_all("x", ""), Vec::<std::ops::Range<usize>>::new());
    }
}
