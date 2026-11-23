//! Incremental chunked block height map (`TA-11`, `TA-13`, CodeMirror
//! `HeightMap` counterpart).
//!
//! - Base heights belong to the Document Layer (`Rc<Decorations>`), stored in
//!   fixed-size chunks (`CHUNK_TARGET = 128`) backed by a chunk-level Fenwick
//!   tree (Binary Indexed Tree) and prefix block counts so `locate`, `top_of`,
//!   `index_at`, and `set_height` all run in `O(log(N / 128))` even on
//!   16,000-section (~384,000-block) documents.
//! - Width-only resizes (`doc_ptr` and `top` unchanged) run in `O(1)`: all
//!   entries and heights are preserved untouched while the recorded column
//!   width updates in place; visible blocks re-measure during layout and T2's
//!   scroll anchor keeps the viewport top stable.
//! - Measured heights in `known` are keyed by `(block_hash, width)` so exact
//!   same-width measurements are preferred while cross-width measurements serve
//!   only as estimates.
//! - Cursor/focus reveal overrides (`RevealLayer`) sit in a lightweight overlay
//!   of `0..=k` patched spans, so `ArrowDown` / `ArrowRight` rebuilds `0` base
//!   plan blocks and `0` full plans.
use super::decoration::{Block, Decorations, LayeredDecorations};
use crate::editor::text::buffer::Buffer;
use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

const CHUNK_TARGET: usize = 128;
const CHUNK_MAX: usize = 256;

#[derive(Clone, Copy, Debug)]
struct Entry {
    key: u64,
    height: f32,
    valid: bool,
}

#[derive(Clone, Debug, Default)]
struct Chunk {
    entries: Vec<Entry>,
    sum: f64,
}

impl Chunk {
    fn from_entries(entries: Vec<Entry>) -> Self {
        let sum = entries.iter().map(|e| e.height as f64).sum();
        Self { entries, sum }
    }

    fn recompute_sum(&mut self) -> f64 {
        let prev = self.sum;
        self.sum = self.entries.iter().map(|e| e.height as f64).sum();
        self.sum - prev
    }
}

struct BasePlan {
    doc_ptr: usize,
    width: u32,
    top: f32,
    len: usize,
    chunks: Vec<Chunk>,
    /// `prefix_counts[i]` = starting block index of chunk `i`;
    /// `prefix_counts[chunks.len()] == len`.
    prefix_counts: Vec<usize>,
    /// 1-indexed Fenwick tree over `chunks[i].sum` for `O(log C)` prefix sums
    /// and `index_at(y)` lookup.
    sum_bit: Vec<f64>,
    total_sum: f64,
}

impl BasePlan {
    fn from_entries(doc_ptr: usize, width: u32, top: f32, entries: Vec<Entry>) -> Self {
        let len = entries.len();
        let chunks = if entries.is_empty() {
            Vec::new()
        } else {
            entries
                .chunks(CHUNK_TARGET)
                .map(|slice| Chunk::from_entries(slice.to_vec()))
                .collect()
        };
        let mut plan = Self {
            doc_ptr,
            width,
            top,
            len,
            chunks,
            prefix_counts: Vec::new(),
            sum_bit: Vec::new(),
            total_sum: 0.0,
        };
        plan.rebuild_indices();
        plan
    }

    fn rebuild_indices(&mut self) {
        let n = self.chunks.len();
        self.prefix_counts.clear();
        self.prefix_counts.reserve(n + 1);
        let mut count = 0usize;
        for c in &self.chunks {
            self.prefix_counts.push(count);
            count += c.entries.len();
        }
        self.prefix_counts.push(count);
        self.len = count;

        // Build Fenwick tree in O(n).
        self.sum_bit.clear();
        self.sum_bit.resize(n + 1, 0.0);
        let mut total = 0.0;
        for (i, c) in self.chunks.iter().enumerate() {
            let idx = i + 1;
            self.sum_bit[idx] += c.sum;
            let parent = idx + (idx & idx.wrapping_neg());
            if parent <= n {
                self.sum_bit[parent] += self.sum_bit[idx];
            }
            total += c.sum;
        }
        self.total_sum = total;
    }

