//! Balanced `Arc`-shared B-tree rope with byte, UTF-16 and line-break summaries
//! (`TA-01`, `TA-04`). Cloning a `Rope` is `O(1)` (`Arc::clone`), queries are
//! `O(log n)` without materialising a flat string, and every offset/range entry
//! point clamps out-of-bounds or mid-codepoint positions safely.
use std::{
    borrow::Cow,
    ops::{Add, AddAssign, Range, Sub},
    sync::Arc,
};

const MIN_LEAF: usize = 480;
const TARGET_LEAF: usize = 768;
const MAX_LEAF: usize = 1024;

const MIN_CHILDREN: usize = 8;
const TARGET_CHILDREN: usize = 12;
const MAX_CHILDREN: usize = 16;

/// Monoid summary stored on every rope node.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TextSummary {
    pub bytes: usize,
    pub utf16: usize,
    /// Number of `'\n'` bytes inside the subtree.
    pub lines: usize,
}

impl TextSummary {
    pub fn of(text: &str) -> Self {
        let mut utf16 = 0usize;
        let mut lines = 0usize;
        for &b in text.as_bytes() {
            // Non-continuation UTF-8 bytes start a scalar (1 UTF-16 unit);
            // 4-byte scalars (`>= 0xF0`) add the second surrogate unit.
            utf16 += ((b & 0xC0) != 0x80) as usize + (b >= 0xF0) as usize;
            lines += (b == b'\n') as usize;
        }
        Self {
            bytes: text.len(),
            utf16,
            lines,
        }
    }
}

impl Add for TextSummary {
    type Output = Self;

    fn add(self, rhs: Self) -> Self {
        Self {
            bytes: self.bytes + rhs.bytes,
            utf16: self.utf16 + rhs.utf16,
            lines: self.lines + rhs.lines,
        }
    }
}

impl AddAssign for TextSummary {
    fn add_assign(&mut self, rhs: Self) {
        self.bytes += rhs.bytes;
        self.utf16 += rhs.utf16;
        self.lines += rhs.lines;
    }
}

impl Sub for TextSummary {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self {
        Self {
            bytes: self.bytes - rhs.bytes,
            utf16: self.utf16 - rhs.utf16,
            lines: self.lines - rhs.lines,
        }
    }
}

#[derive(Clone, Debug)]
enum Node {
    Leaf {
        text: String,
        summary: TextSummary,
    },
    Internal {
        children: Vec<Arc<Node>>,
        summary: TextSummary,
        height: u8,
    },
}

impl Node {
    fn leaf(text: String) -> Self {
        let summary = TextSummary::of(&text);
        Self::Leaf { text, summary }
    }

    fn internal(children: Vec<Arc<Node>>) -> Self {
        debug_assert!(children.len() >= 2 && children.len() <= MAX_CHILDREN);
        let height = children[0].height() + 1;
        let mut summary = TextSummary::default();
        for child in &children {
            debug_assert_eq!(child.height() + 1, height);
            summary += child.summary();
        }
        Self::Internal {
            children,
            summary,
            height,
        }
    }

    fn summary(&self) -> TextSummary {
        match self {
            Self::Leaf { summary, .. } | Self::Internal { summary, .. } => *summary,
        }
    }

    fn height(&self) -> u8 {
        match self {
            Self::Leaf { .. } => 0,
            Self::Internal { height, .. } => *height,
        }
    }
}

/// Persistent balanced B-tree UTF-8 rope (`Send + Sync`, `O(1)` clone).
#[derive(Clone, Debug)]
pub struct Rope {
    root: Arc<Node>,
}

impl Default for Rope {
    fn default() -> Self {
        Self::empty()
    }
}

impl Rope {
    pub fn empty() -> Self {
        Self {
            root: Arc::new(Node::leaf(String::new())),
        }
    }

    pub fn from_owned(text: String) -> Self {
        if text.len() <= MAX_LEAF {
            return Self {
                root: Arc::new(Node::leaf(text)),
            };
        }
        Self::from_leaves(split_str_into_leaves(&text))
    }

    pub fn from_text(text: &str) -> Self {
        if text.is_empty() {
            return Self::empty();
        }
        let leaves = split_str_into_leaves(text);
        Self::from_leaves(leaves)
    }

