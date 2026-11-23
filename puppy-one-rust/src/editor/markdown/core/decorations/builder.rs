//! Bounded-window decoration builder (`TA-11`, `TA-12`, `TA-33`): accumulates
//! blocks, hidden/atomic ranges, class spans, and first-class inline widgets
//! over an arbitrary `line_window: Range<usize>` (the whole document, a dirty
//! incremental splice window, or a 1-line Reveal Layer patch).
use super::DecorateCx;
use crate::editor::{
    markdown::{
        core::{
            features,
            plans::Plan,
            presentation::classes::{Class, SourceSyntax},
            syntax::Syntax,
        },
        style::{
            MarkdownTheme,
            cascade::{self, LineContext, LineInput},
        },
    },
    text::buffer::Buffer,
    view::{
        decoration::{Block, InlineImage, InlineWidget, Superscript, Underline},
        style::LineStyle,
    },
};
use gpui::SharedString;
use std::{ops::Range, rc::Rc};

/// An inline span carrying CSS classes (a mark decoration).
#[derive(Clone)]
pub(super) struct ClassSpan {
    pub range: Range<usize>,
    pub classes: Class,
    pub href: Option<SharedString>,
}

pub(super) struct Builder<'a> {
    pub cx: &'a DecorateCx<'a>,
    pub line_window: Range<usize>,
    pub rhythm_base_line: usize,
    pub blocks: Vec<Block>,
    pub hidden: Vec<Range<usize>>,
    /// Source the caret may not rest inside besides hidden ranges.
    pub atomic: Vec<Range<usize>>,
    /// Legacy line-decoration buffers folded into `inline_widgets` at finish.
    pub replaced: Vec<(Range<usize>, SharedString)>,
    pub superscripts: Vec<Superscript>,
    pub inline_images: Vec<InlineImage>,
    /// First-class inline widgets emitted directly (`TA-12`).
    pub inline_widgets: Vec<InlineWidget>,
    pub underlines: Vec<Underline>,
    /// Colours an element sets on its content (inline HTML `style`): text
    /// and background, packed.
    pub colors: Vec<(Range<usize>, Option<u32>, Option<u32>)>,
    pub spans: Vec<ClassSpan>,
    /// Inline context of each line in `line_window` (`index = line - line_window.start`).
    pub contexts: Vec<Option<LineContext>>,
    /// Plans starting on each line in `line_window` (`index = line - line_window.start`),
    /// plus any multi-line inline plan entering `line_window` from above.
    pub by_line: Vec<Vec<&'a Plan>>,
}

impl<'a> Builder<'a> {
    pub fn new_in(
        cx: &'a DecorateCx<'a>,
        line_window: Range<usize>,
        rhythm_base_line: usize,
    ) -> Self {
        let total = cx.doc.line_count();
        let start_line = line_window.start.min(total);
        let end_line = line_window.end.min(total).max(start_line);
        let len = end_line - start_line;
        let mut by_line: Vec<Vec<&'a Plan>> = vec![Vec::new(); len];

        if len > 0 {
            let byte_start = cx.doc.line_range(start_line).start;
            let byte_end = cx.doc.line_range(end_line - 1).end;
            // Include plans starting inside `byte_start..=byte_end`, plus look
            // back slightly for multi-line plans starting just before `byte_start`
            // that cover `start_line` (e.g. front-matter or multi-line spans).
            let p_first = cx
                .plans
                .partition_point(|p| p.source.start < byte_start)
                .saturating_sub(32);
            let p_last = cx
                .plans
                .partition_point(|p| p.source.start <= byte_end)
                .max(p_first);
            for plan in &cx.plans[p_first..p_last] {
                if plan.source.end < byte_start && plan.source.start < byte_start {
                    continue;
                }
                let pline = cx.doc.line_index(plan.source.start);
                if pline >= start_line && pline < end_line {
                    by_line[pline - start_line].push(plan);
                } else if pline < start_line && plan.source.end >= byte_start {
                    by_line[0].push(plan);
                }
            }
        }

        Self {
            cx,
            line_window: start_line..end_line,
            rhythm_base_line,
            blocks: Vec::with_capacity(len),
            hidden: Vec::new(),
            atomic: Vec::new(),
            replaced: Vec::new(),
            superscripts: Vec::new(),
            inline_images: Vec::new(),
            inline_widgets: Vec::new(),
            underlines: Vec::new(),
            colors: Vec::new(),
            spans: Vec::new(),
            contexts: vec![None; len],
            by_line,
        }
    }