    fn bit_add(&mut self, chunk_idx: usize, delta: f64) {
        if delta == 0.0 {
            return;
        }
        self.total_sum += delta;
        let n = self.chunks.len();
        let mut idx = chunk_idx + 1;
        while idx <= n {
            self.sum_bit[idx] += delta;
            idx += idx & idx.wrapping_neg();
        }
    }

    /// Sum of `chunks[0..chunk_count].sum` in `O(log C)`.
    fn bit_prefix_sum(&self, chunk_count: usize) -> f64 {
        let mut sum = 0.0;
        let mut idx = chunk_count.min(self.chunks.len());
        while idx > 0 {
            sum += self.sum_bit[idx];
            idx -= idx & idx.wrapping_neg();
        }
        sum
    }

    /// Locate chunk and local entry index for `index` in `O(log C)`.
    fn locate(&self, index: usize) -> Option<(usize, usize)> {
        if index >= self.len || self.chunks.is_empty() {
            return None;
        }
        let ci = self
            .prefix_counts
            .partition_point(|&start| start <= index)
            .saturating_sub(1);
        let li = index - self.prefix_counts[ci];
        (ci < self.chunks.len() && li < self.chunks[ci].entries.len()).then_some((ci, li))
    }

    fn entry(&self, index: usize) -> Entry {
        let (ci, li) = self.locate(index).expect("base block index in bounds");
        self.chunks[ci].entries[li]
    }

    fn top_of(&self, index: usize) -> f64 {
        let clamped = index.min(self.len);
        if clamped == self.len {
            return self.top as f64 + self.total_sum;
        }
        let Some((ci, li)) = self.locate(clamped) else {
            return self.top as f64 + self.total_sum;
        };
        let mut y = self.top as f64 + self.bit_prefix_sum(ci);
        y += self.chunks[ci].entries[..li]
            .iter()
            .map(|e| e.height as f64)
            .sum::<f64>();
        y
    }

    fn range_height(&self, range: Range<usize>) -> f64 {
        if range.start >= range.end {
            return 0.0;
        }
        self.top_of(range.end) - self.top_of(range.start)
    }

    /// First block index whose bottom is strictly greater than `target` in `O(log C)`.
    fn index_at(&self, target: f64) -> usize {
        if self.len == 0 {
            return 0;
        }
        let rel = target - self.top as f64;
        if rel < 0.0 {
            return 0;
        }
        let n = self.chunks.len();
        // Binary lifting over Fenwick tree: find largest `pos` with prefix_sum(pos) <= rel.
        let mut pos = 0usize;
        let mut acc = 0.0f64;
        let mut step = if n == 0 {
            0
        } else {
            1usize << (usize::BITS - 1 - n.leading_zeros())
        };
        while step > 0 {
            let next = pos + step;
            if next <= n && acc + self.sum_bit[next] <= rel {
                pos = next;
                acc += self.sum_bit[next];
            }
            step >>= 1;
        }
        if pos >= n {
            return self.len - 1;
        }
        let mut running = self.top as f64 + acc;
        let mut doc_idx = self.prefix_counts[pos];
        for e in &self.chunks[pos].entries {
            running += e.height as f64;
            if running > target {
                return doc_idx.min(self.len - 1);
            }
            doc_idx += 1;
        }
        // Floating-point edge: if chunk rounding stopped just at `target`, step to next chunk.
        for ci in (pos + 1)..n {
            for e in &self.chunks[ci].entries {
                running += e.height as f64;
                if running > target {
                    return doc_idx.min(self.len - 1);
                }
                doc_idx += 1;
            }
        }
        self.len - 1
    }

    fn set_height(&mut self, index: usize, height: f32) -> (u64, f32) {
        let Some((ci, li)) = self.locate(index) else {
            return (0, 0.);
        };
        let entry = &mut self.chunks[ci].entries[li];
        let key = entry.key;
        let delta = height - entry.height;
        if delta != 0. {
            entry.height = height;
            let sum_delta = self.chunks[ci].recompute_sum();
            self.bit_add(ci, sum_delta);
        }
        (key, delta)
    }

