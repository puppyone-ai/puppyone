//! Per-frame caches of the render context: Kit paragraphs reused while their
//! text and marks are unchanged, and shaped-text metrics.
use crate::editor::view::{projection::LeafText, style::TextStyle};
use gpui_kit::base::text::editor_host::Paragraph;
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    rc::Rc,
};

/// One registered text leaf of the frame.
#[derive(Clone)]
pub struct LeafEntry {
    pub key: u64,
    pub text: Rc<LeafText>,
    pub style: TextStyle,
    /// A selection crossing the end of this leaf paints a line-break box.
    pub line_break: bool,
    /// Rows the layout assumed (checked against Kit's actual layout).
    pub rows: usize,
    /// Measurement identity, for corrections.
    pub measure_key: u64,
}

/// Kit paragraphs reused across frames while their text and marks are
/// unchanged, so Kit keeps their shaped layout.
#[derive(Default)]
pub struct ParagraphCache {
    entries: HashMap<u64, (u64, Paragraph, Rc<LeafText>)>,
    used: HashMap<u64, (u64, Paragraph, Rc<LeafText>)>,
}

impl ParagraphCache {
    pub(super) fn get(&mut self, leaf: &LeafText, key: u64) -> (Paragraph, Rc<LeafText>) {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        leaf.text.hash(&mut h);
        leaf.source.start.hash(&mut h);
        for (r, m) in &leaf.marks {
            (r.start, r.end, m).hash(&mut h);
        }
        let id = h.finish();
        let found = self.used.get(&id).or_else(|| self.entries.get(&id)).filter(|(k, _, l)| *k == key && **l == *leaf).cloned();
        let entry = found.unwrap_or_else(|| (key, leaf.paragraph(key), Rc::new(leaf.clone())));
        self.used.insert(id, entry.clone());
        (entry.1, entry.2)
    }
    /// Keep only what the last frame used.
    pub fn sweep(&mut self) {
        self.entries = std::mem::take(&mut self.used);
    }
}

/// Shaped-text facts the layout needs: rows at a wrap width and the line's
/// actual ascent/descent (fallback fonts included, as GPUI centres glyphs).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextMetrics {
    pub rows: usize,
    pub ascent: f32,
    pub descent: f32,
}

#[derive(Default)]
pub struct MeasureCache {
    pub(super) entries: HashMap<u64, TextMetrics>,
    pub(super) used: HashMap<u64, TextMetrics>,
    /// Row counts Kit actually produced where the prediction differed
    /// (inline code is laid out by Kit's inline flow, not a plain line).
    pub corrections: HashMap<u64, usize>,
}

impl MeasureCache {
    pub fn sweep(&mut self) {
        self.entries = std::mem::take(&mut self.used);
        let live = &self.entries;
        self.corrections.retain(|k, _| live.contains_key(k));
    }
}