    fn from_leaves(mut nodes: Vec<Arc<Node>>) -> Self {
        if nodes.is_empty() {
            return Self::empty();
        }
        while nodes.len() > 1 {
            let mut next_level: Vec<Arc<Node>> =
                Vec::with_capacity(nodes.len().div_ceil(TARGET_CHILDREN));
            let mut i = 0;
            while i < nodes.len() {
                let rem = nodes.len() - i;
                if rem <= MAX_CHILDREN {
                    if rem < MIN_CHILDREN
                        && let Some(prev_arc) = next_level.pop()
                    {
                        let prev_children = match Arc::try_unwrap(prev_arc) {
                            Ok(Node::Internal { children, .. }) => children,
                            Err(arc) => match arc.as_ref() {
                                Node::Internal { children, .. } => children.clone(),
                                Node::Leaf { .. } => unreachable!(),
                            },
                            Ok(Node::Leaf { .. }) => unreachable!(),
                        };
                        let mut combined = prev_children;
                        combined.extend_from_slice(&nodes[i..]);
                        if combined.len() <= MAX_CHILDREN {
                            next_level.push(Arc::new(Node::internal(combined)));
                        } else {
                            let mid = combined.len() / 2;
                            let right = combined.split_off(mid);
                            next_level.push(Arc::new(Node::internal(combined)));
                            next_level.push(Arc::new(Node::internal(right)));
                        }
                    } else {
                        next_level.push(Arc::new(Node::internal(nodes[i..].to_vec())));
                    }
                    break;
                }
                let end = i + TARGET_CHILDREN;
                next_level.push(Arc::new(Node::internal(nodes[i..end].to_vec())));
                i = end;
            }
            nodes = next_level;
        }
        Self {
            root: nodes.pop().unwrap(),
        }
    }

    fn from_valid_nonroot_children(mut children: Vec<Arc<Node>>) -> Self {
        match children.len() {
            0 => Self::empty(),
            1 => Self {
                root: children.pop().unwrap(),
            },
            2..=MAX_CHILDREN => Self {
                root: Arc::new(Node::internal(children)),
            },
            _ => {
                let mid = children.len() / 2;
                let right = children.split_off(mid);
                Self {
                    root: Arc::new(Node::internal(vec![
                        Arc::new(Node::internal(children)),
                        Arc::new(Node::internal(right)),
                    ])),
                }
            }
        }
    }