    fn splice(
        &mut self,
        doc_ptr: usize,
        width_bits: u32,
        top: f32,
        old_range: Range<usize>,
        replacement: Vec<Entry>,
    ) {
        self.doc_ptr = doc_ptr;
        self.width = width_bits;
        self.top = top;
        if old_range.len() == replacement.len() {
            // Fast path for single-line / same-block-count edits: O(log C) in-place update.
            for (offset, next) in replacement.into_iter().enumerate() {
                let idx = old_range.start + offset;
                if let Some((ci, li)) = self.locate(idx) {
                    self.chunks[ci].entries[li] = next;
                    let sum_delta = self.chunks[ci].recompute_sum();
                    self.bit_add(ci, sum_delta);
                }
            }
            return;
        }

        if self.chunks.is_empty() {
            *self = Self::from_entries(doc_ptr, width_bits, top, replacement);
            return;
        }

        let start_chunk = if old_range.start >= self.len {
            self.chunks.len()
        } else {
            self.prefix_counts
                .partition_point(|&s| s <= old_range.start)
                .saturating_sub(1)
        };
        if start_chunk >= self.chunks.len() {
            let added = replacement.len();
            if let Some(last) = self.chunks.last_mut()
                && last.entries.len() + added <= CHUNK_MAX
            {
                last.entries.extend(replacement);
                last.recompute_sum();
            } else {
                self.chunks.extend(
                    replacement
                        .chunks(CHUNK_TARGET)
                        .map(|s| Chunk::from_entries(s.to_vec())),
                );
            }
            self.rebuild_indices();
            return;
        }

        let chunk_doc_start = self.prefix_counts[start_chunk];
        let mut end_chunk = start_chunk;
        let mut covered_end = chunk_doc_start + self.chunks[start_chunk].entries.len();
        while covered_end < old_range.end && end_chunk + 1 < self.chunks.len() {
            end_chunk += 1;
            covered_end += self.chunks[end_chunk].entries.len();
        }

        let prefix_len = old_range.start - chunk_doc_start;
        let suffix_len = covered_end.saturating_sub(old_range.end);

        let mut merged = Vec::with_capacity(prefix_len + replacement.len() + suffix_len);
        merged.extend_from_slice(&self.chunks[start_chunk].entries[..prefix_len]);
        merged.extend(replacement.iter().copied());
        let end_entries = &self.chunks[end_chunk].entries;
        merged.extend_from_slice(&end_entries[end_entries.len() - suffix_len..]);

        let new_chunks: Vec<Chunk> = merged
            .chunks(CHUNK_TARGET)
            .map(|s| Chunk::from_entries(s.to_vec()))
            .collect();
        self.chunks.splice(start_chunk..=end_chunk, new_chunks);
        self.rebuild_indices();
    }
}

struct OverlayPatch {
    doc_blocks: Range<usize>,
    effective_range: Range<usize>,
    base_sum: f64,
    entries: Vec<Entry>,
    sum: f64,
}

#[derive(Default)]
struct RevealOverlay {
    reveal_ptr: usize,
    base_doc_ptr: usize,
    width: u32,
    patches: Vec<OverlayPatch>,
}

#[derive(Default)]
pub struct HeightMap {
    /// Exact measured height keyed by `(block_hash, width_bits)`.
    known_exact: HashMap<(u64, u32), f32>,
    /// Most recent measured height at any width, used only as a cross-width
    /// estimate when no exact `(block_hash, width_bits)` measurement exists.
    known_any: HashMap<u64, (u32, f32)>,
    base: Option<BasePlan>,
    overlay: RevealOverlay,
    effective_len: usize,
    full_plan_rebuilds: u64,
    base_blocks_hashed: u64,
}

