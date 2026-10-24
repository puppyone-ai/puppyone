//! Undo history (CodeMirror `history()`): consecutive input of the same kind
//! within the group delay forms one step; commands, paste and external content
//! always start a new step. Steps store inverse change sets in order.
//!
//! An IME composition is one step: its provisional edits are not recorded
//! while it is open, and when it ends the document before it and the
//! document after it become a single sealed `Input` step (nothing when the
//! composition was cancelled), so undo never shows intermediate preedit
//! text such as pinyin letters.
use super::{
    buffer::Buffer,
    change::ChangeSet,
    selection::Selection,
    state::{Applied, EditorState, Transaction, UserEvent},
};
use std::time::{Duration, Instant};

/// CodeMirror `newGroupDelay`.
pub const GROUP_DELAY: Duration = Duration::from_millis(500);
/// Bound on retained steps (product `DOCUMENT_HISTORY_POLICY.maxEntries`).
pub const MAX_STEPS: usize = 200;

#[derive(Clone, Debug)]
struct Step {
    /// Inverses in application order; undo replays them in reverse.
    inverses: Vec<ChangeSet>,
    /// Forward changes, for redo.
    forwards: Vec<ChangeSet>,
    selection_before: Selection,
    selection_after: Selection,
    event: UserEvent,
    at: Instant,
    /// Later input never joins this step (a committed composition).
    sealed: bool,
}

/// An open IME composition: the document and selection before it.
struct Composing {
    doc: Buffer,
    selection: Selection,
}

#[derive(Default)]
pub struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
    composing: Option<Composing>,
}

/// The single replacement turning `before` into `after` (common prefix and
/// suffix trimmed on character boundaries); `None` when they are equal.
fn replacement(before: &Buffer, after: &Buffer) -> Option<ChangeSet> {
    let (a, b) = (before.as_str(), after.as_str());
    if a == b {
        return None;
    }
    let mut prefix = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
    while !(a.is_char_boundary(prefix) && b.is_char_boundary(prefix)) {
        prefix -= 1;
    }
    let room = a.len().min(b.len()) - prefix;
    let mut suffix = a.bytes().rev().zip(b.bytes().rev()).take(room).take_while(|(x, y)| x == y).count();
    while !(a.is_char_boundary(a.len() - suffix) && b.is_char_boundary(b.len() - suffix)) {
        suffix -= 1;
    }
    Some(ChangeSet::replace(prefix..a.len() - suffix, &b[prefix..b.len() - suffix]))
}

impl History {
    pub fn record(&mut self, applied: &Applied, after: &EditorState, now: Instant) {
        if matches!(applied.event, UserEvent::Undo | UserEvent::Redo | UserEvent::Select) {
            return;
        }
        if applied.event == UserEvent::External {
            // Storage adoption is not undoable and invalidates position-based steps.
            self.undo.clear();
            self.redo.clear();
            self.composing = None;
            return;
        }
        if self.composing.is_some() {
            // Folded into one step by `end_composition`.
            return;
        }
        self.redo.clear();
        let inverse = applied.changes.invert(&applied.before_doc);
        let joins = matches!(applied.event, UserEvent::Input | UserEvent::Delete)
            && self.undo.last().is_some_and(|step| {
                !step.sealed
                    && step.event == applied.event
                    && now.duration_since(step.at) < GROUP_DELAY
                    && step.selection_after == applied.before_selection
            });
        if joins {
            let step = self.undo.last_mut().unwrap();
            step.inverses.push(inverse);
            step.forwards.push(applied.changes.clone());
            step.selection_after = after.selection;
            step.at = now;
        } else {
            self.push(Step {
                inverses: vec![inverse],
                forwards: vec![applied.changes.clone()],
                selection_before: applied.before_selection,
                selection_after: after.selection,
                event: applied.event,
                at: now,
                sealed: false,
            });
        }
    }

    fn push(&mut self, step: Step) {
        self.undo.push(step);
        if self.undo.len() > MAX_STEPS {
            self.undo.remove(0);
        }
    }

    /// An IME composition starts from `state`; its edits wait for
    /// `end_composition`.
    pub fn begin_composition(&mut self, state: &EditorState) {
        if self.composing.is_none() {
            self.composing = Some(Composing { doc: state.doc.clone(), selection: state.selection });
        }
    }

    pub fn composing(&self) -> bool {
        self.composing.is_some()
    }

    /// Close the open composition at `state`: one sealed `Input` step from
    /// the document before it, none when it was cancelled. Returns whether
    /// the document changed.
    pub fn end_composition(&mut self, state: &EditorState, now: Instant) -> bool {
        let Some(composing) = self.composing.take() else { return false };
        let Some(forward) = replacement(&composing.doc, &state.doc) else { return false };
        self.redo.clear();
        let inverse = forward.invert(&composing.doc);
        self.push(Step {
            inverses: vec![inverse],
            forwards: vec![forward],
            selection_before: composing.selection,
            selection_after: state.selection,
            event: UserEvent::Input,
            at: now,
            sealed: true,
        });
        true
    }

