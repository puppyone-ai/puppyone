//! Persistent `Arc`-chunked counted B-tree of CSV rows (`CS-01`):
//! snapshots share untouched subtrees, `Row`s and `Arc<str>` cells; single-cell
//! updates copy only one `Row` and $O(\log R)$ spine nodes, and row
//! insert / delete / move are $O(\log R)$ pointer operations without copying
//! untouched cell strings.
use std::{ops::Index, sync::Arc};

const MIN_CHILDREN: usize = 16;
const MAX_CHILDREN: usize = 32;

/// Shared empty cell value so empty cells across rows/columns never allocate.
pub fn empty_cell() -> Arc<str> {
    static EMPTY: std::sync::OnceLock<Arc<str>> = std::sync::OnceLock::new();
    EMPTY.get_or_init(|| Arc::from("")).clone()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub id: u64,
    pub cells: Arc<Vec<Arc<str>>>,
    /// Original raw bytes of this record (without line separator) while untouched (`CS-04`).
    pub raw: Option<Arc<str>>,
    /// Newly inserted rows use canonical minimal quoting (`CS-04`).
    pub canonical: bool,
}

impl Row {
    pub fn new(id: u64, cells: Arc<Vec<Arc<str>>>, raw: Option<Arc<str>>, canonical: bool) -> Self {
        Self {
            id,
            cells,
            raw,
            canonical,
        }
    }

    pub fn cell(&self, column: usize) -> Option<&str> {
        self.cells.get(column).map(Arc::as_ref)
    }

    pub fn cell_or_empty(&self, column: usize) -> &str {
        self.cell(column).unwrap_or("")
    }
}

#[derive(Clone, Debug)]
enum Node {
    Leaf(Vec<Arc<Row>>),
    Internal {
        children: Vec<Arc<Node>>,
        counts: Vec<usize>,
        len: usize,
    },
}

impl Node {
    fn len(&self) -> usize {
        match self {
            Self::Leaf(items) => items.len(),
            Self::Internal { len, .. } => *len,
        }
    }

    fn entry_count(&self) -> usize {
        match self {
            Self::Leaf(items) => items.len(),
            Self::Internal { children, .. } => children.len(),
        }
    }

    fn make_internal(children: Vec<Arc<Node>>) -> Arc<Self> {
        let counts: Vec<usize> = children.iter().map(|c| c.len()).collect();
        let len = counts.iter().sum();
        Arc::new(Self::Internal {
            children,
            counts,
            len,
        })
    }

    fn get(&self, mut index: usize) -> Option<&Arc<Row>> {
        let mut cur = self;
        loop {
            match cur {
                Self::Leaf(items) => return items.get(index),
                Self::Internal {
                    children, counts, ..
                } => {
                    let mut found = None;
                    for (child, &count) in children.iter().zip(counts) {
                        if index < count {
                            found = Some(child.as_ref());
                            break;
                        }
                        index -= count;
                    }
                    cur = found?;
                }
            }
        }
    }

    fn set(&self, index: usize, row: Arc<Row>) -> Arc<Self> {
        match self {
            Self::Leaf(items) => {
                let mut next = items.clone();
                next[index] = row;
                Arc::new(Self::Leaf(next))
            }
            Self::Internal {
                children,
                counts,
                len,
            } => {
                let mut rem = index;
                let mut i = 0;
                while rem >= counts[i] {
                    rem -= counts[i];
                    i += 1;
                }
                let mut next_children = children.clone();
                next_children[i] = children[i].set(rem, row);
                Arc::new(Self::Internal {
                    children: next_children,
                    counts: counts.clone(),
                    len: *len,
                })
            }
        }
    }