    pub fn ptr_eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.root, &other.root)
    }

    pub fn summary(&self) -> TextSummary {
        self.root.summary()
    }

    pub fn len(&self) -> usize {
        self.root.summary().bytes
    }

    pub fn len_utf16(&self) -> usize {
        self.root.summary().utf16
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn line_count(&self) -> usize {
        self.root.summary().lines + 1
    }

    /// Clamp `offset` to `<= self.len()` and snap backward to a valid UTF-8
    /// character boundary in `O(log n)`.
    pub fn clamp(&self, offset: usize) -> usize {
        let len = self.len();
        if offset >= len {
            return len;
        }
        if offset == 0 {
            return 0;
        }
        let mut node = self.root.as_ref();
        let mut base = 0usize;
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    let mut local = offset - base;
                    while !text.is_char_boundary(local) {
                        local -= 1;
                    }
                    return base + local;
                }
                Node::Internal { children, .. } => {
                    let mut chosen = None;
                    for child in children {
                        let cb = child.summary().bytes;
                        if offset < base + cb {
                            chosen = Some(child.as_ref());
                            break;
                        }
                        base += cb;
                    }
                    node = chosen.expect("offset < len must fall inside a child");
                }
            }
        }
    }

    /// Clamp both endpoints of `range` to valid character boundaries and enforce
    /// `start <= end`.
    pub fn clamp_range(&self, range: Range<usize>) -> Range<usize> {
        let start = self.clamp(range.start);
        let end = self.clamp(range.end).max(start);
        start..end
    }

    /// 0-based line index containing `offset` (a `'\n'` belongs to the line it
    /// terminates; out-of-bounds offsets clamp to `self.len()`).
    pub fn line_index(&self, offset: usize) -> usize {
        let pos = offset.min(self.len());
        if pos == self.len() {
            return self.root.summary().lines;
        }
        if pos == 0 {
            return 0;
        }
        let mut node = self.root.as_ref();
        let mut byte_acc = 0usize;
        let mut line_acc = 0usize;
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    let local = pos - byte_acc;
                    line_acc += text.as_bytes()[..local]
                        .iter()
                        .filter(|&&b| b == b'\n')
                        .count();
                    return line_acc;
                }
                Node::Internal { children, .. } => {
                    let mut chosen = None;
                    for child in children {
                        let s = child.summary();
                        if pos < byte_acc + s.bytes {
                            chosen = Some(child.as_ref());
                            break;
                        }
                        byte_acc += s.bytes;
                        line_acc += s.lines;
                    }
                    node = chosen.expect("pos < len must fall inside a child");
                }
            }
        }
    }

    /// Byte offset of the `k`-th `'\n'` (0-indexed), given `k < summary.lines`.
    fn nth_newline(&self, k: usize) -> usize {
        debug_assert!(k < self.root.summary().lines);
        let mut node = self.root.as_ref();
        let mut rem = k;
        let mut byte_acc = 0usize;
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    for (idx, &b) in text.as_bytes().iter().enumerate() {
                        if b == b'\n' {
                            if rem == 0 {
                                return byte_acc + idx;
                            }
                            rem -= 1;
                        }
                    }
                    unreachable!("k < summary.lines must find newline in leaf");
                }
                Node::Internal { children, .. } => {
                    let mut chosen = None;
                    for child in children {
                        let s = child.summary();
                        if rem < s.lines {
                            chosen = Some(child.as_ref());
                            break;
                        }
                        rem -= s.lines;
                        byte_acc += s.bytes;
                    }
                    node = chosen.expect("k < summary.lines must fall inside a child");
                }
            }
        }
    }

    /// Byte range of 0-based `line` excluding its trailing `'\n'`. Total:
    /// `line >= self.line_count()` clamps to `self.len()..self.len()`.
    pub fn line_range(&self, line: usize) -> Range<usize> {
        let total_newlines = self.root.summary().lines;
        if line > total_newlines {
            let end = self.len();
            return end..end;
        }
        let start = if line == 0 {
            0
        } else {
            self.nth_newline(line - 1) + 1
        };
        let end = if line == total_newlines {
            self.len()
        } else {
            self.nth_newline(line)
        };
        start..end
    }

    /// Convert a UTF-8 byte offset to a UTF-16 code-unit offset in `O(log n)`,
    /// clamping out-of-bounds or mid-codepoint offsets backward first.
    pub fn byte_to_utf16(&self, offset: usize) -> usize {
        if offset >= self.len() {
            return self.len_utf16();
        }
        if offset == 0 {
            return 0;
        }
        let mut node = self.root.as_ref();
        let mut byte_acc = 0usize;
        let mut utf16_acc = 0usize;
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    let mut local = offset - byte_acc;
                    while !text.is_char_boundary(local) {
                        local -= 1;
                    }
                    return utf16_acc + TextSummary::of(&text[..local]).utf16;
                }
                Node::Internal { children, .. } => {
                    let mut chosen = None;
                    for child in children {
                        let s = child.summary();
                        if offset < byte_acc + s.bytes {
                            chosen = Some(child.as_ref());
                            break;
                        }
                        byte_acc += s.bytes;
                        utf16_acc += s.utf16;
                    }
                    node = chosen.expect("offset < len must fall inside a child");
                }
            }
        }
    }

    /// Convert a UTF-16 code-unit offset to a UTF-8 byte offset in `O(log n)`.
    /// An offset landing inside a surrogate pair resolves to the end of its
    /// character (matching `from_utf16` platform IME semantics).
    pub fn utf16_to_byte(&self, offset16: usize) -> usize {
        if offset16 >= self.len_utf16() {
            return self.len();
        }
        if offset16 == 0 {
            return 0;
        }
        let mut node = self.root.as_ref();
        let mut byte_acc = 0usize;
        let mut utf16_acc = 0usize;
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    let target = offset16 - utf16_acc;
                    let mut units = 0usize;
                    for (byte, ch) in text.char_indices() {
                        if units >= target {
                            return byte_acc + byte;
                        }
                        units += ch.len_utf16();
                    }
                    return byte_acc + text.len();
                }
                Node::Internal { children, .. } => {
                    let mut chosen = None;
                    for child in children {
                        let s = child.summary();
                        if offset16 < utf16_acc + s.utf16 {
                            chosen = Some(child.as_ref());
                            break;
                        }
                        byte_acc += s.bytes;
                        utf16_acc += s.utf16;
                    }
                    node = chosen.expect("offset16 < len_utf16 must fall inside a child");
                }
            }
        }
    }

    /// If `range` (already clamped) lies within a single leaf, borrow `&str`
    /// directly without allocating.
    pub fn try_slice_single_leaf(&self, range: Range<usize>) -> Option<&str> {
        let range = self.clamp_range(range);
        if range.is_empty() {
            return Some("");
        }
        let mut node = self.root.as_ref();
        let mut base = 0usize;
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    let s = range.start - base;
                    let e = range.end - base;
                    return (e <= text.len()).then(|| &text[s..e]);
                }
                Node::Internal { children, .. } => {
                    let mut chosen = None;
                    for child in children {
                        let cb = child.summary().bytes;
                        if range.start < base + cb {
                            if range.end > base + cb {
                                return None;
                            }
                            chosen = Some(child.as_ref());
                            break;
                        }
                        base += cb;
                    }
                    node = chosen?;
                }
            }
        }
    }

    /// Total zero-copy-when-possible slice: borrows directly from a leaf chunk
    /// when `range` fits inside one leaf, or assembles an owned `String` across
    /// leaf boundaries.
    pub fn slice_cow(&self, range: Range<usize>) -> Cow<'_, str> {
        let range = self.clamp_range(range);
        if let Some(borrowed) = self.try_slice_single_leaf(range.clone()) {
            return Cow::Borrowed(borrowed);
        }
        let mut out = String::with_capacity(range.len());
        for chunk in self.chunks_in(range) {
            out.push_str(chunk);
        }
        Cow::Owned(out)
    }

    /// Materialise the entire rope into a newly allocated `String`.
    pub fn to_string_flat(&self) -> String {
        let mut out = String::with_capacity(self.len());
        for chunk in self.chunks_in(0..self.len()) {
            out.push_str(chunk);
        }
        out
    }

    /// Stream `&str` leaf slices covering `range` (clamped) in `O(log n + k)` time.
    pub fn chunks_in(&self, range: Range<usize>) -> Chunks<'_> {
        let range = self.clamp_range(range);
        Chunks::new(&self.root, range)
    }

    /// Stream `&str` leaf slices covering `range` (clamped) in reverse order.
    pub(crate) fn rev_chunks_in(&self, range: Range<usize>) -> RevChunks<'_> {
        let range = self.clamp_range(range);
        RevChunks::new(&self.root, range)
    }

    /// Compare against a `&str` without materialising a flat `String`.
    pub fn eq_str(&self, other: &str) -> bool {
        if self.len() != other.len() {
            return false;
        }
        let mut pos = 0usize;
        for chunk in self.chunks_in(0..self.len()) {
            let next = pos + chunk.len();
            if &other.as_bytes()[pos..next] != chunk.as_bytes() {
                return false;
            }
            pos = next;
        }
        true
    }

    /// Length in bytes of the longest common byte prefix between `self` and
    /// `other`, skipping `Arc::ptr_eq` subtrees in `O(log n)`.
    pub fn common_prefix_bytes(&self, other: &Self) -> usize {
        if self.ptr_eq(other) {
            return self.len();
        }
        let mut skip = 0usize;
        let mut na = self.root.as_ref();
        let mut nb = other.root.as_ref();
        while let (
            Node::Internal {
                children: ca,
                height: ha,
                ..
            },
            Node::Internal {
                children: cb,
                height: hb,
                ..
            },
        ) = (na, nb)
        {
            if ha != hb {
                break;
            }
            let mut diverged = None;
            for (a, b) in ca.iter().zip(cb.iter()) {
                if Arc::ptr_eq(a, b) {
                    skip += a.summary().bytes;
                } else {
                    diverged = Some((a.as_ref(), b.as_ref()));
                    break;
                }
            }
            match diverged {
                Some((da, db)) => {
                    na = da;
                    nb = db;
                }
                None => break,
            }
        }

        let mut iter_a = self.chunks_in(skip..self.len());
        let mut iter_b = other.chunks_in(skip..other.len());
        let mut sa: &[u8] = &[];
        let mut sb: &[u8] = &[];
        let mut total = skip;
        loop {
            if sa.is_empty() {
                sa = match iter_a.next() {
                    Some(c) => c.as_bytes(),
                    None => return total,
                };
            }
            if sb.is_empty() {
                sb = match iter_b.next() {
                    Some(c) => c.as_bytes(),
                    None => return total,
                };
            }
            let n = sa.len().min(sb.len());
            let matched = sa[..n]
                .iter()
                .zip(&sb[..n])
                .take_while(|(x, y)| x == y)
                .count();
            total += matched;
            if matched < n {
                return total;
            }
            sa = &sa[n..];
            sb = &sb[n..];
        }
    }

    /// Length in bytes of the longest common byte suffix between `self` and
    /// `other`, bounded by `max_len`, skipping `Arc::ptr_eq` subtrees.
    pub fn common_suffix_bytes(&self, other: &Self, max_len: usize) -> usize {
        if max_len == 0 {
            return 0;
        }
        let max_len = max_len.min(self.len()).min(other.len());
        if self.ptr_eq(other) {
            return max_len;
        }
        let mut skip = 0usize;
        let mut na = self.root.as_ref();
        let mut nb = other.root.as_ref();
        while let (
            Node::Internal {
                children: ca,
                height: ha,
                ..
            },
            Node::Internal {
                children: cb,
                height: hb,
                ..
            },
        ) = (na, nb)
        {
            if ha != hb {
                break;
            }
            let mut diverged = None;
            for (a, b) in ca.iter().rev().zip(cb.iter().rev()) {
                let bytes = a.summary().bytes;
                if Arc::ptr_eq(a, b) && skip + bytes <= max_len {
                    skip += bytes;
                } else {
                    diverged = Some((a.as_ref(), b.as_ref()));
                    break;
                }
            }
            match diverged {
                Some((da, db)) => {
                    na = da;
                    nb = db;
                }
                None => break,
            }
        }

        let rem = max_len - skip;
        if rem == 0 {
            return skip;
        }
        let a_end = self.len() - skip;
        let b_end = other.len() - skip;
        let mut iter_a = self.rev_chunks_in((a_end - rem)..a_end);
        let mut iter_b = other.rev_chunks_in((b_end - rem)..b_end);
        let mut sa: &[u8] = &[];
        let mut sb: &[u8] = &[];
        let mut total = skip;
        loop {
            if sa.is_empty() {
                sa = match iter_a.next() {
                    Some(c) => c.as_bytes(),
                    None => return total,
                };
            }
            if sb.is_empty() {
                sb = match iter_b.next() {
                    Some(c) => c.as_bytes(),
                    None => return total,
                };
            }
            let n = sa.len().min(sb.len());
            let sa_tail = &sa[sa.len() - n..];
            let sb_tail = &sb[sb.len() - n..];
            let matched = sa_tail
                .iter()
                .rev()
                .zip(sb_tail.iter().rev())
                .take_while(|(x, y)| x == y)
                .count();
            total += matched;
            if matched < n {
                return total;
            }
            sa = &sa[..sa.len() - n];
            sb = &sb[..sb.len() - n];
        }
    }

    /// Replace `range` (clamped) with `insert` in `O(log n + insert.len())`.
    pub fn replace(&mut self, range: Range<usize>, insert: &str) {
        let range = self.clamp_range(range);
        if range.is_empty() && insert.is_empty() {
            return;
        }
        if can_replace_in_single_leaf(&self.root, range.clone(), insert.len(), true) {
            replace_in_single_leaf(&mut self.root, range, insert);
            return;
        }
        let (left, rest) = self.split(range.start);
        let (_, right) = rest.split(range.len());
        let mid = Self::from_text(insert);
        *self = left.concat(&mid).concat(&right);
    }

    /// Split `self` at byte offset `at` (clamped) into `(left, right)`.
    pub fn split(&self, at: usize) -> (Self, Self) {
        let at = self.clamp(at);
        if at == 0 {
            return (Self::empty(), self.clone());
        }
        if at == self.len() {
            return (self.clone(), Self::empty());
        }
        split_node(&self.root, at)
    }

    /// Join `self` and `other` in `O(|height(self) - height(other)| + 1)`.
    pub fn concat(&self, other: &Self) -> Self {
        if self.is_empty() {
            return other.clone();
        }
        if other.is_empty() {
            return self.clone();
        }
        match concat_nodes(&self.root, &other.root) {
            Joined::One(root) => Self { root },
            Joined::Two(a, b) => Self {
                root: Arc::new(Node::internal(vec![a, b])),
            },
        }
    }

    #[cfg(test)]
    pub(crate) fn assert_invariants(&self) {
        fn verify(node: &Node, is_root: bool) -> (TextSummary, u8) {
            match node {
                Node::Leaf { text, summary } => {
                    let expected = TextSummary::of(text);
                    assert_eq!(*summary, expected, "leaf summary mismatch");
                    if is_root {
                        assert!(
                            text.len() <= MAX_LEAF,
                            "root leaf too large: {}",
                            text.len()
                        );
                    } else {
                        assert!(
                            (MIN_LEAF..=MAX_LEAF).contains(&text.len()),
                            "non-root leaf out of bounds: {}",
                            text.len()
                        );
                    }
                    (*summary, 0)
                }
                Node::Internal {
                    children,
                    summary,
                    height,
                } => {
                    assert!(*height >= 1);
                    if is_root {
                        assert!(
                            (2..=MAX_CHILDREN).contains(&children.len()),
                            "root internal children out of bounds: {}",
                            children.len()
                        );
                    } else {
                        assert!(
                            (MIN_CHILDREN..=MAX_CHILDREN).contains(&children.len()),
                            "non-root internal children out of bounds: {}",
                            children.len()
                        );
                    }
                    let mut sum = TextSummary::default();
                    for child in children {
                        let (cs, ch) = verify(child, false);
                        assert_eq!(ch + 1, *height, "unbalanced child height");
                        sum += cs;
                    }
                    assert_eq!(*summary, sum, "internal summary mismatch");
                    (*summary, *height)
                }
            }
        }
        verify(&self.root, true);
    }
}

