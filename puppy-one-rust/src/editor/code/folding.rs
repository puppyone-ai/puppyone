//! Code folding (`CE-01`, `WB-10`):
//! - Computes foldable line spans (`start_line..=end_line`, 0-based) once per
//!   `(revision, doc_len, language)` for brace/bracket blocks (`{...}`, `[...]`)
//!   and indentation blocks (Python / YAML).
//! - Tracks active folded header lines via [`Anchor::after`] so edits above a
//!   folded block preserve the fold, and serialises/restores 0-based line
//!   numbers for `SurfaceViewState.folds` (`WB-10`).
use super::language::Language;
use crate::editor::{
    text::{anchor::Anchor, buffer::Buffer, change::ChangeSet},
    view::widget::{BlockWidget, WidgetCx},
};
use gpui::IntoElement;
use std::ops::Range;

/// Maximum document byte size for automatic fold-region detection.
const MAX_FOLD_SCAN_BYTES: usize = 1024 * 1024;

/// Zero-height block widget standing in for collapsed body lines `start + 1..=end`.
pub struct FoldedCodeWidget;

impl BlockWidget for FoldedCodeWidget {
    fn render(&self, cx: &mut WidgetCx) -> (gpui::AnyElement, f32) {
        (cx.block_box(0.).into_any_element(), 0.)
    }

    fn eq_widget(&self, other: &dyn BlockWidget) -> bool {
        (other as &dyn std::any::Any).is::<Self>()
    }

    fn estimate_height(&self, _lines: Range<usize>, _width: f32) -> f32 {
        0.
    }
}

/// Anchor-tracked folded line headers (`CE-01`, `WB-10`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FoldState {
    anchors: Vec<Anchor>,
}

impl FoldState {
    pub fn is_empty(&self) -> bool {
        self.anchors.is_empty()
    }

    pub fn map_changes(&mut self, changes: &ChangeSet, revision: u64) {
        for a in &mut self.anchors {
            a.map(changes, revision);
        }
    }

    pub fn is_folded(&self, doc: &Buffer, line: usize) -> bool {
        if self.anchors.is_empty() {
            return false;
        }
        let start = doc.line_range(line).start;
        self.anchors.iter().any(|a| a.offset == start)
    }

    pub fn toggle(&mut self, doc: &Buffer, line: usize, revision: u64) {
        let start = doc.line_range(line).start;
        let before = self.anchors.len();
        self.anchors.retain(|a| a.offset != start);
        if self.anchors.len() == before {
            self.anchors.push(Anchor::after(start, revision));
        }
    }

    /// Unfold any active region covering `offset`.
    pub fn unfold_containing(
        &mut self,
        doc: &Buffer,
        regions: &[Range<usize>],
        offset: usize,
    ) -> bool {
        if self.anchors.is_empty() {
            return false;
        }
        let target_line = doc.line_index(offset);
        let mut changed = false;
        for r in regions {
            if target_line > r.start && target_line < r.end {
                let header_start = doc.line_range(r.start).start;
                let prev = self.anchors.len();
                self.anchors.retain(|a| a.offset != header_start);
                changed |= self.anchors.len() != prev;
            }
        }
        changed
    }

    pub fn folded_lines(&self, doc: &Buffer) -> Vec<usize> {
        let mut lines: Vec<usize> = self
            .anchors
            .iter()
            .map(|a| doc.line_index(a.offset))
            .collect();
        lines.sort_unstable();
        lines.dedup();
        lines
    }

    pub fn set_folded_lines(&mut self, doc: &Buffer, lines: &[usize], revision: u64) {
        self.anchors.clear();
        let count = doc.line_count();
        for &line in lines {
            if line < count {
                let start = doc.line_range(line).start;
                if !self.anchors.iter().any(|a| a.offset == start) {
                    self.anchors.push(Anchor::after(start, revision));
                }
            }
        }
    }
}

fn indent_cols(line: &str, tab_size: usize) -> Option<usize> {
    let mut cols = 0usize;
    for b in line.bytes() {
        match b {
            b' ' => cols += 1,
            b'\t' => cols += tab_size - (cols % tab_size),
            _ => return Some(cols),
        }
    }
    None
}

/// Compute foldable line ranges (`header_line .. last_folded_line + 1`) for `doc`.
/// Each returned `r` has `r.end >= r.start + 2` (at least one body line to fold).
pub fn compute_fold_ranges(doc: &Buffer, language: Language) -> Vec<Range<usize>> {
    if doc.is_empty() || doc.len() > MAX_FOLD_SCAN_BYTES || language.0 == "plaintext" {
        return Vec::new();
    }
    if matches!(language.0, "python" | "yaml") {
        return indent_fold_ranges(doc, language.tab_size());
    }
    brace_fold_ranges(doc)
}

fn brace_fold_ranges(doc: &Buffer) -> Vec<Range<usize>> {
    let mut stack: Vec<(u8, usize)> = Vec::new();
    let mut out: Vec<Range<usize>> = Vec::new();
    for line_idx in 0..doc.line_count() {
        let line = doc.line_cow(line_idx);
        let mut in_str: Option<u8> = None;
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let b = bytes[i];
            if let Some(q) = in_str {
                if b == b'\\' {
                    i += 2;
                    continue;
                }
                if b == q {
                    in_str = None;
                }
                i += 1;
                continue;
            }
            if b == b'/' && bytes.get(i + 1) == Some(&b'/') {
                break;
            }
            match b {
                b'"' | b'\'' | b'`' => in_str = Some(b),
                b'{' | b'[' => stack.push((b, line_idx)),
                b'}' | b']' => {
                    let want = if b == b'}' { b'{' } else { b'[' };
                    if let Some(&(open, start_line)) = stack.last()
                        && open == want
                    {
                        stack.pop();
                        if line_idx > start_line {
                            out.push(start_line..line_idx + 1);
                        }
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }
    out.sort_by_key(|r| (r.start, r.end));
    out.dedup_by(|a, b| a.start == b.start);
    out
}

fn indent_fold_ranges(doc: &Buffer, tab_size: usize) -> Vec<Range<usize>> {
    let n = doc.line_count();
    let indents: Vec<Option<usize>> = (0..n)
        .map(|l| indent_cols(&doc.line_cow(l), tab_size))
        .collect();
    let mut out = Vec::new();
    for start in 0..n {
        let Some(base) = indents[start] else {
            continue;
        };
        let mut last_body = start;
        for (line, &ind) in indents.iter().enumerate().skip(start + 1) {
            match ind {
                None => continue,
                Some(cols) if cols > base => last_body = line,
                Some(_) => break,
            }
        }
        if last_body > start {
            out.push(start..last_body + 1);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_brace_and_indent_fold_regions() {
        let js = Buffer::new("function f() {\n  const x = [1,\n    2];\n}\n");
        let folds = compute_fold_ranges(&js, Language("javascript"));
        assert_eq!(folds, vec![0..4, 1..3]);

        let py = Buffer::new("def f():\n    if ok:\n        pass\n\ndef g():\n    return 1\n");
        let py_folds = compute_fold_ranges(&py, Language("python"));
        assert_eq!(py_folds, vec![0..3, 1..3, 4..6]);
    }
}
