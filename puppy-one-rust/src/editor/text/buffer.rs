//! Document text backed by an `Arc`-shared balanced B-tree `Rope` (`TA-01`,
//! `TA-04`). Offsets are UTF-8 byte positions; lines are separated by `\n`
//! (the document session normalises line endings on read and restores them on
//! save).
//!
//! - `Buffer::clone` is `O(1)` (`Arc::clone` of the rope root and lazy cache).
//! - Line and UTF-16 queries (`line_index`, `line_range`, `byte_to_utf16`,
//!   `utf16_to_byte`) run in `O(log n)` directly on rope summaries without
//!   materialising a contiguous string.
//! - All offset, range and line queries are total functions: out-of-bounds,
//!   inverted or mid-codepoint inputs clamp safely without panicking.
//! - Legacy `&str` accessors (`as_str`, cross-chunk `slice`) populate a lazy
//!   `OnceLock<String>` on demand and reset it on `replace`.
use super::rope::{Chunks, Rope, TextSummary};
use std::{
    borrow::Cow,
    fmt,
    ops::Range,
    sync::{Arc, OnceLock},
};

#[derive(Clone)]
pub struct Buffer {
    rope: Rope,
    flat: Arc<OnceLock<String>>,
}

impl Default for Buffer {
    fn default() -> Self {
        Self {
            rope: Rope::empty(),
            flat: Arc::new(OnceLock::new()),
        }
    }
}

impl fmt::Debug for Buffer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Buffer")
            .field("summary", &self.rope.summary())
            .finish()
    }
}

impl PartialEq for Buffer {
    fn eq(&self, other: &Self) -> bool {
        self.rope == other.rope
    }
}

impl Eq for Buffer {}

impl Buffer {
    pub fn new(text: impl Into<String>) -> Self {
        let text = text.into();
        Self {
            rope: Rope::from_owned(text),
            flat: Arc::new(OnceLock::new()),
        }
    }

    pub fn from_rope(rope: Rope) -> Self {
        Self {
            rope,
            flat: Arc::new(OnceLock::new()),
        }
    }

    pub fn rope(&self) -> &Rope {
        &self.rope
    }

    pub fn summary(&self) -> TextSummary {
        self.rope.summary()
    }

    /// Contiguous `&str` view of the whole buffer. Single-leaf buffers borrow
    /// directly from the leaf; multi-leaf buffers lazily populate `OnceLock`.
    pub fn as_str(&self) -> &str {
        if let Some(single) = self.rope.try_slice_single_leaf(0..self.rope.len()) {
            return single;
        }
        self.flat
            .get_or_init(|| self.rope.to_string_flat())
            .as_str()
    }

    pub fn eq_str(&self, other: &str) -> bool {
        self.rope.eq_str(other)
    }

    pub fn len(&self) -> usize {
        self.rope.len()
    }

    pub fn len_utf16(&self) -> usize {
        self.rope.len_utf16()
    }

    pub fn is_empty(&self) -> bool {
        self.rope.is_empty()
    }

    /// Snap `offset` backward to the nearest valid UTF-8 character boundary at
    /// or before `offset.min(self.len())` in `O(log n)`.
    pub fn clamp(&self, offset: usize) -> usize {
        self.rope.clamp(offset)
    }

    /// Clamp both endpoints of `range` to valid UTF-8 character boundaries and
    /// enforce `start <= end` in `O(log n)`.
    pub fn clamp_range(&self, range: Range<usize>) -> Range<usize> {
        self.rope.clamp_range(range)
    }

    /// Total slice borrowing from a single rope leaf when possible, and falling
    /// back to the lazy contiguous buffer only when `range` spans a chunk seam.
    pub fn slice(&self, range: Range<usize>) -> &str {
        let range = self.clamp_range(range);
        if let Some(leaf) = self.rope.try_slice_single_leaf(range.clone()) {
            return leaf;
        }
        &self.as_str()[range]
    }

