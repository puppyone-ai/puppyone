//! Bounded snapshot history. Byte costs are supplied by the Markdown host.
use super::transaction::State;
struct Entry {
    state: State,
    bytes: usize,
}
#[derive(Default)]
pub struct History {
    undo: Vec<Entry>,
    redo: Vec<Entry>,
}
impl History {
    pub fn record(&mut self, state: State, bytes: usize) {
        self.undo.push(Entry { state, bytes });
        while self.undo.len() > 64
            || (self.undo.len() > 1
                && self.undo.iter().map(|e| e.bytes).sum::<usize>() > 8 * 1024 * 1024)
        {
            self.undo.remove(0);
        }
        self.redo.clear();
    }
    pub fn step(&mut self, redo: bool, current: State, bytes: usize) -> Option<State> {
        let (from, to) = if redo {
            (&mut self.redo, &mut self.undo)
        } else {
            (&mut self.undo, &mut self.redo)
        };
        let entry = from.pop()?;
        to.push(Entry {
            state: current,
            bytes,
        });
        Some(entry.state)
    }
    #[cfg(test)]
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_editor::core::{document::Document, selection::Selection};
    fn state(n: usize) -> State {
        State {
            document: Document::raw(&n.to_string()),
            selection: Selection::default(),
            source_mode: true,
        }
    }
    #[test]
    fn history_bounds_count_and_bytes_and_discards_the_redo_branch() {
        let mut history = History::default();
        for n in 0..70 {
            history.record(state(n), 1);
        }
        assert_eq!(history.undo.len(), 64);
        assert_eq!(history.step(false, state(70), 1), Some(state(69)));
        history.record(state(71), 1);
        assert!(history.step(true, state(72), 1).is_none());
        let mut history = History::default();
        for n in 0..4 {
            history.record(state(n), 3 * 1024 * 1024);
        }
        assert_eq!(history.undo.len(), 2);
        history.record(state(5), 9 * 1024 * 1024);
        assert_eq!(history.undo.len(), 1);
    }
}
