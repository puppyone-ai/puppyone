//! Undo history (CodeMirror `history()`): consecutive input of the same kind
//! within the group delay forms one step; commands, paste and external content
//! always start a new step. Steps store inverse change sets in order.
use super::{
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
}

#[derive(Default)]
pub struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
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
            return;
        }
        self.redo.clear();
        let inverse = applied.changes.invert(&applied.before_doc);
        let joins = matches!(applied.event, UserEvent::Input | UserEvent::Delete)
            && self.undo.last().is_some_and(|step| {
                step.event == applied.event
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
            self.undo.push(Step {
                inverses: vec![inverse],
                forwards: vec![applied.changes.clone()],
                selection_before: applied.before_selection,
                selection_after: after.selection,
                event: applied.event,
                at: now,
            });
            if self.undo.len() > MAX_STEPS {
                self.undo.remove(0);
            }
        }
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
}