    /// Total slice that borrows `&str` when `range` fits in a single rope leaf
    /// and allocates only `range.len()` bytes when spanning multiple leaves
    /// (never materialising the whole-document `flat` cache).
    pub fn slice_cow(&self, range: Range<usize>) -> Cow<'_, str> {
        self.rope.slice_cow(range)
    }

    /// Stream `&str` leaf slices intersecting `range` (clamped).
    pub fn chunks_in(&self, range: Range<usize>) -> Chunks<'_> {
        self.rope.chunks_in(range)
    }

    pub fn line_count(&self) -> usize {
        self.rope.line_count()
    }

    /// Byte range of 0-based line `index`, excluding its trailing `\n`. Total:
    /// `index >= self.line_count()` returns `self.len()..self.len()`.
    pub fn line_range(&self, index: usize) -> Range<usize> {
        self.rope.line_range(index)
    }

    pub fn line(&self, index: usize) -> &str {
        self.slice(self.line_range(index))
    }

    pub fn line_cow(&self, index: usize) -> Cow<'_, str> {
        self.slice_cow(self.line_range(index))
    }

    /// 0-based index of the line containing `offset` (a line break belongs to
    /// its line; out-of-bounds offsets clamp to `self.len()`).
    pub fn line_index(&self, offset: usize) -> usize {
        self.rope.line_index(offset)
    }

    /// Convert a UTF-8 byte offset to a UTF-16 code-unit offset in `O(log n)`,
    /// clamping out-of-bounds or mid-codepoint offsets backward first.
    pub fn byte_to_utf16(&self, offset: usize) -> usize {
        self.rope.byte_to_utf16(offset)
    }

    /// Convert a UTF-16 code-unit offset to a UTF-8 byte offset in `O(log n)`.
    /// Mid-surrogate offsets advance to the end of their scalar.
    pub fn utf16_to_byte(&self, offset16: usize) -> usize {
        self.rope.utf16_to_byte(offset16)
    }

    /// Replace `range` (clamped) with `insert` in `O(log n + insert.len())`.
    pub fn replace(&mut self, range: Range<usize>, insert: &str) {
        let range = self.clamp_range(range);
        if range.is_empty() && insert.is_empty() {
            return;
        }
        self.rope.replace(range, insert);
        if self.flat.get().is_some() || Arc::strong_count(&self.flat) > 1 {
            self.flat = Arc::new(OnceLock::new());
        }
    }

    #[cfg(test)]
    pub(crate) fn has_materialized_flat(&self) -> bool {
        self.flat.get().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1);
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

    fn clamp_str(s: &str, offset: usize) -> usize {
        let mut o = offset.min(s.len());
        while !s.is_char_boundary(o) {
            o -= 1;
        }
        o
    }

    fn ref_byte_to_utf16(s: &str, offset: usize) -> usize {
        s[..clamp_str(s, offset)].encode_utf16().count()
    }

    fn ref_utf16_to_byte(s: &str, offset16: usize) -> usize {
        let mut units = 0;
        for (byte, ch) in s.char_indices() {
            if units >= offset16 {
                return byte;
            }
            units += ch.len_utf16();
        }
        s.len()
    }

    #[test]
    fn lines_and_edits_keep_the_index_consistent() {
        let mut b = Buffer::new("a\nbc\n\nd");
        assert_eq!(b.line_count(), 4);
        assert_eq!(b.line(1), "bc");
        assert_eq!(b.line(2), "");
        assert_eq!(b.line_index(2), 1);
        assert_eq!(b.line_index(4), 1);
        assert_eq!(b.line_index(5), 2);
        b.replace(2..4, "x\ny");
        assert_eq!(b.as_str(), "a\nx\ny\n\nd");
        assert_eq!(b.line_count(), 5);
        assert_eq!(b.line(2), "y");
        assert_eq!(b, Buffer::new("a\nx\ny\n\nd"));
        assert_eq!(Buffer::new("é").clamp(1), 0);

        // Trailing newline keeps a final empty line.
        let trailing = Buffer::new("first\nsecond\n");
        assert_eq!(trailing.line_count(), 3);
        assert_eq!(trailing.line_range(0), 0..5);
        assert_eq!(trailing.line_range(1), 6..12);
        assert_eq!(trailing.line_range(2), 13..13);
        assert_eq!(trailing.line(2), "");
        assert_eq!(trailing.line_index(12), 1);
        assert_eq!(trailing.line_index(13), 2);
    }

    #[test]
    #[allow(clippy::reversed_empty_ranges)]
    fn total_clamping_never_panics_on_bad_offsets_or_ranges() {
        let b = Buffer::new("a中文😀👨‍👩‍👧‍👦\nend");
        let len = b.len();

        for pos in 0..=(len + 20) {
            let c = b.clamp(pos);
            assert!(b.as_str().is_char_boundary(c));
            assert_eq!(b.byte_to_utf16(pos), ref_byte_to_utf16(b.as_str(), pos));
        }

        // Inverted, mid-codepoint, and out-of-bounds ranges all clamp cleanly (`start <= end`).
        assert_eq!(b.clamp_range(10..2), b.clamp(10)..b.clamp(10));
        assert_eq!(b.slice(999..1005), "");
        assert_eq!(b.slice(8..2), "");
        let _ = b.slice(2..9);
        let _ = b.slice_cow(3..11);
        assert_eq!(b.line_range(999), len..len);
        assert_eq!(b.line(999), "");

        // `replace` with mid-codepoint or inverted range clamps safely.
        let mut copy = b.clone();
        copy.replace(9..2, "!");
        copy.rope().assert_invariants();
        copy.replace(999..2000, "?");
        copy.rope().assert_invariants();
        assert!(copy.as_str().ends_with('?'));

        // Snapshot isolation: `b` was untouched when `copy` mutated!
        assert_eq!(b.len(), len);
    }

    #[test]
    fn large_multibyte_rope_splits_merges_and_preserves_o1_snapshots() {
        let pattern = "Line αβγ — 中文测试 — 😀🎉👨‍👩‍👧‍👦 — 0123456789abcdef\n";
        let initial = pattern.repeat(2400); // > 160 KB across ~200+ leaves & height >= 2
        assert!(initial.len() > 150_000);

        let mut buf = Buffer::new(initial.clone());
        buf.rope().assert_invariants();
        assert!(!buf.has_materialized_flat());
        assert_eq!(buf.len(), initial.len());
        assert_eq!(buf.len_utf16(), initial.encode_utf16().count());

        // `O(1)` snapshot shares the exact Arc root and stays isolated across edits.
        let snap = buf.clone();
        assert!(buf.rope().ptr_eq(snap.rope()));

        let mut reference = initial;
        let mut rng = Rng(0x5EED_CAFE_1234_5678);
        let snippets = [
            "",
            "x",
            "\n",
            "你好世界\n",
            "😀🚀👨‍👩‍👧‍👦",
            &"long_block_with_newlines\n".repeat(90), // multi-leaf insert (~2.2 KB)
        ];

        for step in 0..250 {
            let a = clamp_str(&reference, rng.range(reference.len() + 1));
            let span = if step % 7 == 0 {
                rng.range(4000) // multi-leaf deletions forcing underflow/rebalance
            } else {
                rng.range(64)
            };
            let b = clamp_str(&reference, (a + span).min(reference.len()));
            let ins = snippets[rng.range(snippets.len())];

            buf.replace(a..b, ins);
            reference.replace_range(a..b, ins);

            buf.rope().assert_invariants();
            assert!(!buf.has_materialized_flat());
            assert_eq!(buf.len(), reference.len());

            if step % 25 == 0 {
                assert_eq!(buf.len_utf16(), reference.encode_utf16().count());
                let probe_byte = rng.range(reference.len() + 10);
                assert_eq!(
                    buf.byte_to_utf16(probe_byte),
                    ref_byte_to_utf16(&reference, probe_byte)
                );
                let probe_u16 = rng.range(buf.len_utf16() + 10);
                assert_eq!(
                    buf.utf16_to_byte(probe_u16),
                    ref_utf16_to_byte(&reference, probe_u16)
                );

                // Verify `slice_cow` both within a leaf and across leaves without touching `flat`.
                let s0 = clamp_str(&reference, rng.range(reference.len() + 1));
                let s1 = clamp_str(&reference, (s0 + rng.range(2500)).min(reference.len()));
                assert_eq!(buf.slice_cow(s0..s1).as_ref(), &reference[s0..s1]);
                assert!(!buf.has_materialized_flat());
            }
        }

        // Verify every line's `line_range` and `line_index` against the reference string.
        let ref_lines: Vec<&str> = reference.split('\n').collect();
        assert_eq!(buf.line_count(), ref_lines.len());
        let mut cursor = 0usize;
        for (idx, &expected_line) in ref_lines.iter().enumerate() {
            let r = buf.line_range(idx);
            assert_eq!(r, cursor..cursor + expected_line.len());
            assert_eq!(buf.line_cow(idx).as_ref(), expected_line);
            assert_eq!(buf.line_index(r.start), idx);
            assert_eq!(buf.line_index(r.end), idx);
            cursor = r.end + 1;
        }
        assert!(!buf.has_materialized_flat());

        // Original snapshot is completely untouched, and `as_str()` matches on both!
        assert!(snap.eq_str(&pattern.repeat(2400)));
        assert_eq!(buf.as_str(), reference);
        assert!(buf.has_materialized_flat());

        // Subsequent `replace` invalidates the lazy flat cache.
        buf.replace(0..0, "!");
        assert!(!buf.has_materialized_flat());
        assert_eq!(&buf.slice_cow(0..1)[..], "!");
    }
}
