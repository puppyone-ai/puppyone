//! Formatting across a document-wide selection.
use crate::native_editor::core::{document::Document, projection::Projection, text::slice};
use std::ops::Range;
impl Document {
    pub fn toggle_visible(&mut self, range: Range<usize>, bold: bool) {
        let projection = Projection::new(self);
        let selected: Vec<_> = projection
            .spans
            .iter()
            .filter_map(|span| {
                if !self.blocks[span.key.0].kind.rich() {
                    return None;
                }
                let a = range.start.max(span.range.start);
                let b = range.end.min(span.range.end);
                (a < b).then_some((span.key, a - span.range.start..b - span.range.start))
            })
            .collect();
        let all = selected.iter().all(|(key, r)| {
            let text = self.blocks[key.0].kind.texts()[key.1];
            let text = slice(text, r.clone());
            text.marks
                .iter()
                .all(|m| if bold { m.bold } else { m.italic })
        });
        for (key, r) in selected {
            let text = self.text_mut(key).unwrap();
            let a = text.text[..r.start].chars().count();
            let b = text.text[..r.end].chars().count();
            for mark in &mut text.marks[a..b] {
                if bold {
                    mark.bold = !all;
                } else {
                    mark.italic = !all;
                }
            }
        }
    }
}
