//! Incremental chunked block height map (`TA-11`, `TA-13`, CodeMirror
//! `HeightMap` counterpart).
//!
//! - Base heights belong to the Document Layer (`Rc<Decorations>`), stored in
//!   fixed-size chunks (`CHUNK_CAP = 128`) with per-chunk height sums so
//!   localized edits (`BlockSplice`) only hash and splice touched blocks
//!   without scanning or flattening the rest of the document.
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

    fn recompute_sum(&mut self) {
        self.sum = self.entries.iter().map(|e| e.height as f64).sum();
    }
}

struct BasePlan {
    doc_ptr: usize,
    width: u32,
    top: f32,
    len: usize,
    chunks: Vec<Chunk>,
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
        Self {
            doc_ptr,
            width,
            top,
            len,
            chunks,
        }
    }

    fn locate(&self, index: usize) -> Option<(usize, usize)> {
        if index >= self.len {
            return None;
        }
        let mut rem = index;
        for (ci, chunk) in self.chunks.iter().enumerate() {
            if rem < chunk.entries.len() {
                return Some((ci, rem));
            }
            rem -= chunk.entries.len();
        }
        None
    }

    fn entry(&self, index: usize) -> Entry {
        let (ci, li) = self.locate(index).expect("base block index in bounds");
        self.chunks[ci].entries[li]
    }

    fn top_of(&self, index: usize) -> f64 {
        let clamped = index.min(self.len);
        let mut y = self.top as f64;
        let mut rem = clamped;
        for chunk in &self.chunks {
            if rem >= chunk.entries.len() {
                y += chunk.sum;
                rem -= chunk.entries.len();
                if rem == 0 {
                    break;
                }
            } else {
                y += chunk.entries[..rem]
                    .iter()
                    .map(|e| e.height as f64)
                    .sum::<f64>();
                break;
            }
        }
        y
    }

    fn range_height(&self, range: Range<usize>) -> f64 {
        if range.start >= range.end {
            return 0.0;
        }
        self.top_of(range.end) - self.top_of(range.start)
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
            self.chunks[ci].recompute_sum();
        }
        (key, delta)
    }

    fn splice(&mut self, doc_ptr: usize, old_range: Range<usize>, replacement: Vec<Entry>) {
        self.doc_ptr = doc_ptr;
        if old_range.len() == replacement.len() {
            // Fast path for single-line / same-block-count edits: update in place.
            for (offset, next) in replacement.into_iter().enumerate() {
                let idx = old_range.start + offset;
                if let Some((ci, li)) = self.locate(idx) {
                    self.chunks[ci].entries[li] = next;
                    self.chunks[ci].recompute_sum();
                }
            }
            return;
        }

        if self.chunks.is_empty() {
            *self = Self::from_entries(doc_ptr, self.width, self.top, replacement);
            return;
        }

        // Find chunk span covering `old_range`.
        let mut start_chunk = 0usize;
        let mut chunk_doc_start = 0usize;
        for (ci, chunk) in self.chunks.iter().enumerate() {
            if chunk_doc_start + chunk.entries.len() > old_range.start {
                start_chunk = ci;
                break;
            }
            chunk_doc_start += chunk.entries.len();
            start_chunk = ci + 1;
        }
        if start_chunk >= self.chunks.len() {
            // Appending at end.
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
            self.len += added;
            return;
        }

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
        self.len = self.len + replacement.len() - old_range.len();
        self.chunks.splice(start_chunk..=end_chunk, new_chunks);
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
    patches: Vec<OverlayPatch>,
}

#[derive(Default)]
pub struct HeightMap {
    /// Last measured height per block key, with the column width (bits) it
    /// was measured at.
    known: HashMap<u64, (u32, f32)>,
    base: Option<BasePlan>,
    overlay: RevealOverlay,
    effective_len: usize,
    full_plan_rebuilds: u64,
    base_blocks_hashed: u64,
}

/// Hash a block's height-determining identity using rope chunks without
/// materialising the whole-document flat buffer (`TA-01`, `TA-13`).
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

/// Height estimate for a block never laid out at any width, computed without
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
        known: &HashMap<u64, (u32, f32)>,
        block: &Block,
        doc: &Buffer,
        line_count: usize,
        expected_line: Option<usize>,
        width: f32,
    ) -> Entry {
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
        let height = match known.get(&key) {
            Some((_, h)) => *h,
            None => estimate(block, doc, source, width),
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

        let base_up_to_date = self
            .base
            .as_ref()
            .is_some_and(|b| b.doc_ptr == doc_ptr && b.width == width_bits && b.top == top);

        if !base_up_to_date {
            let can_splice = self.base.as_ref().and_then(|b| {
                let sp = doc_decos.splice.clone()?;
                (b.doc_ptr == sp.base_ptr
                    && b.width == width_bits
                    && b.top == top
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
                    let entry =
                        Self::build_entry(&self.known, block, doc, line_count, expected, width);
                    if entry.valid {
                        expected = Some(block.lines().end);
                    }
                    self.base_blocks_hashed += 1;
                    replacement.push(entry);
                }
                if let Some(base) = self.base.as_mut() {
                    base.splice(doc_ptr, sp.old_blocks, replacement);
                }
            } else {
                let n = doc_decos.blocks.len();
                let mut entries = Vec::with_capacity(n);
                let mut next_line = 0usize;
                for block in &doc_decos.blocks {
                    let entry = Self::build_entry(
                        &self.known,
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
                if self.known.len() > 4 * n + 1024 {
                    let live: HashSet<u64> = entries.iter().map(|e| e.key).collect();
                    self.known.retain(|k, _| live.contains(k));
                }
                self.base = Some(BasePlan::from_entries(doc_ptr, width_bits, top, entries));
                self.overlay = RevealOverlay::default();
            }
        }

        let reveal_ptr = Rc::as_ptr(&layered.reveal) as usize;
        if self.overlay.reveal_ptr != reveal_ptr || self.overlay.base_doc_ptr != doc_ptr {
            let base = self.base.as_ref().expect("base plan built");
            let mut patches = Vec::with_capacity(layered.patch_spans().len());
            for span in layered.patch_spans() {
                let patch = &layered.reveal.patches[span.patch_idx];
                let mut expected = Some(patch.lines.start);
                let mut entries = Vec::with_capacity(patch.blocks.len());
                for block in &patch.blocks {
                    let entry =
                        Self::build_entry(&self.known, block, doc, line_count, expected, width);
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
            let target = y as f64;
            if target < base.top as f64 {
                return 0;
            }
            let mut running = base.top as f64;
            let mut doc_idx = 0usize;
            for chunk in &base.chunks {
                if running + chunk.sum <= target {
                    running += chunk.sum;
                    doc_idx += chunk.entries.len();
                } else {
                    for e in &chunk.entries {
                        running += e.height as f64;
                        if running > target {
                            return doc_idx.min(n - 1);
                        }
                        doc_idx += 1;
                    }
                    return n - 1;
                }
            }
            return n - 1;
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
                    self.known.insert(key, (width, height));
                    return delta;
                }
                if index < p.effective_range.end {
                    let local = index - p.effective_range.start;
                    let entry = &mut p.entries[local];
                    let delta = height - entry.height;
                    self.known.insert(entry.key, (width, height));
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
            self.known.insert(key, (width, height));
            return delta;
        }
        let (key, delta) = base.set_height(index, height);
        self.known.insert(key, (width, height));
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
}
