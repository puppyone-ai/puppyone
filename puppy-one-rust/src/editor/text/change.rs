//! Change sets in original-document coordinates (CodeMirror `ChangeSet`):
//! non-overlapping replacements, position mapping, application and inversion.
use super::buffer::Buffer;
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub range: Range<usize>,
    pub insert: String,
}

/// Which side a position sticks to when an insertion happens exactly at it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Assoc {
    Before,
    After,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChangeSet {
    changes: Vec<Change>,
}

impl ChangeSet {
    /// `historyChangeBytes`: what a step retains, as CodeMirror counts it
    /// (replaced plus inserted length, two bytes per unit).
    pub fn weight(&self) -> usize {
        self.changes
            .iter()
            .map(|c| (c.range.len() + c.insert.len()) * 2)
            .sum()
    }
    /// Changes must not overlap; they are sorted by start.
    pub fn new(mut changes: Vec<Change>) -> Self {
        changes.retain(|c| !(c.range.is_empty() && c.insert.is_empty()));
        changes.sort_by_key(|c| (c.range.start, c.range.end));
        debug_assert!(
            changes
                .windows(2)
                .all(|w| w[0].range.end <= w[1].range.start)
        );
        Self { changes }
    }
    pub fn replace(range: Range<usize>, insert: impl Into<String>) -> Self {
        Self::new(vec![Change {
            range,
            insert: insert.into(),
        }])
    }
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }
    pub fn changes(&self) -> &[Change] {
        &self.changes
    }
    /// Map a position in the old document to the new document.
    pub fn map(&self, pos: usize, assoc: Assoc) -> usize {
        let mut delta: isize = 0;
        for change in &self.changes {
            if pos < change.range.start
                || (pos == change.range.start && assoc == Assoc::Before && !change.range.is_empty())
            {
                break;
            }
            if pos == change.range.start && change.range.is_empty() {
                if assoc == Assoc::Before {
                    break;
                }
                delta += change.insert.len() as isize;
                continue;
            }
            if pos < change.range.end {
                // Inside a replaced range: move to its edge.
                let start = (change.range.start as isize + delta) as usize;
                return match assoc {
                    Assoc::Before => start,
                    Assoc::After => start + change.insert.len(),
                };
            }
            delta += change.insert.len() as isize - change.range.len() as isize;
        }
        (pos as isize + delta) as usize
    }
    pub fn apply(&self, buffer: &mut Buffer) {
        for change in self.changes.iter().rev() {
            buffer.replace(change.range.clone(), &change.insert);
        }
    }
    /// The change set that undoes `self` when applied to the result.
    pub fn invert(&self, before: &Buffer) -> ChangeSet {
        let mut delta: isize = 0;
        let changes = self
            .changes
            .iter()
            .map(|change| {
                let start = (change.range.start as isize + delta) as usize;
                delta += change.insert.len() as isize - change.range.len() as isize;
                Change {
                    range: start..start + change.insert.len(),
                    insert: before.slice(change.range.clone()).to_owned(),
                }
            })
            .collect();
        ChangeSet { changes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mapping_application_and_inversion_round_trip() {
        let mut buffer = Buffer::new("hello world");
        let set = ChangeSet::new(vec![
            Change {
                range: 0..5,
                insert: "hi".into(),
            },
            Change {
                range: 6..6,
                insert: "big ".into(),
            },
        ]);
        assert_eq!(set.map(8, Assoc::After), 9);
        assert_eq!(set.map(6, Assoc::Before), 3);
        assert_eq!(set.map(6, Assoc::After), 7);
        assert_eq!(set.map(2, Assoc::Before), 0);
        assert_eq!(set.map(2, Assoc::After), 2);
        let before = buffer.clone();
        set.apply(&mut buffer);
        assert_eq!(buffer.as_str(), "hi big world");
        set.invert(&before).apply(&mut buffer);
        assert_eq!(buffer, before);
    }
}