impl PartialEq for Rope {
    fn eq(&self, other: &Self) -> bool {
        if self.ptr_eq(other) {
            return true;
        }
        if self.summary() != other.summary() {
            return false;
        }
        self.common_prefix_bytes(other) == self.len()
    }
}

impl Eq for Rope {}

fn can_replace_in_single_leaf(
    node: &Node,
    range: Range<usize>,
    insert_len: usize,
    is_root: bool,
) -> bool {
    match node {
        Node::Leaf { text, .. } => {
            let new_len = text.len() - range.len() + insert_len;
            if is_root {
                new_len <= MAX_LEAF
            } else {
                (MIN_LEAF..=MAX_LEAF).contains(&new_len)
            }
        }
        Node::Internal { children, .. } => {
            let mut base = 0usize;
            for child in children {
                if range.start < base {
                    break;
                }
                let cb = child.summary().bytes;
                if range.end <= base + cb {
                    if range.start < base + cb
                        && can_replace_in_single_leaf(
                            child,
                            (range.start - base)..(range.end - base),
                            insert_len,
                            false,
                        )
                    {
                        return true;
                    }
                    if range.start == base + cb
                        && range.end == base + cb
                        && can_replace_in_single_leaf(child, cb..cb, insert_len, false)
                    {
                        return true;
                    }
                }
                base += cb;
            }
            false
        }
    }
}

