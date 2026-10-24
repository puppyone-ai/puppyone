//! Live-preview decorations (product core/decorations/blockDecorations.ts and
//! inlineDecorations.ts): every source line becomes a styled line box or is
//! covered by a feature's block widget; block prefixes and inline
//! delimiters are hidden (or shown as source while revealed); inline roles
//! become marks.
//!
//! - `builder`: what a pass accumulates, and the facades features use
//! - `lines`: line classes and line boxes
//! - `inline`: one line's inline decorations
//! - `marks`: class spans → Kit marks
mod builder;
mod inline;
mod lines;
mod marks;

pub use builder::{BlockDecoration, LineDecoration};

use super::{
    classes::Class,
    feature::{self, Features, WidgetFactoryCx},
    plans::Plan,
    presentation::LineRhythm,
    state::PreviewState,
    syntax::Syntax,
};
use crate::editor::{
    markdown::style::{cascade::LineInput, MarkdownTheme},
    text::buffer::Buffer,
    view::decoration::{Block, Decorations, Surface},
};
use builder::Builder;
use std::ops::Range;

pub struct DecorateCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
    pub plans: &'a [Plan],
    pub rhythm: &'a [LineRhythm],
    pub theme: &'a MarkdownTheme,
    pub preview: &'a PreviewState,
    pub live: bool,
    pub features: Features,
}

/// The surface of `.markdown-codemirror-editor` / `.cm-content`.
pub fn surface(theme: &MarkdownTheme) -> Surface {
    let s = &theme.surface;
    Surface {
        content: s.insets(),
        max_text_width: Some(s.text_width),
        background: s.background,
        selection: s.selection,
        selection_inactive: s.selection_inactive,
        caret: s.caret,
        caret_width: 1.,
        link: theme.inline.link_color,
        inline_code: theme.inline.code_color,
    }
}

fn merge(mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.sort_by_key(|r| (r.start, r.end));
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for r in ranges {
        match merged.last_mut() {
            Some(last) if r.start <= last.end => last.end = last.end.max(r.end),
            _ => merged.push(r),
        }
    }
    merged
}

pub fn decorate(cx: &DecorateCx) -> Decorations {
    let doc = cx.doc;
    let count = doc.line_count();
    let mut b = Builder::new(cx);
    if !cx.live {
        // Source mode: every line is raw Markdown with uniform typography.
        for line in 0..count {
            b.line_box(line, LineInput { classes: Class::NONE, level: 0, list: None, live: false }, false);
        }
        let marks = b.marks();
        return Decorations { blocks: b.blocks, marks, hidden: Vec::new(), atomic: Vec::new(), surface: surface(cx.theme) };
    }
    let factory = WidgetFactoryCx { doc, syntax: cx.syntax, theme: cx.theme };
    let mut line = 0;
    while line < count {
        let range = doc.line_range(line);
        if cx.preview.composing == Some(range.start) {
            b.source_line(line);
            line += 1;
            continue;
        }
        // A feature block starting here replaces its lines with its widget.
        let block = b.by_line[line].iter().find(|p| p.source.start == range.start && p.embed().is_some()).and_then(|p| Some((p.source.clone(), p.embed()?.clone())));
        let widget = block.as_ref().and_then(|(_, embed)| Some((feature::find(cx.features, embed.feature)?, embed)));
        if let Some((feature, embed)) = widget
            && let Some(view) = feature.block_widget(embed, &factory)
        {
            let source = block.as_ref().map(|(s, _)| s.clone()).unwrap_or_default();
            let last = doc.line_index(source.end.saturating_sub(1).max(source.start));
            b.blocks.push(Block::Widget { lines: line..last + 1, widget: view });
            feature.decorate_block(embed, &mut BlockDecoration { builder: &mut b, source, lines: line..last + 1 });
            line = last + 1;
            continue;
        }
        // Inline plans of elements intersecting this line (multi-line
        // elements are decorated from the line that starts them).
        let plans = b.by_line[line].clone();
        b.line(line, &plans);
        line += 1;
    }
    let marks = b.marks();
    let hidden = merge(std::mem::take(&mut b.hidden));
    let mut atomic = hidden.clone();
    atomic.extend(b.atomic.into_iter().filter(|r| !r.is_empty()));
    atomic.sort_by_key(|r| r.start);
    Decorations { blocks: b.blocks, marks, atomic, hidden, surface: surface(cx.theme) }
}
