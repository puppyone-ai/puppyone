//! Change sets in original-document coordinates (CodeMirror `ChangeSet`):
//! non-overlapping replacements, position mapping, composition, concurrent
//! mapping (`map_set`), application and inversion (`TA-02`, `TA-04`).
use super::buffer::Buffer;
use std::ops::Range;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub range: Range<usize>,
    pub insert: String,
}

/// Which side a position sticks to when an insertion happens exactly at it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Assoc {
    Before,
    After,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChangeSet {
    changes: Vec<Change>,
}

#[derive(Clone, Copy, Debug)]
enum Op<'a> {
    Retain(usize),
    Delete(usize),
    Insert(&'a [u8]),
}

impl<'a> Op<'a> {
    fn len(self) -> usize {
        match self {
            Self::Retain(n) | Self::Delete(n) => n,
            Self::Insert(s) => s.len(),
        }
    }

    fn consume(&mut self, n: usize) {
        match self {
            Self::Retain(rem) | Self::Delete(rem) => *rem -= n,
            Self::Insert(slice) => *slice = &slice[n..],
        }
    }
}

fn to_ops(changes: &[Change]) -> Vec<Op<'_>> {
    let mut ops = Vec::with_capacity(changes.len() * 3);
    let mut pos = 0usize;
    for c in changes {
        if c.range.start > pos {
            ops.push(Op::Retain(c.range.start - pos));
        }
        let del = c.range.end.saturating_sub(c.range.start);
        if del > 0 {
            ops.push(Op::Delete(del));
        }
        if !c.insert.is_empty() {
            ops.push(Op::Insert(c.insert.as_bytes()));
        }
        pos = pos.max(c.range.end);
    }
    ops
}

#[derive(Default)]
struct ChangeBuilder {
    changes: Vec<Change>,
    a_pos: usize,
    open_start: Option<usize>,
    open_del: usize,
    open_ins: Vec<u8>,
}

impl ChangeBuilder {
    fn retain(&mut self, n: usize) {
        if n == 0 {
            return;
        }
        self.flush();
        self.a_pos += n;
    }

    fn delete(&mut self, n: usize) {
        if n == 0 {
            return;
        }
        if self.open_start.is_none() {
            self.open_start = Some(self.a_pos);
        }
        self.open_del += n;
        self.a_pos += n;
    }

    fn insert(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        if self.open_start.is_none() {
            self.open_start = Some(self.a_pos);
        }
        self.open_ins.extend_from_slice(bytes);
    }

    fn flush(&mut self) {
        if let Some(start) = self.open_start.take() {
            let del = std::mem::take(&mut self.open_del);
            let ins_bytes = std::mem::take(&mut self.open_ins);
            if del > 0 || !ins_bytes.is_empty() {
                let insert = match String::from_utf8(ins_bytes) {
                    Ok(s) => s,
                    Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
                };
                self.changes.push(Change {
                    range: start..start + del,
                    insert,
                });
            }
        }
    }

    fn finish(mut self) -> ChangeSet {
        self.flush();
        ChangeSet {
            changes: self.changes,
        }
    }
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

    /// Build a sorted, non-overlapping `ChangeSet` (total: inverted or
    /// overlapping ranges are normalised rather than panicking).
    pub fn new(mut changes: Vec<Change>) -> Self {
        for c in &mut changes {
            if c.range.end < c.range.start {
                c.range = c.range.end..c.range.start;
            }
        }
        changes.retain(|c| !(c.range.is_empty() && c.insert.is_empty()));
        changes.sort_by_key(|c| (c.range.start, c.range.end));

        let mut merged: Vec<Change> = Vec::with_capacity(changes.len());
        for c in changes {
            if let Some(prev) = merged.last_mut()
                && (c.range.start < prev.range.end
                    || (c.range.start == prev.range.end
                        && prev.range.is_empty()
                        && c.range.is_empty()))
            {
                prev.range.end = prev.range.end.max(c.range.end);
                prev.insert.push_str(&c.insert);
                continue;
            }
            merged.push(c);
        }
        Self { changes: merged }
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
        (pos as isize + delta).max(0) as usize
    }

    pub fn apply(&self, buffer: &mut Buffer) {
        for change in self.changes.iter().rev() {
            buffer.replace(change.range.clone(), &change.insert);
        }
    }