fn replace_in_single_leaf(node: &mut Arc<Node>, range: Range<usize>, insert: &str) -> TextSummary {
    match Arc::make_mut(node) {
        Node::Leaf { text, summary } => {
            text.replace_range(range, insert);
            *summary = TextSummary::of(text);
            *summary
        }
        Node::Internal {
            children, summary, ..
        } => {
            let mut base = 0usize;
            let mut updated = false;
            for child in children.iter_mut() {
                if range.start < base {
                    break;
                }
                let old_summary = child.summary();
                let cb = old_summary.bytes;
                let fits = if range.start < base + cb && range.end <= base + cb {
                    can_replace_in_single_leaf(
                        child,
                        (range.start - base)..(range.end - base),
                        insert.len(),
                        false,
                    )
                } else if range.start == base + cb && range.end == base + cb {
                    can_replace_in_single_leaf(child, cb..cb, insert.len(), false)
                } else {
                    false
                };
                if fits {
                    let local = (range.start - base)..(range.end - base);
                    let new_child_summary = replace_in_single_leaf(child, local, insert);
                    *summary = (*summary - old_summary) + new_child_summary;
                    updated = true;
                    break;
                }
                base += cb;
            }
            debug_assert!(updated);
            *summary
        }
    }
}

fn split_node(node: &Arc<Node>, at: usize) -> (Rope, Rope) {
    match node.as_ref() {
        Node::Leaf { text, .. } => (Rope::from_text(&text[..at]), Rope::from_text(&text[at..])),
        Node::Internal { children, .. } => {
            let mut base = 0usize;
            for (i, child) in children.iter().enumerate() {
                let cb = child.summary().bytes;
                if at == base {
                    let left = Rope::from_valid_nonroot_children(children[..i].to_vec());
                    let right = Rope::from_valid_nonroot_children(children[i..].to_vec());
                    return (left, right);
                }
                if at < base + cb {
                    let left_siblings = Rope::from_valid_nonroot_children(children[..i].to_vec());
                    let right_siblings =
                        Rope::from_valid_nonroot_children(children[i + 1..].to_vec());
                    let (mid_left, mid_right) = split_node(child, at - base);
                    return (
                        left_siblings.concat(&mid_left),
                        mid_right.concat(&right_siblings),
                    );
                }
                base += cb;
            }
            (Rope { root: node.clone() }, Rope::empty())
        }
    }
}