/// Hash a block's height-determining identity using rope chunks without
/// materialising the whole-document flat buffer (`TA-01`, `TA-13`).
/// Strictly width-independent so width resizes never need to re-hash bytes.
fn block_key(block: &Block, doc: &Buffer, source: Range<usize>) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    source.len().hash(&mut h);
    for chunk in doc.chunks_in(source) {
        h.write(chunk.as_bytes());
    }
    match block {
        Block::Line { style, .. } => {
            0u8.hash(&mut h);
            let t = &style.text;
            for v in [
                t.size,
                t.line_height_px(),
                t.weight,
                style.padding.top,
                style.padding.bottom,
                style.padding.left,
                style.padding.right,
                style.border.top,
                style.border.bottom,
                style.border.left,
                style.border.right,
            ] {
                v.to_bits().hash(&mut h);
            }
            (t.mono, t.italic, style.nowrap, style.embed.is_some()).hash(&mut h);
        }
        Block::Widget { id, lines, .. } => {
            1u8.hash(&mut h);
            id.raw().hash(&mut h);
            lines.len().hash(&mut h);
        }
    }
    h.finish()
}

/// Height estimate for a block never laid out at this width, computed without
/// materialising `doc.flat`.
fn estimate(block: &Block, doc: &Buffer, source: Range<usize>, width: f32) -> f32 {
    match block {
        Block::Line { style, .. } => {
            let (p, b) = (style.padding, style.border);
            let line = style.text.line_height_px();
            let wrap = (width - p.left - p.right - b.left - b.right).max(1.);
            let chars: usize = doc.chunks_in(source).map(|c| c.chars().count()).sum();
            let rows = if style.nowrap {
                1.
            } else {
                (chars as f32 * style.text.ch() / wrap).ceil().max(1.)
            };
            p.top + p.bottom + b.top + b.bottom + rows * line
        }
        Block::Widget { lines, widget, .. } => widget.estimate_height(lines.clone(), width),
    }
}

impl HeightMap {
    fn build_entry(
        known_exact: &HashMap<(u64, u32), f32>,
        known_any: &HashMap<u64, (u32, f32)>,
        block: &Block,
        doc: &Buffer,
        line_count: usize,
        expected_line: Option<usize>,
        width: f32,
    ) -> Entry {
        let width_bits = width.to_bits();
        let lines = block.lines();
        if lines.is_empty()
            || lines.end > line_count
            || expected_line.is_some_and(|exp| lines.start != exp)
        {
            return Entry {
                key: 0,
                height: 0.,
                valid: false,
            };
        }
        let source = doc.line_range(lines.start).start..doc.line_range(lines.end - 1).end;
        let key = block_key(block, doc, source.clone());
        let height = if let Some(&exact) = known_exact.get(&(key, width_bits)) {
            exact
        } else if let Some(&(prev_w_bits, prev_h)) = known_any.get(&key) {
            match block {
                Block::Line { style, .. } if !style.nowrap => {
                    let prev_w = f32::from_bits(prev_w_bits);
                    let (p, b) = (style.padding, style.border);
                    let chrome = p.top + p.bottom + b.top + b.bottom;
                    let h_inset = p.left + p.right + b.left + b.right;
                    let lh = style.text.line_height_px().max(1.);
                    if prev_w > 1. && width > 1. {
                        let old_rows = ((prev_h - chrome) / lh).max(1.);
                        let old_wrap = (prev_w - h_inset).max(1.);
                        let new_wrap = (width - h_inset).max(1.);
                        let scaled_rows = (old_rows * (old_wrap / new_wrap)).ceil().max(1.);
                        chrome + scaled_rows * lh
                    } else {
                        estimate(block, doc, source, width)
                    }
                }
                _ => prev_h,
            }
        } else {
            estimate(block, doc, source, width)
        };
        Entry {
            key,
            height,
            valid: true,
        }
    }

