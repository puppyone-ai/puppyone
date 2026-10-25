//! The main selection range (CodeMirror `SelectionRange`): anchor stays put,
//! head moves; `goal_x` keeps the horizontal target for vertical motion and
//! `upstream` says a head at a soft wrap belongs to the end of the earlier
//! row (CodeMirror `assoc = -1`).
use super::change::{Assoc, ChangeSet};
use std::ops::Range;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Selection {
    pub anchor: usize,
    pub head: usize,
    pub goal_x: Option<f32>,
    pub upstream: bool,
}

impl Selection {
    pub fn cursor(pos: usize) -> Self {
        Self {
            anchor: pos,
            head: pos,
            goal_x: None,
            upstream: false,
        }
    }
    pub fn range(anchor: usize, head: usize) -> Self {
        Self {
            anchor,
            head,
            goal_x: None,
            upstream: false,
        }
    }
    pub fn is_empty(&self) -> bool {
        self.anchor == self.head
    }
    pub fn from(&self) -> usize {
        self.anchor.min(self.head)
    }
    pub fn to(&self) -> usize {
        self.anchor.max(self.head)
    }
    pub fn as_range(&self) -> Range<usize> {
        self.from()..self.to()
    }
    pub fn map(&self, changes: &ChangeSet) -> Self {
        // Collapsed cursors follow typed text; ranges keep covering it.
        let (anchor_assoc, head_assoc) = if self.is_empty() {
            (Assoc::After, Assoc::After)
        } else if self.anchor <= self.head {
            (Assoc::Before, Assoc::After)
        } else {
            (Assoc::After, Assoc::Before)
        };
        Self {
            anchor: changes.map(self.anchor, anchor_assoc),
            head: changes.map(self.head, head_assoc),
            goal_x: None,
            upstream: false,
        }
    }
}