enum Joined {
    One(Arc<Node>),
    Two(Arc<Node>, Arc<Node>),
}

fn concat_nodes(left: &Arc<Node>, right: &Arc<Node>) -> Joined {
    let hl = left.height();
    let hr = right.height();
    if hl == 0 && hr == 0 {
        let (Node::Leaf { text: tl, .. }, Node::Leaf { text: tr, .. }) =
            (left.as_ref(), right.as_ref())
        else {
            unreachable!()
        };
        if tl.len() + tr.len() <= MAX_LEAF {
            let mut combined = String::with_capacity(tl.len() + tr.len());
            combined.push_str(tl);
            combined.push_str(tr);
            return Joined::One(Arc::new(Node::leaf(combined)));
        }
        if tl.len() >= MIN_LEAF && tr.len() >= MIN_LEAF {
            return Joined::Two(left.clone(), right.clone());
        }
        let mut combined = String::with_capacity(tl.len() + tr.len());
        combined.push_str(tl);
        combined.push_str(tr);
        let cut = choose_two_way_split(&combined);
        let r = combined.split_off(cut);
        return Joined::Two(Arc::new(Node::leaf(combined)), Arc::new(Node::leaf(r)));
    }

    if hl == hr {
        let (Node::Internal { children: cl, .. }, Node::Internal { children: cr, .. }) =
            (left.as_ref(), right.as_ref())
        else {
            unreachable!()
        };
        let mut combined = Vec::with_capacity(cl.len() + cr.len());
        combined.extend_from_slice(cl);
        combined.extend_from_slice(cr);
        return pack_internal_children(combined);
    }

    if hl > hr {
        let Node::Internal { children: cl, .. } = left.as_ref() else {
            unreachable!()
        };
        let last = cl.last().unwrap();
        let mut out = Vec::with_capacity(cl.len() + 1);
        out.extend_from_slice(&cl[..cl.len() - 1]);
        match concat_nodes(last, right) {
            Joined::One(n) => out.push(n),
            Joined::Two(a, b) => {
                out.push(a);
                out.push(b);
            }
        }
        return pack_internal_children(out);
    }

    let Node::Internal { children: cr, .. } = right.as_ref() else {
        unreachable!()
    };
    let first = cr.first().unwrap();
    let mut out = Vec::with_capacity(cr.len() + 1);
    match concat_nodes(left, first) {
        Joined::One(n) => out.push(n),
        Joined::Two(a, b) => {
            out.push(a);
            out.push(b);
        }
    }
    out.extend_from_slice(&cr[1..]);
    pack_internal_children(out)
}