    /// Prepare the height map for `layered` (`Rc<Decorations>` + `Rc<RevealLayer>`)
    /// at `width` and initial inset `top`.
    pub fn prepare(&mut self, layered: &LayeredDecorations, doc: &Buffer, width: f32, top: f32) {
        let doc_decos: &Rc<Decorations> = &layered.doc;
        let doc_ptr = doc_decos.id as usize;
        let width_bits = width.to_bits();
        let line_count = doc.line_count();

        if let Some(base) = self.base.as_mut()
            && base.doc_ptr == doc_ptr
        {
            // Width-only or top-inset change on the same Document Layer (`TA-13`):
            // O(1) — preserve every block entry and height, just update the
            // recorded width/top; visible blocks re-measure during layout while
            // T2's scroll anchor keeps the viewport top stable.
            base.width = width_bits;
            base.top = top;
        } else {
            let can_splice = self.base.as_ref().and_then(|b| {
                let sp = doc_decos.splice.clone()?;
                (b.doc_ptr == sp.base_ptr
                    && sp.old_blocks.start <= sp.old_blocks.end
                    && sp.old_blocks.end <= b.len
                    && sp.new_blocks.end <= doc_decos.blocks.len()
                    && b.len + sp.new_blocks.len() - sp.old_blocks.len() == doc_decos.blocks.len())
                .then_some(sp)
            });

            if let Some(sp) = can_splice {
                let mut expected = if sp.new_blocks.start == 0 {
                    Some(0)
                } else {
                    doc_decos
                        .blocks
                        .get(sp.new_blocks.start - 1)
                        .map(|prev| prev.lines().end)
                };
                let mut replacement = Vec::with_capacity(sp.new_blocks.len());
                for block in &doc_decos.blocks[sp.new_blocks.clone()] {
                    let entry = Self::build_entry(
                        &self.known_exact,
                        &self.known_any,
                        block,
                        doc,
                        line_count,
                        expected,
                        width,
                    );
                    if entry.valid {
                        expected = Some(block.lines().end);
                    }
                    self.base_blocks_hashed += 1;
                    replacement.push(entry);
                }
                if let Some(base) = self.base.as_mut() {
                    base.splice(doc_ptr, width_bits, top, sp.old_blocks, replacement);
                }
            } else {
                let n = doc_decos.blocks.len();
                let mut entries = Vec::with_capacity(n);
                let mut next_line = 0usize;
                for block in &doc_decos.blocks {
                    let entry = Self::build_entry(
                        &self.known_exact,
                        &self.known_any,
                        block,
                        doc,
                        line_count,
                        Some(next_line),
                        width,
                    );
                    if entry.valid {
                        next_line = block.lines().end;
                    }
                    entries.push(entry);
                }
                self.base_blocks_hashed += n as u64;
                self.full_plan_rebuilds += 1;
                if self.known_any.len() > 4 * n + 1024 || self.known_exact.len() > 8 * n + 4096 {
                    let live: HashSet<u64> = entries.iter().map(|e| e.key).collect();
                    self.known_any.retain(|k, _| live.contains(k));
                    self.known_exact.retain(|(k, _), _| live.contains(k));
                }
                self.base = Some(BasePlan::from_entries(doc_ptr, width_bits, top, entries));
                self.overlay = RevealOverlay::default();
            }
        }

        let reveal_ptr = Rc::as_ptr(&layered.reveal) as usize;
        if self.overlay.reveal_ptr != reveal_ptr
            || self.overlay.base_doc_ptr != doc_ptr
            || self.overlay.width != width_bits
        {
            let base = self.base.as_ref().expect("base plan built");
            let mut patches = Vec::with_capacity(layered.patch_spans().len());
            for span in layered.patch_spans() {
                let patch = &layered.reveal.patches[span.patch_idx];
                let mut expected = Some(patch.lines.start);
                let mut entries = Vec::with_capacity(patch.blocks.len());
                for block in &patch.blocks {
                    let entry = Self::build_entry(
                        &self.known_exact,
                        &self.known_any,
                        block,
                        doc,
                        line_count,
                        expected,
                        width,
                    );
                    if entry.valid {
                        expected = Some(block.lines().end);
                    }
                    entries.push(entry);
                }
                let sum = entries.iter().map(|e| e.height as f64).sum();
                let base_sum = base.range_height(span.doc_blocks.clone());
                patches.push(OverlayPatch {
                    doc_blocks: span.doc_blocks.clone(),
                    effective_range: span.effective_range.clone(),
                    base_sum,
                    entries,
                    sum,
                });
            }
            self.overlay = RevealOverlay {
                reveal_ptr,
                base_doc_ptr: doc_ptr,
                width: width_bits,
                patches,
            };
        }
        self.effective_len = layered.block_len();
    }

