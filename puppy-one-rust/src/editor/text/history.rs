//! Undo history (CodeMirror `history()`, `TA-02`, `TA-05`): consecutive input
//! of the same kind within the group delay composes into a single `ChangeSet`
//! and a single `inverse` `ChangeSet`; commands, paste and external content
//! always start a new step. Undo and redo apply one `ChangeSet` in one shot,
//! and history classification reads hierarchical `Transaction` annotations.
//!
//! An IME composition is one step: its provisional edits are not recorded
//! while it is open, and when it ends the document before it and the
//! document after it become a single sealed `"input.type"` step (nothing when
//! the composition was cancelled), so undo never shows intermediate preedit
//! text such as pinyin letters.
use super::{
    buffer::Buffer,
    change::ChangeSet,
    selection::Selection,
    state::{Annotation, Applied, EditorState, Transaction, UserEvent},
};
use std::time::{Duration, Instant};

/// CodeMirror `newGroupDelay`.
pub const GROUP_DELAY: Duration = Duration::from_millis(500);
/// Bound on retained steps (product `DOCUMENT_HISTORY_POLICY.maxEntries`).
pub const MAX_STEPS: usize = 200;
/// Bound on retained change bytes (`DOCUMENT_HISTORY_POLICY.maxBytes`).
pub const MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GroupKind {
    Input,
    Delete,
}

fn group_kind(applied: &Applied) -> Option<GroupKind> {
    if applied.is_annotation(Annotation::INPUT_PASTE)
        || applied.is_annotation(Annotation::INPUT_COMPOSE)
        || applied.is_annotation(Annotation::COMMAND)
    {
        return None;
    }
    if applied.is_annotation(Annotation::INPUT) {
        Some(GroupKind::Input)
    } else if applied.is_annotation(Annotation::DELETE) {
        Some(GroupKind::Delete)
    } else {
        None
    }
}

#[derive(Clone, Debug)]
struct Step {
    /// Single composed forward `ChangeSet` (`A -> B`), for redo.
    changes: ChangeSet,
    /// Single composed inverse `ChangeSet` (`B -> A`), for undo.
    inverse: ChangeSet,
    selection_before: Selection,
    selection_after: Selection,
    group: Option<GroupKind>,
    at: Instant,
    /// Later input never joins this step (a committed composition).
    sealed: bool,
}

/// An open IME composition: the `O(1)` rope snapshot and selection before it.
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
/// suffix trimmed on character boundaries in `O(log n + |changed|)` without
/// materialising `flat`); `None` when they are equal.
fn replacement(before: &Buffer, after: &Buffer) -> Option<ChangeSet> {
    if before == after {
        return None;
    }
    let raw_prefix = before.rope().common_prefix_bytes(after.rope());
    let prefix = before.clamp(raw_prefix);
    let room = before.len().min(after.len()) - prefix;
    let mut suffix = before.rope().common_suffix_bytes(after.rope(), room);
    while suffix > 0
        && (before.clamp(before.len() - suffix) != before.len() - suffix
            || after.clamp(after.len() - suffix) != after.len() - suffix)
    {
        suffix -= 1;
    }
    let insert = after.slice_cow(prefix..after.len() - suffix);
    Some(ChangeSet::replace(
        prefix..before.len() - suffix,
        insert.into_owned(),
    ))
}