    pub fn rhythm_of(
        &self,
        line: usize,
    ) -> &crate::editor::markdown::core::presentation::LineRhythm {
        &self.cx.rhythm[line - self.rhythm_base_line]
    }

    /// Hide `range`, or show it as revealed source.
    pub fn hide(&mut self, range: Range<usize>, kind: SourceSyntax, reveal: bool) {
        let range = self.cx.doc.clamp_range(range);
        if range.is_empty() {
            return;
        }
        if reveal {
            self.spans.push(ClassSpan {
                range,
                classes: kind.revealed(),
                href: None,
            });
        } else {
            self.hidden.push(range);
        }
    }

    /// The `.cm-line` box of a source line; in live preview, features may add
    /// to it (`decorate_line`, isolated with `catch_feature_panic`, `TA-33`).
    pub fn line_box(&mut self, line: usize, input: LineInput, features: bool) {
        let cx = self.cx;
        let (mut style, context) = cascade::line(cx.theme, &input);
        if features && cx.live {
            let local = line - self.line_window.start;
            let plans = self.by_line[local].clone();
            let line_range = cx.doc.line_range(line);
            for feat in cx.features {
                let style_snapshot = style.clone();
                let h_len = self.hidden.len();
                let r_len = self.replaced.len();
                let i_len = self.inline_images.len();
                let ok = features::catch_feature_panic(feat.id(), "decorate_line", || {
                    let mut decoration = LineDecoration {
                        doc: cx.doc,
                        line,
                        range: line_range.clone(),
                        plans: &plans,
                        syntax: cx.syntax,
                        theme: cx.theme,
                        preview: cx.preview,
                        assets: cx.assets,
                        references: cx.references,
                        context: &context,
                        style: &mut style,
                        hidden: &mut self.hidden,
                        replaced: &mut self.replaced,
                        inline_images: &mut self.inline_images,
                    };
                    feat.decorate_line(&mut decoration);
                })
                .is_some();
                if !ok {
                    style = style_snapshot;
                    self.hidden.truncate(h_len);
                    self.replaced.truncate(r_len);
                    self.inline_images.truncate(i_len);
                } else {
                    for r in &mut self.hidden[h_len..] {
                        *r = cx.doc.clamp_range(r.clone());
                    }
                    for (r, _) in &mut self.replaced[r_len..] {
                        *r = cx.doc.clamp_range(r.clone());
                    }
                    for img in &mut self.inline_images[i_len..] {
                        img.range = cx.doc.clamp_range(img.range.clone());
                    }
                }
            }
        }
        self.contexts[line - self.line_window.start] = Some(context);
        self.blocks.push(Block::Line {
            line,
            style: Rc::new(style),
        });
    }
}

/// A feature decorating the line box of one source line.
pub struct LineDecoration<'b> {
    pub doc: &'b Buffer,
    pub line: usize,
    pub range: Range<usize>,
    /// Plans whose source starts on this line.
    pub plans: &'b [&'b Plan],
    pub syntax: &'b Syntax,
    pub theme: &'b MarkdownTheme,
    pub preview: &'b crate::editor::markdown::core::state::PreviewState,
    pub assets: Option<&'b crate::editor::registry::DocumentAssets>,
    pub references: Option<&'b crate::editor::navigation::ReferenceContext>,
    /// The cascade's facts about the line (marker slot, text row).
    pub context: &'b LineContext,
    pub style: &'b mut LineStyle,
    /// Source the line hides, and source it shows as other text.
    pub hidden: &'b mut Vec<Range<usize>>,
    pub replaced: &'b mut Vec<(Range<usize>, SharedString)>,
    /// Replaced source drawn as an image in the text (a picture beside text).
    pub inline_images: &'b mut Vec<InlineImage>,
}