    /// Telemetry counters `(full_plan_rebuilds, base_blocks_hashed)` for
    /// asserting `TA-11` / `TA-13` scaling invariants in tests.
    #[cfg(test)]
    pub fn stats(&self) -> (u64, u64) {
        (self.full_plan_rebuilds, self.base_blocks_hashed)
    }

    pub fn planned(&self) -> bool {
        self.base.is_some()
    }

    pub fn len(&self) -> usize {
        self.effective_len
    }

    fn resolve_entry(&self, index: usize) -> Entry {
        let base = self.base.as_ref().expect("HeightMap::prepare first");
        if self.overlay.patches.is_empty() {
            return base.entry(index);
        }
        let mut delta: isize = 0;
        for p in &self.overlay.patches {
            if index < p.effective_range.start {
                return base.entry((index as isize - delta) as usize);
            }
            if index < p.effective_range.end {
                return p.entries[index - p.effective_range.start];
            }
            delta += p.effective_range.len() as isize - p.doc_blocks.len() as isize;
        }
        base.entry((index as isize - delta) as usize)
    }

    pub fn valid(&self, index: usize) -> bool {
        self.resolve_entry(index).valid
    }

    pub fn height(&self, index: usize) -> f32 {
        self.resolve_entry(index).height
    }

    pub fn top(&self, index: usize) -> f32 {
        let base = self.base.as_ref().expect("HeightMap::prepare first");
        let clamped = index.min(self.effective_len);
        if self.overlay.patches.is_empty() {
            return base.top_of(clamped) as f32;
        }
        let mut idx_delta: isize = 0;
        let mut y_delta: f64 = 0.0;
        for p in &self.overlay.patches {
            if clamped < p.effective_range.start {
                let doc_idx = (clamped as isize - idx_delta) as usize;
                return (base.top_of(doc_idx) + y_delta) as f32;
            }
            if clamped < p.effective_range.end {
                let local = clamped - p.effective_range.start;
                let within: f64 = p.entries[..local].iter().map(|e| e.height as f64).sum();
                return (base.top_of(p.doc_blocks.start) + y_delta + within) as f32;
            }
            idx_delta += p.effective_range.len() as isize - p.doc_blocks.len() as isize;
            y_delta += p.sum - p.base_sum;
        }
        let doc_idx = (clamped as isize - idx_delta) as usize;
        (base.top_of(doc_idx) + y_delta) as f32
    }

    pub fn bottom(&self) -> f32 {
        self.top(self.effective_len)
    }