    fn insert(&self, index: usize, row: Arc<Row>) -> (Arc<Self>, Option<Arc<Self>>) {
        match self {
            Self::Leaf(items) => {
                let mut next = items.clone();
                next.insert(index, row);
                if next.len() <= MAX_CHILDREN {
                    (Arc::new(Self::Leaf(next)), None)
                } else {
                    let right = next.split_off(MIN_CHILDREN);
                    (
                        Arc::new(Self::Leaf(next)),
                        Some(Arc::new(Self::Leaf(right))),
                    )
                }
            }
            Self::Internal {
                children,
                counts,
                len,
            } => {
                let mut rem = index;
                let mut i = 0;
                while i + 1 < counts.len() && rem >= counts[i] {
                    rem -= counts[i];
                    i += 1;
                }
                let (left_child, split_child) = children[i].insert(rem, row);
                let mut next_children = children.clone();
                let mut next_counts = counts.clone();
                next_counts[i] = left_child.len();
                next_children[i] = left_child;
                if let Some(right_child) = split_child {
                    next_counts.insert(i + 1, right_child.len());
                    next_children.insert(i + 1, right_child);
                }
                if next_children.len() <= MAX_CHILDREN {
                    (
                        Arc::new(Self::Internal {
                            children: next_children,
                            counts: next_counts,
                            len: len + 1,
                        }),
                        None,
                    )
                } else {
                    let right_children = next_children.split_off(MIN_CHILDREN);
                    let right_counts = next_counts.split_off(MIN_CHILDREN);
                    let left_len: usize = next_counts.iter().sum();
                    let right_len: usize = right_counts.iter().sum();
                    (
                        Arc::new(Self::Internal {
                            children: next_children,
                            counts: next_counts,
                            len: left_len,
                        }),
                        Some(Arc::new(Self::Internal {
                            children: right_children,
                            counts: right_counts,
                            len: right_len,
                        })),
                    )
                }
            }
        }
    }

    fn take_last_from_left(left: &Self, right: &Self) -> (Arc<Self>, Arc<Self>) {
        match (left, right) {
            (Self::Leaf(l), Self::Leaf(r)) => {
                let mut l = l.clone();
                let mut r = r.clone();
                let moved = l.pop().unwrap();
                r.insert(0, moved);
                (Arc::new(Self::Leaf(l)), Arc::new(Self::Leaf(r)))
            }
            (
                Self::Internal {
                    children: lc,
                    counts: lcnt,
                    len: llen,
                },
                Self::Internal {
                    children: rc,
                    counts: rcnt,
                    len: rlen,
                },
            ) => {
                let mut lc = lc.clone();
                let mut lcnt = lcnt.clone();
                let mut rc = rc.clone();
                let mut rcnt = rcnt.clone();
                let moved_child = lc.pop().unwrap();
                let moved_count = lcnt.pop().unwrap();
                rc.insert(0, moved_child);
                rcnt.insert(0, moved_count);
                (
                    Arc::new(Self::Internal {
                        children: lc,
                        counts: lcnt,
                        len: llen - moved_count,
                    }),
                    Arc::new(Self::Internal {
                        children: rc,
                        counts: rcnt,
                        len: rlen + moved_count,
                    }),
                )
            }
            _ => unreachable!("B-tree siblings always have identical height"),
        }
    }

    fn take_first_from_right(left: &Self, right: &Self) -> (Arc<Self>, Arc<Self>) {
        match (left, right) {
            (Self::Leaf(l), Self::Leaf(r)) => {
                let mut l = l.clone();
                let mut r = r.clone();
                let moved = r.remove(0);
                l.push(moved);
                (Arc::new(Self::Leaf(l)), Arc::new(Self::Leaf(r)))
            }
            (
                Self::Internal {
                    children: lc,
                    counts: lcnt,
                    len: llen,
                },
                Self::Internal {
                    children: rc,
                    counts: rcnt,
                    len: rlen,
                },
            ) => {
                let mut lc = lc.clone();
                let mut lcnt = lcnt.clone();
                let mut rc = rc.clone();
                let mut rcnt = rcnt.clone();
                let moved_child = rc.remove(0);
                let moved_count = rcnt.remove(0);
                lc.push(moved_child);
                lcnt.push(moved_count);
                (
                    Arc::new(Self::Internal {
                        children: lc,
                        counts: lcnt,
                        len: llen + moved_count,
                    }),
                    Arc::new(Self::Internal {
                        children: rc,
                        counts: rcnt,
                        len: rlen - moved_count,
                    }),
                )
            }
            _ => unreachable!("B-tree siblings always have identical height"),
        }
    }