impl History {
    pub fn record(&mut self, applied: &Applied, after: &EditorState, now: Instant) {
        let at = applied.timestamp().unwrap_or(now);
        if applied.is_annotation(Annotation::UNDO)
            || applied.is_annotation(Annotation::REDO)
            || applied.is_annotation(Annotation::SELECT)
            || applied.is_annotation(Annotation::CONFIG)
        {
            return;
        }
        if applied.is_annotation(Annotation::EXTERNAL) {
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
        let kind = group_kind(applied);
        let joins = kind.is_some()
            && self.undo.last().is_some_and(|step| {
                !step.sealed
                    && step.group == kind
                    && at.saturating_duration_since(step.at) < GROUP_DELAY
                    && step.selection_after == applied.before_selection
            });
        if joins {
            let step = self.undo.last_mut().unwrap();
            step.changes = step.changes.compose(&applied.changes);
            step.inverse = applied.inverse.compose(&step.inverse);
            step.selection_after = after.selection;
            step.at = at;
            self.trim();
        } else {
            self.push(Step {
                changes: applied.changes.clone(),
                inverse: applied.inverse.clone(),
                selection_before: applied.before_selection,
                selection_after: after.selection,
                group: kind,
                at,
                sealed: false,
            });
        }
    }

    fn push(&mut self, step: Step) {
        self.undo.push(step);
        self.trim();
    }

    /// `trimHistory`: the newest steps are kept within both the step and
    /// the byte budget; the oldest undo steps go first, then the furthest
    /// redo steps.
    fn trim(&mut self) {
        let weight = |s: &Step| s.changes.weight();
        let mut bytes: usize = self.undo.iter().chain(&self.redo).map(weight).sum();
        while self.undo.len() + self.redo.len() > MAX_STEPS || bytes > MAX_BYTES {
            let dropped = if !self.undo.is_empty() {
                self.undo.remove(0)
            } else {
                self.redo.remove(0)
            };
            bytes -= weight(&dropped);
        }
    }

    /// An IME composition starts from `state`; its edits wait for
    /// `end_composition`.
    pub fn begin_composition(&mut self, state: &EditorState) {
        if self.composing.is_none() {
            self.composing = Some(Composing {
                doc: state.doc.clone(),
                selection: state.selection,
            });
        }
    }

    pub fn composing(&self) -> bool {
        self.composing.is_some()
    }

    /// Close the open composition at `state`: one sealed `Input` step from
    /// the document before it, none when it was cancelled. Returns whether
    /// the document changed.
    pub fn end_composition(&mut self, state: &EditorState, now: Instant) -> bool {
        let Some(composing) = self.composing.take() else {
            return false;
        };
        let Some(forward) = replacement(&composing.doc, &state.doc) else {
            return false;
        };
        self.redo.clear();
        let inverse = forward.invert(&composing.doc);
        self.push(Step {
            changes: forward,
            inverse,
            selection_before: composing.selection,
            selection_after: state.selection,
            group: Some(GroupKind::Input),
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

    #[cfg(test)]
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    #[cfg(test)]
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Apply one undo (`redo == false`) or redo step to `state` in a single
    /// `Transaction` (`TA-02`).
    pub fn step(&mut self, state: &mut EditorState, redo: bool) -> bool {
        let Some(step) = (if redo {
            self.redo.pop()
        } else {
            self.undo.pop()
        }) else {
            return false;
        };
        let (changes, selection, event) = if redo {
            (step.changes.clone(), step.selection_after, UserEvent::Redo)
        } else {
            (step.inverse.clone(), step.selection_before, UserEvent::Undo)
        };
        state.apply(Transaction::edit(changes, Some(selection), event));
        if redo {
            self.undo.push(step);
        } else {
            self.redo.push(step);
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::text::selection::Selection;

    fn type_at(
        state: &mut EditorState,
        history: &mut History,
        pos: usize,
        text: &str,
        now: Instant,
    ) {
        let tr = Transaction::edit(
            ChangeSet::replace(pos..pos, text),
            Some(Selection::cursor(pos + text.len())),
            UserEvent::Input,
        );
        let applied = state.apply(tr).unwrap();
        history.record(&applied, state, now);
    }

    #[test]
    fn history_keeps_the_newest_steps_within_the_byte_budget() {
        let mut state = EditorState::new("");
        let mut history = History::default();
        let t0 = Instant::now();
        // Each paste is its own step of 1 MiB (2 MiB by the policy's count).
        let block = "x".repeat(1024 * 1024);
        for n in 0..6 {
            let applied = state
                .apply(Transaction::edit(
                    ChangeSet::replace(state.doc.len()..state.doc.len(), &block),
                    None,
                    UserEvent::Paste,
                ))
                .unwrap();
            history.record(&applied, &state, t0 + Duration::from_secs(n));
        }
        // 8 MiB keeps the four newest steps.
        assert_eq!(history.undo.len(), 4);
        let mut undone = 0;
        while history.step(&mut state, false) {
            undone += 1;
        }
        assert_eq!(undone, 4);
        assert_eq!(state.doc.len(), 2 * block.len());
    }

    #[test]
    fn typing_groups_into_single_composed_changeset_and_undoes_in_one_revision() {
        let mut state = EditorState::new("");
        let mut history = History::default();
        let t0 = Instant::now();
        for (i, ch) in ["h", "e", "l", "l", "o"].into_iter().enumerate() {
            type_at(
                &mut state,
                &mut history,
                i,
                ch,
                t0 + Duration::from_millis(50 * i as u64),
            );
        }
        assert_eq!(state.doc.as_str(), "hello");
        assert_eq!(state.revision, 5);
        assert_eq!(history.undo.len(), 1);
        assert_eq!(history.undo[0].changes.changes().len(), 1);
        assert_eq!(history.undo[0].changes.changes()[0].insert, "hello");

        // Undo applies a single ChangeSet, incrementing `revision` by 1 (not 5!).
        let rev_before = state.revision;
        assert!(history.step(&mut state, false));
        assert_eq!(state.revision, rev_before + 1);
        assert_eq!(state.doc.as_str(), "");

        // Redo also applies a single ChangeSet, incrementing `revision` by 1.
        assert!(history.step(&mut state, true));
        assert_eq!(state.revision, rev_before + 2);
        assert_eq!(state.doc.as_str(), "hello");
    }

    #[test]
    fn typing_groups_and_commands_split_steps() {
        let mut state = EditorState::new("");
        let mut history = History::default();
        let t0 = Instant::now();
        type_at(&mut state, &mut history, 0, "a", t0);
        type_at(
            &mut state,
            &mut history,
            1,
            "b",
            t0 + Duration::from_millis(100),
        );
        type_at(
            &mut state,
            &mut history,
            2,
            "c",
            t0 + Duration::from_millis(900),
        );
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
            .apply(Transaction::edit(
                ChangeSet::replace(0..2, "**ab**"),
                None,
                UserEvent::Command,
            ))
            .unwrap();
        history.record(&applied, &state, t0);
        assert!(!history.can_redo());
        assert!(history.step(&mut state, false));
        assert_eq!(state.doc.as_str(), "ab");
    }

    fn compose(
        state: &mut EditorState,
        history: &mut History,
        range: std::ops::Range<usize>,
        text: &str,
    ) {
        let caret = range.start + text.len();
        let tr = Transaction::edit(
            ChangeSet::replace(range, text),
            Some(Selection::cursor(caret)),
            UserEvent::Compose,
        );
        let applied = state.apply(tr).unwrap();
        history.record(&applied, state, Instant::now());
    }

    #[test]
    fn a_composition_is_one_sealed_step_whatever_its_pace() {
        let prefix = "line of context 中文 😀\n".repeat(100); // > 2 KB multi-leaf rope
        let base_len = prefix.len();
        let mut state = EditorState::new(&prefix);
        state.selection = Selection::cursor(base_len);
        let mut history = History::default();
        let t0 = Instant::now();
        type_at(&mut state, &mut history, base_len, "c", t0);
        history.begin_composition(&state);
        // Pinyin preedit updates, then the commit replaces them.
        for (from, text) in [
            (base_len + 1..base_len + 1, "n"),
            (base_len + 1..base_len + 2, "ni"),
            (base_len + 1..base_len + 3, "nih"),
            (base_len + 1..base_len + 4, "nihao"),
            (base_len + 1..base_len + 6, "你好"),
        ] {
            compose(&mut state, &mut history, from, text);
        }
        assert!(history.end_composition(&state, t0 + Duration::from_secs(9)));
        // Neither `apply` nor `end_composition` materialised `flat`!
        assert!(!state.doc.has_materialized_flat());
        assert!(state.doc.eq_str(&format!("{prefix}c你好")));

        // Typing right after the commit does not join the composition.
        type_at(
            &mut state,
            &mut history,
            base_len + 7,
            "d",
            t0 + Duration::from_secs(9),
        );
        assert!(history.step(&mut state, false));
        assert!(state.doc.eq_str(&format!("{prefix}c你好")));
        assert!(history.step(&mut state, false));
        assert!(state.doc.eq_str(&format!("{prefix}c")));
        assert_eq!(state.selection, Selection::cursor(base_len + 1));
        assert!(history.step(&mut state, true));
        assert!(state.doc.eq_str(&format!("{prefix}c你好")));
        assert!(!state.doc.has_materialized_flat());
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
        // Shared leading or trailing UTF-8 bytes inside different characters never split a character.
        let change = replacement(&Buffer::new("é"), &Buffer::new("è")).unwrap();
        assert_eq!(
            (
                change.changes()[0].range.clone(),
                change.changes()[0].insert.as_str()
            ),
            (0..2, "è")
        );
        let suffix_collision = replacement(&Buffer::new("é"), &Buffer::new("粤")).unwrap();
        assert_eq!(
            (
                suffix_collision.changes()[0].range.clone(),
                suffix_collision.changes()[0].insert.as_str()
            ),
            (0..2, "粤")
        );
        assert!(replacement(&before, &before).is_none());
    }
}