    /// First block whose bottom is strictly below `y` (`bottom > y`).
    pub fn index_at(&self, y: f32) -> usize {
        let n = self.effective_len;
        if n == 0 {
            return 0;
        }
        if self.overlay.patches.is_empty()
            && let Some(base) = &self.base
        {
            return base.index_at(y as f64);
        }
        let mut lo = 0usize;
        let mut hi = n;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.top(mid + 1) <= y {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo.min(n - 1)
    }

    /// Record the actual laid-out height of `index`; returns `height - previous`.
    pub fn measured(&mut self, index: usize, height: f32) -> f32 {
        let Some(base) = self.base.as_mut() else {
            return 0.;
        };
        let width = base.width;
        if !self.overlay.patches.is_empty() {
            let mut idx_delta: isize = 0;
            for p in &mut self.overlay.patches {
                if index < p.effective_range.start {
                    let doc_idx = (index as isize - idx_delta) as usize;
                    let (key, delta) = base.set_height(doc_idx, height);
                    self.known_exact.insert((key, width), height);
                    self.known_any.insert(key, (width, height));
                    return delta;
                }
                if index < p.effective_range.end {
                    let local = index - p.effective_range.start;
                    let entry = &mut p.entries[local];
                    let delta = height - entry.height;
                    self.known_exact.insert((entry.key, width), height);
                    self.known_any.insert(entry.key, (width, height));
                    if delta != 0. {
                        entry.height = height;
                        p.sum = p.entries.iter().map(|e| e.height as f64).sum();
                    }
                    return delta;
                }
                idx_delta += p.effective_range.len() as isize - p.doc_blocks.len() as isize;
            }
            let doc_idx = (index as isize - idx_delta) as usize;
            let (key, delta) = base.set_height(doc_idx, height);
            self.known_exact.insert((key, width), height);
            self.known_any.insert(key, (width, height));
            return delta;
        }
        let (key, delta) = base.set_height(index, height);
        self.known_exact.insert((key, width), height);
        self.known_any.insert(key, (width, height));
        delta
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::view::{
        decoration::{BlockSplice, RevealLayer, RevealPatch},
        style::LineStyle,
    };

    #[test]
    fn incremental_splice_and_reveal_overlay_avoid_full_plan_rebuilds() {
        let style = Rc::new(LineStyle::default());
        let mut doc = Buffer::new(
            (0..500)
                .map(|i| format!("line {i}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let base_decos = Rc::new(Decorations {
            blocks: (0..doc.line_count())
                .map(|line| Block::Line {
                    line,
                    style: style.clone(),
                })
                .collect(),
            ..Default::default()
        });
        let layered = LayeredDecorations::new(base_decos.clone(), Rc::default());
        let mut hm = HeightMap::default();
        hm.prepare(&layered, &doc, 600., 16.);
        assert_eq!(hm.stats(), (1, 500));

        // Cursor-only reveal patch on line 250 rebuilds 0 base plans and hashes 0 base blocks!
        let mut tall_style = LineStyle::default();
        tall_style.padding.top = 20.;
        let reveal = Rc::new(RevealLayer {
            patches: vec![RevealPatch {
                lines: 250..251,
                byte_range: doc.line_range(250),
                blocks: vec![Block::Line {
                    line: 250,
                    style: Rc::new(tall_style),
                }],
                ..Default::default()
            }],
        });
        let before_bottom = hm.bottom();
        let with_reveal = LayeredDecorations::new(base_decos.clone(), reveal);
        hm.prepare(&with_reveal, &doc, 600., 16.);
        assert_eq!(hm.stats(), (1, 500));
        assert!((hm.bottom() - (before_bottom + 20.)).abs() < 0.01);

        // Localized edit on line 100 with `BlockSplice` hashes ONLY 1 block, 0 full rebuilds!
        let r100 = doc.line_range(100);
        doc.replace(r100, "edited line 100 with extra text");
        let mut next_blocks = base_decos.blocks.clone();
        next_blocks[100] = Block::Line {
            line: 100,
            style: style.clone(),
        };
        let next_decos = Rc::new(Decorations {
            blocks: next_blocks,
            splice: Some(BlockSplice {
                base_ptr: base_decos.id as usize,
                old_blocks: 100..101,
                new_blocks: 100..101,
                removed_widget_ids: Vec::new(),
            }),
            ..Default::default()
        });
        let next_layered = LayeredDecorations::new(next_decos, Rc::default());
        hm.prepare(&next_layered, &doc, 600., 16.);
        assert_eq!(hm.stats(), (1, 501));
        assert!(!doc.has_materialized_flat());
    }

    /// T4 (`TA-13`): width-only resize on 1,600 sections (~38,400 blocks) performs
    /// zero full rebuilds and zero block re-hashes (O(1) base update); exact
    /// `(block_hash, width)` measurements take priority over cross-width estimates;
    /// chunk-level Fenwick `top`/`index_at`/`measured` remain strictly consistent.
    #[test]
    fn width_resize_is_o1_with_zero_rehashes_and_width_keyed_known_cache() {
        let style = Rc::new(LineStyle::default());
        let line_text = "A wrapping paragraph line long enough to span multiple rows when the viewport narrows significantly during a drag resize.";
        let blocks_n = 1_600 * 24;
        let doc = Buffer::new(
            (0..blocks_n)
                .map(|i| format!("{i}: {line_text}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let base_decos = Rc::new(Decorations {
            blocks: (0..doc.line_count())
                .map(|line| Block::Line {
                    line,
                    style: style.clone(),
                })
                .collect(),
            ..Default::default()
        });
        let layered = LayeredDecorations::new(base_decos.clone(), Rc::default());
        let mut hm = HeightMap::default();
        hm.prepare(&layered, &doc, 724.0, 48.0);
        assert_eq!(hm.stats(), (1, blocks_n as u64));

        // Record an exact measured height for block 500 at 724px.
        let exact_724 = 52.5;
        let _ = hm.measured(500, exact_724);
        assert_eq!(hm.height(500), exact_724);

        // Resize across 6 widths: O(1) — ZERO full rebuilds and ZERO blocks re-hashed.
        for width in [680.0, 560.0, 480.0, 360.0, 620.0, 724.0] {
            hm.prepare(&layered, &doc, width, 48.0);
            assert_eq!(
                hm.stats(),
                (1, blocks_n as u64),
                "width resize to {width}px must not trigger full rebuild or re-hashing"
            );
            // Measure a visible block at the new width and verify Fenwick consistency.
            if (width - 360.0).abs() < 0.1 {
                let _ = hm.measured(500, 105.0);
            }
            for probe in [0usize, 127, 128, 255, 256, 500, blocks_n - 1] {
                let top = hm.top(probe);
                let h = hm.height(probe);
                let next_top = hm.top(probe + 1);
                assert!(
                    (next_top - (top + h)).abs() < 0.05,
                    "top({probe}+1)={next_top} must equal top({probe})+height={}",
                    top + h
                );
                assert_eq!(
                    hm.index_at(top + h * 0.5),
                    probe,
                    "index_at must invert top() for block {probe} at width {width}"
                );
            }
        }

        // Verify `(key, width)` exact lookup vs cross-width estimate on a fresh doc_id.
        let fresh_decos = Rc::new(Decorations {
            id: base_decos.id + 1,
            blocks: base_decos.blocks.clone(),
            ..Default::default()
        });
        let fresh_layered = LayeredDecorations::new(fresh_decos.clone(), Rc::default());
        // Exact match at 724px returns exact_724 (52.5).
        hm.prepare(&fresh_layered, &doc, 724.0, 48.0);
        assert_eq!(
            hm.height(500),
            exact_724,
            "exact (key, 724px) measurement must be reused"
        );
        // Exact match at 360px returns 105.0.
        let fresh_decos_2 = Rc::new(Decorations {
            id: fresh_decos.id + 1,
            blocks: base_decos.blocks.clone(),
            ..Default::default()
        });
        hm.prepare(
            &LayeredDecorations::new(fresh_decos_2.clone(), Rc::default()),
            &doc,
            360.0,
            48.0,
        );
        assert_eq!(
            hm.height(500),
            105.0,
            "exact (key, 360px) measurement must be reused"
        );
        // Unmeasured intermediate width 500px falls back to scaled estimate, not 52.5 or 105.0 verbatim.
        let fresh_decos_3 = Rc::new(Decorations {
            id: fresh_decos_2.id + 1,
            blocks: base_decos.blocks.clone(),
            ..Default::default()
        });
        hm.prepare(
            &LayeredDecorations::new(fresh_decos_3, Rc::default()),
            &doc,
            500.0,
            48.0,
        );
        let est_500 = hm.height(500);
        assert!(
            est_500 > exact_724 && est_500 < 105.0,
            "unmeasured width 500px must use scaled cross-width estimate between 52.5 and 105.0 (got {est_500})"
        );
    }
}
