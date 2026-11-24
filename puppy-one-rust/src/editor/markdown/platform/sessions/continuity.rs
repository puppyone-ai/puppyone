//! How a widget's presentation sessions follow its source through a
//! transaction (TS `embeddedInlineViewportSession.ts` continuity types).
//!
//! A [`Continuity`] effect says a replaced source range is still the same
//! widget, and how its items (a table's columns) moved. Without one, a
//! transaction that touches a session's range ends the session, and one that
//! does not only moves it. The effect is invertible, so undo and redo carry
//! it too (`markdownInlineViewportHistoryExtension`).
use crate::editor::text::{
    change::{Assoc, ChangeSet},
    state::{Applied, StateEffect},
};
use std::ops::Range;

/// How the items of a widget changed (`EmbeddedInlineViewportSequenceChange`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SequenceChange {
    Preserve,
    Insert { index: usize, count: usize },
    Delete { index: usize, count: usize },
    Move { from: usize, to: usize },
}

impl SequenceChange {
    /// `invertEmbeddedInlineViewportSequenceChange`.
    pub fn invert(self) -> Self {
        match self {
            Self::Insert { index, count } => Self::Delete { index, count },
            Self::Delete { index, count } => Self::Insert { index, count },
            Self::Move { from, to } => Self::Move { from: to, to: from },
            Self::Preserve => Self::Preserve,
        }
    }
}

/// `EmbeddedInlineViewportContinuity`: the widget at `old` is the widget at
/// `new` after the transaction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Continuity {
    pub feature: &'static str,
    pub old: Range<usize>,
    pub new: Range<usize>,
    pub change: SequenceChange,
}

impl Continuity {
    pub fn inverse(&self) -> Self {
        Self {
            feature: self.feature,
            old: self.new.clone(),
            new: self.old.clone(),
            change: self.change.invert(),
        }
    }

    /// The transaction effect, kept by history with its inverse.
    pub fn effect(self) -> StateEffect {
        let inverse = self.inverse();
        StateEffect::invertible(self, inverse)
    }
}

/// `EmbeddedInlineViewportTransactionMapping`.
pub struct Mapping<'a> {
    pub continuities: Vec<Continuity>,
    pub map_pos: &'a dyn Fn(usize, Assoc) -> usize,
    pub touches: &'a dyn Fn(&Range<usize>) -> bool,
    /// Every change touching the range lies inside it, past its first
    /// character (a cell edit): the widget continues with its items kept.
    pub inside: &'a dyn Fn(&Range<usize>) -> bool,
}

impl Mapping<'_> {
    /// Where the session at `range` continues and how its items changed: an
    /// explicit continuity, or the items kept for an edit inside it. `None`
    /// when the transaction does not continue it.
    pub fn continuity(
        &self,
        feature: &str,
        range: &Range<usize>,
    ) -> Option<(Range<usize>, SequenceChange)> {
        if let Some(c) = self
            .continuities
            .iter()
            .find(|c| c.feature == feature && c.old == *range)
        {
            return Some((c.new.clone(), c.change));
        }
        ((self.touches)(range) && (self.inside)(range))
            .then(|| (self.map_range(range), SequenceChange::Preserve))
    }

    /// `mapSourceRange`.
    pub fn map_range(&self, range: &Range<usize>) -> Range<usize> {
        let from = (self.map_pos)(range.start, Assoc::After);
        let to = (self.map_pos)(range.end, Assoc::Before);
        from.min(to)..from.max(to)
    }
}

/// The continuities a transaction carries.
pub fn continuities(applied: &Applied) -> Vec<Continuity> {
    applied
        .effects
        .iter()
        .filter_map(|e| e.downcast_ref::<Continuity>().cloned())
        .collect()
}

/// Whether `changes` touch `range` (the product's `touchesRange`): an
/// insertion strictly inside it, or a replacement overlapping it.
pub fn touches(changes: &ChangeSet, range: &Range<usize>) -> bool {
    changes
        .changes()
        .iter()
        .any(|c| touches_one(&c.range, range))
}

/// Whether every change touching `range` lies inside it, after its first
/// character and before its end.
pub fn inside(changes: &ChangeSet, range: &Range<usize>) -> bool {
    changes
        .changes()
        .iter()
        .filter(|c| touches_one(&c.range, range))
        .all(|c| c.range.start > range.start && c.range.end < range.end)
}

fn touches_one(change: &Range<usize>, range: &Range<usize>) -> bool {
    if change.is_empty() {
        change.start > range.start && change.start < range.end
    } else {
        change.start < range.end && change.end > range.start
    }
}

/// The mapping of one applied transaction.
pub fn with_mapping<R>(applied: &Applied, f: impl FnOnce(&Mapping) -> R) -> R {
    let changes = &applied.changes;
    let map_pos = |pos, assoc| changes.map(pos, assoc);
    let touches = |range: &Range<usize>| touches(changes, range);
    let inside = |range: &Range<usize>| inside(changes, range);
    f(&Mapping {
        continuities: continuities(applied),
        map_pos: &map_pos,
        touches: &touches,
        inside: &inside,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_cell_edit_is_inside_and_a_replacement_from_the_start_is_not() {
        let table = 10..40;
        let cell = ChangeSet::replace(14..16, "xyz");
        assert!(touches(&cell, &table) && inside(&cell, &table));
        let rewrite = ChangeSet::replace(10..40, "| a |");
        assert!(touches(&rewrite, &table) && !inside(&rewrite, &table));
        let before = ChangeSet::replace(10..10, "intro\n");
        assert!(!touches(&before, &table));
        let after = ChangeSet::replace(40..40, "\n");
        assert!(!touches(&after, &table));
        let across = ChangeSet::replace(30..45, "");
        assert!(touches(&across, &table) && !inside(&across, &table));
    }
}