/// Inline-only feature output; no line box or block replacement capability.
pub struct InlineDecoration<'b> {
    pub doc: &'b Buffer,
    pub range: Range<usize>,
    pub syntax: &'b Syntax,
    pub theme: &'b MarkdownTheme,
    pub preview: &'b crate::editor::markdown::core::state::PreviewState,
    pub assets: Option<&'b crate::editor::registry::DocumentAssets>,
    pub references: Option<&'b crate::editor::navigation::ReferenceContext>,
    pub replaced: &'b mut Vec<(Range<usize>, SharedString)>,
    pub inline_images: &'b mut Vec<InlineImage>,
}

impl LineDecoration<'_> {
    pub fn inline_content(&mut self) -> InlineDecoration<'_> {
        InlineDecoration {
            doc: self.doc,
            range: self.range.clone(),
            syntax: self.syntax,
            theme: self.theme,
            preview: self.preview,
            assets: self.assets,
            references: self.references,
            replaced: self.replaced,
            inline_images: self.inline_images,
        }
    }
}

/// A feature decorating its block (around its widget).
pub struct BlockDecoration<'b, 'a> {
    pub(super) builder: &'b mut Builder<'a>,
    pub source: Range<usize>,
    pub lines: Range<usize>,
}

impl BlockDecoration<'_, '_> {
    pub fn doc(&self) -> &Buffer {
        self.builder.cx.doc
    }
    pub fn syntax(&self) -> &Syntax {
        self.builder.cx.syntax
    }
    pub fn theme(&self) -> &MarkdownTheme {
        self.builder.cx.theme
    }
    /// Source the caret may not rest strictly inside (clamped via `doc.clamp_range`, `TA-33`).
    pub fn atomic(&mut self, range: Range<usize>) {
        let clamped = self.builder.cx.doc.clamp_range(range);
        if !clamped.is_empty() {
            self.builder.atomic.push(clamped);
        }
    }
    /// Decorate one source line's inline Markdown, as text in `context`
    /// (text a widget shows, e.g. table cells).
    pub fn inline_line(&mut self, line: usize, context: LineContext) {
        if line < self.builder.line_window.start || line >= self.builder.line_window.end {
            return;
        }
        let local = line - self.builder.line_window.start;
        self.builder.contexts[local] = Some(context);
        let plans = self.builder.by_line[local].clone();
        self.builder.inline(line, &plans, Vec::new());
        let cx = self.builder.cx;
        let range = cx.doc.line_range(line);
        for feat in cx.features {
            let mut replaced = Vec::new();
            let mut images = Vec::new();
            let ok = features::catch_feature_panic(feat.id(), "decorate_inline_content", || {
                feat.decorate_inline_content(&mut InlineDecoration {
                    doc: cx.doc,
                    range: range.clone(),
                    syntax: cx.syntax,
                    theme: cx.theme,
                    preview: cx.preview,
                    assets: cx.assets,
                    references: cx.references,
                    replaced: &mut replaced,
                    inline_images: &mut images,
                });
            })
            .is_some();
            if ok {
                let bounded = |r: Range<usize>| {
                    let r = cx.doc.clamp_range(r);
                    r.start.clamp(range.start, range.end)..r.end.clamp(range.start, range.end)
                };
                self.builder
                    .replaced
                    .extend(replaced.into_iter().filter_map(|(r, text)| {
                        let r = bounded(r);
                        (!r.is_empty()).then_some((r, text))
                    }));
                self.builder
                    .inline_images
                    .extend(images.into_iter().filter_map(|mut image| {
                        image.range = bounded(image.range);
                        (!image.range.is_empty()).then_some(image)
                    }));
            }
        }
    }
}