fn pack_internal_children(mut children: Vec<Arc<Node>>) -> Joined {
    if children.len() <= MAX_CHILDREN {
        Joined::One(Arc::new(Node::internal(children)))
    } else {
        let mid = children.len() / 2;
        let right = children.split_off(mid);
        Joined::Two(
            Arc::new(Node::internal(children)),
            Arc::new(Node::internal(right)),
        )
    }
}

fn split_str_into_leaves(text: &str) -> Vec<Arc<Node>> {
    if text.len() <= MAX_LEAF {
        return vec![Arc::new(Node::leaf(text.to_owned()))];
    }
    let mut leaves: Vec<Arc<Node>> = Vec::with_capacity(text.len().div_ceil(TARGET_LEAF));
    let mut pos = 0usize;
    let bytes = text.as_bytes();
    while pos < text.len() {
        let rem = text.len() - pos;
        if rem <= MAX_LEAF {
            if rem >= MIN_LEAF {
                leaves.push(Arc::new(Node::leaf(text[pos..].to_owned())));
            } else {
                let prev_arc = leaves.pop().expect("text.len() > MAX_LEAF has prior leaf");
                let mut combined = match Arc::try_unwrap(prev_arc) {
                    Ok(Node::Leaf { text: prev, .. }) => prev,
                    Err(arc) => match arc.as_ref() {
                        Node::Leaf { text: prev, .. } => prev.clone(),
                        Node::Internal { .. } => unreachable!(),
                    },
                    Ok(Node::Internal { .. }) => unreachable!(),
                };
                combined.push_str(&text[pos..]);
                if combined.len() <= MAX_LEAF {
                    leaves.push(Arc::new(Node::leaf(combined)));
                } else {
                    let cut = choose_two_way_split(&combined);
                    let right = combined.split_off(cut);
                    leaves.push(Arc::new(Node::leaf(combined)));
                    leaves.push(Arc::new(Node::leaf(right)));
                }
            }
            break;
        }

        // Prefer splitting right after a newline near `TARGET_LEAF` inside `512..=896`.
        let nl_lo = pos + 512;
        let nl_hi = (pos + 896).min(text.len());
        let cut = bytes[nl_lo..nl_hi]
            .iter()
            .rposition(|&b| b == b'\n')
            .map(|rel| nl_lo + rel + 1)
            .unwrap_or_else(|| {
                let mut c = pos + TARGET_LEAF;
                while !text.is_char_boundary(c) {
                    c -= 1;
                }
                c
            });
        leaves.push(Arc::new(Node::leaf(text[pos..cut].to_owned())));
        pos = cut;
    }
    leaves
}

/// Choose a UTF-8 char boundary split in `combined` (`MAX_LEAF < len <= MIN_LEAF + MAX_LEAF`)
/// such that both halves have length in `MIN_LEAF..=MAX_LEAF`, preferring a line break.
fn choose_two_way_split(combined: &str) -> usize {
    let len = combined.len();
    let lo = (len.saturating_sub(MAX_LEAF)).max(MIN_LEAF);
    let hi = (len - MIN_LEAF).min(MAX_LEAF);
    let mid = len / 2;
    let bytes = combined.as_bytes();

    // Find a newline in `lo..hi` closest to `mid`.
    let mut best_nl: Option<usize> = None;
    for (idx, &b) in bytes[lo..hi].iter().enumerate() {
        if b == b'\n' {
            let candidate = lo + idx + 1;
            if best_nl.is_none_or(|prev| candidate.abs_diff(mid) < prev.abs_diff(mid)) {
                best_nl = Some(candidate);
            }
        }
    }
    if let Some(cut) = best_nl {
        return cut;
    }

    let mut cut = mid.clamp(lo + 3, hi);
    while !combined.is_char_boundary(cut) {
        cut -= 1;
    }
    debug_assert!(cut >= lo && cut <= hi);
    cut
}

/// Forward iterator yielding `&str` leaf slices intersecting a byte range.
pub struct Chunks<'a> {
    stack: Vec<(&'a [Arc<Node>], usize, usize)>,
    current: Option<&'a str>,
    range: Range<usize>,
}

impl<'a> Chunks<'a> {
    fn new(root: &'a Node, range: Range<usize>) -> Self {
        let mut iter = Self {
            stack: Vec::new(),
            current: None,
            range,
        };
        if !iter.range.is_empty() {
            iter.descend_to_start(root, 0);
        }
        iter
    }

