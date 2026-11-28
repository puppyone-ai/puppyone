//! Public Find facade over [`super::plugins::find::FindPlugin`] (`TA-20`,
//! `TA-60`).
pub use super::plugins::find::{FindMarks, FindPlugin};
pub use crate::editor::text::search::find_all;

use super::EditorView;
use crate::editor::text::selection::Selection;
use gpui::Context;

impl EditorView {
    fn reveal_find(&mut self, cx: &mut Context<Self>) {
        let matched = self.plugin::<FindPlugin>().and_then(|p| {
            p.marks
                .current
                .and_then(|c| p.marks.matches.get(c))
                .cloned()
        });
        if let Some(m) = matched {
            self.set_selection(Selection::range(m.start, m.end), cx);
            self.pointer.reveal_centered = true;
        }
        cx.notify();
    }

    /// `setQuery`; returns `(current, total)` (1-based current index).
    pub fn find_query(&mut self, query: &str, cx: &mut Context<Self>) -> (usize, usize) {
        let doc = self.state.doc.clone();
        let from = self.state.selection.from();
        let result = if let Some(plugin) = self.plugin_mut::<FindPlugin>() {
            plugin.marks.set_query(&doc, query, from);
            plugin.marks.result()
        } else {
            (0, 0)
        };
        self.reveal_find(cx);
        result
    }

    /// `move`: wrap to the next / previous match.
    pub fn find_move(&mut self, forward: bool, cx: &mut Context<Self>) -> (usize, usize) {
        let result = if let Some(plugin) = self.plugin_mut::<FindPlugin>() {
            let n = plugin.marks.matches.len();
            if n == 0 {
                return plugin.marks.result();
            }
            let current = plugin
                .marks
                .current
                .unwrap_or(if forward { n - 1 } else { 0 });
            plugin.marks.current = Some(if forward {
                (current + 1) % n
            } else {
                (current + n - 1) % n
            });
            plugin.marks.result()
        } else {
            return (0, 0);
        };
        self.reveal_find(cx);
        result
    }

    pub fn find_clear(&mut self, cx: &mut Context<Self>) {
        if let Some(plugin) = self.plugin_mut::<FindPlugin>() {
            plugin.marks = FindMarks::default();
        }
        cx.notify();
    }

    #[cfg(test)]
    pub fn find_marks(&self) -> &FindMarks {
        static EMPTY: FindMarks = FindMarks {
            query: String::new(),
            matches: Vec::new(),
            current: None,
            last_rescan_bytes: 0,
        };
        self.plugin::<FindPlugin>().map_or(&EMPTY, |p| &p.marks)
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