    fn merge(left: &Self, right: &Self) -> Arc<Self> {
        match (left, right) {
            (Self::Leaf(l), Self::Leaf(r)) => {
                let mut combined = Vec::with_capacity(l.len() + r.len());
                combined.extend(l.iter().cloned());
                combined.extend(r.iter().cloned());
                Arc::new(Self::Leaf(combined))
            }
            (
                Self::Internal {
                    children: lc,
                    counts: lcnt,
                    len: llen,
                },
                Self::Internal {
                    children: rc,
                    counts: rcnt,
                    len: rlen,
                },
            ) => {
                let mut children = Vec::with_capacity(lc.len() + rc.len());
                children.extend(lc.iter().cloned());
                children.extend(rc.iter().cloned());
                let mut counts = Vec::with_capacity(lcnt.len() + rcnt.len());
                counts.extend_from_slice(lcnt);
                counts.extend_from_slice(rcnt);
                Arc::new(Self::Internal {
                    children,
                    counts,
                    len: llen + rlen,
                })
            }
            _ => unreachable!("B-tree siblings always have identical height"),
        }
    }

    fn remove(&self, index: usize) -> (Arc<Self>, Arc<Row>) {
        match self {
            Self::Leaf(items) => {
                let mut next = items.clone();
                let removed = next.remove(index);
                (Arc::new(Self::Leaf(next)), removed)
            }
            Self::Internal {
                children,
                counts,
                len,
            } => {
                let mut rem = index;
                let mut i = 0;
                while rem >= counts[i] {
                    rem -= counts[i];
                    i += 1;
                }
                let (updated, removed) = children[i].remove(rem);
                let mut next_children = children.clone();
                let mut next_counts = counts.clone();
                next_counts[i] = updated.len();
                next_children[i] = updated;

                if next_children[i].entry_count() < MIN_CHILDREN {
                    if i > 0 && next_children[i - 1].entry_count() > MIN_CHILDREN {
                        let (l, r) =
                            Self::take_last_from_left(&next_children[i - 1], &next_children[i]);
                        next_counts[i - 1] = l.len();
                        next_counts[i] = r.len();
                        next_children[i - 1] = l;
                        next_children[i] = r;
                    } else if i + 1 < next_children.len()
                        && next_children[i + 1].entry_count() > MIN_CHILDREN
                    {
                        let (l, r) =
                            Self::take_first_from_right(&next_children[i], &next_children[i + 1]);
                        next_counts[i] = l.len();
                        next_counts[i + 1] = r.len();
                        next_children[i] = l;
                        next_children[i + 1] = r;
                    } else if i > 0 {
                        let merged = Self::merge(&next_children[i - 1], &next_children[i]);
                        next_counts[i - 1] = merged.len();
                        next_children[i - 1] = merged;
                        next_children.remove(i);
                        next_counts.remove(i);
                    } else if next_children.len() > 1 {
                        let merged = Self::merge(&next_children[0], &next_children[1]);
                        next_counts[0] = merged.len();
                        next_children[0] = merged;
                        next_children.remove(1);
                        next_counts.remove(1);
                    }
                }
                (
                    Arc::new(Self::Internal {
                        children: next_children,
                        counts: next_counts,
                        len: len - 1,
                    }),
                    removed,
                )
            }
        }
    }
}

fn chunk_balanced<T: Clone>(items: Vec<T>) -> Vec<Vec<T>> {
    if items.len() <= MAX_CHILDREN {
        return vec![items];
    }
    let mut chunks: Vec<Vec<T>> = items
        .chunks(MAX_CHILDREN)
        .map(|slice| slice.to_vec())
        .collect();
    let n = chunks.len();
    if n >= 2 && chunks[n - 1].len() < MIN_CHILDREN {
        let tail = chunks.pop().unwrap();
        let mut combined = chunks.pop().unwrap();
        combined.extend(tail);
        let mid = combined.len() / 2;
        let right = combined.split_off(mid);
        chunks.push(combined);
        chunks.push(right);
    }
    chunks
}