    fn descend_to_start(&mut self, mut node: &'a Node, mut base: usize) {
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    let s = self.range.start.saturating_sub(base).min(text.len());
                    let e = (self.range.end - base).min(text.len());
                    if s < e {
                        self.current = Some(&text[s..e]);
                    }
                    return;
                }
                Node::Internal { children, .. } => {
                    let mut chosen = None;
                    for (i, child) in children.iter().enumerate() {
                        let cb = child.summary().bytes;
                        if self.range.start < base + cb {
                            let next_base = base + cb;
                            if i + 1 < children.len() && next_base < self.range.end {
                                self.stack.push((children.as_slice(), i + 1, next_base));
                            }
                            chosen = Some((child.as_ref(), base));
                            break;
                        }
                        base += cb;
                    }
                    match chosen {
                        Some((child, child_base)) => {
                            node = child;
                            base = child_base;
                        }
                        None => return,
                    }
                }
            }
        }
    }

    fn advance_next_leaf(&mut self) {
        while let Some((children, idx, base)) = self.stack.pop() {
            if base >= self.range.end || idx >= children.len() {
                continue;
            }
            let child = &children[idx];
            let cb = child.summary().bytes;
            let next_base = base + cb;
            if idx + 1 < children.len() && next_base < self.range.end {
                self.stack.push((children, idx + 1, next_base));
            }
            let mut node = child.as_ref();
            loop {
                match node {
                    Node::Leaf { text, .. } => {
                        let e = (self.range.end - base).min(text.len());
                        if e > 0 {
                            self.current = Some(&text[..e]);
                            return;
                        }
                        break;
                    }
                    Node::Internal {
                        children: inner, ..
                    } => {
                        let first = &inner[0];
                        let fb = first.summary().bytes;
                        if inner.len() > 1 && base + fb < self.range.end {
                            self.stack.push((inner.as_slice(), 1, base + fb));
                        }
                        node = first.as_ref();
                    }
                }
            }
        }
    }
}

impl<'a> Iterator for Chunks<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {
        let out = self.current.take()?;
        self.advance_next_leaf();
        Some(out)
    }
}

/// Reverse iterator yielding `&str` leaf slices intersecting a byte range from
/// `range.end` down to `range.start`.
pub(crate) struct RevChunks<'a> {
    stack: Vec<(&'a [Arc<Node>], usize, usize)>,
    current: Option<&'a str>,
    range: Range<usize>,
}

impl<'a> RevChunks<'a> {
    fn new(root: &'a Node, range: Range<usize>) -> Self {
        let mut iter = Self {
            stack: Vec::new(),
            current: None,
            range,
        };
        if !iter.range.is_empty() {
            iter.descend_to_end(root, 0);
        }
        iter
    }

    fn descend_to_end(&mut self, mut node: &'a Node, mut base: usize) {
        loop {
            match node {
                Node::Leaf { text, .. } => {
                    let s = self.range.start.saturating_sub(base).min(text.len());
                    let e = (self.range.end - base).min(text.len());
                    if s < e {
                        self.current = Some(&text[s..e]);
                    }
                    return;
                }
                Node::Internal {
                    children, summary, ..
                } => {
                    let mut end_base = base + summary.bytes;
                    let mut chosen = None;
                    for (i, child) in children.iter().enumerate().rev() {
                        let cb = child.summary().bytes;
                        let child_start = end_base - cb;
                        if self.range.end > child_start {
                            if i > 0 && child_start > self.range.start {
                                self.stack.push((children.as_slice(), i - 1, child_start));
                            }
                            chosen = Some((child.as_ref(), child_start));
                            break;
                        }
                        end_base = child_start;
                    }
                    match chosen {
                        Some((child, child_base)) => {
                            node = child;
                            base = child_base;
                        }
                        None => return,
                    }
                }
            }
        }
    }

    fn advance_prev_leaf(&mut self) {
        while let Some((children, idx, end_base)) = self.stack.pop() {
            if end_base <= self.range.start {
                continue;
            }
            let child = &children[idx];
            let cb = child.summary().bytes;
            let child_start = end_base - cb;
            if idx > 0 && child_start > self.range.start {
                self.stack.push((children, idx - 1, child_start));
            }
            let mut node = child.as_ref();
            loop {
                match node {
                    Node::Leaf { text, .. } => {
                        let cur_start = end_base - text.len();
                        let s = self.range.start.saturating_sub(cur_start).min(text.len());
                        if s < text.len() {
                            self.current = Some(&text[s..]);
                            return;
                        }
                        break;
                    }
                    Node::Internal {
                        children: inner, ..
                    } => {
                        let last_idx = inner.len() - 1;
                        let last = &inner[last_idx];
                        let lb = last.summary().bytes;
                        let last_start = end_base - lb;
                        if last_idx > 0 && last_start > self.range.start {
                            self.stack
                                .push((inner.as_slice(), last_idx - 1, last_start));
                        }
                        node = last.as_ref();
                    }
                }
            }
        }
    }
}

impl<'a> Iterator for RevChunks<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<Self::Item> {
        let out = self.current.take()?;
        self.advance_prev_leaf();
        Some(out)
    }
}
