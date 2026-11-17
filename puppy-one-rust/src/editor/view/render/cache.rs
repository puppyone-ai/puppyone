//! Per-frame caches of the render context: Kit paragraphs reused while their
//! text, marks, style, and wrap width are unchanged (`TA-13`), and shaped-text
//! metrics.
use crate::editor::view::{projection::LeafText, style::TextStyle};
use gpui_kit::base::text::editor_host::Paragraph;
use std::{collections::HashMap, rc::Rc};

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

/// Kit paragraphs reused across frames by content + style + width identity
/// (`TA-13`), independent of raw document byte start so edits earlier in the
/// document do not invalidate shaped paragraphs below them.
#[derive(Default)]
pub struct ParagraphCache {
    entries: HashMap<u64, (Paragraph, Rc<LeafText>)>,
    used: HashMap<u64, (Paragraph, Rc<LeafText>)>,
    pub hits: u64,
    pub misses: u64,
}

impl ParagraphCache {
    pub(super) fn get(&mut self, leaf: LeafText, key: u64) -> (Paragraph, Rc<LeafText>) {
        let found = self
            .used
            .get(&key)
            .or_else(|| self.entries.get(&key))
            .filter(|(_, cached)| cached.same_content(&leaf))
            .cloned();
        let (paragraph, leaf_rc) = match found {
            Some((paragraph, cached)) => {
                self.hits += 1;
                let leaf_rc = if cached.source == leaf.source {
                    cached
                } else {
                    Rc::new(leaf)
                };
                (paragraph, leaf_rc)
            }
            None => {
                self.misses += 1;
                let paragraph = leaf.paragraph(key);
                (paragraph, Rc::new(leaf))
            }
        };
        self.used.insert(key, (paragraph.clone(), leaf_rc.clone()));
        (paragraph, leaf_rc)
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
    /// Where the last row's text ends, from the leaf's left.
    pub end: f32,
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
