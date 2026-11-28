//! Revision-stamped document positions that survive edits (`TA-03`): widget
//! identities, panel state, search matches, link presses and async completions
//! attach to `Anchor` / `AnchorRange` rather than raw byte offsets.
use super::{
    buffer::Buffer,
    change::{Assoc, ChangeSet},
};
use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Anchor {
    pub offset: usize,
    pub assoc: Assoc,
    pub revision: u64,
}

impl Anchor {
    pub const fn new(offset: usize, assoc: Assoc, revision: u64) -> Self {
        Self {
            offset,
            assoc,
            revision,
        }
    }

    pub const fn before(offset: usize, revision: u64) -> Self {
        Self::new(offset, Assoc::Before, revision)
    }

    pub const fn after(offset: usize, revision: u64) -> Self {
        Self::new(offset, Assoc::After, revision)
    }

    /// Translate `self` across `changes` and advance its `revision`.
    pub fn map(&mut self, changes: &ChangeSet, new_revision: u64) {
        self.offset = changes.map(self.offset, self.assoc);
        self.revision = new_revision;
    }

    pub fn mapped(mut self, changes: &ChangeSet, new_revision: u64) -> Self {
        self.map(changes, new_revision);
        self
    }

    /// Resolve to a valid character boundary in `doc` (`TA-04` total clamping).
    pub fn resolve(&self, doc: &Buffer) -> usize {
        doc.clamp(self.offset)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct AnchorRange {
    pub start: Anchor,
    pub end: Anchor,
}

impl AnchorRange {
    pub const fn new(start: Anchor, end: Anchor) -> Self {
        Self { start, end }
    }

    /// Range whose endpoints stick outward (`Before..After`), expanding when
    /// insertions happen right on its boundaries.
    pub const fn covering(range: Range<usize>, revision: u64) -> Self {
        Self {
            start: Anchor::before(range.start, revision),
            end: Anchor::after(range.end, revision),
        }
    }

    /// Range whose endpoints stick inward (`After..Before`), staying strictly
    /// inside edits placed on its boundaries.
    pub const fn inside(range: Range<usize>, revision: u64) -> Self {
        Self {
            start: Anchor::after(range.start, revision),
            end: Anchor::before(range.end, revision),
        }
    }

    pub fn map(&mut self, changes: &ChangeSet, new_revision: u64) {
        self.start.map(changes, new_revision);
        self.end.map(changes, new_revision);
    }

    pub fn mapped(mut self, changes: &ChangeSet, new_revision: u64) -> Self {
        self.map(changes, new_revision);
        self
    }

    /// Resolve to a valid clamped `start..end` (`start <= end`) in `doc`.
    pub fn resolve(&self, doc: &Buffer) -> Range<usize> {
        let s = self.start.resolve(doc);
        let e = self.end.resolve(doc).max(s);
        s..e
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors_and_ranges_track_insertions_deletions_and_clamp_safely() {
        let mut doc = Buffer::new("header\nblock body\nfooter");
        let block_start = 7;
        let block_end = 17;

        let mut before_anchor = Anchor::before(block_start, 0);
        let mut after_anchor = Anchor::after(block_start, 0);
        let mut inside_range = AnchorRange::inside(block_start..block_end, 0);
        let mut cover_range = AnchorRange::covering(block_start..block_end, 0);

        // Insert right at `block_start`.
        let cs1 = ChangeSet::replace(block_start..block_start, ">> ");
        cs1.apply(&mut doc);
        before_anchor.map(&cs1, 1);
        after_anchor.map(&cs1, 1);
        inside_range.map(&cs1, 1);
        cover_range.map(&cs1, 1);

        assert_eq!(before_anchor.resolve(&doc), 7);
        assert_eq!(after_anchor.resolve(&doc), 10);
        assert_eq!(before_anchor.revision, 1);
        assert_eq!(doc.slice(inside_range.resolve(&doc)), "block body");
        assert_eq!(doc.slice(cover_range.resolve(&doc)), ">> block body");

        // Edit above the block shifts everything identically.
        let cs2 = ChangeSet::replace(0..6, "title中文");
        cs2.apply(&mut doc);
        inside_range.map(&cs2, 2);
        assert_eq!(doc.slice(inside_range.resolve(&doc)), "block body");

        // Delete encompassing an anchor collapses it cleanly; out-of-bounds clamps.
        let cs3 = ChangeSet::replace(0..doc.len(), "中文");
        cs3.apply(&mut doc);
        let stale = Anchor::after(999, 0);
        assert_eq!(stale.resolve(&doc), doc.len());
        let mid_char = Anchor::before(1, 2);
        assert_eq!(mid_char.resolve(&doc), 0);

        inside_range.map(&cs3, 3);
        let resolved = inside_range.resolve(&doc);
        assert!(resolved.start <= resolved.end && resolved.end <= doc.len());
    }
}