/// Persistent row sequence backed by an `Arc` B-tree (`CS-01`).
#[derive(Clone, Debug)]
pub struct RowVec {
    root: Arc<Node>,
}

impl Default for RowVec {
    fn default() -> Self {
        Self::new()
    }
}

impl PartialEq for RowVec {
    fn eq(&self, other: &Self) -> bool {
        if Arc::ptr_eq(&self.root, &other.root) {
            return true;
        }
        if self.len() != other.len() {
            return false;
        }
        self.iter()
            .zip(other.iter())
            .all(|(a, b)| Arc::ptr_eq(a, b) || a == b)
    }
}

impl Eq for RowVec {}

impl RowVec {
    pub fn new() -> Self {
        Self {
            root: Arc::new(Node::Leaf(Vec::new())),
        }
    }

    pub fn from_vec(rows: Vec<Arc<Row>>) -> Self {
        if rows.is_empty() {
            return Self::new();
        }
        let mut nodes: Vec<Arc<Node>> = chunk_balanced(rows)
            .into_iter()
            .map(|leaf| Arc::new(Node::Leaf(leaf)))
            .collect();
        while nodes.len() > 1 {
            nodes = chunk_balanced(nodes)
                .into_iter()
                .map(Node::make_internal)
                .collect();
        }
        Self {
            root: nodes.pop().unwrap(),
        }
    }

    /// Approximate spine bytes allocated by a path update ($O(\log R)$).
    pub fn spine_delta_bytes(&self) -> usize {
        let mut depth = 1usize;
        let mut cur = self.root.as_ref();
        while let Node::Internal { children, .. } = cur {
            depth += 1;
            match children.first() {
                Some(first) => cur = first.as_ref(),
                None => break,
            }
        }
        depth * MAX_CHILDREN * std::mem::size_of::<usize>()
    }

    pub fn len(&self) -> usize {
        self.root.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn get(&self, index: usize) -> Option<&Row> {
        self.root.get(index).map(Arc::as_ref)
    }

    pub fn get_arc(&self, index: usize) -> Option<&Arc<Row>> {
        self.root.get(index)
    }

    pub fn set(&self, index: usize, row: Arc<Row>) -> Self {
        assert!(index < self.len(), "row index {index} out of bounds");
        Self {
            root: self.root.set(index, row),
        }
    }

    pub fn insert(&self, index: usize, row: Arc<Row>) -> Self {
        let index = index.min(self.len());
        let (left, split) = self.root.insert(index, row);
        let root = match split {
            None => left,
            Some(right) => Node::make_internal(vec![left, right]),
        };
        Self { root }
    }

    pub fn remove(&self, index: usize) -> (Self, Arc<Row>) {
        assert!(index < self.len(), "row index {index} out of bounds");
        let (next, removed) = self.root.remove(index);
        let root = match next.as_ref() {
            Node::Internal { len: 0, .. } => Arc::new(Node::Leaf(Vec::new())),
            Node::Internal { children, .. } if children.len() == 1 => children[0].clone(),
            _ => next,
        };
        (Self { root }, removed)
    }

    pub fn move_row(&self, from: usize, to: usize) -> Self {
        if from == to || from >= self.len() {
            return self.clone();
        }
        let (without, row) = self.remove(from);
        without.insert(to.min(without.len()), row)
    }

    pub fn iter(&self) -> RowIter<'_> {
        RowIter::new(self, 0..self.len())
    }

    pub fn range(&self, range: std::ops::Range<usize>) -> RowIter<'_> {
        let end = range.end.min(self.len());
        let start = range.start.min(end);
        RowIter::new(self, start..end)
    }
}

impl Index<usize> for RowVec {
    type Output = Row;

    fn index(&self, index: usize) -> &Self::Output {
        self.get(index).expect("row index out of bounds")
    }
}

pub struct RowIter<'a> {
    stack: Vec<(&'a Node, usize)>,
    remaining: usize,
}