    /// Drop the open composition without a step (the document is being
    /// replaced from storage).
    pub fn abandon_composition(&mut self) {
        self.composing = None;
    }
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
    /// Apply one undo (`redo == false`) or redo step to `state`.
    pub fn step(&mut self, state: &mut EditorState, redo: bool) -> bool {
        let Some(step) = (if redo { self.redo.pop() } else { self.undo.pop() }) else {
            return false;
        };
        let (sets, selection, event): (Vec<&ChangeSet>, _, _) = if redo {
            (step.forwards.iter().collect(), step.selection_after, UserEvent::Redo)
        } else {
            (step.inverses.iter().rev().collect(), step.selection_before, UserEvent::Undo)
        };
        for (n, set) in sets.iter().enumerate() {
            let last = n + 1 == sets.len();
            state.apply(Transaction::edit((*set).clone(), last.then_some(selection), event));
        }
        if redo { self.undo.push(step) } else { self.redo.push(step) }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::selection::Selection;
    fn type_at(state: &mut EditorState, history: &mut History, pos: usize, text: &str, now: Instant) {
        let tr = Transaction::edit(ChangeSet::replace(pos..pos, text), Some(Selection::cursor(pos + text.len())), UserEvent::Input);
        let applied = state.apply(tr).unwrap();
        history.record(&applied, state, now);
    }
    #[test]
    fn typing_groups_and_commands_split_steps() {
        let mut state = EditorState::new("");
        let mut history = History::default();
        let t0 = Instant::now();
        type_at(&mut state, &mut history, 0, "a", t0);
        type_at(&mut state, &mut history, 1, "b", t0 + Duration::from_millis(100));
        type_at(&mut state, &mut history, 2, "c", t0 + Duration::from_millis(900));
        assert_eq!(state.doc.as_str(), "abc");
        assert!(history.step(&mut state, false));
        assert_eq!(state.doc.as_str(), "ab");
        assert!(history.step(&mut state, false));
        assert_eq!(state.doc.as_str(), "");
        assert_eq!(state.selection, Selection::cursor(0));
        assert!(history.step(&mut state, true));
        assert_eq!(state.doc.as_str(), "ab");
        assert_eq!(state.selection.head, 2);
        let applied = state
            .apply(Transaction::edit(ChangeSet::replace(0..2, "**ab**"), None, UserEvent::Command))
            .unwrap();
        history.record(&applied, &state, t0);
        assert!(!history.can_redo());
        assert!(history.step(&mut state, false));
        assert_eq!(state.doc.as_str(), "ab");
    }

    fn compose(state: &mut EditorState, history: &mut History, range: std::ops::Range<usize>, text: &str) {
        let caret = range.start + text.len();
        let tr = Transaction::edit(ChangeSet::replace(range, text), Some(Selection::cursor(caret)), UserEvent::Compose);
        let applied = state.apply(tr).unwrap();
        history.record(&applied, state, Instant::now());
    }

    #[test]
    fn a_composition_is_one_sealed_step_whatever_its_pace() {
        let mut state = EditorState::new("ab");
        state.selection = Selection::cursor(2);
        let mut history = History::default();
        let t0 = Instant::now();
        type_at(&mut state, &mut history, 2, "c", t0);
        history.begin_composition(&state);
        // Pinyin preedit updates, then the commit replaces them.
        for (from, text) in [(3..3, "n"), (3..4, "ni"), (3..5, "nih"), (3..6, "nihao"), (3..8, "你好")] {
            compose(&mut state, &mut history, from, text);
        }
        assert!(history.end_composition(&state, t0 + Duration::from_secs(9)));
        assert_eq!(state.doc.as_str(), "abc你好");
        // Typing right after the commit does not join the composition.
        type_at(&mut state, &mut history, 9, "d", t0 + Duration::from_secs(9));
        assert!(history.step(&mut state, false));
        assert_eq!(state.doc.as_str(), "abc你好");
        assert!(history.step(&mut state, false));
        assert_eq!((state.doc.as_str(), state.selection), ("abc", Selection::cursor(3)));
        assert!(history.step(&mut state, true));
        assert_eq!(state.doc.as_str(), "abc你好");
    }

    #[test]
    fn a_cancelled_composition_leaves_no_step_and_keeps_redo() {
        let mut state = EditorState::new("");
        let mut history = History::default();
        type_at(&mut state, &mut history, 0, "x", Instant::now());
        assert!(history.step(&mut state, false));
        history.begin_composition(&state);
        compose(&mut state, &mut history, 0..0, "ka");
        compose(&mut state, &mut history, 0..2, "");
        assert!(!history.end_composition(&state, Instant::now()));
        assert!(!history.can_undo() && history.can_redo());
    }

    #[test]
    fn the_composition_step_is_the_minimal_replacement() {
        let before = Buffer::new("日本です");
        let after = Buffer::new("二本です");
        let change = replacement(&before, &after).unwrap();
        assert_eq!(change.changes()[0].range, 0..3);
        assert_eq!(change.changes()[0].insert, "二");
        // Shared bytes inside different characters never split a character.
        let change = replacement(&Buffer::new("é"), &Buffer::new("è")).unwrap();
        assert_eq!((change.changes()[0].range.clone(), change.changes()[0].insert.as_str()), (0..2, "è"));
        assert!(replacement(&before, &before).is_none());
    }
}