    /// The change set that undoes `self` when applied to the result, using
    /// `Buffer::slice_cow` so the whole document is never materialised.
    pub fn invert(&self, before: &Buffer) -> ChangeSet {
        let mut delta: isize = 0;
        let changes = self
            .changes
            .iter()
            .map(|change| {
                let clamped = before.clamp_range(change.range.clone());
                let start = (clamped.start as isize + delta).max(0) as usize;
                delta += change.insert.len() as isize - clamped.len() as isize;
                Change {
                    range: start..start + change.insert.len(),
                    insert: before.slice_cow(clamped).into_owned(),
                }
            })
            .filter(|c| !(c.range.is_empty() && c.insert.is_empty()))
            .collect();
        ChangeSet { changes }
    }

    /// Compose sequential change sets `self: A -> B` and `other: B -> C` into a
    /// single canonical `ChangeSet: A -> C` (`TA-02`).
    pub fn compose(&self, other: &Self) -> Self {
        if self.is_empty() {
            return other.clone();
        }
        if other.is_empty() {
            return self.clone();
        }
        let mut ops_a = to_ops(&self.changes);
        let mut ops_b = to_ops(&other.changes);
        let (mut ia, mut ib) = (0usize, 0usize);
        let mut out = ChangeBuilder::default();

        while ia < ops_a.len() || ib < ops_b.len() {
            if let Some(Op::Delete(d)) = ops_a.get(ia).copied() {
                out.delete(d);
                ia += 1;
                continue;
            }
            if let Some(Op::Insert(s)) = ops_b.get(ib).copied() {
                out.insert(s);
                ib += 1;
                continue;
            }

            let a_avail = ops_a.get(ia).map_or(usize::MAX, |op| op.len());
            let b_avail = ops_b.get(ib).map_or(usize::MAX, |op| op.len());
            let len = a_avail.min(b_avail);
            debug_assert!(len > 0 && len < usize::MAX);

            match (ops_a.get(ia).copied(), ops_b.get(ib).copied()) {
                (Some(Op::Retain(_)) | None, Some(Op::Retain(_)) | None) => out.retain(len),
                (Some(Op::Insert(sa)), Some(Op::Retain(_)) | None) => out.insert(&sa[..len]),
                (Some(Op::Retain(_)) | None, Some(Op::Delete(_))) => out.delete(len),
                (Some(Op::Insert(_)), Some(Op::Delete(_))) => {}
                _ => unreachable!(),
            }

            if let Some(op) = ops_a.get_mut(ia) {
                op.consume(len);
                if op.len() == 0 {
                    ia += 1;
                }
            }
            if let Some(op) = ops_b.get_mut(ib) {
                op.consume(len);
                if op.len() == 0 {
                    ib += 1;
                }
            }
        }

        out.finish()
    }

    /// Map `self` (expressed on state `A`) over an intervening `other: A -> B`
    /// so the returned `ChangeSet` applies on `B` (`CodeMirror ChangeSet.map`,
    /// `before = false`).
    pub fn map_set(&self, other: &Self) -> Self {
        self.map_set_assoc(other, false)
    }