impl<'a> RowIter<'a> {
    fn new(tree: &'a RowVec, range: std::ops::Range<usize>) -> Self {
        let remaining = range.len();
        if remaining == 0 {
            return Self {
                stack: Vec::new(),
                remaining: 0,
            };
        }
        let mut stack = Vec::with_capacity(6);
        let mut cur = tree.root.as_ref();
        let mut offset = range.start;
        loop {
            match cur {
                Node::Leaf(_) => {
                    stack.push((cur, offset));
                    break;
                }
                Node::Internal {
                    children, counts, ..
                } => {
                    let mut i = 0;
                    while i + 1 < counts.len() && offset >= counts[i] {
                        offset -= counts[i];
                        i += 1;
                    }
                    stack.push((cur, i));
                    cur = children[i].as_ref();
                }
            }
        }
        Self { stack, remaining }
    }
}

impl<'a> Iterator for RowIter<'a> {
    type Item = &'a Arc<Row>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        loop {
            let (node, idx) = self.stack.last_mut()?;
            match node {
                Node::Leaf(items) => {
                    if *idx < items.len() {
                        let item = &items[*idx];
                        *idx += 1;
                        self.remaining -= 1;
                        return Some(item);
                    }
                    self.stack.pop();
                    if let Some((_, parent_idx)) = self.stack.last_mut() {
                        *parent_idx += 1;
                    }
                }
                Node::Internal { children, .. } => {
                    if *idx < children.len() {
                        let child = children[*idx].as_ref();
                        self.stack.push((child, 0));
                    } else {
                        self.stack.pop();
                        if let Some((_, parent_idx)) = self.stack.last_mut() {
                            *parent_idx += 1;
                        }
                    }
                }
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}

impl ExactSizeIterator for RowIter<'_> {}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_row(id: u64, val: &str) -> Arc<Row> {
        Arc::new(Row::new(id, Arc::new(vec![Arc::from(val)]), None, false))
    }

    #[test]
    fn persistent_tree_shares_untouched_rows_across_edits_inserts_removes_and_moves() {
        let initial: Vec<Arc<Row>> = (0..500)
            .map(|i| make_row(i as u64 + 1, &format!("r{i}")))
            .collect();
        let v0 = RowVec::from_vec(initial);
        assert_eq!(v0.len(), 500);

        let v1 = v0.set(250, make_row(251, "edited"));
        assert_eq!(v0[250].cell_or_empty(0), "r250");
        assert_eq!(v1[250].cell_or_empty(0), "edited");
        // Untouched rows share exact Arc<Row> allocations!
        assert!(Arc::ptr_eq(v0.get_arc(0).unwrap(), v1.get_arc(0).unwrap()));
        assert!(Arc::ptr_eq(
            v0.get_arc(499).unwrap(),
            v1.get_arc(499).unwrap()
        ));

        // Insert and remove across multiple leaf splits/merges match a reference Vec.
        let mut tree = v1;
        let mut reference: Vec<Arc<Row>> = tree.iter().cloned().collect();
        for step in 0..120usize {
            let at = (step * 37) % (tree.len() + 1);
            let r = make_row(10_000 + step as u64, &format!("ins{step}"));
            tree = tree.insert(at, r.clone());
            reference.insert(at, r);
        }
        for step in 0..200usize {
            let at = (step * 53) % tree.len();
            let (next, removed) = tree.remove(at);
            let expected = reference.remove(at);
            assert!(Arc::ptr_eq(&removed, &expected));
            tree = next;
        }
        tree = tree.move_row(10, 300);
        let moved = reference.remove(10);
        reference.insert(300, moved);

        assert_eq!(tree.len(), reference.len());
        for (i, expected) in reference.iter().enumerate() {
            assert!(Arc::ptr_eq(tree.get_arc(i).unwrap(), expected));
        }
        let slice: Vec<u64> = tree.range(100..150).map(|r| r.id).collect();
        let expected_slice: Vec<u64> = reference[100..150].iter().map(|r| r.id).collect();
        assert_eq!(slice, expected_slice);
    }
}
