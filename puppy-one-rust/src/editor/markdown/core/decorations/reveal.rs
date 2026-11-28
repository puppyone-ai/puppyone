//! Reveal Layer decoration overrides (`TA-11`): builds patches only for the
//! 0–3 line spans intersecting active `preview.reveal`, `preview.composing`,
//! `preview.revealed_source`, or `preview.reveal_line` ranges without ever
//! rebuilding Document-Layer blocks.
use super::{DecorateCx, block::decorate_window};
use crate::editor::{
    markdown::core::{presentation::block_rhythm_in_lines, projection::range::reveal_line_spans},
    view::{
        decoration::{Block, Decorations, RevealLayer, RevealPatch},
        widget::{BlockId, BlockIdRegistry, BlockWidget},
    },
};
use std::{collections::HashMap, ops::Range, rc::Rc};

/// Build the Reveal Layer (`TA-11`) for ONLY the 0–3 line spans intersecting
/// active `preview.reveal`, `preview.composing`, or `preview.reveal_line`.
/// Never rebuilds Document-Layer blocks!
pub fn decorate_reveal(doc_decos: &Decorations, cx: &DecorateCx, revision: u64) -> RevealLayer {
    decorate_reveal_with_fallbacks(doc_decos, cx, revision, None)
}

pub fn decorate_reveal_with_fallbacks(
    doc_decos: &Decorations,
    cx: &DecorateCx,
    revision: u64,
    source_fallbacks: Option<&[(bool, Range<usize>)]>,
) -> RevealLayer {
    if !cx.live || !cx.preview.has_reveal_overrides() {
        return RevealLayer::empty();
    }
    let merged_spans = reveal_line_spans(cx.doc, cx.preview, doc_decos.blocks.len(), |i| {
        doc_decos.blocks[i].lines()
    });
    if merged_spans.is_empty() {
        return RevealLayer::empty();
    }

    let composing_line = cx
        .preview
        .composing
        .map(|c| cx.doc.line_index(cx.doc.clamp(c)));

    // Seed temporary registry from `doc_decos` widgets inside the reveal spans
    // so any widget re-emitted inside a reveal patch keeps its exact `BlockId`!
    let mut temp_registry = BlockIdRegistry::default();
    let mut prev_widgets: HashMap<BlockId, Rc<dyn BlockWidget>> = HashMap::new();
    for span in &merged_spans {
        let b_first = doc_decos
            .blocks
            .partition_point(|b| b.lines().end <= span.start);
        let b_last = doc_decos
            .blocks
            .partition_point(|b| b.lines().start < span.end)
            .max(b_first);
        for b in &doc_decos.blocks[b_first..b_last] {
            if let Block::Widget { id, widget, .. } = b {
                prev_widgets.insert(*id, Rc::clone(widget));
            }
        }
    }

    let mut patches = Vec::with_capacity(merged_spans.len());
    for span in merged_spans {
        if span.is_empty() {
            continue;
        }
        let rhythm = block_rhythm_in_lines(cx.doc, cx.syntax, span.clone(), composing_line);
        let patch_cx = DecorateCx {
            rhythm: &rhythm,
            ..*cx
        };
        let mut win = decorate_window(
            &patch_cx,
            span.clone(),
            span.start,
            Some(&mut temp_registry),
            revision,
            Some(&prev_widgets),
            source_fallbacks,
        );
        // Preserve exact `BlockId`s for widgets matching existing Document-Layer
        // `lines` in `doc_decos`.
        for block in &mut win.blocks {
            if let Block::Widget { id, lines, .. } = block {
                let idx = doc_decos
                    .blocks
                    .partition_point(|b| b.lines().start < lines.start);
                if let Some(Block::Widget {
                    id: doc_id,
                    lines: doc_lines,
                    ..
                }) = doc_decos.blocks.get(idx)
                    && doc_lines == lines
                {
                    *id = *doc_id;
                }
            }
        }
        let byte_start = cx.doc.line_range(span.start).start;
        let byte_end = cx.doc.line_range(span.end - 1).end;
        patches.push(RevealPatch {
            lines: span,
            byte_range: byte_start..byte_end,
            blocks: win.blocks,
            marks: win.marks,
            hidden: win.hidden,
            atomic: win.atomic,
            inline_widgets: win.inline_widgets,
            underlines: win.underlines,
        });
    }

    RevealLayer::from_patches(patches)
}