    /// Map `self` over `other` with explicit tie-breaking for simultaneous
    /// insertions at the exact same offset (`before = true` places `self`'s
    /// insertion before `other`'s).
    pub fn map_set_assoc(&self, other: &Self, before: bool) -> Self {
        if self.is_empty() || other.is_empty() {
            return self.clone();
        }
        let mut ops_a = to_ops(&self.changes);
        let mut ops_b = to_ops(&other.changes);
        let (mut ia, mut ib) = (0usize, 0usize);
        let mut out = ChangeBuilder::default();

        while ia < ops_a.len() || ib < ops_b.len() {
            match (ops_a.get(ia).copied(), ops_b.get(ib).copied()) {
                (Some(Op::Insert(sa)), Some(Op::Insert(sb))) => {
                    if before {
                        out.insert(sa);
                        ia += 1;
                    } else {
                        out.retain(sb.len());
                        ib += 1;
                    }
                    continue;
                }
                (Some(Op::Insert(sa)), _) => {
                    out.insert(sa);
                    ia += 1;
                    continue;
                }
                (_, Some(Op::Insert(sb))) => {
                    out.retain(sb.len());
                    ib += 1;
                    continue;
                }
                _ => {}
            }

            let a_avail = ops_a.get(ia).map_or(usize::MAX, |op| op.len());
            let b_avail = ops_b.get(ib).map_or(usize::MAX, |op| op.len());
            let len = a_avail.min(b_avail);
            debug_assert!(len > 0 && len < usize::MAX);

            match (ops_a.get(ia).copied(), ops_b.get(ib).copied()) {
                (Some(Op::Retain(_)) | None, Some(Op::Retain(_)) | None) => out.retain(len),
                (Some(Op::Delete(_)), Some(Op::Retain(_)) | None) => out.delete(len),
                (_, Some(Op::Delete(_))) => {}
                _ => unreachable!(),
            }

            if let Some(op) = ops_a.get_mut(ia) {
                op.consume(len);
                if op.len() == 0 {
                    ia += 1;
                }
            }
            if let Some(op) = ops_b.get_mut(ib) {
                op.consume(len);
                if op.len() == 0 {
                    ib += 1;
                }
            }
        }

        out.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0
        }
        fn range(&mut self, upper: usize) -> usize {
            if upper == 0 {
                0
            } else {
                (self.next() >> 16) as usize % upper
            }
        }
    }

    fn random_changeset(doc: &Buffer, rng: &mut Rng) -> ChangeSet {
        let text = doc.as_str();
        let bounds: Vec<usize> = text
            .char_indices()
            .map(|(i, _)| i)
            .chain(std::iter::once(text.len()))
            .collect();
        let count = 1 + rng.range(4);
        let mut cursor = 0usize;
        let mut changes = Vec::new();
        let tokens = ["", "a", "XYZ", "中文", "😀", "\n", "👨‍👩‍👧‍👦"];
        for _ in 0..count {
            if cursor >= bounds.len() {
                break;
            }
            let i0 = cursor + rng.range(bounds.len() - cursor);
            let i1 = i0 + rng.range((bounds.len() - i0).min(5));
            let r = bounds[i0]..bounds[i1];
            let ins = tokens[rng.range(tokens.len())];
            if !(r.is_empty() && ins.is_empty()) {
                changes.push(Change {
                    range: r,
                    insert: ins.to_owned(),
                });
            }
            cursor = (i1 + 1).min(bounds.len());
        }
        ChangeSet::new(changes)
    }

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

    #[test]
    fn compose_invert_and_map_set_satisfy_algebraic_laws_under_random_edits() {
        let mut rng = Rng(0xA1B2_C3D4_E5F6_0718);
        for _ in 0..500 {
            let base = Buffer::new("alpha 中文 😀\nbeta γδ\nthird line!");
            let cs1 = random_changeset(&base, &mut rng);

            let mut after1 = base.clone();
            cs1.apply(&mut after1);

            let cs2 = random_changeset(&after1, &mut rng);
            let mut after12 = after1.clone();
            cs2.apply(&mut after12);

            let cs3 = random_changeset(&after12, &mut rng);
            let mut after123 = after12.clone();
            cs3.apply(&mut after123);

            // Law 1: `compose` equivalence (`apply(cs1.compose(&cs2)) == apply(cs2, apply(cs1))`).
            let composed12 = cs1.compose(&cs2);
            let mut via_composed = base.clone();
            composed12.apply(&mut via_composed);
            assert_eq!(via_composed, after12);

            // Law 2: `compose` associativity (`(cs1 ∘ cs2) ∘ cs3 == cs1 ∘ (cs2 ∘ cs3)`).
            let lhs = composed12.compose(&cs3);
            let rhs = cs1.compose(&cs2.compose(&cs3));
            assert_eq!(lhs, rhs);
            let mut via_composed3 = base.clone();
            lhs.apply(&mut via_composed3);
            assert_eq!(via_composed3, after123);

            // Law 3: `invert` of composed changeset restores `base` in a single step!
            let inv12 = cs2.invert(&after1).compose(&cs1.invert(&base));
            let mut restored = after12.clone();
            inv12.apply(&mut restored);
            assert_eq!(restored, base);

            let direct_inv = composed12.invert(&base);
            let mut restored_direct = after12.clone();
            direct_inv.apply(&mut restored_direct);
            assert_eq!(restored_direct, base);

            // Law 4: Concurrent `map_set` diamond convergence (`cs_a` and `cs_b` both on `base`).
            let cs_b = random_changeset(&base, &mut rng);
            let mut branch_a = base.clone();
            cs1.apply(&mut branch_a);
            cs_b.map_set(&cs1).apply(&mut branch_a);

            let mut branch_b = base.clone();
            cs_b.apply(&mut branch_b);
            cs1.map_set_assoc(&cs_b, true).apply(&mut branch_b);

            assert_eq!(branch_a, branch_b);
        }
    }
}
