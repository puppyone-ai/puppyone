//! Hidden-marker selection normalization
//! (product `core/state/selectionBehavior.ts`).
use super::revealed_source;
use crate::editor::{
    markdown::core::syntax::Syntax,
    text::{buffer::Buffer, selection::Selection},
};
use std::ops::Range;

/// `markdownHiddenMarkerSelectionNormalizer`: keep a caret off hidden
/// block markers (one caret position per visual position).
pub(super) fn normalize(
    doc: &Buffer,
    syntax: &Syntax,
    selection: Selection,
    composing: Option<usize>,
    revealed: &Option<Range<usize>>,
) -> Option<Selection> {
    if !selection.is_empty() {
        return None;
    }
    let line = doc.line_range(doc.line_index(selection.head));
    if composing == Some(line.start) || revealed_source::revealed_line(revealed, &line) {
        return None;
    }
    let marker = syntax.block_marker_on(line)?;
    let visible = marker.visible_start();
    (selection.head < visible).then(|| Selection::cursor(visible))
}
